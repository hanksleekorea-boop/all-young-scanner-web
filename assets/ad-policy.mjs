const PUBLISHER_PATTERN = /^ca-pub-\d{16}$/;
const SLOT_PATTERN = /^\d{6,20}$/;

export const SAFE_CONTEXT_FIELDS = Object.freeze(['language', 'region_group', 'device_class', 'page_kind', 'placement_id']);

export function validateAdvertisingConfig(config = {}) {
  const errors = [];
  if (config.provider !== 'google-adsense') errors.push('UNSUPPORTED_PROVIDER');
  if (!Array.isArray(config.allowed_page_kinds)) errors.push('ALLOWED_PAGES_REQUIRED');
  if (!Array.isArray(config.forbidden_page_kinds)) errors.push('FORBIDDEN_PAGES_REQUIRED');
  if (config.enabled && !PUBLISHER_PATTERN.test(config.publisher_id || '')) errors.push('PUBLISHER_ID_INVALID');
  if (config.enabled && !config.certified_cmp_ready) errors.push('CMP_NOT_READY');
  if (config.enabled && !config.operator_identity_confirmed) errors.push('OPERATOR_IDENTITY_NOT_CONFIRMED');
  return { valid: errors.length === 0, errors };
}

export function sanitizeAdContext(input = {}) {
  const output = {};
  for (const key of SAFE_CONTEXT_FIELDS) {
    if (typeof input[key] === 'string' && input[key].length <= 64) output[key] = input[key];
  }
  return output;
}

export function canActivateAdvertising({ config = {}, pageKind = '', slotName = '', consent = {} } = {}) {
  const validation = validateAdvertisingConfig(config);
  if (!validation.valid) return { allowed: false, reason: validation.errors[0] };
  if (!config.enabled) return { allowed: false, reason: 'ADS_DISABLED' };
  if (!config.allowed_page_kinds.includes(pageKind) || config.forbidden_page_kinds.includes(pageKind)) return { allowed: false, reason: 'PAGE_FORBIDDEN' };
  const slotId = config.slots?.[slotName] || '';
  if (!SLOT_PATTERN.test(slotId)) return { allowed: false, reason: 'SLOT_ID_INVALID' };
  if (consent.mode !== 'contextual') return { allowed: false, reason: 'CONSENT_NOT_GRANTED' };
  if (config.schema_version >= 2 && config.stage_two?.enabled) {
    if (consent.regional_ready !== true) return { allowed: false, reason: 'REGIONAL_POLICY_NOT_READY' };
  } else if (consent.cmp !== 'certified') return { allowed: false, reason: 'CMP_SIGNAL_MISSING' };
  return { allowed: true, reason: 'READY', slotId };
}

export function inferPageKind(pathname = '/', hash = '') {
  if (/\/guides\/[^/]+\/$/.test(pathname)) return 'guide-detail';
  if (/\/guides\/?$/.test(pathname)) return 'guide-index';
  if (pathname.endsWith('/privacy.html')) return 'privacy';
  if (pathname.endsWith('/terms.html')) return 'terms';
  if (pathname.endsWith('/cookies.html')) return 'cookies';
  if (pathname.endsWith('/advertising.html')) return 'advertising';
  if (pathname.endsWith('/privacy-choices.html')) return 'privacy-choices';
  if (pathname.endsWith('/support.html')) return 'support';
  if (pathname.endsWith('/progress.html')) return 'progress';
  const route = hash.replace(/^#/, '') || 'home';
  return ['home', 'routine', 'records', 'plus'].includes(route) ? route : 'home';
}
