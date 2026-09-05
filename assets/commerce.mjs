// Product facts and commercial offers are deliberately separate evidence levels.
const MERCHANTS = {oliveyoung:'global.oliveyoung.com',yesstyle:'www.yesstyle.com',stylekorean:'www.stylekorean.com',amazon:'www.amazon.com',sephora:'www.sephora.com'};
export function quantityOf(raw) {
  if(typeof raw!=='string'||raw.length>80)return null;
  if(/\d[,.]\d{3}\b/.test(raw))return null; // Ambiguous decimal/thousands notation.
  const value=raw.normalize('NFKC').trim().toLowerCase().replace(/,/g,'.');
  const match=value.match(/^(?:(\d{1,3})\s*[x×]\s*)?(\d+(?:\.\d+)?)\s*(ml|millilitres?|milliliters?|l|litres?|liters?|g|grams?|kg|pcs?|pieces?)\.?$/);
  if(!match)return null;
  const packs=Number(match[1]||1),amount=Number(match[2]),unit=match[3];
  if(!Number.isFinite(amount)||amount<=0||packs<1||packs>100)return null;
  const base=/^(ml|millil|l$|lit)/.test(unit)?'ml':/^(g|kg)/.test(unit)?'g':'piece';
  const factor=/^(l$|lit|kg)/.test(unit)?1000:1;
  const total=amount*factor*packs;
  if(total>1000000)return null;
  return {amount:total,unit:base,packs,per_pack:amount*factor,original:raw};
}
export function unitPrice(price,quantity) {
  const q=typeof quantity==='string'?quantityOf(quantity):quantity;
  if(!q||!['ml','g','piece'].includes(q.unit)||!Number.isFinite(q.amount)||q.amount<=0||!Number.isFinite(price)||price<=0)return null;
  const basis=q.unit==='piece'?1:100;
  return {value:Math.round(price/q.amount*basis*100)/100,basis,unit:q.unit};
}
export function offerDecision(offer,variant,market,now=Date.now()) {
  const reasons=[];
  if(!offer||!variant)return {allowed:false,reasons:['missing_record']};
  let url;try{url=new URL(offer.url);}catch{}
  if(!url||url.protocol!=='https:'||url.hostname!==MERCHANTS[offer.merchant_id]||url.username||url.password||url.port)reasons.push('unsafe_merchant_url');
  if(offer.variant_id!==variant.id||!offer.gtin||offer.gtin!==variant.gtin)reasons.push('variant_mismatch');
  if(offer.market!==market||!['KR','US','TH'].includes(market))reasons.push('market_mismatch');
  if(!/^[A-Z]{3}$/.test(offer.currency||'')||!Number.isFinite(offer.price)||offer.price<=0)reasons.push('price_missing');
  if(offer.currency!==({KR:'KRW',US:'USD',TH:'THB'})[market])reasons.push('currency_mismatch');
  if(offer.stock!=='in_stock')reasons.push('not_in_stock');
  if(!offer.merchant_sku||offer.identity_status!=='gtin_and_option_verified')reasons.push('identity_unverified');
  if(offer.rights_status!=='approved'||!offer.rights_evidence_url)reasons.push('rights_unverified');
  if(!offer.reviewed_by||offer.review_status!=='human_approved')reasons.push('review_unverified');
  const checked=Date.parse(offer.checked_at),expires=Date.parse(offer.expires_at);
  if(!Number.isFinite(checked)||checked>now||!Number.isFinite(expires)||expires<=now||expires<=checked||expires-checked>7*86400000)reasons.push('stale_or_invalid_time');
  const a=quantityOf(offer.quantity),b=quantityOf(variant.quantity);
  if(!a||!b||a.unit!==b.unit||a.amount!==b.amount||a.packs!==b.packs)reasons.push('quantity_mismatch');
  if(offer.affiliate_status!=='inactive')reasons.push('affiliate_not_enabled');
  return {allowed:reasons.length===0,reasons};
}
export function deliveredTotal(offer) {
  // Unknown taxes, duties or shipping must never become a zero-cost claim.
  if(!offer||![offer.price,offer.shipping,offer.tax,offer.duty].every(x=>Number.isFinite(x)&&x>=0))return null;
  return Math.round((offer.price+offer.shipping+offer.tax+offer.duty)*100)/100;
}
export function buildCommerce(products,observedLinks=[]) {
  const variants=products.map(p=>({id:p.id,product_id:p.id,gtin:p.gtin,brand:p.brand,name:p.name,quantity:p.quantity,normalized_quantity:quantityOf(p.quantity),category:p.category_scope,source_url:p.source_url,source_updated_at:p.source_updated_at,review_status:'pending_human_review',rights_status:'source_database_only'}));
  const queue=variants.map(v=>({variant_id:v.id,source_url:v.source_url,priority:(products.find(p=>p.id===v.id)?.k_beauty_relevance==='korean_brand'?100:0)+(v.brand?0:50)+(v.quantity?0:30),issues:[...(!v.brand?['missing_brand']:[]),...(!v.quantity?['missing_quantity']:[]),...(v.quantity&&!v.normalized_quantity?['ambiguous_quantity']:[]),'human_review_required','image_rights_required','verified_offer_required']})).sort((a,b)=>b.priority-a.priority||a.variant_id.localeCompare(b.variant_id));
  return {schema_version:1,products:variants.map(v=>({id:v.product_id,name:v.name,brand:v.brand,variant_ids:[v.id]})),variants,offers:[],observed_links:observedLinks,review_queue:queue,priority_500:queue.slice(0,500).map(q=>q.variant_id),policy:{automatic_product_merging:false,automatic_human_approval:false,observed_link_is_verified_offer:false,affiliate_active:false}};
}
export function correctionDraft({product,type,observation,sourceUrl=''}) {
  const allowed=['product','quantity','category','store_link','other'];
  if(!product||!/^obf-\d{8,14}$/.test(product.id)||!allowed.includes(type))throw Error('INVALID_PRODUCT_OR_TYPE');
  const text=String(observation||'').trim();
  if(text.length<10||text.length>1500)throw Error('OBSERVATION_LENGTH');
  if(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:\+?\d[\s()-]*){10,}|-----BEGIN|gh[pousr]_/.test(text))throw Error('POSSIBLE_PRIVATE_DATA');
  if(sourceUrl){let url;try{url=new URL(sourceUrl);}catch{}if(!url||url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('INVALID_SOURCE_URL');}
  const title=`[${type}] ${product.id}`;
  const body=`Product: ${product.name}\nID: ${product.id}\nType: ${type}\n\nObserved issue:\n${text}\n\nReference: ${sourceUrl||product.source_url||'Not supplied'}\n\nThis is a user observation, not a verified correction. Check and remove private information before submission.`;
  return {version:1,title,body,product_id:product.id,type,status:'local_draft_not_submitted'};
}
