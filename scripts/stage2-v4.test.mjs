import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { normalizeObservation, analyzeObservations, compareIngredientLabels, createDecisionCard, encryptTransfer, decryptTransfer, previewTransferConflict, applyTransfer, moderateReview, buildAnonymousAggregate, countryAvailability } from '../assets/stage2-v4.mjs';

globalThis.crypto ??= webcrypto;
globalThis.btoa ??= (value) => Buffer.from(value, 'binary').toString('base64');
globalThis.atob ??= (value) => Buffer.from(value, 'base64').toString('binary');

const now = new Date('2026-08-31T12:00:00Z');
const observation = { id:'o1', date:'2026-08-31', sleep:'7h-plus', cycle:'not-recorded', environment:'humid', comfort:4, discomfort:['dryness'], product_id:'p1', formulation_id:'f1' };

test('관찰값은 제한된 필드와 사진 비저장 계약으로 정규화한다', () => { const row=normalizeObservation({...observation,photo:{name:'face.jpg',type:'image/jpeg'}},now); assert.equal(row.photo.stored,false); assert.equal(row.comfort,4); });
test('미래 날짜와 허용하지 않은 민감 값은 거절한다', () => { assert.throws(()=>normalizeObservation({...observation,date:'2026-09-01'},now)); assert.throws(()=>normalizeObservation({...observation,sleep:'secret'},now)); });
test('90일 분석은 원인 판정과 네트워크 요청을 하지 않는다', () => { const result=analyzeObservations([normalizeObservation(observation,now)],{now}); assert.equal(result.causal_claim_allowed,false); assert.equal(result.network_requests,0); });
test('성분 비교는 표시 이름 겹침만 반환한다', () => { const result=compareIngredientLabels(['Water','Glycerin'],['water','Niacinamide']); assert.deepEqual(result.overlap,['water']); assert.equal(result.interaction_claim_allowed,false); });
test('결정 카드는 처방 판 식별자를 보존한다', () => { const card=createDecisionCard({product:{id:'p1',source_url:'https://example.test',formulation_versions:[{id:'f1'}]},observationSummary:{observations:3}}); assert.equal(card.formulation_id,'f1'); assert.equal(card.recommendation_score,null); });
test('기기 이동 묶음은 PBKDF2 210000회와 AES-GCM으로 왕복한다', async()=>{ const bundle=await encryptTransfer({observations:[observation]},'password-123',webcrypto); assert.equal(bundle.iterations,210000); assert.deepEqual(await decryptTransfer(bundle,'password-123',webcrypto),{observations:[observation]}); });
test('이관은 충돌 미리보기와 명시 확인·롤백을 요구한다',()=>{ const current={observations:[observation]}; const incoming={observations:[{...observation,comfort:2}]}; assert.equal(previewTransferConflict(current,incoming).duplicate_ids[0],'o1'); assert.throws(()=>applyTransfer(current,incoming)); assert.equal(applyTransfer(current,incoming,{confirmed:true}).rollback.observations[0].comfort,4); });
test('중복·홍보·보상 후기는 공개하지 않고 격리한다',()=>{ const first=moderateReview({body:'한 달간 아침과 저녁에 사용했고 세안 뒤 사용감과 당김 정도를 날짜별로 꾸준히 기록했습니다.',compensated:false}); assert.equal(first.status,'pending_human_review'); assert.equal(moderateReview({body:'할인 코드로 구매하면 완치됩니다. 충분히 긴 홍보성 후기입니다.',compensated:true},new Set([first.fingerprint])).status,'quarantined'); });
test('익명 집계는 명시 동의와 20명 이상을 강제하고 원자료를 제외한다',()=>{ assert.throws(()=>buildAnonymousAggregate([observation],{consent:false,participantCount:20})); assert.throws(()=>buildAnonymousAggregate([observation],{consent:true,participantCount:19})); const out=buildAnonymousAggregate([observation],{consent:true,participantCount:20}); assert.equal(out.raw_records_included,false); assert.equal(out.identifiers_included,false); });
test('한국·미국 정보 제공은 구매 기능과 분리한다',()=>{ assert.equal(countryAvailability.KR.information,true); assert.equal(countryAvailability.US.information,true); assert.equal(countryAvailability.KR.purchasing,false); assert.equal(countryAvailability.US.seller_count,0); });
