import { mountFreeAdvancedApp } from './free-advanced-app.mjs';

mountFreeAdvancedApp().catch(() => {
  const status = document.querySelector('#app-status');
  if (status) status.textContent = '가이드를 불러오지 못했습니다. 잠시 후 다시 시도하거나 가이드 목록을 이용해 주세요.';
});

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {}));
}
