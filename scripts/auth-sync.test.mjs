import assert from 'node:assert/strict';
import test from 'node:test';
import { oauthUrl, sessionFromHash, validateConfig, validateSnapshot } from '../assets/auth-sync.mjs';

test('only accepts a secure Supabase endpoint and this site as redirect', () => {
  const good = validateConfig({supabaseUrl:'https://demo.supabase.co/', supabaseAnonKey:'public-key', redirectUrl:'https://example.test/app/'}, 'https://example.test');
  assert.equal(good.ok, true);
  assert.equal(validateConfig({supabaseUrl:'http://demo.supabase.co', supabaseAnonKey:'x', redirectUrl:'https://example.test/'}, 'https://example.test').ok, false);
  assert.equal(validateConfig({supabaseUrl:'https://demo.supabase.co', supabaseAnonKey:'x', redirectUrl:'https://attacker.test/'}, 'https://example.test').ok, false);
  assert.equal(new URL(oauthUrl(good.config, 'google')).searchParams.get('provider'), 'google');
});

test('accepts only complete implicit OAuth sessions', () => {
  const token = 'header.payload.signature';
  assert.equal(sessionFromHash(`#access_token=${token}&refresh_token=refresh&expires_in=3600`).accessToken, token);
  assert.equal(sessionFromHash('#access_token=not-a-jwt&refresh_token=refresh&expires_in=3600'), null);
});

test('rejects malformed and oversized account snapshots', () => {
  assert.equal(validateSnapshot({schema_version:1, decisions:[]}).ok, true);
  assert.equal(validateSnapshot({schema_version:2, decisions:[]}).ok, false);
  assert.equal(validateSnapshot({schema_version:1, decisions:[{note:'x'.repeat(200_000)}]}).ok, false);
});
