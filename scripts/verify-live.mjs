const base = process.env.AYS_PUBLIC_BASE ?? 'https://hanksleekorea-boop.github.io/all-young-scanner-web/';
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const expectedRelease = '2026-08-31-service-v0.36';
const paths = ['', 'm/', 'en/', 'en/explorer.html', 'guides/', 'progress.html', 'offline.html', 'privacy.html', 'terms.html', 'support.html', 'about.html', 'cookies.html', 'advertising.html', 'ad-operations.html', 'ad-governance.html', 'privacy-choices.html', 'catalog-license.html', 'ads.txt', 'robots.txt', 'sitemap.xml', 'manifest.webmanifest', 'assets/shopping-discovery-hero-v1.png', 'content/shop-index-v1.json', 'content/usage-guides.en.json', 'content/catalog-v4.json', 'content/ingredients-v4.json', 'readiness.json', 'free-advanced-readiness.json', 'plus-readiness.json', 'stage1-v4-readiness.json', 'stage2-readiness.json', 'stage2-external-evidence.template.json', 'ad-stage1-readiness.json', 'ad-stage2-readiness.json', 'ad-stage3-readiness.json', 'advertising-config.json', 'commercial-launch-readiness.json', 'commercial-launch-evidence.json', 'evidence-v036.json'];
const results = [];
const freshUrl = (path = '') => { const url = new URL(path, base); url.searchParams.set('ays_verify', `${Date.now()}-${Math.random()}`); return url; };

for (let attempt = 0; attempt < 20; attempt += 1) {
  try {
    const [homeResponse, readinessResponse, freeResponse, plusResponse, shopResponse] = await Promise.all([
      fetch(freshUrl(), { cache: 'no-store', signal: AbortSignal.timeout(15_000) }),
      fetch(freshUrl('readiness.json'), { cache: 'no-store', signal: AbortSignal.timeout(15_000) }),
      fetch(freshUrl('free-advanced-readiness.json'), { cache: 'no-store', signal: AbortSignal.timeout(15_000) }),
      fetch(freshUrl('plus-readiness.json'), { cache: 'no-store', signal: AbortSignal.timeout(15_000) }),
      fetch(freshUrl('content/shop-index-v1.json'), { cache: 'no-store', signal: AbortSignal.timeout(15_000) }),
    ]);
    const [home, candidateReadiness, candidateFree, candidatePlus, shop] = await Promise.all([homeResponse.text(), readinessResponse.json(), freeResponse.json(), plusResponse.json(), shopResponse.json()]);
    const ready = homeResponse.ok && readinessResponse.ok && freeResponse.ok && plusResponse.ok && shopResponse.ok
      && home.includes('SHOP THE CATALOG') && home.includes('shopping-discovery-hero-v1.png')
      && candidateReadiness.release_id === expectedRelease && candidateFree.release_id === expectedRelease
      && candidatePlus.release_id === expectedRelease && shop.products?.length === 2000;
    if (ready) break;
  } catch { /* Pages may still be publishing the new release. */ }
  if (attempt === 19) throw new Error('공개 주소가 쇼핑 탐색 v0.38 화면과 2,000개 색인으로 갱신되지 않음');
  await new Promise((resolve) => setTimeout(resolve, 3000));
}

for (const path of paths) {
  const url = freshUrl(path);
  assert(url.protocol === 'https:', `HTTPS가 아님: ${url}`);
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  const body = await response.arrayBuffer();
  assert(response.status === 200, `${path || 'index.html'} HTTP ${response.status}`);
  assert(body.byteLength > 20, `${path || 'index.html'} 본문이 비어 있음`);
  results.push({ path: path || 'index.html', status: response.status, bytes: body.byteLength, contentType: response.headers.get('content-type') });
}

