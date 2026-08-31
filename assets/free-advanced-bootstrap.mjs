import { mountFreeAdvancedApp } from './free-advanced-app.mjs';
import { mountCatalogV4 } from './catalog-v4.mjs';

Promise.all([mountFreeAdvancedApp(), mountCatalogV4()]).catch(() => {
  const status = document.querySelector('#app-status');
  if (status) status.textContent = '서비스 자료를 불러오지 못했습니다. 잠시 후 다시 시도하거나 가이드 목록을 이용해 주세요.';
});

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {}));
}
