import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateStage2ExternalGates, rejectSecretMaterial } from './stage2-external-gates.mjs';

test('증거 없는 외부 관문은 완료되지 않는다',()=>{ const result=evaluateStage2ExternalGates(); assert.equal(result.done,0); assert.equal(result.ready,false); });
test('완료 표시는 HTTPS 증거를 함께 요구한다',()=>{ const invalid=evaluateStage2ExternalGates({operator_identity:true}); assert.deepEqual(invalid.invalid_evidence,['operator_identity']); const valid=evaluateStage2ExternalGates({operator_identity:true,operator_identity_evidence_url:'https://evidence.example/operator'}); assert.equal(valid.done,1); });
test('외부 증거 파일에 비밀값을 넣지 못하게 한다',()=>{ assert.equal(rejectSecretMaterial({release_id:'v0.36'}),true); assert.throws(()=>rejectSecretMaterial({client_secret:'never-store-this'})); });
