#!/usr/bin/env node
// dsh-tg — CLI entrypoint for the Telegram bridge of DeepSeek Harness.
//
//   npx dsh-tg init --token <T> --user <ID>   write config + credentials, no editing
//   npx dsh-tg setup                          install/restart the bridge
//   npx dsh-tg check                          diagnostics only, changes nothing
//   npx dsh-tg doctor                         supervisor report (pid, log tail)
//   npx dsh-tg menu                           register the bot command menu
//   npx dsh-tg start                          run the bridge in the foreground
//
// The goal of `init` is a cold start with ONE command: the person pastes the
// bot token and their numeric id, and nothing else needs hand-editing.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(DIR, 'package.json'), 'utf8'));
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
// setup.mjs, the watchdog and /doctor all work on this one directory, so the
// config must be written here and a checkout elsewhere must be mirrored here.
const RUNTIME = join(DSH_HOME, 'tg-bridge');
// Whatever the package ships. This was a hand-kept list until it silently fell
// behind the code: a file it did not name was not copied, and the bridge then
// started from a directory that could not import what it needed.
const RUNTIME_FILES = (pkg.files || []).filter((entry) => !entry.endsWith('/'));

/**
 * Mirror this checkout into the runtime directory.
 *
 * Cloning anywhere except ~/.dsh/tg-bridge used to make `setup` answer "bridge
 * not found", because every helper looks in the runtime directory. Files are
 * copied, config.json is never overwritten: it holds the person's id and token.
 */
function syncRuntime() {
  if (resolve(DIR) === resolve(RUNTIME)) return;
  mkdirSync(RUNTIME, { recursive: true });
  for (const file of RUNTIME_FILES) {
    if (existsSync(join(DIR, file))) copyFileSync(join(DIR, file), join(RUNTIME, file));
  }
  // Model overlays ship in `patches/` of the package. A checkout without that
  // directory is valid: fallbacks and vision are then simply not configured.
  if (existsSync(join(DIR, 'patches'))) {
    mkdirSync(join(RUNTIME, 'patches'), { recursive: true });
    try {
      for (const patch of readdirSync(join(DIR, 'patches'))) {
        copyFileSync(join(DIR, 'patches', patch), join(RUNTIME, 'patches', patch));
      }
    } catch {}
  }
  console.log(`  код: скопирован из ${DIR} в ${RUNTIME}`);
}

const [, , cmd = 'help', ...rest] = process.argv;

const run = (file, args, { sync = false } = {}) => {
  if (sync) syncRuntime();
  const local = join(DIR, file);
  const installed = join(RUNTIME, file);
  // After a sync the installed copy is the freshest; otherwise run this checkout's
  // own file, which reads state from RUNTIME through DSH_HOME.
  const script = sync && resolve(RUNTIME) !== resolve(DIR) && existsSync(installed) ? installed : local;
  const res = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit', cwd: dirname(script) });
  process.exit(res.status ?? 0);
};

/** `--flag value` reader over a flat argv list. */
function flag(name, fallback = '') {
  const at = rest.indexOf(`--${name}`);
  return at === -1 ? fallback : (rest[at + 1] ?? '');
}

const help = `
dsh-tg ${pkg.version} — Telegram bridge for DeepSeek Harness

  dsh-tg init --token <bot-token> --user <your-id>   настроить всё одной командой
  dsh-tg setup     установить и перезапустить мост (setup.log хранит шаги)
  dsh-tg check     диагностика, ничего не меняет
  dsh-tg doctor    отчёт супервизора: pid, хвост лога
  dsh-tg menu      зарегистрировать /команды в меню Telegram
  dsh-tg start     запустить мост на переднем плане
  dsh-tg version   версия
  dsh-tg help      этот текст

init:
  --token <t>      токен бота от @BotFather (обязательно)
  --user <id>      ваш числовой id от @userinfobot (обязательно)
  --cwd <path>     рабочий каталог (по умолчанию ~/Projects)
  --voice          включить голос (нужен python + faster-whisper)
  --dry-run        показать, что будет записано, ничего не менять

Docs: README.md, docs/TELEGRAM-SETUP.md, docs/ROADMAP.md.
`;

/**
 * Write `DSH_TELEGRAM_BOT_TOKEN: "..."` into the credentials store without
 * touching other secrets: DSH keeps every credential in this one file, so a
 * careless rewrite would log the person out of everything else.
 *
 * Line-based on purpose: regex over the whole file either misses a `refs:`
 * that sits mid-document or appends a second `refs:` key, and a duplicate key
 * silently hides every credential above it.
 */
