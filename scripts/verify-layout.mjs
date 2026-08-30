import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = await mkdtemp(path.join(tmpdir(), 'ays-layout-'));
const child = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
child.unref();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function devtoolsPort() {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100; i += 1) {
    try { return Number((await readFile(file, 'utf8')).split(/\r?\n/)[0]); } catch { await wait(50); }
  }
  throw new Error('Edge 검사 포트를 열지 못했습니다.');
}

async function connectPage(port, url) {
  const target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' }).then((response) => response.json());
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  const events = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) { events.push(message); return; }
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    id += 1; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  return { socket, send, events };
}

async function ready(send) {
  for (let i = 0; i < 100; i += 1) {
    const result = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
    if (result.result.value === 'complete') return;
    await wait(50);
  }
  throw new Error('페이지 로딩 시간이 초과되었습니다.');
}

async function inspect(send, width, url) {
  const targetUrl = new URL(url);
  const isAppView = targetUrl.pathname === '/' && Boolean(targetUrl.hash);
  await send('Emulation.setDeviceMetricsOverride', { width, height: width < 700 ? 844 : 1000, deviceScaleFactor: 1, mobile: width < 700 });
  await send('Page.navigate', { url });
  await ready(send);
  for (let i = 0; i < 100; i += 1) {
    const location = await send('Runtime.evaluate', { expression: '({pathname:location.pathname,hash:location.hash})', returnByValue: true });
    if (location.result.value.pathname === targetUrl.pathname && location.result.value.hash === targetUrl.hash) break;
    await wait(50);
  }
  await wait(120);
  if (isAppView) {
    for (let i = 0; i < 100; i += 1) {
      const app = await send('Runtime.evaluate', { expression: "document.documentElement.dataset.appReady === 'true'", returnByValue: true });
      if (app.result.value) break;
      await wait(50);
    }
  }
  for (let i = 0; i < 100; i += 1) {
    const ads = await send('Runtime.evaluate', { expression: "[...document.querySelectorAll('.ad-slot')].every((slot) => Boolean(slot.dataset.adState))", returnByValue: true });
    if (ads.result.value) break;
    await wait(50);
  }
  const result = await send('Runtime.evaluate', {
    expression: `(() => ({
      title: document.title,
      lang: document.documentElement.lang,
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      h1: document.querySelector('h1')?.textContent?.trim() || '',
      cards: document.querySelectorAll('.guide-card').length,
      appReady: document.documentElement.dataset.appReady || '',
      visibleViews: [...document.querySelectorAll('[data-view]')].filter((node)=>!node.hidden).length,
      smallTargets: [...document.querySelectorAll('button,a,input,select')].filter((node) => {
        const box=node.getBoundingClientRect(); const style=getComputedStyle(node);
        return style.display!=='none' && style.visibility!=='hidden' && box.width>0 && (box.height < 44 || box.width < 44);
      }).length,
      smallTargetDetails: [...document.querySelectorAll('button,a,input,select')].filter((node) => {
        const box=node.getBoundingClientRect(); const style=getComputedStyle(node);
        return style.display!=='none' && style.visibility!=='hidden' && box.width>0 && (box.height < 44 || box.width < 44);
      }).map((node)=>{const box=node.getBoundingClientRect();return {tag:node.tagName,text:(node.textContent||'').trim().slice(0,40),href:node.getAttribute('href')||'',width:Math.round(box.width),height:Math.round(box.height)}}),
      internalCopy: /내부 검수|개발 진척|올영스캐너 알파/.test(document.body.innerText),
      clipped: [...document.querySelectorAll('a,button,input')].filter((node) => {
        const box=node.getBoundingClientRect(); const style=getComputedStyle(node);
        return style.display!=='none' && style.visibility!=='hidden' && box.width>0 && (box.left < -1 || box.right > innerWidth + 1);
      }).length,
      adSlots: document.querySelectorAll('.ad-slot').length,
      houseSlots: document.querySelectorAll('.ad-slot[data-ad-state="house"]').length,
      providerAds: document.querySelectorAll('.adsbygoogle,script[data-ays-ad-provider]').length,
      adsStatus: document.documentElement.dataset.adsStatus || ''
    }))()`,
    returnByValue: true,
  });
  const value = result.result.value;
  assert.ok(value.title && value.h1, `${url}: 제목 또는 H1 없음`);
  assert.equal(value.innerWidth, width, `${url}: 요청한 화면 폭 불일치`);
  assert.ok(value.scrollWidth <= width, `${url}: 가로 넘침 ${value.scrollWidth}/${width}`);
  assert.equal(value.clipped, 0, `${url}: 화면 밖 조작 요소 ${value.clipped}개`);
  assert.equal(value.internalCopy, false, `${url}: 내부 개발 문구 노출`);
  if (isAppView) {
    assert.equal(value.appReady, 'true', `${url}: 무료 고급 앱 시작 실패`);
    assert.equal(value.visibleViews, 1, `${url}: 핵심 화면 표시 수 오류`);
    assert.equal(value.smallTargets, 0, `${url}: 44px 미만 조작 요소 ${value.smallTargets}개`);
  }
  return value;
}

