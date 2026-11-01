# stability-contract

## ADDED Requirements

### Requirement: A restart marker expires

A `restart.pending` marker SHALL NOT outlive its purpose. When a supervisor tick
finds the marker and the pid it names is alive, the tick SHALL clear the marker
once it is older than ten minutes, and SHALL log that it did so.

#### Scenario: The process that wrote the marker is gone

- **WHEN** a tick finds `restart.pending` older than ten minutes and the pid is
  no longer alive
- **THEN** the tick starts a bridge and removes the marker

#### Scenario: The pid is alive but the marker is stale

- **WHEN** a tick finds a marker older than ten minutes and the pid is alive
- **THEN** the tick removes the marker, logs one line, and does not start a second
  bridge

#### Scenario: A fresh marker

- **WHEN** the marker is younger than ten minutes
- **THEN** the tick leaves it alone and starts nothing

### Requirement: One tick starts at most one bridge

A supervisor tick SHALL take an exclusive lock before spawning, so two ticks that
run milliseconds apart cannot both start a process.

#### Scenario: Two ticks overlap

- **WHEN** two ticks race for the start lock
- **THEN** exactly one spawns a bridge and the other exits without spawning

#### Scenario: A stale lock

- **WHEN** the lock is older than the tick interval and no bridge is alive
- **THEN** the next tick takes it and starts one bridge

### Requirement: A rollback does not repeat inside its cooldown

The rollback cooldown SHALL be at least twice the supervisor tick interval, and
SHALL be persisted where the tick reads it before restoring anything.

#### Scenario: A second tick during cooldown

- **WHEN** a rollback happened less than one cooldown ago and another tick runs
- **THEN** no second restore happens and no second "rolled back" message is sent

### Requirement: An unhandled rejection ends the process

An `unhandledRejection` SHALL be logged and SHALL terminate the process with a
non-zero code, so the supervisor restarts a clean process instead of leaving one
with half-failed state.

#### Scenario: A promise rejects outside a handler

- **WHEN** an unhandled rejection occurs
- **THEN** the log records it and the process exits non-zero within one tick

### Requirement: Every accepted update is acknowledged

An update that was accepted for processing SHALL be acknowledged even when the
handler throws, so it is not replayed and re-billed on the next start.

#### Scenario: The handler throws after acceptance

- **WHEN** `handleMessage` rejects after the update was accepted
- **THEN** the pending entry is acknowledged and the failure is logged once

### Requirement: A corrupt state file is reported

A `state.json` that fails to parse SHALL be reported in the log with the file
path and the parse error, and SHALL be kept as a `.bad` copy before a fresh state
is written.

#### Scenario: Truncated state

- **WHEN** `state.json` contains invalid JSON
- **THEN** the log names the failure, `state.json.bad` holds the old bytes, and
  the bridge starts with an empty state rather than crashing

### Requirement: The person can see a wedged supervisor

`/doctor` SHALL report the marker state and the age of the last `kick.log` line,
so a silent supervisor is visible from the chat.

#### Scenario: A wedged marker exists

- **WHEN** the person runs `/doctor` while `restart.pending` is present
- **THEN** one row names the marker and its age
