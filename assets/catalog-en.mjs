export function searchEnglishCatalog(products, query = '', category = 'all', limit = 30) {
  const tokens = String(query).normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
  return products.filter((product) => {
    if (category !== 'all' && product.category_scope !== category) return false;
    const text = [product.gtin, product.name, product.brand, product.category_scope, ...(product.countries || [])].join(' ').toLocaleLowerCase('en-US');
    return tokens.every((token) => text.includes(token));
  }).slice(0, Math.max(1, Math.min(Number(limit) || 30, 100)));
}

function node(tag, text, className) { const item=document.createElement(tag); if(text)item.textContent=text; if(className)item.className=className; return item; }

export async function mountEnglishCatalog({ root = document, fetcher = fetch } = {}) {
  const response = await fetcher('../content/catalog-v4.json', { cache:'no-cache' });
  if (!response.ok) throw new Error('CATALOG_LOAD_FAILED');
  const catalog = await response.json(); const products = catalog.products || [];
  const form=root.querySelector('#explorer-form'); const query=root.querySelector('#explorer-query'); const category=root.querySelector('#explorer-category'); const results=root.querySelector('#explorer-results'); const status=root.querySelector('#explorer-status');
  const render=()=>{ const rows=searchEnglishCatalog(products,query.value,category.value); results.replaceChildren(...rows.map((product)=>{ const card=node('article','', 'product-card'); card.append(node('span',product.k_beauty_relevance==='global_beauty_context'?'Global beauty context':'K-beauty relevance signal','eyebrow'),node('h2',product.name),node('p',`${product.brand} · ${product.quantity || 'Quantity not confirmed'} · GTIN ${product.gtin}`),node('p',`${product.ingredient_names.length} label ingredient names · source updated ${product.source_updated_at.slice(0,10)} · human editorial review pending`)); const link=node('a','Open source record','button secondary'); link.href=product.source_url; link.target='_blank'; link.rel='noopener noreferrer'; card.append(link); return card; })); status.textContent=`Showing ${rows.length} of ${Number(catalog.counts.selected_products).toLocaleString('en-US')} product fact records. No ranking, price, or seller claim.`; };
  form.addEventListener('submit',(event)=>{event.preventDefault();render();}); query.addEventListener('input',render); category.addEventListener('change',render); render(); document.documentElement.dataset.englishCatalogReady='true';
  return { catalog };
}

if (typeof document !== 'undefined') mountEnglishCatalog().catch(()=>{ const status=document.querySelector('#explorer-status'); if(status)status.textContent='The product fact catalog could not be loaded. Please try again later.'; });
