// Shared by the service and Node's dependency-free tests. Never sends records over the network.
export const RECORD_KEY = 'ays-alpha-decisions-v01';
export const ORIGINAL_KEY = 'ays-alpha-decisions-v01-before-v2';
export const REPLACEMENT_KEY = 'ays-decisions-before-explicit-replace-v2';
export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_RECORDS = 1000;
export const FORMAT = 'allyoung-decision-library';
const byteLength = (value) => new TextEncoder().encode(value).length;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

function safeTree(value, depth = 0) {
  if (depth > 16) throw new Error('기록의 중첩 단계가 너무 많습니다.');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('숫자 형식이 올바르지 않습니다.');
  if (object(value) || Array.isArray(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('허용하지 않는 기록 항목입니다.');
      safeTree(item, depth + 1);
    }
  }
}

export function parseBounded(text) {
  if (typeof text !== 'string' || byteLength(text) > MAX_BYTES) throw new Error('파일은 2MB 이하여야 합니다.');
  const value = JSON.parse(text);
  safeTree(value);
  return value;
}

function boundedString(value, fallback, limit = 500) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || value.length > limit) throw new Error('기록의 글자 형식 또는 길이가 올바르지 않습니다.');
  return value;
}

export function normalizeRecords(input) {
  if (!Array.isArray(input) || input.length > MAX_RECORDS) throw new Error('기록은 최대 1,000개까지 가능합니다.');
  const cloned = parseBounded(JSON.stringify(input));
  const result = [];
  const ids = new Map();
  for (const [index, record] of cloned.entries()) {
    if (!object(record)) throw new Error('읽을 수 없는 기록이 있습니다. 원본을 유지합니다.');
    if (record.schema_version !== undefined && record.schema_version !== 2) throw new Error('지원하지 않는 기록 판입니다.');
    const selected = record.selected_at ?? record.created_at ?? '1970-01-01T00:00:00.000Z';
    if (typeof selected !== 'string' || !Number.isFinite(Date.parse(selected))) throw new Error('기록 날짜가 올바르지 않습니다.');
    const reasons = record.reasons ?? (record.reason ? [record.reason] : ['이전에 저장한 선택입니다.']);
    if (!Array.isArray(reasons) || reasons.length > 20 || reasons.some((x) => typeof x !== 'string' || x.length > 1000)) throw new Error('선택 이유 형식이 올바르지 않습니다.');
    if (record.metadata !== undefined && !object(record.metadata)) throw new Error('사용 기록 형식이 올바르지 않습니다.');
    const next = {
      ...record,
      id: boundedString(record.id, `legacy-${index}-${selected}`, 160),
      product_id: boundedString(record.product_id, `legacy-product-${index}`, 160),
      name: boundedString(record.name, '이전 기록'),
      brand: boundedString(record.brand, '브랜드 미확인'),
      selected_at: selected,
      reasons,
      metadata: record.metadata ?? {},
      schema_version: 2,
      product_data_version: boundedString(record.product_data_version, 'legacy-unknown', 120),
      score_version: boundedString(record.score_version, 'legacy-unknown', 120),
    };
    const previous = ids.get(next.id);
    if (previous && canonical(previous) !== canonical(next)) throw new Error('같은 식별값의 서로 다른 기록이 있습니다. 원본을 유지합니다.');
    if (!previous) { result.push(next); ids.set(next.id, next); }
  }
  if (byteLength(JSON.stringify(result)) > MAX_BYTES / 2) throw new Error('기록 크기가 1MB를 넘습니다.');
  return result;
}

// Keep raw bytes until backup succeeds. No write occurs for corrupt or future-version data.
export function openStore(storage) {
  let raw = null;
  let records = [];
  try {
    raw = storage.getItem(RECORD_KEY);
    records = normalizeRecords(raw === null ? [] : parseBounded(raw));
    const serialized = JSON.stringify(records);
    const changed = raw !== null && raw !== serialized;
    if (changed) {
      if (storage.getItem(ORIGINAL_KEY) === null) {
        storage.setItem(ORIGINAL_KEY, raw);
        if (storage.getItem(ORIGINAL_KEY) !== raw) throw new Error('backup');
      }
      storage.setItem(RECORD_KEY, serialized);
      if (storage.getItem(RECORD_KEY) !== serialized) throw new Error('verification');
      raw = serialized;
    }
    return { records, raw, mode: 'persistent', issue: '', migrated: changed };
  } catch {
    return { records, raw, mode: 'memory', issue: records.length ? 'storage' : 'unreadable', migrated: false };
  }
}

