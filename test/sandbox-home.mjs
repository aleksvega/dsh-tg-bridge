// A throwaway DSH_HOME for the tests that import control.mjs. Import this module
// before control.mjs: an import of a bare path reads the machine's real profiles,
// and one of those tests once ran pnpm against the desktop app.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

if (!process.env.DSH_HOME) {
  const sandbox = mkdtempSync(join(tmpdir(), "dsh-home-"));
  for (const profile of ["desktop", "headless"]) {
    mkdirSync(join(sandbox, "profiles", profile), { recursive: true });
    writeFileSync(
      join(sandbox, "profiles", profile, "package.json"),
      JSON.stringify({ name: `profile-${profile}`, dependencies: {} }, null, 2),
    );
  }
  writeFileSync(join(sandbox, "config.json"), JSON.stringify({ profile: "headless", lang: "en" }, null, 2));
  process.env.DSH_HOME = sandbox;
}

export const SANDBOX_HOME = process.env.DSH_HOME;
