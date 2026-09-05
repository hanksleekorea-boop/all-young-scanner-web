export const RELEASE = '2026-09-05-service-v0.39-shopping-repair';
export const STORAGE_KEY = 'ays-shopping-v2';
export const CATEGORIES = {
  sunscreen: ['선케어', 'Sun care', '선크림 자외선차단제 썬크림 sunscreen suncream spf'],
  cleanser: ['클렌징', 'Cleansers', '세안 세안제 클렌저 클렌징폼 cleanser cleansing facewash'],
  barrier_moisture_cream: ['보습 크림', 'Moisturisers', '크림 보습 로션 moisturizer moisturiser cream lotion'],
  soothing_serum_ampoule: ['세럼·앰플', 'Serums & ampoules', '세럼 앰플 에센스 serum ampoule essence'],
  toner_pad: ['토너·패드', 'Toners & pads', '토너 패드 스킨 toner pad'],
};
export const BRAND_ALIASES = {
  cosrx: ['코스알엑스'], cerave: ['세라비'], 'la roche posay': ['라로슈포제'],
  bioderma: ['바이오더마'], avene: ['아벤느'], eucerin: ['유세린'], neutrogena: ['뉴트로지나'],
  nivea: ['니베아'], cetaphil: ['세타필'], innisfree: ['이니스프리'], laneige: ['라네즈'],
  'beauty of joseon': ['조선미녀'], 'round lab': ['라운드랩'], skin1004: ['스킨천사','스킨1004'],
  missha: ['미샤'], belif: ['빌리프'], skinfood: ['스킨푸드'], abib: ['아비브'],
  'isntree': ['이즈앤트리'], atomy: ['애터미'], 'dr jart': ['닥터자르트'],
  'dr g': ['닥터지'], 'etude': ['에뛰드'], purito: ['퓨리토'], 'some by mi': ['썸바이미'],
  'banila co': ['바닐라코'], 'the ordinary': ['디오디너리'], hada: ['하다라보'],
};
export const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase().replace(/['’.-]/g, ' ').replace(/\s+/g, ' ').trim();
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function isHousehold(product) {
  return /\b(dish\s*(soap|wash|washing)|dishwasher|dishwashing|laundry|lessive|fabric softener|toilet bowl|floor cleaner|washing.?up|waschmittel|geschirr|sp[uü]lmittel)\b/i.test(product.name || '');
}
export function productTokens(p) {
  const brand = normalize(p.brand);
  const aliases = Object.entries(BRAND_ALIASES).filter(([k]) => brand.includes(k)).flatMap(([,v]) => v);
  return normalize([p.name, p.brand, p.gtin, ...aliases, ...(CATEGORIES[p.category_scope] || [])].join(' '));
}
export function prepareCatalog(catalog) {
  const quarantine = [], seen = new Set(), duplicates = new Map();
  const products = catalog.products.filter(p => {
    const reason = !p.id || seen.has(p.id) ? 'duplicate_or_missing_id' : isHousehold(p) ? 'household_use' : null;
    seen.add(p.id);
    if (reason) quarantine.push({id:p.id, name:p.name, reason});
    return !reason;
  }).map(p => {
    const brand = !p.brand || /^null$/i.test(p.brand.trim()) ? '' : p.brand.trim();
    const row = {
      id:p.id, gtin:p.gtin, name:p.name, brand, quantity:p.quantity || null,
      category_scope:p.category_scope, k_beauty_relevance:p.k_beauty_relevance,
      source_url:p.source_url, source_updated_at:p.source_updated_at,
      source_retrieved_on:p.source_retrieved_on, editorial_status:p.editorial_status,
      image_url:null, price:null, sellers:[],
    };
    row.search = productTokens(row);
    const signature = normalize(`${brand} ${p.name}`);
    duplicates.set(signature, [...(duplicates.get(signature) || []), p.id]);
    return row;
  });
  return { schema_version:2, release_id:RELEASE, generated_on:catalog.generated_on,
    source:catalog.source, products, quarantine,
    quality: { source_count:catalog.products.length, published_count:products.length,
      quarantined_count:quarantine.length, missing_quantity:products.filter(p=>!p.quantity).length,
      missing_brand:products.filter(p=>!p.brand).length,
      duplicate_candidates:[...duplicates.values()].filter(ids=>ids.length>1), human_reviewed:0 },
    category_labels:Object.fromEntries(Object.entries(CATEGORIES).map(([k,v])=>[k,v[0]])),
  };
}
export function searchProducts(products, state = {}) {
  const query = normalize(state.q).slice(0, 200), terms = query.split(' ').filter(Boolean);
  const rows = products.filter(p => (!state.category || state.category === 'all' || p.category_scope === state.category)
    && (state.scope !== 'kr-only' || ['korean_gtin','korean_brand'].includes(p.k_beauty_relevance))
    && (!state.brand || state.brand === 'all' || p.brand === state.brand)
    && terms.every(t => (p.search || productTokens(p)).includes(t)));
  return rows.sort((a,b) => {
    if (state.sort === 'brand') return a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name);
    if (state.sort === 'updated') return (b.source_updated_at || '').localeCompare(a.source_updated_at || '') || a.id.localeCompare(b.id);
    if (state.scope !== 'global') {
      const rank = p => p.k_beauty_relevance === 'korean_brand' ? 2 : p.k_beauty_relevance === 'korean_gtin' ? 1 : 0;
      const diff = rank(b) - rank(a); if (diff) return diff;
    }
    return a.id.localeCompare(b.id);
  });
}
const validIds = value => Array.isArray(value) && value.length <= 5000 && value.every(v=>typeof v==='string' && /^obf-\d{8,14}$/.test(v));
export function validateState(data) {
  if (!data || data.version !== 2 || !validIds(data.saved) || !validIds(data.compared) || data.compared.length>3) throw new Error('INVALID_BACKUP');
  return {version:2,saved:[...new Set(data.saved)],compared:[...new Set(data.compared)],locale:data.locale==='en'?'en':'ko'};
}
export function readState(storage) {
  try { const raw = storage.getItem(STORAGE_KEY); return {state:raw ? validateState(JSON.parse(raw)) : {version:2,saved:[],compared:[],locale:'ko'},error:null}; }
  catch { return {state:{version:2,saved:[],compared:[],locale:'ko'},error:'STORAGE_UNAVAILABLE_OR_DAMAGED'}; }
}
export function mergeBackups(current,incoming){
 const existing=validateState(current),added=validateState(incoming);
 return {...existing,saved:[...new Set([...existing.saved,...added.saved])],compared:[...new Set([...existing.compared,...added.compared])].slice(0,3)};
}
export function writeState(storage, state) {
  try { const value = JSON.stringify(validateState(state)); storage.setItem(STORAGE_KEY,value); return storage.getItem(STORAGE_KEY)===value; } catch { return false; }
}
export function toggleComparison(ids,id) {
  if(ids.includes(id)) return {ids:ids.filter(v=>v!==id),limited:false};
  if(ids.length===3) return {ids,limited:true};
  return {ids:[...ids,id],limited:false};
}
export function sourceLink(value) {
  try {const u=new URL(value); return u.protocol==='https:' && ['world.openbeautyfacts.org','openbeautyfacts.org'].includes(u.hostname)?u.href:null;} catch{return null;}
}
export function storeLinks(product) {
  const q = product.name.toLowerCase().includes(product.brand.toLowerCase()) ? product.name : `${product.brand} ${product.name}`;
  return [
    {id:'oliveyoung',name:'Olive Young Global · Thailand',url:`https://global.oliveyoung.com/th/search/results?query=${encodeURIComponent(q)}`},
    {id:'yesstyle',name:'YesStyle',url:`https://www.yesstyle.com/en/list.html?q=${encodeURIComponent(q)}&bpt=48`},
    {id:'stylekorean',name:'StyleKorean',url:`https://www.stylekorean.com/search?keyword=${encodeURIComponent(q)}`},
    {id:'amazon',name:'Amazon',url:`https://www.amazon.com/s?k=${encodeURIComponent(q)}`},
    {id:'sephora',name:'Sephora',url:`https://www.sephora.com/search?keyword=${encodeURIComponent(q)}`},
  ];
}
export function validateOffer(offer, now = Date.now()) {
  const hosts={oliveyoung:'global.oliveyoung.com',yesstyle:'www.yesstyle.com',stylekorean:'www.stylekorean.com'};
  try {
    const u=new URL(offer.url);
    return u.protocol==='https:' && u.hostname===hosts[offer.merchant_id] && !u.username && !u.password
      && offer.match_status==='name_and_quantity_observed' && /^obf-\d{8,14}$/.test(offer.product_id)
      && !!offer.quantity && Number.isFinite(Date.parse(offer.checked_at)) && Date.parse(offer.checked_at)<=now
      && Date.parse(offer.expires_at)>now && offer.affiliate_status==='inactive';
  } catch {return false;}
}
