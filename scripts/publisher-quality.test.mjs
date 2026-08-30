import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');
const strip = (html) => html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('한국어 홈과 영문 정보판은 충분한 고유 설명과 독립성 고지를 가진다', async () => {
  const [home, english] = await Promise.all([read('index.html'), read('en/index.html')]);
  assert.ok(strip(home).length > 1800);
  assert.ok(strip(english).length > 2800);
  assert.match(home, /특정 판매처가 운영·후원·보증하는 공식 서비스가 아닙니다/);
  assert.match(english, /not operated, sponsored, or endorsed by Olive Young or another retailer/);
  assert.match(english, /human language review/);
});

test('검색 정보와 구조화 데이터는 한국어·영문·24개 상세 페이지에 완결된다', async () => {
  const [home, guideIndex, english, content] = await Promise.all([read('index.html'), read('guides/index.html'), read('en/index.html'), read('content/usage-guides.json').then(JSON.parse)]);
  assert.match(home, /application\/ld\+json/);
  assert.match(home, /hreflang="en"/);
  assert.match(guideIndex, /"@type":"CollectionPage"/);
  assert.match(english, /"@type":"FAQPage"/);
  for (const guide of content.guides) {
    const page = await read(`guides/${guide.slug}/index.html`);
    assert.match(page, /"@type":"Article"/);
    assert.match(page, /"@type":"BreadcrumbList"/);
    assert.equal((page.match(/<div class="related">[\s\S]*?<\/div>/g) || []).length, 1);
    assert.ok((page.match(/<a href="\.\.\/[^"]+\/">/g) || []).length >= 3);
  }
});

test('광고 심사 전 모든 콘텐츠 광고 위치는 하나 이하이고 외부 실행 코드는 0이다', async () => {
  const content = JSON.parse(await read('content/usage-guides.json'));
  for (const file of ['index.html', 'guides/index.html', 'en/index.html', ...content.guides.map((guide) => `guides/${guide.slug}/index.html`)]) {
    const html = await read(file);
    assert.ok((html.match(/data-ad-slot=/g) || []).length <= 1, `${file}: 광고 위치 과다`);
    assert.equal((html.match(/<script\s+[^>]*src=["']https?:/gi) || []).length, 0, `${file}: 승인 전 외부 실행 코드`);
  }
});

test('핵심 화면과 실행 파일은 초기 전송 예산 안에 있다', async () => {
  const sizes = {};
  for (const file of ['index.html', 'en/index.html', 'guides/index.html', 'assets/free-advanced-app.mjs', 'assets/ad-loader.mjs']) sizes[file] = (await stat(path.join(root, file))).size;
  assert.ok(sizes['index.html'] < 45_000);
  assert.ok(sizes['en/index.html'] < 30_000);
  assert.ok(sizes['guides/index.html'] < 35_000);
  assert.ok(sizes['assets/free-advanced-app.mjs'] < 50_000);
  assert.ok(sizes['assets/ad-loader.mjs'] < 15_000);
});

test('예약 실행은 제거되어 사용자 취소 지시를 유지한다', async () => {
  const workflow = await read('.github/workflows/verify-public.yml');
  assert.doesNotMatch(workflow, /^\s*schedule:/m);
  assert.doesNotMatch(workflow, /cron:/);
});
