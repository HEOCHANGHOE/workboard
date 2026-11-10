// Task history: records what changed on each task save and renders timelines.
// Nothing here needs manual input. app.js calls record() from saveTasks().
(function () {
  'use strict';

  const HISTORY_KEY = 'work_task_history_v1';
  const MAX_EVENTS = 2000;
  const RECENT_PAGE_SIZE = 30;
  const LEVEL_LABELS = { 1: 'LOW', 2: 'MEDIUM', 3: 'HIGH' };

  // Fields whose old and new values are short enough to show side by side.
  const VALUE_FIELDS = [
    { key: 'name', label: '업무명' },
    { key: 'status', label: '상태' },
    { key: 'project', label: '프로젝트', empty: '미분류' },
    { key: 'channel', label: '채널' },
    { key: 'impact', label: '영향도', format: (value) => LEVEL_LABELS[Number(value)] || '' },
    { key: 'urgency', label: '긴급도', format: (value) => LEVEL_LABELS[Number(value)] || '' },
    { key: 'linkage', label: '연결도', format: (value) => LEVEL_LABELS[Number(value)] || '' },
    {
      key: 'collaborators',
      label: '협업자',
      format: (value) => (Array.isArray(value) ? value.join(', ') : String(value || ''))
    }
  ];
  // Long text fields: only the fact that they changed is recorded, not the text.
  const TEXT_FIELDS = [
    { key: 'description', label: '상세 내용' },
    { key: 'outcome', label: '성과' },
    { key: 'learning', label: '시사점' }
  ];

  let recentLimit = RECENT_PAGE_SIZE;

  const $ = (id) => document.getElementById(id);
  const pad2 = (n) => String(n).padStart(2, '0');
  const escapeHtml = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  function readEvents() {
    try {
      const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error('Task history parse error:', error);
      return [];
    }
  }

  function writeEvents(events) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(events.slice(0, MAX_EVENTS)));
  }

  function dueText(task) {
    const date = String(task?.dueDate || '').trim();
    if (!date) return '';
    const time = String(task?.dueTime || '').trim();
    return time ? `${date} ${time}` : date;
  }

  function displayValue(field, task) {
    const raw = task?.[field.key];
    const text = field.format ? field.format(raw) : String(raw ?? '').trim();
    return text || field.empty || '';
  }

  function diffTask(before, after) {
    const changes = [];
    VALUE_FIELDS.forEach((field) => {
      const from = displayValue(field, before);
      const to = displayValue(field, after);
      if (from !== to) changes.push({ field: field.label, from, to });
    });
    const dueFrom = dueText(before);
    const dueTo = dueText(after);
    if (dueFrom !== dueTo) changes.push({ field: '마감', from: dueFrom, to: dueTo });
    TEXT_FIELDS.forEach((field) => {
      const from = String(before?.[field.key] ?? '').trim();
      const to = String(after?.[field.key] ?? '').trim();
      if (from !== to) changes.push({ field: field.label, edited: true });
    });
    return changes;
  }

  function makeEvent(type, task, changes, at, index) {
    return {
      id: `hist_${Date.parse(at)}_${index}_${Math.random().toString(36).slice(2, 7)}`,
      taskId: String(task.id),
      taskName: String(task.name || '').trim(),
      project: String(task.project || '').trim(),
      type,
      changes,
      at
    };
  }

  // Compare the task list before and after a save and append one event per changed task.
  function record(previousTasks, nextTasks) {
    const previous = Array.isArray(previousTasks) ? previousTasks : [];
    const next = Array.isArray(nextTasks) ? nextTasks : [];
    const previousById = new Map(
      previous.filter((task) => task && task.id != null).map((task) => [String(task.id), task])
    );
    const nextIds = new Set(next.filter((task) => task && task.id != null).map((task) => String(task.id)));
    const at = new Date().toISOString();
    const added = [];

    next.forEach((task) => {
      if (!task || task.id == null) return;
      const before = previousById.get(String(task.id));
      if (!before) {
        added.push(makeEvent('created', task, [], at, added.length));
        return;
      }
      const changes = diffTask(before, task);
      if (changes.length) added.push(makeEvent('updated', task, changes, at, added.length));
    });
    previous.forEach((task) => {
      if (!task || task.id == null || nextIds.has(String(task.id))) return;
      added.push(makeEvent('deleted', task, [], at, added.length));
    });

    if (!added.length) return [];
    writeEvents([...added, ...readEvents()]);
    renderRecent();
    return added;
  }

  function eventsForTask(taskId) {
    const id = String(taskId);
    return readEvents().filter((event) => String(event.taskId) === id);
  }

  function formatTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function formatDay(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const weekday = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
    return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())} (${weekday})`;
  }

  function changeHtml(change) {
    if (change.edited) return `<span class="th-change">${escapeHtml(change.field)} 수정</span>`;
    const from = change.from ? escapeHtml(change.from) : '없음';
    const to = change.to ? escapeHtml(change.to) : '없음';
    return `<span class="th-change">${escapeHtml(change.field)} <span class="th-from">${from}</span><span class="th-arrow" aria-hidden="true">›</span><span class="th-to">${to}</span></span>`;
  }

  function summaryHtml(event) {
    if (event.type === 'created') return '<span class="th-change th-created">업무 등록</span>';
    if (event.type === 'deleted') return '<span class="th-change th-deleted">업무 삭제</span>';
    return (event.changes || []).map(changeHtml).join('');
  }

  // Timeline inside the task detail modal: this task only, newest first.
  function renderTaskTimeline(taskId) {
    const box = $('detailTaskHistory');
    if (!box) return;
    const events = taskId ? eventsForTask(taskId) : [];
    if (!events.length) {
      box.innerHTML =
        '<div class="th-empty">아직 기록된 변경이 없습니다. 상태나 마감을 바꾸면 여기에 쌓입니다.</div>';
      return;
    }
    box.innerHTML = events
      .map(
        (event) => `
        <div class="th-row">
          <div class="th-when">${escapeHtml(formatDay(event.at))} ${escapeHtml(formatTime(event.at))}</div>
          <div class="th-what">${summaryHtml(event)}</div>
        </div>`
      )
      .join('');
  }

  // Recent changes across all tasks, grouped by day, on the tasks page.
  function renderRecent() {
    const box = $('taskHistoryList');
    if (!box) return;
    const events = readEvents();
    const count = $('taskHistoryCount');
    if (count) count.textContent = events.length ? `${events.length}건` : '';
    if (!events.length) {
      box.innerHTML =
        '<div class="empty">아직 기록된 변경이 없습니다. 업무를 등록하거나 수정하면 자동으로 남습니다.</div>';
      return;
    }
    const visible = events.slice(0, recentLimit);
    const groups = [];
    visible.forEach((event) => {
      const day = formatDay(event.at);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.items.push(event);
      else groups.push({ day, items: [event] });
    });
    const html = groups
      .map(
        (group) => `
        <div class="th-day">${escapeHtml(group.day)}</div>
        ${group.items
          .map(
            (event) => `
          <div class="th-row th-row-wide">
            <div class="th-when">${escapeHtml(formatTime(event.at))}</div>
            <div class="th-task">
              <div class="th-task-name">${escapeHtml(event.taskName || '(이름 없음)')}</div>
              ${event.project ? `<div class="th-task-project">${escapeHtml(event.project)}</div>` : ''}
            </div>
            <div class="th-what">${summaryHtml(event)}</div>
          </div>`
          )
          .join('')}`
      )
      .join('');
    const more =
      events.length > visible.length
        ? `<button type="button" class="btn btn-secondary th-more" data-history-more>이전 기록 ${Math.min(RECENT_PAGE_SIZE, events.length - visible.length)}건 더 보기</button>`
        : '';
    box.innerHTML = html + more;
  }

  function init() {
    document.body.addEventListener('click', (event) => {
      if (!event.target?.closest?.('[data-history-more]')) return;
      recentLimit += RECENT_PAGE_SIZE;
      renderRecent();
    });
    renderRecent();
  }

  window.WorkBoardHistory = { record, eventsForTask, renderTaskTimeline, renderRecent, readEvents };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
