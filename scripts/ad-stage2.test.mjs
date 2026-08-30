import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chooseExperimentVariant, evaluateStopLoss, sanitizeMetricEvent, selectProvider, validateStageTwoConfig } from '../assets/ad-router.mjs';
import { clearAdMetrics, readAdMetrics, recordAdMetric, summarizeAdMetrics } from '../assets/ad-metrics.mjs';

const base = JSON.parse(readFileSync(new URL('../advertising-config.json', import.meta.url), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));
const memory = () => { const map = new Map(); return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key) }; };
function ready(region = 'KR') {
  const config = clone(base);
  config.enabled = true;
  config.publisher_id = 'ca-pub-1234567890123456';
  config.certified_cmp_ready = true;
  config.operator_identity_confirmed = true;
  config.slots = { 'home-context': '1234567890', 'guide-index-context': '1234567891', 'guide-detail-context': '1234567892' };
  config.stage_two.enabled = true;
  config.stage_two.regional_policies[region].operator_reviewed = true;
  config.stage_two.regional_policies[region].ads_allowed = true;
  const google = config.stage_two.providers.find((provider) => provider.id === 'google-adsense');
  google.enabled = true; google.supported_regions = [region]; google.expected_cpm_micros = 2500;
  return config;
}

test('공개 2단계 설정은 실패 시 닫힘·지역 미확인 차단·외부 제공자 비활성이다', () => {
  assert.equal(base.stage_two.enabled, false);
  assert.equal(base.stage_two.fail_closed, true);
  assert.equal(base.stage_two.regional_policies.UNKNOWN.ads_allowed, false);
  assert.equal(base.stage_two.providers.filter((provider) => provider.external && provider.enabled).length, 0);
  assert.equal(validateStageTwoConfig(base).valid, true);
});

test('한 슬롯 한 제공자·재시도 0·제한 시간은 필수다', () => {
  const config = clone(base); config.stage_two.request_budget.providers_per_slot = 2; config.stage_two.request_budget.retries = 1; config.stage_two.request_budget.timeout_ms = 10;
  assert.deepEqual(validateStageTwoConfig(config).errors, ['ONE_PROVIDER_PER_SLOT_REQUIRED', 'RETRIES_MUST_BE_ZERO', 'TIMEOUT_BUDGET_INVALID']);
});

test('지역 출처가 신뢰되지 않거나 지역이 미확인이면 닫힌다', () => {
  const config = ready('KR');
  assert.equal(selectProvider({ config, regionGroup: 'KR', regionSource: 'language', consent: { mode: 'contextual' }, placementId: 'home-context' }).reason, 'REGION_SOURCE_UNTRUSTED');
  assert.equal(selectProvider({ config, regionGroup: 'UNKNOWN', regionSource: 'operator-server', consent: { mode: 'contextual' }, placementId: 'home-context' }).reason, 'REGION_UNRESOLVED');
});

test('EEA·영국·스위스는 인증 TCF 문자열 없이는 선택하지 않는다', () => {
  const config = ready('EEA_UK_CH');
  assert.equal(selectProvider({ config, regionGroup: 'EEA_UK_CH', regionSource: 'certified-cmp', consent: { mode: 'contextual', tcf: 'missing', tc_string: false }, placementId: 'home-context' }).reason, 'TCF_SIGNAL_REQUIRED');
  assert.equal(selectProvider({ config, regionGroup: 'EEA_UK_CH', regionSource: 'certified-cmp', consent: { mode: 'contextual', tcf: 'certified', tc_string: true }, placementId: 'home-context' }).provider.id, 'google-adsense');
});

test('미국 주 단위 정책은 유효 GPP와 명시적 미거부가 모두 필요하다', () => {
  const config = ready('US_STATE');
  assert.equal(selectProvider({ config, regionGroup: 'US_STATE', regionSource: 'certified-cmp', consent: { mode: 'contextual', gpp: 'valid', opt_out: true }, placementId: 'home-context' }).reason, 'GPP_SIGNAL_REQUIRED');
  assert.equal(selectProvider({ config, regionGroup: 'US_STATE', regionSource: 'certified-cmp', consent: { mode: 'contextual', gpp: 'valid', opt_out: false }, placementId: 'home-context' }).provider.id, 'google-adsense');
});

