import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = await mkdtemp(path.join(tmpdir(), 'ays-layout-'));
const child = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
child.unref();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function devtoolsPort() {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100; i += 1) {
    try { return Number((await readFile(file, 'utf8')).split(/\r?\n/)[0]); } catch { await wait(50); }
  }
  throw new Error('Edge 검사 포트를 열지 못했습니다.');
}

async function connectPage(port, url) {
  const target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' }).then((response) => response.json());
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    id += 1; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  return { socket, send };
}

async function ready(send) {
  for (let i = 0; i < 100; i += 1) {
    const result = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
    if (result.result.value === 'complete') return;
    await wait(50);
  }
  throw new Error('페이지 로딩 시간이 초과되었습니다.');
}

async function inspect(send, width, url) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: width < 700 ? 844 : 1000, deviceScaleFactor: 1, mobile: width < 700 });
  await send('Page.navigate', { url });
  await ready(send);
  const result = await send('Runtime.evaluate', {
    expression: `(() => ({
      title: document.title,
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      h1: document.querySelector('h1')?.textContent?.trim() || '',
      cards: document.querySelectorAll('.guide-card').length,
      internalCopy: /내부 검수|개발 진척|올영스캐너 알파/.test(document.body.innerText),
      clipped: [...document.querySelectorAll('a,button,input')].filter((node) => {
        const box=node.getBoundingClientRect(); const style=getComputedStyle(node);
        return style.display!=='none' && style.visibility!=='hidden' && box.width>0 && (box.left < -1 || box.right > innerWidth + 1);
      }).length
    }))()`,
    returnByValue: true,
  });
  const value = result.result.value;
  assert.ok(value.title && value.h1, `${url}: 제목 또는 H1 없음`);
  assert.equal(value.innerWidth, width, `${url}: 요청한 화면 폭 불일치`);
  assert.ok(value.scrollWidth <= width, `${url}: 가로 넘침 ${value.scrollWidth}/${width}`);
  assert.equal(value.clipped, 0, `${url}: 화면 밖 조작 요소 ${value.clipped}개`);
  assert.equal(value.internalCopy, false, `${url}: 내부 개발 문구 노출`);
  return value;
}

try {
  const port = await devtoolsPort();
  const { socket, send } = await connectPage(port, 'http://127.0.0.1:4179/guides/');
  await send('Page.enable'); await send('Runtime.enable');
  const results = [];
  for (const width of [360, 390, 1440]) results.push({ width, ...(await inspect(send, width, 'http://127.0.0.1:4179/guides/')) });
  for (const width of [360, 390, 1440]) results.push({ width, ...(await inspect(send, width, 'http://127.0.0.1:4179/guides/morning-three-step-start/')) });
  assert.ok(results.filter((row) => row.cards === 24).length === 3, '가이드 목록 24개가 모든 폭에서 유지되지 않음');
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 1000);
    socket.addEventListener('close', () => { clearTimeout(timeout); resolve(); }, { once: true });
    socket.close();
  });
  console.log(`[layout-verify] PASS — ${results.length}개 화면, 360·390·1440px, 가로 넘침·잘린 조작 요소·내부 문구 0`);
} finally {
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await Promise.race([exited, wait(3000)]);
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { await rm(profile, { recursive: true, force: true }); break; }
    catch { if (attempt < 4) await wait(200 * (attempt + 1)); }
  }
}
