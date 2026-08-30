const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const SAFE_AGGREGATE_FIELDS = new Set(['provider_id', 'campaign_id', 'placement_id', 'region_group', 'format', 'day', 'requests', 'impressions', 'viewable_impressions', 'errors', 'timeouts', 'revenue_micros', 'latency_total_ms', 'policy_violations', 'invalid_traffic_events']);

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, finite(value)));
const unique = (values = []) => [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))];

export function parseAdsTxt(text = '') {
  const entries = [];
  const directives = {};
  const errors = [];
  for (const [index, raw] of String(text).split(/\r?\n/).entries()) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const directive = line.match(/^([A-Z]+)\s*=\s*(.+)$/);
    if (directive) {
      if (!['OWNERDOMAIN', 'MANAGERDOMAIN', 'CONTACT', 'SUBDOMAIN', 'INVENTORYPARTNERDOMAIN'].includes(directive[1])) errors.push(`LINE_${index + 1}_DIRECTIVE_UNKNOWN`);
      else if (directives[directive[1]]) errors.push(`LINE_${index + 1}_DIRECTIVE_DUPLICATE`);
      else if (directive[1] === 'OWNERDOMAIN' && !DOMAIN.test(directive[2].trim().toLowerCase())) errors.push(`LINE_${index + 1}_OWNERDOMAIN_INVALID`);
      else directives[directive[1]] = directive[2].trim().toLowerCase();
      continue;
    }
    const fields = line.split(',').map((value) => value.trim());
    if (fields.length < 3 || fields.length > 4 || !DOMAIN.test(fields[0].toLowerCase()) || !fields[1] || !['DIRECT', 'RESELLER'].includes(fields[2].toUpperCase())) {
      errors.push(`LINE_${index + 1}_ENTRY_INVALID`); continue;
    }
    entries.push({ ad_system_domain: fields[0].toLowerCase(), seller_account_id: fields[1], relationship: fields[2].toUpperCase(), certification_authority_id: fields[3] || '' });
  }
  return { valid: errors.length === 0, directives, entries, errors };
}

export function validateSupplyChain(supply = {}) {
  const errors = [];
  if (!DOMAIN.test(supply.owner_domain || '')) errors.push('OWNER_DOMAIN_REQUIRED');
  if (!Array.isArray(supply.ads_txt_entries) || supply.ads_txt_entries.length === 0) errors.push('ADS_TXT_ENTRY_REQUIRED');
  if (!Array.isArray(supply.sellers_json_entries) || supply.sellers_json_entries.length === 0) errors.push('SELLERS_JSON_ENTRY_REQUIRED');
  if (!Array.isArray(supply.schain_nodes) || supply.schain_nodes.length === 0) errors.push('SCHAIN_NODE_REQUIRED');
  const sellerKeys = new Set((supply.sellers_json_entries || []).filter((entry) => entry.verified && DOMAIN.test(entry.ad_system_domain || '') && entry.seller_account_id && entry.publisher_domain === supply.owner_domain).map((entry) => `${entry.ad_system_domain}|${entry.seller_account_id}`));
  const chainKeys = new Set((supply.schain_nodes || []).filter((entry) => entry.verified && DOMAIN.test(entry.ad_system_domain || '') && entry.seller_account_id).map((entry) => `${entry.ad_system_domain}|${entry.seller_account_id}`));
  const adsKeys = new Set();
  for (const entry of supply.ads_txt_entries || []) {
    const key = `${entry.ad_system_domain}|${entry.seller_account_id}`;
    if (adsKeys.has(key)) errors.push(`ADS_TXT_ENTRY_DUPLICATE:${key}`);
    adsKeys.add(key);
    if (!entry.verified || !DOMAIN.test(entry.ad_system_domain || '') || !entry.seller_account_id || !['DIRECT', 'RESELLER'].includes(entry.relationship)) errors.push(`ADS_TXT_ENTRY_INVALID:${key}`);
    if (!sellerKeys.has(key)) errors.push(`SELLERS_JSON_MISMATCH:${key}`);
    if (!chainKeys.has(key)) errors.push(`SCHAIN_MISMATCH:${key}`);
  }
  if (supply.schain_complete !== true) errors.push('SCHAIN_COMPLETE_REQUIRED');
  if (supply.verified !== true) errors.push('SUPPLY_CHAIN_OPERATOR_VERIFICATION_REQUIRED');
  return { valid: errors.length === 0, errors };
}

