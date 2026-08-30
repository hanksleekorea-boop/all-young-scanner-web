import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canActivateAdvertising, sanitizeAdContext } from '../assets/ad-policy.mjs';

const config = JSON.parse(readFileSync(new URL('../advertising-config.json', import.meta.url), 'utf8'));
const pages = ['home', 'guide-index', 'guide-detail', 'routine', 'records', 'plus', 'privacy', 'terms', 'support', 'offline'];
const modes = ['off', 'contextual'];
const cmps = ['missing', 'timeout', 'certified', 'invalid'];
const regions = ['KR', 'EEA', 'US-CA', 'US-OTHER', 'OTHER'];
const devices = ['mobile', 'desktop'];

test('1,000명 광고 안전 시나리오는 기본 설정에서 외부 요청을 하나도 허용하지 않는다', () => {
  let checked = 0;
  for (let index = 0; index < 1000; index += 1) {
    const pageKind = pages[index % pages.length];
    const consent = { mode: modes[index % modes.length], cmp: cmps[index % cmps.length] };
    const slotName = pageKind === 'home' ? 'home-context' : pageKind === 'guide-index' ? 'guide-index-context' : 'guide-detail-context';
    const result = canActivateAdvertising({ config, pageKind, slotName, consent });
    assert.equal(result.allowed, false);
    const context = sanitizeAdContext({ language: index % 2 ? 'ko' : 'en', region_group: regions[index % regions.length], device_class: devices[index % devices.length], page_kind: pageKind, placement_id: slotName, search_query: `private-${index}`, skin_condition: 'private', routine: 'private' });
    assert.equal('search_query' in context, false);
    assert.equal('skin_condition' in context, false);
    assert.equal('routine' in context, false);
    checked += 1;
  }
  assert.equal(checked, 1000);
});

test('활성화 모의에서도 금지 화면 7종은 항상 차단된다', () => {
  const ready = { ...config, enabled: true, publisher_id: 'ca-pub-1234567890123456', certified_cmp_ready: true, operator_identity_confirmed: true, slots: { 'home-context': '1234567890', 'guide-index-context': '1234567891', 'guide-detail-context': '1234567892' } };
  for (const pageKind of config.forbidden_page_kinds) {
    const result = canActivateAdvertising({ config: ready, pageKind, slotName: 'home-context', consent: { mode: 'contextual', cmp: 'certified' } });
    assert.equal(result.reason, 'PAGE_FORBIDDEN');
  }
});
