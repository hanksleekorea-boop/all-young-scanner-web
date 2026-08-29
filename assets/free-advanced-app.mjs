export const STORAGE_KEY = 'ays-free-advanced-v1';
export const SERVICE_ID = 'all-young-scanner-free-advanced';
export const SCHEMA_VERSION = 1;
export const MAX_CHECKINS = 90;
export const MAX_BACKUP_BYTES = 256 * 1024;

const allowedTimes = new Set(['morning', 'evening']);
const allowedContexts = new Set(['normal', 'humid', 'dry', 'workout', 'travel']);
const allowedPaces = new Set(['minimal', 'balanced']);
const forbiddenKeys = /"(?:__proto__|prototype|constructor)"\s*:/i;

export function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('ko-KR').replace(/\s+/g, ' ');
}

export function selectRoutineSlugs(input, availableSlugs) {
  if (!input || !allowedTimes.has(input.time) || !allowedContexts.has(input.context) || !allowedPaces.has(input.pace)) {
    throw new Error('ROUTINE_INPUT_INVALID');
  }
  const timeGuide = input.time === 'morning' ? 'morning-three-step-start' : 'evening-minimal-routine';
  const contextGuide = {
    normal: null,
    humid: 'routine-hot-humid-day',
    dry: 'routine-cold-dry-day',
    workout: 'routine-after-workout',
    travel: 'minimal-travel-routine',
  }[input.context];
  const paceGuide = input.pace === 'minimal' ? 'simplify-too-many-products' : 'add-one-product-at-a-time';
  const candidates = [timeGuide, contextGuide, paceGuide, input.time === 'morning' ? 'how-to-use-sunscreen-stick' : null];
  const available = new Set(availableSlugs);
  return [...new Set(candidates.filter((slug) => slug && available.has(slug)))].slice(0, 4);
}

export function filterGuides(guides, query = '', category = 'all') {
  const needle = normalizeText(query);
  return guides.filter((guide) => {
    const categoryMatch = category === 'all' || guide.category === category || guide.content_type === category;
    const haystack = normalizeText([guide.title, guide.summary, guide.category, guide.content_type].join(' '));
    return categoryMatch && (!needle || haystack.includes(needle));
  });
}

function validDate(value, today) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value <= today && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function emptyState() {
  return { schema_version: SCHEMA_VERSION, service_id: SERVICE_ID, saved_guides: [], routine: null, checkins: [] };
}

export function normalizeState(candidate, validSlugs, today = new Date().toISOString().slice(0, 10)) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return emptyState();
  const valid = new Set(validSlugs);
  const saved = [...new Set(Array.isArray(candidate.saved_guides) ? candidate.saved_guides.filter((slug) => typeof slug === 'string' && valid.has(slug)) : [])].slice(0, 24);
  let routine = null;
  const sourceRoutine = candidate.routine;
  if (sourceRoutine && allowedTimes.has(sourceRoutine.time) && allowedContexts.has(sourceRoutine.context) && allowedPaces.has(sourceRoutine.pace)) {
    const guideSlugs = [...new Set(Array.isArray(sourceRoutine.guide_slugs) ? sourceRoutine.guide_slugs.filter((slug) => valid.has(slug)) : [])].slice(0, 4);
    routine = { time: sourceRoutine.time, context: sourceRoutine.context, pace: sourceRoutine.pace, guide_slugs: guideSlugs };
  }
  const byDate = new Map();
  if (Array.isArray(candidate.checkins)) {
    for (const row of candidate.checkins) {
      if (!row || !validDate(row.date, today) || typeof row.completed !== 'boolean' || !Number.isInteger(row.comfort) || row.comfort < 1 || row.comfort > 5 || typeof row.irritation !== 'boolean') continue;
      byDate.set(row.date, { date: row.date, completed: row.completed, comfort: row.comfort, irritation: row.irritation });
    }
  }
  const checkins = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_CHECKINS);
  return { schema_version: SCHEMA_VERSION, service_id: SERVICE_ID, saved_guides: saved, routine, checkins };
}

