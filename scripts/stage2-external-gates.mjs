const gateDefinitions = Object.freeze([
  ['operator_identity','운영자 신원·비공개 문의'], ['human_editorial','한국어·영어 사람 편집'], ['catalog_review','상품·성분 사람 대조'], ['country_contracts','국가·판매처 계약'], ['real_devices','Android·iOS 실제 기기'], ['real_users','실사용자 과업'], ['review_rights','실제 후기 권리·조작 검수'], ['cohort_privacy','익명 집단 20명 이상 동의'], ['advertising_approval','광고 계정·동의 신호'], ['security_review','외부 보안·복구 훈련'],
]);

export function evaluateStage2ExternalGates(input = {}) {
  const cards = gateDefinitions.map(([id, label]) => ({ id, label, complete: input[id] === true, evidence_url: typeof input[`${id}_evidence_url`] === 'string' ? input[`${id}_evidence_url`] : null }));
  const invalidEvidence = cards.filter((card) => card.complete && (!card.evidence_url || !/^https:\/\//.test(card.evidence_url))).map((card) => card.id);
  const done = cards.filter((card) => card.complete && !invalidEvidence.includes(card.id)).length;
  return { total: cards.length, done, percent: Number((done / cards.length * 100).toFixed(1)), ready: done === cards.length, invalid_evidence: invalidEvidence, cards };
}

export function rejectSecretMaterial(value) {
  const text = JSON.stringify(value ?? {});
  if (/(client_secret|private_key|access_token|refresh_token|password)\s*[\"']?\s*[:=]/i.test(text)) throw new Error('SECRET_MATERIAL_FORBIDDEN');
  return true;
}
