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
  { command: 'tasks', description: 'Список задач кнопками: нажатие закрывает' },
  { command: 'sessions', description: 'Сессии темы — обычный текст продолжает последнюю' },
  { command: 'resume', description: 'Продолжить сессию: /resume <id>' },
  { command: 'model', description: 'Показать или сменить: /model, /model <id>' },
  { command: 'skills', description: 'Скиллы: список или текст одного' },
  { command: 'soul', description: 'Персона: показать или задать' },
  { command: 'plugins', description: 'Список и управление: add/remove/disable/enable' },
  { command: 'app', description: 'Приложение DSH, не мост: /app restart confirm' },
  { command: 'restart', description: 'Перезапуск моста: /restart confirm' },
  { command: 'doctor', description: 'Диагностика: мост, сеть, диск, плагины, сессия' },
  { command: 'logs', description: 'Лог: /logs, /logs 100, /logs errors, /logs file' },
  { command: 'help', description: 'Все команды и подсказки' },
  { command: 'lang', description: 'Язык интерфейса: en, ru, zh' },
  { command: 'reasoning', description: 'Заметки по ходу: /reasoning on|off' },
  { command: 'profile', description: 'Профиль темы: /profile <имя>, /profile new' },
  { command: 'agents', description: 'Агенты и субагенты: кто, на какой модели, кого запускали' },
  { command: 'agentset', description: 'Набор настроек темы: модель, права, пресет одним переключателем' },
  { command: 'effort', description: 'Усилие рассуждения модели: /effort high' },
  { command: 'permissions', description: 'Права профиля: пресет песочницы и подтверждений' },
  { command: 'preset', description: 'Пресет агента (персона и инструменты): /preset <id>' },
  { command: 'plan', description: 'Режим плана: состояние и как получить план без правок' },
  { command: 'jobs', description: 'Что мост выполняет сейчас: ходы и очередь' },
  { command: 'remind', description: 'Напоминание: /remind +15m текст или 09:30 текст' },
  { command: 'thoughts', description: 'Рассуждения хода: текстом, файлом или выкл' },
  { command: 'version', description: 'Версия моста и последняя на npm' },
  { command: 'update', description: 'Обновить мост из npm: /update confirm' },
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
  { command: 'tasks', description: 'Task list as buttons: tap to close' },
  { command: 'sessions', description: 'Sessions of this topic — plain text continues the last one' },
  { command: 'resume', description: 'Continue a session: /resume <id>' },
  { command: 'model', description: 'Show or switch: /model, /model <id>' },
  { command: 'skills', description: 'Installed skills' },
  { command: 'soul', description: 'Agent persona' },
  { command: 'plugins', description: 'List and manage: add/remove/disable/enable' },
  { command: 'app', description: 'DSH desktop app (not the bridge)' },
  { command: 'restart', description: 'Restart the bridge: /restart confirm' },
  { command: 'doctor', description: 'Diagnostics: bridge, network, disk, plugins, session' },
  { command: 'logs', description: 'Log: /logs, /logs 100, /logs errors, /logs file' },
  { command: 'help', description: 'All commands and hints' },
  { command: 'lang', description: 'Interface language: en, ru, zh' },
  { command: 'reasoning', description: 'Working notes: /reasoning on|off' },
  { command: 'profile', description: 'Topic profile: /profile <name>, /profile new' },
  { command: 'agents', description: 'Agents and subagents: who runs, on which model, who was spawned' },
  { command: 'agentset', description: 'Named settings for this topic: model, permissions, preset in one switch' },
  { command: 'effort', description: 'Reasoning effort: /effort high' },
  { command: 'permissions', description: 'Profile permissions: sandbox and approval preset' },
  { command: 'preset', description: 'Agent preset (persona and tools): /preset <id>' },
  { command: 'plan', description: 'Plan mode: state and how to ask for a plan without edits' },
  { command: 'jobs', description: 'What the bridge runs now: turns and queue' },
  { command: 'remind', description: 'Reminder: /remind +15m text or 09:30 text' },
  { command: 'thoughts', description: 'Reasoning of the last turn (text, file or off)' },
  { command: 'version', description: 'Bridge version and the latest on npm' },
  { command: 'update', description: 'Update the bridge from npm: /update confirm' },
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
  { command: 'tasks', description: '任务列表按钮：点击即完成' },
  { command: 'sessions', description: '本主题的会话 —— 直接发文字会延续最近一个' },
  { command: 'resume', description: '继续会话：/resume <id>' },
  { command: 'model', description: '查看或切换：/model, /model <id>' },
  { command: 'skills', description: '已安装的技能' },
  { command: 'soul', description: '代理人格设定' },
  { command: 'plugins', description: '列表与管理：add/remove/disable/enable' },
  { command: 'app', description: 'DSH 桌面应用（不是桥接）' },
  { command: 'restart', description: '重启桥接：/restart confirm' },
  { command: 'doctor', description: '诊断：桥接、网络、磁盘、插件、会话' },
  { command: 'logs', description: '日志：/logs、/logs 100、/logs errors、/logs file' },
  { command: 'help', description: '全部命令与提示' },
  { command: 'lang', description: '界面语言：en、ru、zh' },
  { command: 'reasoning', description: '工作记录：/reasoning on|off' },
  { command: 'profile', description: '话题配置档：/profile <名称>，/profile new' },
  { command: 'agents', description: '智能体与子智能体：谁在运行、用什么模型、启动过谁' },
  { command: 'agentset', description: '本话题的命名设置：模型、权限、预设一键切换' },
  { command: 'effort', description: '推理力度：/effort high' },
  { command: 'permissions', description: '配置档权限：沙箱与确认预设' },
  { command: 'preset', description: '智能体预设（人格与工具）：/preset <id>' },
  { command: 'plan', description: '计划模式：状态与如何只要计划不改动' },
  { command: 'jobs', description: '桥接器当前在跑：轮次与队列' },
  { command: 'remind', description: '提醒：/remind +15m 文本 或 09:30 文本' },
  { command: 'thoughts', description: '本轮推理：文本、文件或关闭' },
  { command: 'version', description: '桥接版本与 npm 上的最新版本' },
  { command: 'update', description: '从 npm 更新桥接：/update confirm' },
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
