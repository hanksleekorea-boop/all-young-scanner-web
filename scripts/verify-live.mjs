import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const base=process.argv[2]||'https://hanksleekorea-boop.github.io/all-young-scanner-web/';
const local=JSON.parse(await readFile('shopping-release.json','utf8'));
// Pages can still be building when the existing push workflow starts.
if(process.env.CI){
 let ready=false;
 for(let attempt=0;attempt<20;attempt++){
  try{const r=await fetch(new URL('shopping-release.json',base),{signal:AbortSignal.timeout(15000),cache:'no-store'});ready=r.ok&&(await r.json()).release_id===local.release_id;}catch{}
  if(ready)break;await new Promise(r=>setTimeout(r,15000));
 }
 assert(ready,'Pages did not serve the expected release within the verification window');
}
const paths=['','m/','en/','support.html','privacy.html','terms.html','advertising.html','guides/','en/guides/','manifest.webmanifest','sw.js','assets/storefront.mjs','assets/shopping-core.mjs','assets/storefront.css','content/shop-index-v2.json','content/shopping-guides.json','content/store-links.json','shopping-release.json','progress.html'];
const results=[];
for(const p of paths){const r=await fetch(new URL(p,base),{signal:AbortSignal.timeout(20000),cache:'no-store'});assert(r.ok,`${p} HTTP ${r.status}`);const text=await r.text();if(p===''||p==='en/')assert(text.includes(local.release_id),`stale HTML ${p}`);if(p==='shopping-release.json')assert.equal(JSON.parse(text).release_id,local.release_id);results.push({path:p||'/',status:r.status,bytes:Buffer.byteLength(text)});}
console.log(JSON.stringify({status:'PASS',release:local.release_id,checked_at:new Date().toISOString(),results,scope:'HTTP and release identity only; not UI or Android evidence'},null,2));
