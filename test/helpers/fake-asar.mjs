// A synthetic asar: the pickled header this reader parses, then the file bytes.
// Written by hand so the test does not need Electron to prove the offset math.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

/** One entry, `path` -> `text`, in the layout Electron's asar uses. */
export function fakeAsar(file, entries) {
  const files = {};
  const chunks = [];
  let offset = 0;
  for (const [path, text] of Object.entries(entries)) {
    const body = Buffer.from(text, 'utf8');
    const parts = path.split('/');
    let node = files;
    for (const part of parts.slice(0, -1)) {
      node[part] ||= { files: {} };
      node = node[part].files;
    }
    node[parts[parts.length - 1]] = { size: body.length, offset: String(offset) };
    chunks.push(body);
    offset += body.length;
  }
  const json = Buffer.from(JSON.stringify({ files }), 'utf8');
  // [uint32 4][uint32 headerSize] then the pickled header: [uint32 0][uint32 jsonSize][json][padding]
  const pad = (4 - ((json.length + 8) % 4)) % 4;
  const headerSize = 8 + json.length + pad;
  const head = Buffer.alloc(8);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(headerSize, 4);
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(json.length, 4);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.concat([head, jsonHead, json, Buffer.alloc(pad), ...chunks]));
  return file;
}

/** A throwaway app install whose asar carries `version` as the bundled DSH. */
export function fakeApp(version) {
  const root = join(mkdtempSync(join(tmpdir(), 'dsh-app-')), 'DeepSeek Harness');
  const exe = join(root, 'DeepSeek Harness.exe');
  mkdirSync(root, { recursive: true });
  writeFileSync(exe, '', 'utf8');
  fakeAsar(join(root, 'resources', 'app.asar'), {
    'dsh/node_modules/@deepseek-ai/dsh/package.json': JSON.stringify({ name: '@deepseek-ai/dsh', version }),
    'main.js': 'console.log(1)',
  });
  return exe;
}