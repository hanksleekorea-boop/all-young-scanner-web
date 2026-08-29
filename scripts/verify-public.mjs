import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const required = [
  'index.html', 'progress.html', 'offline.html', 'privacy.html', 'terms.html', 'support.html', '.well-known/security.txt', '.nojekyll',
  'manifest.webmanifest', 'icon.svg', 'icon-192.svg', 'icon-512.svg', 'sw.js', 'robots.txt', 'sitemap.xml',
  'readiness.json', 'free-advanced-readiness.json', 'stage2-readiness.json', 'catalog-governance.json', 'evidence-v028.json',
  'guides/index.html', 'content/usage-guides.json', 'assets/free-advanced-app.mjs', 'assets/free-advanced-bootstrap.mjs',
];
required.forEach((path) => assert(existsSync(resolve(root, path)), `필수 파일 없음: ${path}`));

const html = read('index.html');
const app = read('assets/free-advanced-app.mjs');
const bootstrap = read('assets/free-advanced-bootstrap.mjs');
const sw = read('sw.js');
const manifest = JSON.parse(read('manifest.webmanifest'));
const readiness = JSON.parse(read('readiness.json'));
const free = JSON.parse(read(readiness.free_advanced.status_file));
const evidence = JSON.parse(read(readiness.evidence_file));
const content = JSON.parse(read('content/usage-guides.json'));
const guideIndex = read('guides/index.html');
const progress = read('progress.html');
const privacy = read('privacy.html');
const terms = read('terms.html');
const support = read('support.html');
const sitemap = read('sitemap.xml');

assert(html.includes('<link rel="manifest" href="manifest.webmanifest">') && html.includes('free-advanced-bootstrap.mjs'), '무료 고급 앱 또는 PWA 연결 누락');
assert((html.match(/data-view="(?:home|routine|guides|records)"/g) || []).length === 4, '모바일·PC 4개 핵심 화면 누락');
assert(['name="time"', 'name="context"', 'name="pace"', 'id="guide-search"', 'id="checkin-form"', 'id="export-records"', 'id="confirm-import"', 'id="open-delete"'].every((token) => html.includes(token)), '루틴·검색·점검·백업·삭제 경로 누락');
assert(html.includes('무료 · 로그인 없이 · 기기 안 저장') && html.includes('독립 정보 서비스'), '무료·기기 저장·독립 서비스 약속 누락');
assert(!/테스트 상품|테스트 자료|개발 진척|LAUNCH CHECK|95 \/ 100|올영스캐너 알파/.test(html), '소비자 화면에 개발·시험 문구가 노출됨');
assert(!html.includes('Google로 로그인') && !html.includes('account-login') && !html.includes('supabase'), '제공하지 않는 계정 기능이 소비자 화면에 남아 있음');
assert(!/<script\s+[^>]*src=["']https?:/i.test(html) && !/<link\s+[^>]*href=["']https?:[^>]*stylesheet/i.test(html), '외부 실행 코드 또는 글꼴 연결이 남아 있음');
assert(!app.includes('.innerHTML') && app.includes('textContent') && app.includes('MAX_BACKUP_BYTES') && app.includes('BACKUP_KEY_INVALID'), '안전 DOM 출력 또는 백업 검증 누락');
assert(['selectRoutineSlugs', 'filterGuides', 'upsertCheckin', 'makeBackup', 'parseBackup'].every((name) => app.includes(`function ${name}`)), '무료 고급 핵심 함수 누락');
assert(bootstrap.includes('serviceWorker.register') && bootstrap.includes('mountFreeAdvancedApp'), '앱 시작 또는 서비스 워커 등록 누락');
assert(manifest.lang === 'ko-KR' && manifest.scope === './' && manifest.start_url === './#home' && manifest.shortcuts.length === 3, '무료 고급 PWA 정보 불일치');
assert(sw.includes("const RELEASE_VERSION = '2026-08-29-service-v0.28'") && readiness.release_id === '2026-08-29-service-v0.28', '공개 판번호 불일치');
assert(required.filter((path) => !['robots.txt', 'sitemap.xml', '.nojekyll', 'sw.js'].includes(path)).every((path) => sw.includes(`'./${path}'`) || ['progress.html'].includes(path)), '오프라인 핵심 파일 누락');
assert(sw.includes('key.startsWith(CACHE_PREFIX)') && sw.includes('if (!allowed.includes(requested.href) && !isGuidePage) return'), '다른 앱·API 임시 저장 보호 누락');
assert(content.counts.guides === 24 && content.counts.sources === 7 && content.guides.every((guide) => guide.steps.length > 0 && guide.source_refs.length > 0), '완결 콘텐츠 수 또는 출처 연결 오류');
assert((guideIndex.match(/class="guide-card"/g) || []).length === 24 && (sitemap.match(/<url>/g) || []).length === 29, '가이드 목록 또는 사이트맵 수 불일치');
assert(free.code.total === 16 && free.code.verified === 16 && free.code.live === 16 && free.code.percent === 100 && free.code.cards.every((card) => card.status === 'LIVE'), '무료 고급 코드 16/16 공개 상태 오류');
assert(free.operations.total === 4 && free.operations.done === 0 && free.operations.cards.every((card) => card.status === 'BLOCKED_EXTERNAL'), '외부 운영 증거를 자동 완료함');
assert(readiness.free_advanced.code_verified === free.code.verified && readiness.free_advanced.code_live === free.code.live && readiness.free_advanced.code_percent === free.code.percent, '전체 진척과 무료 고급 현황 대조 실패');
assert(evidence.release_id === readiness.release_id && evidence.automatic.free_advanced_unit_tests === 8 && evidence.automatic.account_required === false, '현재판 자동 증거 불일치');
assert(evidence.server.pages === 'success' && evidence.server.codeql === 'success' && evidence.server.public_verify === 'success' && evidence.server.public_http === 'pass_10_paths', '현재판 공개 증거 불일치');
assert(privacy.includes('계정 로그인·분석 추적·서버 기록 저장을 제공하지 않으며') && privacy.includes('이름·이메일·전화번호·생년월일·자유서술은 받지 않습니다'), '현재 개인정보 처리 상태 누락');
assert(terms.includes('광고, 후원, 제휴 수수료가 있는 구매 링크가 없습니다') && terms.includes('제품 추천·실시간 가격·평점·인기 순위를 제공하지 않습니다'), '현재 무료판 수익·상품 경계 누락');
assert(support.includes('이 기기 기록 전체 삭제') && support.includes('다른 기기로 기록 옮기기'), '삭제·이동 안내 누락');
assert(progress.includes('고급 무료 1.0 코드') && progress.includes('운영 상용화 증거') && progress.includes('실기기'), '코드와 운영 증거 분리 대시보드 누락');
assert(progress.includes('noindex,nofollow') && !sitemap.includes('progress.html'), '운영 대시보드 검색 제외 실패');

console.log(`[public-verify] PASS — 필수 ${required.length}파일, 무료 고급 코드 16/16 공개, 콘텐츠 24·출처 7, 외부 운영 0/4 분리`);
