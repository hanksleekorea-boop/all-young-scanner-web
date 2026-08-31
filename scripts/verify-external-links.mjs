import fs from 'node:fs/promises';

const TIMEOUT_MS = 15_000;
const source = JSON.parse(await fs.readFile(new URL('../content/usage-guides.json', import.meta.url), 'utf8'));
const links = [...new Map((source.sources ?? []).map((item) => [item.url, {
  ...item,
  label: item.title ?? item.id
}])).values()];

if (!links.length) throw new Error('검사할 외부 출처 URL이 없습니다.');

async function probe(item) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(item.url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'AllYoungScanner-PublisherQuality/0.34 (+https://hanksleekorea-boop.github.io/all-young-scanner-web/)'
      }
    });
    return {
      label: item.label,
      url: item.url,
      final_url: response.url,
      status: response.status,
      outcome: response.status >= 200 && response.status < 400
        ? 'pass'
        : response.status === 403 || response.status === 429
          ? 'reachable_bot_restricted'
          : 'fail'
    };
  } catch (error) {
    return {
      label: item.label,
      url: item.url,
      status: 0,
      outcome: error?.name === 'AbortError' ? 'timeout' : 'network_error',
      error: String(error?.message ?? error)
    };
  } finally {
    clearTimeout(timer);
  }
}

const results = [];
for (const item of links) results.push(await probe(item));

const summary = {
  checked_at: new Date().toISOString(),
  total: results.length,
  passed: results.filter((item) => item.outcome === 'pass').length,
  bot_restricted: results.filter((item) => item.outcome === 'reachable_bot_restricted').length,
  failed: results.filter((item) => !['pass', 'reachable_bot_restricted'].includes(item.outcome)).length,
  results
};

console.log(JSON.stringify(summary, null, 2));
if (summary.failed > 0) process.exitCode = 1;
