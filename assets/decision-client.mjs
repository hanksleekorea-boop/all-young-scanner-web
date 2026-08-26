const QUESTION_ORDER = ['concern', 'skin_type', 'avoid_ingredients', 'budget', 'texture'];
const MAX_RESPONSE_BYTES = 256 * 1024;

export class DecisionClientError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.name = 'DecisionClientError';
    this.code = code;
    this.status = status;
  }
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new DecisionClientError('secure_api_required');
  return url.href.replace(/\/$/, '');
}

function clientSessionId() {
  return `web_${crypto.randomUUID().replaceAll('-', '')}`;
}

function clientOperationId() {
  return `op_${crypto.randomUUID().replaceAll('-', '')}`;
}

export function createDecisionClient({ baseUrl, fetchImpl = fetch, timeoutMs = 12_000 } = {}) {
  const base = normalizeBaseUrl(baseUrl);

  async function request(path, { method = 'GET', body, signal } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetchImpl(`${base}${path}`, {
        method,
        headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      });
      const declared = Number(response.headers.get('content-length') || 0);
      if (declared > MAX_RESPONSE_BYTES) throw new DecisionClientError('response_too_large', response.status);
      const text = await response.text();
      if (new TextEncoder().encode(text).length > MAX_RESPONSE_BYTES) throw new DecisionClientError('response_too_large', response.status);
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch { throw new DecisionClientError('invalid_response', response.status); }
      if (!response.ok || payload === null || typeof payload !== 'object') throw new DecisionClientError(payload?.error || 'temporarily_unavailable', response.status);
      return payload;
    } catch (error) {
      if (error instanceof DecisionClientError) throw error;
      if (controller.signal.aborted) throw new DecisionClientError('request_timeout');
      throw new DecisionClientError('temporarily_unavailable');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  async function start({ answers, client_session_id = clientSessionId(), signal } = {}) {
    if (!answers || QUESTION_ORDER.some((question) => !(question in answers))) throw new DecisionClientError('answers_incomplete');
    const started = await request('/decision/start', { method: 'POST', body: { client_session_id }, signal });
    if (typeof started.decision_id !== 'string' || typeof started.expires_at !== 'string') throw new DecisionClientError('invalid_response');
    for (const question_id of QUESTION_ORDER) {
      await request('/decision/answer', { method: 'POST', body: { decision_id: started.decision_id, question_id, answer: answers[question_id] }, signal });
    }
    const result = await request(`/decision/${encodeURIComponent(started.decision_id)}/candidates`, { signal });
    if (!Array.isArray(result.candidates) || !['ok', 'insufficient_candidates'].includes(result.status)) throw new DecisionClientError('invalid_response');
    return { ...result, decision_id: started.decision_id, expires_at: started.expires_at };
  }

  async function compare(productIds, { signal } = {}) {
    if (!Array.isArray(productIds) || productIds.length < 1 || productIds.length > 3) throw new DecisionClientError('invalid_product_count');
    return request(`/compare?product_ids=${productIds.map(encodeURIComponent).join(',')}`, { signal });
  }

  async function complete(decisionId, { client_op_id = clientOperationId(), signal } = {}) {
    return request('/decision/complete', { method: 'POST', body: { decision_id: decisionId, client_op_id }, signal });
  }

  return Object.freeze({ start, compare, complete });
}

export { QUESTION_ORDER };
