const TRUSTED_REGION_SOURCES = new Set(['certified-cmp', 'operator-server']);
const BUNDLED_ADAPTERS = new Set(['house', 'google-adsense']);
const SAFE_METRIC_FIELDS = new Set(['provider_id', 'placement_id', 'region_group', 'device_class', 'event', 'latency_ms', 'viewable', 'error_code', 'release_id']);

export function validateStageTwoConfig(config = {}) {
  const stage = config.stage_two;
  const errors = [];
  if (!stage || typeof stage !== 'object') return { valid: false, errors: ['STAGE_TWO_CONFIG_REQUIRED'] };
  if (stage.fail_closed !== true) errors.push('FAIL_CLOSED_REQUIRED');
  if (stage.request_budget?.providers_per_slot !== 1) errors.push('ONE_PROVIDER_PER_SLOT_REQUIRED');
  if (stage.request_budget?.retries !== 0) errors.push('RETRIES_MUST_BE_ZERO');
  if (!Number.isInteger(stage.request_budget?.timeout_ms) || stage.request_budget.timeout_ms < 300 || stage.request_budget.timeout_ms > 3000) errors.push('TIMEOUT_BUDGET_INVALID');
  if (!Array.isArray(stage.providers) || !stage.providers.some((provider) => provider.id === 'house')) errors.push('HOUSE_PROVIDER_REQUIRED');
  if (!stage.regional_policies?.UNKNOWN || stage.regional_policies.UNKNOWN.ads_allowed !== false) errors.push('UNKNOWN_REGION_MUST_BE_BLOCKED');
  const ids = new Set();
  for (const provider of stage.providers || []) {
    if (!provider.id || ids.has(provider.id)) errors.push('PROVIDER_ID_INVALID');
    ids.add(provider.id);
    if (provider.enabled && !BUNDLED_ADAPTERS.has(provider.adapter)) errors.push(`ADAPTER_NOT_BUNDLED:${provider.id}`);
  }
  return { valid: errors.length === 0, errors };
}

export function resolveRegionalPolicy({ config = {}, regionGroup = 'UNKNOWN', regionSource = 'untrusted', consent = {} } = {}) {
  const stage = config.stage_two || {};
  if (!stage.enabled) return { allowed: false, reason: 'STAGE_TWO_DISABLED' };
  if (!TRUSTED_REGION_SOURCES.has(regionSource) || !stage.trusted_region_sources?.includes(regionSource)) return { allowed: false, reason: 'REGION_SOURCE_UNTRUSTED' };
  const policy = stage.regional_policies?.[regionGroup];
  if (!policy || regionGroup === 'UNKNOWN') return { allowed: false, reason: 'REGION_UNRESOLVED' };
  if (!policy.operator_reviewed || !policy.ads_allowed) return { allowed: false, reason: 'REGION_NOT_APPROVED' };
  if (policy.required_signal === 'tcf-certified' && !(consent.tcf === 'certified' && consent.tc_string === true)) return { allowed: false, reason: 'TCF_SIGNAL_REQUIRED' };
  if (policy.required_signal === 'gpp-valid-no-opt-out' && !(consent.gpp === 'valid' && consent.opt_out === false)) return { allowed: false, reason: 'GPP_SIGNAL_REQUIRED' };
  if (policy.required_signal === 'contextual-choice' && consent.mode !== 'contextual') return { allowed: false, reason: 'CONTEXTUAL_CHOICE_REQUIRED' };
  return { allowed: true, reason: 'REGION_READY', policy };
}

function providerScore(provider, health = {}) {
  const healthScore = Number.isFinite(health.score) ? Math.max(0, Math.min(100, health.score)) : 100;
  return (provider.priority || 0) * 1_000_000_000 + (provider.expected_cpm_micros || 0) * 100 + healthScore;
}

export function selectProvider({ config = {}, regionGroup = 'UNKNOWN', regionSource = 'untrusted', consent = {}, placementId = '', health = {} } = {}) {
  const validation = validateStageTwoConfig(config);
  if (!validation.valid) return { allowed: false, reason: validation.errors[0] };
  const regional = resolveRegionalPolicy({ config, regionGroup, regionSource, consent });
  if (!regional.allowed) return regional;
  const stage = config.stage_two;
  const placement = stage.placements?.[placementId];
  if (!placement) return { allowed: false, reason: 'PLACEMENT_UNKNOWN' };
  const candidates = stage.providers.filter((provider) => provider.external && provider.enabled && provider.bundled && BUNDLED_ADAPTERS.has(provider.adapter)
    && provider.supported_regions.includes(regionGroup) && provider.formats.includes(placement.format)
    && (provider.expected_cpm_micros || 0) >= (placement.floor_cpm_micros || 0)
    && health[provider.id]?.circuit !== 'open');
  if (!candidates.length) return { allowed: false, reason: 'NO_APPROVED_PROVIDER' };
  candidates.sort((left, right) => providerScore(right, health[right.id]) - providerScore(left, health[left.id]) || left.id.localeCompare(right.id));
  return { allowed: true, reason: 'PROVIDER_SELECTED', provider: candidates[0], timeout_ms: stage.request_budget.timeout_ms, retries: 0 };
}

export function evaluateStopLoss(metrics = {}, limits = {}) {
  const reasons = [];
  if ((metrics.error_rate || 0) > (limits.max_error_rate ?? 0.03)) reasons.push('ERROR_RATE');
  if ((metrics.timeout_rate || 0) > (limits.max_timeout_rate ?? 0.05)) reasons.push('TIMEOUT_RATE');
  if ((metrics.cls_delta || 0) > (limits.max_cls_delta ?? 0.05)) reasons.push('CLS_DELTA');
  if ((metrics.lcp_delta_ms || 0) > (limits.max_lcp_delta_ms ?? 300)) reasons.push('LCP_DELTA');
  if ((metrics.policy_violations || 0) > (limits.max_policy_violations ?? 0)) reasons.push('POLICY_VIOLATION');
  return { stop: reasons.length > 0, reasons };
}

export function chooseExperimentVariant({ experiment = {}, sessionSeed = '' } = {}) {
  if (!experiment.enabled || experiment.kill_switch || !Number.isInteger(experiment.allocation_percent) || experiment.allocation_percent <= 0) return 'control';
  let hash = 2166136261;
  for (const char of `${experiment.id || 'ad'}:${sessionSeed}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return (hash % 100) < Math.min(100, experiment.allocation_percent) ? 'candidate' : 'control';
}

export function sanitizeMetricEvent(input = {}) {
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (!SAFE_METRIC_FIELDS.has(key)) continue;
    if (typeof value === 'string' && value.length <= 80) output[key] = value;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 120_000) output[key] = value;
    if (typeof value === 'boolean') output[key] = value;
  }
  return output;
}

export const bundledAdvertisingAdapters = Object.freeze([...BUNDLED_ADAPTERS]);