export function validateStageThreeConfig(config = {}) {
  const stage = config.stage_three;
  const errors = [];
  if (config.schema_version !== 3) errors.push('SCHEMA_VERSION_3_REQUIRED');
  if (!stage || typeof stage !== 'object') return { valid: false, errors: [...errors, 'STAGE_THREE_CONFIG_REQUIRED'] };
  if (stage.fail_closed !== true) errors.push('FAIL_CLOSED_REQUIRED');
  if (!['shadow-only', 'limited-live'].includes(stage.mode)) errors.push('MODE_INVALID');
  if (stage.optimization?.max_live_allocation_percent > 5 || stage.optimization?.max_live_allocation_percent < 0) errors.push('LIVE_ALLOCATION_MAX_5');
  if (stage.optimization?.holdout_percent < 10) errors.push('HOLDOUT_MIN_10');
  if (stage.optimization?.min_sample_size < 1000) errors.push('MIN_SAMPLE_1000');
  if (stage.frequency_caps?.max_impressions_per_session > 3 || stage.frequency_caps?.max_impressions_per_placement > 1) errors.push('FREQUENCY_CAP_TOO_HIGH');
  if (stage.traffic_quality?.automation_block !== true || stage.traffic_quality?.test_traffic_block !== true) errors.push('INVALID_TRAFFIC_GATES_REQUIRED');
  if (stage.aggregate_reporting?.local_only !== true || stage.aggregate_reporting?.max_rows > 500 || stage.aggregate_reporting?.max_days > 30) errors.push('AGGREGATE_RETENTION_INVALID');
  if (stage.enabled) {
    const governance = stage.governance || {};
    const approvals = unique(governance.approved_by);
    if (!governance.signed_config || approvals.length < Math.max(2, governance.required_approvals || 2)) errors.push('TWO_APPROVALS_AND_SIGNED_CONFIG_REQUIRED');
    if (!governance.rollback_fingerprint) errors.push('ROLLBACK_FINGERPRINT_REQUIRED');
    if (!Object.values(stage.activation || {}).every((value) => value === true)) errors.push('ACTIVATION_EVIDENCE_INCOMPLETE');
    errors.push(...validateSupplyChain(stage.supply_chain).errors);
  }
  return { valid: errors.length === 0, errors };
}

export function evaluateTrafficQuality(signal = {}, policy = {}) {
  const reasons = [];
  if (policy.automation_block && signal.automation === true) reasons.push('AUTOMATION_TRAFFIC');
  if (policy.test_traffic_block && signal.test_traffic === true) reasons.push('TEST_TRAFFIC');
  if (signal.event_sequence_valid === false) reasons.push('EVENT_SEQUENCE_INVALID');
  if (finite(signal.repeat_burst) > finite(policy.max_repeat_burst, 4)) reasons.push('REPEAT_BURST');
  if (signal.event === 'impression' && finite(signal.visible_ms) < finite(policy.min_viewable_ms, 1000)) reasons.push('VIEWABILITY_TOO_SHORT');
  return { allowed: reasons.length === 0, reasons };
}

export function enforceFrequencyCaps(session = {}, caps = {}) {
  if (finite(session.total_impressions) >= finite(caps.max_impressions_per_session, 3)) return { allowed: false, reason: 'SESSION_FREQUENCY_CAP' };
  if (finite(session.placement_impressions) >= finite(caps.max_impressions_per_placement, 1)) return { allowed: false, reason: 'PLACEMENT_FREQUENCY_CAP' };
  if (finite(session.minutes_since_last_impression, Infinity) < finite(caps.minimum_interval_minutes, 10)) return { allowed: false, reason: 'MINIMUM_INTERVAL' };
  return { allowed: true, reason: 'FREQUENCY_READY' };
}

export function selectDirectCampaign({ campaigns = [], context = {}, delivery = {} } = {}) {
  const now = String(context.day || '').slice(0, 10);
  const candidates = campaigns.filter((campaign) => campaign.enabled && campaign.approved && campaign.contract_verified
    && campaign.start_day <= now && campaign.end_day >= now
    && campaign.regions?.includes(context.region_group) && campaign.placements?.includes(context.placement_id)
    && campaign.formats?.includes(context.format)
    && finite(delivery[campaign.id]?.impressions) < finite(campaign.daily_impression_cap)
    && finite(delivery[campaign.id]?.spend_micros) < finite(campaign.daily_spend_cap_micros));
  candidates.sort((left, right) => finite(right.priority) - finite(left.priority) || finite(right.expected_cpm_micros) - finite(left.expected_cpm_micros) || left.id.localeCompare(right.id));
  return candidates[0] || null;
}

export function scoreMonetizationCandidate(candidate = {}, health = {}) {
  const viewability = clamp(health.viewability_rate ?? 1, 0, 1);
  const fill = clamp(health.fill_rate ?? 1, 0, 1);
  const errorPenalty = 1 - clamp(health.error_rate ?? 0, 0, 1);
  const latencyPenalty = 1 - clamp(finite(health.latency_ms) / 5000, 0, 0.5);
  const policyPenalty = finite(health.policy_violations) > 0 ? 0 : 1;
  return Math.round(finite(candidate.expected_cpm_micros) * viewability * fill * errorPenalty * latencyPenalty * policyPenalty);
}