export function upsertCheckin(state, checkin, validSlugs, today = new Date().toISOString().slice(0, 10)) {
  const next = normalizeState({ ...state, checkins: [...(state.checkins || []), checkin] }, validSlugs, today);
  if (!next.checkins.some((row) => row.date === checkin?.date)) throw new Error('CHECKIN_INVALID');
  return next;
}

export function makeBackup(state, validSlugs, exportedAt = new Date().toISOString()) {
  return JSON.stringify({ service_id: SERVICE_ID, schema_version: SCHEMA_VERSION, exported_at: exportedAt, data: normalizeState(state, validSlugs) }, null, 2);
}

export function parseBackup(text, validSlugs, today = new Date().toISOString().slice(0, 10)) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error('BACKUP_SIZE_INVALID');
  if (forbiddenKeys.test(text)) throw new Error('BACKUP_KEY_INVALID');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('BACKUP_JSON_INVALID'); }
  if (!parsed || parsed.service_id !== SERVICE_ID || parsed.schema_version !== SCHEMA_VERSION || !parsed.data) throw new Error('BACKUP_CONTRACT_INVALID');
  const normalized = normalizeState(parsed.data, validSlugs, today);
  return {
    data: normalized,
    preview: { saved_guides: normalized.saved_guides.length, checkins: normalized.checkins.length, has_routine: Boolean(normalized.routine) },
  };
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('data-')) node.setAttribute(key, value);
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

function loadState(storage, validSlugs) {
  try { return normalizeState(JSON.parse(storage.getItem(STORAGE_KEY) || 'null'), validSlugs); } catch { return emptyState(); }
}

