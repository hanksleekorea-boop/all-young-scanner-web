import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SERVICE_ID, emptyState, filterGuides, makeBackup, normalizeState,
  normalizeText, parseBackup, selectRoutineSlugs, upsertCheckin,
} from '../assets/free-advanced-app.mjs';

const content = JSON.parse(readFileSync(new URL('../content/usage-guides.json', import.meta.url), 'utf8'));
const guides = content.guides;
const slugs = guides.map((guide) => guide.slug);

test('24개 실제 가이드만 루틴 후보로 사용한다', () => {
  assert.equal(guides.length, 24);
  const result = selectRoutineSlugs({ time: 'morning', context: 'humid', pace: 'minimal' }, slugs);
  assert.deepEqual(result, ['morning-three-step-start', 'routine-hot-humid-day', 'simplify-too-many-products', 'how-to-use-sunscreen-stick']);
  assert.ok(result.every((slug) => slugs.includes(slug)));
});

test('저녁·여행·균형 루틴은 중복 없이 최대 4개다', () => {
  const result = selectRoutineSlugs({ time: 'evening', context: 'travel', pace: 'balanced' }, slugs);
  assert.deepEqual(result, ['evening-minimal-routine', 'minimal-travel-routine', 'add-one-product-at-a-time']);
  assert.equal(new Set(result).size, result.length);
});

test('누락 입력과 존재하지 않는 가이드를 안전하게 처리한다', () => {
  assert.throws(() => selectRoutineSlugs({ time: 'morning', context: 'normal' }, slugs), /ROUTINE_INPUT_INVALID/);
  assert.deepEqual(selectRoutineSlugs({ time: 'morning', context: 'normal', pace: 'minimal' }, ['morning-three-step-start']), ['morning-three-step-start']);
});

test('검색은 한글 공백을 정규화하고 분류와 함께 적용한다', () => {
  assert.equal(normalizeText('  선크림   사용법 '), '선크림 사용법');
  assert.equal(filterGuides(guides, '선크림').length, 1);
  assert.equal(filterGuides(guides, '', 'minimal-routine').length, 4);
  assert.equal(filterGuides(guides, '없는 검색어').length, 0);
});

test('저장 상태는 중복·없는 주소·잘못된 점검을 제거한다', () => {
  const state = normalizeState({
    saved_guides: [slugs[0], slugs[0], 'missing'],
    routine: { time: 'morning', context: 'normal', pace: 'minimal', guide_slugs: [slugs[0], 'missing'] },
    checkins: [
      { date: '2026-08-28', completed: true, comfort: 4, irritation: false },
      { date: '2099-01-01', completed: true, comfort: 4, irritation: false },
      { date: '2026-08-27', completed: true, comfort: 7, irritation: false },
    ],
  }, slugs, '2026-08-29');
  assert.deepEqual(state.saved_guides, [slugs[0]]);
  assert.deepEqual(state.routine.guide_slugs, [slugs[0]]);
  assert.equal(state.checkins.length, 1);
});

test('같은 날짜 점검은 하나로 갱신하고 90개만 유지한다', () => {
  let state = emptyState();
  state = upsertCheckin(state, { date: '2026-08-29', completed: true, comfort: 3, irritation: false }, slugs, '2026-08-29');
  state = upsertCheckin(state, { date: '2026-08-29', completed: false, comfort: 4, irritation: true }, slugs, '2026-08-29');
  assert.equal(state.checkins.length, 1);
  assert.deepEqual(state.checkins[0], { date: '2026-08-29', completed: false, comfort: 4, irritation: true });
});

test('백업은 미리보기 뒤 같은 자료를 복원한다', () => {
  const state = normalizeState({ saved_guides: slugs.slice(0, 3), routine: { time: 'evening', context: 'normal', pace: 'balanced', guide_slugs: slugs.slice(0, 2) }, checkins: [{ date: '2026-08-29', completed: true, comfort: 5, irritation: false }] }, slugs, '2026-08-29');
  const text = makeBackup(state, slugs, '2026-08-29T00:00:00.000Z');
  const restored = parseBackup(text, slugs, '2026-08-29');
  assert.equal(JSON.parse(text).service_id, SERVICE_ID);
  assert.deepEqual(restored.preview, { saved_guides: 3, checkins: 1, has_routine: true });
  assert.deepEqual(restored.data, state);
});

test('다른 서비스·깨진 JSON·위험 키·과대 파일을 거부한다', () => {
  assert.throws(() => parseBackup('{}', slugs), /BACKUP_CONTRACT_INVALID/);
  assert.throws(() => parseBackup('{bad', slugs), /BACKUP_JSON_INVALID/);
  assert.throws(() => parseBackup(`{"service_id":"${SERVICE_ID}","schema_version":1,"data":{"__proto__":{}}}`, slugs), /BACKUP_KEY_INVALID/);
  assert.throws(() => parseBackup('x'.repeat(256 * 1024 + 1), slugs), /BACKUP_SIZE_INVALID/);
});
