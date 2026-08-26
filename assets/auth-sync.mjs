const SESSION_KEY = 'ays-account-session-v01';
const MAX_SNAPSHOT_BYTES = 196_608;
const PROVIDERS = new Set(['google', 'apple']);

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validJwtLike(value) {
  return typeof value === 'string' && value.split('.').length === 3 && value.length < 20_000;
}

export function validateConfig(value, currentOrigin = globalThis.location?.origin || '') {
  if (!plainObject(value)) return { ok:false, reason:'config_missing' };
  const urlText = String(value.supabaseUrl || '').trim().replace(/\/$/, '');
  const anonKey = String(value.supabaseAnonKey || '').trim();
  if (!urlText || !anonKey) return { ok:false, reason:'config_incomplete' };
  let endpoint;
  try { endpoint = new URL(urlText); } catch { return { ok:false, reason:'endpoint_invalid' }; }
  if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.supabase.co') || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    return { ok:false, reason:'endpoint_untrusted' };
  }
  const redirectUrl = String(value.redirectUrl || `${currentOrigin || endpoint.origin}/`).trim();
  let redirect;
  try { redirect = new URL(redirectUrl); } catch { return { ok:false, reason:'redirect_invalid' }; }
  if (currentOrigin && redirect.origin !== currentOrigin) return { ok:false, reason:'redirect_untrusted' };
  if (redirect.protocol !== 'https:' && redirect.hostname !== 'localhost') return { ok:false, reason:'redirect_insecure' };
  return { ok:true, config:{ supabaseUrl:endpoint.origin, supabaseAnonKey:anonKey, redirectUrl:redirect.href } };
}

export async function loadConfig(fetcher = fetch, currentOrigin = globalThis.location?.origin || '') {
  try {
    const response = await fetcher('./auth-config.json', { cache:'no-store', headers:{accept:'application/json'} });
    if (!response.ok) return { ok:false, reason:'config_missing' };
    return validateConfig(await response.json(), currentOrigin);
  } catch {
    return { ok:false, reason:'config_unavailable' };
  }
}

export function sessionFromHash(hash) {
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const accessToken = params.get('access_token') || '';
  const refreshToken = params.get('refresh_token') || '';
  const expiresIn = Number(params.get('expires_in') || 0);
  if (!validJwtLike(accessToken) || !refreshToken || !Number.isFinite(expiresIn) || expiresIn <= 0) return null;
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + Math.min(expiresIn, 86_400) * 1_000,
    providerToken: params.get('provider_token') || null,
  };
}

export function loadStoredSession(store = globalThis.localStorage) {
  try {
    const value = JSON.parse(store.getItem(SESSION_KEY) || 'null');
    if (!plainObject(value) || !validJwtLike(value.accessToken) || typeof value.refreshToken !== 'string' || !value.refreshToken) return null;
    return { accessToken:value.accessToken, refreshToken:value.refreshToken, expiresAt:Number(value.expiresAt || 0), providerToken:null };
  } catch { return null; }
}

export function saveSession(session, store = globalThis.localStorage) {
  if (!session?.accessToken || !session?.refreshToken) throw new Error('session_invalid');
  store.setItem(SESSION_KEY, JSON.stringify({ accessToken:session.accessToken, refreshToken:session.refreshToken, expiresAt:session.expiresAt }));
}

export function clearSession(store = globalThis.localStorage) {
  try { store.removeItem(SESSION_KEY); } catch { /* storage can be unavailable */ }
}

export function oauthUrl(config, provider) {
  if (!config?.supabaseUrl || !PROVIDERS.has(provider)) throw new Error('oauth_unavailable');
  const url = new URL('/auth/v1/authorize', config.supabaseUrl);
  url.searchParams.set('provider', provider);
  url.searchParams.set('redirect_to', config.redirectUrl);
  return url.href;
}

export async function refreshSession(config, session, fetcher = fetch) {
  if (!config?.supabaseUrl || !session?.refreshToken) throw new Error('refresh_unavailable');
  const response = await fetcher(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method:'POST',
    headers:{apikey:config.supabaseAnonKey, authorization:`Bearer ${config.supabaseAnonKey}`, 'content-type':'application/json'},
    body:JSON.stringify({refresh_token:session.refreshToken}),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.access_token || !body?.refresh_token) throw new Error('refresh_failed');
  return { accessToken:body.access_token, refreshToken:body.refresh_token, expiresAt:Date.now() + Number(body.expires_in || 3600) * 1_000, providerToken:null };
}

export function validateSnapshot(snapshot) {
  if (!plainObject(snapshot) || snapshot.schema_version !== 1 || !Array.isArray(snapshot.decisions)) return { ok:false, reason:'snapshot_invalid' };
  const text = JSON.stringify(snapshot);
  if (new TextEncoder().encode(text).byteLength > MAX_SNAPSHOT_BYTES) return { ok:false, reason:'snapshot_too_large' };
  return { ok:true, snapshot:JSON.parse(text) };
}

function authHeaders(config, session, extra = {}) {
  return { apikey:config.supabaseAnonKey, authorization:`Bearer ${session.accessToken}`, ...extra };
}

export async function saveSnapshot(config, session, snapshot, fetcher = fetch) {
  const checked = validateSnapshot(snapshot);
  if (!checked.ok) throw new Error(checked.reason);
  const response = await fetcher(`${config.supabaseUrl}/rest/v1/user_sync_snapshot?on_conflict=user_id`, {
    method:'POST',
    headers:authHeaders(config, session, {'content-type':'application/json', prefer:'resolution=merge-duplicates,return=representation'}),
    body:JSON.stringify({ schema_version:1, payload:checked.snapshot, client_updated_at:new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(`snapshot_save_${response.status}`);
  return (await response.json().catch(() => []))[0] || null;
}

export async function readSnapshot(config, session, fetcher = fetch) {
  const response = await fetcher(`${config.supabaseUrl}/rest/v1/user_sync_snapshot?select=schema_version,payload,client_updated_at,updated_at&limit=1`, {
    headers:authHeaders(config, session),
  });
  if (!response.ok) throw new Error(`snapshot_read_${response.status}`);
  const row = (await response.json().catch(() => []))[0];
  if (!row) return null;
  const checked = validateSnapshot(row.payload);
  if (!checked.ok) throw new Error(checked.reason);
  return { ...row, payload:checked.snapshot };
}

export async function deleteSnapshot(config, session, fetcher = fetch) {
  const response = await fetcher(`${config.supabaseUrl}/rest/v1/user_sync_snapshot`, {
    method:'DELETE', headers:authHeaders(config, session, {prefer:'return=minimal'}),
  });
  if (!response.ok) throw new Error(`snapshot_delete_${response.status}`);
}

export { MAX_SNAPSHOT_BYTES, SESSION_KEY };
