import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const content = JSON.parse(await readFile(path.join(root, 'content', 'usage-guides.json'), 'utf8'));
const guideIndex = await readFile(path.join(root, 'guides', 'index.html'), 'utf8');
const sitemap = await readFile(path.join(root, 'sitemap.xml'), 'utf8');

test('공개 콘텐츠 묶음은 24개 가이드와 7개 이상 출처를 가진다', () => {
  assert.equal(content.guides.length, 24);
  assert.ok(content.sources.length >= 7);
  assert.deepEqual(content.counts, { guides: 24, sources: content.sources.length });
});

test('가이드 slug와 필수 본문은 모두 완결되어 있다', () => {
  const slugs = new Set(content.guides.map((guide) => guide.slug));
  assert.equal(slugs.size, 24);
  for (const guide of content.guides) {
    assert.ok(guide.title && guide.summary && guide.body?.one_line && guide.body?.safety_note);
    assert.equal(guide.body.not_medical_advice, true);
    assert.ok(guide.steps.length >= 2);
  }
});

test('모든 가이드의 출처가 실제 출처 목록과 연결된다', () => {
  const sourceIds = new Set(content.sources.map((source) => source.id));
  for (const guide of content.guides) {
    assert.ok(guide.source_refs.length > 0);
    assert.ok(guide.source_refs.every((id) => sourceIds.has(id)));
  }
});

test('가이드 목록은 검색과 24개 상세 링크를 제공한다', () => {
  assert.match(guideIndex, /id="guide-search"/);
  assert.equal((guideIndex.match(/class="guide-card"/g) || []).length, 24);
  for (const guide of content.guides) assert.ok(guideIndex.includes(`./${guide.slug}/`));
  assert.match(guideIndex, /data-ad-slot="guide-index-context" data-ad-format-kind="multiplex"/);
});

test('각 상세 페이지에는 검색 메타데이터·검토일·안전 경계가 있다', async () => {
  for (const guide of content.guides) {
    const page = await readFile(path.join(root, 'guides', guide.slug, 'index.html'), 'utf8');
    assert.ok(page.includes(`<link rel="canonical" href="https://hanksleekorea-boop.github.io/all-young-scanner-web/guides/${guide.slug}/">`));
    assert.ok(page.includes('<meta name="description"'));
    assert.ok(page.includes('최근 검토 2026-08-31'));
    assert.ok(page.includes('다음 검토 2027-02-26'));
    assert.ok(page.includes('의료 진단이나 치료'));
    assert.ok(page.includes('data-ad-slot="guide-detail-context" data-ad-format-kind="in-article"'));
    assert.ok(page.includes('data-page-kind="guide-detail"'));
    assert.ok(page.includes('함께 읽기'));
    assert.ok(page.includes('application/ld+json'));
  }
});

test('사이트맵은 앱·영문·정책·가이드 목록·24개 상세 페이지를 모두 포함한다', () => {
  assert.equal((sitemap.match(/<url>/g) || []).length, 35);
  assert.ok(sitemap.includes('/guides/'));
  assert.ok(sitemap.includes('/en/'));
  for (const page of ['about.html', 'cookies.html', 'advertising.html', 'privacy-choices.html', 'catalog-license.html']) assert.ok(sitemap.includes(`/${page}`));
  for (const guide of content.guides) assert.ok(sitemap.includes(`/guides/${guide.slug}/`));
});
