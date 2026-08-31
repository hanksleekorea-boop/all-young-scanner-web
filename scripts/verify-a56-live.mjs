import assert from 'node:assert/strict';

const port = Number(process.env.AYS_A56_CDP_PORT || 9223);
const base = 'https://hanksleekorea-boop.github.io/all-young-scanner-web/';
const release = 'v0.34';
const target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(`${base}?device_check=v032#home`)}`, { method: 'PUT' }).then((response) => response.json());
assert.ok(target?.webSocketDebuggerUrl, 'A56 Chrome에서 올영스캐너 탭을 찾지 못했습니다.');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let id = 0; const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data); const request = pending.get(message.id); if (!request) return;
  pending.delete(message.id); if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  id += 1; const requestId = id; const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`A56 CDP timeout: ${method}`)); }, 15_000);
  pending.set(requestId, { resolve: (result) => { clearTimeout(timer); resolve(result); }, reject: (error) => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ id: requestId, method, params }));
});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const value = async (expression, awaitPromise = false) => (await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })).result.value;

let previousStorage;
try {
  console.error('[a56] Chrome 연결 완료');
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Page.navigate', { url: `${base}?device_check=v032#home` });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await value("document.readyState === 'complete' && document.documentElement.dataset.appReady === 'true'")) break;
    if (attempt === 119) throw new Error('A56에서 앱 준비 시간이 초과되었습니다.');
    await wait(100);
  }
  previousStorage = await value("localStorage.getItem('ays-free-advanced-v1')");
  console.error('[a56] 공개 v0.34 준비 완료');
  await value("localStorage.removeItem('ays-free-advanced-v1'); true"); await send('Page.reload', { ignoreCache: true });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await value("document.readyState === 'complete' && document.documentElement.dataset.appReady === 'true'")) break;
    if (attempt === 119) throw new Error('A56 시험 상태 준비 시간이 초과되었습니다.');
    await wait(100);
  }
  const result = await value(`(async()=>{
    const initial={title:document.title,width:innerWidth,screenWidth:screen.width,dpr:devicePixelRatio,scrollWidth:document.documentElement.scrollWidth,appReady:document.documentElement.dataset.appReady,plusNav:document.querySelectorAll('[data-view-target="plus"]').length,manifest:Boolean(document.querySelector('link[rel="manifest"]')),serviceWorker:Boolean('serviceWorker' in navigator)};
    const choose=(name,value)=>{const input=document.querySelector('input[name="'+name+'"][value="'+value+'"]');input.checked=true};
    document.querySelector('[data-view-target="routine"]').click();choose('time','morning');choose('context','dry');choose('pace','minimal');document.querySelector('#routine-form').requestSubmit();await new Promise(r=>setTimeout(r,80));document.querySelector('[data-save-routine]').click();
    document.querySelector('[data-view-target="plus"]').click();document.querySelector('#plus-routine-name').value='A56 아침';document.querySelector('#plus-routine-form').requestSubmit();await new Promise(r=>setTimeout(r,80));
    document.querySelector('[data-view-target="routine"]').click();choose('time','evening');choose('context','humid');choose('pace','balanced');document.querySelector('#routine-form').requestSubmit();await new Promise(r=>setTimeout(r,80));
    document.querySelector('[data-view-target="plus"]').click();document.querySelector('#plus-routine-name').value='A56 저녁';document.querySelector('#plus-routine-form').requestSubmit();await new Promise(r=>setTimeout(r,80));
    const options=document.querySelectorAll('#compare-left option');document.querySelector('#compare-left').value=options[1].value;document.querySelector('#compare-right').value=options[2].value;document.querySelector('#compare-routines').click();
    document.querySelector('#collection-name').value='A56 모음';document.querySelector('#collection-guides input')?.click();document.querySelector('#collection-form').requestSubmit();await new Promise(r=>setTimeout(r,80));
    const visible=[...document.querySelectorAll('button,a,input,select')].filter(node=>{const b=node.getBoundingClientRect(),s=getComputedStyle(node);return s.display!=='none'&&s.visibility!=='hidden'&&b.width>0});
    const small=visible.filter(node=>{const b=node.getBoundingClientRect(),label=node.closest('label'),lb=label?.getBoundingClientRect();if(['checkbox','radio'].includes(node.type)&&lb?.width>=44&&lb?.height>=44)return false;return b.width<44||b.height<44});
    const journey={plusVisible:!document.querySelector('[data-view="plus"]').hidden,routines:document.querySelectorAll('#plus-routine-list li:not(.empty-copy)').length,collections:document.querySelectorAll('#collection-list li:not(.empty-copy)').length,comparison:document.querySelector('#compare-result').innerText,smallTargets:small.length,smallTargetDetails:small.map(node=>({tag:node.tagName,id:node.id,text:(node.innerText||node.value||'').slice(0,30),width:Math.round(node.getBoundingClientRect().width),height:Math.round(node.getBoundingClientRect().height)})),clipped:visible.filter(node=>{const b=node.getBoundingClientRect();return b.left<-1||b.right>innerWidth+1}).length,overflow:document.documentElement.scrollWidth>innerWidth};
    return {initial,journey};
  })()`, true);
  console.error('[a56] 실제 여정 완료');
  console.log(JSON.stringify({ verdict: 'MEASURED', device: 'A56', release, ...result }, null, 2));
  assert.match(result.initial.title, /올영스캐너/); assert.equal(result.initial.appReady, 'true'); assert.ok(result.initial.width >= 320 && result.initial.width <= 600);
  assert.equal(result.initial.scrollWidth <= result.initial.width, true); assert.equal(result.initial.plusNav, 2); assert.equal(result.initial.manifest, true); assert.equal(result.initial.serviceWorker, true);
  assert.equal(result.journey.plusVisible, true); assert.equal(result.journey.routines, 2); assert.equal(result.journey.collections, 1); assert.match(result.journey.comparison, /다른 조건/);
  assert.equal(result.journey.smallTargets, 0); assert.equal(result.journey.clipped, 0); assert.equal(result.journey.overflow, false);
  console.error('[a56] PASS');
} finally {
  if (previousStorage === null) await value("localStorage.removeItem('ays-free-advanced-v1'); true").catch(() => {});
  else if (typeof previousStorage === 'string') await value(`localStorage.setItem('ays-free-advanced-v1',${JSON.stringify(previousStorage)}); true`).catch(() => {});
  await send('Page.close').catch(() => {});
  await new Promise((resolve) => { const timer = setTimeout(resolve, 1000); socket.addEventListener('close', () => { clearTimeout(timer); resolve(); }, { once: true }); socket.close(); });
}
