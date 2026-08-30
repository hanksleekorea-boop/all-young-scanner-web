const KEY = 'ays-ad-privacy-v1';
const ALLOWED = new Set(['off', 'contextual']);

export function readPrivacyChoice(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage.getItem(KEY) || 'null');
    return value && ALLOWED.has(value.mode) ? value : { mode: 'off', updated_at: null };
  } catch { return { mode: 'off', updated_at: null }; }
}

export function savePrivacyChoice(mode, storage = globalThis.localStorage) {
  if (!ALLOWED.has(mode)) throw new Error('PRIVACY_CHOICE_INVALID');
  const value = { mode, updated_at: new Date().toISOString() };
  storage.setItem(KEY, JSON.stringify(value));
  globalThis.dispatchEvent?.(new CustomEvent('ays:privacy-choice', { detail: value }));
  return value;
}

function readTcf(timeoutMs = 400) {
  return new Promise((resolve) => {
    if (typeof globalThis.__tcfapi !== 'function') return resolve({ cmp: 'missing' });
    const timer = setTimeout(() => resolve({ cmp: 'timeout' }), timeoutMs);
    globalThis.__tcfapi('getTCData', 2, (data, success) => {
      clearTimeout(timer);
      resolve(success && data?.cmpStatus === 'loaded' ? { cmp: 'certified', tcString: Boolean(data.tcString) } : { cmp: 'invalid', tcString: false });
    });
  });
}

function readGpp(timeoutMs = 400) {
  return new Promise((resolve) => {
    if (typeof globalThis.__gpp !== 'function') return resolve({ gpp: 'missing', optOut: null });
    const timer = setTimeout(() => resolve({ gpp: 'timeout', optOut: null }), timeoutMs);
    try {
      globalThis.__gpp('getGPPData', (data, success) => {
        clearTimeout(timer);
        const optOut = typeof data?.optOut === 'boolean' ? data.optOut : null;
        resolve(success && typeof data?.gppString === 'string' && data.gppString.length > 0 && optOut !== null
          ? { gpp: 'valid', optOut }
          : { gpp: 'invalid', optOut: null });
      });
    } catch { clearTimeout(timer); resolve({ gpp: 'invalid', optOut: null }); }
  });
}

export async function resolveAdvertisingConsent(storage = globalThis.localStorage) {
  const choice = readPrivacyChoice(storage);
  if (choice.mode !== 'contextual') return { mode: 'off', cmp: 'not_required', tcf: 'not_requested', tc_string: false, gpp: 'not_requested', opt_out: null };
  const [tcf, gpp] = await Promise.all([readTcf(), readGpp()]);
  return { mode: 'contextual', cmp: tcf.cmp, tcf: tcf.cmp, tc_string: tcf.tcString, gpp: gpp.gpp, opt_out: gpp.optOut };
}

export const privacyChoiceKey = KEY;
