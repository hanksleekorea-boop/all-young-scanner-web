import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectProvider } from '../assets/ad-router.mjs';

const base = JSON.parse(readFileSync(new URL('../advertising-config.json', import.meta.url), 'utf8'));
const regions = ['UNKNOWN', 'EEA_UK_CH', 'US_STATE', 'KR', 'JP', 'ROW'];
const sources = ['untrusted', 'language', 'certified-cmp', 'operator-server'];
const placements = ['home-context', 'guide-index-context', 'guide-detail-context', 'unknown'];

test('지역·동의·기기·화면이 다른 1,000명은 공개 기본 설정에서 외부 제공자를 한 번도 선택하지 않는다', () => {
  let selected = 0;
  for (let index = 0; index < 1000; index += 1) {
    const consent = { mode: index % 3 ? 'contextual' : 'off', tcf: index % 5 ? 'missing' : 'certified', tc_string: index % 10 === 0, gpp: index % 7 ? 'missing' : 'valid', opt_out: index % 14 === 0 ? false : null };
    const result = selectProvider({ config: base, regionGroup: regions[index % regions.length], regionSource: sources[index % sources.length], consent, placementId: placements[index % placements.length] });
    if (result.allowed) selected += 1;
  }
  assert.equal(selected, 0);
});

test('모의 활성화 1,000건도 신뢰 지역·지역 신호·허용 화면·제공자 상태를 모두 요구한다', () => {
  let allowed = 0; let expected = 0;
  for (let index = 0; index < 1000; index += 1) {
    const config = structuredClone(base); const region = regions[index % regions.length]; const source = sources[index % sources.length]; const placementId = placements[index % placements.length];
    config.enabled = true; config.publisher_id = 'ca-pub-1234567890123456'; config.certified_cmp_ready = true; config.operator_identity_confirmed = true; config.stage_two.enabled = true;
    if (region !== 'UNKNOWN') { config.stage_two.regional_policies[region].operator_reviewed = true; config.stage_two.regional_policies[region].ads_allowed = true; }
    const google = config.stage_two.providers.find((provider) => provider.id === 'google-adsense'); google.enabled = true; google.supported_regions = region === 'UNKNOWN' ? [] : [region]; google.expected_cpm_micros = 1000;
    const consent = region === 'EEA_UK_CH' ? { mode: 'contextual', tcf: 'certified', tc_string: true } : region === 'US_STATE' ? { mode: 'contextual', gpp: 'valid', opt_out: false } : { mode: 'contextual' };
    const result = selectProvider({ config, regionGroup: region, regionSource: source, consent, placementId });
    const shouldAllow = region !== 'UNKNOWN' && ['certified-cmp', 'operator-server'].includes(source) && placementId !== 'unknown';
    if (result.allowed) allowed += 1;
    if (shouldAllow) expected += 1;
    assert.equal(result.allowed, shouldAllow);
  }
  assert.equal(allowed, expected); assert.ok(allowed > 0);
});