try {
  const port = await devtoolsPort();
  const { socket, send, events } = await connectPage(port, 'http://127.0.0.1:4179/');
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Accessibility.enable');
  const results = [];
  for (const width of [360, 390, 1440]) results.push({ width, ...(await inspect(send, width, 'http://127.0.0.1:4179/#home')) });
  const reflow = await inspect(send, 640, 'http://127.0.0.1:4179/#home');
  assert.ok(reflow.scrollWidth <= 640, '1280px 화면의 200% 확대에 해당하는 640px 재배치 실패');
  const axTree = await send('Accessibility.getFullAXTree');
  const namedRoles = new Set(['button', 'link', 'textbox', 'combobox', 'radio']);
  const unnamed = axTree.nodes.filter((node) => namedRoles.has(node.role?.value) && !(node.name?.value ?? '').trim());
  assert.equal(unnamed.length, 0, `접근 가능한 이름이 없는 조작 요소 ${unnamed.length}개`);
  assert.ok(axTree.nodes.some((node) => node.role?.value === 'main'), '본문 접근성 영역 없음');
  await send('Runtime.evaluate', { expression: 'document.activeElement?.blur(); true', returnByValue: true });
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  const firstFocus = await send('Runtime.evaluate', { expression: `({text:document.activeElement?.textContent?.trim(),href:document.activeElement?.getAttribute?.('href')})`, returnByValue: true });
  assert.equal(firstFocus.result.value.href, '#main', '첫 Tab에서 본문 바로가기 링크로 이동하지 않음');
  await send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const reducedMotion = await send('Runtime.evaluate', { expression: "getComputedStyle(document.documentElement).scrollBehavior", returnByValue: true });
  assert.equal(reducedMotion.result.value, 'auto', '움직임 줄이기 설정에서 부드러운 스크롤이 유지됨');
  await send('Emulation.setEmulatedMedia', { media: 'screen', features: [] });
  for (const view of ['routine','guides','records','plus']) results.push({ width:390, ...(await inspect(send, 390, `http://127.0.0.1:4179/#${view}`)) });
  for (const width of [360, 390, 1440]) results.push({ width, ...(await inspect(send, width, 'http://127.0.0.1:4179/guides/')) });
  for (const width of [360, 1440]) results.push({ width, ...(await inspect(send, width, 'http://127.0.0.1:4179/guides/morning-three-step-start/')) });
  const englishMobile = await inspect(send, 360, 'http://127.0.0.1:4179/en/');
  const englishDesktop = await inspect(send, 1440, 'http://127.0.0.1:4179/en/');
  results.push({ width: 360, ...englishMobile }, { width: 1440, ...englishDesktop });
  assert.equal(englishMobile.lang, 'en', '영문 정보판 언어 선언 오류');
  assert.equal(englishDesktop.lang, 'en', '영문 정보판 PC 언어 선언 오류');
  assert.equal(englishMobile.smallTargets, 0, `영문 정보판 44px 미만 조작 요소 ${JSON.stringify(englishMobile.smallTargetDetails)}`);
  assert.equal(englishDesktop.smallTargets, 0, `영문 정보판 PC 44px 미만 조작 요소 ${JSON.stringify(englishDesktop.smallTargetDetails)}`);
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:4179/ad-operations.html' });
  await ready(send); await wait(150);
  const operations = await send('Runtime.evaluate', { expression: `(() => { const button=document.querySelector('#clear-ad-operations'); const box=button?.getBoundingClientRect(); return {ready:document.documentElement.dataset.adOperationsReady,scrollWidth:document.documentElement.scrollWidth,width:innerWidth,external:document.querySelector('#external-provider-count')?.textContent,buttonHeight:box?.height||0,internal:/개발 진척|LAUNCH CHECK/.test(document.body.innerText)} })()`, returnByValue: true });
  assert.equal(operations.result.value.ready, 'true', '광고 투명성 현황 시작 실패');
  assert.equal(operations.result.value.external, '0', '외부 광고 제공자를 실제보다 크게 표시함');
  assert.ok(operations.result.value.scrollWidth <= operations.result.value.width, '광고 투명성 현황 가로 넘침');
  assert.ok(operations.result.value.buttonHeight >= 44, '광고 운영 기록 삭제 조작 영역 44px 미만');
  assert.equal(operations.result.value.internal, false, '광고 투명성 현황에 내부 개발 문구 노출');
  await send('Page.navigate', { url: 'http://127.0.0.1:4179/ad-governance.html' });
  await ready(send); await wait(150);
  const governance = await send('Runtime.evaluate', { expression: `(() => { const links=[...document.querySelectorAll('a')]; return {ready:document.documentElement.dataset.adGovernanceReady,scrollWidth:document.documentElement.scrollWidth,width:innerWidth,mode:document.querySelector('#optimization-mode')?.textContent,direct:document.querySelector('#direct-campaign-count')?.textContent,supply:document.querySelector('#supply-chain-count')?.textContent,conditions:document.querySelector('#stage-three-condition-count')?.textContent,smallLinks:links.filter(node=>{const b=node.getBoundingClientRect();return b.width>0&&(b.width<44||b.height<44)}).length,internal:/개발 진척|LAUNCH CHECK/.test(document.body.innerText)} })()`, returnByValue: true });
  assert.equal(governance.result.value.ready, 'true', '광고 공급망·안전 운영 시작 실패');
  assert.equal(governance.result.value.mode, '그림자 전용', '광고 3단계 기본 운영 방식 오류');
  assert.equal(governance.result.value.direct, '0', '직접 캠페인을 실제보다 크게 표시함');
  assert.equal(governance.result.value.supply, '1/4', '공급망 확인을 실제보다 크게 표시함');
  assert.equal(governance.result.value.conditions, '2/14', '광고 3단계 외부 조건을 실제보다 크게 표시함');
  assert.ok(governance.result.value.scrollWidth <= governance.result.value.width, '광고 공급망·안전 운영 가로 넘침');
  assert.equal(governance.result.value.smallLinks, 0, '광고 공급망·안전 운영 44px 미만 링크');
  assert.equal(governance.result.value.internal, false, '광고 공급망·안전 운영에 내부 개발 문구 노출');
  assert.ok(results.filter((row) => row.cards === 24).length >= 5, '한국어·영문 가이드 목록 24개가 모든 폭에서 유지되지 않음');
  for (const row of results.filter((item) => item.adSlots > 0)) {
    assert.equal(row.houseSlots, row.adSlots, '기본 비활성 상태에서 자체 안내 대체 화면 누락');
    assert.equal(row.providerAds, 0, '기본 비활성 상태에서 외부 광고 요소가 생성됨');
    assert.equal(row.adsStatus, 'blocked', '광고 기본 차단 상태 표시 누락');
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:4179/#routine' });
  await ready(send);
  for (let i = 0; i < 100; i += 1) {
    const app = await send('Runtime.evaluate', { expression: "document.documentElement.dataset.appReady === 'true'", returnByValue: true });
    if (app.result.value) break;
    await wait(50);
  }
  const journey = await send('Runtime.evaluate', {
    expression: `(async()=>{
      for(const [name,value] of Object.entries({time:'morning',context:'dry',pace:'minimal'})){const input=document.querySelector('input[name="'+name+'"][value="'+value+'"]');input.checked=true}
      document.querySelector('#routine-form').requestSubmit(); await new Promise(r=>setTimeout(r,100));
      const routineSteps=document.querySelectorAll('#routine-result .routine-list li').length;
      document.querySelector('[data-save-routine]').click();
      document.querySelector('[data-view-target="records"]').click();
      document.querySelector('input[name="completed"][value="yes"]').checked=true;
      document.querySelector('#comfort').value='4';
      document.querySelector('input[name="irritation"][value="no"]').checked=true;
      document.querySelector('#checkin-form').requestSubmit(); await new Promise(r=>setTimeout(r,100));
      const saved=document.querySelectorAll('#saved-guides .guide-card').length;
      const checkins=document.querySelectorAll('#checkin-history li:not(.empty-copy)').length;
      document.querySelector('#open-delete').click();document.querySelector('#confirm-delete').click();
      return {routineSteps,saved,checkins,deleted:localStorage.getItem('ays-free-advanced-v1')===null};
    })()`, awaitPromise: true, returnByValue: true,
  });
  assert.ok(journey.result.value.routineSteps >= 2, '루틴 결과가 완성되지 않음');
  assert.ok(journey.result.value.saved >= 2, '루틴 가이드 저장 실패');
  assert.equal(journey.result.value.checkins, 1, '오늘 점검 저장 실패');
  assert.equal(journey.result.value.deleted, true, '기기 기록 전체 삭제 실패');
  const plusJourney = await send('Runtime.evaluate', {
    expression: `(async()=>{
      document.querySelector('[data-view-target="routine"]').click();
      for(const [name,value] of Object.entries({time:'morning',context:'dry',pace:'minimal'})){const input=document.querySelector('input[name="'+name+'"][value="'+value+'"]');input.checked=true}
      document.querySelector('#routine-form').requestSubmit();await new Promise(r=>setTimeout(r,30));document.querySelector('[data-save-routine]').click();
      document.querySelector('[data-view-target="plus"]').click();document.querySelector('#plus-routine-name').value='아침 루틴';document.querySelector('#plus-routine-form').requestSubmit();await new Promise(r=>setTimeout(r,30));
      document.querySelector('[data-view-target="routine"]').click();
      for(const [name,value] of Object.entries({time:'evening',context:'humid',pace:'balanced'})){const input=document.querySelector('input[name="'+name+'"][value="'+value+'"]');input.checked=true}
      document.querySelector('#routine-form').requestSubmit();await new Promise(r=>setTimeout(r,30));
      document.querySelector('[data-view-target="plus"]').click();document.querySelector('#plus-routine-name').value='저녁 루틴';document.querySelector('#plus-routine-form').requestSubmit();await new Promise(r=>setTimeout(r,30));
      const options=document.querySelectorAll('#compare-left option');document.querySelector('#compare-left').value=options[1].value;document.querySelector('#compare-right').value=options[2].value;document.querySelector('#compare-routines').click();
      document.querySelector('#collection-name').value='안전 모음';document.querySelector('#collection-guides input')?.click();document.querySelector('#collection-form').requestSubmit();await new Promise(r=>setTimeout(r,30));
      const smallTargets=[...document.querySelectorAll('[data-view="plus"] button,[data-view="plus"] a,[data-view="plus"] input,[data-view="plus"] select')].filter(node=>{const b=node.getBoundingClientRect(),s=getComputedStyle(node),label=node.closest('label'),lb=label?.getBoundingClientRect();if(s.display==='none'||s.visibility==='hidden'||b.width===0)return false;if(['checkbox','radio'].includes(node.type)&&lb?.width>=44&&lb?.height>=44)return false;return b.width<44||b.height<44}).length;
      return {routines:document.querySelectorAll('#plus-routine-list li:not(.empty-copy)').length,comparison:document.querySelector('#compare-result').innerText,collections:document.querySelectorAll('#collection-list li:not(.empty-copy)').length,plusVisible:!document.querySelector('[data-view="plus"]').hidden,smallTargets};
    })()`, awaitPromise: true, returnByValue: true,
  });
  assert.equal(plusJourney.result.value.routines, 2, 'Plus 저장 루틴 2개 만들기 실패');
  assert.match(plusJourney.result.value.comparison, /다른 조건/, 'Plus 루틴 비교 실패');
  assert.equal(plusJourney.result.value.collections, 1, 'Plus 가이드 모음 만들기 실패');
  assert.equal(plusJourney.result.value.plusVisible, true, 'Plus 화면 표시 실패');
  assert.equal(plusJourney.result.value.smallTargets, 0, `Plus 동적 조작 요소 44px 미달 ${plusJourney.result.value.smallTargets}개`);
  const advertisingRequests = events.filter((event) => event.method === 'Network.requestWillBeSent' && /googlesyndication|doubleclick|amazon-adsystem|media\.net/i.test(event.params?.request?.url || ''));
  assert.equal(advertisingRequests.length, 0, `기본 차단 상태에서 외부 광고 요청 ${advertisingRequests.length}건 발생`);
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 1000);
    socket.addEventListener('close', () => { clearTimeout(timeout); resolve(); }, { once: true });
    socket.close();
  });
  console.log(`[layout-verify] PASS — ${results.length + 3}개 화면과 무료·Plus·광고 투명성·공급망 여정, 외부 광고 네트워크 요청 0, 360·390·640(200% 재배치)·1440px, 접근 가능한 이름·첫 Tab·움직임 줄이기·가로 넘침·작은/잘린 조작 요소·내부 문구 0`);
} finally {
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await Promise.race([exited, wait(3000)]);
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { await rm(profile, { recursive: true, force: true }); break; }
    catch { if (attempt < 4) await wait(200 * (attempt + 1)); }
  }
}
