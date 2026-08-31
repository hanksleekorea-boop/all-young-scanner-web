import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildProductComparison, emptyCatalogState, makeCatalogBackup, normalizeCatalogState, parseCatalogBackup, queueLookup, searchCatalog, upsertProductCheckin } from '../assets/catalog-v4.mjs';

const catalog = JSON.parse(await readFile(new URL('../content/catalog-v4.json', import.meta.url), 'utf8'));
const ingredients = JSON.parse(await readFile(new URL('../content/ingredients-v4.json', import.meta.url), 'utf8'));

test('공개 원장은 실제 상품 2,000개와 대기 성분명 1,000개를 정확히 분리한다', () => {
  assert.equal(catalog.products.length, 2000); assert.equal(new Set(catalog.products.map((row) => row.gtin)).size, 2000);
  assert.equal(catalog.counts.human_reviewed_products, 0); assert.equal(ingredients.ingredients.length, 1000); assert.equal(ingredients.human_editorial_complete, false);
  for (const row of catalog.products) { assert.match(row.gtin, /^\d{8,14}$/); assert.equal(row.rights_state, 'approved_open_database'); assert.equal(row.editorial_status, 'pending_human_review'); assert.equal(row.image_url, null); assert.equal(row.price, null); assert.match(row.source_url, /^https:\/\/world\.openbeautyfacts\.org\/product\//); assert.equal(row.formulation_versions.length, 1); assert.match(row.formulation_versions[0].ingredient_fingerprint_sha256, /^[a-f0-9]{64}$/); }
});

test('검색은 GTIN 완전 일치와 한국 연관 상품을 우선하고 비공개 합성을 만들지 않는다', () => {
  const exact = searchCatalog(catalog.products, catalog.products[120].gtin); assert.equal(exact[0].id, catalog.products[120].id);
  const defaultRows = searchCatalog(catalog.products); assert.ok(defaultRows.length <= 30); assert.ok(defaultRows.some((row) => row.k_beauty_relevance !== 'global_beauty_context'));
  assert.equal(searchCatalog(catalog.products, '존재하지않는상품').length, 0);
});

test('비교는 최대 세 개의 사실·주의·출처만 제공한다', () => {
  const result = buildProductComparison(catalog.products.slice(0, 4)); assert.equal(result.products.length, 3); assert.match(result.notice, /의료 판단/);
  assert.ok(result.products.every((row) => row.caveats.includes('사람 편집 검수 대기') && row.source_url));
});

test('오프라인 대기는 중복·과다·위험 식별값을 제한한다', () => {
  const ids = catalog.products.map((row) => row.id); let state = emptyCatalogState();
  state = queueLookup(state, { kind: 'gtin', value: '8801234567890' }, ids, '2026-08-31T00:00:00.000Z');
  state = queueLookup(state, { kind: 'gtin', value: '8801234567890' }, ids, '2026-08-31T00:00:00.000Z'); assert.equal(state.pending_lookups.length, 1);
  assert.throws(() => queueLookup(state, { kind: 'secret', value: 'x' }, ids), /LOOKUP_INVALID/);
  const normalized = normalizeCatalogState({ selected: [...ids.slice(0, 4), '__proto__'], routine_products: ids.slice(0, 25) }, ids); assert.equal(normalized.selected.length, 3); assert.equal(normalized.routine_products.length, 20);
});

test('제품 사용·반응·개봉·만료·비용 기록은 같은 날짜를 갱신하고 백업 왕복한다', () => {
  const ids = catalog.products.map((row) => row.id); let state = { ...emptyCatalogState(), routine_products: ids.slice(0, 2) };
  state = upsertProductCheckin(state, { product_id: ids[0], date: '2026-08-31', used: 'used', comfort: 4, discomfort: false, opened_on: '2026-08-01', expires_on: '2027-08-01', amount: '한 펌프', cost: 21000 }, ids);
  state = upsertProductCheckin(state, { product_id: ids[0], date: '2026-08-31', used: 'stopped', comfort: 2, discomfort: true, cost: 21000 }, ids);
  assert.equal(state.product_checkins.length, 1); assert.equal(state.product_checkins[0].used, 'stopped');
  const restored = parseCatalogBackup(makeCatalogBackup(state, ids, '2026-08-31T00:00:00.000Z'), ids); assert.deepEqual(restored, normalizeCatalogState(state, ids));
  assert.throws(() => parseCatalogBackup('{"service_id":"wrong"}', ids), /CATALOG_BACKUP_INVALID/);
});
