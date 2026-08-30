import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  chooseLimitedRollout, createRollbackFingerprint, enforceFrequencyCaps, evaluateAdvancedStopLoss, evaluateTrafficQuality,
  parseAdsTxt, pruneAggregateRows, sanitizeAggregateRow, scoreMonetizationCandidate, selectDirectCampaign, selectMonetizationCandidate,
  validateStageThreeConfig, validateSupplyChain,
} from '../assets/ad-optimizer.mjs';

const base = JSON.parse(readFileSync(new URL('../advertising-config.json', import.meta.url), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));
function ready(mode = 'shadow-only') {
  const config = clone(base);
  const stage = config.stage_three;
  stage.enabled = true; stage.mode = mode; stage.activation = Object.fromEntries(Object.keys(stage.activation).map((key) => [key, true]));
  stage.governance = { signed_config: true, required_approvals: 2, approved_by: ['privacy-owner', 'revenue-owner'], rollback_fingerprint: 'fnv1a-12345678' };
  const entry = { ad_system_domain: 'ads.example', seller_account_id: 'seller-1', relationship: 'DIRECT', verified: true, publisher_domain: 'publisher.example' };
  stage.supply_chain = { owner_domain: 'publisher.example', ads_txt_entries: [entry], sellers_json_entries: [entry], schain_nodes: [entry], schain_complete: true, verified: true };
  return config;
}

test('공개 3단계는 그림자 계산·실제 송출 중단·이중 승인 미확정 상태다', () => {
  assert.equal(base.schema_version, 3);
  assert.equal(base.stage_three.enabled, false);
  assert.equal(base.stage_three.mode, 'shadow-only');
  assert.equal(base.stage_three.optimization.enabled, false);
  assert.deepEqual(base.stage_three.governance.approved_by, []);
  assert.equal(validateStageThreeConfig(base).valid, true);
});

test('생방송 비율·비교군·표본·빈도·부정 트래픽 안전 한도를 강제한다', () => {
  const config = clone(base); const stage = config.stage_three;
  stage.optimization.max_live_allocation_percent = 6; stage.optimization.holdout_percent = 9; stage.optimization.min_sample_size = 999;
  stage.frequency_caps.max_impressions_per_session = 4; stage.traffic_quality.automation_block = false;
  assert.deepEqual(validateStageThreeConfig(config).errors, ['LIVE_ALLOCATION_MAX_5', 'HOLDOUT_MIN_10', 'MIN_SAMPLE_1000', 'FREQUENCY_CAP_TOO_HIGH', 'INVALID_TRAFFIC_GATES_REQUIRED']);
});

test('ads.txt 1.1 핵심 지시어와 판매자 행을 안전하게 읽는다', () => {
  const parsed = parseAdsTxt('OWNERDOMAIN=publisher.example\nads.example, seller-1, DIRECT, cert-1\n');
  assert.equal(parsed.valid, true); assert.equal(parsed.directives.OWNERDOMAIN, 'publisher.example'); assert.equal(parsed.entries[0].relationship, 'DIRECT');
});

test('잘못된 ads.txt 판매자·중복 지시어를 거부한다', () => {
  const parsed = parseAdsTxt('OWNERDOMAIN=publisher.example\nOWNERDOMAIN=other.example\nnot-domain, , UNKNOWN\n');
  assert.equal(parsed.valid, false); assert.equal(parsed.errors.length, 2);
});

test('ads.txt·sellers.json·공급 경로가 어긋나면 공급망을 닫는다', () => {
  const entry = { ad_system_domain: 'ads.example', seller_account_id: 'seller-1', relationship: 'DIRECT', verified: true };
  const result = validateSupplyChain({ owner_domain: 'publisher.example', ads_txt_entries: [entry], sellers_json_entries: [], schain_nodes: [], verified: true });
  assert.equal(result.valid, false); assert.ok(result.errors.some((error) => error.startsWith('SELLERS_JSON_MISMATCH'))); assert.ok(result.errors.some((error) => error.startsWith('SCHAIN_MISMATCH')));
});

test('세 공급망 기록과 운영 확인이 일치할 때만 통과한다', () => {
  assert.equal(validateStageThreeConfig(ready()).valid, true);
});

test('자동·시험 트래픽을 광고 후보에서 제외한다', () => {
  const policy = base.stage_three.traffic_quality;
  assert.deepEqual(evaluateTrafficQuality({ automation: true }, policy).reasons, ['AUTOMATION_TRAFFIC']);
  assert.deepEqual(evaluateTrafficQuality({ test_traffic: true }, policy).reasons, ['TEST_TRAFFIC']);
});

test('잘못된 사건 순서·반복 폭주·짧은 표시를 차단한다', () => {
  const result = evaluateTrafficQuality({ event: 'impression', event_sequence_valid: false, repeat_burst: 8, visible_ms: 20 }, base.stage_three.traffic_quality);
  assert.deepEqual(result.reasons, ['EVENT_SEQUENCE_INVALID', 'REPEAT_BURST', 'VIEWABILITY_TOO_SHORT']);
});

test('세션·위치·최소 간격 빈도 한도를 각각 지킨다', () => {
  const caps = base.stage_three.frequency_caps;
  assert.equal(enforceFrequencyCaps({ total_impressions: 3, placement_impressions: 0, minutes_since_last_impression: 20 }, caps).reason, 'SESSION_FREQUENCY_CAP');
  assert.equal(enforceFrequencyCaps({ total_impressions: 0, placement_impressions: 1, minutes_since_last_impression: 20 }, caps).reason, 'PLACEMENT_FREQUENCY_CAP');
  assert.equal(enforceFrequencyCaps({ total_impressions: 0, placement_impressions: 0, minutes_since_last_impression: 2 }, caps).reason, 'MINIMUM_INTERVAL');
});

