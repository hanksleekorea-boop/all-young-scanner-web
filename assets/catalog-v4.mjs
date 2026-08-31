export const CATALOG_STATE_KEY = 'ays-catalog-v4-local';
export const MAX_SELECTED = 3;
export const MAX_PENDING = 50;
export const MAX_PRODUCT_CHECKINS = 365;
export const CATALOG_BACKUP_ID = 'all-young-scanner-catalog-local-v1';

export function normalizeCatalogText(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

export function emptyCatalogState() { return { version: 2, selected: [], routine_products: [], pending_lookups: [], product_checkins: [] }; }

function safeId(value) { return /^obf-\d{8,14}$/.test(String(value ?? '')) ? String(value) : ''; }

export function normalizeCatalogState(candidate, validIds = []) {
  const valid = new Set(validIds); const source = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : {};
  const unique = (rows, max) => [...new Set((Array.isArray(rows) ? rows : []).map(safeId).filter((id) => id && valid.has(id)))].slice(0, max);
  const pending = [];
  for (const row of Array.isArray(source.pending_lookups) ? source.pending_lookups : []) {
    const value = String(row?.value ?? '').normalize('NFKC').trim().slice(0, 160);
    const kind = ['gtin', 'name', 'photo_note'].includes(row?.kind) ? row.kind : '';
    if (!value || !kind || pending.some((item) => item.kind === kind && item.value === value)) continue;
    pending.push({ kind, value, created_at: /^\d{4}-\d{2}-\d{2}T/.test(row.created_at || '') ? row.created_at : '' });
    if (pending.length === MAX_PENDING) break;
  }
  const byKey = new Map();
  for (const row of Array.isArray(source.product_checkins) ? source.product_checkins : []) {
    const productId = safeId(row?.product_id); const date = /^\d{4}-\d{2}-\d{2}$/.test(row?.date || '') ? row.date : '';
    const used = ['used', 'skipped', 'stopped'].includes(row?.used) ? row.used : ''; const comfort = Number(row?.comfort);
    const openedOn = /^\d{4}-\d{2}-\d{2}$/.test(row?.opened_on || '') ? row.opened_on : null; const expiresOn = /^\d{4}-\d{2}-\d{2}$/.test(row?.expires_on || '') ? row.expires_on : null;
    const amount = String(row?.amount ?? '').normalize('NFKC').trim().slice(0, 40); const cost = row?.cost === null || row?.cost === '' || row?.cost === undefined ? null : Number(row.cost);
    if (!valid.has(productId) || !date || !used || !Number.isInteger(comfort) || comfort < 1 || comfort > 5 || (cost !== null && (!Number.isFinite(cost) || cost < 0 || cost > 100000000))) continue;
    byKey.set(`${date}:${productId}`, { product_id: productId, date, used, comfort, discomfort: Boolean(row.discomfort), opened_on: openedOn, expires_on: expiresOn, amount, cost, currency: 'KRW' });
  }
  const productCheckins = [...byKey.values()].sort((a, b) => b.date.localeCompare(a.date) || a.product_id.localeCompare(b.product_id)).slice(0, MAX_PRODUCT_CHECKINS);
  return { version: 2, selected: unique(source.selected, MAX_SELECTED), routine_products: unique(source.routine_products, 20), pending_lookups: pending, product_checkins: productCheckins };
}

export function upsertProductCheckin(state, checkin, validIds) {
  const normalized = normalizeCatalogState(state, validIds); const next = normalizeCatalogState({ ...normalized, product_checkins: [...normalized.product_checkins, checkin] }, validIds);
  if (!next.product_checkins.some((row) => row.product_id === checkin?.product_id && row.date === checkin?.date)) throw new Error('PRODUCT_CHECKIN_INVALID');
  return next;
}

export function makeCatalogBackup(state, validIds, exportedAt = new Date().toISOString()) {
  return JSON.stringify({ service_id: CATALOG_BACKUP_ID, schema_version: 2, exported_at: exportedAt, data: normalizeCatalogState(state, validIds) }, null, 2);
}

export function parseCatalogBackup(text, validIds) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > 2 * 1024 * 1024 || /"(?:__proto__|prototype|constructor)"\s*:/i.test(text)) throw new Error('CATALOG_BACKUP_INVALID');
  let parsed; try { parsed = JSON.parse(text); } catch { throw new Error('CATALOG_BACKUP_INVALID'); }
  if (parsed?.service_id !== CATALOG_BACKUP_ID || parsed?.schema_version !== 2 || !parsed.data) throw new Error('CATALOG_BACKUP_INVALID');
  return normalizeCatalogState(parsed.data, validIds);
}

