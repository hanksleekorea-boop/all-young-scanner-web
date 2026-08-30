const text = (selector, value) => { const node = document.querySelector(selector); if (node) node.textContent = String(value); };

async function loadGovernance() {
  try {
    const [configResponse, statusResponse] = await Promise.all([
      fetch('./advertising-config.json', { cache: 'no-store', credentials: 'same-origin' }),
      fetch('./ad-stage3-readiness.json', { cache: 'no-store', credentials: 'same-origin' }),
    ]);
    if (!configResponse.ok || !statusResponse.ok) throw new Error('STATUS_UNAVAILABLE');
    const [config, status] = await Promise.all([configResponse.json(), statusResponse.json()]);
    const stage = config.stage_three || {};
    text('#governance-status', `현재 고급 광고 운영: ${stage.enabled ? '제한적으로 켜짐' : '꺼짐'}`);
    text('#optimization-mode', stage.mode === 'shadow-only' ? '그림자 전용' : '제한 공개');
    text('#direct-campaign-count', status.active_operations?.direct_campaigns ?? 0);
    text('#supply-chain-count', `${status.supply_chain?.done ?? 0}/${status.supply_chain?.total ?? 0}`);
    text('#stage-three-condition-count', `${status.external_activation?.done ?? 0}/${status.external_activation?.total ?? 0}`);
    document.documentElement.dataset.adGovernanceReady = 'true';
  } catch {
    text('#governance-status', '현재 고급 광고 운영: 상태를 확인할 수 없어 계속 차단됨');
  }
}

loadGovernance();
