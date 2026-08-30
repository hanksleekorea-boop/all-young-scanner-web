export const STORAGE_KEY = 'ays-free-advanced-v1';
export const SERVICE_ID = 'all-young-scanner-free-advanced';
export const SCHEMA_VERSION = 1;
export const MAX_CHECKINS = 90;
export const MAX_BACKUP_BYTES = 256 * 1024;
export const MAX_PLUS_ROUTINES = 10;
export const MAX_PLUS_COLLECTIONS = 5;
export const ENCRYPTED_SERVICE_ID = 'all-young-scanner-encrypted-backup';

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
  const aliases = {
    '선크림': '자외선 sunscreen sun protection', '자외선': '선크림 sunscreen sun protection',
    '따가움': '자극 불편 붉어짐 irritation', '트러블': '자극 불편 붉어짐 irritation',
    '간단': '최소 기본 심플 minimal', '여행': '휴대 travel', '운동': '땀 workout',
    '보습': '건조 수분 moisturizer', '세안': '클렌징 씻기 cleanser',
  };
  const normalizedQuery = normalizeText(query);
  const matches = (terms) => guides.filter((guide) => {
    const categoryMatch = category === 'all' || guide.category === category || guide.content_type === category;
    const haystack = normalizeText([guide.title, guide.summary, guide.category, guide.content_type, ...(guide.tags || [])].join(' '));
    return categoryMatch && (!normalizedQuery || terms.some((term) => term && haystack.includes(term)));
  });
  const exact = matches([normalizedQuery]);
  if (!normalizedQuery || exact.length || !aliases[normalizedQuery]) return exact;
  return matches(normalizeText(aliases[normalizedQuery]).split(' '));
}

function validDate(value, today) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value <= today && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function emptyState() {
  return {
    schema_version: SCHEMA_VERSION, service_id: SERVICE_ID, saved_guides: [], routine: null, checkins: [],
    plus: { routines: [], collections: [], settings: { insight_window: 30 } },
  };
}