function saveState(storage, state) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export async function mountFreeAdvancedApp({ root = document, storage = localStorage, fetcher = fetch } = {}) {
  const live = root.querySelector('#app-status');
  const viewTitle = root.querySelector('#view-title');
  const response = await fetcher('./content/usage-guides.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error('CONTENT_LOAD_FAILED');
  const content = await response.json();
  const guides = Array.isArray(content.guides) ? content.guides : [];
  const validSlugs = guides.map((guide) => guide.slug);
  let state = loadState(storage, validSlugs);
  let pendingImport = null;

  const announce = (message) => { live.textContent = message; };
  const guideBySlug = new Map(guides.map((guide) => [guide.slug, guide]));
  const guideHref = (slug) => `./guides/${encodeURIComponent(slug)}/`;

  function cardFor(guide, compact = false) {
    const title = el('h3', { text: guide.title });
    const summary = el('p', { text: guide.summary });
    const link = el('a', { href: guideHref(guide.slug), className: 'text-link', text: '상세 가이드 보기' });
    const save = el('button', { type: 'button', className: 'save-guide', 'data-save-guide': guide.slug, text: state.saved_guides.includes(guide.slug) ? '저장됨' : '기기에 저장' });
    save.setAttribute('aria-pressed', String(state.saved_guides.includes(guide.slug)));
    return el('article', { className: `guide-card${compact ? ' compact' : ''}` }, [el('span', { className: 'eyebrow', text: guide.category }), title, summary, el('div', { className: 'card-actions' }, [link, save])]);
  }

  function renderFeatured() {
    const target = root.querySelector('#featured-guides');
    target.replaceChildren(...guides.slice(0, 3).map((guide) => cardFor(guide, true)));
  }

  function renderGuides() {
    const query = root.querySelector('#guide-search').value;
    const category = root.querySelector('#guide-category').value;
    const results = filterGuides(guides, query, category);
    root.querySelector('#guide-results').replaceChildren(...results.map((guide) => cardFor(guide)));
    root.querySelector('#guide-empty').hidden = results.length > 0;
    root.querySelector('#guide-count').textContent = `${results.length}개 가이드를 찾았습니다.`;
  }

  function renderRoutine() {
    const target = root.querySelector('#routine-result');
    target.replaceChildren();
    if (!state.routine) {
      target.append(el('p', { className: 'empty-copy', text: '세 가지를 선택하면 근거 가이드로 내 루틴을 만듭니다.' }));
      return;
    }
    const selected = state.routine.guide_slugs.map((slug) => guideBySlug.get(slug)).filter(Boolean);
    target.append(el('div', { className: 'result-heading' }, [el('div', {}, [el('span', { className: 'eyebrow', text: '내 루틴' }), el('h2', { text: `${selected.length}개 가이드로 완성` })]), el('button', { type: 'button', className: 'secondary-button', 'data-save-routine': 'true', text: '전체 가이드 저장' })]));
    const list = el('ol', { className: 'routine-list' });
    selected.forEach((guide) => {
      list.append(el('li', {}, [el('strong', { text: guide.title }), el('p', { text: guide.body?.one_line || guide.summary }), el('a', { href: guideHref(guide.slug), text: '단계와 중단 신호 확인' })]));
    });
    target.append(list, el('div', { className: 'safety-note' }, [el('strong', { text: '사용 전 확인' }), el('p', { text: '제품 표시사항이 이 안내보다 우선합니다. 따가움·붉어짐·부기 같은 불편 신호가 생기면 새 제품 사용을 멈추고 필요하면 전문가에게 확인하세요.' })]));
  }

  function renderRecords() {
    const saved = root.querySelector('#saved-guides');
    const savedGuides = state.saved_guides.map((slug) => guideBySlug.get(slug)).filter(Boolean);
    saved.replaceChildren(...(savedGuides.length ? savedGuides.map((guide) => cardFor(guide, true)) : [el('p', { className: 'empty-copy', text: '저장한 가이드가 없습니다. 루틴이나 가이드 화면에서 필요한 안내를 저장해 보세요.' })]));
    const history = root.querySelector('#checkin-history');
    history.replaceChildren(...(state.checkins.length ? state.checkins.slice(0, 14).map((row) => el('li', {}, [el('strong', { text: row.date }), el('span', { text: `${row.completed ? '실행함' : '실행하지 않음'} · 편안함 ${row.comfort}/5 · 불편 신호 ${row.irritation ? '있음' : '없음'}` })])) : [el('li', { className: 'empty-copy', text: '아직 점검 기록이 없습니다.' })]));
    root.querySelector('#record-summary').textContent = `저장 가이드 ${state.saved_guides.length}개 · 점검 ${state.checkins.length}개`;
  }

  function persist(message) {
    saveState(storage, state);
    renderFeatured(); renderGuides(); renderRoutine(); renderRecords(); announce(message);
  }

  function showView(name, pushHash = true) {
    const allowed = ['home', 'routine', 'guides', 'records'];
    const next = allowed.includes(name) ? name : 'home';
    root.querySelectorAll('[data-view]').forEach((section) => { section.hidden = section.dataset.view !== next; });
    root.querySelectorAll('[data-view-target]').forEach((button) => {
      const current = button.dataset.viewTarget === next;
      button.classList.toggle('active', current);
      if (current) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    if (pushHash && location.hash !== `#${next}`) history.replaceState(null, '', `#${next}`);
    const heading = root.querySelector(`[data-view="${next}"] h1`);
    viewTitle.textContent = heading?.textContent || '올영스캐너';
    if (pushHash) heading?.focus({ preventScroll: true });
  }

  root.addEventListener('click', (event) => {
    const viewButton = event.target.closest('[data-view-target]');
    if (viewButton) { showView(viewButton.dataset.viewTarget); return; }
    const saveButton = event.target.closest('[data-save-guide]');
    if (saveButton) {
      const slug = saveButton.dataset.saveGuide;
      state.saved_guides = state.saved_guides.includes(slug) ? state.saved_guides.filter((item) => item !== slug) : [...state.saved_guides, slug].slice(0, 24);
      persist(state.saved_guides.includes(slug) ? '가이드를 이 기기에 저장했습니다.' : '저장을 해제했습니다.');
      return;
    }
    if (event.target.closest('[data-save-routine]') && state.routine) {
      state.saved_guides = [...new Set([...state.saved_guides, ...state.routine.guide_slugs])].slice(0, 24);
      persist('루틴의 모든 가이드를 이 기기에 저장했습니다.');
    }
  });

  root.querySelector('#routine-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = { time: data.get('time'), context: data.get('context'), pace: data.get('pace') };
    try {
      state.routine = { ...input, guide_slugs: selectRoutineSlugs(input, validSlugs) };
      persist('내 루틴을 만들었습니다.');
      root.querySelector('#routine-result').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    } catch {
      announce('시간대, 현재 환경, 관리 강도를 모두 선택해 주세요.');
      event.currentTarget.querySelector('input:not(:checked)')?.focus();
    }
  });

  root.querySelector('#guide-search').addEventListener('input', renderGuides);
  root.querySelector('#guide-category').addEventListener('change', renderGuides);
  root.querySelector('#guide-reset').addEventListener('click', () => { root.querySelector('#guide-search').value = ''; root.querySelector('#guide-category').value = 'all'; renderGuides(); root.querySelector('#guide-search').focus(); });

  root.querySelector('#checkin-date').value = new Date().toISOString().slice(0, 10);
  root.querySelector('#checkin-date').max = new Date().toISOString().slice(0, 10);
  root.querySelector('#checkin-form').addEventListener('submit', (event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try {
      state = upsertCheckin(state, { date: data.get('date'), completed: data.get('completed') === 'yes', comfort: Number(data.get('comfort')), irritation: data.get('irritation') === 'yes' }, validSlugs);
      persist('오늘 점검을 이 기기에 저장했습니다.');
    } catch { announce('오늘 점검의 모든 항목을 올바르게 선택해 주세요.'); }
  });

  root.querySelector('#export-records').addEventListener('click', () => {
    const blob = new Blob([makeBackup(state, validSlugs)], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `all-young-free-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href); announce('백업 파일을 만들었습니다.');
  });

  root.querySelector('#import-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      pendingImport = parseBackup(await file.text(), validSlugs);
      root.querySelector('#import-preview').textContent = `가이드 ${pendingImport.preview.saved_guides}개 · 점검 ${pendingImport.preview.checkins}개 · 루틴 ${pendingImport.preview.has_routine ? '있음' : '없음'}`;
      root.querySelector('#confirm-import').disabled = false; announce('백업을 확인했습니다. 확정하기 전에는 현재 기록을 바꾸지 않습니다.');
    } catch { pendingImport = null; root.querySelector('#confirm-import').disabled = true; root.querySelector('#import-preview').textContent = '올영스캐너 무료 고급 1.0 백업 파일인지 확인해 주세요.'; announce('백업 파일을 가져올 수 없습니다.'); }
  });

  root.querySelector('#confirm-import').addEventListener('click', () => {
    if (!pendingImport) return; state = pendingImport.data; pendingImport = null; root.querySelector('#confirm-import').disabled = true; root.querySelector('#import-file').value = ''; root.querySelector('#import-preview').textContent = ''; persist('백업 기록을 가져왔습니다.');
  });

  const dialog = root.querySelector('#delete-dialog');
  root.querySelector('#open-delete').addEventListener('click', () => { root.querySelector('#delete-count').textContent = `저장 가이드 ${state.saved_guides.length}개와 점검 ${state.checkins.length}개가 삭제됩니다.`; dialog.showModal(); });
  root.querySelector('#cancel-delete').addEventListener('click', () => dialog.close());
  root.querySelector('#confirm-delete').addEventListener('click', () => { state = emptyState(); storage.removeItem(STORAGE_KEY); dialog.close(); renderFeatured(); renderGuides(); renderRoutine(); renderRecords(); announce('이 기기의 올영스캐너 기록을 모두 삭제했습니다.'); });

  renderFeatured(); renderGuides(); renderRoutine(); renderRecords(); showView(location.hash.slice(1), false);
  root.documentElement.dataset.appReady = 'true';
  return { guides, getState: () => state, showView };
}
