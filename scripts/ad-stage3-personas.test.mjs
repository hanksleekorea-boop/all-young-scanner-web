import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectMonetizationCandidate } from '../assets/ad-optimizer.mjs';

const base = JSON.parse(readFileSync(new URL('../advertising-config.json', import.meta.url), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));
function liveReady() {
  const config = clone(base); const stage = config.stage_three;
  stage.enabled = true; stage.mode = 'limited-live'; stage.optimization.enabled = true;
  stage.activation = Object.fromEntries(Object.keys(stage.activation).map((key) => [key, true]));
  stage.governance = { signed_config: true, required_approvals: 2, approved_by: ['privacy-owner', 'revenue-owner'], rollback_fingerprint: 'fnv1a-12345678' };
  const entry = { ad_system_domain: 'ads.example', seller_account_id: 'seller-1', relationship: 'DIRECT', verified: true, publisher_domain: 'publisher.example' };
  stage.supply_chain = { owner_domain: 'publisher.example', ads_txt_entries: [entry], sellers_json_entries: [entry], schain_nodes: [entry], schain_complete: true, verified: true };
  return config;
}

test('10,000개 공개 기본 시나리오는 고급 최적화로 실제 광고를 하나도 보내지 않는다', () => {
  const served = Array.from({ length: 10000 }, (_, index) => selectMonetizationCandidate({ config: base, traffic: {}, session: { minutes_since_last_impression: 20 }, programmatic: [{ id: 'p', approved: true, contract_verified: true, expected_cpm_micros: 4000 }], seed: `default-${index}` })).filter((result) => result.serve);
  assert.equal(served.length, 0);
});

test('10,000개 모의 활성화도 안전 시나리오의 최대 5%만 제한 공개한다', () => {
  const config = liveReady(); let eligible = 0; let served = 0; let unsafeServed = 0;
  for (let index = 0; index < 10000; index += 1) {
    const unsafe = index % 7 === 0;
    const capped = index % 11 === 0;
    const result = selectMonetizationCandidate({
      config,
      traffic: unsafe ? { automation: true } : { event_sequence_valid: true },
      session: { total_impressions: capped ? 3 : 0, placement_impressions: 0, minutes_since_last_impression: 20 },
      programmatic: [{ id: 'approved', approved: true, contract_verified: true, expected_cpm_micros: 4000 }],
      seed: `ready-${index}`,
    });
    if (!unsafe && !capped) eligible += 1;
    if (result.serve) served += 1;
    if (result.serve && (unsafe || capped)) unsafeServed += 1;
  }
  assert.equal(unsafeServed, 0);
  assert.ok(served <= Math.ceil(eligible * 0.055));
  assert.ok(served > 0);
});
