// Smoke test: loads the real index.html and scripts in jsdom and exercises core flows.
// Run: node tests/smoke.js   (requires: npm i jsdom)
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const SCRIPTS = [
  'config.js',
  'cloud-sync.js',
  'app.js',
  'project-notes.js',
  'report-format.js',
  'project-ops.js'
];

function boot(seed = {}) {
  const html = fs
    .readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace(/<script\b[^>]*src=[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, {
    url: 'https://heochanghoe.github.io/workboard/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
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
  const listed = (
    fs.readFileSync(path.join(root, 'index.html'), 'utf8').match(/<script src="([a-z-]+\.js)/g) || []
  ).map((s) => s.replace('<script src="', ''));
  const order = listed.length ? listed : available;
  order.forEach((f) => {
    try {
      window.eval(
        fs.readFileSync(path.join(root, f), 'utf8').replace(/^\uFEFF/, '') + '\n//# sourceURL=' + f
      );
    } catch (err) {
      errors.push(`${f}: ${err.stack || err}`);
    }
  });
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  window.dispatchEvent(new window.Event('load'));
  return { window, errors, $: (id) => window.document.getElementById(id) };
}

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
}
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
  check(
    'create: task saved',
    tasks.length === 1 && tasks[0].name === '스모크 테스트 업무',
    JSON.stringify(tasks[0] || null)
  );
  check('create: project stored', tasks[0] && tasks[0].project === '테스트프로젝트');
  check('create: table rendered', /스모크 테스트 업무/.test($('taskTableBody').innerHTML));
  check('create: no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const hist = historyOf(window);
  check(
    'history: creation recorded',
    hist.length === 1 && hist[0].type === 'created' && hist[0].taskName === '스모크 테스트 업무',
    JSON.stringify(hist)
  );
}

// 3. Seeded data: status change, detail edit, delete
{
  const seedTasks = [
    {
      id: 't1',
      name: '식약처 보완자료 회신',
      channel: '메일',
      dueDate: '2030-02-01',
      dueTime: '오후 03:00',
      status: '미진행',
      project: 'VAMS',
      impact: 3,
      urgency: 3,
      linkage: 2,
      createdAt: '2026-11-01T00:00:00.000Z'
    },
    {
      id: 't2',
      name: '주간회의 자료',
      channel: '회의',
      dueDate: '',
      dueTime: '',
      status: '진행중',
      project: '',
      impact: 2,
      urgency: 2,
      linkage: 1,
      createdAt: '2026-11-02T00:00:00.000Z'
    }
  ];
  const { window, errors, $ } = boot({ work_dashboard_tasks_v1: seedTasks });
  check(
    'seed: both tasks rendered',
    /식약처 보완자료 회신/.test($('taskTableBody').innerHTML) &&
      /주간회의 자료/.test($('taskTableBody').innerHTML)
  );
  // Status filter hides rows but keeps every project header visible.
  window.document.querySelector('[data-status-filter="전체"]').click();
  window.document.querySelector('[data-status-filter="진행중"]').click();
  const filteredHtml = $('taskTableBody').innerHTML;
  check(
    'filter: project header stays visible with no matching tasks',
    /project-group-title">VAMS</.test(filteredHtml) && /0 \/ 1 TASKS/.test(filteredHtml),
    filteredHtml.slice(0, 300)
  );
  check(
    'filter: non-matching task rows are hidden',
    !/식약처 보완자료 회신/.test(filteredHtml) && /주간회의 자료/.test(filteredHtml)
  );
  window.document.querySelector('[data-status-filter="전체"]').click();
  check('filter: clearing shows all rows again', /식약처 보완자료 회신/.test($('taskTableBody').innerHTML));
  const sel = window.document.querySelector('select[data-action="status-select"][data-id="t1"]');
  sel.value = '진행중';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('status: inline change saved', tasksOf(window).find((t) => t.id === 't1').status === '진행중');
  {
    const h = historyOf(window);
    const c = h[0] && h[0].changes && h[0].changes[0];
    check(
      'history: status change recorded with from/to',
      h.length === 1 &&
        h[0].type === 'updated' &&
        c.field === '상태' &&
        c.from === '미진행' &&
        c.to === '진행중',
      JSON.stringify(h)
    );
  }

  window.document.querySelector('[data-action="open-detail"][data-id="t1"]').click();
  $('detailTaskDueDate').value = '2030-02-10';
  $('detailTaskOutcome').value = '회신 완료';
  $('detailModalSave').click();
  const t1 = tasksOf(window).find((t) => t.id === 't1');
  check('detail: due date + outcome saved', t1.dueDate === '2030-02-10' && t1.outcome === '회신 완료');
  {
    const h = historyOf(window);
    const fields = (h[0].changes || [])
      .map((c) => c.field)
      .sort()
      .join(',');
    check(
      'history: detail edit records only real changes (마감, 성과)',
      h.length === 2 && fields === '마감,성과',
      JSON.stringify(h[0])
    );
    check('history: long text is not copied into the log', !JSON.stringify(h).includes('회신 완료'));
    window.document.querySelector('[data-action="open-detail"][data-id="t1"]').click();
    check(
      'history: timeline shown in detail modal',
      $('detailTaskHistory').querySelectorAll('.th-row').length === 2
    );
    $('detailModalSave').click();
    check('history: saving without changes adds nothing', historyOf(window).length === 2);
  }

  window.document.querySelector('[data-action="delete"][data-id="t2"]').click();
  check('delete: task removed', tasksOf(window).length === 1);
  check(
    'history: deletion recorded',
    historyOf(window)[0].type === 'deleted' && historyOf(window)[0].taskName === '주간회의 자료'
  );
  check(
    'history: recent list rendered on tasks page',
    $('taskHistoryList').querySelectorAll('.th-row').length === 3
  );
  ['tasks', 'weekly', 'monthly', 'work', 'github', 'home'].forEach((tab) => {
    const el = window.document.querySelector(`.tab[data-tab="${tab}"]`);
    if (el) el.click();
  });
  check('tabs: switching all tabs without errors', errors.length === 0, errors.slice(0, 3).join(' | '));
}

// 4. Quick capture with built-in rules (no AI connected)
async function captureWithRules() {
  const { window, errors, $ } = boot({
    work_dashboard_tasks_v1: [
      {
        id: 'v1',
        name: '기존 업무',
        channel: '웍스',
        status: '진행중',
        project: 'VAMS',
        impact: 2,
        urgency: 2,
        linkage: 1,
        createdAt: '2026-11-01T00:00:00.000Z'
      }
    ]
  });
  $('captureInput').value = '내일 3시까지 VAMS 식약처 보완자료 회신, 메일, 급함\n주간회의 자료 작성';
  $('captureSubmit').click();
  await wait(30);
  const tasks = tasksOf(window);
  const reply = tasks.find((t) => t.name === 'VAMS 식약처 보완자료 회신');
  check('capture(rules): two lines become two tasks', tasks.length === 3, String(tasks.length));
  check(
    'capture(rules): project, channel, urgency, due filled',
    reply &&
      reply.project === 'VAMS' &&
      reply.channel === '메일' &&
      reply.urgency === 3 &&
      /^\d{4}-\d{2}-\d{2}$/.test(reply.dueDate) &&
      reply.dueTime === '오후 03:00',
    JSON.stringify(reply)
  );
  check(
    'capture(rules): input cleared and result listed',
    $('captureInput').value === '' && $('captureResult').querySelectorAll('.cap-row').length === 2
  );
  check(
    'capture(rules): history recorded',
    historyOf(window).filter((e) => e.type === 'created').length === 2
  );
  $('captureResult').querySelector('[data-capture-action="undo"]').click();
  check(
    'capture(rules): undo removes only the new tasks',
    tasksOf(window).length === 1 && tasksOf(window)[0].id === 'v1'
  );
  check('capture(rules): no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
}

// Fake cloud handle so AI paths can be tested without a network.
function fakeCloud(window, handler) {
  const rawRows = new Map();
  const table = () => {
    const q = { _id: null };
    q.upsert = async (row) => {
      rawRows.set(row.meeting_id, row.raw_text);
      return { error: null };
    };
    q.select = () => q;
    q.delete = () => {
      q._delete = true;
      return q;
    };
    q.eq = (col, value) => {
      q._id = value;
      if (q._delete) {
        rawRows.delete(value);
        return Promise.resolve({ error: null });
      }
      return q;
    };
    q.maybeSingle = async () => ({
      data: rawRows.has(q._id) ? { raw_text: rawRows.get(q._id) } : null,
      error: null
    });
    return q;
  };
  const calls = [];
  window.WorkBoardCloud = {
    isReady: () => true,
    getUserId: () => 'user-1',
    getClient: () => ({
      functions: {
        invoke: async (name, { body }) => {
          calls.push({ name, body });
          return handler(body);
        }
      },
      from: table
    })
  };
  return { calls, rawRows };
}

// 5. Quick capture through AI: new task auto-registered, changes to existing data wait for confirmation
async function captureWithAi() {
  const { window, errors, $ } = boot({
    work_dashboard_tasks_v1: [
      {
        id: 'v1',
        name: '식약처 보완자료 회신',
        channel: '메일',
        status: '진행중',
        project: 'VAMS',
        dueDate: '2030-01-10',
        impact: 3,
        urgency: 3,
        linkage: 2,
        createdAt: '2026-11-01T00:00:00.000Z'
      }
    ]
  });
  const { calls } = fakeCloud(window, () => ({
    data: {
      actions: [
        {
          type: 'create_task',
          task: {
            name: 'HLM 미팅 자료 준비',
            project: 'VAMS',
            channel: '회의',
            dueDate: '2030-03-02',
            dueTime: '10:00',
            impact: 2,
            urgency: 3,
            linkage: 2
          }
        },
        { type: 'update_task', taskId: 'v1', patch: { status: '완료' } },
        { type: 'update_task', taskId: 'does-not-exist', patch: { status: '완료' } },
        {
          type: 'project_note',
          project: 'VAMS',
          patch: { progress: '보완자료 회신 완료', next: 'HLM 미팅' }
        },
        { type: 'project_note', project: '없는프로젝트', patch: { progress: 'x' } },
        {
          type: 'create_task',
          task: {
            name: '<img src=x onerror=alert(1)>',
            channel: '이상한채널',
            dueDate: 'not-a-date',
            impact: 9
          }
        }
      ]
    },
    error: null
  }));
  $('captureInput').value = '식약처 회신 끝냈고 다음주 HLM 미팅 자료 준비해야 함';
  $('captureSubmit').click();
  await wait(30);
  const sent = calls[0] && calls[0].body;
  check(
    'capture(ai): request carries projects and open tasks, no secrets',
    calls.length === 1 &&
      calls[0].name === 'workboard-ai' &&
      sent.mode === 'capture' &&
      sent.projects.includes('VAMS') &&
      sent.tasks[0].id === 'v1' &&
      !JSON.stringify(sent).includes('eyJ')
  );
  let tasks = tasksOf(window);
  const made = tasks.find((t) => t.name === 'HLM 미팅 자료 준비');
  check(
    'capture(ai): new task registered with converted time',
    made && made.dueDate === '2030-03-02' && made.dueTime === '오전 10:00' && made.channel === '회의',
    JSON.stringify(made)
  );
  const odd = tasks.find((t) => t.name.includes('onerror'));
  check(
    'capture(ai): invalid fields fall back to safe values',
    odd && odd.channel === '웍스' && odd.dueDate === '' && odd.impact === 2,
    JSON.stringify(odd)
  );
  check(
    'capture(ai): untrusted text is escaped in the page',
    !$('captureResult').innerHTML.includes('<img src=x')
  );
  check(
    'capture(ai): existing task NOT changed before confirmation',
    tasks.find((t) => t.id === 'v1').status === '진행중'
  );
  check(
    'capture(ai): unknown task/project proposals dropped',
    $('captureResult').querySelectorAll('.cap-proposal').length === 2
  );
  $('captureResult').querySelector('[data-capture-action="accept"]').click();
  check(
    'capture(ai): confirmed change applied',
    tasksOf(window).find((t) => t.id === 'v1').status === '완료'
  );
  $('captureResult').querySelector('[data-capture-action="accept"]').click();
  const notes = JSON.parse(window.localStorage.getItem('work_project_notes_v1') || '{}');
  check(
    'capture(ai): project note appended with date stamp',
    notes.VAMS &&
      /^\[\d{2}\.\d{2}\] 보완자료 회신 완료$/.test(notes.VAMS.progress) &&
      /HLM 미팅/.test(notes.VAMS.next),
    JSON.stringify(notes.VAMS)
  );
  check('capture(ai): no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
}

// 6. AI failure falls back to rules instead of losing the input
async function captureAiFailure() {
  const { window, errors, $ } = boot();
  window.console.warn = () => {};
  fakeCloud(window, () => ({ data: null, error: new Error('Function not found') }));
  $('captureInput').value = '내일 견적서 회신';
  $('captureSubmit').click();
  await wait(30);
  check(
    'capture(fallback): task still created when AI fails',
    tasksOf(window).length === 1 && tasksOf(window)[0].name === '견적서 회신'
  );
  check(
    'capture(fallback): status says rules were used',
    /기본 규칙/.test($('captureStatus').textContent),
    $('captureStatus').textContent
  );
  check('capture(fallback): no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
}

// 7. Capture settings
async function captureSettings() {
  const { window, errors, $ } = boot();
  $('captureSettingsBtn').click();
  $('captureDefaultChannel').value = '메일';
  $('captureDefaultDueTime').value = '09:30';
  $('captureAutoApply').checked = false;
  $('captureProjectKeywords').value = 'PreOPRisk: 수술위험';
  $('captureSettingsSave').click();
  $('captureInput').value = '금요일 수술위험 모델 검증 보고';
  $('captureSubmit').click();
  await wait(30);
  check(
    'settings: with auto-register off nothing is saved yet',
    tasksOf(window).length === 0 && $('captureResult').querySelectorAll('.cap-row').length === 1
  );
  $('captureResult').querySelector('[data-capture-action="apply-drafts"]').click();
  const t = tasksOf(window)[0];
  check(
    'settings: defaults and keyword mapping applied',
    t && t.channel === '메일' && t.dueTime === '오전 09:30' && t.project === 'PreOPRisk',
    JSON.stringify(t)
  );
  check('settings: no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
}

// 8. Meetings: organize with AI, action items become tasks, browse and delete
async function meetingsFlow() {
  const { window, errors, $ } = boot({
    work_dashboard_tasks_v1: [
      {
        id: 'v1',
        name: '기존 업무',
        channel: '웍스',
        status: '진행중',
        project: 'VAMS',
        impact: 2,
        urgency: 2,
        linkage: 1,
        createdAt: '2026-11-01T00:00:00.000Z'
      }
    ]
  });
  const { calls, rawRows } = fakeCloud(window, (body) => ({
    data: {
      meeting: {
        title: 'VAMS 인허가 주간 회의',
        project: 'VAMS',
        summary: ['보완자료 2건 제출 일정 확정', '라벨 문구 재검토 필요'],
        decisions: ['보완자료는 11월 20일까지 제출'],
        actionItems: [
          { name: '보완자료 초안 작성', owner: '', dueDate: '2030-11-18', mine: true },
          { name: '라벨 문구 검토', owner: '서우영', dueDate: '', mine: false }
        ],
        openIssues: ['시험성적서 발급 일정 미정']
      }
    },
    error: null
  }));
  window.document.querySelector('.tab[data-tab="meetings"]').click();
  check('meetings: tab opens page', $('page-meetings').classList.contains('active'));
  const transcript = '참석자 A: 보완자료 일정 얘기합시다.\n참석자 B: 20일까지 내겠습니다.';
  $('meetingDate').value = '2030-11-11';
  $('meetingText').value = transcript;
  $('meetingOrganize').click();
  await wait(40);
  const stored = JSON.parse(window.localStorage.getItem('work_meetings_v1') || '[]');
  const m = stored[0];
  check(
    'meetings: request sent in meeting mode with the text',
    calls[0] &&
      calls[0].body.mode === 'meeting' &&
      calls[0].body.text === transcript &&
      calls[0].body.kind === 'memo'
  );
  check(
    'meetings: minutes saved with project and date',
    m &&
      m.title === 'VAMS 인허가 주간 회의' &&
      m.project === 'VAMS' &&
      m.date === '2030-11-11' &&
      m.organized === true &&
      m.decisions.length === 1,
    JSON.stringify(m)
  );
  check(
    'meetings: transcript stored outside the synced minutes',
    rawRows.get(m.id) === transcript && !JSON.stringify(stored).includes('참석자 A')
  );
  const tasks = tasksOf(window);
  const mine = tasks.find((t) => t.name === '보완자료 초안 작성');
  check(
    'meetings: my action item became a task linked to the meeting',
    mine &&
      mine.project === 'VAMS' &&
      mine.channel === '회의' &&
      mine.dueDate === '2030-11-18' &&
      /VAMS 인허가 주간 회의/.test(mine.description) &&
      m.actionItems[0].taskId === mine.id,
    JSON.stringify(mine)
  );
  check("meetings: other people's items wait for a click", !tasks.some((t) => t.name === '라벨 문구 검토'));
  $('meetingList').querySelector('[data-meeting-action="register"]').click();
  check(
    'meetings: clicking registers the remaining item',
    tasksOf(window).some((t) => t.name === '라벨 문구 검토' && /서우영/.test(t.description))
  );

  // second meeting without AI: raw only
  window.WorkBoardCloud.isReady = () => false;
  $('meetingDate').value = '2030-12-02';
  $('meetingTitle').value = '채용 면접 회의';
  $('meetingText').value = '면접 일정 논의';
  $('meetingSaveRaw').click();
  await wait(30);
  const all = JSON.parse(window.localStorage.getItem('work_meetings_v1') || '[]');
  check(
    'meetings: raw-only save works without AI',
    all.length === 2 && all[0].title === '채용 면접 회의' && all[0].organized === false
  );
  check('meetings: date view groups by day', $('meetingList').querySelectorAll('.mt-group').length === 2);
  window.document.querySelector('[data-meeting-view="project"]').click();
  const heads = Array.from($('meetingList').querySelectorAll('.mt-group-head')).map((el) =>
    el.textContent.trim().replace(/\s+/g, ' ')
  );
  check(
    'meetings: project view groups by project',
    heads.length === 2 && /^VAMS/.test(heads[0]) && /^미분류/.test(heads[1]),
    heads.join(' | ')
  );
  $('meetingFilterProject').value = 'VAMS';
  $('meetingFilterProject').dispatchEvent(new window.Event('change', { bubbles: true }));
  check('meetings: project filter', $('meetingList').querySelectorAll('.mt-item').length === 1);
  $('meetingFilterProject').value = '전체';
  $('meetingFilterProject').dispatchEvent(new window.Event('change', { bubbles: true }));
  $('meetingSearch').value = '시험성적서';
  $('meetingSearch').dispatchEvent(new window.Event('input', { bubbles: true }));
  check(
    'meetings: search finds text inside minutes',
    $('meetingList').querySelectorAll('.mt-item').length === 1
  );
  $('meetingSearch').value = '';
  $('meetingSearch').dispatchEvent(new window.Event('input', { bubbles: true }));

  window.WorkBoardCloud.isReady = () => true;
  const firstId = m.id;
  if (!$('meetingList').querySelector(`[data-meeting-action="delete"][data-id="${firstId}"]`))
    $('meetingList').querySelector(`[data-meeting-action="toggle"][data-id="${firstId}"]`).click();
  $('meetingList').querySelector(`[data-meeting-action="delete"][data-id="${firstId}"]`).click();
  await wait(30);
  check(
    'meetings: delete removes minutes and transcript, keeps tasks',
    JSON.parse(window.localStorage.getItem('work_meetings_v1')).length === 1 &&
      !rawRows.has(firstId) &&
      tasksOf(window).some((t) => t.name === '보완자료 초안 작성')
  );
  check(
    'meetings: subtitle file cleanup',
    window.WorkBoardMeetings.cleanTranscript(
      'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\n안녕하세요\n\n2\n00:00:03.500 --> 00:00:05.000\n시작하겠습니다',
      'a.vtt'
    ) === '안녕하세요\n\n시작하겠습니다'
  );
  check('meetings: no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
}

async function githubFlow() {
  const { window, errors, $ } = boot();
  const rows = new Map();
  window.WorkBoardCloud = {
    isReady: () => true,
    getUserId: () => 'user-1',
    getClient: () => ({
      from: (name) => {
        const q = {};
        q.upsert = async (row) => {
          rows.set(`${name}:${row.user_id}`, row);
          return { error: null };
        };
        q.select = () => q;
        q.maybeSingle = async () => ({ data: rows.get(`${name}:user-1`) || null, error: null });
        return q;
      }
    })
  };
  window.document.querySelector('.tab[data-tab="github"]').click();
  check('github: tab opens page', $('page-github').classList.contains('active'));
  check('github: empty state shown', /피드 가져오기/.test($('ghRepoBody').innerHTML));
  const feed = {
    type: 'workboard-github-feed',
    version: 1,
    generatedAt: '2026-11-12T08:00:00+09:00',
    schedule: '매일 07:00',
    repos: [
      {
        name: 'org/RepoA',
        short: 'RepoA',
        lastChecked: '2026-11-12T07:26:00+09:00',
        lastCommit: 'abc1234',
        lastTag: 'v1.2.0',
        commitReports: 3,
        releaseReports: 1
      },
      {
        name: 'org/RepoB',
        short: 'RepoB',
        lastChecked: '2026-11-12T07:26:00+09:00',
        lastCommit: 'def5678',
        commitReports: 1
      }
    ],
    runs: [
      {
        date: '2026-11-12',
        time: '07:26',
        text: '확인 2개 repo | 변경 1개 repo(RepoA) | 신규 보고서 2건 | **중요** <img src=x>',
        headline: '확인 2개 repo | 변경 1개 repo(RepoA)',
        newReports: 2,
        changed: true
      },
      {
        date: '2026-11-11',
        time: '07:10',
        text: '확인 2개 repo | 변경 없음(조기 종료) | 신규 보고서 0건',
        headline: '확인 2개 repo | 변경 없음',
        newReports: 0,
        changed: false
      }
    ],
    reports: [
      {
        repo: 'RepoA',
        kind: 'release',
        key: 'v1.2.0',
        file: 'RepoA/releases/a.docx',
        modified: '2026-11-12 07:26',
        title: 'RepoA v1.1.0 → v1.2.0',
        summary: ['신호 품질 판정 개선']
      },
      {
        repo: 'RepoA',
        kind: 'commit',
        key: '20261111',
        date: '2026-11-11',
        file: 'RepoA/commits/b.docx',
        modified: '2026-11-12 07:26',
        title: 'RepoA 커밋 보고 (2026-11-11)',
        summary: ['로그 설정 기본값 변경']
      },
      {
        repo: 'RepoB',
        kind: 'commit',
        key: '20200101',
        date: '2020-01-01',
        file: 'RepoB/commits/c.docx',
        modified: '2026-06-11 08:00'
      }
    ]
  };
  check('github: rejects unrelated JSON', window.WorkBoardGithub.cleanFeed({ tasks: [] }) === null);
  const where = await window.WorkBoardGithub.importFeed(feed);
  window.WorkBoardGithub.render();
  await wait(20);
  check('github: import saved to cloud', where === 'cloud' && rows.has('work_board_github_feed:user-1'));
  check('github: not added to synced snapshot keys', !window.localStorage.getItem('work_dashboard_tasks_v1'));
  check('github: repo table rendered', $('ghRepoBody').querySelectorAll('.gh-repo-row').length === 2);
  check('github: only changed runs by default', $('ghList').querySelectorAll('.mt-item').length === 1);
  $('ghList').querySelector('[data-gh-toggle]').click();
  check(
    'github: run detail escapes HTML and keeps bold',
    /<strong>중요<\/strong>/.test($('ghList').innerHTML) && !$('ghList').querySelector('img')
  );
  const link = $('ghList').querySelector('[data-gh-open-report]');
  link.click();
  check(
    'github: linked report opens in report view',
    $('ghList').querySelector('.mt-item.open') && /신호 품질 판정 개선/.test($('ghList').innerHTML)
  );
  $('ghRepoBody').querySelector('[data-gh-repo="RepoB"]').click();
  check('github: repo row filters reports', $('ghList').querySelectorAll('.mt-item').length === 1);
  check('github: no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  await captureWithRules();
  await captureWithAi();
  await captureAiFailure();
  await captureSettings();
  await meetingsFlow();
  await githubFlow();

  let failed = 0;
  results.forEach((r) => {
    if (!r.ok) failed += 1;
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : '\n      ' + r.detail}`);
  });
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