export function saveRecords(storage, expectedRaw, records, { replace = false } = {}) {
  let normalized;
  try {
    normalized = normalizeRecords(records);
    if (storage.getItem(RECORD_KEY) !== expectedRaw) return { ok: false, issue: 'conflict', records: normalized };
    if (replace && expectedRaw !== null) {
      // A second replacement must not overwrite the previous recovery copy.
      if (storage.getItem(REPLACEMENT_KEY) !== null && storage.getItem(REPLACEMENT_KEY) !== expectedRaw) return { ok: false, issue: 'backup_exists', records: normalized };
      storage.setItem(REPLACEMENT_KEY, expectedRaw);
      if (storage.getItem(REPLACEMENT_KEY) !== expectedRaw) throw new Error('backup');
    }
    const raw = JSON.stringify(normalized);
    storage.setItem(RECORD_KEY, raw);
    if (storage.getItem(RECORD_KEY) !== raw) throw new Error('verification');
    return { ok: true, records: normalized, raw };
  } catch {
    return { ok: false, issue: normalized ? 'storage' : 'invalid', records: normalized ?? records };
  }
}

export function availability(record, catalog = []) {
  if (record.renewal_state === 'withdrawn' || record.renewal_state === 'quarantined') return '현재 이용 불가';
  const product = catalog.find((item) => item.id === record.product_id);
  return product?.public_allowed === true && product?.rights_state === 'approved' && !product?.is_synthetic
    ? '현재 상품 정보 확인 가능' : '현재 상품 정보 확인 불가';
}

async function digest(value) {
  const data = new TextEncoder().encode(canonical(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createBackup(records, date = new Date().toISOString()) {
  const decisions = normalizeRecords(records);
  const body = { format: FORMAT, version: 4, schema_version: 2, exported_at: date, count: decisions.length, decisions };
  return { ...body, checksum: { algorithm: 'SHA-256', value: await digest(body) } };
}

export function deleteKnownKeys(storage, keys) {
  try {
    for (const key of keys) storage.removeItem(key);
    return { ok: keys.every((key) => storage.getItem(key) === null) };
  } catch { return { ok: false }; }
}

export async function inspectBackup(text) {
  const payload = parseBounded(text);
  if (!object(payload) || ![1, 2, 3, 4].includes(payload.version) || !Array.isArray(payload.decisions)) throw new Error('올영스캐너 백업 형식이 아닙니다.');
  if (payload.format !== undefined && payload.format !== FORMAT) throw new Error('다른 서비스의 파일입니다.');
  if (payload.version === 4) {
    const { checksum, ...body } = payload;
    if (payload.format !== FORMAT || payload.schema_version !== 2 || payload.count !== payload.decisions.length || !Number.isFinite(Date.parse(payload.exported_at)) || checksum?.algorithm !== 'SHA-256' || !/^[a-f0-9]{64}$/.test(checksum?.value)) throw new Error('백업 정보가 올바르지 않습니다.');
    if (await digest(body) !== checksum.value) throw new Error('파일 내용이 변경되었거나 손상되었습니다.');
  }
  return { records: normalizeRecords(payload.decisions), integrity: payload.version === 4 ? 'verified' : 'legacy_unverified' };
}

export function previewImport(existing, imported, mode = 'merge') {
  if (!['merge', 'replace'].includes(mode)) throw new Error('복원 방식이 올바르지 않습니다.');
  const current = normalizeRecords(existing);
  const incoming = normalizeRecords(imported);
  const byId = new Map(current.map((record) => [record.id, record]));
  let duplicates = 0;
  let conflicts = 0;
  let added = 0;
  for (const record of incoming) {
    const previous = byId.get(record.id);
    if (!previous) { added++; byId.set(record.id, record); }
    else if (canonical(previous) === canonical(record)) duplicates++;
    else conflicts++;
  }
  const records = normalizeRecords(mode === 'replace' ? incoming : [...byId.values()]);
  return { records, added, duplicates, conflicts, removed: mode === 'replace' ? current.filter((record) => !incoming.some((x) => x.id === record.id)).length : 0 };
}
