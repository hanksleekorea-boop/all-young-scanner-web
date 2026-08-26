// Generated dashboard: readiness.json is the only source of current counts.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const read=(path)=>readFileSync(resolve(root,path),'utf8');
const status=JSON.parse(read('readiness.json'));
const esc=(s)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const qr=read('index.html').match(/const PUBLIC_QR_DATA = '([^']+)'/)[1];
const next=['실제 DB 통합 검사','실상품 사용 권한','승인 판매처 2곳','상품 500개 품질 검사','가격 신선도 연결','진단·후보 화면 연결','실제 바코드 50개','A56 복원 왕복','iOS 시험','제휴 URL 허용 검사','리뷰 비공개 구조','키보드 핵심 과업','화면 읽기 도구','성능 재측정','운영자 신원','비공개 문의 채널','정정·삭제 절차','장애 훈련','1,000명 전체 과업 사례','실사용자 5명'];
const autonomous=['자료 계약 경계 검사','서버 입력 검사','동시 완료 방지','가격 만료 처리','후보 부족 복구','검색 오타 처리','JSON 변형 사례','동시 탭 저장 충돌','암호화 백업 오류','오프라인 파일 목록','서비스 워커 범위','기록 삭제 재읽기','브라우저 새로고침','좁은 화면 재검사','키보드 포커스','개발 문구 노출 검사','공개 링크 검사','진척 수치 대조','자동 검사 문서','운영 훈련 양식'];
const list=(items)=>items.map(x=>`<li>${esc(x)}</li>`).join('');
const body=`<main class="progress-page">
<section class="progress-hero"><p class="eyebrow">PRODUCT PLAN v2 · ${esc(status.updated_at)}</p><h1>개발 진척 대시보드</h1><p>사용자 서비스와 분리된 운영 화면입니다. 구현·자동 검사·브라우저·실기기·운영 증거를 구분합니다.</p><div class="status-line"><strong>부분 완료</strong><span>${esc(status.release_id)}</span></div></section>
<section class="progress-overview"><article class="progress-card"><p>v2 1단계 작업 완료율</p><strong>${status.stage_one.percent}%</strong><span>${status.stage_one.passed} / ${status.stage_one.total} DONE</span><div class="progress-meter" role="progressbar" aria-label="1단계 작업 완료율" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${status.stage_one.percent}"><i style="width:${status.stage_one.percent}%"></i></div><small>→ 이 그림의 뜻: 5/17에서 6/17로 증가했습니다. 상용화 점수가 아니라 완료 작업 수입니다.</small></article><article class="progress-card"><p>모바일·PC</p><strong>부분 완료</strong><span>기록 관리 브라우저 확인</span><small>360·390·1440px 확인. v0.15 실기기·성능 재측정은 미실시입니다.</small></article><article class="progress-card"><p>상용화</p><strong>외부 조건 대기</strong><span>실상품 0 / 500 · 실사용자 0 / 5</span><small>판매 자료 권리·운영자 신원·비공개 지원·실기기 증거 없이 99%를 선언하지 않습니다.</small></article></section>
<section class="progress-grid"><article class="detail-card"><h2>완료 작업</h2><ul>${list(status.stage_one.done)}</ul><p>P1-10: 원본 보존·자료 판번호·저장 실패 보호. P1-11은 실기기 왕복 시험을 기다리는 검증 중 상태입니다.</p></article><article class="detail-card"><h2>이번 검사</h2><ul><li>저장·백업 자동 검사 16건</li><li>합성 기록 왕복 1,000사례</li><li>브라우저 가져오기·중복·취소·오류·새로고침</li><li>현재 상품 불가 표시와 HTML 문자열 안전 처리</li></ul><p>1,000사례는 데이터 이동 자동 검사이며 실제 사용자나 전체 서비스 페르소나 시험이 아닙니다.</p></article><article class="detail-card"><h2>남은 병목</h2><ul><li>GitHub 검사 결제·사용 한도</li><li>실제 데이터베이스 시험 환경</li><li>실상품·판매처 권리와 운영 정보</li><li>지정 A56 미연결 · 다른 기기는 미조작</li><li>Android·iOS 최신판 시험 미실시</li></ul></article></section>
<section class="detail-card"><h2>증거 판 구분</h2><p><a href="evidence-v015.json">현재 v0.15 검사</a> · <a href="evidence-v013.json">이전 v0.13 역사 기록</a> · <a href="readiness.json">현재 진척 원본</a></p><p>이전 성능 점수와 기기 시험 기록을 현재판 검증으로 재사용하지 않습니다.</p></section>
<section class="detail-card progress-qr-card"><h2>공개 서비스</h2><img src="${qr}" alt="올영스캐너 공개 서비스 QR 코드"><a href="https://hanksleekorea-boop.github.io/all-young-scanner-web/">PC·모바일/PWA 열기</a><small>QR은 개인 기록이 없는 공개 첫 화면만 엽니다.</small></section>
<section class="priority-card"><h2>다음 실행 우선순위 20</h2><ol>${list(next)}</ol><details><summary>사용자 없이 실행 가능한 우선순위 20</summary><ol>${list(autonomous)}</ol></details></section></main>`;
const html=read('progress.html').replace(/<main\b[\s\S]*?<\/main>/,body);
writeFileSync(resolve(root,'progress.html'),html);
console.log('[progress] generated from readiness.json');
