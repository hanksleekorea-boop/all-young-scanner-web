import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirectories = new Set(['.git', 'node_modules', 'scripts']);

async function htmlFiles(directory = root) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await htmlFiles(target));
    else if (entry.name.endsWith('.html')) result.push(target);
  }
  return result;
}

const attributes = (html) => [...html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)].map((match) => match[1]);
const external = (value) => /^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(value);

function localTarget(file, value) {
  const clean = value.split('#')[0].split('?')[0];
  if (!clean) return file;
  const relative = clean.startsWith('/all-young-scanner-web/') ? clean.slice('/all-young-scanner-web/'.length) : clean;
  const candidate = path.resolve(clean.startsWith('/') ? root : path.dirname(file), relative || '.');
  if (!candidate.startsWith(root)) throw new Error(`공개 루트 밖 링크: ${path.relative(root, file)} -> ${value}`);
  return candidate;
}

test('모든 공개 HTML의 내부 링크와 파일 참조가 실제 대상에 연결된다', async () => {
  const failures = [];
  for (const file of await htmlFiles()) {
    const html = await readFile(file, 'utf8');
    for (const value of attributes(html)) {
      if (external(value)) continue;
      let target;
      try { target = localTarget(file, value); } catch (error) { failures.push(error.message); continue; }
      try {
        const info = await stat(target);
        if (info.isDirectory()) await stat(path.join(target, 'index.html'));
      } catch { failures.push(`${path.relative(root, file)} -> ${value}`); }
    }
  }
  assert.deepEqual(failures, []);
});

test('새 창 외부 링크는 opener 권한을 차단한다', async () => {
  const failures = [];
  for (const file of await htmlFiles()) {
    const html = await readFile(file, 'utf8');
    for (const tag of html.match(/<a\b[^>]*target=["']_blank["'][^>]*>/gi) || []) {
      if (!/rel=["'][^"']*noopener[^"']*["']/i.test(tag)) failures.push(path.relative(root, file));
    }
  }
  assert.deepEqual(failures, []);
});
