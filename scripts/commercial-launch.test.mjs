import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateCommercialLaunch, makeAdvertisingActivation } from './commercial-launch-lib.mjs';

const blank = JSON.parse(readFileSync(new URL('../commercial-launch-evidence.template.json', import.meta.url), 'utf8'));
const proof = (name) => `https://evidence.example/${name}`;
const complete = () => ({
  schema_version: 1,
  release_id: '2026-08-30-service-v0.32',
  operator: { legal_name: 'Example Operator', public_contact: 'support@example.com', privacy_contact: 'privacy@example.com', verified_at: '2026-08-30', evidence_url: proof('operator') },
  editorial: { approved_guides: 24, reviewer: 'editor', approved_at: '2026-08-30', evidence_url: proof('editorial') },
  android: { release_id: '2026-08-30-service-v0.32', device_model: 'A56', journeys_passed: 3, completed_at: '2026-08-30', evidence_url: proof('android') },
  ios: { release_id: '2026-08-30-service-v0.32', device_model: 'iPhone', journeys_passed: 3, completed_at: '2026-08-30', evidence_url: proof('ios') },
  users: { consenting_users: 5, core_task_success_percent: 90, critical_defects: 0, brand_confusion_cases: 0, completed_at: '2026-08-30', evidence_url: proof('users') },
  site: { hostname: 'example.com', operator_controlled: true, html_editable: true, https_verified: true, adsense_registered: true, verified_at: '2026-08-30', evidence_url: proof('site') },
  adsense: { account_approved: true, site_approved: true, publisher_id: 'ca-pub-1234567890123456', slot_ids: { 'home-context': '123456', 'guide-index-context': '234567', 'guide-detail-context': '345678' }, approved_at: '2026-08-30', evidence_url: proof('adsense') },
  cmp: { google_certified: true, platform_name: 'Certified CMP', tcf_verified: true, gpp_verified: true, verified_at: '2026-08-30', evidence_url: proof('cmp') },
  ads_txt: { root_url: 'https://example.com/ads.txt', authorized_seller_rows: 1, publisher_match: true, verified_at: '2026-08-30', evidence_url: proof('ads-txt') },
  policy_review: { privacy_reviewer: 'privacy owner', advertising_reviewer: 'ad owner', completed_at: '2026-08-30', evidence_url: proof('policy') },
  approvers: { names: ['privacy owner', 'revenue owner'], approved_at: '2026-08-30', evidence_url: proof('approvers') },
  limited_rollout: { country_group: 'KR', provider: 'google-adsense', placement: 'home-context', allocation_percent: 5, sample_size: 1000, policy_violations: 0, critical_defects: 0, completed_at: '2026-08-30', evidence_url: proof('rollout') }
});

test('빈 양식은 12개 외부 조건을 하나도 완료하지 않는다', () => {
  const result = evaluateCommercialLaunch(blank);
  assert.equal(result.structural_valid, true);
  assert.equal(result.passed, 0);
  assert.equal(result.complete, false);
});

test('12개 실제 증거가 모두 있을 때만 광고 활성화 묶음을 만든다', () => {
  const input = complete();
  const result = evaluateCommercialLaunch(input);
  assert.equal(result.passed, 12);
  assert.equal(result.complete, true);
  assert.deepEqual(makeAdvertisingActivation(input).slots, input.adsense.slot_ids);
});

test('등록되지 않은 웹사이트와 한 명 중복 승인은 상용화 증거가 아니다', () => {
  const input = complete();
  input.site.hostname = 'unverified.github.io';
  input.site.adsense_registered = false;
  input.approvers.names = ['same person', 'same person'];
  const result = evaluateCommercialLaunch(input);
  assert.equal(result.gates.find((gate) => gate.id === 'site').passed, false);
  assert.equal(result.gates.find((gate) => gate.id === 'approvers').passed, false);
});

test('미완료 증거로 광고 설정을 만들 수 없다', () => {
  assert.throws(() => makeAdvertisingActivation(blank), /COMMERCIAL_LAUNCH_INCOMPLETE:0\/12/);
});

test('비밀값 모양 필드는 구조 단계에서 거부한다', () => {
  const input = complete();
  input.client_secret = 'must-never-be-here';
  const result = evaluateCommercialLaunch(input);
  assert.equal(result.structural_valid, false);
  assert.match(result.structural_failures.join('\n'), /secret-looking key/);
});
