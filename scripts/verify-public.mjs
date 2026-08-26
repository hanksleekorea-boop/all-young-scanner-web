import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const required = [
  'index.html', 'progress.html', 'offline.html', 'privacy.html', 'terms.html', 'support.html',
  'manifest.webmanifest', 'icon.svg', 'icon-192.svg', 'icon-512.svg', 'sw.js',
  'robots.txt', 'sitemap.xml', 'readiness.json', 'catalog-governance.json', 'evidence-v013.json',
  'assets/local-records.mjs', 'evidence-v015.json',
];

required.forEach((path) => assert(existsSync(resolve(root, path)), `필수 파일 없음: ${path}`));

const html = read('index.html');
const sw = read('sw.js');
const manifest = JSON.parse(read('manifest.webmanifest'));
const readiness = JSON.parse(read('readiness.json'));
const governance = JSON.parse(read('catalog-governance.json'));
const progress = read('progress.html');

assert(html.includes('<link rel="manifest" href="manifest.webmanifest">'), '정적 manifest 연결 없음');
assert(!html.includes('data:application/manifest+json'), 'data URL manifest가 남아 있음');
assert(/const MARKET_CONTEXTS = Object\.freeze\(\{\s*KR:\{/.test(html), '한국 출시 범위 없음');
assert(!/\n\s+(US|JP|TH|SG|AU|GB|DE|FR|CA):\{/.test(html), '지원하지 않는 국가가 선택 가능함');
assert(html.includes("'BarcodeDetector' in window") && html.includes('navigator.mediaDevices?.getUserMedia'), '실제 카메라 바코드 경로 누락');
assert(html.includes('숫자를 직접 입력해 주세요'), '카메라 미지원 대체 경로 누락');
assert(/\.mobile-service-actions \.entry\.primary \.entry-index,[\s\S]*?color: #fff; opacity: 1;/.test(html), '모바일 핵심 버튼 글자 대비 보호 규칙 누락');
assert(/\.mobile-curated,\.mobile-shopping-home,\.service-footer[\s\S]*?content-visibility: auto;/.test(html), '모바일 아래 영역 렌더링 지연 규칙 누락');
assert(/\.pc-home-v2 > \.service-concerns,[\s\S]*?contain-intrinsic-size: auto 520px;/.test(html), 'PC 아래 영역 렌더링 지연 규칙 누락');
assert(['privacy.html', 'terms.html', 'support.html'].every((path) => html.includes(`href="${path}"`)), '법적·지원 링크 누락');
assert(manifest.lang === 'ko-KR' && manifest.scope === './' && manifest.icons.length >= 2, 'PWA manifest 계약 실패');
assert(sw.includes(`const RELEASE_VERSION = '${readiness.release_id}'`) && html.includes(`const RELEASE_VERSION = '${readiness.release_id}'`), '서비스 워커 판 불일치');
assert(required.filter((path) => !['robots.txt', 'sitemap.xml', 'og-service-v2.svg', 'scripts/verify-public.mjs'].includes(path)).every((path) => sw.includes(`'./${path}'`) || ['sw.js'].includes(path)), '오프라인 핵심 파일 누락');
assert(governance.commercial_catalog_connected === false && governance.public_real_product_count === 0, '실상품 연결 상태가 거짓임');
assert(governance.synthetic_products.public_as_real_product === false, '합성 자료가 실상품으로 공개됨');
assert(readiness.stage_one.passed === 6 && readiness.stage_one.total === 17 && readiness.stage_one.done.length === readiness.stage_one.passed, 'v2 완료율 분모 오류');
assert(readiness.stage_one.percent === Math.round(readiness.stage_one.passed/readiness.stage_one.total*1000)/10, '진척률 산식 오류');
assert(readiness.commercial.claim === 'blocked', '외부 조건 없이 상용 완료 주장');
assert(readiness.pc_web.browser_evidence_scope.startsWith('local record'), '브라우저 증거 범위 누락');
const evidence = JSON.parse(read('evidence-v013.json'));
assert(evidence.android.status === 'partial_pass' && evidence.android.current_release === true && evidence.android.device_count === 1, '현재 Android 부분 시험 증거 누락');
assert(evidence.android.checks.offline_reload === 'pass' && evidence.android.checks.camera_permission === 'not_granted', 'Android 통과·미확인 경계 불일치');
assert(!read('evidence-v013.json').includes('R5CY32TNJFM'), '공개 증거에 기기 일련번호가 포함됨');
assert(evidence.automatic.required_files === 16, '이전판 증거는 역사 기록으로 보존');
assert(existsSync(resolve(root,readiness.evidence_file)), '현재판 검사 기록 누락');
assert(evidence.automatic.lighthouse.mobile.accessibility === 100 && evidence.automatic.lighthouse.desktop.accessibility === 100, '현재 공개판 접근성 측정 증거 누락');
assert(evidence.automatic.lighthouse.limitation.includes('not Android'), '자동 측정과 실기기 증거 경계 누락');
assert(!progress.includes('<strong>95%</strong>') && !progress.includes('A56 격리'), '옛 완료율 또는 기기 증거가 남아 있음');
assert(progress.includes('6 / 17 DONE') && progress.includes('35.3%') && progress.includes('미실시'), '현재 v2 분모 또는 증거 경계 오류');
assert(sw.includes('key.startsWith(CACHE_PREFIX)') && sw.includes('if (!allowed.includes(requested.href)) return'), '다른 앱 임시 저장·API 응답 보호 누락');
assert(html.includes("import * as recordStore from './assets/local-records.mjs'"), '안전 기록 모듈 누락');
assert(read('robots.txt').includes('sitemap.xml'), 'robots sitemap 누락');
assert(read('sitemap.xml').includes('privacy.html') && read('sitemap.xml').includes('terms.html'), 'sitemap 법적 표면 누락');

console.log(`[public-verify] PASS — 필수 파일 ${required.length}개, 한국 범위, PWA, 법적 표면, 합성자료 차단, v2 분모 확인`);
