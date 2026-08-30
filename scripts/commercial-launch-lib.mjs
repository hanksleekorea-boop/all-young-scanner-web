const PUBLISHER = /^ca-pub-\d{16}$/;
const SLOT = /^\d{6,20}$/;
const DATE = /^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/;
const URL = /^https:\/\/[^\s]+$/i;
const SECRET_KEY = /(secret|token|password|private.?key|cookie|service.?role)/i;
const SECRET_VALUE = /(?:-----BEGIN [A-Z ]+PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{20,}\.|sk_[A-Za-z0-9]{20,})/;

const text = (value) => typeof value === 'string' && value.trim().length > 0;
const date = (value) => text(value) && DATE.test(value);
const url = (value) => text(value) && URL.test(value);

function scanSecrets(value, path = '$', failures = []) {
  if (Array.isArray(value)) value.forEach((item, index) => scanSecrets(item, `${path}[${index}]`, failures));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) failures.push(`${path}.${key}: secret-looking key is forbidden`);
      scanSecrets(child, `${path}.${key}`, failures);
    }
  } else if (typeof value === 'string' && SECRET_VALUE.test(value)) failures.push(`${path}: secret-looking value is forbidden`);
  return failures;
}

export function evaluateCommercialLaunch(input = {}) {
  const structuralFailures = scanSecrets(input);
  if (input.schema_version !== 1) structuralFailures.push('schema_version must be 1');
  if (input.release_id !== '2026-08-30-service-v0.33') structuralFailures.push('release_id must match the current public release');
  const ads = input.adsense || {};
  const slots = ads.slot_ids || {};
  const approverNames = [...new Set((input.approvers?.names || []).map((name) => String(name).trim()).filter(Boolean))];
  const host = String(input.site?.hostname || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const gates = [
    ['operator', '운영자 신원·책임 연락', text(input.operator?.legal_name) && text(input.operator?.public_contact) && text(input.operator?.privacy_contact) && date(input.operator?.verified_at) && url(input.operator?.evidence_url)],
    ['editorial', '24개 가이드 사람 승인', input.editorial?.approved_guides === 24 && text(input.editorial?.reviewer) && date(input.editorial?.approved_at) && url(input.editorial?.evidence_url)],
    ['android', '현재판 Android', input.android?.release_id === input.release_id && text(input.android?.device_model) && Number(input.android?.journeys_passed) >= 3 && date(input.android?.completed_at) && url(input.android?.evidence_url)],
    ['ios', '현재판 iOS', input.ios?.release_id === input.release_id && text(input.ios?.device_model) && Number(input.ios?.journeys_passed) >= 3 && date(input.ios?.completed_at) && url(input.ios?.evidence_url)],
    ['users', '동의한 실제 사용자 5명', Number(input.users?.consenting_users) >= 5 && Number(input.users?.core_task_success_percent) >= 90 && input.users?.critical_defects === 0 && input.users?.brand_confusion_cases === 0 && date(input.users?.completed_at) && url(input.users?.evidence_url)],
    ['site', '운영자 제어 웹사이트', text(host) && !host.includes('/') && input.site?.operator_controlled === true && input.site?.html_editable === true && input.site?.https_verified === true && input.site?.adsense_registered === true && date(input.site?.verified_at) && url(input.site?.evidence_url)],
    ['adsense', 'AdSense 계정·사이트·광고 단위 승인', ads.account_approved === true && ads.site_approved === true && PUBLISHER.test(ads.publisher_id || '') && Object.values(slots).length === 3 && Object.values(slots).every((id) => SLOT.test(id)) && date(ads.approved_at) && url(ads.evidence_url)],
    ['cmp', 'Google 인증 동의 관리', input.cmp?.google_certified === true && text(input.cmp?.platform_name) && input.cmp?.tcf_verified === true && input.cmp?.gpp_verified === true && date(input.cmp?.verified_at) && url(input.cmp?.evidence_url)],
    ['ads_txt', '최상위 ads.txt', url(input.ads_txt?.root_url) && Number(input.ads_txt?.authorized_seller_rows) >= 1 && input.ads_txt?.publisher_match === true && date(input.ads_txt?.verified_at) && url(input.ads_txt?.evidence_url)],
    ['policy_review', '개인정보·광고 사람 검토', text(input.policy_review?.privacy_reviewer) && text(input.policy_review?.advertising_reviewer) && date(input.policy_review?.completed_at) && url(input.policy_review?.evidence_url)],
    ['approvers', '서로 다른 광고 승인자 2명', approverNames.length >= 2 && date(input.approvers?.approved_at) && url(input.approvers?.evidence_url)],
    ['limited_rollout', '5% 제한 공개 관찰', text(input.limited_rollout?.country_group) && text(input.limited_rollout?.provider) && text(input.limited_rollout?.placement) && Number(input.limited_rollout?.allocation_percent) > 0 && Number(input.limited_rollout?.allocation_percent) <= 5 && Number(input.limited_rollout?.sample_size) >= 1000 && input.limited_rollout?.policy_violations === 0 && input.limited_rollout?.critical_defects === 0 && date(input.limited_rollout?.completed_at) && url(input.limited_rollout?.evidence_url)]
  ].map(([id, label, passed]) => ({ id, label, passed: Boolean(passed) }));
  const passed = gates.filter((gate) => gate.passed).length;
  return { structural_valid: structuralFailures.length === 0, structural_failures: structuralFailures, total: gates.length, passed, percent: Math.round((passed / gates.length) * 1000) / 10, complete: structuralFailures.length === 0 && passed === gates.length, gates };
}

export function makeAdvertisingActivation(input) {
  const result = evaluateCommercialLaunch(input);
  if (!result.complete) throw new Error(`COMMERCIAL_LAUNCH_INCOMPLETE:${result.passed}/${result.total}`);
  return {
    enabled: true,
    publisher_id: input.adsense.publisher_id,
    certified_cmp_ready: true,
    operator_identity_confirmed: true,
    default_mode: 'contextual',
    slots: { ...input.adsense.slot_ids },
    initial_rollout: {
      country_group: input.limited_rollout.country_group,
      provider: input.limited_rollout.provider,
      placement: input.limited_rollout.placement,
      allocation_percent: input.limited_rollout.allocation_percent
    }
  };
}
