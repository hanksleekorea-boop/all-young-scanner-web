import { clearAdMetrics, readAdMetrics, summarizeAdMetrics } from './ad-metrics.mjs';

const text = (selector, value) => { const node = document.querySelector(selector); if (node) node.textContent = String(value); };
async function loadStatus() {
  try {
    const [configResponse, statusResponse] = await Promise.all([
      fetch('./advertising-config.json', { cache: 'no-store', credentials: 'same-origin' }),
      fetch('./ad-stage2-readiness.json', { cache: 'no-store', credentials: 'same-origin' }),
    ]);
    if (!configResponse.ok || !statusResponse.ok) throw new Error('STATUS_UNAVAILABLE');
    const [config, status] = await Promise.all([configResponse.json(), statusResponse.json()]);
    text('#routing-state', config.stage_two?.enabled ? '제한적으로 켜짐' : '꺼짐');
    text('#external-provider-count', status.active_providers?.external ?? 0);
    text('#house-provider-count', status.active_providers?.house ?? 1);
    text('#external-condition-count', `${status.external_activation?.done ?? 0}/${status.external_activation?.total ?? 0}`);
    document.documentElement.dataset.adOperationsReady = 'true';
  } catch { text('#operations-status', '현재 상태 파일을 불러오지 못했습니다. 외부 광고는 계속 차단됩니다.'); }
}

function renderLocalSummary() {
  const summary = summarizeAdMetrics(readAdMetrics());
  text('#local-event-count', summary.requests + summary.impressions);
  text('#local-fill-rate', `${Math.round(summary.fill_rate * 100)}%`);
  text('#local-error-rate', `${Math.round(summary.error_rate * 100)}%`);
}

document.querySelector('#clear-ad-operations')?.addEventListener('click', () => {
  clearAdMetrics(); renderLocalSummary(); text('#operations-status', '이 기기의 광고 운영 기록을 삭제했습니다.');
});

const navigation = document.querySelector('main .wrap > p:last-child');
if (navigation) {
  const governance = document.createElement('a');
  governance.href = 'ad-governance.html';
  governance.textContent = '광고 공급망·안전 운영';
  navigation.prepend(governance, document.createTextNode(' · '));
}

loadStatus(); renderLocalSummary();
