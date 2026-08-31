import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = 'https://hanksleekorea-boop.github.io/all-young-scanner-web/';
const reviewedAt = '2026-08-31';
const reviewDueAt = '2027-02-26';

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const currentContent = JSON.parse(await readFile(path.join(root, 'content', 'usage-guides.json'), 'utf8'));
const englishContent = JSON.parse(await readFile(path.join(root, 'content', 'usage-guides.en.json'), 'utf8'));
const usage = { sources: currentContent.sources, cards: currentContent.guides };

if (!Array.isArray(usage.sources) || usage.sources.length < 7) throw new Error('출처가 7개보다 적습니다.');
if (!Array.isArray(usage.cards) || usage.cards.length !== 24) throw new Error('공개 사용 가이드는 정확히 24개여야 합니다.');
if (englishContent.status !== 'ai_draft_human_review_pending' || englishContent.reviewed_by_human !== false) throw new Error('영문 초안의 사람 감수 대기 상태가 명확하지 않습니다.');
if (!Array.isArray(englishContent.guides) || englishContent.guides.length !== 24) throw new Error('영문 탐색 초안은 정확히 24개여야 합니다.');

const sourceById = new Map(usage.sources.map((source) => [source.id, source]));
const slugs = new Set();
for (const card of usage.cards) {
  if (!card.slug || slugs.has(card.slug)) throw new Error(`중복되거나 비어 있는 slug: ${card.slug}`);
  slugs.add(card.slug);
  const required = [card.title, card.summary, card.content_type, card.category, card.evidence_level, card.body?.one_line, card.body?.routine_position, card.body?.label_priority, card.body?.combine_note, card.body?.safety_note];
  if (required.some((value) => !String(value || '').trim())) throw new Error(`${card.slug}: 필수 콘텐츠가 비어 있습니다.`);
  if (card.body.not_medical_advice !== true) throw new Error(`${card.slug}: 의료 정보 경계가 없습니다.`);
  if (!Array.isArray(card.steps) || card.steps.length < 2) throw new Error(`${card.slug}: 따라 하기 단계가 부족합니다.`);
  if (!Array.isArray(card.source_refs) || card.source_refs.length === 0 || card.source_refs.some((id) => !sourceById.has(id))) throw new Error(`${card.slug}: 유효한 출처 연결이 없습니다.`);
}
if (englishContent.guides.some((guide) => !slugs.has(guide.slug) || !guide.title?.trim() || !guide.summary?.trim())) throw new Error('영문 탐색 초안이 한국어 정본과 일치하지 않습니다.');

const categoryLabels = {
  'minimal-routine': '기본 루틴',
  cleansing: '세안',
  hydration: '보습',
  sunscreen: '자외선 보호',
  exfoliation: '각질 관리',
  sensitivity: '민감 신호',
  combination: '함께 쓰기',
  'first-seven-days': '첫 7일',
};

const typeLabels = {
  minimal_routine: '기본 루틴',
  product_usage: '제품 사용법',
  compatibility: '함께 쓰기',
  safety: '안전 안내',
  first_seven_days: '첫 7일',
};