test('한국·일본·기타 지역은 문맥형 선택이 없으면 닫힌다', () => {
  for (const region of ['KR', 'JP', 'ROW']) {
    const config = ready(region);
    assert.equal(selectProvider({ config, regionGroup: region, regionSource: 'operator-server', consent: { mode: 'off' }, placementId: 'home-context' }).reason, 'CONTEXTUAL_CHOICE_REQUIRED');
    assert.equal(selectProvider({ config, regionGroup: region, regionSource: 'operator-server', consent: { mode: 'contextual' }, placementId: 'home-context' }).allowed, true);
  }
});

test('형식·지역·최저 단가·상태 회로를 모두 통과한 제공자만 선택한다', () => {
  const config = ready('KR');
  config.stage_two.placements['home-context'].floor_cpm_micros = 3000;
  assert.equal(selectProvider({ config, regionGroup: 'KR', regionSource: 'operator-server', consent: { mode: 'contextual' }, placementId: 'home-context' }).reason, 'NO_APPROVED_PROVIDER');
  config.stage_two.placements['home-context'].floor_cpm_micros = 2000;
  assert.equal(selectProvider({ config, regionGroup: 'KR', regionSource: 'operator-server', consent: { mode: 'contextual' }, placementId: 'home-context', health: { 'google-adsense': { circuit: 'open' } } }).reason, 'NO_APPROVED_PROVIDER');
});

test('계약 전 제공자와 임의 어댑터는 활성화할 수 없다', () => {
  const config = clone(base); const media = config.stage_two.providers.find((provider) => provider.id === 'media-net'); media.enabled = true;
  assert.match(validateStageTwoConfig(config).errors[0], /ADAPTER_NOT_BUNDLED/);
});

test('오류·시간초과·레이아웃·속도·정책 한도를 넘으면 자동 중단한다', () => {
  const limits = { ...base.stage_two.stop_loss, ...base.stage_two.performance_budget };
  assert.equal(evaluateStopLoss({ error_rate: 0.01, timeout_rate: 0.01, cls_delta: 0.01, lcp_delta_ms: 100, policy_violations: 0 }, limits).stop, false);
  assert.deepEqual(evaluateStopLoss({ error_rate: 0.04, timeout_rate: 0.06, cls_delta: 0.06, lcp_delta_ms: 301, policy_violations: 1 }, limits).reasons, ['ERROR_RATE', 'TIMEOUT_RATE', 'CLS_DELTA', 'LCP_DELTA', 'POLICY_VIOLATION']);
});

test('실험은 기본 중단이고 같은 임시 세션에서 같은 결과를 낸다', () => {
  assert.equal(chooseExperimentVariant({ experiment: base.stage_two.experiments, sessionSeed: 'a' }), 'control');
  const experiment = { id: 'placement-density', enabled: true, kill_switch: false, allocation_percent: 50 };
  assert.equal(chooseExperimentVariant({ experiment, sessionSeed: 'same' }), chooseExperimentVariant({ experiment, sessionSeed: 'same' }));
  assert.equal(chooseExperimentVariant({ experiment: { ...experiment, kill_switch: true }, sessionSeed: 'same' }), 'control');
});

test('성과 사건은 허용 필드만 남기고 민감 문맥을 제거한다', () => {
  assert.deepEqual(sanitizeMetricEvent({ event: 'request', placement_id: 'home-context', provider_id: 'google-adsense', latency_ms: 42, search_query: 'private', skin_condition: 'private', email: 'private@example.com' }), { event: 'request', placement_id: 'home-context', provider_id: 'google-adsense', latency_ms: 42 });
});

test('기기 안 성과 기록은 200건 제한·요약·전체 삭제가 된다', () => {
  const storage = memory();
  for (let index = 0; index < 220; index += 1) recordAdMetric({ event: index % 4 === 0 ? 'impression' : 'request', placement_id: 'home-context', provider_id: 'house', latency_ms: index, viewable: index % 8 === 0 }, storage);
  const events = readAdMetrics(storage); assert.equal(events.length, 200);
  const summary = summarizeAdMetrics(events); assert.ok(summary.requests > 0 && summary.impressions > 0 && summary.average_latency_ms > 0);
  clearAdMetrics(storage); assert.equal(readAdMetrics(storage).length, 0);
});
