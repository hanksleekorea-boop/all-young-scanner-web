import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTH_STORAGE_KEY, accountPreferencesFromUser, createAuthClient, deleteSnapshot, displayNameFromUser,
  initializeAuthState, readSnapshot, saveSnapshot, signInWithGoogle, signOut,
  subscribeAuthState, updateAccountProfile, updateDisplayName, validateConfig, validateSnapshot,
  normalizeAccountPreferences,
} from '../assets/auth-sync.mjs';

test('only accepts a secure Supabase endpoint and this site as redirect', () => {
  const good = validateConfig({supabaseUrl:'https://demo.supabase.co/', supabaseAnonKey:'public-key', redirectUrl:'https://example.test/app/'}, 'https://example.test');
  assert.equal(good.ok, true);
  assert.equal(validateConfig({supabaseUrl:'http://demo.supabase.co', supabaseAnonKey:'x', redirectUrl:'https://example.test/'}, 'https://example.test').ok, false);
  assert.equal(validateConfig({supabaseUrl:'https://demo.supabase.co', supabaseAnonKey:'x', redirectUrl:'https://attacker.test/'}, 'https://example.test').ok, false);
});

test('creates the official client with persisted PKCE sessions', () => {
  let call;
  const client={auth:{}};
  const result=createAuthClient({supabaseUrl:'https://demo.supabase.co',supabaseAnonKey:'public'}, {createClient:(...args)=>{call=args;return client;}});
  assert.equal(result,client);
  assert.deepEqual(call.slice(0,2),['https://demo.supabase.co','public']);
  assert.deepEqual(call[2].auth,{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce',storageKey:AUTH_STORAGE_KEY});
});

test('uses Google only through the official OAuth method', async () => {
  let input;
  const client={auth:{signInWithOAuth:async(value)=>{input=value;return {data:{provider:'google'},error:null};}},from(){}};
  await signInWithGoogle(client,'https://example.test/app/');
  assert.deepEqual(input,{provider:'google',options:{redirectTo:'https://example.test/app/'}});
  await assert.rejects(()=>signInWithGoogle(client,'http://example.test/app/'),/redirect_insecure/);
});

test('reads, observes and signs out through the official auth client', async () => {
  let observed;let unsubscribed=false;let signedOut=false;
  const session={user:{id:'user-1'}};
  const client={auth:{
    getSession:async()=>({data:{session},error:null}),
    onAuthStateChange:(callback)=>{observed=callback;return {data:{subscription:{unsubscribe(){unsubscribed=true;}}}};},
    signOut:async()=>{signedOut=true;return {error:null};},
  },from(){}};
  assert.equal(await initializeAuthState(client),session);
  let event;
  const stop=subscribeAuthState(client,(value)=>{event=value;});
  observed('SIGNED_IN',session);assert.deepEqual(event,{event:'SIGNED_IN',session});
  stop();assert.equal(unsubscribed,true);
  await signOut(client);assert.equal(signedOut,true);
});

test('updates an explicit display name and never exposes identity by default', async () => {
  let input;
  const client={auth:{updateUser:async(value)=>{input=value;return {data:{user:{user_metadata:value.data}},error:null};}},from(){}};
  assert.equal(displayNameFromUser({user_metadata:{display_name:'  Beauty Fan  '}}),'Beauty Fan');
  await updateDisplayName(client,'Beauty Fan');
  assert.deepEqual(input,{data:{display_name:'Beauty Fan'}});
  await assert.rejects(()=>updateDisplayName(client,'  '),/display_name_invalid/);
});

test('validates only supported account language and daily goals', () => {
  assert.deepEqual(normalizeAccountPreferences({language:'ko-KR',dailyGoal:15}),{ok:true,preferences:{language:'ko-KR',dailyGoal:15}});
  assert.equal(normalizeAccountPreferences({language:'en-US',dailyGoal:15}).ok,false);
  assert.equal(normalizeAccountPreferences({language:'ko-KR',dailyGoal:12}).ok,false);
});

test('saves explicit profile preferences through official user metadata', async () => {
  let input;
  const client={auth:{updateUser:async(value)=>{input=value;return {data:{user:{user_metadata:value.data}},error:null};}},from(){}};
  const user=await updateAccountProfile(client,{displayName:'Beauty Fan',language:'ko-KR',dailyGoal:20});
  assert.deepEqual(input,{data:{display_name:'Beauty Fan',language:'ko-KR',daily_goal_minutes:20}});
  assert.deepEqual(accountPreferencesFromUser(user),{displayName:'Beauty Fan',language:'ko-KR',dailyGoal:20,hasRemotePreferences:true});
  assert.equal(accountPreferencesFromUser({user_metadata:{display_name:'Local Only'}}).hasRemotePreferences,false);
  await assert.rejects(()=>updateAccountProfile(client,{displayName:'Beauty Fan',language:'ko-KR',dailyGoal:12}),/account_preferences_invalid/);
});

test('rejects malformed and oversized account snapshots', () => {
  assert.equal(validateSnapshot({schema_version:1, decisions:[]}).ok, true);
  assert.equal(validateSnapshot({schema_version:2, decisions:[]}).ok, false);
  assert.equal(validateSnapshot({schema_version:1, decisions:[{note:'x'.repeat(200_000)}]}).ok, false);
});

test('uses the user-scoped table through the official data client', async () => {
  const snapshot={schema_version:1,decisions:[]};
  const calls=[];
  const table={
    upsert(value,options){calls.push(['upsert',value,options]);return this;},
    select(value){calls.push(['select',value]);return this;},
    single(){return Promise.resolve({data:{payload:snapshot},error:null});},
    limit(value){calls.push(['limit',value]);return this;},
    maybeSingle(){return Promise.resolve({data:{payload:snapshot},error:null});},
    delete(){calls.push(['delete']);return this;},
    eq(column,value){calls.push(['eq',column,value]);return Promise.resolve({data:null,error:null});},
  };
  const client={auth:{getUser:async()=>({data:{user:{id:'user-1'}},error:null})},from:(name)=>{calls.push(['from',name]);return table;}};
  await saveSnapshot(client,snapshot);assert.equal(calls.some((item)=>item[0]==='upsert'),true);
  assert.deepEqual((await readSnapshot(client)).payload,snapshot);
  await deleteSnapshot(client);assert.equal(calls.some((item)=>item[0]==='eq'&&item[1]==='user_id'&&item[2]==='user-1'),true);
});