const pageStyle = `
:root{color-scheme:light;--ink:#1d2433;--muted:#667085;--line:#e6e9ef;--accent:#ef4f86;--soft:#fff1f6;--green:#177a52}*{box-sizing:border-box}body{margin:0;background:#fafbfc;color:var(--ink);font-family:Pretendard,"Noto Sans KR",system-ui,-apple-system,sans-serif;line-height:1.65}a{color:inherit}.skip{position:fixed;top:8px;left:8px;z-index:10;padding:10px 14px;background:#111;color:#fff;transform:translateY(-150%)}.skip:focus{transform:none}.wrap{width:min(920px,calc(100% - 32px));margin:auto}.top{position:sticky;top:0;z-index:2;border-bottom:1px solid var(--line);background:rgba(255,255,255,.96);backdrop-filter:blur(12px)}.top .wrap{display:flex;align-items:center;justify-content:space-between;min-height:64px;gap:16px}.brand{min-height:44px;display:inline-flex;align-items:center;font-weight:900;text-decoration:none}.home-link{min-height:44px;display:inline-flex;align-items:center;padding:0 14px;border:1px solid var(--line);border-radius:999px;text-decoration:none;background:#fff}main{padding:40px 0 72px}.eyebrow{color:var(--accent);font-weight:800}.hero{margin-bottom:28px}.hero h1{font-size:clamp(2rem,7vw,3.5rem);line-height:1.18;margin:.2em 0}.lead{font-size:1.08rem;color:var(--muted);max-width:70ch}.notice{padding:18px;border:1px solid #f2c9d8;background:var(--soft);border-radius:18px}.notice strong{display:block;margin-bottom:4px}.meta{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0}.chip{padding:6px 11px;border-radius:999px;background:#fff;border:1px solid var(--line);font-size:.9rem}.card{background:#fff;border:1px solid var(--line);border-radius:22px;padding:22px;margin:16px 0;box-shadow:0 8px 30px rgba(29,36,51,.04)}.card h2,.card h3{margin-top:0}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.fields div{padding:14px;background:#f7f8fa;border-radius:14px}.fields dt{font-weight:800}.fields dd{margin:4px 0 0;color:var(--muted)}ol{padding-left:1.4rem}li+li{margin-top:12px}.stop{display:block;color:#9d174d;font-weight:700;margin-top:5px}.sources{padding-left:1.2rem}.sources a{overflow-wrap:anywhere}.sources small{display:block;color:var(--muted)}.review{color:var(--muted);font-size:.93rem}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:28px}.button{min-height:48px;display:inline-flex;align-items:center;justify-content:center;padding:0 18px;border-radius:14px;text-decoration:none;font-weight:800;background:var(--ink);color:#fff}.button.secondary{background:#fff;color:var(--ink);border:1px solid var(--line)}.search{width:100%;min-height:52px;border:1px solid var(--line);border-radius:14px;padding:0 16px;font:inherit;background:#fff}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:20px}.guide-card{display:block;text-decoration:none;background:#fff;border:1px solid var(--line);border-radius:18px;padding:20px;min-height:176px}.guide-card:hover,.guide-card:focus-visible{border-color:var(--accent);box-shadow:0 10px 30px rgba(239,79,134,.1)}.guide-card h2{font-size:1.15rem;margin:.35rem 0}.guide-card p{color:var(--muted);margin:0}.related{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.related a{min-height:44px;padding:12px;border:1px solid var(--line);border-radius:12px;text-decoration:none;font-weight:750}.empty{display:none;margin-top:20px;color:var(--muted)}.ad-slot{width:100%;min-height:112px;margin:24px 0;padding:18px;border:1px solid var(--line);border-radius:18px;background:#fff;color:var(--muted);display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;overflow:hidden}.ad-slot[data-ad-format-kind="multiplex"]{min-height:220px}.ad-slot[data-ad-format-kind="in-article"]{min-height:180px}.ad-slot__label{font-size:.78rem;font-weight:800;letter-spacing:.06em;color:var(--green)}.ad-slot p{margin:6px 0 0;max-width:52ch}.footer-links{display:flex;flex-wrap:wrap;gap:14px;margin-top:10px}.footer-links a{min-width:44px;min-height:44px;display:inline-flex;align-items:center}footer{border-top:1px solid var(--line);background:#fff;padding:28px 0;color:var(--muted);font-size:.9rem}@media(max-width:640px){.wrap{width:min(100% - 24px,920px)}main{padding-top:28px}.fields,.grid,.related{grid-template-columns:1fr}.card{padding:18px}.top .wrap{min-height:58px}.hero h1{font-size:2rem}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}`;

const jsonLd = (value) => JSON.stringify(value).replaceAll('<', '\\u003c');