export function searchCatalog(products, query = '', category = 'all', limit = 30) {
  const normalized = normalizeCatalogText(query); const tokens = normalized.split(' ').filter(Boolean);
  return products.map((product) => {
    const haystack = normalizeCatalogText([product.gtin, product.name, product.brand, product.category_scope, product.k_beauty_relevance, ...(product.countries || [])].join(' '));
    const categoryMatch = category === 'all' || product.category_scope === category;
    if (!categoryMatch || (tokens.length && !tokens.every((token) => haystack.includes(token)))) return null;
    const exactGtin = normalized && product.gtin === normalized ? 10000 : 0;
    const brandStart = normalized && normalizeCatalogText(product.brand).startsWith(normalized) ? 400 : 0;
    const nameStart = normalized && normalizeCatalogText(product.name).startsWith(normalized) ? 300 : 0;
    const korean = product.k_beauty_relevance === 'global_beauty_context' ? 0 : 100;
    return { product, score: exactGtin + brandStart + nameStart + korean + Math.min(product.ingredient_names?.length || 0, 80) };
  }).filter(Boolean).sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name)).slice(0, Math.max(1, Math.min(Number(limit) || 30, 100))).map((row) => row.product);
}

export function queueLookup(state, lookup, validIds = [], now = new Date().toISOString()) {
  const normalized = normalizeCatalogState(state, validIds); const kind = ['gtin', 'name', 'photo_note'].includes(lookup?.kind) ? lookup.kind : '';
  const value = String(lookup?.value ?? '').normalize('NFKC').trim().slice(0, 160);
  if (!kind || !value) throw new Error('LOOKUP_INVALID');
  return normalizeCatalogState({ ...normalized, pending_lookups: [{ kind, value, created_at: now }, ...normalized.pending_lookups] }, validIds);
}

export function buildProductComparison(products) {
  const rows = [...new Map((Array.isArray(products) ? products : []).filter(Boolean).map((product) => [product.id, product])).values()].slice(0, MAX_SELECTED);
  if (!rows.length) return { products: [], common_ingredients: [], differences: [], notice: '비교할 상품을 1개 이상 선택하세요.' };
  const common = rows.length === 1 ? rows[0].ingredient_names || [] : (rows[0].ingredient_names || []).filter((name) => rows.slice(1).every((product) => (product.ingredient_names || []).includes(name)));
  return {
    products: rows.map((product) => ({
      id: product.id, name: product.name, brand: product.brand, category: product.category_scope, quantity: product.quantity,
      relevance: product.k_beauty_relevance, ingredient_count: product.ingredient_names?.length || 0,
      source_url: product.source_url, source_updated_at: product.source_updated_at, editorial_status: product.editorial_status,
      facts: ['표시 전성분 원문 있음', product.quantity ? `표시 용량 ${product.quantity}` : '표시 용량 미확인', product.k_beauty_relevance === 'global_beauty_context' ? '글로벌 비교용' : '한국 연관 신호 있음'],
      caveats: ['사람 편집 검수 대기', '성분 농도·제형 효과 미확인', '판매·재고·가격 미확인'],
    })),
    common_ingredients: common.slice(0, 20),
    differences: rows.map((product) => ({ id: product.id, unique_ingredients: (product.ingredient_names || []).filter((name) => !common.includes(name)).slice(0, 12) })),
    notice: '표시 정보의 사실 차이만 보여줍니다. 개인 적합성·안전성·효과·의료 판단이나 구매 순위가 아닙니다.',
  };
}

function element(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'className') node.className = value; else if (key === 'text') node.textContent = value; else if (key.startsWith('data-')) node.setAttribute(key, value); else node[key] = value;
  }
  node.append(...children); return node;
}

