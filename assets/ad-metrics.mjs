import { sanitizeMetricEvent } from './ad-router.mjs';

const KEY = 'ays-ad-operations-v1';
const MAX_EVENTS = 200;

export function readAdMetrics(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map(sanitizeMetricEvent).filter((item) => Object.keys(item).length).slice(-MAX_EVENTS) : [];
  } catch { return []; }
}

export function recordAdMetric(event, storage = globalThis.localStorage) {
  const safe = sanitizeMetricEvent(event);
  if (!safe.event || !safe.placement_id) return { recorded: false, reason: 'METRIC_FIELDS_REQUIRED' };
  const events = [...readAdMetrics(storage), safe].slice(-MAX_EVENTS);
  storage.setItem(KEY, JSON.stringify(events));
  return { recorded: true, count: events.length };
}

export function summarizeAdMetrics(events = []) {
  const safe = events.map(sanitizeMetricEvent).filter((item) => item.event);
  const totals = { requests: 0, impressions: 0, errors: 0, timeouts: 0, viewable: 0, latency_total_ms: 0, latency_samples: 0 };
  for (const event of safe) {
    if (event.event === 'request') totals.requests += 1;
    if (event.event === 'impression') totals.impressions += 1;
    if (event.event === 'error') totals.errors += 1;
    if (event.event === 'timeout') totals.timeouts += 1;
    if (event.viewable === true) totals.viewable += 1;
    if (Number.isFinite(event.latency_ms)) { totals.latency_total_ms += event.latency_ms; totals.latency_samples += 1; }
  }
  return {
    requests: totals.requests,
    impressions: totals.impressions,
    fill_rate: totals.requests ? totals.impressions / totals.requests : 0,
    error_rate: totals.requests ? totals.errors / totals.requests : 0,
    timeout_rate: totals.requests ? totals.timeouts / totals.requests : 0,
    viewability_rate: totals.impressions ? totals.viewable / totals.impressions : 0,
    average_latency_ms: totals.latency_samples ? Math.round(totals.latency_total_ms / totals.latency_samples) : 0,
  };
}

export function clearAdMetrics(storage = globalThis.localStorage) { storage.removeItem(KEY); }
export const adMetricsKey = KEY;
