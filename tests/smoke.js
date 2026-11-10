// Smoke test: loads the real index.html and scripts in jsdom and exercises core flows.
// Run: node tests/smoke.js   (requires: npm i jsdom)
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const SCRIPTS = ['config.js', 'cloud-sync.js', 'app.js', 'project-notes.js', 'report-format.js', 'project-ops.js'];

function boot(seed = {}) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script\b[^>]*src=[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'https://heochanghoe.github.io/workboard/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.error || e.message));
  window.console.error = (...a) => errors.push(a.map(String).join(' '));
  window.scrollTo = () => {};
  window.alert = () => {};
  window.confirm = () => true;
  window.prompt = () => null;
  Object.entries(seed).forEach(([k, v]) => window.localStorage.setItem(k, JSON.stringify(v)));
  const available = SCRIPTS.filter((f) => fs.existsSync(path.join(root, f)));
  const listed = (fs.readFileSync(path.join(root, 'index.html'), 'utf8').match(/<script src="([a-z-]+\.js)/g) || []).map((s) => s.replace('<script src="', ''));
  const order = listed.length ? listed : available;
  order.forEach((f) => {
    try { window.eval(fs.readFileSync(path.join(root, f), 'utf8').replace(/^\uFEFF/, '') + '\n//# sourceURL=' + f); }
    catch (err) { errors.push(`${f}: ${err.stack || err}`); }
  });
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  window.dispatchEvent(new window.Event('load'));
  return { window, errors, $: (id) => window.document.getElementById(id) };
}

const results = [];
function check(name, cond, detail = '') { results.push({ name, ok: !!cond, detail }); }
const tasksOf = (w) => JSON.parse(w.localStorage.getItem('work_dashboard_tasks_v1') || '[]');
const historyOf = (w) => JSON.parse(w.localStorage.getItem('work_task_history_v1') || '[]');

// 1. Boot with empty storage
{
  const { errors } = boot();
  check('boot: no script errors on empty storage', errors.length === 0, errors.slice(0, 3).join(' | '));
}

// 2. Create a task through the form
{
  const { window, errors, $ } = boot();
  $('taskName').value = '스모크 테스트 업무';
  if ($('taskProject')) $('taskProject').value = '테스트프로젝트';
  $('taskDueDate').value = '2030-01-15';
  $('saveBtn').click();
  const tasks = tasksOf(window);
  check('create: task saved', tasks.length === 1 && tasks[0].name === '스모크 테스트 업무', JSON.stringify(tasks[0] || null));
  check('create: project stored', tasks[0] && tasks[0].project === '테스트프로젝트');
  check('create: table rendered', /스모크 테스트 업무/.test($('taskTableBody').innerHTML));
  check('create: no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const hist = historyOf(window);
  check('history: creation recorded', hist.length === 1 && hist[0].type === 'created' && hist[0].taskName === '스모크 테스트 업무', JSON.stringify(hist));
}

// 3. Seeded data: status change, detail edit, delete
{
  const seedTasks = [
    { id: 't1', name: '식약처 보완자료 회신', channel: '메일', dueDate: '2030-02-01', dueTime: '오후 03:00', status: '미진행', project: 'VAMS', impact: 3, urgency: 3, linkage: 2, createdAt: '2026-11-01T00:00:00.000Z' },
    { id: 't2', name: '주간회의 자료', channel: '회의', dueDate: '', dueTime: '', status: '진행중', project: '', impact: 2, urgency: 2, linkage: 1, createdAt: '2026-11-02T00:00:00.000Z' }
  ];
  const { window, errors, $ } = boot({ work_dashboard_tasks_v1: seedTasks });
  check('seed: both tasks rendered', /식약처 보완자료 회신/.test($('taskTableBody').innerHTML) && /주간회의 자료/.test($('taskTableBody').innerHTML));
  const sel = window.document.querySelector('select[data-action="status-select"][data-id="t1"]');
  sel.value = '진행중';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('status: inline change saved', tasksOf(window).find((t) => t.id === 't1').status === '진행중');
  {
    const h = historyOf(window);
    const c = h[0] && h[0].changes && h[0].changes[0];
    check('history: status change recorded with from/to', h.length === 1 && h[0].type === 'updated' && c.field === '상태' && c.from === '미진행' && c.to === '진행중', JSON.stringify(h));
  }

  window.document.querySelector('[data-action="open-detail"][data-id="t1"]').click();
  $('detailTaskDueDate').value = '2030-02-10';
  $('detailTaskOutcome').value = '회신 완료';
  $('detailModalSave').click();
  const t1 = tasksOf(window).find((t) => t.id === 't1');
  check('detail: due date + outcome saved', t1.dueDate === '2030-02-10' && t1.outcome === '회신 완료');
  {
    const h = historyOf(window);
    const fields = (h[0].changes || []).map((c) => c.field).sort().join(',');
    check('history: detail edit records only real changes (마감, 성과)', h.length === 2 && fields === '마감,성과', JSON.stringify(h[0]));
    check('history: long text is not copied into the log', !JSON.stringify(h).includes('회신 완료'));
    window.document.querySelector('[data-action="open-detail"][data-id="t1"]').click();
    check('history: timeline shown in detail modal', $('detailTaskHistory').querySelectorAll('.th-row').length === 2);
    $('detailModalSave').click();
    check('history: saving without changes adds nothing', historyOf(window).length === 2);
  }

  window.document.querySelector('[data-action="delete"][data-id="t2"]').click();
  check('delete: task removed', tasksOf(window).length === 1);
  check('history: deletion recorded', historyOf(window)[0].type === 'deleted' && historyOf(window)[0].taskName === '주간회의 자료');
  check('history: recent list rendered on tasks page', $('taskHistoryList').querySelectorAll('.th-row').length === 3);
  ['tasks', 'weekly', 'monthly', 'work', 'home'].forEach((tab) => {
    const el = window.document.querySelector(`.tab[data-tab="${tab}"]`);
    if (el) el.click();
  });
  check('tabs: switching all tabs without errors', errors.length === 0, errors.slice(0, 3).join(' | '));
}

let failed = 0;
results.forEach((r) => { if (!r.ok) failed += 1; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : '\n      ' + r.detail}`); });
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
