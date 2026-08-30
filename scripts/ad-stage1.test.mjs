import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canActivateAdvertising, inferPageKind, sanitizeAdContext, validateAdvertisingConfig } from '../assets/ad-policy.mjs';
import { readPrivacyChoice, savePrivacyChoice } from '../assets/consent-gate.mjs';

const config = JSON.parse(readFileSync(new URL('../advertising-config.json', import.meta.url), 'utf8'));
const memory = () => { const map = new Map(); return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) }; };

test('공개 기본 설정은 광고를 끄고 확인된 게시자만 기록한다', () => {
  assert.equal(config.enabled, false);
  assert.equal(config.publisher_id, 'ca-pub-2476023536699107');
  assert.equal(config.certified_cmp_ready, false);
  assert.equal(config.operator_identity_confirmed, false);
});

test('비활성 설정은 어떤 동의가 있어도 광고를 차단한다', () => {
  const result = canActivateAdvertising({ config, pageKind: 'home', slotName: 'home-context', consent: { mode: 'contextual', cmp: 'certified' } });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'ADS_DISABLED');
});

test('켜진 설정은 확인된 게시자 외에 CMP·운영자 신원을 요구한다', () => {
  const enabled = { ...config, enabled: true };
  assert.deepEqual(validateAdvertisingConfig(enabled).errors, ['CMP_NOT_READY', 'OPERATOR_IDENTITY_NOT_CONFIRMED']);
});

test('광고 활성화는 유효한 게시자·슬롯·문맥형 동의·CMP 신호가 모두 필요하다', () => {
  const ready = { ...config, enabled: true, publisher_id: 'ca-pub-1234567890123456', certified_cmp_ready: true, operator_identity_confirmed: true, slots: { ...config.slots, 'home-context': '1234567890' } };
  assert.deepEqual(canActivateAdvertising({ config: ready, pageKind: 'home', slotName: 'home-context', consent: { mode: 'contextual', cmp: 'certified' } }), { allowed: true, reason: 'READY', slotId: '1234567890' });
  assert.equal(canActivateAdvertising({ config: ready, pageKind: 'home', slotName: 'home-context', consent: { mode: 'off', cmp: 'certified' } }).reason, 'CONSENT_NOT_GRANTED');
  assert.equal(canActivateAdvertising({ config: ready, pageKind: 'home', slotName: 'home-context', consent: { mode: 'contextual', cmp: 'missing' } }).reason, 'CMP_SIGNAL_MISSING');
});

test('민감 정보는 광고 문맥에서 전부 제거한다', () => {
  const output = sanitizeAdContext({ language: 'ko', page_kind: 'home', placement_id: 'home-context', skin_condition: 'sensitive', search_query: 'secret', email: 'person@example.com', routine: 'private' });
  assert.deepEqual(output, { language: 'ko', page_kind: 'home', placement_id: 'home-context' });
});

test('광고 금지 화면은 경로와 해시에서 구분한다', () => {
  assert.equal(inferPageKind('/all-young-scanner-web/', '#records'), 'records');
  assert.equal(inferPageKind('/all-young-scanner-web/privacy.html'), 'privacy');
  assert.equal(inferPageKind('/all-young-scanner-web/guides/'), 'guide-index');
  assert.equal(inferPageKind('/all-young-scanner-web/guides/sample/'), 'guide-detail');
});

test('개인정보 선택은 기본 off이고 허용된 두 값만 저장한다', () => {
  const storage = memory();
  assert.equal(readPrivacyChoice(storage).mode, 'off');
  const saved = savePrivacyChoice('contextual', storage);
  assert.equal(saved.mode, 'contextual');
  assert.equal(readPrivacyChoice(storage).mode, 'contextual');
  assert.throws(() => savePrivacyChoice('personalized', storage), /PRIVACY_CHOICE_INVALID/);
});

test('정책·쿠키·광고 선택 문서는 현재 비활성과 금지 데이터를 명시한다', () => {
  const advertising = readFileSync(new URL('../advertising.html', import.meta.url), 'utf8');
  const privacy = readFileSync(new URL('../privacy.html', import.meta.url), 'utf8');
  const cookies = readFileSync(new URL('../cookies.html', import.meta.url), 'utf8');
  assert.match(advertising, /현재 상태: 외부 광고·제휴 링크 꺼짐/);
  assert.match(advertising, /검색어 원문/);
  assert.match(privacy, /광고 네트워크로 정보를 보내지 않습니다/);
  assert.match(cookies, /외부 광고는 꺼져 있습니다/);
});
