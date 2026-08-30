import { spawn } from 'node:child_process';

const root = new URL('../', import.meta.url);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function previewReady() {
  try {
    const response = await fetch('http://127.0.0.1:4179/', { signal: AbortSignal.timeout(500) });
    return response.ok;
  } catch { return false; }
}

async function waitForPreview() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await previewReady()) return;
    await wait(100);
  }
  throw new Error('LAYOUT_PREVIEW_NOT_READY');
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`LAYOUT_PROCESS_FAILED:${code ?? signal}`)));
  });
}

let preview;
try {
  if (!(await previewReady())) {
    preview = spawn(process.execPath, ['scripts/serve-preview.mjs'], { cwd: root, stdio: 'ignore' });
    await waitForPreview();
  }
  await run(process.execPath, ['scripts/verify-layout.mjs']);
} finally {
  if (preview?.exitCode === null) {
    preview.kill();
    await Promise.race([new Promise((resolve) => preview.once('exit', resolve)), wait(2000)]);
  }
}
