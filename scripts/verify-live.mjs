const base = process.env.AYS_PUBLIC_BASE ?? 'https://hanksleekorea-boop.github.io/all-young-scanner-web/';
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const paths = ['', 'progress.html', 'offline.html', 'privacy.html', 'terms.html', 'support.html', 'manifest.webmanifest', 'readiness.json', 'catalog-governance.json'];
const results = [];

for (const path of paths) {
  const url = new URL(path, base);
  assert(url.protocol === 'https:', `HTTPS가 아님: ${url}`);
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  const body = await response.text();
  assert(response.status === 200, `${path || 'index.html'} HTTP ${response.status}`);
  assert(body.length > 20, `${path || 'index.html'} 본문이 비어 있음`);
  results.push({ path: path || 'index.html', status: response.status, contentType: response.headers.get('content-type') });
}

const index = await (await fetch(base, { signal: AbortSignal.timeout(15_000) })).text();
const readiness = await (await fetch(new URL('readiness.json', base), { signal: AbortSignal.timeout(15_000) })).json();
const governance = await (await fetch(new URL('catalog-governance.json', base), { signal: AbortSignal.timeout(15_000) })).json();
const headers = await fetch(base, { method: 'HEAD', signal: AbortSignal.timeout(15_000) });

assert(index.includes('올영스캐너') && !/ShoppingScanner|쇼핑스캐너/.test(index), '다른 제품 또는 옛 이름이 공개됨');
assert(index.includes(`const RELEASE_VERSION = '${readiness.release_id}'`), '공개 HTML과 readiness 릴리스가 다름');
assert(readiness.commercial?.claim === 'blocked', '외부 조건 없이 상용 완료를 주장함');
assert(governance.commercial_catalog_connected === false && governance.public_real_product_count === 0, '실상품 연결 상태가 거짓임');
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
