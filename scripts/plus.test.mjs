import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildPrintReport, buildSafetyInsights, compareRoutines, decryptBackup, emptyState, encryptBackup,
  filterGuides, makeBackup, makeCalendarIcs, normalizeState, parseBackup, removeCollection,
  removeRoutinePreset, saveRoutinePreset, summarizeCheckins, upsertCollection,
} from '../assets/free-advanced-app.mjs';

const content = JSON.parse(readFileSync(new URL('../content/usage-guides.json', import.meta.url), 'utf8'));
const guides = content.guides; const slugs = guides.map((guide) => guide.slug);
const routine = { time: 'morning', context: 'dry', pace: 'minimal', guide_slugs: slugs.slice(0, 3) };

test('이전 무료판 자료는 Plus 빈 자료와 함께 그대로 열린다', () => {
  const state = normalizeState({ saved_guides: slugs.slice(0, 2), routine, checkins: [] }, slugs, '2026-08-30');
  assert.deepEqual(state.plus, { routines: [], collections: [], settings: { insight_window: 30 } });
  assert.deepEqual(state.saved_guides, slugs.slice(0, 2));
});

test('이름 붙인 루틴을 저장·갱신·삭제한다', () => {
  let state = normalizeState({ ...emptyState(), routine }, slugs, '2026-08-30');
  state = saveRoutinePreset(state, { id: 'weekday-am', name: ' 평일   아침 ' }, slugs, '2026-08-30');
  assert.equal(state.plus.routines[0].name, '평일 아침');
  state = saveRoutinePreset(state, { id: 'weekday-am', name: '새 아침' }, slugs, '2026-08-30');
  assert.equal(state.plus.routines.length, 1); assert.equal(state.plus.routines[0].name, '새 아침');
  assert.equal(removeRoutinePreset(state, 'weekday-am', slugs).plus.routines.length, 0);
});

test('저장 루틴은 최대 10개이며 없는 현재 루틴은 거부한다', () => {
  let state = normalizeState({ ...emptyState(), routine }, slugs, '2026-08-30');
  for (let index = 0; index < 10; index += 1) state = saveRoutinePreset(state, { id: `r-${index}`, name: `루틴 ${index}` }, slugs, '2026-08-30');
  assert.equal(state.plus.routines.length, 10);
  assert.throws(() => saveRoutinePreset(state, { id: 'r-10', name: '초과' }, slugs, '2026-08-30'), /PLUS_ROUTINE_LIMIT/);
  assert.throws(() => saveRoutinePreset(emptyState(), { id: 'none', name: '없음' }, slugs), /PLUS_ROUTINE_INVALID/);
});

test('두 루틴의 공통·서로 다른 조건과 가이드를 정확히 비교한다', () => {
  const result = compareRoutines({ ...routine, guide_slugs: slugs.slice(0, 3) }, { ...routine, context: 'humid', guide_slugs: slugs.slice(1, 4) });
  assert.deepEqual(result.conditions, ['context']); assert.equal(result.shared.length, 2); assert.equal(result.only_left.length, 1); assert.equal(result.only_right.length, 1);
});

test('30일 통계는 기간 밖 기록을 제외하고 비율·평균을 계산한다', () => {
  const summary = summarizeCheckins([
    { date: '2026-08-30', completed: true, comfort: 5, irritation: false },
    { date: '2026-08-01', completed: false, comfort: 3, irritation: true },
    { date: '2026-07-31', completed: true, comfort: 1, irritation: true },
  ], 30, '2026-08-30');
  assert.deepEqual(summary, { days: 30, total: 2, completed: 1, completion_rate: 50, average_comfort: 4, irritation_count: 1 });
});

test('90일 통계와 기록 부족 안내를 제공한다', () => {
  const summary = summarizeCheckins([{ date: '2026-06-05', completed: true, comfort: 4, irritation: false }], 90, '2026-08-30');
  assert.equal(summary.total, 1); assert.match(buildSafetyInsights(summary)[0], /3회 이상/);
});

