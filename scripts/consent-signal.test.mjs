import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAdvertisingConsent } from '../assets/consent-gate.mjs';

const contextualStorage = { getItem: () => JSON.stringify({ mode: 'contextual', updated_at: '2026-08-30T00:00:00.000Z' }) };
const offStorage = { getItem: () => JSON.stringify({ mode: 'off', updated_at: null }) };
const clearApis = () => { delete globalThis.__tcfapi; delete globalThis.__gpp; };

test.afterEach(clearApis);

test('사용자가 광고를 끄면 CMP API를 부르지 않고 닫힌다', async () => {
  let calls = 0;
  globalThis.__tcfapi = () => { calls += 1; };
  globalThis.__gpp = () => { calls += 1; };
  const result = await resolveAdvertisingConsent(offStorage);
  assert.equal(result.mode, 'off');
  assert.equal(result.cmp, 'not_required');
  assert.equal(calls, 0);
});

test('게시된 CMP가 유효한 TCF와 GPP 신호를 주면 문맥형 후보로 정규화한다', async () => {
  globalThis.__tcfapi = (_command, _version, callback) => callback({ cmpStatus: 'loaded', tcString: 'TCF_SAMPLE' }, true);
  globalThis.__gpp = (_command, callback) => callback({ gppString: 'GPP_SAMPLE', optOut: false }, true);
  const result = await resolveAdvertisingConsent(contextualStorage);
  assert.deepEqual(result, { mode: 'contextual', cmp: 'certified', tcf: 'certified', tc_string: true, gpp: 'valid', opt_out: false });
});

test('미국 주 거부 신호는 유효해도 opt-out 상태를 보존한다', async () => {
  globalThis.__tcfapi = (_command, _version, callback) => callback({ cmpStatus: 'loaded', tcString: 'TCF_SAMPLE' }, true);
  globalThis.__gpp = (_command, callback) => callback({ gppString: 'GPP_SAMPLE', optOut: true }, true);
  const result = await resolveAdvertisingConsent(contextualStorage);
  assert.equal(result.gpp, 'valid');
  assert.equal(result.opt_out, true);
});

test('CMP API가 없거나 잘못된 신호를 주면 실패 시 닫힌다', async () => {
  const missing = await resolveAdvertisingConsent(contextualStorage);
  assert.equal(missing.cmp, 'missing');
  assert.equal(missing.gpp, 'missing');
  globalThis.__tcfapi = (_command, _version, callback) => callback({ cmpStatus: 'error', tcString: '' }, false);
  globalThis.__gpp = (_command, callback) => callback({ gppString: '', optOut: null }, true);
  const invalid = await resolveAdvertisingConsent(contextualStorage);
  assert.equal(invalid.cmp, 'invalid');
  assert.equal(invalid.gpp, 'invalid');
});
