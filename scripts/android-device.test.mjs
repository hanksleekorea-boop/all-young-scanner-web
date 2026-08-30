import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAdbDevices, selectA56 } from './android-device.mjs';

test('두 폰 중 승인된 A56 한 대만 선택한다', () => {
  const devices = parseAdbDevices('List of devices attached\nR3 device product:o1 model:SM-G996N device:o1\nA5 device product:a56x model:SM-A5660 device:a56x\n');
  assert.equal(selectA56(devices).serial, 'A5');
});

test('미승인 A56이나 다른 폰만 있으면 다른 폰을 대신 조작하지 않는다', () => {
  const devices = parseAdbDevices('List of devices attached\nA5 unauthorized product:a56x model:SM-A5660\nR3 device product:o1 model:SM-G996N\n');
  assert.throws(() => selectA56(devices), /A56/);
});

test('A56 두 대가 있으면 임의 선택하지 않는다', () => {
  const devices = parseAdbDevices('List of devices attached\nA1 device model:SM-A5660\nA2 device model:SM-A566B\n');
  assert.throws(() => selectA56(devices), /2대/);
});