test('안전 요약은 불편 신호와 의료 비대체 문구를 포함한다', () => {
  const messages = buildSafetyInsights({ days: 30, total: 4, completed: 3, completion_rate: 75, average_comfort: 3.5, irritation_count: 1 });
  assert.ok(messages.some((message) => message.includes('불편 신호'))); assert.ok(messages.some((message) => message.includes('의료 판단이 아닙니다')));
});

test('생활 언어 별칭으로 가이드를 찾는다', () => {
  assert.ok(filterGuides(guides, '간단').length > 0); assert.ok(filterGuides(guides, '보습').length > 0); assert.ok(filterGuides(guides, '운동').length > 0);
});

test('가이드 모음을 저장·중복 제거·삭제하고 최대 5개만 허용한다', () => {
  let state = normalizeState({ ...emptyState(), saved_guides: slugs.slice(0, 4) }, slugs);
  for (let index = 0; index < 5; index += 1) state = upsertCollection(state, { id: `c-${index}`, name: `모음 ${index}`, guide_slugs: [slugs[0], slugs[0], slugs[1]] }, slugs);
  assert.equal(state.plus.collections.length, 5); assert.deepEqual(state.plus.collections[0].guide_slugs, slugs.slice(0, 2));
  assert.throws(() => upsertCollection(state, { id: 'c-5', name: '초과', guide_slugs: [] }, slugs), /PLUS_COLLECTION_LIMIT/);
  assert.equal(removeCollection(state, 'c-0', slugs).plus.collections.length, 4);
});

test('일정 파일은 반복 일정과 안전 문구를 포함하고 개인정보를 넣지 않는다', () => {
  const text = makeCalendarIcs({ ...routine, id: 'weekday-am', name: '평일 아침' }, '2026-08-30');
  assert.match(text, /BEGIN:VCALENDAR/); assert.match(text, /RRULE:FREQ=DAILY/); assert.match(text, /불편 신호/); assert.doesNotMatch(text, /email|전화|생년월일/i);
});

test('인쇄용 30일 보고서는 저장·통계·안전 경계를 함께 담는다', () => {
  const state = normalizeState({ ...emptyState(), saved_guides: slugs.slice(0, 2), routine, checkins: [{ date: '2026-08-30', completed: true, comfort: 4, irritation: false }] }, slugs, '2026-08-30');
  const report = buildPrintReport(state, slugs, '2026-08-30');
  assert.equal(report.saved_guides, 2); assert.equal(report.summary.total, 1); assert.match(report.medical_disclaimer, /의료 진단/);
});

test('일반 백업은 무료와 Plus 전체 자료를 함께 복원한다', () => {
  let state = normalizeState({ ...emptyState(), saved_guides: slugs.slice(0, 2), routine }, slugs, '2026-08-30');
  state = saveRoutinePreset(state, { id: 'backup-routine', name: '백업 루틴' }, slugs, '2026-08-30');
  state = upsertCollection(state, { id: 'backup-collection', name: '백업 모음', guide_slugs: slugs.slice(0, 2) }, slugs);
  const restored = parseBackup(makeBackup(state, slugs, '2026-08-30T00:00:00.000Z'), slugs, '2026-08-30').data;
  assert.deepEqual(restored, state);
});

test('8자 이상 암호로 전체 백업을 잠그고 같은 암호로만 복원한다', async () => {
  const plain = makeBackup(normalizeState({ ...emptyState(), routine }, slugs, '2026-08-30'), slugs, '2026-08-30T00:00:00.000Z');
  const encrypted = await encryptBackup(plain, 'safe-pass-123');
  assert.notEqual(encrypted.includes('morning-three-step-start'), true); assert.equal(await decryptBackup(encrypted, 'safe-pass-123'), plain);
  await assert.rejects(() => decryptBackup(encrypted, 'wrong-pass'), /ENCRYPTED_BACKUP_DECRYPT_FAILED/);
});

test('Plus 기능에는 결제·가격·구독 실행 경로가 없다', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../assets/free-advanced-app.mjs', import.meta.url), 'utf8');
  assert.match(html, /결제 없이 전체 공개/); assert.doesNotMatch(app, /stripe|checkout|paymentIntent|subscription/i); assert.doesNotMatch(html, /₩|월\s*\d|구매하기/);
});
