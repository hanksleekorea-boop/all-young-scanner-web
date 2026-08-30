import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSafetyInsights, normalizeState, saveRoutinePreset, summarizeCheckins, upsertCollection } from '../assets/free-advanced-app.mjs';

const content = JSON.parse(readFileSync(new URL('../content/usage-guides.json', import.meta.url), 'utf8'));
const slugs = content.guides.map((guide) => guide.slug);
const times = ['morning', 'evening']; const contexts = ['normal', 'humid', 'dry', 'workout', 'travel']; const paces = ['minimal', 'balanced'];

test('가상 사용자 1,000명의 서로 다른 기록량·루틴·모음에서 자료가 깨지지 않는다', () => {
  for (let index = 0; index < 1000; index += 1) {
    const routine = { time: times[index % 2], context: contexts[index % 5], pace: paces[Math.floor(index / 5) % 2], guide_slugs: slugs.slice(index % 20, (index % 20) + 4) };
    const checkins = Array.from({ length: index % 91 }, (_, day) => {
      const date = new Date('2026-08-30T00:00:00Z'); date.setUTCDate(date.getUTCDate() - day);
      return { date: date.toISOString().slice(0, 10), completed: (index + day) % 3 !== 0, comfort: ((index + day) % 5) + 1, irritation: (index + day) % 11 === 0 };
    });
    let state = normalizeState({ saved_guides: slugs.slice(0, index % 25), routine, checkins }, slugs, '2026-08-30');
    state = saveRoutinePreset(state, { id: `persona-${index}`, name: `사용자 ${index} 루틴` }, slugs, '2026-08-30');
    state = upsertCollection(state, { id: `collection-${index}`, name: `사용자 ${index} 모음`, guide_slugs: state.saved_guides }, slugs);
    const summary = summarizeCheckins(state.checkins, index % 2 ? 30 : 90, '2026-08-30');
    const insights = buildSafetyInsights(summary);
    assert.ok(state.saved_guides.length <= 24); assert.ok(state.checkins.length <= 90); assert.equal(state.plus.routines.length, 1); assert.equal(state.plus.collections.length, 1);
    assert.ok(summary.total <= (index % 2 ? 30 : 90)); assert.ok(summary.completion_rate >= 0 && summary.completion_rate <= 100); assert.ok(insights.length >= 1);
  }
});
