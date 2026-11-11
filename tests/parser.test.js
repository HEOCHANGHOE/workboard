// Unit tests for the built-in quick-capture rules (no browser, no AI).
// Run: node tests/parser.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const store = {};
const sandbox = {
  window: {},
  document: { readyState: 'complete', getElementById: () => null },
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    }
  },
  console
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'smart-capture.js'), 'utf8'), sandbox);
const { parseLine, parseLocally, parseKeywordLines } = sandbox.window.WorkBoardCapture;

// Fixed "today": Wednesday 2026-11-11
const today = new Date(2026, 10, 11, 10, 0, 0);
const ctx = {
  today,
  settings: { defaultChannel: '웍스', defaultDueTime: '18:00' },
  projects: ['VAMS', 'SignalNODE', 'PreOPRisk'],
  keywordMap: parseKeywordLines('PreOPRisk: 수술위험, 위험도\nSignalNODE: 시그널노드, 장비연동')
};
const p = (line) => parseLine(line, ctx);

const cases = [
  [
    '내일 3시까지 VAMS 식약처 보완자료 회신, 메일, 급함',
    {
      name: 'VAMS 식약처 보완자료 회신',
      project: 'VAMS',
      channel: '메일',
      dueDate: '2026-11-12',
      dueTime: '오후 03:00',
      urgency: 3
    }
  ],
  [
    '주간회의 자료 작성',
    { name: '주간회의 자료 작성', project: '', channel: '웍스', dueDate: '', dueTime: '', urgency: 2 }
  ],
  [
    '금요일까지 시그널노드 프로토콜 분석 정리',
    {
      name: '시그널노드 프로토콜 분석 정리',
      project: 'SignalNODE',
      dueDate: '2026-11-13',
      dueTime: '오후 06:00'
    }
  ],
  [
    '다음주 월요일 오전 10시 HLM 미팅 준비',
    { name: 'HLM 미팅 준비', dueDate: '2026-11-16', dueTime: '오전 10:00' }
  ],
  [
    '11/20 수술위험 모델 보고서 초안, 중요',
    { name: '수술위험 모델 보고서 초안', project: 'PreOPRisk', dueDate: '2026-11-20', impact: 3 }
  ],
  ['12월 3일 오후 2시 반 인허가 회의', { name: '인허가 회의', dueDate: '2026-12-03', dueTime: '오후 02:30' }],
  ['오늘 견적서 회신, 전화로 옴', { name: '견적서 회신', channel: '전화', dueDate: '2026-11-11' }],
  ['#VAMS 라벨 문구 검토 3일 뒤', { name: '라벨 문구 검토', project: 'VAMS', dueDate: '2026-11-14' }],
  ['[신규사업] 제안서 목차 잡기, 여유', { name: '제안서 목차 잡기', project: '신규사업', urgency: 1 }],
  ['- 16:30 벤더 콜', { name: '벤더 콜', dueDate: '2026-11-11', dueTime: '오후 04:30' }],
  ['월말까지 품질 문서 개정', { name: '품질 문서 개정', dueDate: '2026-11-30' }],
  ['2026-12-01 감사 대응 자료, 진행중', { name: '감사 대응 자료', dueDate: '2026-12-01', status: '진행중' }],
  ['1월 5일 연간 계획 보고', { name: '연간 계획 보고', dueDate: '2027-01-05' }],
  ['이번주 채용 서류 검토', { name: '채용 서류 검토', dueDate: '2026-11-13' }],
  ['25일까지 세금계산서 발행 요청', { name: '세금계산서 발행 요청', dueDate: '2026-11-25' }],
  ['회의록 3일치 정리', { name: '회의록 3일치 정리', dueDate: '' }]
];

let failed = 0;
cases.forEach(([line, expected]) => {
  const got = p(line) || {};
  const wrong = Object.keys(expected).filter((key) => got[key] !== expected[key]);
  if (wrong.length) failed += 1;
  console.log(`${wrong.length ? 'FAIL' : 'PASS'}  ${line}`);
  wrong.forEach((key) =>
    console.log(`      ${key}: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(got[key])}`)
  );
});

const multi = parseLocally('내일 견적 회신\n\n- 금요일 보고서 제출\n', ctx);
const multiOk = multi.length === 2 && multi.every((a) => a.type === 'create_task');
if (!multiOk) failed += 1;
console.log(`${multiOk ? 'PASS' : 'FAIL'}  여러 줄 입력은 줄마다 한 건 (빈 줄 무시)`);

console.log(`\n${cases.length + 1 - failed}/${cases.length + 1} passed`);
process.exit(failed ? 1 : 0);