function writeCredential(token, dryRun) {
  const file = join(DSH_HOME, '.credentials.yaml');
  const line = `  DSH_TELEGRAM_BOT_TOKEN: "${token}"`;
  let lines;
  try {
    lines = readFileSync(file, 'utf8').split(/\r?\n/);
  } catch {
    lines = [];
  }
  const existing = lines.findIndex((l) => /^\s*DSH_TELEGRAM_BOT_TOKEN:/.test(l));
  if (existing !== -1) {
    if (lines[existing] === line) {
      console.log('  credentials: токен уже записан');
      return;
    }
    lines[existing] = line;
    console.log(`  credentials: токен ${dryRun ? 'обновил бы' : 'обновлён'} в ${file}`);
  } else {
    const refs = lines.findIndex((l) => /^refs:\s*$/.test(l));
    if (refs === -1) {
      const tail = lines.join('\n').trimEnd();
      lines = [...(tail ? [tail, ''] : []), 'refs:', line];
    } else {
      lines.splice(refs + 1, 0, line);
    }
    console.log(`  credentials: токен ${dryRun ? 'записал бы' : 'записан'} в ${file}`);
  }
  if (dryRun) return;
  mkdirSync(DSH_HOME, { recursive: true });
  writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
}

/** Build config.json for this person: their id, their cwd, voice only if asked. */
function writeConfig({ userId, cwd, voice }, dryRun) {
  const target = join(RUNTIME, 'config.json');
  const example = JSON.parse(readFileSync(join(DIR, 'config.example.json'), 'utf8'));
  if (existsSync(target)) {
    console.log('  config.json: уже существует — не перезаписан');
    return;
  }
  const config = {
    ...example,
    allowedUserIds: [Number(userId)],
    cwd,
    // Turns run from the user's project directory, so these must be absolute:
    // a relative "./transcribe.py" silently disables voice and vision.
    voice: { ...example.voice, enabled: Boolean(voice), script: join(RUNTIME, 'transcribe.py') },
    // Vision is opt-in: without a patch the bridge logs that photos cannot be
    // read instead of forcing one provider's model onto every install.
    vision: { ...example.vision, patch: example.vision?.patch ? join(RUNTIME, 'patches', 'vision.yml') : '' },
  };
  delete config._comment;
  if (dryRun) {
    console.log(`  config.json: создал бы ${target} (id ${userId}, cwd ${cwd}, voice ${voice ? 'on' : 'off'})`);
    return;
  }
  mkdirSync(RUNTIME, { recursive: true });
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  console.log(`  config.json: создан (id ${userId}, voice ${voice ? 'вкл' : 'выкл'})`);
}

/** A missing headless profile cannot be invented: DSH ships its bundles. */
function checkProfile() {
  const profile = join(DSH_HOME, 'profiles', 'headless');
  if (existsSync(profile)) {
    console.log('  профиль headless: на месте');
    return true;
  }
  console.log('  профиль headless: НЕ НАЙДЕН');
  console.log('    создай его один раз в приложении DSH: Settings → Profiles → headless,');
  console.log('    либо скопируй шаблон из сборки: dsh --profile headless --dump-default-config');
  return false;
}

switch (cmd) {
  case 'init': {
    const token = flag('token');
    const userId = flag('user');
    const dryRun = rest.includes('--dry-run');
    const voice = rest.includes('--voice');
    const cwd = flag('cwd', join(homedir(), 'Projects'));

    if (!token || !userId) {
      console.error('init требует --token и --user\n');
      console.log(help);
      process.exit(2);
    }
    if (!/^\d+$/.test(userId)) {
      console.error(`--user должен быть числом (получено "${userId}"). Узнать: @userinfobot`);
      process.exit(2);
    }
    if (!/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(token)) {
      console.error('--token не похож на токен бота (ожидается 123456789:AA…)');
      process.exit(2);
    }

    console.log(`dsh-tg init${dryRun ? ' (dry run)' : ''}\n`);
    writeCredential(token, dryRun);
    writeConfig({ userId, cwd, voice }, dryRun);
    checkProfile();
    console.log('\nДальше:');
    console.log('  npx dsh-tg-bridge@latest check   # проверить');
    console.log('  npx dsh-tg-bridge@latest setup   # поднять мост');
    console.log('  в Telegram: /doctor');
    break;
  }
  case 'setup': run('setup.mjs', rest, { sync: true }); break;
  // check must see the installed copy; if the runtime directory was never
  // populated (custom clone path), mirror first so the report is not a lie.
  case 'check': run('setup.mjs', ['--check', ...rest], { sync: !existsSync(join(RUNTIME, 'bridge.mjs')) }); break;
  case 'doctor': run('bridge-kick.mjs', rest); break;
  case 'menu': run('bot-menu.mjs', rest); break;
  case 'start': run('bridge.mjs', rest, { sync: true }); break;
  case 'version': console.log(pkg.version); break;
  case 'help': case '--help': case '-h': console.log(help); break;
  default:
    console.error(`unknown command: ${cmd}`);
    console.log(help);
    process.exit(2);
}
