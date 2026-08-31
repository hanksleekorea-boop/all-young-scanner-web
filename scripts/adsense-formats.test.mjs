import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveAdSenseFormat, validatePlacementFormat } from '../assets/adsense-formats.mjs';

const root = new URL('../', import.meta.url);
const config = JSON.parse(await readFile(new URL('advertising-config.json', root), 'utf8'));

test('세 수동 위치가 서로 다른 허용 형식에 고정된다', () => {
  assert.equal(validatePlacementFormat({ placementId: 'home-context', declaredFormat: 'display-responsive', config }).format, 'display-responsive');
  assert.equal(validatePlacementFormat({ placementId: 'guide-index-context', declaredFormat: 'multiplex', config }).format, 'multiplex');
  assert.equal(validatePlacementFormat({ placementId: 'guide-detail-context', declaredFormat: 'in-article', config }).format, 'in-article');
});

test('AdSense 속성은 형식별 허용 목록만 반환한다', () => {
  assert.deepEqual(resolveAdSenseFormat('display-responsive').attributes, { 'data-ad-format': 'auto', 'data-full-width-responsive': 'true' });
  assert.deepEqual(resolveAdSenseFormat('multiplex').attributes, { 'data-ad-format': 'autorelaxed' });
  assert.deepEqual(resolveAdSenseFormat('in-article').attributes, { 'data-ad-layout': 'in-article', 'data-ad-format': 'fluid' });
});

test('알 수 없거나 HTML 선언과 다른 형식은 닫힌 상태로 거부한다', () => {
  assert.equal(resolveAdSenseFormat('native-custom').reason, 'AD_FORMAT_UNSUPPORTED');
  assert.equal(validatePlacementFormat({ placementId: 'home-context', declaredFormat: 'multiplex', config }).reason, 'AD_FORMAT_MISMATCH');
});

test('자동 광고는 민감 SPA 화면 보호와 계정 승인 전까지 꺼져 있다', () => {
  assert.equal(config.auto_ads.enabled, false);
  assert.equal(config.auto_ads.account_configuration_verified, false);
  for (const page of ['routine', 'records', 'plus', 'privacy', 'terms', 'privacy-choices']) assert.ok(config.auto_ads.page_exclusions.includes(page));
});

test('실제 광고는 승인·실제 광고 단위·지역 정책 검토 전까지 요청되지 않는다', () => {
  assert.equal(config.enabled, false);
  assert.equal(config.operator_identity_confirmed, false);
  assert.equal(config.stage_two.enabled, false);
  assert.equal(config.stage_two.providers.find((provider) => provider.id === 'google-adsense').enabled, false);
  assert.ok(Object.values(config.slots).every((slotId) => slotId === ''));
  assert.ok(Object.values(config.stage_two.regional_policies).every((policy) => policy.operator_reviewed === false && policy.ads_allowed === false));
});
