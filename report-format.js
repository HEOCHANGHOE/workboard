// Weekly/monthly report formatting extensions.
(function () {
  'use strict';

  const TASKS_KEY = 'work_dashboard_tasks_v1';
  const PROJECT_NOTES_KEY = 'work_project_notes_v1';
  const PROJECT_ORDER_KEY = 'work_project_order_v1';
  const WEEKLY_KEY = 'work_weekly_history_v1';
  const MONTHLY_KEY = 'work_monthly_history_v1';
  const STATUS_LIST = ['미진행', '진행중', '대기', '완료'];
  const REPORT_STATUS_LIST = ['진행중', '완료'];
  const REPORT_META_KEYS = ['collaborators', 'startedAt', 'completedAt', 'statusUpdatedAt'];
  const KOREAN_SEQ = '가나다라마바사아자차카타파하';
  const CIRCLED_NUMBERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];

  const $ = (id) => document.getElementById(id);

  function readJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '');
      return parsed == null ? fallback : parsed;
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function applyStatusMetadata(task, previousTask, nowIso) {
    if (!task || typeof task !== 'object') return task;
    const previousStatus = previousTask?.status;
    const statusChanged = previousTask && previousStatus !== task.status;
    const next = { ...task };

    REPORT_META_KEYS.forEach((key) => {
      if (!hasOwn(next, key) && previousTask && hasOwn(previousTask, key)) {
        next[key] = previousTask[key];
      }
    });

    if (statusChanged) next.statusUpdatedAt = nowIso;
    if (!previousTask && REPORT_STATUS_LIST.includes(next.status)) next.statusUpdatedAt = next.statusUpdatedAt || nowIso;

    if (next.status === '진행중' && (statusChanged || !next.startedAt)) {
      next.startedAt = nowIso;
    }
    if (next.status === '완료' && (statusChanged || !next.completedAt)) {
      next.completedAt = nowIso;
    }
    if (statusChanged && !REPORT_STATUS_LIST.includes(next.status)) {
      delete next.startedAt;
      delete next.completedAt;
    }
    if (statusChanged && previousStatus === '완료' && next.status !== '완료') {
      delete next.completedAt;
    }
    if (statusChanged && previousStatus === '진행중' && next.status !== '진행중' && next.status !== '완료') {
      delete next.startedAt;
    }

    return next;
  }

  function mergeTaskReportMetadata(nextTasks, previousTasks) {
    if (!Array.isArray(nextTasks) || !Array.isArray(previousTasks)) return nextTasks;
    const previousById = new Map(previousTasks.filter((task) => task && task.id != null).map((task) => [String(task.id), task]));
    const nowIso = new Date().toISOString();
    return nextTasks.map((task) => {
      if (!task || typeof task !== 'object' || task.id == null) return task;
      return applyStatusMetadata(task, previousById.get(String(task.id)), nowIso);
    });
  }

  function patchTaskStoragePreservation() {
    if (Storage.prototype.__workBoardReportPatch) return;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function reportSetItem(key, value) {
      if (key === TASKS_KEY) {
        try {
          const nextTasks = JSON.parse(String(value));
          const previousTasks = JSON.parse(this.getItem(TASKS_KEY) || '[]');
          value = JSON.stringify(mergeTaskReportMetadata(nextTasks, previousTasks));
        } catch (error) {
          // If the value is not the task array, leave the original write untouched.
        }
      }
      return setItem.call(this, key, value);
    };
    Storage.prototype.__workBoardReportPatch = true;
  }

  function readTasks() {
    const tasks = readJson(TASKS_KEY, []);
    return Array.isArray(tasks) ? tasks : [];
  }

  function readProjectNotes() {
    const notes = readJson(PROJECT_NOTES_KEY, {});
    return notes && typeof notes === 'object' && !Array.isArray(notes) ? notes : {};
  }

  function readProjectOrder() {
    const order = readJson(PROJECT_ORDER_KEY, []);
    return Array.isArray(order) ? order.map((item) => String(item || '').trim()).filter(Boolean) : [];
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function endOfDay(date) {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
  }

  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function getCurrentWeekRange() {
    const now = new Date();
    const base = startOfDay(now);
    const day = base.getDay();
    const mondayShift = day === 0 ? -6 : 1 - day;
    const start = addDays(base, mondayShift);
    return { start, end: endOfDay(addDays(start, 6)) };
  }

  function getCurrentMonthRange() {
    const now = new Date();
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
    };
  }

  function parseWeeklyRangeFromLabel() {
    const text = $('weeklyLabel')?.textContent || '';
    const match = text.match(/(\d{4})\.(\d{2})\.(\d{2})\s*~\s*(\d{4})\.(\d{2})\.(\d{2})/);
    if (!match) return getCurrentWeekRange();
    return {
      start: new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0),
      end: new Date(Number(match[4]), Number(match[5]) - 1, Number(match[6]), 23, 59, 59, 999)
    };
  }

  function parseMonthRangeFromLabel() {
    const text = $('monthlyLabel')?.textContent || '';
    const match = text.match(/(\d{4})년\s*(\d{1,2})월/);
    if (!match) return getCurrentMonthRange();
    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    return {
      start: new Date(year, monthIndex, 1, 0, 0, 0, 0),
      end: new Date(year, monthIndex + 1, 0, 23, 59, 59, 999)
    };
  }

  function getReportTitle(type, range) {
    if (type === 'weekly') {
      return `${range.start.getFullYear()}.${pad2(range.start.getMonth() + 1)}.${pad2(range.start.getDate())} ~ ${range.end.getFullYear()}.${pad2(range.end.getMonth() + 1)}.${pad2(range.end.getDate())}`;
    }
    return `${range.start.getFullYear()}년 ${range.start.getMonth() + 1}월`;
  }

  function getReportPeriodKey(type, range) {
    if (type === 'weekly') {
      return `${range.start.getFullYear()}-${pad2(range.start.getMonth() + 1)}-${pad2(range.start.getDate())}_${range.end.getFullYear()}-${pad2(range.end.getMonth() + 1)}-${pad2(range.end.getDate())}`;
    }
    return `${range.start.getFullYear()}-${pad2(range.start.getMonth() + 1)}`;
  }

  function parseTime(value) {
    const text = String(value || '').trim();
    const korean = text.match(/^(오전|오후)\s*(\d{1,2}):(\d{2})$/);
    if (korean) {
      let hour = Number(korean[2]);
      if (korean[1] === '오전' && hour === 12) hour = 0;
      if (korean[1] === '오후' && hour !== 12) hour += 12;
      return { hour, minute: Number(korean[3]) };
    }
    const plain = text.match(/^(\d{1,2}):(\d{2})$/);
    if (plain) return { hour: Number(plain[1]), minute: Number(plain[2]) };
    return { hour: 12, minute: 0 };
  }

  function parseDueDateTime(task) {
    const parts = String(task?.dueDate || '').split('-').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    const time = parseTime(task?.dueTime);
    return new Date(parts[0], parts[1] - 1, parts[2], time.hour, time.minute, 0, 0);
  }

  function getCreatedDate(task) {
    const date = new Date(task?.createdAt || '');
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function parseDateValue(value) {
    const date = new Date(value || '');
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function isDateWithin(date, range) {
    return Boolean(date && date >= range.start && date <= range.end);
  }

  function rangeIncludesToday(range) {
    const today = startOfDay(new Date());
    return today >= startOfDay(range.start) && today <= startOfDay(range.end);
  }

  function rangesOverlap(start, end, range) {
    return Boolean(start && end && start <= range.end && end >= range.start);
  }

  function isRelatedWithin(task, range) {
    const created = getCreatedDate(task);
    const due = parseDueDateTime(task);
    return Boolean((created && created >= range.start && created <= range.end) || (due && due >= range.start && due <= range.end));
  }

  function isReportTaskForRange(task, range) {
    const status = String(task?.status || '');
    if (!REPORT_STATUS_LIST.includes(status)) return false;

    if (status === '완료') {
      const completed = parseDateValue(task?.completedAt || task?.statusUpdatedAt);
      const started = parseDateValue(task?.startedAt);
      if (completed && isDateWithin(completed, range)) return true;
      if (started && completed) return rangesOverlap(started, completed, range);
      if (completed) return false;
      return isRelatedWithin(task, range);
    }

    const started = parseDateValue(task?.startedAt || task?.statusUpdatedAt);
    if (started) return started <= range.end;

    return isRelatedWithin(task, range) || rangeIncludesToday(range);
  }

  function dueDayDistance(task) {
    const due = parseDueDateTime(task);
    if (!due) return null;
    return Math.round((startOfDay(due) - startOfDay(new Date())) / 86400000);
  }

  function getReportStatus(task) {
    if (task?.status !== '완료') {
      const distance = dueDayDistance(task);
      if (distance != null && distance < 0) return '지연';
    }
    return STATUS_LIST.includes(task?.status) ? task.status : '미진행';
  }

  function taskSortScore(task) {
    if (task?.status === '완료') return -1;
    const distance = dueDayDistance(task);
    let score = 0;
    if (distance != null && distance < 0) score += 10;
    else if (distance === 0) score += 9;
    else if (distance === 1) score += 6;
    else if (distance != null && distance <= 3) score += 4;
    if (task?.status === '진행중') score += 2;
    if (task?.status === '대기') score += 1;
    return score;
  }

  function sortReportTasks(list) {
    return [...list].sort((a, b) => {
      const score = taskSortScore(b) - taskSortScore(a);
      if (score !== 0) return score;
      const dueA = parseDueDateTime(a)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const dueB = parseDueDateTime(b)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (dueA !== dueB) return dueA - dueB;
      return (Date.parse(b?.createdAt || '') || 0) - (Date.parse(a?.createdAt || '') || 0);
    });
  }

  function getReportTasksForRange(range) {
    return sortReportTasks(readTasks().filter((task) => isReportTaskForRange(task, range)));
  }

  function koreanMarker(index) {
    return KOREAN_SEQ[index] || `${index + 1}`;
  }

  function circledMarker(index) {
    return CIRCLED_NUMBERS[index] || `${index + 1})`;
  }

  function normalizeCollaborators(value) {
    return String(value || '')
      .replace(/^\s*\(?\s*w\/\s*/i, '')
      .replace(/\)\s*$/, '')
      .trim();
  }

  function formatCollaborators(task) {
    const name = String(task?.name || '');
    if (/\(w\/[^)]*\)/i.test(name)) return '';
    const collaborators = normalizeCollaborators(task?.collaborators);
    return collaborators ? ` (w/${collaborators})` : '';
  }

  function taskTitleLine(task) {
    return `${String(task?.name || '').trim()}${formatCollaborators(task)} [${getReportStatus(task)}]`;
  }

  function getBulletLines(task) {
    return String(task?.description || '')
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^[-•*]\s*/, ''))
      .filter(Boolean);
  }

  function getOrderedProjects(tasks) {
    const order = readProjectOrder();
    const orderIndex = new Map(order.map((name, index) => [name, index]));
    const names = Array.from(new Set(tasks.map((task) => String(task.project || '').trim() || '미분류')));
    return names.sort((a, b) => {
      const ai = orderIndex.has(a) ? orderIndex.get(a) : Number.MAX_SAFE_INTEGER;
      const bi = orderIndex.has(b) ? orderIndex.get(b) : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      if (a === '미분류') return 1;
      if (b === '미분류') return -1;
      return a.localeCompare(b, 'ko');
    });
  }

  function buildReportGroups(tasks) {
    const notes = readProjectNotes();
    const byProject = new Map();
    tasks.forEach((task) => {
      const projectName = String(task.project || '').trim() || '미분류';
      if (!byProject.has(projectName)) byProject.set(projectName, []);
      byProject.get(projectName).push(task);
    });

    const groups = [];
    const groupByLabel = new Map();
    getOrderedProjects(tasks).forEach((projectName) => {
      const note = notes[projectName] || {};
      const rawGroup = String(note.reportGroup || '').trim();
      const hasReportGroup = rawGroup && rawGroup !== projectName;
      const label = hasReportGroup ? rawGroup : projectName;
      if (!groupByLabel.has(label)) {
        const group = { label, hasReportGroup: false, projects: [] };
        groupByLabel.set(label, group);
        groups.push(group);
      }
      const group = groupByLabel.get(label);
      group.hasReportGroup = group.hasReportGroup || Boolean(hasReportGroup);
      group.projects.push({
        name: projectName,
        tasks: sortReportTasks(byProject.get(projectName) || [])
      });
    });
    return groups;
  }

  function appendTaskBullets(lines, task, indent) {
    getBulletLines(task).forEach((line) => {
      lines.push(`${indent}- ${line}`);
    });
  }

  function generateStructuredReport(tasks) {
    const relatedTasks = sortReportTasks(tasks.filter((task) => String(task?.name || '').trim()));
    const lines = ['[개인 업무 보고]', ''];
    if (!relatedTasks.length) {
      lines.push('- 해당 기간 진행중이거나 완료된 업무 없음');
      return lines.join('\n');
    }

    buildReportGroups(relatedTasks).forEach((group, groupIndex) => {
      if (groupIndex > 0) lines.push('');
      lines.push(`${groupIndex + 1}. ${group.label}`);
      if (group.hasReportGroup) {
        group.projects.forEach((project, projectIndex) => {
          lines.push(`   ${koreanMarker(projectIndex)}. ${project.name}`);
          project.tasks.forEach((task, taskIndex) => {
            lines.push(`       ${circledMarker(taskIndex)} ${taskTitleLine(task)}`);
            appendTaskBullets(lines, task, '           ');
          });
        });
      } else {
        group.projects.flatMap((project) => project.tasks).forEach((task, taskIndex) => {
          lines.push(`   ${koreanMarker(taskIndex)}. ${taskTitleLine(task)}`);
          appendTaskBullets(lines, task, '       ');
        });
      }
    });

    return lines.join('\n');
  }

  function getRangeForType(type) {
    return type === 'weekly' ? parseWeeklyRangeFromLabel() : parseMonthRangeFromLabel();
  }

  function openStructuredReportModal(type) {
    const range = getRangeForType(type);
    const title = getReportTitle(type, range);
    const periodKey = getReportPeriodKey(type, range);
    const historyKey = type === 'weekly' ? WEEKLY_KEY : MONTHLY_KEY;
    const history = readJson(historyKey, []);
    const existing = Array.isArray(history) ? history.find((item) => item?.periodKey === periodKey) : null;
    const list = getReportTasksForRange(range);

    $('reportType').value = type;
    $('reportPeriodKey').value = periodKey;
    $('reportPeriodLabel').value = title;
    $('reportModalTitle').textContent = type === 'weekly' ? '주간 리포트 작성/수정' : '월간 리포트 작성/수정';
    $('reportModalSub').textContent = existing
      ? `기존 저장본이 있어 수정 모드로 열립니다. 마지막 저장: ${existing.savedAtText}`
      : '보고 양식에 맞춰 자동 초안을 만들었습니다.';
    $('reportContent').value = existing ? existing.content : generateStructuredReport(list);
    $('reportModal').classList.add('open');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDueDisplay(task) {
    const due = parseDueDateTime(task);
    if (!due) return '-';
    return `${due.getFullYear()}.${pad2(due.getMonth() + 1)}.${pad2(due.getDate())}`;
  }

  function renderPeriodStats(targetId, list) {
    const el = $(targetId);
    if (!el) return;
    const done = list.filter((task) => task.status === '완료').length;
    const doing = list.filter((task) => task.status === '진행중').length;
    el.innerHTML = `
      <div class="report-stat"><div class="v">${list.length}</div><div class="l">전체</div></div>
      <div class="report-stat"><div class="v" style="color:var(--green)">${done}</div><div class="l">완료</div></div>
      <div class="report-stat"><div class="v" style="color:var(--blue)">${doing}</div><div class="l">진행중</div></div>
      <div class="report-stat"><div class="v" style="color:var(--purple)">0</div><div class="l">대기</div></div>`;
  }

  function renderPeriodTaskList(targetId, list) {
    const el = $(targetId);
    if (!el) return;
    if (!list.length) {
      el.innerHTML = '<div class="empty">해당 기간 진행중이거나 완료된 업무 없음</div>';
      return;
    }
    el.innerHTML = list.map((task) => `
      <div class="list-item">
        <span class="status-badge st-${escapeHtml(task.status)}">${escapeHtml(task.status)}</span>
        <div>
          <div class="task-name">${escapeHtml(task.name)}</div>
          ${task.project ? `<div class="name-subline">${escapeHtml(task.project)}</div>` : ''}
          <div class="task-meta">${escapeHtml(task.channel || '기타')} · ${escapeHtml(formatDueDisplay(task))}</div>
        </div>
      </div>`).join('');
  }

  function renderPeriodPreview(type) {
    const range = getRangeForType(type);
    const list = getReportTasksForRange(range);
    const prefix = type === 'weekly' ? 'weekly' : 'monthly';
    renderPeriodStats(`${prefix}Stats`, list);
    renderPeriodTaskList(`${prefix}Tasks`, list);
  }

  function renderAllPeriodPreviews() {
    renderPeriodPreview('weekly');
    renderPeriodPreview('monthly');
  }

  function schedulePeriodPreviewRefresh(type) {
    window.setTimeout(() => {
      if (type) renderPeriodPreview(type);
      else renderAllPeriodPreviews();
    }, 0);
  }

  function createField(id, label, placeholder) {
    const field = document.createElement('div');
    field.className = 'field';
    const labelEl = document.createElement('label');
    labelEl.className = 'label';
    labelEl.htmlFor = id;
    labelEl.textContent = label;
    const input = document.createElement('input');
    input.id = id;
    input.className = 'input';
    input.type = 'text';
    input.placeholder = placeholder;
    field.append(labelEl, input);
    return field;
  }

  function ensureCollaboratorFields() {
    if (!$('taskCollaborators')) {
      const quickProjectField = $('taskProject')?.closest('.field');
      quickProjectField?.after(createField('taskCollaborators', '협업자', '예: 서우영, 류창우'));
    }

    if (!$('detailTaskCollaborators')) {
      const detailProjectField = $('detailTaskProject')?.closest('.field');
      detailProjectField?.after(createField('detailTaskCollaborators', '협업자', '예: 서우영, 류창우'));
    }
  }

  function ensureReportGroupField() {
    if ($('projectNoteReportGroup')) return;
    const goalField = $('projectNoteGoal')?.closest('.field');
    goalField?.after(createField('projectNoteReportGroup', '보고 그룹명', '예: SW 개발 및 관리'));
  }

  function patchTaskCollaborators(taskId, taskName, collaborators) {
    if (!taskId && !String(taskName || '').trim()) return;
    const tasks = readTasks();
    const target = taskId
      ? tasks.find((task) => String(task.id) === String(taskId))
      : tasks.find((task) => String(task.name || '').trim() === String(taskName || '').trim());
    if (!target) return;
    target.collaborators = normalizeCollaborators(collaborators);
    writeJson(TASKS_KEY, tasks);
    window.WorkBoardApp?.refreshFromStorage?.();
    schedulePeriodPreviewRefresh();
  }

  function fillCollaboratorsForTask(taskId, inputId) {
    const task = readTasks().find((item) => String(item.id) === String(taskId));
    const input = $(inputId);
    if (input) input.value = normalizeCollaborators(task?.collaborators);
  }

  function patchProjectReportGroup(projectName, reportGroup) {
    const key = String(projectName || '').trim();
    if (!key) return;
    const notes = readProjectNotes();
    notes[key] = {
      ...(notes[key] || {}),
      reportGroup: String(reportGroup || '').trim(),
      updatedAt: new Date().toISOString()
    };
    writeJson(PROJECT_NOTES_KEY, notes);
    window.WorkBoardApp?.refreshFromStorage?.();
  }

  function fillProjectReportGroup(projectName) {
    const notes = readProjectNotes();
    const input = $('projectNoteReportGroup');
    if (input) input.value = String(notes[String(projectName || '').trim()]?.reportGroup || '');
  }

  function bindReportButtons() {
    $('weeklyOpenReport')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      openStructuredReportModal('weekly');
    }, true);

    $('monthlyOpenReport')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      openStructuredReportModal('monthly');
    }, true);
  }

  function bindReportPreviewRefresh() {
    $('weeklyPrev')?.addEventListener('click', () => schedulePeriodPreviewRefresh('weekly'));
    $('weeklyNext')?.addEventListener('click', () => schedulePeriodPreviewRefresh('weekly'));
    $('monthlyPrev')?.addEventListener('click', () => schedulePeriodPreviewRefresh('monthly'));
    $('monthlyNext')?.addEventListener('click', () => schedulePeriodPreviewRefresh('monthly'));
    document.querySelector('[data-tab="weekly"]')?.addEventListener('click', () => schedulePeriodPreviewRefresh('weekly'));
    document.querySelector('[data-tab="monthly"]')?.addEventListener('click', () => schedulePeriodPreviewRefresh('monthly'));
    $('saveBtn')?.addEventListener('click', () => window.setTimeout(renderAllPeriodPreviews, 90));
    $('detailModalSave')?.addEventListener('click', () => window.setTimeout(renderAllPeriodPreviews, 90));
    document.body.addEventListener('change', (event) => {
      if (event.target?.dataset?.action === 'status-select') {
        window.setTimeout(renderAllPeriodPreviews, 30);
      }
    });
  }

  function bindPersistenceHooks() {
    $('saveBtn')?.addEventListener('click', () => {
      const taskId = $('editId')?.value || '';
      const taskName = $('taskName')?.value || '';
      const collaborators = $('taskCollaborators')?.value || '';
      window.setTimeout(() => patchTaskCollaborators(taskId, taskName, collaborators), 60);
    }, true);

    $('resetBtn')?.addEventListener('click', () => {
      window.setTimeout(() => {
        if ($('taskCollaborators')) $('taskCollaborators').value = '';
      }, 0);
    });

    $('detailModalSave')?.addEventListener('click', () => {
      const taskId = $('detailTaskId')?.value || '';
      const collaborators = $('detailTaskCollaborators')?.value || '';
      window.setTimeout(() => patchTaskCollaborators(taskId, '', collaborators), 60);
    }, true);

    $('projectNoteSave')?.addEventListener('click', () => {
      const projectName = $('projectNoteName')?.value || '';
      const reportGroup = $('projectNoteReportGroup')?.value || '';
      window.setTimeout(() => patchProjectReportGroup(projectName, reportGroup), 90);
    }, true);

    document.body.addEventListener('click', (event) => {
      const actionEl = event.target?.closest?.('[data-action]');
      const action = actionEl?.dataset?.action;
      if (action === 'open-detail') {
        const taskId = actionEl.dataset.id || '';
        window.setTimeout(() => fillCollaboratorsForTask(taskId, 'detailTaskCollaborators'), 0);
      }
      if (action === 'edit') {
        const taskId = actionEl.dataset.id || '';
        window.setTimeout(() => fillCollaboratorsForTask(taskId, 'taskCollaborators'), 0);
      }
      if (action === 'open-project-note') {
        const projectName = actionEl.dataset.project || '';
        window.setTimeout(() => fillProjectReportGroup(projectName), 0);
      }
    }, true);
  }

  function init() {
    patchTaskStoragePreservation();
    ensureCollaboratorFields();
    ensureReportGroupField();
    bindReportButtons();
    bindReportPreviewRefresh();
    bindPersistenceHooks();
    schedulePeriodPreviewRefresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
