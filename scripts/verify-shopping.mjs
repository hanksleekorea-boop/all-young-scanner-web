import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
const base=resolve(process.argv[2]||'.');
const read=p=>readFile(resolve(base,p),'utf8');
const release=JSON.parse(await read('shopping-release.json'));
let checks=0;
const ok=(condition,message)=>{assert(condition,message);checks++;};
for(const p of ['assets/storefront.mjs','assets/shopping-core.mjs','sw.js']){
 const r=spawnSync(process.execPath,['--check',resolve(base,p)],{encoding:'utf8'});ok(r.status===0,`${p}: ${r.stderr}`);
}
const index=JSON.parse(await read('content/shop-index-v2.json'));
ok(index.products.length===release.catalog_count,'release count');
ok(new Set(index.products.map(p=>p.id)).size===index.products.length,'unique stable IDs');
ok(index.products.every(p=>p.price===null&&p.image_url===null&&p.editorial_status==='pending_human_review'),'no invented evidence');
ok(Buffer.byteLength(await read('assets/storefront.mjs'))<70000,'JS budget 70KB');
ok(Buffer.byteLength(await read('assets/storefront.css'))<20000,'CSS budget 20KB');
ok(Buffer.byteLength(await read('content/shop-index-v2.json'))<1800000,'catalog budget 1.8MB');
const sitemap=await read('sitemap.xml');
const paths=[...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>new URL(m[1]).pathname.replace('/all-young-scanner-web/','')).map(p=>p.endsWith('/')?p+'index.html':p||'index.html');
for(const p of [...new Set([...paths,'product.html','offline.html','m/index.html'])]){
 const html=await read(p);ok(html.includes('name="viewport"'),`viewport ${p}`);
 if(p==='m/index.html')continue;
 ok(html.includes(release.release_id),`release stamp ${p}`);
 ok(html.includes('id="main"')&&html.includes('aria-labelledby="confirmTitle"'),`accessible landmarks ${p}`);
 ok(!/<script[^>]+src=["']https:/i.test(html),`no external scripts ${p}`);
 ok(!/href=["'][^"']*#(?:routine|records)/i.test(html),`no dead legacy CTA ${p}`);
 for(const m of html.matchAll(/(?:href|src)="([^"#?]+)[^"]*"/g)){
  if(/^(https?:|data:|mailto:)/.test(m[1]))continue;
  const path=resolve(base,dirname(p),m[1].split(/[?#]/)[0]);
  ok(path===base||path.startsWith(base+'\\')||path.startsWith(base+'/'),`path traversal ${p}`);
  await stat(path);checks++;
 }
}
const app=await read('assets/storefront.mjs');
ok(app.includes('Promise.allSettled'),'guide failures isolated');
ok(app.includes('if(storageError||!writeState'),'damaged source protected');
ok(app.includes('exportDamaged'),'original backup recovery');
const manifest=JSON.parse(await read('manifest.webmanifest'));
ok(manifest.shortcuts.every(s=>!s.url.includes('#')),'manifest actual routes');
ok(release.external_ads===false&&release.affiliate_active===false&&release.google_login===false,'external gates honest');
console.log(JSON.stringify({status:'PASS',checks,pages:new Set(paths).size,release:release.release_id,scope:'structural, syntax, links, budgets; not device or real-user evidence'}));
