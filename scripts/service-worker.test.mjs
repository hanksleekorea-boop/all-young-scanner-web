import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const scope='https://example.test/all-young-scanner-web/';
function harness({offline=false,quota=false}={}){
  const handlers={},deleted=[],writes=[],messages=[];
  const current=new Map(),other=new Map([[scope+'index.html',new Response('wrong-other-cache')]]);
  const storage=new Map([['unrelated-app',other],['ays-service-old',new Map()]]);
  const currentName=source.match(/const CACHE = '([^']+)'/)[1];
  storage.set(currentName,current);
  const caches={
    keys:async()=>[...storage.keys()],
    delete:async key=>{deleted.push(key);return storage.delete(key);},
    open:async name=>{
      if(quota)throw new Error('storage blocked');
      const map=storage.get(name)??new Map();storage.set(name,map);
      return {addAll:async paths=>{for(const path of paths)map.set(new URL(path,scope).href,new Response('installed'));},
        put:async(req,res)=>{writes.push(req.url);map.set(req.url,res);},
        match:async req=>map.get(typeof req==='string'?req:req.url)?.clone()};
    },
    match:async()=>{throw new Error('Global cross-cache lookup is forbidden');},
  };
  let fetched=0;
  vm.runInNewContext(source,{URL,Response,caches,
    fetch:async()=>{fetched++;if(offline)throw new Error('offline');return new Response('network');},
    self:{registration:{scope},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:()=>{},
      clients:{claim:()=>{},matchAll:async()=>[{postMessage:message=>messages.push(message)}]}}});
  async function request(path,{method='GET',mode='navigate'}={}){
    let result;
    handlers.fetch({request:{method,mode,url:new URL(path,scope).href},respondWith:promise=>result=promise});
    return result===undefined?null:await result;
  }
  return {handlers,request,current,storage,deleted,writes,messages,get fetched(){return fetched;}};
}
test('API, query strings, other apps, and POST are not intercepted',async()=>{
  const h=harness();
  for(const path of ['api/decision','index.html?private=1','/other-app/','https://other.example/','https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js'])assert.equal(await h.request(path),null);
  assert.equal(await h.request('index.html',{method:'POST'}),null);
  assert.equal(h.fetched,0);assert.equal(h.writes.length,0);
});
test('valid online core response is cached within this release only',async()=>{
  const h=harness();assert.equal(await (await h.request('index.html')).text(),'network');
  assert.deepEqual(h.writes,[scope+'index.html']);assert.ok(h.storage.has('unrelated-app'));
});
test('public guide pages are cached on first visit without opening the API boundary',async()=>{
  const h=harness();assert.equal(await (await h.request('guides/morning-three-step-start/')).text(),'network');
  assert.deepEqual(h.writes,[scope+'guides/morning-three-step-start/']);
  assert.equal(await h.request('guides/morning-three-step-start/?private=1'),null);
});
test('cache quota failure does not discard a successful network response',async()=>{
  const h=harness({quota:true});assert.equal(await (await h.request('index.html')).text(),'network');
});
test('offline reads only current release and then its own fallback page',async()=>{
  const h=harness({offline:true});h.current.set(scope+'offline.html',new Response('own-offline'));
  assert.equal(await (await h.request('index.html')).text(),'own-offline');
  h.current.set(scope+'index.html',new Response('own-current'));
  assert.equal(await (await h.request('index.html')).text(),'own-current');
});
test('uncached assets or blocked storage fail without another app fallback',async()=>{
  const h=harness({offline:true});assert.equal((await h.request('icon.svg',{mode:'cors'})).type,'error');
  const blocked=harness({offline:true,quota:true});assert.equal((await blocked.request('index.html')).type,'error');
});
test('activation preserves unrelated apps and sends release notice',async()=>{
  const h=harness();let pending;
  h.handlers.activate({waitUntil:promise=>pending=promise});await pending;
  assert.deepEqual(h.deleted,['ays-service-old']);assert.ok(h.storage.has('unrelated-app'));
  assert.equal(h.messages[0].type,'AYS_RELEASE_READY');
});