function shell({ title, description, canonical, body, script = '', rootPrefix = '../../', lang = 'ko', ogType = 'article', alternates = [], structuredData = [] }) {
  const isEnglish = lang === 'en';
  const alternateLinks = alternates.map((item) => `<link rel="alternate" hreflang="${escapeHtml(item.lang)}" href="${escapeHtml(item.href)}">`).join('');
  const structuredScripts = structuredData.map((item) => `<script type="application/ld+json">${jsonLd(item)}</script>`).join('');
  const footerCopy = isEnglish
    ? `All-Young Scanner is an independent information service, not an official retailer service. Follow each product label and stop if discomfort persists.<div class="footer-links"><a href="${rootPrefix}privacy.html">Privacy</a><a href="${rootPrefix}advertising.html">Advertising</a><a href="${rootPrefix}support.html">Help</a><a href="${rootPrefix}">한국어</a></div>`
    : `올영스캐너는 제품 선택을 돕는 독립 정보 서비스이며 의료 진단이나 치료를 제공하지 않습니다. 제품 표시사항과 피부 반응을 우선해 주세요.<div class="footer-links"><a href="${rootPrefix}privacy.html">개인정보</a><a href="${rootPrefix}advertising.html">광고 원칙</a><a href="${rootPrefix}privacy-choices.html">광고 선택</a><a href="${rootPrefix}support.html">도움</a></div>`;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="referrer" content="strict-origin-when-cross-origin"><meta name="robots" content="index,follow,max-image-preview:large"><title>${escapeHtml(title)} | All-Young Scanner</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${canonical}">${alternateLinks}<meta property="og:type" content="${ogType}"><meta property="og:title" content="${escapeHtml(title)} | All-Young Scanner"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${canonical}"><meta name="theme-color" content="#ef4f86">${structuredScripts}<style>${pageStyle}</style></head><body><a class="skip" href="#main">${isEnglish ? 'Skip to content' : '본문으로 바로가기'}</a><header class="top"><div class="wrap"><a class="brand" href="${rootPrefix}">All-Young Scanner</a><a class="home-link" href="${isEnglish ? rootPrefix + 'en/' : rootPrefix + 'guides/'}">${isEnglish ? 'English guides' : '사용 가이드'}</a></div></header>${body}<footer><div class="wrap">${footerCopy}</div></footer>${script}<script type="module" src="${rootPrefix}assets/ad-loader.mjs"></script></body></html>`;
}

const guidesDir = path.join(root, 'guides');
const contentDir = path.join(root, 'content');
await mkdir(guidesDir, { recursive: true });
await mkdir(contentDir, { recursive: true });

for (const card of usage.cards) {
  const sources = card.source_refs.map((id) => sourceById.get(id));
  const canonical = `${baseUrl}guides/${card.slug}/`;
  const related = usage.cards.filter((candidate) => candidate.slug !== card.slug).sort((a, b) => {
    const score = (candidate) => Number(candidate.category === card.category) * 2 + Number(candidate.source_refs.some((id) => card.source_refs.includes(id)));
    return score(b) - score(a);
  }).slice(0, 3);
  const body = `<main id="main"><div class="wrap"><div class="hero"><div class="eyebrow">${escapeHtml(typeLabels[card.content_type] || categoryLabels[card.category] || '사용 가이드')}</div><h1>${escapeHtml(card.title)}</h1><p class="lead">${escapeHtml(card.summary)}</p><div class="meta"><span class="chip">출처 ${sources.length}개 연결</span><span class="chip">최근 검토 ${reviewedAt}</span><span class="chip">다음 검토 ${reviewDueAt}</span></div></div><div class="notice"><strong>제품 표시사항을 먼저 확인해 주세요</strong><span>이 안내는 일반 정보이며 개별 제품의 사용법을 대신하지 않습니다. 따가움·붉음·붓기처럼 불편한 신호가 지속되면 사용을 멈추고 전문가 안내를 확인하세요.</span></div><article class="card"><p class="lead">${escapeHtml(card.body.one_line)}</p><dl class="fields"><div><dt>루틴 위치</dt><dd>${escapeHtml(card.body.routine_position)}</dd></div><div><dt>표시사항 우선</dt><dd>${escapeHtml(card.body.label_priority)}</dd></div><div><dt>함께 쓰기</dt><dd>${escapeHtml(card.body.combine_note)}</dd></div><div><dt>불편 신호</dt><dd>${escapeHtml(card.body.safety_note)}</dd></div></dl></article><section class="card"><h2>따라 하기</h2><ol>${card.steps.map((step) => `<li>${escapeHtml(step.instruction)}${step.amount_copy ? `<small class="review">사용량·빈도: ${escapeHtml(step.amount_copy)}</small>` : ''}${step.stop_signal ? `<span class="stop">중단 기준: ${escapeHtml(step.stop_signal)}</span>` : ''}</li>`).join('')}</ol></section><aside class="ad-slot" data-ad-slot="guide-detail-context" data-ad-format-kind="in-article" data-page-kind="guide-detail" aria-label="광고 또는 서비스 안내"></aside><section class="card"><h2>근거와 확인일</h2><ul class="sources">${sources.map((source) => `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)}</a><small>${escapeHtml(source.source_type)} · ${escapeHtml(source.observed_at)} 확인</small></li>`).join('')}</ul><p class="review">작성 방식: 공개 전문자료를 바탕으로 쉬운 말로 편집 · 검토 기준: 출처 연결, 표시사항 우선, 의료적 단정 금지 · 최근 검토: ${reviewedAt} · 다음 검토: ${reviewDueAt}</p></section><section class="card" aria-labelledby="related-title"><h2 id="related-title">함께 읽기</h2><div class="related">${related.map((item) => `<a href="../${escapeHtml(item.slug)}/">${escapeHtml(item.title)}</a>`).join('')}</div></section><div class="actions"><a class="button" href="../../#guides">앱에서 전체 사용법 보기</a><a class="button secondary" href="../">다른 가이드 찾기</a><a class="button secondary" href="../../en/">English summaries</a></div></div></main>`;
  const structuredData = [
    { '@context': 'https://schema.org', '@type': 'Article', headline: card.title, description: card.summary, inLanguage: 'ko-KR', dateModified: reviewedAt, mainEntityOfPage: canonical, publisher: { '@type': 'Organization', name: '올영스캐너', url: baseUrl } },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: '올영스캐너', item: baseUrl },
      { '@type': 'ListItem', position: 2, name: '사용 가이드', item: `${baseUrl}guides/` },
      { '@type': 'ListItem', position: 3, name: card.title, item: canonical },
    ] },
  ];
  const directory = path.join(guidesDir, card.slug);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'index.html'), shell({ title: card.title, description: card.summary, canonical, body, alternates: [{ lang: 'ko-KR', href: canonical }, { lang: 'x-default', href: canonical }], structuredData }), 'utf8');
}

const cardsHtml = usage.cards.map((card) => `<a class="guide-card" href="./${escapeHtml(card.slug)}/" data-search="${escapeHtml(`${card.title} ${card.summary} ${categoryLabels[card.category] || card.category}`.toLowerCase())}"><span class="eyebrow">${escapeHtml(categoryLabels[card.category] || typeLabels[card.content_type] || '사용 가이드')}</span><h2>${escapeHtml(card.title)}</h2><p>${escapeHtml(card.summary)}</p></a>`).join('');
const indexBody = `<main id="main"><div class="wrap"><div class="hero"><div class="eyebrow">K-뷰티 사용 가이드 24</div><h1>헷갈리지 않게, 하나씩 따라 해요</h1><p class="lead">기본 루틴부터 제품 조합과 불편 신호까지, 출처와 확인일을 갖춘 24개 안내를 모았습니다.</p><p><a href="../en/" hreflang="en">Read English summaries</a></p></div><label for="guide-search" class="eyebrow">가이드 검색</label><input id="guide-search" class="search" type="search" inputmode="search" autocomplete="off" placeholder="예: 선크림, 세안, 보습"><p id="guide-empty" class="empty" role="status">검색어와 맞는 가이드가 없습니다.</p><aside class="ad-slot" data-ad-slot="guide-index-context" data-ad-format-kind="multiplex" data-page-kind="guide-index" aria-label="광고 또는 서비스 안내"></aside><div id="guide-grid" class="grid">${cardsHtml}</div><div class="notice" style="margin-top:24px"><strong>안전한 정보 이용</strong><span>제품별 사용량과 순서는 표시사항이 우선입니다. 이 가이드는 의료 진단이나 치료를 대신하지 않습니다.</span></div></div></main>`;
const indexScript = `<script>const input=document.querySelector('#guide-search');const cards=[...document.querySelectorAll('[data-search]')];const empty=document.querySelector('#guide-empty');input.addEventListener('input',()=>{const q=input.value.trim().toLowerCase();let shown=0;for(const card of cards){const visible=!q||card.dataset.search.includes(q);card.hidden=!visible;if(visible)shown+=1}empty.style.display=shown?'none':'block'});</script>`;
const guideIndexStructuredData = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'K-뷰티 사용 가이드 24', description: '출처와 확인일을 갖춘 K-뷰티 사용 가이드', inLanguage: 'ko-KR', url: `${baseUrl}guides/`, mainEntity: { '@type': 'ItemList', numberOfItems: 24, itemListElement: usage.cards.map((card, index) => ({ '@type': 'ListItem', position: index + 1, name: card.title, url: `${baseUrl}guides/${card.slug}/` })) } };
await writeFile(path.join(guidesDir, 'index.html'), shell({ title: 'K-뷰티 사용 가이드 24', description: '출처와 확인일을 갖춘 올영스캐너 K-뷰티 사용 가이드 24개', canonical: `${baseUrl}guides/`, body: indexBody, script: indexScript, rootPrefix: '../', ogType: 'website', alternates: [{ lang: 'ko-KR', href: `${baseUrl}guides/` }, { lang: 'en', href: `${baseUrl}en/` }, { lang: 'x-default', href: `${baseUrl}guides/` }], structuredData: [guideIndexStructuredData] }), 'utf8');

const englishCards = englishContent.guides.map((guide) => `<a class="guide-card" href="../guides/${escapeHtml(guide.slug)}/" hreflang="ko" lang="en"><span class="eyebrow">Source-linked Korean guide</span><h2>${escapeHtml(guide.title)}</h2><p>${escapeHtml(guide.summary)}</p></a>`).join('');
const englishBody = `<main id="main"><div class="wrap"><div class="hero"><div class="eyebrow">Independent K-beauty guidance</div><h1>Build a simpler routine, one reason at a time</h1><p class="lead">Explore 24 plain-language summaries about order, texture, weather, cleansing, moisture, sun protection, and discomfort signals. No account is required, and routine records stay on your device.</p><div class="actions"><a class="button" href="../#routine" hreflang="ko">Open the routine builder</a><a class="button secondary" href="../guides/" hreflang="ko">한국어 가이드</a></div></div><div class="notice"><strong>Independent and not affiliated with a retailer</strong><span>All-Young Scanner is an independent information service. It is not operated, sponsored, or endorsed by Olive Young or another retailer. Product labels and professional advice take priority.</span></div><section class="card"><h2>How to use this page</h2><p>Start with a summary that matches your situation, then open the source-linked Korean editorial guide. English summaries are an AI-assisted navigation draft awaiting human language review; they are not presented as a completed translation.</p></section><aside class="ad-slot" data-ad-slot="guide-index-context" data-ad-format-kind="multiplex" data-page-kind="guide-index" aria-label="Advertisement or service notice"></aside><section aria-labelledby="english-guides"><h2 id="english-guides">24 guide summaries</h2><div class="grid">${englishCards}</div></section><section class="card"><h2>Common questions</h2><h3>Does this service recommend a specific product?</h3><p>No. The current free edition explains routine structure and safe use boundaries rather than ranking products.</p><h3>Where is my routine saved?</h3><p>Routine and check-in records stay in this browser unless you export a backup yourself.</p><h3>Is this medical advice?</h3><p>No. Stop when discomfort persists and seek appropriate professional help for serious or continuing symptoms.</p></section></div></main>`;
const englishStructuredData = [
  { '@context': 'https://schema.org', '@type': 'WebPage', name: 'Independent K-beauty routine guides', description: 'Twenty-four K-beauty routine summaries with clear independence and safety boundaries.', inLanguage: 'en', url: `${baseUrl}en/`, isPartOf: { '@type': 'WebSite', name: 'All-Young Scanner', url: baseUrl } },
  { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [
    { '@type': 'Question', name: 'Does this service recommend a specific product?', acceptedAnswer: { '@type': 'Answer', text: 'No. The current free edition explains routine structure and safe use boundaries rather than ranking products.' } },
    { '@type': 'Question', name: 'Where is my routine saved?', acceptedAnswer: { '@type': 'Answer', text: 'Routine and check-in records stay in this browser unless the user exports a backup.' } },
    { '@type': 'Question', name: 'Is this medical advice?', acceptedAnswer: { '@type': 'Answer', text: 'No. Stop when discomfort persists and seek appropriate professional help for serious or continuing symptoms.' } },
  ] },
];
const englishDir = path.join(root, 'en');
await mkdir(englishDir, { recursive: true });
await writeFile(path.join(englishDir, 'index.html'), shell({ title: 'Independent K-beauty routine guides', description: 'Twenty-four plain-language K-beauty routine summaries with source links and clear safety boundaries.', canonical: `${baseUrl}en/`, body: englishBody, rootPrefix: '../', lang: 'en', ogType: 'website', alternates: [{ lang: 'en', href: `${baseUrl}en/` }, { lang: 'ko-KR', href: `${baseUrl}guides/` }, { lang: 'x-default', href: `${baseUrl}guides/` }], structuredData: englishStructuredData }), 'utf8');

const publicContent = {
  schema_version: 1,
  updated_at: reviewedAt,
  review_due_at: reviewDueAt,
  editorial_contract: {
    method: '공개 전문자료를 바탕으로 쉬운 말로 편집',
    review_rules: ['출처 연결', '제품 표시사항 우선', '의료적 단정 금지', '불편 신호와 중단 기준 표시'],
    disclaimer: '일반 정보이며 의료 진단이나 치료를 대신하지 않습니다.',
  },
  counts: { guides: usage.cards.length, sources: usage.sources.length },
  sources: usage.sources,
  guides: usage.cards,
};
await writeFile(path.join(contentDir, 'usage-guides.json'), `${JSON.stringify(publicContent, null, 2)}\n`, 'utf8');

const sitemapUrls = [
  baseUrl,
  `${baseUrl}guides/`,
  `${baseUrl}en/`,
  `${baseUrl}privacy.html`,
  `${baseUrl}terms.html`,
  `${baseUrl}support.html`,
  `${baseUrl}about.html`,
  `${baseUrl}cookies.html`,
  `${baseUrl}advertising.html`,
  `${baseUrl}privacy-choices.html`,
  `${baseUrl}catalog-license.html`,
  ...usage.cards.map((card) => `${baseUrl}guides/${card.slug}/`),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls.map((url) => `  <url><loc>${url}</loc><lastmod>${reviewedAt}</lastmod></url>`).join('\n')}\n</urlset>\n`;
await writeFile(path.join(root, 'sitemap.xml'), sitemap, 'utf8');

console.log(`사용 가이드 ${usage.cards.length}개, 출처 ${usage.sources.length}개, 사이트맵 ${sitemapUrls.length}개 URL 생성 완료`);
