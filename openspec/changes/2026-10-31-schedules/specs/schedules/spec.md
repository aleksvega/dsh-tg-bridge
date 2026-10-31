# schedules

## ADDED Requirements

### Requirement: A schedule is created from the chat

`/every <HH:MM> <text>` SHALL create one daily schedule for the current chat and
topic, and SHALL refuse a relative delay, an impossible clock and a missing text
with the same words `/remind` uses.

#### Scenario: A schedule is created

- **WHEN** a person sends `/every 09:00 check the build`
- **THEN** the answer names the topic, the next run as a local date and time, and
  the text, in the language of the topic

#### Scenario: The clock is not a clock

- **WHEN** the argument is `+15m`, `25:00`, `9` or missing
- **THEN** the schedule is not written and the refusal says what shape is
  expected, using the reminder's own sentence rather than a second one

### Requirement: Schedules are listed and removed by number

`/every list` SHALL number this chat's schedules with their next run and their
text; `/every rm <n>` SHALL remove one by that number.

#### Scenario: A list is read

- **WHEN** a person sends `/every list`
- **THEN** each row shows its number, its next run in local time and its text,
  and the numbering is what `/every rm` accepts

#### Scenario: A number is not in the list

- **WHEN** `/every rm 9` names a row that does not exist
- **THEN** nothing is removed and the answer names the range that does exist

### Requirement: A chat may hold a bounded number of schedules

A chat SHALL hold at most twenty schedules across its topics, and the refusal
SHALL name the number.

#### Scenario: The cap is reached

- **WHEN** a chat that already holds twenty schedules asks for another
- **THEN** the new row is refused, the number is named, and nothing already
  scheduled is changed

### Requirement: A firing is a real turn

The tick SHALL deliver a due row as a synthetic message for the row's own chat
and topic through the same path an incoming message takes, and SHALL NOT send a
notification itself.

#### Scenario: A schedule comes due

- **WHEN** the tick finds a row whose time has passed
- **THEN** the text enters that topic's turn path exactly as a typed message
  would, and the answer appears in that topic

#### Scenario: The topic is gone

- **WHEN** the row's topic no longer exists
- **THEN** the skip is one log line naming the chat and the topic, the row still
  advances to its next occurrence, and the tick does not throw

### Requirement: Nothing fires twice and a missed occurrence fires once

The tick SHALL claim a due row by advancing its time to the next occurrence and
persisting that before delivery.

#### Scenario: The bridge restarts

- **WHEN** the bridge restarts after a firing
- **THEN** nothing already claimed is delivered again

#### Scenario: The bridge was down for four days

- **WHEN** the process starts and a daily row is four days past due
- **THEN** the missed occurrence fires exactly once, not four times

#### Scenario: A daylight-saving change

- **WHEN** the local clock shifts by an hour
- **THEN** the next run is still at the stated wall clock, because it is computed
  from the clock rather than from the previous run plus a day

### Requirement: A schedule runs only while the bridge runs

The feature SHALL state plainly that a schedule fires only while the process is
up, and SHALL NOT promise a firing it cannot make.

#### Scenario: The person asks why nothing ran

- **WHEN** a schedule's time passed while the bridge was stopped
- **THEN** the documentation and the command's help say the firing happens on the
  next start, once, rather than pretending the process was running

### Requirement: The words live in every locale

Every string the command and its answers use SHALL exist in `en`, `ru` and `zh`,
read from the topic's language.

#### Scenario: A topic is not in the install's language

- **WHEN** a topic runs in Russian on an English install
- **THEN** the schedule's acknowledgement, list, refusal and removal all arrive
  in Russian