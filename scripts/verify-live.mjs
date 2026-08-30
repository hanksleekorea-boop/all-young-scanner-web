const base = process.env.AYS_PUBLIC_BASE ?? 'https://hanksleekorea-boop.github.io/all-young-scanner-web/';
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const expectedRelease = '2026-08-30-service-v0.32';
const paths = ['', 'progress.html', 'offline.html', 'privacy.html', 'terms.html', 'support.html', 'about.html', 'cookies.html', 'advertising.html', 'ad-operations.html', 'ad-governance.html', 'privacy-choices.html', 'ads.txt', 'manifest.webmanifest', 'readiness.json', 'free-advanced-readiness.json', 'plus-readiness.json', 'ad-stage1-readiness.json', 'ad-stage2-readiness.json', 'ad-stage3-readiness.json', 'advertising-config.json', 'commercial-launch-readiness.json', 'commercial-launch-evidence.json', 'evidence-v032.json'];
const results = [];
const freshUrl = (path = '') => { const url = new URL(path, base); url.searchParams.set('ays_verify', `${Date.now()}-${Math.random()}`); return url; };

for (let attempt = 0; attempt < 20; attempt += 1) {
  try {
    const [readinessResponse, freeResponse, plusResponse] = await Promise.all([
      fetch(freshUrl('readiness.json'), { cache: 'no-store', signal: AbortSignal.timeout(15_000) }),
      fetch(freshUrl('free-advanced-readiness.json'), { cache: 'no-store', signal: AbortSignal.timeout(15_000) }),
      fetch(freshUrl('plus-readiness.json'), { cache: 'no-store', signal: AbortSignal.timeout(15_000) }),
    ]);
    const [candidateReadiness, candidateFree, candidatePlus] = await Promise.all([readinessResponse.json(), freeResponse.json(), plusResponse.json()]);
    if (readinessResponse.ok && freeResponse.ok && plusResponse.ok && candidateReadiness.release_id === expectedRelease && candidateFree.release_id === expectedRelease && candidatePlus.release_id === expectedRelease) break;
  } catch { /* Pages may still be publishing the new release. */ }
  if (attempt === 19) throw new Error(`공개 주소가 ${expectedRelease}로 갱신되지 않음`);
  await new Promise((resolve) => setTimeout(resolve, 3000));
}

for (const path of paths) {
  const url = freshUrl(path);
  assert(url.protocol === 'https:', `HTTPS가 아님: ${url}`);
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  const body = await response.text();
  assert(response.status === 200, `${path || 'index.html'} HTTP ${response.status}`);
  assert(body.length > 20, `${path || 'index.html'} 본문이 비어 있음`);
  results.push({ path: path || 'index.html', status: response.status, contentType: response.headers.get('content-type') });
}

const index = await (await fetch(freshUrl(), { cache: 'no-store', signal: AbortSignal.timeout(15_000) })).text();
const readiness = await (await fetch(freshUrl('readiness.json'), { cache: 'no-store', signal: AbortSignal.timeout(15_000) })).json();
const free = await (await fetch(freshUrl('free-advanced-readiness.json'), { cache: 'no-store', signal: AbortSignal.timeout(15_000) })).json();
const plus = await (await fetch(freshUrl('plus-readiness.json'), { cache: 'no-store', signal: AbortSignal.timeout(15_000) })).json();
const adConfig = await (await fetch(freshUrl('advertising-config.json'), { cache: 'no-store', signal: AbortSignal.timeout(15_000) })).json();
const adReadiness = await (await fetch(freshUrl('ad-stage1-readiness.json'), { cache: 'no-store', signal: AbortSignal.timeout(15_000) })).json();
const adStageTwo = await (await fetch(freshUrl('ad-stage2-readiness.json'), { cache: 'no-store', signal: AbortSignal.timeout(15_000) })).json();
const adStageThree = await (await fetch(freshUrl('ad-stage3-readiness.json'), { cache: 'no-store', signal: AbortSignal.timeout(15_000) })).json();
const headers = await fetch(base, { method: 'HEAD', signal: AbortSignal.timeout(15_000) });

assert(index.includes('올영스캐너') && !/ShoppingScanner|쇼핑스캐너/.test(index), '다른 제품 또는 옛 이름이 공개됨');
assert(index.includes('무료 · 로그인 없이 · 기기 안 저장') && index.includes('free-advanced-bootstrap.mjs'), '무료 고급 현재판 홈이 공개되지 않음');
assert(index.includes('결제 없이 전체 공개') && index.includes('data-view="plus"'), '결제 제외 Plus 화면이 공개되지 않음');
assert(index.includes('data-ad-slot="home-context"') && index.includes('assets/ad-loader.mjs') && !index.includes('class="adsbygoogle"'), '공개 홈 광고 기본 차단 경계 오류');
assert(readiness.release_id === free.release_id && free.release_id === plus.release_id && free.code.total === 16 && plus.code.total === 12 && plus.payment.included === false, '공개 HTML과 readiness 릴리스가 다름');
assert(readiness.commercial?.claim === 'blocked', '외부 조건 없이 상용 완료를 주장함');
assert(free.operations.done === 0, '외부 운영 증거 없이 완료를 주장함');
assert(adConfig.enabled === false && adConfig.publisher_id === 'ca-pub-2476023536699107' && adReadiness.code.verified === 16 && adReadiness.external_activation.done === 1, '광고 코드 준비와 확인된 게시자·ads.txt 상태 대조 실패');
assert(adConfig.schema_version === 3 && adConfig.stage_two.enabled === false && adStageTwo.code.verified === 24 && adStageTwo.code.live === 24 && adStageTwo.external_activation.done === 1 && adStageTwo.active_providers.external === 0, '광고 2단계 코드·ads.txt와 실제 다중 제공자 운영을 섞음');
assert(adConfig.stage_three.enabled === false && adConfig.stage_three.mode === 'shadow-only' && adStageThree.code.verified === 32 && adStageThree.code.live === 32 && adStageThree.external_activation.done === 1 && adStageThree.supply_chain.done === 1 && adStageThree.active_operations.live_allocation_percent === 0, '광고 3단계 코드·ads.txt와 실제 고급 광고 운영을 섞음');
assert(Boolean(headers.headers.get('strict-transport-security')), '공개 호스트 HSTS 누락');

console.log(JSON.stringify({
  verdict: 'PASS',
  base,
  release_id: readiness.release_id,
  checked: results,
  security: {
    hsts: 'present',
    csp: headers.headers.get('content-security-policy') ? 'present' : 'not_provided_by_current_host',
    x_content_type_options: headers.headers.get('x-content-type-options') ? 'present' : 'not_provided_by_current_host',
    referrer_policy: headers.headers.get('referrer-policy') ? 'present' : 'not_provided_by_current_host',
  },
}, null, 2));