test('직접 캠페인은 계약·승인·기간·지역·위치·예산을 모두 요구한다', () => {
  const campaigns = [
    { id: 'good', enabled: true, approved: true, contract_verified: true, start_day: '2026-08-01', end_day: '2026-08-31', regions: ['KR'], placements: ['home-context'], formats: ['responsive-display'], daily_impression_cap: 100, daily_spend_cap_micros: 100000, priority: 10, expected_cpm_micros: 5000 },
    { id: 'unapproved', enabled: true, approved: false, contract_verified: true, start_day: '2026-08-01', end_day: '2026-08-31', regions: ['KR'], placements: ['home-context'], formats: ['responsive-display'], daily_impression_cap: 100, daily_spend_cap_micros: 100000, priority: 99, expected_cpm_micros: 9000 },
  ];
  assert.equal(selectDirectCampaign({ campaigns, context: { day: '2026-08-30', region_group: 'KR', placement_id: 'home-context', format: 'responsive-display' }, delivery: {} }).id, 'good');
  assert.equal(selectDirectCampaign({ campaigns, context: { day: '2026-09-01', region_group: 'KR', placement_id: 'home-context', format: 'responsive-display' }, delivery: {} }), null);
});

test('예상 수익은 표시 가능성·채움·오류·속도·정책 위험을 함께 반영한다', () => {
  const candidate = { expected_cpm_micros: 10000 };
  assert.equal(scoreMonetizationCandidate(candidate, { viewability_rate: 1, fill_rate: 1, error_rate: 0, latency_ms: 0, policy_violations: 0 }), 10000);
  assert.equal(scoreMonetizationCandidate(candidate, { viewability_rate: 1, fill_rate: 1, error_rate: 0, latency_ms: 0, policy_violations: 1 }), 0);
});

test('제한 공개는 같은 씨앗에 같은 결과를 주고 후보 비율은 최대 5%다', () => {
  const rows = Array.from({ length: 10000 }, (_, index) => chooseLimitedRollout({ seed: `seed-${index}`, allocation_percent: 5, holdout_percent: 10 }));
  assert.equal(chooseLimitedRollout({ seed: 'same', allocation_percent: 5, holdout_percent: 10 }), chooseLimitedRollout({ seed: 'same', allocation_percent: 5, holdout_percent: 10 }));
  assert.ok(rows.filter((row) => row === 'candidate').length <= 550);
  assert.ok(rows.filter((row) => row === 'holdout').length >= 900);
});

test('그림자 계산은 최적 후보를 고르되 실제 송출하지 않는다', () => {
  const result = selectMonetizationCandidate({ config: ready(), context: {}, traffic: {}, session: { minutes_since_last_impression: 20 }, programmatic: [
    { id: 'slow', approved: true, contract_verified: true, expected_cpm_micros: 2000 },
    { id: 'best', approved: true, contract_verified: true, expected_cpm_micros: 4000 },
  ], seed: 'a' });
  assert.equal(result.reason, 'SHADOW_DECISION'); assert.equal(result.candidate.id, 'best'); assert.equal(result.serve, false);
});

test('제한 공개도 최대 5% 비교군에서만 실제 송출 결정을 낸다', () => {
  const config = ready('limited-live'); config.stage_three.optimization.enabled = true;
  const missingSeed = selectMonetizationCandidate({ config, context: {}, traffic: {}, session: { minutes_since_last_impression: 20 }, programmatic: [{ id: 'p', approved: true, contract_verified: true, expected_cpm_micros: 3000 }] });
  assert.equal(missingSeed.reason, 'ROLLOUT_SEED_REQUIRED'); assert.equal(missingSeed.serve, false);
  const results = Array.from({ length: 10000 }, (_, index) => selectMonetizationCandidate({ config, context: {}, traffic: {}, session: { minutes_since_last_impression: 20 }, programmatic: [{ id: 'p', approved: true, contract_verified: true, expected_cpm_micros: 3000 }], seed: `live-${index}` }));
  assert.ok(results.filter((result) => result.serve).length <= 550);
  assert.ok(results.every((result) => result.allowed));
});

test('부정 트래픽·불만·수익·핵심 과업·공급망·정책 악화는 즉시 중단한다', () => {
  const result = evaluateAdvancedStopLoss({ invalid_traffic_rate: 0.02, user_complaint_rate: 0.01, revenue_drop_rate: 0.2, core_journey_success_rate: 0.9, supply_chain_mismatches: 1, policy_violations: 1 }, base.stage_three.stop_loss);
  assert.equal(result.stop, true); assert.equal(result.reasons.length, 6);
});

test('집계 자료는 허용값·30일·500행만 남기고 되돌리기 지문은 순서와 무관하다', () => {
  assert.deepEqual(sanitizeAggregateRow({ provider_id: 'p', day: '2026-08-30', requests: 3, email: 'hidden@example.com', search_query: 'hidden' }), { provider_id: 'p', day: '2026-08-30', requests: 3 });
  const rows = Array.from({ length: 550 }, (_, index) => ({ day: index < 10 ? '2026-07-01' : '2026-08-30', requests: 1, email: 'hidden@example.com' }));
  const pruned = pruneAggregateRows(rows, { now_day: '2026-08-30', max_days: 30, max_rows: 500 });
  assert.equal(pruned.length, 500); assert.ok(pruned.every((row) => !('email' in row) && row.day === '2026-08-30'));
  assert.equal(createRollbackFingerprint({ b: 2, a: 1 }), createRollbackFingerprint({ a: 1, b: 2 }));
});
