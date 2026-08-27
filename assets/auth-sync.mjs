const MAX_SNAPSHOT_BYTES = 196_608;
const AUTH_STORAGE_KEY = 'ays-account-auth-v02';

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function checkedClient(client) {
  if (!client?.auth || typeof client.from !== 'function') throw new Error('auth_client_unavailable');
  return client;
}

function throwIfError(result, fallback) {
  if (result?.error) throw new Error(result.error.message || fallback);
  return result?.data;
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

export function createAuthClient(config, sdk = globalThis.supabase) {
  if (!config?.supabaseUrl || !config?.supabaseAnonKey || typeof sdk?.createClient !== 'function') throw new Error('auth_sdk_unavailable');
  return sdk.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, flowType:'pkce', storageKey:AUTH_STORAGE_KEY},
  });
}

export async function initializeAuthState(client) {
  const data = throwIfError(await checkedClient(client).auth.getSession(), 'session_read_failed');
  return data?.session || null;
}

export function subscribeAuthState(client, listener) {
  if (typeof listener !== 'function') throw new Error('auth_listener_required');
  const result = checkedClient(client).auth.onAuthStateChange((event, session) => listener({event, session:session || null}));
  const subscription = result?.data?.subscription;
  return () => subscription?.unsubscribe?.();
}

export async function signInWithGoogle(client, redirectUrl) {
  const redirect = new URL(String(redirectUrl));
  if (redirect.protocol !== 'https:' && redirect.hostname !== 'localhost') throw new Error('redirect_insecure');
  return throwIfError(await checkedClient(client).auth.signInWithOAuth({provider:'google',options:{redirectTo:redirect.href}}), 'oauth_start_failed');
}

export async function signOut(client) {
  throwIfError(await checkedClient(client).auth.signOut(), 'sign_out_failed');
}

export function displayNameFromUser(user) {
  return String(user?.user_metadata?.display_name || '').trim().slice(0, 40);
}

export async function updateDisplayName(client, displayName) {
  const value = String(displayName || '').trim();
  if (!value || value.length > 40) throw new Error('display_name_invalid');
  const data = throwIfError(await checkedClient(client).auth.updateUser({data:{display_name:value}}), 'profile_update_failed');
  return data?.user || null;
}

export function validateSnapshot(snapshot) {
  if (!plainObject(snapshot) || snapshot.schema_version !== 1 || !Array.isArray(snapshot.decisions)) return { ok:false, reason:'snapshot_invalid' };
  const text = JSON.stringify(snapshot);
  if (new TextEncoder().encode(text).byteLength > MAX_SNAPSHOT_BYTES) return { ok:false, reason:'snapshot_too_large' };
  return { ok:true, snapshot:JSON.parse(text) };
}

export async function saveSnapshot(client, snapshot) {
  const checked = validateSnapshot(snapshot);
  if (!checked.ok) throw new Error(checked.reason);
  const query = checkedClient(client).from('user_sync_snapshot').upsert({schema_version:1,payload:checked.snapshot,client_updated_at:new Date().toISOString()}, {onConflict:'user_id'}).select('schema_version,payload,client_updated_at,updated_at').single();
  return throwIfError(await query, 'snapshot_save_failed') || null;
}

export async function readSnapshot(client) {
  const query = checkedClient(client).from('user_sync_snapshot').select('schema_version,payload,client_updated_at,updated_at').limit(1).maybeSingle();
  const row = throwIfError(await query, 'snapshot_read_failed');
  if (!row) return null;
  const checked = validateSnapshot(row.payload);
  if (!checked.ok) throw new Error(checked.reason);
  return {...row, payload:checked.snapshot};
}

export async function deleteSnapshot(client) {
  const userData = throwIfError(await checkedClient(client).auth.getUser(), 'user_read_failed');
  if (!userData?.user?.id) throw new Error('user_missing');
  const result = await client.from('user_sync_snapshot').delete().eq('user_id', userData.user.id);
  throwIfError(result, 'snapshot_delete_failed');
}

export { AUTH_STORAGE_KEY, MAX_SNAPSHOT_BYTES };
