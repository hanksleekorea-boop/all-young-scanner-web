import { canActivateAdvertising, inferPageKind } from './ad-policy.mjs';
import { resolveAdvertisingConsent } from './consent-gate.mjs';

const CONFIG_URL = new URL('../advertising-config.json', import.meta.url);

function showFallback(slot, reason) {
  slot.replaceChildren();
  const label = document.createElement('span');
  label.className = 'ad-slot__label';
  label.textContent = '올영스캐너 안내';
  const text = document.createElement('p');
  text.textContent = '광고보다 먼저, 내 루틴과 사용 기록을 안전하게 확인해 보세요.';
  slot.append(label, text);
  slot.dataset.adState = 'house';
  slot.dataset.adReason = reason;
}

function loadGoogleScript(publisherId) {
  if (document.querySelector('script[data-ays-ad-provider]')) return;
  const script = document.createElement('script');
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.dataset.aysAdProvider = 'google-adsense';
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(publisherId)}`;
  document.head.append(script);
}

export async function mountAdvertising() {
  const slots = [...document.querySelectorAll('.ad-slot[data-ad-slot]')];
  if (!slots.length) return { status: 'no-slots', slots: 0 };
  let config;
  try {
    const response = await fetch(CONFIG_URL, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('CONFIG_FETCH_FAILED');
    config = await response.json();
  } catch {
    slots.forEach((slot) => showFallback(slot, 'CONFIG_UNAVAILABLE'));
    document.documentElement.dataset.adsStatus = 'blocked';
    return { status: 'blocked', reason: 'CONFIG_UNAVAILABLE', slots: slots.length };
  }
  const consent = await resolveAdvertisingConsent();
  let active = 0;
  for (const slot of slots) {
    const pageKind = slot.dataset.pageKind || inferPageKind(location.pathname, location.hash);
    const result = canActivateAdvertising({ config, pageKind, slotName: slot.dataset.adSlot, consent });
    if (!result.allowed) { showFallback(slot, result.reason); continue; }
    const ad = document.createElement('ins');
    ad.className = 'adsbygoogle';
    ad.style.display = 'block';
    ad.dataset.adClient = config.publisher_id;
    ad.dataset.adSlot = result.slotId;
    ad.dataset.adFormat = 'auto';
    ad.dataset.fullWidthResponsive = 'true';
    slot.replaceChildren(ad);
    slot.dataset.adState = 'provider';
    active += 1;
  }
  if (active) {
    loadGoogleScript(config.publisher_id);
    for (let index = 0; index < active; index += 1) (globalThis.adsbygoogle = globalThis.adsbygoogle || []).push({});
  }
  document.documentElement.dataset.adsStatus = active ? 'active' : 'blocked';
  return { status: active ? 'active' : 'blocked', slots: slots.length, active };
}

if (typeof document !== 'undefined') mountAdvertising().catch(() => { document.documentElement.dataset.adsStatus = 'blocked'; });