const index = await (await fetch(freshUrl(), { cache: 'no-store', signal: AbortSignal.timeout(15_000) })).text();
const shop = await (await fetch(freshUrl('content/shop-index-v1.json'), { cache: 'no-store', signal: AbortSignal.timeout(15_000) })).json();
const readiness = await (await fetch(freshUrl('readiness.json'), { cache: 'no-store', signal: AbortSignal.timeout(15_000) })).json();
const free = await (await fetch(freshUrl('free-advanced-readiness.json'), { cache: 'no-store', signal: AbortSignal.timeout(15_000) })).json();
const plus = await (await fetch(freshUrl('plus-readiness.json'), { cache: 'no-store', signal: AbortSignal.timeout(15_000) })).json();
const adConfig = await (await fetch(freshUrl('advertising-config.json'), { cache: 'no-store', signal: AbortSignal.timeout(15_000) })).json();
const adReadiness = await (await fetch(freshUrl('ad-stage1-readiness.json'), { cache: 'no-store', signal: AbortSignal.timeout(15_000) })).json();
const adStageTwo = await (await fetch(freshUrl('ad-stage2-readiness.json'), { cache: 'no-store', signal: AbortSignal.timeout(15_000) })).json();
const adStageThree = await (await fetch(freshUrl('ad-stage3-readiness.json'), { cache: 'no-store', signal: AbortSignal.timeout(15_000) })).json();
const headers = await fetch(base, { method: 'HEAD', signal: AbortSignal.timeout(15_000) });

assert(index.includes('올영스캐너') && !/ShoppingScanner|쇼핑스캐너/.test(index), '다른 제품 또는 옛 이름이 공개됨');
assert(index.includes('SHOP THE CATALOG') && index.includes('2,000개 상품') && index.includes('content/shop-index-v1.json'), '쇼핑 탐색 홈이 공개되지 않음');
assert(index.includes('Olive Young Global') && index.includes('Amazon Beauty') && index.includes('Sephora') && index.includes('YesStyle') && index.includes('StyleKorean'), '다중 판매처 이동 경로 누락');
assert(index.includes('비교 담기') && index.includes('판매처 찾기') && index.includes('data-compare') && index.includes('data-shop'), '상품 비교·판매처 찾기 실행 경로 누락');
assert(index.includes('현재 외부 링크는 일반 링크이며 제휴 수익 연결은 꺼져 있습니다.') && index.includes('특정 판매처가 운영·후원·보증하는 공식 서비스가 아닙니다.'), '제휴·독립성 고지 누락');
assert(index.includes('결제 없이 전체 공개') && index.includes('이 사이트 안에서는 상품을 결제하지 않으며'), '무료 범위와 외부 결제 경계 누락');
assert(index.includes('application/ld+json') && index.includes('hreflang="en"'), '구조화 데이터 또는 언어 대체 링크 누락');
assert(shop.products?.length === 2000 && shop.products.every((product) => product.price === null && Array.isArray(product.sellers) && product.sellers.length === 0), '2,000개 탐색 색인 또는 가격·판매자 미승인 경계 오류');
assert(readiness.release_id === free.release_id && free.release_id === plus.release_id && free.code.total === 16 && plus.code.total === 12 && plus.payment.included === false, '공개 readiness 릴리스가 다름');
assert(readiness.commercial?.claim === 'blocked' && free.operations.done === 0, '외부 운영 증거 없이 상용 완료를 주장함');
assert(adConfig.enabled === false && adConfig.publisher_id === 'ca-pub-2476023536699107' && adConfig.certified_cmp_ready === true && adReadiness.code.verified === 16 && adReadiness.external_activation.done === 2, '광고 코드 준비와 실제 비활성 상태 대조 실패');
assert(adConfig.schema_version === 3 && adConfig.stage_two.enabled === false && adStageTwo.code.verified === 24 && adStageTwo.code.live === 24 && adStageTwo.external_activation.done === 2 && adStageTwo.active_providers.external === 0, '광고 2단계 코드와 실제 운영을 섞음');
assert(adConfig.stage_three.enabled === false && adConfig.stage_three.mode === 'shadow-only' && adStageThree.code.verified === 32 && adStageThree.code.live === 32 && adStageThree.external_activation.done === 2 && adStageThree.supply_chain.done === 1 && adStageThree.active_operations.live_allocation_percent === 0, '광고 3단계 코드와 실제 운영을 섞음');
assert(Boolean(headers.headers.get('strict-transport-security')), '공개 호스트 HSTS 누락');

console.log(JSON.stringify({ verdict: 'PASS', base, release_id: readiness.release_id, shopping_ui: 'v0.38', products: shop.products.length, checked: results, security: { hsts: 'present', csp: headers.headers.get('content-security-policy') ? 'present' : 'not_provided_by_current_host', x_content_type_options: headers.headers.get('x-content-type-options') ? 'present' : 'not_provided_by_current_host', referrer_policy: headers.headers.get('referrer-policy') ? 'present' : 'not_provided_by_current_host' } }, null, 2));
