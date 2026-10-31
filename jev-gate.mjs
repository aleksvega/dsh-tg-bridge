// jev-gate.mjs — a second pair of eyes on the diff, in the commit itself.
//
// `scan-secrets.mjs` catches what a string match can prove. This asks a model
// what a string match cannot: is this change wrong? It runs `jev-qa --diff` and
// reads its report, because the tool itself always exits 0 — a report is not a
// verdict, and a hook needs one.
//
// Three rules make it usable on a hook rather than on a good day:
//
//   fail-open   no key, no tool, no changed code, a timeout: skip with one line.
//               A gate that blocks every commit when the network is down is a
//               gate people learn to bypass with --no-verify, and the bypass
//               would also let the next real finding through.
//   narrow FAIL only what is hard to argue with: a syntax error, a severity of 4
//               or 5, or a security flag above 0.8. The rest is printed as
//               advice — a probabilistic hunch is not worth a refused commit.
//   cheap       one diff, one call per changed file, `--max` capped.
//
// Usage: node jev-gate.mjs [--max N]     (env: DSH_SKIP_JEV=1 to skip)
// Exit 0 = pass or skip, 1 = FAIL (the report says why).
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Blocking thresholds. Named, so a change to them is a visible decision. */
export const FAIL_SEVERITY = 4;
export const FAIL_SECURITY = 0.8;
const TIMEOUT_MS = 180000;

/** The report as numbers, or empty lists when the text is not a report. */
export function parseReport(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const syntax = [];
  const rows = [];
  for (const line of lines) {
    const bullet = /^- \*\*(.+?)\*\* — `(.*)`\s*$/.exec(line);
    if (bullet) {
      syntax.push({ file: bullet[1], error: bullet[2] });
      continue;
    }
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 8 || cells[0] === 'file' || /^-+$/.test(cells[0])) continue;
    const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
    rows.push({
      file: cells[0],
      hasBug: num(cells[1]),
      severity: num(cells[2]),
      risk: num(cells[3]),
      security: num(cells[5]),
      logic: num(cells[6]),
    });
  }
  return { syntax, rows };
}

/**
 * Pass or fail, and the lines that explain it. `reasons` is what the person
 * reads on a refused commit, so each one names the file and the number.
 */
export function verdict(report) {
  const { syntax, rows } = report || { syntax: [], rows: [] };
  const reasons = syntax.map((s) => `${s.file}: syntax error — ${s.error}`);
  for (const row of rows) {
    if (row.severity >= FAIL_SEVERITY) reasons.push(`${row.file}: severity ${row.severity}/5`);
    if (row.security >= FAIL_SECURITY) reasons.push(`${row.file}: security risk ${row.security}`);
  }
  const advice = rows
    .filter((row) => !reasons.some((r) => r.startsWith(`${row.file}:`)))
    .map((row) => `${row.file}: bug ${row.hasBug}, severity ${row.severity}, risk ${row.risk}`);
  return { ok: reasons.length === 0, reasons, advice };
}

/**
 * Run the tool and turn its report into a verdict.
 *
 * `run` is injectable so the tests never touch the network, and so a future
 * caller can point at a local checkout of the tool.
 */
export function runJevGate({ root, env = process.env, max = 20, run = spawnSync, timeoutMs = TIMEOUT_MS } = {}) {
  // `jev-qa` reads OPENROUTER_API_KEY; the rest of this machine's tooling uses
  // JEV_API_KEY for the same decision endpoint. Without this the gate would skip
  // on a machine where Jev works everywhere else.
  const key = env.OPENROUTER_API_KEY || env.JEV_API_KEY || '';
  if (!key) return { status: 'skip', reason: 'no JEV_API_KEY or OPENROUTER_API_KEY' };
  if (env.DSH_SKIP_JEV) return { status: 'skip', reason: 'DSH_SKIP_JEV is set' };
  let result;
  try {
    result = run('jev-qa', [root, '--diff', '--max', String(max)], {
      encoding: 'utf8',
      timeout: timeoutMs,
      shell: true,
      windowsHide: true,
      env: { ...env, OPENROUTER_API_KEY: key },
    });
  } catch (error) {
    return { status: 'skip', reason: `jev-qa could not run: ${error.message}` };
  }
  if (result?.error?.code === 'ENOENT') return { status: 'skip', reason: 'jev-qa is not installed' };
  if (result?.signal || result?.error?.code === 'ETIMEDOUT') {
    return { status: 'skip', reason: 'jev-qa did not finish in time' };
  }
  const out = String(result?.stdout || '');
  if (!out.trim()) {
    return { status: 'skip', reason: 'jev-qa printed no report' };
  }
  if (/no changed code files/i.test(out)) return { status: 'pass', report: out, advice: [] };
  const report = parseReport(out);
  const decided = verdict(report);
  return { status: decided.ok ? 'pass' : 'fail', report: out, reasons: decided.reasons, advice: decided.advice };
}

function main() {
  const maxArg = process.argv.indexOf('--max');
  const max = maxArg !== -1 ? Number(process.argv[maxArg + 1]) : 20;
  const root = process.cwd();
  const result = runJevGate({ root, max });
  if (result.status === 'skip') {
    console.error(`jev-gate: skipped (${result.reason})`);
    return 0;
  }
  if (result.status === 'pass') {
    if (result.advice?.length) console.error(`jev-gate: passed, worth a look:\n  ${result.advice.join('\n  ')}`);
    return 0;
  }
  console.error(`jev-gate: FAIL — fix these or commit with --no-verify:\n  ${result.reasons.join('\n  ')}`);
  console.error(`\nfull report:\n${result.report}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}