function safeName(value, max = 40) {
  const text = String(value ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ');
  return text.slice(0, max);
}

function safeId(value) {
  return /^[a-z0-9-]{1,64}$/i.test(String(value ?? '')) ? String(value) : '';
}

function normalizePlus(candidate, valid) {
  const source = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : {};
  const routines = [];
  for (const row of Array.isArray(source.routines) ? source.routines : []) {
    if (!row || !safeId(row.id) || !safeName(row.name) || !allowedTimes.has(row.time) || !allowedContexts.has(row.context) || !allowedPaces.has(row.pace)) continue;
    routines.push({
      id: safeId(row.id), name: safeName(row.name), time: row.time, context: row.context, pace: row.pace,
      guide_slugs: [...new Set(Array.isArray(row.guide_slugs) ? row.guide_slugs.filter((slug) => valid.has(slug)) : [])].slice(0, 4),
      created_at: /^\d{4}-\d{2}-\d{2}$/.test(row.created_at || '') ? row.created_at : '',
    });
    if (routines.length === MAX_PLUS_ROUTINES) break;
  }
  const collections = [];
  for (const row of Array.isArray(source.collections) ? source.collections : []) {
    if (!row || !safeId(row.id) || !safeName(row.name)) continue;
    collections.push({ id: safeId(row.id), name: safeName(row.name), guide_slugs: [...new Set(Array.isArray(row.guide_slugs) ? row.guide_slugs.filter((slug) => valid.has(slug)) : [])].slice(0, 24) });
    if (collections.length === MAX_PLUS_COLLECTIONS) break;
  }
  return { routines, collections, settings: { insight_window: [30, 90].includes(Number(source.settings?.insight_window)) ? Number(source.settings.insight_window) : 30 } };
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
  return { schema_version: SCHEMA_VERSION, service_id: SERVICE_ID, saved_guides: saved, routine, checkins, plus: normalizePlus(candidate.plus, valid) };
}

export function saveRoutinePreset(state, preset, validSlugs, today = new Date().toISOString().slice(0, 10)) {
  const normalized = normalizeState(state, validSlugs, today);
  const name = safeName(preset?.name);
  const id = safeId(preset?.id);
  const routine = preset?.routine || normalized.routine;
  if (!id || !name || !routine) throw new Error('PLUS_ROUTINE_INVALID');
  const candidate = { ...normalized, plus: { ...normalized.plus, routines: [...normalized.plus.routines.filter((row) => row.id !== id), { id, name, ...routine, created_at: today }] } };
  const next = normalizeState(candidate, validSlugs, today);
  if (!next.plus.routines.some((row) => row.id === id)) throw new Error('PLUS_ROUTINE_LIMIT');
  return next;
}

export function removeRoutinePreset(state, id, validSlugs) {
  const normalized = normalizeState(state, validSlugs);
  return { ...normalized, plus: { ...normalized.plus, routines: normalized.plus.routines.filter((row) => row.id !== id) } };
}

export function compareRoutines(left, right) {
  if (!left || !right) throw new Error('PLUS_COMPARE_INVALID');
  const leftSlugs = new Set(left.guide_slugs || []); const rightSlugs = new Set(right.guide_slugs || []);
  return {
    same: left.time === right.time && left.context === right.context && left.pace === right.pace,
    conditions: ['time', 'context', 'pace'].filter((key) => left[key] !== right[key]),
    shared: [...leftSlugs].filter((slug) => rightSlugs.has(slug)),
    only_left: [...leftSlugs].filter((slug) => !rightSlugs.has(slug)),
    only_right: [...rightSlugs].filter((slug) => !leftSlugs.has(slug)),
  };
}

export function summarizeCheckins(checkins, days = 30, today = new Date().toISOString().slice(0, 10)) {
  if (![30, 90].includes(Number(days))) throw new Error('PLUS_WINDOW_INVALID');
  const start = new Date(`${today}T00:00:00Z`); start.setUTCDate(start.getUTCDate() - Number(days) + 1);
  const rows = (Array.isArray(checkins) ? checkins : []).filter((row) => validDate(row?.date, today) && new Date(`${row.date}T00:00:00Z`) >= start);
  const completed = rows.filter((row) => row.completed).length;
  const comfortTotal = rows.reduce((sum, row) => sum + Number(row.comfort || 0), 0);
  return { days: Number(days), total: rows.length, completed, completion_rate: rows.length ? Math.round((completed / rows.length) * 100) : 0, average_comfort: rows.length ? Math.round((comfortTotal / rows.length) * 10) / 10 : 0, irritation_count: rows.filter((row) => row.irritation).length };
}

export function buildSafetyInsights(summary) {
  if (!summary || summary.total < 3) return ['점검을 3회 이상 남기면 주간 경향을 보여드려요.'];
  const messages = [`최근 ${summary.days}일 중 ${summary.total}회 기록했고, 루틴 실행률은 ${summary.completion_rate}%예요.`];
  if (summary.irritation_count > 0) messages.push(`불편 신호가 ${summary.irritation_count}회 기록됐어요. 새로 추가한 제품을 멈추고 증상이 계속되면 전문가에게 확인하세요.`);
  else messages.push(`기록된 불편 신호는 없고 평균 편안함은 ${summary.average_comfort}/5예요.`);
  messages.push('이 요약은 기기 기록을 단순 계산한 일반 정보이며 의료 판단이 아닙니다.');
  return messages;
}

export function upsertCollection(state, collection, validSlugs) {
  const normalized = normalizeState(state, validSlugs);
  const id = safeId(collection?.id); const name = safeName(collection?.name);
  if (!id || !name) throw new Error('PLUS_COLLECTION_INVALID');
  const next = normalizeState({ ...normalized, plus: { ...normalized.plus, collections: [...normalized.plus.collections.filter((row) => row.id !== id), { id, name, guide_slugs: collection.guide_slugs || [] }] } }, validSlugs);
  if (!next.plus.collections.some((row) => row.id === id)) throw new Error('PLUS_COLLECTION_LIMIT');
  return next;
}

export function removeCollection(state, id, validSlugs) {
  const normalized = normalizeState(state, validSlugs);
  return { ...normalized, plus: { ...normalized.plus, collections: normalized.plus.collections.filter((row) => row.id !== id) } };
}

function icsEscape(value) { return String(value ?? '').replace(/\\/g, '\\\\').replace(/[,;]/g, '\\$&').replace(/\r?\n/g, '\\n'); }
export function makeCalendarIcs(routine, startDate = new Date().toISOString().slice(0, 10)) {
  if (!routine || !validDate(startDate, '9999-12-31')) throw new Error('PLUS_CALENDAR_INVALID');
  const time = routine.time === 'evening' ? '200000' : '080000';
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//All Young Scanner//Routine//KO','CALSCALE:GREGORIAN','BEGIN:VEVENT',`UID:${icsEscape(routine.id || 'current-routine')}@all-young-scanner`,`DTSTART:${startDate.replaceAll('-', '')}T${time}`,`SUMMARY:${icsEscape(`올영스캐너 ${routine.name || '내 루틴'}`)}`,'DESCRIPTION:제품 표시사항을 먼저 확인하고 불편 신호가 있으면 사용을 중단하세요.','RRULE:FREQ=DAILY','END:VEVENT','END:VCALENDAR',''].join('\r\n');
}

export function buildPrintReport(state, validSlugs, today = new Date().toISOString().slice(0, 10)) {
  const normalized = normalizeState(state, validSlugs, today); const summary = summarizeCheckins(normalized.checkins, 30, today);
  return { title: '올영스캐너 30일 기록 요약', generated_on: today, saved_guides: normalized.saved_guides.length, saved_routines: normalized.plus.routines.length, collections: normalized.plus.collections.length, summary, insights: buildSafetyInsights(summary), medical_disclaimer: '일반 정보이며 의료 진단이나 치료를 대신하지 않습니다.' };
}

function bytesToBase64(bytes) { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function base64ToBytes(value) { const binary = atob(value); return Uint8Array.from(binary, (char) => char.charCodeAt(0)); }
export async function encryptBackup(text, password, cryptoImpl = globalThis.crypto) {
  if (typeof text !== 'string' || !password || String(password).length < 8 || !cryptoImpl?.subtle) throw new Error('ENCRYPTED_BACKUP_INPUT_INVALID');
  const salt = cryptoImpl.getRandomValues(new Uint8Array(16)); const iv = cryptoImpl.getRandomValues(new Uint8Array(12)); const encoder = new TextEncoder();
  const material = await cryptoImpl.subtle.importKey('raw', encoder.encode(String(password)), 'PBKDF2', false, ['deriveKey']);
  const key = await cryptoImpl.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const cipher = await cryptoImpl.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(text));
  return JSON.stringify({ service_id: ENCRYPTED_SERVICE_ID, version: 1, kdf: 'PBKDF2-SHA256', iterations: 150000, cipher: 'AES-256-GCM', salt: bytesToBase64(salt), iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(cipher)) }, null, 2);
}

