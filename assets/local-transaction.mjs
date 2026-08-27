// Local-only best-effort transaction for small JSON preferences.
// It never sends data and rolls prior writes back if a later write fails.
function validEntries(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('transaction_values_invalid');
  const entries = Object.entries(values);
  if (!entries.length) throw new Error('transaction_values_invalid');
  if (entries.some(([key]) => typeof key !== 'string' || !key || /[\u0000-\u001F]/.test(key))) throw new Error('transaction_keys_invalid');
  if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new Error('transaction_duplicate_key');
  return entries.map(([key, value]) => [key, JSON.stringify(value)]);
}

function restore(storage, previous) {
  try {
    for (const [key, raw] of [...previous].reverse()) {
      if (raw === null) storage.removeItem(key);
      else storage.setItem(key, raw);
      if (storage.getItem(key) !== raw) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function writeJsonTransaction(storage, values) {
  const entries = validEntries(values);
  let previous = [];
  try {
    previous = entries.map(([key]) => [key, storage.getItem(key)]);
    for (const [key, raw] of entries) {
      storage.setItem(key, raw);
      if (storage.getItem(key) !== raw) throw new Error('transaction_write_unverified');
    }
    return {
      ok:true,
      rollback:() => restore(storage, previous),
    };
  } catch {
    return {
      ok:false,
      rollbackOk:previous.length ? restore(storage, previous) : false,
    };
  }
}
