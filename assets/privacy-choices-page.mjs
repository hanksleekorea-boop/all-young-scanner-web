import { readPrivacyChoice, savePrivacyChoice } from './consent-gate.mjs';

const form = document.querySelector('#privacy-choice-form');
const status = document.querySelector('#privacy-choice-status');
if (form && status) {
  const current = readPrivacyChoice();
  const selected = form.elements.namedItem('ad-mode');
  for (const radio of selected) radio.checked = radio.value === current.mode;
  status.textContent = current.updated_at ? `현재 선택: ${current.mode === 'off' ? '외부 광고 사용 안 함' : '문맥형 광고 허용'}` : '아직 선택하지 않았습니다. 기본값은 외부 광고 사용 안 함입니다.';
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const mode = new FormData(form).get('ad-mode');
    savePrivacyChoice(mode);
    status.textContent = '설정을 이 기기에 저장했습니다. 외부 광고는 운영자·동의 플랫폼·광고 계정 확인 전까지 계속 꺼져 있습니다.';
  });
}