function allocationBucket(seed = '') {
  let hash = 2166136261;
  for (const char of String(seed)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash % 100;
}

export function chooseLimitedRollout({ seed = '', allocation_percent = 0, holdout_percent = 10 } = {}) {
  const bucket = allocationBucket(seed);
  if (bucket < clamp(holdout_percent, 10, 100)) return 'holdout';
  if (bucket < clamp(holdout_percent, 10, 100) + clamp(allocation_percent, 0, 5)) return 'candidate';
  return 'control';
}

export function selectMonetizationCandidate({ config = {}, context = {}, traffic = {}, session = {}, delivery = {}, programmatic = [], health = {}, seed = '' } = {}) {
  const validation = validateStageThreeConfig(config);
  if (!validation.valid) return { allowed: false, serve: false, reason: validation.errors[0] };
  const stage = config.stage_three;
  if (!stage.enabled) return { allowed: false, serve: false, reason: 'STAGE_THREE_DISABLED' };
  const quality = evaluateTrafficQuality(traffic, stage.traffic_quality);
  if (!quality.allowed) return { allowed: false, serve: false, reason: quality.reasons[0] };
  const frequency = enforceFrequencyCaps(session, stage.frequency_caps);
  if (!frequency.allowed) return { allowed: false, serve: false, reason: frequency.reason };
  const direct = stage.direct_campaigns?.enabled ? selectDirectCampaign({ campaigns: stage.direct_campaigns.campaigns, context, delivery }) : null;
  const candidates = [...programmatic.filter((candidate) => candidate.approved && candidate.contract_verified), ...(direct ? [{ ...direct, type: 'direct' }] : [])];
  if (!candidates.length) return { allowed: false, serve: false, reason: 'NO_MONETIZATION_CANDIDATE' };
  candidates.sort((left, right) => scoreMonetizationCandidate(right, health[right.id]) - scoreMonetizationCandidate(left, health[left.id]) || left.id.localeCompare(right.id));
  const selected = candidates[0];
  if (stage.mode === 'shadow-only' || !stage.optimization.enabled) return { allowed: true, serve: false, reason: 'SHADOW_DECISION', candidate: selected };
  if (!seed) return { allowed: false, serve: false, reason: 'ROLLOUT_SEED_REQUIRED', candidate: selected };
  const cohort = chooseLimitedRollout({ seed, allocation_percent: stage.optimization.max_live_allocation_percent, holdout_percent: stage.optimization.holdout_percent });
  return { allowed: true, serve: cohort === 'candidate', reason: cohort === 'candidate' ? 'LIMITED_LIVE_DECISION' : 'ROLLOUT_CONTROL', cohort, candidate: selected };
}

export function evaluateAdvancedStopLoss(metrics = {}, limits = {}) {
  const reasons = [];
  if (finite(metrics.invalid_traffic_rate) > finite(limits.max_invalid_traffic_rate, 0.01)) reasons.push('INVALID_TRAFFIC_RATE');
  if (finite(metrics.user_complaint_rate) > finite(limits.max_user_complaint_rate, 0.001)) reasons.push('USER_COMPLAINT_RATE');
  if (finite(metrics.revenue_drop_rate) > finite(limits.max_revenue_drop_rate, 0.1)) reasons.push('REVENUE_DROP');
  if (finite(metrics.core_journey_success_rate, 1) < finite(limits.min_core_journey_success_rate, 0.99)) reasons.push('CORE_JOURNEY_REGRESSION');
  if (finite(metrics.supply_chain_mismatches) > 0) reasons.push('SUPPLY_CHAIN_MISMATCH');
  if (finite(metrics.policy_violations) > 0) reasons.push('POLICY_VIOLATION');
  return { stop: reasons.length > 0, reasons };
}

export function sanitizeAggregateRow(input = {}) {
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (!SAFE_AGGREGATE_FIELDS.has(key)) continue;
    if (typeof value === 'string' && value.length <= 80) output[key] = value;
    if (Number.isInteger(value) && value >= 0 && value <= 10_000_000_000) output[key] = value;
  }
  return output;
}

export function pruneAggregateRows(rows = [], { now_day = new Date().toISOString().slice(0, 10), max_days = 30, max_rows = 500 } = {}) {
  const now = Date.parse(`${now_day}T00:00:00Z`);
  const cutoff = now - (clamp(max_days, 1, 30) - 1) * 86_400_000;
  return rows.map(sanitizeAggregateRow).filter((row) => {
    const day = Date.parse(`${row.day || ''}T00:00:00Z`);
    return Number.isFinite(day) && day >= cutoff && day <= now;
  }).slice(-Math.floor(clamp(max_rows, 1, 500)));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

export function createRollbackFingerprint(config = {}) {
  const source = JSON.stringify(stable(config));
  let hash = 2166136261;
  for (const char of source) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return `fnv1a-${hash.toString(16).padStart(8, '0')}`;
}

export const stageThreeAggregateFields = Object.freeze([...SAFE_AGGREGATE_FIELDS]);
