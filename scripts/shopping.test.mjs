import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {normalize,prepareCatalog,searchProducts,isHousehold,readState,writeState,validateState,mergeBackups,toggleComparison,storeLinks,validateOffer,sourceLink,STORAGE_KEY} from '../assets/shopping-core.mjs';
const raw=JSON.parse(await readFile('content/catalog-v4.json','utf8'));
const catalog=prepareCatalog(raw);
test('known Korean brand/category intent finds real records and GTIN',()=>{
 for(const [a,b]of [['COSRX','코스알엑스'],['CeraVe','세라비'],['선케어','선크림']])assert.deepEqual(searchProducts(catalog.products,{q:a}).map(p=>p.id),searchProducts(catalog.products,{q:b}).map(p=>p.id));
 assert.equal(searchProducts(catalog.products,{q:'코스알엑스'}).length,4);
 assert.equal(searchProducts(catalog.products,{q:'8809598454354'})[0].name,'Aloe Soothing Sun Cream');
 assert(searchProducts(catalog.products,{q:'cosrx cleanser'}).length>0);
 assert.equal(searchProducts(catalog.products,{q:'xxxxx-no-result'}).length,0);
});
test('priority preserves global results; only explicit strict scope filters them',()=>{
 assert.equal(searchProducts(catalog.products,{q:'CeraVe',scope:'priority'}).length,searchProducts(catalog.products,{q:'CeraVe',scope:'global'}).length);
 const korean=searchProducts(catalog.products,{scope:'kr-only'});assert(korean.some(p=>p.brand==='belif'));assert(korean.some(p=>p.brand==='Skinfood'));
});
test('household products quarantine, originals preserved, no false human review',()=>{
 assert(isHousehold({name:'Dawn Dishwashing Liquid Dish Soap'}));assert(isHousehold({name:'Persil Lessive Liquide Peau Sensible'}));
 assert(!isHousehold({name:'Eau de toilette'}));assert(!isHousehold({name:'Body wash'}));
 assert.equal(catalog.products.length+catalog.quarantine.length,raw.products.length);assert(catalog.quarantine.length>=4);
 assert(catalog.products.every(p=>!isHousehold(p)));assert(catalog.products.every(p=>p.editorial_status==='pending_human_review'));assert.equal(catalog.quality.human_reviewed,0);
});
test('catalog IDs stable; quantities not fabricated; no arbitrary deduplication',()=>{
 assert.equal(new Set(catalog.products.map(p=>p.id)).size,catalog.products.length);
 for(const p of catalog.products)assert.equal(p.quantity,raw.products.find(x=>x.id===p.id).quantity||null);
 assert.equal(catalog.quality.missing_brand,1);assert(catalog.quality.duplicate_candidates.length>0);
});
test('comparison 0..4 gives explicit limit and preserves selections',()=>{
 let ids=[];for(let i=0;i<3;i++)ids=toggleComparison(ids,catalog.products[i].id).ids;
 const fourth=toggleComparison(ids,catalog.products[3].id);assert(fourth.limited);assert.deepEqual(fourth.ids,ids);
 assert.equal(toggleComparison(ids,ids[0]).ids.length,2);
});
test('damaged, inaccessible and rejected storage never throws or overwrites original on read',()=>{
 const map=new Map([[STORAGE_KEY,'broken']]);const storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};
 assert(readState(storage).error);assert.equal(map.get(STORAGE_KEY),'broken');
 assert(readState({getItem(){throw Error()}}).error);
 assert.equal(writeState({setItem(){throw Error()}},{version:2,saved:[],compared:[]}),false);
 const state={version:2,saved:[catalog.products[0].id],compared:[],locale:'ko'};
 assert(writeState(storage,state));assert.deepEqual(readState(storage).state,state);
});
test('backup rejects injected, invalid, oversized and future records',()=>{
 for(const bad of [{},[],{version:3,saved:[],compared:[]},{version:2,saved:['<img>'],compared:[]},{version:2,saved:[],compared:catalog.products.slice(0,4).map(p=>p.id)}])assert.throws(()=>validateState(bad));
 assert.deepEqual(validateState({version:2,saved:[],compared:[],secret:'discard'}),{version:2,saved:[],compared:[],locale:'ko'});
});
test('store searches encode query once; name duplication avoided; correct route shapes',()=>{
 const p={name:'COSRX Aloe & Cream',brand:'COSRX'};const links=storeLinks(p);
 for(const l of links){assert.equal(new URL(l.url).protocol,'https:');assert(!l.url.includes('COSRX%20COSRX'));}
 assert.equal(new URL(links.find(x=>x.id==='yesstyle').url).searchParams.get('q'),p.name);
 assert.equal(new URL(links.find(x=>x.id==='oliveyoung').url).pathname,'/th/search/results');
 assert(!JSON.stringify(links).includes('display/page/search'));
});
test('Offer policy blocks expired, mismatched, credential-bearing and affiliate-unapproved claims',()=>{
 const now=Date.parse('2026-09-05T12:00:00Z');const o={merchant_id:'yesstyle',product_id:'obf-8809598454354',url:'https://www.yesstyle.com/en/product/info.html/pid.1',quantity:'50ml',match_status:'name_and_quantity_observed',checked_at:'2026-09-05',expires_at:'2026-09-12',affiliate_status:'inactive'};
 assert(validateOffer(o,now));for(const changes of [{url:'https://evil.test/'},{url:'https://user:pass@www.yesstyle.com/'},{expires_at:'2026-01-01'},{match_status:'guess'},{affiliate_status:'active'}])assert(!validateOffer({...o,...changes},now));
 assert.equal(sourceLink('javascript:alert(1)'),null);
});
test('service worker core has no duplicates and fully installs before activating',async()=>{
 const code=await readFile('sw.js','utf8');const events={};let skipped=false,added=[];
 const self={registration:{scope:'https://example.test/shop/'},addEventListener:(name,f)=>events[name]=f,skipWaiting:async()=>{skipped=true;},clients:{claim:async()=>{}}};
 const caches={open:async()=>({addAll:async a=>{added=a;assert.equal(new Set(a).size,a.length);}})};
 vm.runInNewContext(code,{self,caches,URL,Set,Response,fetch});let pending;events.install({waitUntil:p=>pending=p});await pending;assert(skipped);assert(added.length>5);assert(!added.some(x=>x.includes('progress.html')||x.includes('catalog-v4.json')));
});
test('1000 generated state transitions preserve comparison cap and valid backup IDs',()=>{
 let state={version:2,saved:[],compared:[],locale:'ko'};
 for(let i=0;i<1000;i++){const id=catalog.products[(i*17)%catalog.products.length].id;state.compared=toggleComparison(state.compared,id).ids;if(i%4===0)state.compared=state.compared.slice(1);assert(state.compared.length<=3);assert.doesNotThrow(()=>validateState(state));}
});
test('100 deterministic exact barcode searches retain identity',()=>{
 for(let i=0;i<100;i++){const p=catalog.products[(i*19)%catalog.products.length];const rows=searchProducts(catalog.products,{q:p.gtin});assert(rows.some(r=>r.id===p.id));}
});
test('import merges without replacing existing comparison selections',()=>{
 const ids=catalog.products.slice(0,5).map(p=>p.id);
 const current={version:2,saved:[ids[0]],compared:ids.slice(0,3),locale:'ko'};
 const incoming={version:2,saved:[ids[4]],compared:ids.slice(3,5),locale:'en'};
 const merged=mergeBackups(current,incoming);assert.deepEqual(merged.compared,current.compared);assert.deepEqual(merged.saved,[ids[0],ids[4]]);
 assert.deepEqual(mergeBackups({...current,compared:[ids[0]]},incoming).compared,[ids[0],ids[3],ids[4]]);
 assert.deepEqual(current.compared,ids.slice(0,3));assert.equal(merged.locale,'ko');
});
test('service worker failed installation does not activate a partial cache',async()=>{
 const code=await readFile('sw.js','utf8');let skipped=false,pending;const events={};
 const self={registration:{scope:'https://example.test/shop/'},addEventListener:(n,f)=>events[n]=f,skipWaiting:()=>skipped=true};
 vm.runInNewContext(code,{self,caches:{open:async()=>({addAll:async()=>{throw Error('Network failure');}})},URL,Set,Response,fetch});
 events.install({waitUntil:p=>pending=p});await assert.rejects(pending);assert.equal(skipped,false);
});
test('service worker offline shell fallback preserves query and ignores other apps',async()=>{
 const code=await readFile('sw.js','utf8');const events={};let matched;
 const self={registration:{scope:'https://example.test/shop/'},addEventListener:(n,f)=>events[n]=f};
 const caches={open:async()=>({match:async k=>{matched=k;return new Response('Offline shell');}})};
 vm.runInNewContext(code,{self,caches,URL,Set,Response,fetch:async()=>{throw Error('Offline');}});
 let pending;events.fetch({request:{url:'https://example.test/shop/?view=saved',method:'GET',mode:'navigate'},respondWith:p=>pending=p});
 assert.equal(await(await pending).text(),'Offline shell');assert.equal(matched,'https://example.test/shop/');
 events.fetch({request:{url:'https://example.test/another-app/',method:'GET'},respondWith:()=>assert.fail('other app intercepted')});
});
