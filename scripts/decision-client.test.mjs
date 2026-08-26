import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionClient, DecisionClientError, QUESTION_ORDER } from '../assets/decision-client.mjs';

const uuid = '11111111-1111-4111-8111-111111111111';
const answers = { concern:'dryness', skin_type:'dry', avoid_ingredients:[], budget:20_000, texture:['cream'] };

function response(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type':'application/json', ...headers } });
}

test('v2 다섯 답변과 후보 요청을 서버 계약 순서로 보낸다', async () => {
  const calls = [];
  const queue = [response({ decision_id:uuid, expires_at:'2026-08-26T12:00:00.000Z' }),
    ...QUESTION_ORDER.map(() => response({ ok:true })), response({ status:'insufficient_candidates', candidates:[] })];
  const client = createDecisionClient({ baseUrl:'https://api.example.test', fetchImpl:async (url,options) => { calls.push({url,options}); return queue.shift(); } });
  const result = await client.start({ answers, client_session_id:'web_123456789012' });
  assert.equal(result.decision_id,uuid);
  assert.equal(calls.length,7);
  assert.equal(calls[0].url,'https://api.example.test/decision/start');
  assert.deepEqual(JSON.parse(calls[0].options.body),{client_session_id:'web_123456789012'});
  assert.deepEqual(calls.slice(1,6).map((call)=>JSON.parse(call.options.body).question_id),QUESTION_ORDER);
  assert.equal(calls[6].url,`https://api.example.test/decision/${uuid}/candidates`);
  assert.ok(calls.every((call)=>call.options.credentials==='omit' && call.options.cache==='no-store'));
});

test('비교와 완료는 최대 세 상품·중복 안전 식별값 계약을 따른다', async () => {
  const calls=[];
  const client=createDecisionClient({baseUrl:'https://api.example.test/',fetchImpl:async(url,options)=>{calls.push({url,options});return response(url.includes('/compare')?{rows:[]}:{ok:true,already_completed:false});}});
  await client.compare([uuid]);
  await client.complete(uuid,{client_op_id:'op_12345678'});
  assert.equal(calls[0].url,`https://api.example.test/compare?product_ids=${uuid}`);
  assert.deepEqual(JSON.parse(calls[1].options.body),{decision_id:uuid,client_op_id:'op_12345678'});
  await assert.rejects(()=>client.compare([]),(error)=>error.code==='invalid_product_count');
  await assert.rejects(()=>client.compare([uuid,uuid,uuid,uuid]),(error)=>error.code==='invalid_product_count');
});

test('서버 실패를 합성 후보로 바꾸지 않고 안전한 오류 코드만 돌려준다', async () => {
  const client=createDecisionClient({baseUrl:'https://api.example.test',fetchImpl:async()=>response({error:'temporarily_unavailable',detail:'PRIVATE'},503)});
  await assert.rejects(()=>client.start({answers,client_session_id:'web_123456789012'}),(error)=>error instanceof DecisionClientError && error.code==='temporarily_unavailable' && !error.message.includes('PRIVATE'));
});

test('불완전 답변, 비HTTPS, 과대·깨진 응답을 거부한다', async () => {
  assert.throws(()=>createDecisionClient({baseUrl:'http://api.example.test'}),(error)=>error.code==='secure_api_required');
  const client=createDecisionClient({baseUrl:'https://api.example.test',fetchImpl:async()=>response({ok:true})});
  await assert.rejects(()=>client.start({answers:{concern:'dryness'}}),(error)=>error.code==='answers_incomplete');
  const large=createDecisionClient({baseUrl:'https://api.example.test',fetchImpl:async()=>new Response('{}',{headers:{'content-length':String(300*1024)}})});
  await assert.rejects(()=>large.start({answers,client_session_id:'web_123456789012'}),(error)=>error.code==='response_too_large');
  const broken=createDecisionClient({baseUrl:'https://api.example.test',fetchImpl:async()=>new Response('{',{status:200})});
  await assert.rejects(()=>broken.start({answers,client_session_id:'web_123456789012'}),(error)=>error.code==='invalid_response');
});
