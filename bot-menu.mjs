// dsh-bot-menu — install the Telegram command menu that matches THIS bridge.
//
// Why it exists: the menu the person sees is whatever `setMyCommands` last
// wrote, and another plugin (@xmanrui/dsh-im) had set a Chinese list of 31
// commands that this bridge does not implement. A menu that lies is worse than
// no menu, so the bridge owns its own list and re-asserts it on start.
//
// Usage: node bot-menu.mjs [--delete]

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const args = new Set(process.argv.slice(2));

const token = (() => {
  const env = (process.env.DSH_TELEGRAM_BOT_TOKEN || '').trim();
  if (env) return env;
  try {
    const home = process.env.DSH_HOME || join(homedir(), '.dsh');
    const yaml = readFileSync(join(home, '.credentials.yaml'), 'utf8');
    // `dsh-tg init` writes the plain name; the DSH app adds a random suffix.
    const m = /^\s*(DSH_TELEGRAM_BOT_TOKEN[A-Z0-9_]*):\s*["']?([^"'\s]+)/m.exec(yaml);
    return m ? m[2] : '';
  } catch {
    return '';
  }
})();

/** The real, implemented surface of dsh-tg-bridge — nothing aspirational. */
const COMMANDS = [
  { command: 'new', description: 'Новая сессия в этой теме' },
  { command: 'cd', description: 'Привязать тему к проекту: /cd my-app' },
  { command: 'status', description: 'Сессии, модель, активные ходы' },
  { command: 'stop', description: 'Остановить текущий ход' },
  { command: 'prices', description: 'Цены моделей и что стоит текущая' },
  { command: 'send', description: 'Прислать файл из проекта в чат' },
  { command: 'seed', description: 'Засеять пустую тему текстом и закрепить' },
  { command: 'goal', description: 'Цель темы: /goal <текст>, /goal done' },
  { command: 'task', description: 'Задачи: /task <текст>, /task done <n>' },
  { command: 'sessions', description: 'Список сессий темы' },
  { command: 'resume', description: 'Продолжить сессию: /resume <id>' },
  { command: 'model', description: 'Показать или сменить: /model, /model <id>' },
  { command: 'skills', description: 'Скиллы: список или текст одного' },
  { command: 'soul', description: 'Персона: показать или задать' },
  { command: 'plugins', description: 'Список и управление: add/remove/disable/enable' },
  { command: 'app', description: 'Приложение DSH, не мост: /app restart confirm' },
  { command: 'restart', description: 'Перезапуск моста: /restart confirm' },
  { command: 'doctor', description: 'Диагностика: мост, сеть, диск, каталог, сессия' },
  { command: 'logs', description: 'Хвост лога моста: /logs 50 или /logs TG_NET' },
  { command: 'help', description: 'Все команды и подсказки' },
  { command: 'lang', description: 'Язык интерфейса: en, ru, zh' },
  { command: 'reasoning', description: 'Заметки по ходу: /reasoning on|off' },
  { command: 'profile', description: 'Профиль темы: /profile <имя>, /profile new' },
];

/** English menu (language_code: en). Same commands, translated descriptions. */
const COMMANDS_EN = [
  { command: 'new', description: 'New session in this topic' },
  { command: 'cd', description: 'Bind this topic to a project: /cd my-app' },
  { command: 'status', description: 'Sessions, model, active turns' },
  { command: 'stop', description: 'Stop the current turn' },
  { command: 'prices', description: 'Model prices and the cost of the current one' },
  { command: 'send', description: 'Send a file from the project into the chat' },
  { command: 'seed', description: 'Seed an empty topic with text and pin it' },
  { command: 'goal', description: 'Topic goal: /goal <text>, /goal done' },
  { command: 'task', description: 'Checklist: /task <text>, /task done <n>' },
  { command: 'sessions', description: 'This topic\u2019s sessions' },
  { command: 'resume', description: 'Continue a session: /resume <id>' },
  { command: 'model', description: 'Show or switch: /model, /model <id>' },
  { command: 'skills', description: 'Installed skills' },
  { command: 'soul', description: 'Agent persona' },
  { command: 'plugins', description: 'List and manage: add/remove/disable/enable' },
  { command: 'app', description: 'DSH desktop app (not the bridge)' },
  { command: 'restart', description: 'Restart the bridge: /restart confirm' },
  { command: 'doctor', description: 'Diagnostics: bridge, network, disk, directory, session' },
  { command: 'logs', description: 'Bridge log tail: /logs 50 or /logs TG_NET' },
  { command: 'help', description: 'All commands and hints' },
  { command: 'lang', description: 'Interface language: en, ru, zh' },
  { command: 'reasoning', description: 'Working notes: /reasoning on|off' },
  { command: 'profile', description: 'Topic profile: /profile <name>, /profile new' },
];

/** Chinese menu (language_code: zh-hans). */
const COMMANDS_ZH = [
  { command: 'new', description: '在本话题开始新会话' },
  { command: 'cd', description: '将本话题绑定到项目：/cd my-app' },
  { command: 'status', description: '会话、模型、进行中的任务' },
  { command: 'stop', description: '停止当前任务' },
  { command: 'prices', description: '模型价格与当前模型花费' },
  { command: 'send', description: '把项目中的文件发送到聊天' },
  { command: 'seed', description: '用文本初始化空话题并置顶' },
  { command: 'goal', description: '本话题目标：/goal <文本>、/goal done' },
  { command: 'task', description: '任务清单：/task <文本>、/task done <n>' },
  { command: 'sessions', description: '本主题的会话列表' },
  { command: 'resume', description: '继续会话：/resume <id>' },
  { command: 'model', description: '查看或切换：/model, /model <id>' },
  { command: 'skills', description: '已安装的技能' },
  { command: 'soul', description: '代理人格设定' },
  { command: 'plugins', description: '列表与管理：add/remove/disable/enable' },
  { command: 'app', description: 'DSH 桌面应用（不是桥接）' },
  { command: 'restart', description: '重启桥接：/restart confirm' },
  { command: 'doctor', description: '诊断：桥接、网络、磁盘、目录、会话' },
  { command: 'logs', description: '桥接日志：/logs 50 或 /logs TG_NET' },
  { command: 'help', description: '全部命令与提示' },
  { command: 'lang', description: '界面语言：en、ru、zh' },
  { command: 'reasoning', description: '工作记录：/reasoning on|off' },
  { command: 'profile', description: '话题配置档：/profile <名称>，/profile new' },
];

async function api(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`${method}: ${json.description || res.status}`);
  return json.result;
}

async function main() {
  if (!token) {
    console.error('bot token not found in ~/.dsh/.credentials.yaml');
    process.exit(1);
  }
  if (args.has('--delete')) {
    await api('deleteMyCommands', {});
    console.log('menu deleted');
    return;
  }
  // Telegram keeps one menu per language_code, so a Chinese or English user
  // sees the list in their own language instead of Russian.
  await api('setMyCommands', { commands: COMMANDS });
  // Telegram validates language_code against its own ISO list: 'zh-hans' is
  // rejected with "invalid language code", 'zh' is accepted. Each language is
  // installed independently — one refusal must not leave the others unset.
  for (const [code, list] of [['en', COMMANDS_EN], ['zh', COMMANDS_ZH]]) {
    try {
      await api('setMyCommands', { commands: list, language_code: code });
      console.log(`menu installed for ${code}: ${list.length} commands`);
    } catch (error) {
      console.error(`menu for ${code} failed: ${error.message}`);
    }
  }
  const check = await api('getMyCommands', {});
  console.log(`menu installed: ${check.length} commands`);
  for (const c of check) console.log(`  /${c.command} — ${c.description}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