export async function decryptBackup(text, password, cryptoImpl = globalThis.crypto) {
  let parsed; try { parsed = JSON.parse(text); } catch { throw new Error('ENCRYPTED_BACKUP_INVALID'); }
  if (!parsed || parsed.service_id !== ENCRYPTED_SERVICE_ID || parsed.version !== 1 || parsed.iterations !== 150000 || !password || !cryptoImpl?.subtle) throw new Error('ENCRYPTED_BACKUP_INVALID');
  try {
    const encoder = new TextEncoder(); const material = await cryptoImpl.subtle.importKey('raw', encoder.encode(String(password)), 'PBKDF2', false, ['deriveKey']);
    const key = await cryptoImpl.subtle.deriveKey({ name: 'PBKDF2', salt: base64ToBytes(parsed.salt), iterations: parsed.iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    return new TextDecoder().decode(await cryptoImpl.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(parsed.iv) }, key, base64ToBytes(parsed.data)));
  } catch { throw new Error('ENCRYPTED_BACKUP_DECRYPT_FAILED'); }
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

  function renderPlus() {
    const routines = state.plus.routines;
    root.querySelector('#plus-routine-list').replaceChildren(...(routines.length ? routines.map((row) => el('li', {}, [
      el('strong', { text: row.name }), el('span', { text: ` · ${row.time === 'morning' ? '아침' : '저녁'} · 가이드 ${row.guide_slugs.length}개` }),
      el('button', { type: 'button', className: 'text-link', 'data-remove-routine': row.id, text: '삭제' }),
    ])) : [el('li', { className: 'empty-copy', text: '저장 루틴이 없습니다. 먼저 내 루틴을 만든 뒤 저장하세요.' })]));
    for (const id of ['#compare-left', '#compare-right']) {
      const select = root.querySelector(id); const previous = select.value;
      select.replaceChildren(el('option', { value: '', text: '루틴 선택' }), ...routines.map((row) => el('option', { value: row.id, text: row.name })));
      if (routines.some((row) => row.id === previous)) select.value = previous;
    }
    root.querySelector('#insight-window').value = String(state.plus.settings.insight_window);
    const summary = summarizeCheckins(state.checkins, state.plus.settings.insight_window);
    const stats = [
      ['기록', `${summary.total}회`], ['실행률', `${summary.completion_rate}%`], ['편안함', `${summary.average_comfort}/5`],
      ['불편 신호', `${summary.irritation_count}회`], ['저장 루틴', `${routines.length}/10`], ['모음', `${state.plus.collections.length}/5`],
    ];
    root.querySelector('#plus-stats').replaceChildren(...stats.map(([label, value]) => el('div', { className: 'stat' }, [el('strong', { text: value }), el('span', { text: label })])));
    root.querySelector('#plus-insights').replaceChildren(...buildSafetyInsights(summary).map((message) => el('li', { text: message })));
    const savedGuides = state.saved_guides.map((slug) => guideBySlug.get(slug)).filter(Boolean);
    root.querySelector('#collection-guides').replaceChildren(...(savedGuides.length ? savedGuides.map((guide) => {
      const checkbox = el('input', { type: 'checkbox', name: 'collection-guide', value: guide.slug });
      return el('label', {}, [checkbox, el('span', { text: guide.title })]);
    }) : [el('p', { className: 'empty-copy', text: '먼저 가이드를 기기에 저장하세요.' })]));
    root.querySelector('#collection-list').replaceChildren(...(state.plus.collections.length ? state.plus.collections.map((row) => el('li', {}, [
      el('strong', { text: row.name }), el('span', { text: ` · 가이드 ${row.guide_slugs.length}개` }),
      el('button', { type: 'button', className: 'text-link', 'data-remove-collection': row.id, text: '삭제' }),
    ])) : [el('li', { className: 'empty-copy', text: '만든 모음이 없습니다.' })]));
  }

  function downloadText(text, type, filename) {
    const blob = new Blob([text], { type }); const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = filename; link.click(); URL.revokeObjectURL(link.href);
  }

  function persist(message) {
    saveState(storage, state);
    renderFeatured(); renderGuides(); renderRoutine(); renderRecords(); renderPlus(); announce(message);
  }

  function showView(name, pushHash = true) {
    const allowed = ['home', 'routine', 'guides', 'records', 'plus'];
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
      return;
    }
    const removeRoutine = event.target.closest('[data-remove-routine]');
    if (removeRoutine) {
      state = removeRoutinePreset(state, removeRoutine.dataset.removeRoutine, validSlugs); persist('저장 루틴을 삭제했습니다.'); return;
    }
    const removeCollectionButton = event.target.closest('[data-remove-collection]');
    if (removeCollectionButton) {
      state = removeCollection(state, removeCollectionButton.dataset.removeCollection, validSlugs); persist('가이드 모음을 삭제했습니다.');
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

  root.querySelector('#plus-routine-form').addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      state = saveRoutinePreset(state, { id: `routine-${Date.now().toString(36)}`, name: root.querySelector('#plus-routine-name').value }, validSlugs);
      event.currentTarget.reset(); persist('현재 루틴을 Plus에 저장했습니다.');
    } catch (error) { announce(error.message === 'PLUS_ROUTINE_LIMIT' ? '저장 루틴은 최대 10개입니다.' : '먼저 내 루틴을 만들고 이름을 입력하세요.'); }
  });

  root.querySelector('#compare-routines').addEventListener('click', () => {
    const left = state.plus.routines.find((row) => row.id === root.querySelector('#compare-left').value);
    const right = state.plus.routines.find((row) => row.id === root.querySelector('#compare-right').value);
    try {
      const result = compareRoutines(left, right); const target = root.querySelector('#compare-result'); target.replaceChildren();
      target.append(el('strong', { text: result.same ? '조건이 같은 루틴입니다.' : `다른 조건 ${result.conditions.length}개` }), el('p', { text: `공통 가이드 ${result.shared.length}개 · 첫 번째만 ${result.only_left.length}개 · 두 번째만 ${result.only_right.length}개` }));
    } catch { announce('서로 비교할 두 루틴을 선택하세요.'); }
  });

  root.querySelector('#insight-window').addEventListener('change', (event) => {
    state.plus.settings.insight_window = Number(event.target.value); persist(`${event.target.value}일 기록으로 다시 계산했습니다.`);
  });

  root.querySelector('#collection-form').addEventListener('submit', (event) => {
    event.preventDefault(); const selected = [...event.currentTarget.querySelectorAll('input[name="collection-guide"]:checked')].map((input) => input.value);
    try {
      state = upsertCollection(state, { id: `collection-${Date.now().toString(36)}`, name: root.querySelector('#collection-name').value, guide_slugs: selected }, validSlugs);
      event.currentTarget.reset(); persist('가이드 모음을 저장했습니다.');
    } catch (error) { announce(error.message === 'PLUS_COLLECTION_LIMIT' ? '가이드 모음은 최대 5개입니다.' : '모음 이름을 입력하세요.'); }
  });

  root.querySelector('#download-calendar').addEventListener('click', () => {
    if (!state.routine) { announce('먼저 내 루틴을 만드세요.'); return; }
    downloadText(makeCalendarIcs(state.routine), 'text/calendar;charset=utf-8', 'all-young-routine.ics'); announce('개인정보 없는 일정 파일을 만들었습니다.');
  });

  root.querySelector('#print-report').addEventListener('click', () => {
    const report = buildPrintReport(state, validSlugs); const target = root.querySelector('#printable-report');
    target.replaceChildren(el('h1', { text: report.title }), el('p', { text: `작성일 ${report.generated_on}` }), el('p', { text: `저장 가이드 ${report.saved_guides}개 · 저장 루틴 ${report.saved_routines}개 · 모음 ${report.collections}개` }), el('p', { text: `30일 기록 ${report.summary.total}회 · 실행률 ${report.summary.completion_rate}% · 평균 편안함 ${report.summary.average_comfort}/5 · 불편 신호 ${report.summary.irritation_count}회` }), el('ul', {}, report.insights.map((message) => el('li', { text: message }))), el('p', { text: report.medical_disclaimer }));
    window.print();
  });

  root.querySelector('#export-encrypted').addEventListener('click', async () => {
    const password = root.querySelector('#encrypt-password').value;
    try { downloadText(await encryptBackup(makeBackup(state, validSlugs), password), 'application/json', `all-young-encrypted-${new Date().toISOString().slice(0, 10)}.json`); announce('전체 기록을 암호화해 백업 파일을 만들었습니다.'); }
    catch { announce('암호화 백업 암호는 8자 이상 입력하세요.'); }
  });

  root.querySelector('#import-encrypted').addEventListener('click', async () => {
    const file = root.querySelector('#encrypted-file').files?.[0]; const password = root.querySelector('#encrypt-password').value;
    if (!file) { announce('암호화 백업 파일을 먼저 선택하세요.'); return; }
    try { const backup = parseBackup(await decryptBackup(await file.text(), password), validSlugs); state = backup.data; persist('암호화 백업의 전체 기록을 가져왔습니다.'); }
    catch { announce('파일 또는 암호가 맞지 않아 가져오지 못했습니다.'); }
  });

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
  root.querySelector('#confirm-delete').addEventListener('click', () => { state = emptyState(); storage.removeItem(STORAGE_KEY); dialog.close(); renderFeatured(); renderGuides(); renderRoutine(); renderRecords(); renderPlus(); announce('이 기기의 올영스캐너 기록을 모두 삭제했습니다.'); });

  renderFeatured(); renderGuides(); renderRoutine(); renderRecords(); renderPlus(); showView(location.hash.slice(1), false);
  root.documentElement.dataset.appReady = 'true';
  return { guides, getState: () => state, showView };
}
