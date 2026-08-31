const OBSERVATION_KEY = 'ays.stage2.observations.v1';
const MAX_OBSERVATIONS = 366;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const allowed = {
  sleep: new Set(['under-5h', '5-7h', '7h-plus', 'not-recorded']),
  cycle: new Set(['not-recorded', 'menstrual', 'follicular', 'ovulation', 'luteal', 'not-applicable']),
  environment: new Set(['normal', 'humid', 'dry', 'travel', 'workout']),
  comfort: new Set([1, 2, 3, 4, 5]),
};

function clean(value, max = 120) {
  return String(value ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)); }
function bytesToBase64(bytes) { let text = ''; for (const byte of bytes) text += String.fromCharCode(byte); return btoa(text); }
function base64ToBytes(value) { const text = atob(value); return Uint8Array.from(text, (char) => char.charCodeAt(0)); }

export function normalizeObservation(input, now = new Date()) {
  const date = clean(input.date, 10);
  const comfort = Number(input.comfort);
  if (!validDate(date) || date > now.toISOString().slice(0, 10)) throw new Error('OBSERVATION_DATE_INVALID');
  if (!allowed.sleep.has(input.sleep) || !allowed.cycle.has(input.cycle) || !allowed.environment.has(input.environment) || !allowed.comfort.has(comfort)) throw new Error('OBSERVATION_VALUE_INVALID');
  const discomfort = [...new Set((Array.isArray(input.discomfort) ? input.discomfort : []).map((value) => clean(value, 40)).filter(Boolean))].slice(0, 8);
  return {
    schema_version: 1,
    id: clean(input.id, 80) || crypto.randomUUID(),
    date,
    product_id: clean(input.product_id, 100) || null,
    formulation_id: clean(input.formulation_id, 140) || null,
    sleep: input.sleep,
    cycle: input.cycle,
    environment: input.environment,
    comfort,
    discomfort,
    photo: input.photo ? { name: clean(input.photo.name, 100), type: clean(input.photo.type, 80), captured_on: date, stored: false } : null,
    created_at: clean(input.created_at, 30) || now.toISOString(),
  };
}

export function analyzeObservations(records, { windowDays = 90, now = new Date() } = {}) {
  const cutoff = now.getTime() - windowDays * 86400000;
  const selected = records.filter((row) => validDate(row.date) && Date.parse(`${row.date}T23:59:59Z`) >= cutoff);
  const average = selected.length ? selected.reduce((sum, row) => sum + Number(row.comfort || 0), 0) / selected.length : null;
  const discomfortDays = selected.filter((row) => row.discomfort?.length).length;
  return {
    window_days: windowDays,
    observations: selected.length,
    average_comfort: average === null ? null : Number(average.toFixed(2)),
    discomfort_days: discomfortDays,
    network_requests: 0,
    interpretation: selected.length < 7 ? '기록이 7일 미만이라 경향을 판단하지 않습니다.' : '같은 기간의 동반 변화만 보여주며 원인·효과를 판정하지 않습니다.',
    causal_claim_allowed: false,
  };
}

export function compareIngredientLabels(left = [], right = []) {
  const a = new Set(left.map((value) => clean(value).toLocaleLowerCase('en-US')).filter(Boolean));
  const b = new Set(right.map((value) => clean(value).toLocaleLowerCase('en-US')).filter(Boolean));
  return {
    overlap: [...a].filter((value) => b.has(value)).sort(),
    only_left: [...a].filter((value) => !b.has(value)).sort(),
    only_right: [...b].filter((value) => !a.has(value)).sort(),
    concentration_known: false,
    interaction_claim_allowed: false,
    notice: '표시 성분명의 겹침만 비교합니다. 농도·제형·상호작용·개인 안전성을 뜻하지 않습니다.',
  };
}

export function createDecisionCard({ product, observationSummary, rationale = [] }) {
  if (!product?.id || !product?.formulation_versions?.[0]?.id) throw new Error('FORMULATION_EVIDENCE_REQUIRED');
  return {
    schema_version: 1,
    product_id: product.id,
    formulation_id: product.formulation_versions[0].id,
    source_url: product.source_url,
    observation_summary: observationSummary,
    rationale: rationale.map((value) => clean(value, 240)).filter(Boolean).slice(0, 6),
    recommendation_score: null,
    medical_assessment: null,
    notice: '개인 기록과 표시 사실을 다시 보기 위한 카드이며 구매 추천이나 의료 판단이 아닙니다.',
  };
}

export async function encryptTransfer(payload, password, cryptoApi = crypto) {
  if (String(password).length < 8) throw new Error('PASSWORD_TOO_SHORT');
  const salt = cryptoApi.getRandomValues(new Uint8Array(16));
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const baseKey = await cryptoApi.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await cryptoApi.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await cryptoApi.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(payload))));
  return { schema_version: 1, cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: 210000, salt: bytesToBase64(salt), iv: bytesToBase64(iv), ciphertext: bytesToBase64(ciphertext) };
}

