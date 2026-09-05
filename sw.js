const VERSION = 'ays-shopping-v039';
const CORE = ['./','./en/','./index.html','./offline.html','./assets/storefront.mjs','./assets/shopping-core.mjs','./assets/storefront.css','./manifest.webmanifest','./icon.svg','./content/shop-index-v2.json','./content/usage-guides.json','./content/usage-guides.en.json','./content/shopping-guides.json','./content/store-links.json'];
const base = new URL(self.registration.scope);
const allowed = new Set(CORE.map(p=>new URL(p,base).href));
self.addEventListener('install', event=>event.waitUntil((async()=>{
  const cache=await caches.open(VERSION);
  // One unique URL per entry. Installation fails visibly if essential assets are unavailable.
  await cache.addAll([...allowed]);
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>(k.startsWith('ays-service-')||k.startsWith('ays-shopping-'))&&k!==VERSION).map(k=>caches.delete(k)));
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==base.origin||!url.pathname.startsWith(base.pathname))return;
  const shellPath=url.pathname===base.pathname||url.pathname===base.pathname+'index.html'||url.pathname===base.pathname+'en/'||url.pathname===base.pathname+'en/index.html';
  if(!shellPath&&!allowed.has(url.href))return;
  const key=shellPath?new URL(url.pathname.includes('/en/')?'./en/':'./',base).href:url.href;
  event.respondWith((async()=>{
    const cache=await caches.open(VERSION);
    try{
      const response=await fetch(event.request);
      if(response.ok&&response.type!=='opaque')await cache.put(key,response.clone()).catch(()=>{});
      return response;
    }catch{
      return await cache.match(key)||(event.request.mode==='navigate'?await cache.match(new URL('./offline.html',base).href):null)||Response.error();
    }
  })());
});
