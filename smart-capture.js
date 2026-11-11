// Quick capture: type what happened in plain words; it becomes structured tasks.
// With AI connected the server interprets the text. Without it, the built-in rules below do.
(function () {
  'use strict';

  const SETTINGS_KEY = 'work_capture_settings_v1';
  const AI_FUNCTION = 'workboard-ai';
  const AI_RETRY_AFTER_MS = 5 * 60 * 1000;
  const MAX_TASK_CONTEXT = 150;
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const CHANNELS = ['웍스', '메일', '전화', '회의', '구두', '기타'];
  const STATUSES = ['미진행', '진행중', '대기', '완료'];
  const NOTE_STATUSES = ['정상', '주의', '지연', '보류'];
  const DEFAULT_SETTINGS = {
    defaultChannel: '웍스',
    defaultDueTime: '18:00',
    autoApplyNew: true,
    projectKeywords: '',
    people: ''
  };

  let aiUnavailableUntil = 0;
  let lastBatch = null; // { createdIds: [], proposals: [] }
  let busy = false;

  const $ = (id) => document.getElementById(id);
  const pad2 = (n) => String(n).padStart(2, '0');
  const escapeHtml = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  const escapeRegExp = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const toDateInput = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  // ---------------------------------------------------------------------------
  // Settings (set once, used for every entry)
  // ---------------------------------------------------------------------------
  function readSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      const safe = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      const merged = { ...DEFAULT_SETTINGS, ...safe };
      if (!CHANNELS.includes(merged.defaultChannel)) merged.defaultChannel = DEFAULT_SETTINGS.defaultChannel;
      if (!/^\d{2}:\d{2}$/.test(String(merged.defaultDueTime)))
        merged.defaultDueTime = DEFAULT_SETTINGS.defaultDueTime;
      merged.autoApplyNew = merged.autoApplyNew !== false;
      return merged;
    } catch (error) {
      console.error('Capture settings parse error:', error);
      return { ...DEFAULT_SETTINGS };
    }
  }

  function writeSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  // "프로젝트: 키워드1, 키워드2" per line -> [{ project, keywords: [] }]
  function parseKeywordLines(text) {
    return String(text || '')
      .split('\n')
      .map((line) => {
        const index = line.indexOf(':');
        if (index < 0) return null;
        const project = line.slice(0, index).trim();
        const keywords = line
          .slice(index + 1)
          .split(',')
          .map((word) => word.trim())
          .filter(Boolean);
        return project && keywords.length ? { project, keywords } : null;
      })
      .filter(Boolean);
  }

  // ---------------------------------------------------------------------------
  // Built-in rules: date, time, channel, urgency, project
  // ---------------------------------------------------------------------------
  function toKoreanTime(hour24, minute) {
    const ap = hour24 >= 12 ? '오후' : '오전';
    const hh = hour24 % 12 || 12;
    return `${ap} ${pad2(hh)}:${pad2(minute)}`;
  }

  function atDay(base, offsetDays) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    d.setDate(d.getDate() + offsetDays);
    return d;
  }

  function monthDay(base, month, day) {
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const today = atDay(base, 0);
    let d = new Date(today.getFullYear(), month - 1, day);
    if (d.getMonth() !== month - 1) return null;
    // A date more than about two months back almost always means next year.
    if (today - d > 60 * 86400000) d = new Date(today.getFullYear() + 1, month - 1, day);
    return d;
  }

  const TAIL = '(?:\\s*(?:까지|에|중으로|안으로|안에|내로|부로))?';

  // Each rule: [regex, (match, today) => Date | null]. First match wins and is removed from the text.
  const DATE_RULES = [
    [
      new RegExp(`(\\d{4})[-./](\\d{1,2})[-./](\\d{1,2})${TAIL}`),
      (m) => {
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        return d.getMonth() === Number(m[2]) - 1 ? d : null;
      }
    ],
    [
      new RegExp(`(\\d{1,2})월\\s*(\\d{1,2})일${TAIL}`),
      (m, today) => monthDay(today, Number(m[1]), Number(m[2]))
    ],
    [
      new RegExp(`(?<![\\d/.])(\\d{1,2})/(\\d{1,2})(?![\\d/])${TAIL}`),
      (m, today) => monthDay(today, Number(m[1]), Number(m[2]))
    ],
    [new RegExp(`(?:오늘|금일)${TAIL}`), (m, today) => atDay(today, 0)],
    [new RegExp(`(?:내일|명일)${TAIL}`), (m, today) => atDay(today, 1)],
    [new RegExp(`모레${TAIL}`), (m, today) => atDay(today, 2)],
    [new RegExp(`(\\d{1,3})일\\s*(?:뒤|후)${TAIL}`), (m, today) => atDay(today, Number(m[1]))],
    [
      new RegExp(`(이번\\s*주|금주|다음\\s*주|차주)?\\s*([월화수목금토일])요일${TAIL}`),
      (m, today) => {
        const target = WEEKDAYS.indexOf(m[2]);
        const mondayShift = today.getDay() === 0 ? -6 : 1 - today.getDay();
        const offsetInWeek = target === 0 ? 6 : target - 1;
        const prefix = (m[1] || '').replace(/\s/g, '');
        if (prefix === '다음주' || prefix === '차주') return atDay(today, mondayShift + 7 + offsetInWeek);
        if (prefix) return atDay(today, mondayShift + offsetInWeek);
        const diff = (target - today.getDay() + 7) % 7;
        return atDay(today, diff);
      }
    ],
    [
      new RegExp(`(?:다음\\s*주|차주)${TAIL}`),
      (m, today) => atDay(today, (today.getDay() === 0 ? -6 : 1 - today.getDay()) + 7 + 4)
    ],
    [
      new RegExp(`(?:이번\\s*주|금주)${TAIL}`),
      (m, today) => {
        const friday = atDay(today, (today.getDay() === 0 ? -6 : 1 - today.getDay()) + 4);
        return friday < atDay(today, 0) ? atDay(today, 0) : friday;
      }
    ],
    [new RegExp(`월말${TAIL}`), (m, today) => new Date(today.getFullYear(), today.getMonth() + 1, 0)],
    [
      new RegExp(`(?<![\\d.])(\\d{1,2})일(?:\\s*(?:까지|에|중으로|안으로|안에|내로|부로)|(?=\\s|,|$))`),
      (m, today) => {
        const day = Number(m[1]);
        if (day < 1 || day > 31) return null;
        let d = new Date(today.getFullYear(), today.getMonth(), day);
        if (d.getDate() !== day) return null;
        if (d < atDay(today, 0)) d = new Date(today.getFullYear(), today.getMonth() + 1, day);
        return d.getDate() === day ? d : null;
      }
    ]
  ];

  function resolveHour(ampm, hour) {
    if (hour > 24) return null;
    if (ampm === '오전' || ampm === '아침') return hour === 12 ? 0 : hour;
    if (ampm === '오후' || ampm === '저녁' || ampm === '밤') return hour < 12 ? hour + 12 : hour;
    // No marker: 1~7 is read as afternoon (working hours), the rest as written.
    if (hour >= 1 && hour <= 7) return hour + 12;
    return hour === 24 ? 0 : hour;
  }

  const TIME_RULES = [
    [
      new RegExp(`(오전|오후|아침|저녁|밤)?\\s*(\\d{1,2}):(\\d{2})${TAIL}`),
      (m) => {
        const hour = resolveHour(m[1], Number(m[2]));
        const minute = Number(m[3]);
        return hour == null || minute > 59 ? null : { hour, minute };
      }
    ],
    [
      new RegExp(`(오전|오후|아침|저녁|밤)?\\s*(\\d{1,2})시\\s*(반|(\\d{1,2})분)?${TAIL}`),
      (m) => {
        const hour = resolveHour(m[1], Number(m[2]));
        const minute = m[3] === '반' ? 30 : m[4] ? Number(m[4]) : 0;
        return hour == null || minute > 59 ? null : { hour, minute };
      }
    ]
  ];

  function extractFirst(text, rules, context) {
    for (const [regex, resolve] of rules) {
      const match = regex.exec(text);
      if (!match) continue;
      const value = resolve(match, context);
      if (value == null) continue;
      const rest = (text.slice(0, match.index) + ' ' + text.slice(match.index + match[0].length))
        .replace(/\s{2,}/g, ' ')
        .trim();
      return { value, rest };
    }
    return { value: null, rest: text };
  }

  const CHANNEL_WORDS = [
    ['메일', /^(?:이?메일|e-?mail|mail)$/i],
    ['웍스', /^(?:웍스|works|네이버웍스|메신저)$/i],
    ['전화', /^(?:전화|통화|콜)$/],
    ['회의', /^(?:회의|미팅)$/],
    ['구두', /^구두$/]
  ];
  const CHANNEL_SUFFIX =
    /\s*(?:로|으로)?\s*(?:옴|왔음|요청|요청옴|요청받음|접수|받음|연락|연락옴|전달|전달받음)?$/;
  const URGENT = /^(?:긴급|급함|급해|급해요|급히|asap|최우선|시급|빨리|서둘러)$/i;
  const IMPORTANT = /^(?:중요|중요함|핵심)$/;
  const RELAXED = /^(?:여유|여유있음|천천히|나중에|급하지\s*않음|안\s*급함)$/;

  // A comma-separated piece that only carries metadata ("메일로 옴", "급함") is consumed, not kept in the name.
  function readMetaSegment(segment, result) {
    const text = segment.trim();
    if (!text) return true;
    const bare = text.replace(CHANNEL_SUFFIX, '').trim();
    const channel = CHANNEL_WORDS.find(([, regex]) => regex.test(bare));
    if (channel) {
      result.channel = channel[0];
      return true;
    }
    if (URGENT.test(text)) {
      result.urgency = 3;
      return true;
    }
    if (IMPORTANT.test(text)) {
      result.impact = 3;
      return true;
    }
    if (RELAXED.test(text)) {
      result.urgency = 1;
      return true;
    }
    if (STATUSES.includes(text) || text === '진행 중') {
      result.status = text === '진행 중' ? '진행중' : text;
      return true;
    }
    return false;
  }

  function findProject(text, projects, keywordMap) {
    const lower = text.toLowerCase();
    const byLength = [...projects].sort((a, b) => b.length - a.length);
    const direct = byLength.find((name) => name && lower.includes(name.toLowerCase()));
    if (direct) return direct;
    const viaKeyword = keywordMap.find((entry) =>
      entry.keywords.some((word) => lower.includes(word.toLowerCase()))
    );
    return viaKeyword ? viaKeyword.project : '';
  }

  function parseLine(rawLine, context) {
    const today = context.today || new Date();
    const settings = context.settings || DEFAULT_SETTINGS;
    const result = {
      name: '',
      project: '',
      channel: settings.defaultChannel,
      dueDate: '',
      dueTime: '',
      impact: 2,
      urgency: 2,
      linkage: 1,
      status: '미진행'
    };
    let line = String(rawLine || '')
      .replace(/^\s*(?:[-*•·]|\d+[.)]|\[[ xX]?\])\s+/, '')
      .trim();
    if (!line) return null;

    // Explicit project: "#프로젝트" anywhere or "[프로젝트]" at the start.
    let explicitProject = '';
    line = line.replace(/(?:^|\s)#([^\s,#]+)/, (all, name) => {
      explicitProject = name;
      return ' ';
    });
    line = line.replace(/^\s*\[([^\]]+)\]\s*/, (all, name) => {
      explicitProject = explicitProject || name.trim();
      return '';
    });

    const kept = line
      .split(/[,，]/)
      .map((segment) => segment.trim())
      .filter((segment) => !readMetaSegment(segment, result));
    let text = kept.join(', ').trim();

    const date = extractFirst(text, DATE_RULES, today);
    text = date.rest;
    const time = extractFirst(text, TIME_RULES, today);
    text = time.rest;

    let dueDay = date.value;
    if (!dueDay && time.value) dueDay = atDay(today, 0);
    if (dueDay) {
      result.dueDate = toDateInput(dueDay);
      const [defaultHour, defaultMinute] = String(settings.defaultDueTime).split(':').map(Number);
      const clock = time.value || { hour: defaultHour, minute: defaultMinute };
      result.dueTime = toKoreanTime(clock.hour, clock.minute);
    }

    text = text
      .replace(/^[\s,·:-]+|[\s,·:-]+$/g, '')
      .replace(/\s*,\s*,+/g, ',')
      .replace(/\s{2,}/g, ' ')
      .trim();
    result.name = text || line.replace(/[,，]\s*$/, '').trim();
    result.project =
      explicitProject ||
      findProject(`${result.name} ${line}`, context.projects || [], context.keywordMap || []);
    return result.name ? result : null;
  }

  function parseLocally(text, context) {
    return String(text || '')
      .split('\n')
      .map((line) => parseLine(line, context))
      .filter(Boolean)
      .map((task) => ({ type: 'create_task', task }));
  }

  // ---------------------------------------------------------------------------
  // AI interpretation (server side; the API key never reaches the browser)
  // ---------------------------------------------------------------------------
  function aiReady() {
    return Boolean(window.WorkBoardCloud?.isReady?.()) && Date.now() >= aiUnavailableUntil;
  }

  async function callAi(body) {
    const client = window.WorkBoardCloud?.getClient?.();
    if (!client || !aiReady()) throw new Error('AI_NOT_CONNECTED');
    const { data, error } = await client.functions.invoke(AI_FUNCTION, { body });
    if (error) {
      aiUnavailableUntil = Date.now() + AI_RETRY_AFTER_MS;
      throw error;
    }
    if (!data || data.error) throw new Error(data?.error || 'AI_EMPTY_RESPONSE');
    return data;
  }

  function buildContext() {
    const app = window.WorkBoardApp;
    const settings = readSettings();
    return {
      today: new Date(),
      settings,
      projects: app?.getProjectNames?.() || [],
      keywordMap: parseKeywordLines(settings.projectKeywords)
    };
  }

  function cleanAiTask(raw, context) {
    const level = (value, fallback) => ([1, 2, 3].includes(Number(value)) ? Number(value) : fallback);
    const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(raw?.dueDate || '')) ? raw.dueDate : '';
    let dueTime = '';
    if (dueDate) {
      const clock =
        /^(\d{1,2}):(\d{2})$/.exec(String(raw?.dueTime || '')) ||
        /^(\d{2}):(\d{2})$/.exec(context.settings.defaultDueTime);
      dueTime = toKoreanTime(Math.min(23, Number(clock[1])), Math.min(59, Number(clock[2])));
    }
    return {
      name: String(raw?.name || '')
        .trim()
        .slice(0, 200),
      project: String(raw?.project || '')
        .trim()
        .slice(0, 80),
      channel: CHANNELS.includes(raw?.channel) ? raw.channel : context.settings.defaultChannel,
      dueDate,
      dueTime,
      impact: level(raw?.impact, 2),
      urgency: level(raw?.urgency, 2),
      linkage: level(raw?.linkage, 1),
      status: STATUSES.includes(raw?.status) ? raw.status : '미진행',
      description: String(raw?.description || '')
        .trim()
        .slice(0, 2000)
    };
  }

  // Server output is treated as untrusted data: every field is validated before use.
  function cleanAiActions(actions, context) {
    const tasksById = new Map((window.WorkBoardApp?.getTasks?.() || []).map((task) => [task.id, task]));
    const cleaned = [];
    (Array.isArray(actions) ? actions : []).slice(0, 40).forEach((action) => {
      if (action?.type === 'create_task') {
        const task = cleanAiTask(action.task, context);
        if (task.name) cleaned.push({ type: 'create_task', task });
      } else if (action?.type === 'update_task') {
        const target = tasksById.get(String(action.taskId || ''));
        if (!target) return;
        const patch = {};
        if (STATUSES.includes(action.patch?.status) && action.patch.status !== target.status)
          patch.status = action.patch.status;
        if (
          /^\d{4}-\d{2}-\d{2}$/.test(String(action.patch?.dueDate || '')) &&
          action.patch.dueDate !== target.dueDate
        ) {
          const fixed = cleanAiTask(
            { name: 'x', dueDate: action.patch.dueDate, dueTime: action.patch.dueTime },
            context
          );
          patch.dueDate = fixed.dueDate;
          patch.dueTime = fixed.dueTime;
        }
        if (typeof action.patch?.outcome === 'string' && action.patch.outcome.trim())
          patch.outcome = action.patch.outcome.trim().slice(0, 2000);
        if (Object.keys(patch).length)
          cleaned.push({
            type: 'update_task',
            taskId: target.id,
            taskName: target.name,
            before: target,
            patch
          });
      } else if (action?.type === 'project_note') {
        const project = String(action.project || '').trim();
        if (!project || !context.projects.includes(project)) return;
        const patch = {};
        ['progress', 'next', 'issue'].forEach((field) => {
          const text =
            typeof action.patch?.[field] === 'string' ? action.patch[field].trim().slice(0, 1000) : '';
          if (text) patch[field] = text;
        });
        if (NOTE_STATUSES.includes(action.patch?.status)) patch.status = action.patch.status;
        if (Object.keys(patch).length) cleaned.push({ type: 'project_note', project, patch });
      }
    });
    return cleaned;
  }

  async function interpret(text) {
    const context = buildContext();
    if (aiReady()) {
      try {
        const openTasks = (window.WorkBoardApp?.getTasks?.() || [])
          .filter((task) => task.status !== '완료')
          .slice(0, MAX_TASK_CONTEXT)
          .map((task) => ({
            id: task.id,
            name: task.name,
            project: task.project,
            status: task.status,
            dueDate: task.dueDate
          }));
        const data = await callAi({
          mode: 'capture',
          text,
          today: toDateInput(context.today),
          weekday: WEEKDAYS[context.today.getDay()],
          projects: context.projects,
          tasks: openTasks,
          settings: {
            defaultChannel: context.settings.defaultChannel,
            projectKeywords: context.settings.projectKeywords,
            people: context.settings.people
          }
        });
        const actions = cleanAiActions(data.actions, context);
        if (actions.length) return { actions, source: 'ai' };
      } catch (error) {
        if (String(error?.message) !== 'AI_NOT_CONNECTED')
          console.warn('AI capture failed, using built-in rules:', error);
      }
    }
    return { actions: parseLocally(text, context), source: 'rules' };
  }

  // ---------------------------------------------------------------------------
  // Applying and showing results
  // ---------------------------------------------------------------------------
  const FIELD_LABELS = {
    status: '상태',
    dueDate: '마감',
    outcome: '성과',
    progress: '진행',
    next: '다음 단계',
    issue: '이슈'
  };

  function proposalText(proposal) {
    if (proposal.type === 'update_task') {
      const parts = [];
      if (proposal.patch.status) parts.push(`상태 ${proposal.before.status} › ${proposal.patch.status}`);
      if (proposal.patch.dueDate)
        parts.push(`마감 ${proposal.before.dueDate || '없음'} › ${proposal.patch.dueDate}`);
      if (proposal.patch.outcome) parts.push('성과 기록');
      return { title: proposal.taskName, detail: parts.join(', '), kind: '기존 업무 변경' };
    }
    const parts = Object.keys(proposal.patch).map((field) =>
      field === 'status'
        ? `상태 ${proposal.patch.status}`
        : `${FIELD_LABELS[field]}: ${proposal.patch[field]}`
    );
    return { title: proposal.project, detail: parts.join(' / '), kind: '운영노트 추가' };
  }

  function applyProposal(proposal) {
    const app = window.WorkBoardApp;
    if (proposal.type === 'update_task') return Boolean(app.patchTask(proposal.taskId, proposal.patch));
    if (proposal.type === 'project_note')
      return Boolean(app.appendProjectNote(proposal.project, proposal.patch));
    return false;
  }

  function renderResult() {
    const box = $('captureResult');
    if (!box) return;
    if (!lastBatch) {
      box.innerHTML = '';
      return;
    }
    const app = window.WorkBoardApp;
    const liveTasks = new Map((app?.getTasks?.() || []).map((task) => [task.id, task]));
    const created = lastBatch.createdIds.map((id) => liveTasks.get(id)).filter(Boolean);
    const drafts = lastBatch.drafts || [];
    const rows = [];

    if (created.length) {
      rows.push(
        `<div class="cap-group-head"><span>등록한 업무 ${created.length}건</span><button type="button" class="text-link" data-capture-action="undo">되돌리기</button></div>`
      );
      created.forEach((task) => {
        const priority = app.priorityOf(task);
        rows.push(`
          <div class="cap-row">
            <button type="button" class="cap-name" data-capture-action="open" data-id="${escapeHtml(task.id)}" title="눌러서 세부 내용 수정">${escapeHtml(task.name)}</button>
            <span class="cap-meta">${escapeHtml(task.project || '미분류')}</span>
            <span class="cap-meta">${escapeHtml(task.channel)}</span>
            <span class="cap-meta">${escapeHtml(task.dueDate ? app.formatDue(task) : '마감 없음')}</span>
            <span class="score-badge ${escapeHtml(priority.cls)}">${escapeHtml(priority.text)}</span>
          </div>`);
      });
    }
    if (drafts.length) {
      rows.push(
        `<div class="cap-group-head"><span>등록 전 확인 ${drafts.length}건</span><button type="button" class="btn btn-primary cap-small-btn" data-capture-action="apply-drafts">모두 등록</button></div>`
      );
      drafts.forEach((draft, index) => {
        rows.push(`
          <div class="cap-row">
            <span class="cap-name cap-name-static">${escapeHtml(draft.name)}</span>
            <span class="cap-meta">${escapeHtml(draft.project || '미분류')}</span>
            <span class="cap-meta">${escapeHtml(draft.channel)}</span>
            <span class="cap-meta">${escapeHtml(draft.dueDate ? `${draft.dueDate} ${draft.dueTime}` : '마감 없음')}</span>
            <button type="button" class="text-link" data-capture-action="drop-draft" data-index="${index}">빼기</button>
          </div>`);
      });
    }
    if (lastBatch.proposals.length) {
      rows.push('<div class="cap-group-head"><span>확인이 필요한 변경</span></div>');
      lastBatch.proposals.forEach((proposal, index) => {
        const text = proposalText(proposal);
        rows.push(`
          <div class="cap-row cap-proposal">
            <span class="cap-kind">${escapeHtml(text.kind)}</span>
            <span class="cap-name cap-name-static">${escapeHtml(text.title)}</span>
            <span class="cap-meta cap-detail">${escapeHtml(text.detail)}</span>
            <button type="button" class="btn btn-primary cap-small-btn" data-capture-action="accept" data-index="${index}">반영</button>
            <button type="button" class="text-link" data-capture-action="dismiss" data-index="${index}">무시</button>
          </div>`);
      });
    }
    box.innerHTML = rows.join('');
  }

  function setStatus(message, tone = '') {
    const el = $('captureStatus');
    if (!el) return;
    el.textContent = message;
    el.dataset.tone = tone;
  }

  async function submit() {
    const input = $('captureInput');
    const app = window.WorkBoardApp;
    if (!input || !app || busy) return;
    const text = input.value.trim();
    if (!text) {
      setStatus('적을 내용을 먼저 입력하세요.', 'warn');
      input.focus();
      return;
    }
    busy = true;
    $('captureSubmit').disabled = true;
    setStatus(aiReady() ? 'AI가 내용을 정리하는 중…' : '정리하는 중…');
    try {
      const { actions, source } = await interpret(text);
      const creates = actions.filter((action) => action.type === 'create_task').map((action) => action.task);
      const proposals = actions.filter((action) => action.type !== 'create_task');
      if (!creates.length && !proposals.length) {
        setStatus('업무로 읽을 수 있는 내용을 찾지 못했습니다. 한 줄에 한 건씩 적어 보세요.', 'warn');
        return;
      }
      const auto = readSettings().autoApplyNew;
      const created = auto ? app.addTasks(creates) : [];
      lastBatch = { createdIds: created.map((task) => task.id), drafts: auto ? [] : creates, proposals };
      input.value = '';
      renderResult();
      const how = source === 'ai' ? 'AI 정리' : '기본 규칙으로 정리';
      const parts = [];
      if (created.length) parts.push(`업무 ${created.length}건 등록`);
      if (!auto && creates.length) parts.push(`업무 ${creates.length}건 확인 대기`);
      if (proposals.length) parts.push(`변경 ${proposals.length}건 확인 필요`);
      setStatus(`${how}: ${parts.join(', ')}`, 'ok');
    } catch (error) {
      console.error(error);
      setStatus('정리하지 못했습니다. 입력한 내용은 그대로 남아 있으니 다시 시도하세요.', 'error');
    } finally {
      busy = false;
      $('captureSubmit').disabled = false;
    }
  }

  function onResultClick(event) {
    const button = event.target?.closest?.('[data-capture-action]');
    if (!button || !lastBatch) return;
    const app = window.WorkBoardApp;
    const action = button.dataset.captureAction;
    const index = Number(button.dataset.index);
    if (action === 'undo') {
      const removed = app.removeTasks(lastBatch.createdIds);
      lastBatch.createdIds = [];
      setStatus(`등록한 업무 ${removed}건을 되돌렸습니다.`, 'ok');
    } else if (action === 'open') {
      app.openTaskDetail(button.dataset.id);
      return;
    } else if (action === 'apply-drafts') {
      const created = app.addTasks(lastBatch.drafts);
      lastBatch.createdIds = [...lastBatch.createdIds, ...created.map((task) => task.id)];
      lastBatch.drafts = [];
      setStatus(`업무 ${created.length}건 등록`, 'ok');
    } else if (action === 'drop-draft') {
      lastBatch.drafts.splice(index, 1);
    } else if (action === 'accept') {
      const ok = applyProposal(lastBatch.proposals[index]);
      lastBatch.proposals.splice(index, 1);
      setStatus(ok ? '변경을 반영했습니다.' : '대상을 찾지 못해 반영하지 못했습니다.', ok ? 'ok' : 'warn');
    } else if (action === 'dismiss') {
      lastBatch.proposals.splice(index, 1);
    }
    if (!lastBatch.createdIds.length && !lastBatch.drafts.length && !lastBatch.proposals.length)
      lastBatch = null;
    renderResult();
  }

  // ---------------------------------------------------------------------------
  // Settings modal
  // ---------------------------------------------------------------------------
  function openSettings() {
    const settings = readSettings();
    $('captureDefaultChannel').value = settings.defaultChannel;
    $('captureDefaultDueTime').value = settings.defaultDueTime;
    $('captureAutoApply').checked = settings.autoApplyNew;
    $('captureProjectKeywords').value = settings.projectKeywords;
    $('capturePeople').value = settings.people;
    $('captureAiState').textContent = window.WorkBoardCloud?.isReady?.()
      ? Date.now() < aiUnavailableUntil
        ? 'AI 연결 실패: 서버 함수가 아직 배포되지 않았거나 오류가 났습니다. 지금은 기본 규칙으로 정리합니다.'
        : 'AI 사용 가능: 로그인된 계정으로 서버에서 정리합니다.'
      : 'AI 미연결: Google 로그인 후 사용할 수 있습니다. 지금은 기본 규칙으로 정리합니다.';
    $('captureSettingsModal').classList.add('open');
  }

  function closeSettings() {
    $('captureSettingsModal').classList.remove('open');
  }

  function saveSettings() {
    writeSettings({
      defaultChannel: $('captureDefaultChannel').value,
      defaultDueTime: $('captureDefaultDueTime').value || DEFAULT_SETTINGS.defaultDueTime,
      autoApplyNew: $('captureAutoApply').checked,
      projectKeywords: $('captureProjectKeywords').value.trim().slice(0, 4000),
      people: $('capturePeople').value.trim().slice(0, 2000)
    });
    closeSettings();
    setStatus('입력 설정을 저장했습니다.', 'ok');
  }

  function init() {
    if (!$('captureInput')) return;
    $('captureSubmit').addEventListener('click', submit);
    $('captureInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        submit();
      }
    });
    $('captureResult').addEventListener('click', onResultClick);
    $('captureSettingsBtn').addEventListener('click', openSettings);
    $('captureSettingsClose').addEventListener('click', closeSettings);
    $('captureSettingsCancel').addEventListener('click', closeSettings);
    $('captureSettingsSave').addEventListener('click', saveSettings);
    $('captureSettingsModal').addEventListener('click', (event) => {
      if (event.target.id === 'captureSettingsModal') closeSettings();
    });
  }

  window.WorkBoardCapture = {
    parseLine,
    parseLocally,
    parseKeywordLines,
    readSettings,
    interpret,
    callAi,
    aiReady,
    toKoreanTime
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