export async function decryptTransfer(bundle, password, cryptoApi = crypto) {
  if (bundle?.cipher !== 'AES-256-GCM' || bundle?.kdf !== 'PBKDF2-SHA256' || bundle?.iterations !== 210000) throw new Error('TRANSFER_FORMAT_INVALID');
  const baseKey = await cryptoApi.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await cryptoApi.subtle.deriveKey({ name: 'PBKDF2', salt: base64ToBytes(bundle.salt), iterations: 210000, hash: 'SHA-256' }, baseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return JSON.parse(decoder.decode(await cryptoApi.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(bundle.iv) }, key, base64ToBytes(bundle.ciphertext))));
}

export function previewTransferConflict(current, incoming) {
  const currentRows = Array.isArray(current?.observations) ? current.observations : [];
  const incomingRows = Array.isArray(incoming?.observations) ? incoming.observations : [];
  const currentIds = new Set(currentRows.map((row) => row.id));
  return { current_count: currentRows.length, incoming_count: incomingRows.length, duplicate_ids: incomingRows.filter((row) => currentIds.has(row.id)).map((row) => row.id), requires_explicit_apply: true, rollback_copy: structuredClone(current ?? { observations: [] }) };
}

export function applyTransfer(current, incoming, { confirmed = false } = {}) {
  if (!confirmed) throw new Error('EXPLICIT_CONFIRMATION_REQUIRED');
  const rollback = structuredClone(current ?? { observations: [] });
  const merged = new Map((current?.observations || []).map((row) => [row.id, row]));
  for (const row of incoming?.observations || []) merged.set(row.id, row);
  return { value: { schema_version: 1, observations: [...merged.values()].slice(-MAX_OBSERVATIONS) }, rollback };
}

export function moderateReview(review, existingFingerprints = new Set()) {
  const body = clean(review?.body, 1200);
  const normalized = body.toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  let hash = 2166136261; for (const char of normalized) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const fingerprint = hash.toString(16).padStart(8, '0');
  const reasons = [];
  if (body.length < 40) reasons.push('too_short');
  if (existingFingerprints.has(fingerprint)) reasons.push('duplicate');
  if (/discount|coupon|promo|구매 링크|할인 코드|완치|치료|부작용 없음/i.test(body)) reasons.push('promotional_or_medical_claim');
  if (review?.compensated === true) reasons.push('compensated_review');
  return { status: reasons.length ? 'quarantined' : 'pending_human_review', reasons, fingerprint, public: false };
}

export function buildAnonymousAggregate(records, { consent = false, participantCount = 0 } = {}) {
  if (!consent) throw new Error('EXPLICIT_CONSENT_REQUIRED');
  if (participantCount < 20) throw new Error('MINIMUM_COHORT_NOT_MET');
  const summary = analyzeObservations(records);
  return { schema_version: 1, participants: participantCount, observations: summary.observations, average_comfort: summary.average_comfort, discomfort_days: summary.discomfort_days, raw_records_included: false, identifiers_included: false };
}

export const countryAvailability = Object.freeze({
  KR: { language: 'ko', information: true, purchasing: false, currency: 'KRW', seller_count: 0 },
  US: { language: 'en', information: true, purchasing: false, currency: 'USD', seller_count: 0 },
});

function loadObservations(storage) {
  try { const value = JSON.parse(storage.getItem(OBSERVATION_KEY) || '[]'); return Array.isArray(value) ? value.slice(-MAX_OBSERVATIONS) : []; } catch { return []; }
}
function element(tag, text, className) { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; }

export function mountStage2V4({ storage = localStorage } = {}) {
  const root = document.querySelector('[data-view="more"] .more-grid');
  if (!root) return false;
  const observations = loadObservations(storage);
  const panel = element('section', '', 'panel'); panel.id = 'stage2-local-panel';
  panel.append(element('h2', '내 변화 기록'), element('p', '수면·환경·편안함을 기기 안에서만 함께 봅니다. 사진 원본은 저장하거나 전송하지 않습니다.'));
  const add = element('button', '오늘 예시 관찰 추가', 'secondary-button'); add.type = 'button'; add.id = 'add-stage2-observation';
  const summary = element('p', '', 'status-line'); summary.id = 'stage2-observation-summary';
  const refresh = () => { const result = analyzeObservations(observations); summary.textContent = `최근 ${result.observations}개 기록 · 평균 편안함 ${result.average_comfort ?? '아직 없음'} · ${result.interpretation}`; };
  add.addEventListener('click', () => {
    const today = new Date().toISOString().slice(0, 10);
    observations.push(normalizeObservation({ date: today, sleep: 'not-recorded', cycle: 'not-recorded', environment: 'normal', comfort: 3, discomfort: [] }));
    storage.setItem(OBSERVATION_KEY, JSON.stringify(observations.slice(-MAX_OBSERVATIONS))); refresh();
  });
  panel.append(add, summary); refresh();

  const countries = element('section', '', 'panel'); countries.id = 'stage2-country-panel';
  countries.append(element('h2', '국가별 제공 상태'), element('p', '한국어·영어 정보는 제공하지만 검증 판매처가 없어 구매 기능은 열지 않습니다.'));
  const list = element('ul', '', 'plus-list');
  for (const [code, status] of Object.entries(countryAvailability)) list.append(element('li', `${code} · ${status.language} 정보 제공 · 구매 ${status.purchasing ? '가능' : '대기'} · 승인 판매처 ${status.seller_count}`));
  countries.append(list);
  root.append(panel, countries);
  document.documentElement.dataset.stage2Ready = 'true';
  return true;
}