function download(text, type, name) { const blob = new Blob([text], { type }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = name; link.click(); URL.revokeObjectURL(link.href); }

export async function mountCatalogV4({ root = document, storage = localStorage, fetcher = fetch } = {}) {
  const response = await fetcher('./content/catalog-v4.json', { cache: 'no-cache' }); if (!response.ok) throw new Error('CATALOG_LOAD_FAILED');
  const catalog = await response.json(); const products = Array.isArray(catalog.products) ? catalog.products : []; const byId = new Map(products.map((product) => [product.id, product])); const validIds = [...byId.keys()];
  let state; try { state = normalizeCatalogState(JSON.parse(storage.getItem(CATALOG_STATE_KEY) || 'null'), validIds); } catch { state = emptyCatalogState(); }
  const status = root.querySelector('#catalog-status'); const results = root.querySelector('#catalog-results'); const selectedBox = root.querySelector('#comparison-products'); const queueBox = root.querySelector('#offline-lookup-list');
  const persist = (message = '') => { state = normalizeCatalogState(state, validIds); storage.setItem(CATALOG_STATE_KEY, JSON.stringify(state)); renderSelected(); renderQueue(); renderProductRoutine(); if (message) status.textContent = message; };
  const relevanceCopy = (value) => ({ korean_gtin: '한국 발급 바코드', korea_market: '한국 시장 표기', korean_brand: '한국 브랜드 신호', global_beauty_context: '글로벌 비교용' }[value] || '범위 미확인');

  function card(product) {
    const checked = state.selected.includes(product.id); const checkbox = element('input', { type: 'checkbox', checked, value: product.id }); checkbox.setAttribute('aria-label', `${product.brand} ${product.name} 비교 선택`);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked && state.selected.length >= MAX_SELECTED) { checkbox.checked = false; status.textContent = '비교는 최대 3개까지 선택할 수 있습니다.'; return; }
      state.selected = checkbox.checked ? [...state.selected, product.id] : state.selected.filter((id) => id !== product.id); persist(`${state.selected.length}개 상품을 비교함에 담았습니다.`);
    });
    return element('article', { className: 'catalog-card' }, [
      element('div', { className: 'catalog-card-head' }, [element('div', {}, [element('span', { className: 'eyebrow', text: relevanceCopy(product.k_beauty_relevance) }), element('h3', { text: product.name }), element('p', { text: `${product.brand} · ${product.quantity || '용량 미확인'} · ${product.gtin}` })]), element('label', { className: 'compare-check' }, [checkbox, element('span', { text: '비교' })])]),
      element('p', { className: 'fact-line', text: `표시 성분 ${product.ingredient_names.length}개 · 출처 수정 ${product.source_updated_at.slice(0, 10)} · 사람 검수 대기` }),
      element('div', { className: 'card-actions' }, [element('a', { href: product.source_url, target: '_blank', rel: 'noopener noreferrer', className: 'text-link', text: '원문 출처' }), element('button', { type: 'button', className: 'secondary-button', text: state.routine_products.includes(product.id) ? '루틴에 저장됨' : '루틴에 추가' })]),
    ]);
  }

  function wireRoutineButtons() {
    [...results.querySelectorAll('.catalog-card')].forEach((node, index) => node.querySelector('button')?.addEventListener('click', () => { const shown = currentResults[index]; if (!shown) return; state.routine_products = state.routine_products.includes(shown.id) ? state.routine_products.filter((id) => id !== shown.id) : [...state.routine_products, shown.id].slice(0, 20); persist('상품 루틴을 이 기기에 저장했습니다.'); renderSearch(); }));
  }
  let currentResults = [];
  function renderSearch() {
    const query = root.querySelector('#catalog-query').value; const category = root.querySelector('#catalog-category').value;
    currentResults = searchCatalog(products, query, category); results.replaceChildren(...currentResults.map(card)); wireRoutineButtons();
    root.querySelector('#catalog-empty').hidden = currentResults.length > 0; status.textContent = `${currentResults.length}개 표시 · 전체 ${catalog.counts.selected_products}개 · 한국 연관 ${catalog.counts.korean_relevant_products}개`;
  }
  function renderSelected() {
    const comparison = buildProductComparison(state.selected.map((id) => byId.get(id))); selectedBox.replaceChildren();
    root.querySelector('#comparison-notice').textContent = comparison.notice;
    if (!comparison.products.length) { selectedBox.append(element('p', { className: 'empty-copy', text: '검색 화면에서 최대 3개를 선택하세요.' })); return; }
    for (const product of comparison.products) {
      const diff = comparison.differences.find((row) => row.id === product.id);
      selectedBox.append(element('article', { className: 'comparison-card' }, [element('span', { className: 'eyebrow', text: product.relevance === 'global_beauty_context' ? '글로벌 비교용' : '한국 연관' }), element('h3', { text: product.name }), element('p', { text: product.brand }), element('strong', { text: `표시 성분 ${product.ingredient_count}개` }), element('p', { text: `공통 제외 성분 예: ${diff.unique_ingredients.join(', ') || '없음'}` }), element('ul', {}, product.caveats.map((text) => element('li', { text }))), element('a', { href: product.source_url, target: '_blank', rel: 'noopener noreferrer', className: 'text-link', text: '출처 확인' })]));
    }
    root.querySelector('#comparison-common').textContent = comparison.common_ingredients.length ? comparison.common_ingredients.join(', ') : '공통 표시 성분이 없거나 1개 상품만 선택했습니다.';
  }
  function renderQueue() { queueBox.replaceChildren(...(state.pending_lookups.length ? state.pending_lookups.map((row) => element('li', { text: `${row.kind} · ${row.value} · ${row.created_at.slice(0, 10) || '날짜 미확인'}` })) : [element('li', { className: 'empty-copy', text: '연결 대기 항목이 없습니다.' })])); }

  const routineHost = root.querySelector('[data-view="routine"]'); const today = new Date().toISOString().slice(0, 10);
  const productList = element('ul', { className: 'queue-list', id: 'product-routine-list' }); const productSelect = element('select', { className: 'field', id: 'product-checkin-id', required: true }); const history = element('ul', { className: 'history', id: 'product-checkin-history' }); const backupFile = element('input', { id: 'product-backup-file', type: 'file', accept: 'application/json,.json' });
  const checkinForm = element('form', { className: 'checkin-form', id: 'product-checkin-form' }, [
    element('label', {}, [element('span', { className: 'field-label', text: '상품' }), productSelect]),
    element('label', {}, [element('span', { className: 'field-label', text: '날짜' }), element('input', { className: 'field', id: 'product-checkin-date', type: 'date', value: today, max: today, required: true })]),
    element('label', {}, [element('span', { className: 'field-label', text: '사용 상태' }), element('select', { className: 'field', id: 'product-checkin-used' }, [element('option', { value: 'used', text: '사용함' }), element('option', { value: 'skipped', text: '건너뜀' }), element('option', { value: 'stopped', text: '사용 중단' })])]),
    element('label', {}, [element('span', { className: 'field-label', text: '편안함 1~5' }), element('input', { className: 'field', id: 'product-checkin-comfort', type: 'number', min: 1, max: 5, value: 3, required: true })]),
    element('label', { className: 'compare-check' }, [element('input', { id: 'product-checkin-discomfort', type: 'checkbox' }), element('span', { text: '불편 신호 있음' })]),
    element('label', {}, [element('span', { className: 'field-label', text: '개봉일(선택)' }), element('input', { className: 'field', id: 'product-opened-on', type: 'date', max: today })]),
    element('label', {}, [element('span', { className: 'field-label', text: '표시 만료일(선택)' }), element('input', { className: 'field', id: 'product-expires-on', type: 'date' })]),
    element('label', {}, [element('span', { className: 'field-label', text: '사용량 메모(선택)' }), element('input', { className: 'field', id: 'product-amount', maxLength: 40, placeholder: '예: 한 펌프' })]),
    element('label', {}, [element('span', { className: 'field-label', text: '비용 원화(선택)' }), element('input', { className: 'field', id: 'product-cost', type: 'number', min: 0, max: 100000000, inputMode: 'numeric' })]),
    element('button', { className: 'primary-button', type: 'submit', text: '제품 기록 저장' }),
  ]);
  routineHost.append(element('section', { className: 'panel section-block', id: 'product-routine-panel' }, [element('h2', { text: '내 실제 상품 루틴과 기록' }), element('p', { text: '상품 사용·건너뜀·불편 신호·개봉·만료·사용량·비용을 로그인 없이 이 기기에 저장합니다.' }), productList, checkinForm, element('h3', { text: '최근 제품 기록' }), history, element('div', { className: 'button-row' }, [element('button', { id: 'export-product-records', className: 'secondary-button', type: 'button', text: '제품 기록 백업' }), element('label', { className: 'file-button' }, [element('span', { text: '제품 기록 복원' }), backupFile]), element('button', { id: 'delete-product-records', className: 'danger-button', type: 'button', text: '제품 기록 전체 삭제' })]), element('p', { className: 'scope-alert', text: '기록은 원인·치료 효과를 증명하지 않습니다. 불편이 지속되면 사용을 중단하고 전문가에게 확인하세요.' })]));

  function renderProductRoutine() {
    const saved = state.routine_products.map((id) => byId.get(id)).filter(Boolean); productList.replaceChildren(...(saved.length ? saved.map((product) => element('li', { text: `${product.brand} · ${product.name}` })) : [element('li', { className: 'empty-copy', text: '검색 화면에서 상품을 루틴에 추가하세요.' })]));
    const previous = productSelect.value; productSelect.replaceChildren(element('option', { value: '', text: '상품 선택' }), ...saved.map((product) => element('option', { value: product.id, text: `${product.brand} · ${product.name}` }))); if (saved.some((product) => product.id === previous)) productSelect.value = previous;
    history.replaceChildren(...(state.product_checkins.length ? state.product_checkins.slice(0, 30).map((row) => { const product = byId.get(row.product_id); return element('li', {}, [element('strong', { text: `${row.date} · ${product?.name || '상품'}` }), element('span', { text: `${{ used: '사용함', skipped: '건너뜀', stopped: '중단' }[row.used]} · 편안함 ${row.comfort}/5 · 불편 ${row.discomfort ? '있음' : '없음'}${row.expires_on ? ` · 만료 ${row.expires_on}` : ''}${row.cost !== null ? ` · ${row.cost.toLocaleString('ko-KR')}원` : ''}` })]); }) : [element('li', { className: 'empty-copy', text: '아직 제품 기록이 없습니다.' })]));
  }

  root.querySelector('#catalog-query').addEventListener('input', renderSearch); root.querySelector('#catalog-category').addEventListener('change', renderSearch);
  root.querySelector('#catalog-search-form').addEventListener('submit', (event) => { event.preventDefault(); renderSearch(); });
  root.querySelector('#queue-current-search').addEventListener('click', () => { const value = root.querySelector('#catalog-query').value.trim(); if (!value) { status.textContent = '먼저 이름이나 바코드를 입력하세요.'; return; } state = queueLookup(state, { kind: /^\d{8,14}$/.test(value) ? 'gtin' : 'name', value }, validIds); persist('연결 후 다시 확인할 항목으로 기기에 저장했습니다.'); });
  root.querySelector('#catalog-photo').addEventListener('change', (event) => { const file = event.target.files?.[0]; if (!file) return; state = queueLookup(state, { kind: 'photo_note', value: file.name }, validIds); persist('사진은 업로드하지 않고 파일 이름만 기기 대기 목록에 저장했습니다.'); event.target.value = ''; });
  root.querySelector('#clear-lookup-queue').addEventListener('click', () => { state.pending_lookups = []; persist('연결 대기 목록을 삭제했습니다.'); });
  root.querySelector('#clear-comparison').addEventListener('click', () => { state.selected = []; persist('비교 선택을 비웠습니다.'); renderSearch(); });
  root.querySelector('#export-comparison-json').addEventListener('click', () => download(JSON.stringify(buildProductComparison(state.selected.map((id) => byId.get(id))), null, 2), 'application/json', 'allyoung-product-comparison.json'));
  root.querySelector('#export-comparison-csv').addEventListener('click', () => { const rows = buildProductComparison(state.selected.map((id) => byId.get(id))).products; const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`; download(['brand,name,gtin,category,ingredient_count,source', ...rows.map((row) => [row.brand, row.name, byId.get(row.id)?.gtin, row.category, row.ingredient_count, row.source_url].map(quote).join(','))].join('\r\n'), 'text/csv;charset=utf-8', 'allyoung-product-comparison.csv'); });
  root.querySelector('#print-comparison').addEventListener('click', () => { document.body.classList.add('print-comparison-mode'); window.print(); });
  addEventListener('afterprint', () => document.body.classList.remove('print-comparison-mode'));
  checkinForm.addEventListener('submit', (event) => { event.preventDefault(); try { state = upsertProductCheckin(state, { product_id: productSelect.value, date: root.querySelector('#product-checkin-date').value, used: root.querySelector('#product-checkin-used').value, comfort: Number(root.querySelector('#product-checkin-comfort').value), discomfort: root.querySelector('#product-checkin-discomfort').checked, opened_on: root.querySelector('#product-opened-on').value || null, expires_on: root.querySelector('#product-expires-on').value || null, amount: root.querySelector('#product-amount').value, cost: root.querySelector('#product-cost').value || null }, validIds); persist('제품 기록을 이 기기에 저장했습니다.'); } catch { status.textContent = '제품과 필수 기록값을 확인하세요.'; } });
  root.querySelector('#export-product-records').addEventListener('click', () => download(makeCatalogBackup(state, validIds), 'application/json', 'allyoung-product-records.json'));
  backupFile.addEventListener('change', async (event) => { const file = event.target.files?.[0]; if (!file) return; try { state = parseCatalogBackup(await file.text(), validIds); persist('제품 기록 백업을 복원했습니다.'); renderSearch(); } catch { status.textContent = '올영스캐너 제품 기록 백업인지 확인하세요.'; } event.target.value = ''; });
  root.querySelector('#delete-product-records').addEventListener('click', () => { state.routine_products = []; state.product_checkins = []; persist('제품 루틴과 기록을 모두 삭제했습니다.'); renderSearch(); });

  const video = root.querySelector('#barcode-video'); let stream = null; let scanning = false;
  const stopCamera = () => { scanning = false; stream?.getTracks().forEach((track) => track.stop()); stream = null; video.srcObject = null; video.hidden = true; };
  root.querySelector('#stop-camera').addEventListener('click', stopCamera);
  root.querySelector('#start-camera').addEventListener('click', async () => {
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.BarcodeDetector) { status.textContent = '이 브라우저는 카메라 바코드 읽기를 지원하지 않습니다. 수동 입력을 이용하세요.'; root.querySelector('#catalog-query').focus(); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }); video.srcObject = stream; video.hidden = false; await video.play(); scanning = true;
      const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      const scan = async () => { if (!scanning) return; try { const codes = await detector.detect(video); const value = codes.find((row) => /^\d{8,14}$/.test(row.rawValue))?.rawValue; if (value) { root.querySelector('#catalog-query').value = value; stopCamera(); renderSearch(); status.textContent = currentResults.length ? '바코드 상품을 찾았습니다.' : '등록되지 않은 바코드입니다. 기기 대기 목록에 저장할 수 있습니다.'; return; } } catch {} requestAnimationFrame(scan); }; scan();
    } catch { stopCamera(); status.textContent = '카메라를 열 수 없습니다. 권한을 확인하거나 수동 입력을 이용하세요.'; root.querySelector('#catalog-query').focus(); }
  });
  addEventListener('pagehide', stopCamera);
  root.querySelector('#catalog-counts').textContent = `실제 상품 ${catalog.counts.selected_products}개 · 한국 연관 ${catalog.counts.korean_relevant_products}개 · 글로벌 비교 ${catalog.counts.global_context_products}개 · 사람 검수 완료 0개`;
  renderSearch(); renderSelected(); renderQueue(); renderProductRoutine(); document.documentElement.dataset.catalogReady = 'true';
  return { catalog, getState: () => state };
}
