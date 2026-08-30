import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseAdbDevices, selectA56 } from './android-device.mjs';

const base = 'https://hanksleekorea-boop.github.io/all-young-scanner-web/?device_check=v032#home';
const output = execFileSync('adb', ['devices', '-l'], { encoding: 'utf8' });
const device = selectA56(parseAdbDevices(output));
console.error(`[a56-runner] 지정 기기 한 대 선택: ${device.model || 'A56'} (${device.serial})`);

try {
  execFileSync('adb', ['-s', device.serial, 'forward', 'tcp:9223', 'localabstract:chrome_devtools_remote'], { stdio: 'inherit' });
  execFileSync('adb', ['-s', device.serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', base, 'com.android.chrome'], { stdio: 'inherit' });
  await new Promise((resolveWait) => setTimeout(resolveWait, 1800));
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, 'verify-a56-live.mjs')], {
    stdio: 'inherit',
    env: { ...process.env, AYS_A56_CDP_PORT: '9223' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  try { execFileSync('adb', ['-s', device.serial, 'forward', '--remove', 'tcp:9223'], { stdio: 'ignore' }); } catch {}
}
