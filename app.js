// ============================================================
// Main app and work-management logic
// ============================================================
// Main app script: storage, rendering, charts, and event binding.
(function () {  'use strict';  const STORAGE_KEY = 'work_dashboard_tasks_v1';  const WEEKLY_KEY = 'work_weekly_history_v1';  const MONTHLY_KEY = 'work_monthly_history_v1';  const PROJECT_ORDER_KEY = 'work_project_order_v1';  const PROJECT_COLLAPSE_KEY = 'work_project_collapse_v1';  const STATUS_LIST = ['미진행', '진행중', '대기', '완료'];  const CHANNEL_LIST = ['웍스', '메일', '전화', '회의', '구두', '기타'];  const STATUS_COLORS = {    '완료': '#34c759',    '진행중': '#007aff',    '대기': '#af52de',    '미진행': '#8e8e93'  };  const CHANNEL_COLORS = ['#007aff', '#34c759', '#ff9500', '#af52de', '#5ac8fa', '#8e8e93'];  let tasks = [];  let weeklyHistory = [];  let monthlyHistory = [];  let projectOrder = [];  let selectedPriority = '중';  const ACTIVE_TAB_KEY = 'work_board_active_tab';  let currentTab = 'home';  let taskFilterStatus = '전체';  let currentPage = 1;  let rowsPerPage = 10;  let projectFilter = '전체';  let weeklyOffset = 0;  let monthlyOffset = 0;  let dueAmpm = '오전';  let statusChartWindow = 'day';  let channelChartWindow = 'week';  let trendChartWindow = '7d';  const expandedWeeklyReports = new Set();  const expandedMonthlyReports = new Set();  const collapsedProjectGroups = new Set();  const $ = (id) => document.getElementById(id);  const escapeHtml = (value) => String(value ?? '')    .replace(/&/g, '&amp;')    .replace(/</g, '&lt;')    .replace(/>/g, '&gt;')    .replace(/"/g, '&quot;')    .replace(/'/g, '&#39;');  function safeArrayParse(raw) {    if (!raw) return [];    try {      const parsed = JSON.parse(raw);      return Array.isArray(parsed) ? parsed : [];    } catch (error) {      console.error('JSON parse error:', error);      return [];    }  }  function pad2(n) { return String(n).padStart(2, '0'); }  function startOfDay(date) {    const d = new Date(date);    d.setHours(0, 0, 0, 0);    return d;  }  function endOfDay(date) {    const d = new Date(date);    d.setHours(23, 59, 59, 999);    return d;  }  function addDays(date, days) {    const d = new Date(date);    d.setDate(d.getDate() + days);    return d;  }  function getWeekRange(offset = 0) {    const now = new Date();    const base = startOfDay(now);    const day = base.getDay();    const mondayShift = day === 0 ? -6 : 1 - day;    const start = addDays(base, mondayShift + offset * 7);    const end = endOfDay(addDays(start, 6));    return { start, end };  }  function getMonthRange(offset = 0) {    const now = new Date();    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1, 0, 0, 0, 0);    const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0, 23, 59, 59, 999);    return { start, end };  }  function parseKoreanTime(timeStr) {    if (!timeStr || typeof timeStr !== 'string') return { hour: 12, minute: 0 };    const trimmed = timeStr.trim();    const m = trimmed.match(/^(오전|오후)\s*(\d{1,2}):(\d{2})$/);    if (m) {      let hour = Number(m[2]);      const minute = Number(m[3]);      if (m[1] === '오전') {        if (hour === 12) hour = 0;      } else {        if (hour !== 12) hour += 12;      }      return { hour, minute };    }    const m2 = trimmed.match(/^(\d{1,2}):(\d{2})$/);    if (m2) {      return { hour: Number(m2[1]), minute: Number(m2[2]) };    }    return { hour: 12, minute: 0 };  }  function toKoreanTime(date) {    const h = date.getHours();    const ap = h >= 12 ? '오후' : '오전';    const hh = h % 12 || 12;    return `${ap} ${pad2(hh)}:${pad2(date.getMinutes())}`;  }  function parseDueDateTime(dueDate, dueTime) {    if (!dueDate) return null;    const parts = String(dueDate).split('-').map(Number);    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;    const t = parseKoreanTime(dueTime);    return new Date(parts[0], parts[1] - 1, parts[2], t.hour, t.minute, 0, 0);  }  function formatDueDisplay(task) {    const d = parseDueDateTime(task.dueDate, task.dueTime);    if (!d) return '-';    return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())} ${toKoreanTime(d)}`;  }  function normalizeTask(raw, index) {    const created = raw && raw.createdAt ? new Date(raw.createdAt) : new Date();    const createdAt = Number.isNaN(created.getTime()) ? new Date().toISOString() : created.toISOString();    const priority = ['상', '중', '하'].includes(raw?.priority) ? raw.priority : '중';    const normalizedStatus = raw?.status === '미착수' ? '미진행' : raw?.status;
    const status = STATUS_LIST.includes(normalizedStatus) ? normalizedStatus : '미진행';    const channel = CHANNEL_LIST.includes(raw?.channel) ? raw.channel : '기타';    const toPriorityLevel = (value, fallback) => { const n = Number(value); return [1,2,3].includes(n) ? n : fallback; };    const fallbackImpact = priority === '상' ? 3 : priority === '중' ? 2 : 1;    const fallbackUrgency = priority === '상' ? 3 : priority === '중' ? 2 : 1;    const fallbackLinkage = priority === '상' ? 2 : 1;    return {      id: raw?.id ? String(raw.id) : `task_${Date.now()}_${index}`,      name: String(raw?.name ?? '').trim(),      channel,      dueDate: typeof raw?.dueDate === 'string' ? raw.dueDate : '',      dueTime: typeof raw?.dueTime === 'string' ? raw.dueTime : '',      priority,      status,      project: typeof raw?.project === 'string' ? raw.project : '',      description: typeof raw?.description === 'string' ? raw.description : '',      outcome: typeof raw?.outcome === 'string' ? raw.outcome : '',      learning: typeof raw?.learning === 'string' ? raw.learning : '',      impact: toPriorityLevel(raw?.impact, fallbackImpact),      urgency: toPriorityLevel(raw?.urgency, fallbackUrgency),      linkage: toPriorityLevel(raw?.linkage, fallbackLinkage),      createdAt    };  }  function normalizeReport(raw, index, type) {    const savedAt = raw?.savedAt ? new Date(raw.savedAt) : new Date();    const safeSavedAt = Number.isNaN(savedAt.getTime()) ? new Date().toISOString() : savedAt.toISOString();    return {      id: raw?.id ? String(raw.id) : `${type}_${Date.now()}_${index}`,      periodKey: String(raw?.periodKey ?? ''),      title: String(raw?.title ?? ''),      content: String(raw?.content ?? ''),      savedAt: safeSavedAt,      savedAtText: raw?.savedAtText ? String(raw.savedAtText) : new Date(safeSavedAt).toLocaleString('ko-KR')    };  }  function loadStorage() {    collapsedProjectGroups.clear();    tasks = safeArrayParse(localStorage.getItem(STORAGE_KEY))      .map(normalizeTask)      .filter((task) => task.name);    weeklyHistory = safeArrayParse(localStorage.getItem(WEEKLY_KEY)).map((item, index) => normalizeReport(item, index, 'weekly'));    monthlyHistory = safeArrayParse(localStorage.getItem(MONTHLY_KEY)).map((item, index) => normalizeReport(item, index, 'monthly'));    projectOrder = safeArrayParse(localStorage.getItem(PROJECT_ORDER_KEY)).map((item) => String(item || '').trim()).filter(Boolean);    safeArrayParse(localStorage.getItem(PROJECT_COLLAPSE_KEY)).map((item) => String(item || '').trim()).filter(Boolean).forEach((name) => collapsedProjectGroups.add(name));    syncProjectOrder();  }  function saveTasks() {    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));    syncProjectOrder();  }  function saveWeeklyHistory() {    localStorage.setItem(WEEKLY_KEY, JSON.stringify(weeklyHistory));  }  function saveMonthlyHistory() {    localStorage.setItem(MONTHLY_KEY, JSON.stringify(monthlyHistory));  }  function saveProjectOrder() {    localStorage.setItem(PROJECT_ORDER_KEY, JSON.stringify(projectOrder));  }  function saveCollapsedProjectGroups() {    localStorage.setItem(PROJECT_COLLAPSE_KEY, JSON.stringify(Array.from(collapsedProjectGroups)));  }  function getDistinctProjectNames() {    return Array.from(new Set(tasks.map((task) => String(task.project || '').trim()).filter(Boolean)));  }  function syncProjectOrder() {    const names = getDistinctProjectNames();    projectOrder = projectOrder.filter((name) => names.includes(name));    names.forEach((name) => { if (!projectOrder.includes(name)) projectOrder.push(name); });    saveProjectOrder();  }  function getOrderedProjectGroups(groupMap) {    const names = Object.keys(groupMap);    const orderedNamed = projectOrder.filter((name) => names.includes(name));    names.filter((name) => name !== '__unassigned__' && !orderedNamed.includes(name)).sort((a,b)=>a.localeCompare(b,'ko')).forEach((name) => orderedNamed.push(name));    if (names.includes('__unassigned__')) orderedNamed.push('__unassigned__');    return orderedNamed.map((name) => [name, groupMap[name]]);  }  function moveProjectOrder(projectName, direction) {    if (!projectName || projectName === '__unassigned__') return;    syncProjectOrder();    const index = projectOrder.indexOf(projectName);    if (index < 0) return;    const target = direction === 'up' ? index - 1 : index + 1;    if (target < 0 || target >= projectOrder.length) return;    const swap = projectOrder[target];    projectOrder[target] = projectName;    projectOrder[index] = swap;    saveProjectOrder();    renderTaskTable();  }  function renameProject(currentName) {    if (!currentName || currentName === '__unassigned__') return;    const nextName = prompt('변경할 프로젝트 명칭을 입력하세요.', currentName);    if (nextName == null) return;    const trimmed = String(nextName).trim();    if (!trimmed || trimmed === currentName) return;    tasks.forEach((task) => { if (String(task.project || '').trim() === currentName) task.project = trimmed; });    projectOrder = projectOrder.map((name) => name === currentName ? trimmed : name).filter((name, index, arr) => arr.indexOf(name) === index);    if (collapsedProjectGroups.has(currentName)) { collapsedProjectGroups.delete(currentName); collapsedProjectGroups.add(trimmed); }    saveTasks();    saveCollapsedProjectGroups();    refreshProjectFilterOptions();    renderProjectSelectOptions();    renderAll();  }  function toggleProjectGroup(projectName) {    if (!projectName) return;    if (collapsedProjectGroups.has(projectName)) collapsedProjectGroups.delete(projectName); else collapsedProjectGroups.add(projectName);    saveCollapsedProjectGroups();    renderTaskTable();  }  function renderProjectSelectOptions(selectedProject = '', keepInput = '') {    const select = $('detailTaskProjectSelect');    if (!select) return;    syncProjectOrder();    const currentInput = typeof keepInput === 'string' ? keepInput : ($('detailTaskProject')?.value || '');    const orderedProjects = projectOrder.slice();    select.innerHTML = `<option value="__new__">새로 입력</option>${orderedProjects.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}`;    const normalizedSelected = String(selectedProject || '').trim();    if (normalizedSelected && orderedProjects.includes(normalizedSelected)) select.value = normalizedSelected;    else select.value = '__new__';    if ($('detailTaskProject')) $('detailTaskProject').value = normalizedSelected || currentInput || '';  }  function isCreatedWithin(task, start, end) {    const d = new Date(task.createdAt);    return !Number.isNaN(d.getTime()) && d >= start && d <= end;  }  function isDueWithin(task, start, end) {    const d = parseDueDateTime(task.dueDate, task.dueTime);    return !!d && d >= start && d <= end;  }  function isRelatedWithin(task, start, end) {    return isCreatedWithin(task, start, end) || isDueWithin(task, start, end);  }  function isOverdue(task) {    if (task.status === '완료') return false;    const d = parseDueDateTime(task.dueDate, task.dueTime);    return !!d && d.getTime() < Date.now();  }  function isDueSoon(task) {    if (task.status === '완료') return false;    const d = parseDueDateTime(task.dueDate, task.dueTime);    if (!d) return false;    const now = new Date();    const threshold = addDays(now, 3);    return d >= now && d <= threshold;  }  function urgencyGroup(task) {    if (task.status === '완료') return 4;    if (isOverdue(task)) return 0;    if (isDueSoon(task)) return 1;    const due = parseDueDateTime(task.dueDate, task.dueTime);    return due ? 2 : 3;  }  function getPriorityInputs(task) {    const impact = [1,2,3].includes(Number(task?.impact)) ? Number(task.impact) : (task?.priority === '상' ? 3 : task?.priority === '하' ? 1 : 2);    const urgency = [1,2,3].includes(Number(task?.urgency)) ? Number(task.urgency) : (task?.priority === '상' ? 3 : task?.priority === '하' ? 1 : 2);    const linkage = [1,2,3].includes(Number(task?.linkage)) ? Number(task.linkage) : (task?.priority === '상' ? 2 : 1);    return { impact, urgency, linkage };  }  function getPriorityScore(task) {    const { impact, urgency, linkage } = getPriorityInputs(task);    return impact + urgency + linkage;  }  function getPriorityBadge(score) {    if (score >= 8) return { cls: 'score-critical', label: 'CRITICAL' };    if (score >= 6) return { cls: 'score-urgent', label: 'HIGH' };    if (score >= 4) return { cls: 'score-watch', label: 'MEDIUM' };    return { cls: 'score-low', label: 'LOW' };  }  function getPriorityDisplay(task) {    const score = getPriorityScore(task);    const badge = getPriorityBadge(score);    return { score, label: badge.label, cls: badge.cls, text: `${badge.label} · ${score}` };  }  function calcScore(task) {    if (task.status === '완료') return -1;    const priorityScore = getPriorityScore(task);    let todayWeight = 0;    if (isOverdue(task)) todayWeight += 3;    else if (isDueSoon(task)) todayWeight += 2;    else if (parseDueDateTime(task.dueDate, task.dueTime)) todayWeight += 1;    if (task.status === '진행중') todayWeight += 1;    return priorityScore + todayWeight;  }  function sortTasks(list) {    return [...list].sort((a, b) => {      const scoreDiff = calcScore(b) - calcScore(a);      if (scoreDiff !== 0) return scoreDiff;      const priorityDiff = getPriorityScore(b) - getPriorityScore(a);      if (priorityDiff !== 0) return priorityDiff;      const da = parseDueDateTime(a.dueDate, a.dueTime)?.getTime() ?? Number.MAX_SAFE_INTEGER;      const db = parseDueDateTime(b.dueDate, b.dueTime)?.getTime() ?? Number.MAX_SAFE_INTEGER;      if (da !== db) return da - db;      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();    });  }  function fillTimeSelectorsFromDue(hour24, minute) {
    const safeHour = Number.isFinite(Number(hour24)) ? Number(hour24) : 9;
    const safeMinute = Number.isFinite(Number(minute)) ? Number(minute) : 0;
    dueAmpm = safeHour >= 12 ? '오후' : '오전';
    let hour12 = safeHour % 12;
    if (hour12 === 0) hour12 = 12;
    $('taskHour').value = pad2(hour12);
    $('taskMinute').value = pad2(safeMinute);
    renderAmpmButton();
  }
  function renderAmpmButton() {
    const btn = $('taskAmpm');
    btn.textContent = dueAmpm;
    btn.classList.remove('active-am', 'active-pm');
    btn.classList.add(dueAmpm === '오전' ? 'active-am' : 'active-pm');
    btn.setAttribute('aria-pressed', 'true');
  }
  function initTimeOptions() {
    const hourSelect = $('taskHour');
    const minuteSelect = $('taskMinute');
    hourSelect.innerHTML = Array.from({ length: 12 }, (_, i) => {
      const h = i + 1;
      return `<option value="${pad2(h)}">${pad2(h)}</option>`;
    }).join('');
    minuteSelect.innerHTML = Array.from({ length: 4 }, (_, i) => {
      const m = i * 15;
      return `<option value="${pad2(m)}">${pad2(m)}</option>`;
    }).join('');
    const now = new Date();
    const roundedMinute = Math.floor(now.getMinutes() / 15) * 15;
    fillTimeSelectorsFromDue(now.getHours(), roundedMinute);
  }
  function updateTaskFormPriorityPreview() {    const tempTask = {      impact: Number($('taskImpact')?.value || 2),      urgency: Number($('taskUrgency')?.value || 2),      linkage: Number($('taskLinkage')?.value || 1)    };    const priority = getPriorityDisplay(tempTask);    if ($('taskPriorityPreview')) $('taskPriorityPreview').value = priority.text;  }  function setTaskPriorityInputs(task) {    const inputs = getPriorityInputs(task);    if ($('taskImpact')) $('taskImpact').value = String(inputs.impact);    if ($('taskUrgency')) $('taskUrgency').value = String(inputs.urgency);    if ($('taskLinkage')) $('taskLinkage').value = String(inputs.linkage);    updateTaskFormPriorityPreview();  }  function resetForm() {    $('editId').value = '';    $('taskName').value = '';    $('taskChannel').value = '웍스';    $('taskStatus').value = '미진행';    $('taskDesc').value = '';    $('taskDueDate').value = '';    const now = new Date();    fillTimeSelectorsFromDue(now.getHours(), Math.floor(now.getMinutes() / 15) * 15);    setTaskPriorityInputs({ impact: 2, urgency: 2, linkage: 1 });    $('saveBtn').textContent = '업무 저장';  }  function fillForm(task) {    $('editId').value = task.id;    $('taskName').value = task.name;    $('taskChannel').value = task.channel;    $('taskStatus').value = task.status;    $('taskDesc').value = task.description || '';    $('taskDueDate').value = task.dueDate || '';    const due = parseDueDateTime(task.dueDate, task.dueTime);    if (due) fillTimeSelectorsFromDue(due.getHours(), due.getMinutes());    setTaskPriorityInputs(task);    $('saveBtn').textContent = '수정 저장';    setTab('home');    window.scrollTo({ top: 0, behavior: 'smooth' });  }  function getFormDueTimeValue() {
    const hour12 = Number($('taskHour').value || '12');
    const minute = $('taskMinute').value || '00';
    let hour24 = hour12 % 12;
    if (dueAmpm === '오후') hour24 += 12;
    return `${pad2(hour24)}:${minute}`;
  }  function upsertTaskFromForm() {    const name = $('taskName').value.trim();    if (!name) {      $('taskName').focus();      return;    }    const editId = $('editId').value;    const task = {      id: editId || `task_${Date.now()}`,      name,      channel: $('taskChannel').value,      dueDate: $('taskDueDate').value || '',      dueTime: getFormDueTimeValue(),      impact: Number($('taskImpact')?.value || 2),      urgency: Number($('taskUrgency')?.value || 2),      linkage: Number($('taskLinkage')?.value || 1),      priority: tasks.find((item) => item.id === editId)?.priority || '중',      status: $('taskStatus').value,      description: $('taskDesc').value.trim(),      project: tasks.find((item) => item.id === editId)?.project || '',      role: tasks.find((item) => item.id === editId)?.role || '',      skillTags: tasks.find((item) => item.id === editId)?.skillTags || '',      outcome: tasks.find((item) => item.id === editId)?.outcome || '',      learning: tasks.find((item) => item.id === editId)?.learning || '',      createdAt: editId        ? (tasks.find((item) => item.id === editId)?.createdAt || new Date().toISOString())        : new Date().toISOString()    };    const index = tasks.findIndex((item) => item.id === task.id);    if (index >= 0) tasks[index] = task;    else tasks.unshift(task);    saveTasks();    refreshProjectFilterOptions();    renderProjectSelectOptions();    resetForm();    renderAll();
    setTimeout(() => { document.querySelectorAll('.today-status-select, .inline-select[data-action="status-select"]').forEach(styleStatusSelect); }, 30);  }  function updateTaskStatus(taskId, status) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    task.status = STATUS_LIST.includes(status) ? status : task.status;
    saveTasks();
    renderAll();
    setTimeout(() => { document.querySelectorAll('.today-status-select, .inline-select[data-action="status-select"]').forEach(styleStatusSelect); }, 30);
  }  function deleteTask(taskId) {    if (!confirm('삭제하시겠습니까?')) return;    tasks = tasks.filter((item) => item.id !== taskId);    saveTasks();    refreshProjectFilterOptions();    renderProjectSelectOptions();    renderAll();  }  function updateDetailPriorityResult() {    const tempTask = {      impact: Number($('detailTaskImpact')?.value || 2),      urgency: Number($('detailTaskUrgency')?.value || 2),      linkage: Number($('detailTaskLinkage')?.value || 1)    };    const priority = getPriorityDisplay(tempTask);    if ($('detailTaskPriorityResult')) $('detailTaskPriorityResult').value = priority.text;  }  function openTaskDetailModal(taskId) {    const task = tasks.find((item) => item.id === taskId);    if (!task) return;    const inputs = getPriorityInputs(task);    $('detailTaskId').value = task.id;    $('detailTaskName').value = task.name;    $('detailTaskChannel').value = task.channel || '웍스';    $('detailTaskStatus').value = task.status || '미진행';    $('detailTaskDueDate').value = task.dueDate || '';    $('detailTaskDueTime').value = task.dueTime || '';    $('detailTaskImpact').value = String(inputs.impact);    $('detailTaskUrgency').value = String(inputs.urgency);    $('detailTaskLinkage').value = String(inputs.linkage);    renderProjectSelectOptions(task.project || '', task.project || '');    $('detailTaskDesc').value = task.description || '';    $('detailTaskOutcome').value = task.outcome || '';    $('detailTaskLearning').value = task.learning || '';    updateDetailPriorityResult();    $('detailModalSub').textContent = `${task.channel} · ${formatDueDisplay(task)}`;    $('detailModal').classList.add('open');  }  function closeTaskDetailModal() {    $('detailModal').classList.remove('open');    $('detailTaskId').value = '';    $('detailTaskName').value = '';    $('detailTaskChannel').value = '웍스';    $('detailTaskStatus').value = '미진행';    $('detailTaskDueDate').value = '';    $('detailTaskDueTime').value = '';    $('detailTaskImpact').value = '2';    $('detailTaskUrgency').value = '2';    $('detailTaskLinkage').value = '1';    renderProjectSelectOptions('', '');    $('detailTaskDesc').value = '';    $('detailTaskOutcome').value = '';    $('detailTaskLearning').value = '';    updateDetailPriorityResult();  }  function saveTaskDetailModal() {    const taskId = $('detailTaskId').value;    const task = tasks.find((item) => item.id === taskId);    if (!task) return;    task.name = $('detailTaskName').value.trim() || task.name;    task.channel = $('detailTaskChannel').value;    task.status = $('detailTaskStatus').value;    task.dueDate = $('detailTaskDueDate').value || '';    task.dueTime = $('detailTaskDueTime').value || '';    task.project = $('detailTaskProject').value.trim();    task.description = $('detailTaskDesc').value.trim();    task.outcome = $('detailTaskOutcome').value.trim();    task.learning = $('detailTaskLearning').value.trim();    task.impact = Number($('detailTaskImpact').value || 2);    task.urgency = Number($('detailTaskUrgency').value || 2);    task.linkage = Number($('detailTaskLinkage').value || 1);    task.priority = task.impact >= 3 || task.urgency >= 3 ? '상' : getPriorityScore(task) >= 6 ? '중' : '하';    syncProjectOrder();    saveTasks();    refreshProjectFilterOptions();    renderProjectSelectOptions(task.project || '', task.project || '');    closeTaskDetailModal();    renderAll();  }  function getReportTitle(type, range) {    if (type === 'weekly') {      return `${range.start.getFullYear()}.${pad2(range.start.getMonth() + 1)}.${pad2(range.start.getDate())} ~ ${range.end.getFullYear()}.${pad2(range.end.getMonth() + 1)}.${pad2(range.end.getDate())}`;    }    return `${range.start.getFullYear()}년 ${range.start.getMonth() + 1}월`;  }  function getReportPeriodKey(type, range) {    if (type === 'weekly') {      return `${range.start.getFullYear()}-${pad2(range.start.getMonth() + 1)}-${pad2(range.start.getDate())}_${range.end.getFullYear()}-${pad2(range.end.getMonth() + 1)}-${pad2(range.end.getDate())}`;    }    return `${range.start.getFullYear()}-${pad2(range.start.getMonth() + 1)}`;  }  function generateTaskLineContent(list) {    if (!list.length) return '';    return list.map((task, index) => `${index + 1}. ${task.name} [${task.status}]`).join('\n');  }  function openReportModal(type) {    const range = type === 'weekly' ? getWeekRange(weeklyOffset) : getMonthRange(monthlyOffset);    const title = getReportTitle(type, range);    const periodKey = getReportPeriodKey(type, range);    const list = sortTasks(tasks.filter((task) => isRelatedWithin(task, range.start, range.end)));    const history = type === 'weekly' ? weeklyHistory : monthlyHistory;    const existing = history.find((item) => item.periodKey === periodKey);    $('reportType').value = type;    $('reportPeriodKey').value = periodKey;    $('reportPeriodLabel').value = title;    $('reportModalTitle').textContent = type === 'weekly' ? '주간 리포트 작성/수정' : '월간 리포트 작성/수정';    $('reportModalSub').textContent = existing      ? `기존 저장본이 있어 수정 모드로 열립니다. 마지막 저장: ${existing.savedAtText}`      : '새 리포트를 작성합니다.';    $('reportContent').value = existing ? existing.content : generateTaskLineContent(list);    $('reportModal').classList.add('open');  }  function closeReportModal() {    $('reportModal').classList.remove('open');    $('reportType').value = '';    $('reportPeriodKey').value = '';    $('reportPeriodLabel').value = '';    $('reportContent').value = '';  }  function saveReportModal() {    const type = $('reportType').value;    const periodKey = $('reportPeriodKey').value;    const title = $('reportPeriodLabel').value;    const content = $('reportContent').value.trim();    if (!type || !periodKey) return;    if (!content) {      alert('내용을 입력해 주세요.');      $('reportContent').focus();      return;    }    const now = new Date();    const savedAt = now.toISOString();    const savedAtText = now.toLocaleString('ko-KR');    const isWeekly = type === 'weekly';    const history = isWeekly ? weeklyHistory : monthlyHistory;    const saveHistory = isWeekly ? saveWeeklyHistory : saveMonthlyHistory;    const label = isWeekly ? '주간 리포트' : '월간 리포트';    const existingIndex = history.findIndex((item) => item.periodKey === periodKey);    if (existingIndex >= 0) {      const existing = history[existingIndex];      if (existing.content.trim() === content) {        alert('변경 내용이 없습니다');        return;      }      history[existingIndex] = {        ...existing,        title,        content,        savedAt,        savedAtText      };      saveHistory();      closeReportModal();      renderAll();      alert(`${label}가 업데이트 되었습니다`);      return;    }    history.unshift({      id: `${type}_${Date.now()}`,      periodKey,      title,      content,      savedAt,      savedAtText    });    saveHistory();    closeReportModal();    renderAll();    alert(`${label}가 저장되었습니다`);  }  function deleteReport(type, reportId) {    if (!confirm('삭제하시겠습니까?')) return;    if (type === 'weekly') {      weeklyHistory = weeklyHistory.filter((item) => item.id !== reportId);      expandedWeeklyReports.delete(reportId);      saveWeeklyHistory();      renderWeeklyPage();      return;    }    monthlyHistory = monthlyHistory.filter((item) => item.id !== reportId);    expandedMonthlyReports.delete(reportId);    saveMonthlyHistory();    renderMonthlyPage();    renderCareerOverview();  }  function toggleReportExpand(type, reportId) {    const targetSet = type === 'weekly' ? expandedWeeklyReports : expandedMonthlyReports;    if (targetSet.has(reportId)) targetSet.delete(reportId);    else targetSet.add(reportId);    if (type === 'weekly') renderWeeklyHistory();    else renderMonthlyHistory();  }  function renderSimpleList(containerId, list, kind) {
    const el = $(containerId);
    if (!el) return;
    if (!list.length) {
      el.innerHTML = '<div class="empty">데이터 없음</div>';
      return;
    }
    el.innerHTML = list.map((task) => {
      if (kind === 'alert') {
        const due = parseDueDateTime(task.dueDate, task.dueTime);
        const diff = due ? Math.floor((startOfDay(due) - startOfDay(new Date())) / 86400000) : null;
        let badgeClass = 'mini-blue';
        let badgeLabel = 'N/A';
        if (diff === 0) badgeLabel = 'D-DAY';
        else if (diff < 0) { badgeClass = 'mini-red'; badgeLabel = `D+${Math.abs(diff)}`; }
        else if (diff > 0) { badgeClass = 'mini-orange'; badgeLabel = `D-${diff}`; }
        return `
          <div class="list-item">
            <span class="mini-badge ${badgeClass}">${escapeHtml(badgeLabel)}</span>
            <div style="min-width:0">
              <div class="task-name">${escapeHtml(task.name)}</div>
              <div class="task-meta">${escapeHtml(task.channel)} · ${escapeHtml(formatDueDisplay(task))}</div>
            </div>
            <span class="status-badge st-${escapeHtml(task.status)}">${escapeHtml(task.status)}</span>
          </div>`;
      }

      const priority = getPriorityDisplay(task);
      return `
        <div class="list-item">
          <span class="score-badge ${priority.cls}">${escapeHtml(priority.label)}</span>
          <div style="min-width:0">
            <div class="task-name">${escapeHtml(task.name)}</div>
            <div class="task-meta">${escapeHtml(task.channel)} · ${escapeHtml(formatDueDisplay(task))} · ${escapeHtml(priority.text)}</div>
          </div>
          <select class="status-badge today-status-select st-${escapeHtml(task.status)}" data-action="status-select" data-id="${escapeHtml(task.id)}">
            ${STATUS_LIST.map((status) => `<option value="${escapeHtml(status)}" ${task.status === status ? 'selected' : ''}>${escapeHtml(status)}</option>`).join('')}
          </select>
        </div>`;
    }).join('');
    setTimeout(() => { document.querySelectorAll('.today-status-select').forEach(styleStatusSelect); }, 20);
  }
  function renderKPIs() {    const weekRange = getWeekRange(0);    const monthRange = getMonthRange(0);    $('kpiTotal').textContent = String(tasks.length);    $('kpiWeekRelated').textContent = String(tasks.filter((task) => isRelatedWithin(task, weekRange.start, weekRange.end)).length);    $('kpiMonthRelated').textContent = String(tasks.filter((task) => isRelatedWithin(task, monthRange.start, monthRange.end)).length);    $('kpiDone').textContent = String(tasks.filter((task) => task.status === '완료').length);    $('kpiDoing').textContent = String(tasks.filter((task) => task.status === '진행중').length);    $('kpiTodo').textContent = String(tasks.filter((task) => task.status === '미진행').length);    $('kpiHold').textContent = String(tasks.filter((task) => task.status === '대기').length);    $('kpiDueSoon').textContent = String(tasks.filter(isDueSoon).length);  }  function getTaskCreatedDate(task) {    const d = new Date(task.createdAt);    return Number.isNaN(d.getTime()) ? null : d;  }  function filterTasksByCreatedWindow(windowKey) {    const now = new Date();    if (windowKey === 'total') return tasks.slice();    if (windowKey === 'day') {      const start = startOfDay(now);      const end = endOfDay(now);      return tasks.filter((task) => {        const d = getTaskCreatedDate(task);        return d && d >= start && d <= end;      });    }    if (windowKey === 'week') {      const start = startOfDay(addDays(now, -6));      const end = endOfDay(now);      return tasks.filter((task) => {        const d = getTaskCreatedDate(task);        return d && d >= start && d <= end;      });    }    if (windowKey === 'month') {      const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);      const end = endOfDay(now);      return tasks.filter((task) => {        const d = getTaskCreatedDate(task);        return d && d >= start && d <= end;      });    }    return tasks.slice();  }  function bindChartTabs() {    document.querySelectorAll('[data-status-chart]').forEach((btn) => {      btn.addEventListener('click', () => {        statusChartWindow = btn.dataset.statusChart;        document.querySelectorAll('[data-status-chart]').forEach((item) => item.classList.toggle('active', item === btn));        renderStatusChart();      });    });    document.querySelectorAll('[data-channel-chart]').forEach((btn) => {      btn.addEventListener('click', () => {        channelChartWindow = btn.dataset.channelChart;        document.querySelectorAll('[data-channel-chart]').forEach((item) => item.classList.toggle('active', item === btn));        renderChannelChart();      });    });    document.querySelectorAll('[data-trend-chart]').forEach((btn) => {      btn.addEventListener('click', () => {        trendChartWindow = btn.dataset.trendChart;        document.querySelectorAll('[data-trend-chart]').forEach((item) => item.classList.toggle('active', item === btn));        renderTrendChart();      });    });  }  function renderStatusChart() {    const box = $('chartStatus');    const legend = $('legendStatus');    if (!box || !legend) return;    const chartTasks = filterTasksByCreatedWindow(statusChartWindow);    const entries = STATUS_LIST.map((status) => ({      label: status,      value: chartTasks.filter((task) => task.status === status).length,      color: STATUS_COLORS[status]    }));    const total = entries.reduce((sum, item) => sum + item.value, 0);    if (total === 0) {      box.innerHTML = '<div class="chart-empty">데이터 없음</div>';      legend.innerHTML = '';      return;    }    const cx = 110;    const cy = 110;    const r = 72;    const inner = 42;    let current = -Math.PI / 2;    const paths = entries.filter((item) => item.value > 0).map((item) => {      const angle = (item.value / total) * Math.PI * 2;      const startX = cx + r * Math.cos(current);      const startY = cy + r * Math.sin(current);      const endX = cx + r * Math.cos(current + angle);      const endY = cy + r * Math.sin(current + angle);      const large = angle > Math.PI ? 1 : 0;      const path = `M ${cx} ${cy} L ${startX} ${startY} A ${r} ${r} 0 ${large} 1 ${endX} ${endY} Z`;      current += angle;      return `<path d="${path}" fill="${item.color}" opacity="0.92"></path>`;    }).join('');    box.innerHTML = `      <svg width="240" height="220" viewBox="0 0 240 220" style="max-width:100%; height:auto;">        <circle cx="${cx}" cy="${cy}" r="${r}" fill="#eef2f7"></circle>        ${paths}        <circle cx="${cx}" cy="${cy}" r="${inner}" fill="#fff"></circle>        <text x="${cx}" y="${cy - 10}" text-anchor="middle" font-size="11" fill="#6b7280" font-weight="700" letter-spacing="0.3">TOTAL</text>        <text x="${cx}" y="${cy + 24}" text-anchor="middle" font-size="30" fill="#111" font-weight="800">${total}</text>      </svg>`;    legend.innerHTML = entries.map((item) => `      <div class="legend-item">        <span class="legend-dot" style="background:${item.color}"></span>        <span>${escapeHtml(item.label)} ${item.value}</span>      </div>`).join('');  }  function renderChannelChart() {    const box = $('chartChannel');    if (!box) return;    const chartTasks = filterTasksByCreatedWindow(channelChartWindow);    const entries = CHANNEL_LIST.map((channel, index) => ({      label: channel,      value: chartTasks.filter((task) => task.channel === channel).length,      color: CHANNEL_COLORS[index % CHANNEL_COLORS.length]    }));    const max = Math.max(1, ...entries.map((item) => item.value));    const total = entries.reduce((sum, item) => sum + item.value, 0);    if (total === 0) {      box.innerHTML = '<div class="chart-empty">데이터 없음</div>';      return;    }    const width = 320;    const height = 220;    const left = 32;    const right = 12;    const top = 16;    const bottom = 34;    const chartW = width - left - right;    const chartH = height - top - bottom;    const barGap = 14;    const barWidth = (chartW - barGap * (entries.length - 1)) / entries.length;    let gridLines = '';    for (let i = 0; i <= 4; i += 1) {      const y = top + (chartH / 4) * i;      gridLines += `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="rgba(60,60,67,0.08)"></line>`;    }    const bars = entries.map((item, index) => {      const x = left + index * (barWidth + barGap);      const h = Math.round((item.value / max) * (chartH - 8));      const y = top + chartH - h;      return `        <g>          <rect x="${x}" y="${y}" width="${barWidth}" height="${h}" rx="8" fill="${item.color}" opacity="0.9"></rect>          <text x="${x + barWidth / 2}" y="${y - 6}" text-anchor="middle" font-size="11" fill="#4b5563" font-weight="700">${item.value}</text>          <text x="${x + barWidth / 2}" y="${height - 10}" text-anchor="middle" font-size="11" fill="#6b7280">${item.label}</text>        </g>`;    }).join('');    box.innerHTML = `      <svg width="320" height="220" viewBox="0 0 320 220" style="max-width:100%; height:auto;">        ${gridLines}        ${bars}      </svg>`;  }  function renderTrendChart() {    const box = $('chartTrend');    if (!box) return;    const labels = [];    const counts = [];    const now = new Date();    if (trendChartWindow === '7d') {      for (let i = 6; i >= 0; i -= 1) {        const day = startOfDay(addDays(now, -i));        labels.push(`${pad2(day.getMonth() + 1)}/${pad2(day.getDate())}`);        counts.push(tasks.filter((task) => {          const created = getTaskCreatedDate(task);          return created && startOfDay(created).getTime() === day.getTime();        }).length);      }    } else if (trendChartWindow === '30d') {      for (let i = 29; i >= 0; i -= 1) {        const day = startOfDay(addDays(now, -i));        labels.push(i % 5 === 0 ? `${pad2(day.getMonth() + 1)}/${pad2(day.getDate())}` : '');        counts.push(tasks.filter((task) => {          const created = getTaskCreatedDate(task);          return created && startOfDay(created).getTime() === day.getTime();        }).length);      }    } else if (trendChartWindow === '1y') {      for (let i = 11; i >= 0; i -= 1) {        const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);        labels.push(`${monthDate.getMonth() + 1}월`);        counts.push(tasks.filter((task) => {          const created = getTaskCreatedDate(task);          return created && created.getFullYear() === monthDate.getFullYear() && created.getMonth() === monthDate.getMonth();        }).length);      }    } else {      const years = tasks.map((task) => getTaskCreatedDate(task)).filter(Boolean).map((d) => d.getFullYear());      if (!years.length) {        box.innerHTML = '<div class="chart-empty">데이터 없음</div>';        return;      }      const startYear = Math.min(...years);      const endYear = Math.max(...years, now.getFullYear());      for (let year = startYear; year <= endYear; year += 1) {        labels.push(String(year));        counts.push(tasks.filter((task) => {          const created = getTaskCreatedDate(task);          return created && created.getFullYear() === year;        }).length);      }    }    const total = counts.reduce((sum, count) => sum + count, 0);    if (total === 0) {      box.innerHTML = '<div class="chart-empty">데이터 없음</div>';      return;    }    const width = 340;    const height = 220;    const left = 30;    const right = 12;    const top = 18;    const bottom = 34;    const chartW = width - left - right;    const chartH = height - top - bottom;    const max = Math.max(1, ...counts);    const stepX = labels.length > 1 ? chartW / (labels.length - 1) : chartW;    const points = counts.map((count, index) => {      const x = left + index * stepX;      const y = top + chartH - (count / max) * chartH;      return { x, y, count, label: labels[index] };    });    const linePoints = points.map((p) => `${p.x},${p.y}`).join(' ');    const areaPath = `M ${left} ${top + chartH} L ${points.map((p) => `${p.x} ${p.y}`).join(' L ')} L ${left + chartW} ${top + chartH} Z`;    let gridLines = '';    for (let i = 0; i <= 4; i += 1) {      const y = top + (chartH / 4) * i;      gridLines += `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="rgba(60,60,67,0.08)"></line>`;    }    const xLabels = points.map((p) => `<text x="${p.x}" y="${height - 10}" text-anchor="middle" font-size="11" fill="#6b7280">${p.label}</text>`).join('');    const dots = points.map((p) => `      <g>        <circle cx="${p.x}" cy="${p.y}" r="3.5" fill="#007aff"></circle>        <text x="${p.x}" y="${p.y - 8}" text-anchor="middle" font-size="11" fill="#4b5563" font-weight="700">${p.count}</text>      </g>`).join('');    box.innerHTML = `      <svg width="340" height="220" viewBox="0 0 340 220" style="max-width:100%; height:auto;">        <defs>          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">            <stop offset="0%" stop-color="#007aff" stop-opacity="0.18"></stop>            <stop offset="100%" stop-color="#007aff" stop-opacity="0"></stop>          </linearGradient>        </defs>        ${gridLines}        <path d="${areaPath}" fill="url(#trendFill)"></path>        <polyline points="${linePoints}" fill="none" stroke="#007aff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></polyline>        ${dots}        ${xLabels}      </svg>`;  }    function collectCareerMetrics() {    const projectSet = new Set();    let outcomeCount = 0;    let learningCount = 0;    tasks.forEach((task) => {      if (task.project) projectSet.add(task.project);      if ((task.outcome || '').trim()) outcomeCount += 1;      if ((task.learning || '').trim()) learningCount += 1;    });    return {      projectCount: projectSet.size,      outcomeCount,      learningCount    };  }  function renderCareerOverview() {    const metrics = collectCareerMetrics();    if ($('careerProjectCount')) $('careerProjectCount').textContent = metrics.projectCount;    if ($('careerOutcomeCount')) $('careerOutcomeCount').textContent = metrics.outcomeCount;    if ($('careerLearningCount')) $('careerLearningCount').textContent = metrics.learningCount;    if ($('careerSummary')) {      const completed = tasks.filter((task) => task.status === '완료').length;      const withProject = tasks.filter((task) => (task.project || '').trim()).length;      $('careerSummary').innerHTML = `완료 업무 <strong>${completed}건</strong>, 프로젝트 연결 업무 <strong>${withProject}건</strong> 기준으로 누적됩니다.<br>업무별로 프로젝트, 성과, 시사점을 남기면 주간보고뿐 아니라 경력기술서용 기록까지 같이 쌓입니다.`;    }  }  function renderTodaySection() {    const list = tasks      .filter((task) => task.status !== '완료')      .map((task) => ({ task, score: calcScore(task), priority: getPriorityScore(task) }))      .filter((item) => item.priority >= 4 || isDueSoon(item.task) || isOverdue(item.task))      .sort((a, b) => b.score - a.score)      .slice(0, 6)      .map((item) => item.task);    renderSimpleList('todayList', list, 'today');  }  function renderAlerts() {    renderSimpleList('dueSoonList', sortTasks(tasks.filter(isDueSoon)).slice(0, 3), 'alert');    renderSimpleList('overdueList', sortTasks(tasks.filter(isOverdue)).slice(0, 3), 'alert');  }  function filteredTasks() {    let list = sortTasks(tasks);    if (taskFilterStatus !== '전체') {      list = list.filter((task) => task.status === taskFilterStatus);    }    if (projectFilter !== '전체') {      if (projectFilter === '__unassigned__') {        list = list.filter((task) => !(task.project || '').trim());      } else {        list = list.filter((task) => (task.project || '').trim() === projectFilter);      }    }    return list;  }  function getProjectGroups(list) {    const groupMap = new Map();    list.forEach((task) => {      const key = (task.project || '').trim() || '__unassigned__';      if (!groupMap.has(key)) groupMap.set(key, []);      groupMap.get(key).push(task);    });    return Array.from(groupMap.entries()).sort((a, b) => {      if (a[0] === '__unassigned__') return 1;      if (b[0] === '__unassigned__') return -1;      return a[0].localeCompare(b[0], 'ko');    });  }  function refreshProjectFilterOptions() {    const select = $('projectFilter');    if (!select) return;    syncProjectOrder();    const prev = projectFilter;    const projects = projectOrder.slice();    const options = [`<option value="전체">전체 프로젝트</option>`, ...projects.map((project) => `<option value="${escapeHtml(project)}">${escapeHtml(project)}</option>`)];    const hasUnassigned = tasks.some((task) => !String(task.project || '').trim());    if (hasUnassigned) options.push(`<option value="__unassigned__">미분류</option>`);    select.innerHTML = options.join('');    const values = new Set(['전체', ...(hasUnassigned ? ['__unassigned__'] : []), ...projects]);    if (!values.has(prev)) projectFilter = '전체';    select.value = projectFilter;  }  function renderTaskTable() {    refreshProjectFilterOptions();    const tbody = $('taskTableBody');    const pagination = $('taskPagination');    const taskCountSummary = $('taskCountSummary');    if (!tbody || !pagination) return;    let filtered = tasks.slice();    if (taskFilterStatus !== '전체') filtered = filtered.filter((task) => task.status === taskFilterStatus);    if (projectFilter !== '전체') {      filtered = filtered.filter((task) => {        const projectName = String(task.project || '').trim();        return projectFilter === '__unassigned__' ? !projectName : projectName === projectFilter;      });    }    filtered = sortTasks(filtered);    taskCountSummary.textContent = `${filtered.length}건`;    if (!filtered.length) {      tbody.innerHTML = '<tr><td colspan="9"><div class="empty">조건에 맞는 업무가 없습니다.</div></td></tr>';      pagination.innerHTML = '';      return;    }    const grouped = filtered.reduce((acc, task) => {      const key = String(task.project || '').trim() || '__unassigned__';      if (!acc[key]) acc[key] = [];      acc[key].push(task);      return acc;    }, {});    const orderedEntries = getOrderedProjectGroups(grouped);    tbody.innerHTML = orderedEntries.map(([projectName, projectTasks]) => {      const groupTitle = projectName === '__unassigned__' ? '미분류' : projectName;      const doneCount = projectTasks.filter((task) => task.status === '완료').length;      const doingCount = projectTasks.filter((task) => task.status === '진행중').length;      const waitCount = projectTasks.filter((task) => task.status === '대기').length;      const todoCount = projectTasks.filter((task) => task.status === '미진행').length;      const collapsed = collapsedProjectGroups.has(projectName);      const canMoveUp = projectName !== '__unassigned__' && projectOrder.indexOf(projectName) > 0;      const canMoveDown = projectName !== '__unassigned__' && projectOrder.indexOf(projectName) > -1 && projectOrder.indexOf(projectName) < projectOrder.length - 1;      const header = `          <tr class="project-group-row">            <td colspan="9">              <div class="project-group-head">                <div class="project-group-main">                  <button type="button" class="project-group-toggle" data-action="toggle-project-group" data-project="${escapeHtml(projectName)}">${collapsed ? '▸' : '▾'}</button>                  <div class="project-group-title">${escapeHtml(groupTitle)}</div>                </div>                <div class="project-group-actions">                  <div class="project-group-meta">                    <span class="project-group-chip">${projectTasks.length} TASKS</span>                    <span class="status-badge st-진행중">진행중 ${doingCount}</span>                    <span class="status-badge st-미진행">미진행 ${todoCount}</span>                    <span class="status-badge st-대기">대기 ${waitCount}</span>                    <span class="status-badge st-완료">완료 ${doneCount}</span>                  </div>                  ${projectName !== '__unassigned__' ? `<button type="button" class="project-action-btn" data-action="rename-project" data-project="${escapeHtml(projectName)}">이름변경</button><button type="button" class="project-action-btn" data-action="move-project-up" data-project="${escapeHtml(projectName)}" ${canMoveUp ? '' : 'disabled'}>↑</button><button type="button" class="project-action-btn" data-action="move-project-down" data-project="${escapeHtml(projectName)}" ${canMoveDown ? '' : 'disabled'}>↓</button>` : ''}                </div>              </div>            </td>          </tr>`;      if (collapsed) return header;      const rows = projectTasks.map((task) => {        const created = new Date(task.createdAt);        const createdText = Number.isNaN(created.getTime()) ? '-' : `${created.getFullYear()}.${pad2(created.getMonth() + 1)}.${pad2(created.getDate())}`;        const priority = getPriorityDisplay(task);        const rowClass = task.status === '완료' ? 'done-row' : '';        return `          <tr class="project-task-row ${rowClass}">            <td class="name-cell"><div class="name-ellipsis" title="${escapeHtml(task.name)}">${escapeHtml(task.name)}</div></td>            <td>${escapeHtml(task.channel)}</td>            <td>${escapeHtml(formatDueDisplay(task))}</td>            <td><span class="score-badge ${priority.cls}">${escapeHtml(priority.text)}</span></td>            <td>              <select class="inline-select" data-action="status-select" data-id="${escapeHtml(task.id)}">                ${STATUS_LIST.map((status) => `<option value="${escapeHtml(status)}" ${task.status === status ? 'selected' : ''}>${escapeHtml(status)}</option>`).join('')}              </select>            </td>            <td>${escapeHtml(createdText)}</td>            <td><button class="text-link" data-action="open-detail" data-id="${escapeHtml(task.id)}">관리</button></td>            <td><button class="text-link" data-action="edit" data-id="${escapeHtml(task.id)}">빠른수정</button></td>            <td><button class="icon-btn" data-action="delete" data-id="${escapeHtml(task.id)}">✕</button></td>          </tr>`;      }).join('');      return header + rows;    }).join('');    pagination.innerHTML = '';    setTimeout(() => { document.querySelectorAll('.inline-select[data-action="status-select"]').forEach(styleStatusSelect); }, 20);  }  function renderReportStats(targetId, total, done, doing, waiting) {    const el = $(targetId);    if (!el) return;    el.innerHTML = `      <div class="report-stat"><div class="v">${total}</div><div class="l">전체</div></div>      <div class="report-stat"><div class="v" style="color:var(--green)">${done}</div><div class="l">완료</div></div>      <div class="report-stat"><div class="v" style="color:var(--blue)">${doing}</div><div class="l">진행중</div></div>      <div class="report-stat"><div class="v" style="color:var(--purple)">${waiting}</div><div class="l">대기</div></div>`;  }  function renderReportList(containerId, list) {    const el = $(containerId);    if (!el) return;    if (!list.length) {      el.innerHTML = '<div class="empty">해당 기간 업무 없음</div>';      return;    }    el.innerHTML = list.map((task) => `      <div class="list-item">        <span class="status-badge st-${escapeHtml(task.status)}">${escapeHtml(task.status)}</span>        <div>          <div class="task-name">${escapeHtml(task.name)}</div>          ${task.project ? `<div class="name-subline">${escapeHtml(task.project)}</div>` : ""}          <div class="task-meta">${escapeHtml(task.channel)} · ${escapeHtml(formatDueDisplay(task))}</div>        </div>        <span class="${task.priority === '상' ? 'priority-high' : task.priority === '중' ? 'priority-mid' : 'priority-low'}">${escapeHtml(task.priority)}</span>      </div>`).join('');  }  function renderWeeklyHistory() {    const hist = $('weeklyHistory');    if (!weeklyHistory.length) {      hist.innerHTML = '<div class="empty">저장된 리포트 없음</div>';      return;    }    hist.innerHTML = weeklyHistory.map((item) => {      const expanded = expandedWeeklyReports.has(item.id);      return `        <div class="hist-item">          <div class="hist-title">${escapeHtml(item.title)}</div>          <div class="hist-meta">작성일시: ${escapeHtml(item.savedAtText)}</div>          <div class="hist-actions">            <button class="btn btn-secondary" type="button" data-action="toggle-weekly-report" data-id="${escapeHtml(item.id)}">${expanded ? '접기' : '펼치기'}</button>            <button class="btn btn-danger" type="button" data-action="delete-weekly-report" data-id="${escapeHtml(item.id)}">삭제</button>          </div>          ${expanded ? `<div class="hist-content">${escapeHtml(item.content)}</div>` : ''}        </div>`;    }).join('');  }  function renderMonthlyHistory() {    const hist = $('monthlyHistory');    if (!monthlyHistory.length) {      hist.innerHTML = '<div class="empty">저장된 리포트 없음</div>';      return;    }    hist.innerHTML = monthlyHistory.map((item) => {      const expanded = expandedMonthlyReports.has(item.id);      return `        <div class="hist-item">          <div class="hist-title">${escapeHtml(item.title)}</div>          <div class="hist-meta">작성일시: ${escapeHtml(item.savedAtText)}</div>          <div class="hist-actions">            <button class="btn btn-secondary" type="button" data-action="toggle-monthly-report" data-id="${escapeHtml(item.id)}">${expanded ? '접기' : '펼치기'}</button>            <button class="btn btn-danger" type="button" data-action="delete-monthly-report" data-id="${escapeHtml(item.id)}">삭제</button>          </div>          ${expanded ? `<div class="hist-content">${escapeHtml(item.content)}</div>` : ''}        </div>`;    }).join('');  }  function renderWeeklyPage() {    const range = getWeekRange(weeklyOffset);    $('weeklyLabel').textContent = `${range.start.getFullYear()}.${pad2(range.start.getMonth() + 1)}.${pad2(range.start.getDate())} ~ ${range.end.getFullYear()}.${pad2(range.end.getMonth() + 1)}.${pad2(range.end.getDate())}`;    $('weeklyNext').disabled = weeklyOffset >= 0;    const list = sortTasks(tasks.filter((task) => isRelatedWithin(task, range.start, range.end)));    renderReportStats(      'weeklyStats',      list.length,      list.filter((task) => task.status === '완료').length,      list.filter((task) => task.status === '진행중').length,      list.filter((task) => task.status === '대기').length    );    renderReportList('weeklyTasks', list);    renderWeeklyHistory();  }  function renderMonthlyPage() {    const range = getMonthRange(monthlyOffset);    $('monthlyLabel').textContent = `${range.start.getFullYear()}년 ${range.start.getMonth() + 1}월`;    $('monthlyNext').disabled = monthlyOffset >= 0;    const list = sortTasks(tasks.filter((task) => isRelatedWithin(task, range.start, range.end)));    renderReportStats(      'monthlyStats',      list.length,      list.filter((task) => task.status === '완료').length,      list.filter((task) => task.status === '진행중').length,      list.filter((task) => task.status === '대기').length    );    renderReportList('monthlyTasks', list);    renderMonthlyHistory();  }  function renderAll() {    renderTodaySection();    renderAlerts();    renderKPIs();    renderStatusChart();    renderChannelChart();    renderTrendChart();    renderTaskTable();    renderWeeklyPage();    renderMonthlyPage();  }  function setTab(tabName) {    const validTabs = new Set(['home', 'tasks', 'weekly', 'monthly', 'work']);    if (!validTabs.has(tabName)) tabName = 'home';    currentTab = tabName;    sessionStorage.setItem(ACTIVE_TAB_KEY, tabName);    document.querySelectorAll('.tab').forEach((tab) => {      tab.classList.toggle('active', tab.dataset.tab === tabName);    });    document.querySelectorAll('.page').forEach((page) => {      page.classList.toggle('active', page.id === `page-${tabName}`);    });    if (tabName === 'tasks') renderTaskTable();    if (tabName === 'weekly') renderWeeklyPage();    if (tabName === 'monthly') renderMonthlyPage();
    if(tabName==='work'){setTimeout(()=>{if(typeof wmRenderAll==='function')wmRenderAll();},50);}  }  function cycleStatus(current) {    const index = STATUS_LIST.indexOf(current);    return STATUS_LIST[(index + 1) % STATUS_LIST.length] || '미진행';  }  function bindEvents() {    ['taskImpact', 'taskUrgency', 'taskLinkage'].forEach((id) => { const el = $(id); if (el) el.addEventListener('change', updateTaskFormPriorityPreview); });    ['detailTaskImpact', 'detailTaskUrgency', 'detailTaskLinkage'].forEach((id) => { const el = $(id); if (el) el.addEventListener('change', updateDetailPriorityResult); });    document.querySelectorAll('.tab').forEach((tab) => {      tab.addEventListener('click', () => setTab(tab.dataset.tab));    });    document.querySelectorAll('[data-status-filter]').forEach((btn) => {      btn.addEventListener('click', () => {        taskFilterStatus = btn.dataset.statusFilter;        currentPage = 1;        document.querySelectorAll('[data-status-filter]').forEach((item) => item.classList.remove('active'));        btn.classList.add('active');        renderTaskTable();      });    });    if ($('projectFilter')) {      $('projectFilter').addEventListener('change', (e) => {        projectFilter = e.target.value;        renderTaskTable();      });    }    if ($('detailTaskProjectSelect')) {      $('detailTaskProjectSelect').addEventListener('change', (e) => {        if (e.target.value === '__new__') {          $('detailTaskProject').value = '';          $('detailTaskProject').focus();        } else {          $('detailTaskProject').value = e.target.value;        }      });    }    $('saveBtn').addEventListener('click', upsertTaskFromForm);    $('resetBtn').addEventListener('click', resetForm);    $('taskHour').addEventListener('change', () => { renderAmpmButton(); });
    $('taskAmpm').addEventListener('click', () => {
      dueAmpm = dueAmpm === '오전' ? '오후' : '오전';
      renderAmpmButton();
    });    $('weeklyPrev').addEventListener('click', () => { weeklyOffset -= 1; renderWeeklyPage(); });    $('weeklyNext').addEventListener('click', () => { if (weeklyOffset < 0) { weeklyOffset += 1; renderWeeklyPage(); } });    $('monthlyPrev').addEventListener('click', () => { monthlyOffset -= 1; renderMonthlyPage(); });    $('monthlyNext').addEventListener('click', () => { if (monthlyOffset < 0) { monthlyOffset += 1; renderMonthlyPage(); } });    $('weeklyOpenReport').addEventListener('click', () => openReportModal('weekly'));    $('monthlyOpenReport').addEventListener('click', () => openReportModal('monthly'));    $('reportModalClose').addEventListener('click', closeReportModal);    $('reportModalCancel').addEventListener('click', closeReportModal);    $('reportModalSave').addEventListener('click', saveReportModal);    $('detailModalClose').addEventListener('click', closeTaskDetailModal);    $('detailModalCancel').addEventListener('click', closeTaskDetailModal);    $('detailModalSave').addEventListener('click', saveTaskDetailModal);    $('reportModal').addEventListener('click', (e) => {      if (e.target.id === 'reportModal') closeReportModal();    });    $('detailModal').addEventListener('click', (e) => {      if (e.target.id === 'detailModal') closeTaskDetailModal();    });    document.addEventListener('keydown', (e) => {      if (e.key === 'Escape') {        closeTaskDetailModal();        closeReportModal();      }    });    document.body.addEventListener('click', (event) => {      const actionEl = event.target?.closest?.('[data-action], [data-page]');      if (!actionEl) return;      if (actionEl.disabled) return;      const action = actionEl?.dataset?.action;      const id = actionEl?.dataset?.id;      const project = actionEl?.dataset?.project;      if (!action) {        if (actionEl.dataset.page) {          const nextPage = Number(actionEl.dataset.page);          if (!Number.isNaN(nextPage)) {            currentPage = nextPage;            renderTaskTable();          }        }        return;      }      if (action === 'toggle-status' && id) {        const task = tasks.find((item) => item.id === id);        if (!task) return;        updateTaskStatus(id, cycleStatus(task.status));        return;      }      if (action === 'edit' && id) {        const task = tasks.find((item) => item.id === id);        if (task) fillForm(task);        return;      }      if (action === 'delete' && id) {        deleteTask(id);        return;      }      if (action === 'open-detail' && id) {        openTaskDetailModal(id);        return;      }      if (action === 'toggle-project-group' && project) {        toggleProjectGroup(project);        return;      }      if (action === 'rename-project' && project) {        renameProject(project);        return;      }      if (action === 'move-project-up' && project) {        moveProjectOrder(project, 'up');        return;      }      if (action === 'move-project-down' && project) {        moveProjectOrder(project, 'down');        return;      }      if (action === 'toggle-weekly-report' && id) {        toggleReportExpand('weekly', id);        return;      }      if (action === 'toggle-monthly-report' && id) {        toggleReportExpand('monthly', id);        return;      }      if (action === 'delete-weekly-report' && id) {        deleteReport('weekly', id);        return;      }      if (action === 'delete-monthly-report' && id) {        deleteReport('monthly', id);      }    });    document.body.addEventListener('change', (event) => {      const target = event.target;      if (target?.dataset?.action === 'status-select') {        updateTaskStatus(target.dataset.id, target.value);      }    });  }  function tickClock() {    const now = new Date();    $('navTime').textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;  
    if(typeof wtTickUpdate==='function') wtTickUpdate(new Date());
  }
window.styleStatusSelect = function(sel){
  if(!sel) return;
  const value = sel.value;
  const colorMap = {'미진행':'var(--gray)','진행중':'var(--blue)','대기':'var(--purple)','완료':'var(--green)'};
  const bgMap = {'미진행':'var(--gray-bg)','진행중':'var(--blue-bg)','대기':'var(--purple-bg)','완료':'var(--green-bg)'};
  sel.style.color = colorMap[value] || 'var(--text)';
  sel.style.background = bgMap[value] || 'rgba(255,255,255,0.78)';
  sel.style.borderColor = 'transparent';
};

  function updateVersionLabel() {    const version = window.WORK_BOARD_CONFIG?.appVersion || '2.3.0';    const el = $('appVersion');    if (el) el.textContent = `v${version}`;  }  function refreshFromStorage() {    const active = currentTab;    const x = window.scrollX;    const y = window.scrollY;    loadStorage();    renderProjectSelectOptions();    renderAll();    setTab(active);    if (typeof window.wtUpdateBar === 'function') window.wtUpdateBar();    if (typeof window.wmRenderAll === 'function') window.wmRenderAll();    window.scrollTo(x, y);  }  window.WorkBoardApp = { refreshFromStorage };  function init() {    updateVersionLabel();    loadStorage();    renderProjectSelectOptions();    initTimeOptions();    bindEvents();    updateDetailPriorityResult();    bindChartTabs();    resetForm();    tickClock();    setInterval(tickClock, 1000);    renderAll();    setTab(sessionStorage.getItem(ACTIVE_TAB_KEY) || currentTab);  }  init();})();
/* ============================================================
   Work Time Manager v18
   소정근무 08:30~17:30 (8h 근무 + 1h 휴게)
   ▶ 초과근무: 08:30 이전 + 17:30 이후
   ▶ 연차/반차/반반차는 근무시간에서 제외
   ============================================================ */
(function(){
  const KEY_REC  = 'wt_rec';
  const KEY_LIVE = 'wt_live';
  const STD_START = '08:30';
  const STD_END   = '17:30';
  const STD_WORK  = 480; // 8h in mins
  const BREAK_UNIT_MINS = 30; // 4시간당 30분
  const BREAK_EVERY_MINS = 240;
  const MAX_STD_BREAK_MINS = 60;
  const TOTAL_LV  = 16;

  function getRec(){try{return JSON.parse(localStorage.getItem(KEY_REC)||'{}')}catch{return{}}}
  function saveRec(r){localStorage.setItem(KEY_REC,JSON.stringify(r))}
  function getLive(){try{return JSON.parse(localStorage.getItem(KEY_LIVE)||'null')}catch{return null}}
  function hm(str){if(!str)return 0;const[h,m]=str.split(':').map(Number);return h*60+(m||0)}
  function fmtH(mins){if(mins<=0)return '0h';const h=Math.floor(mins/60),m=mins%60;return m?h+'h '+m+'m':h+'h'}
  function fmtLv(days){const n=Math.round(days*100)/100;return Number.isInteger(n)?String(n):String(n).replace(/\.0+$/,'').replace(/(\.\d*[1-9])0+$/,'$1')}
  function pad2(n){return String(n).padStart(2,'0')}
  function todayStr(){const d=new Date();return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate())}
  function nowHHMM(){const d=new Date();return pad2(d.getHours())+':'+pad2(d.getMinutes())}
  function clampOverlap(startA,endA,startB,endB){return Math.max(0,Math.min(endA,endB)-Math.max(startA,startB))}
  function stdOverlapMins(r){
    if(!r||!r.in||!r.out) return 0;
    return clampOverlap(hm(r.in),hm(r.out),hm(STD_START),hm(STD_END));
  }
  function stdBreakMins(r){
    const overlap = stdOverlapMins(r);
    if(overlap<=0) return 0;
    const units = Math.floor(overlap / BREAK_EVERY_MINS);
    return Math.min(MAX_STD_BREAK_MINS, units * BREAK_UNIT_MINS);
  }
  function regularWorkMins(r){
    if(!r||!r.in||!r.out)return 0;
    const net = stdOverlapMins(r) - stdBreakMins(r);
    return Math.max(0,Math.min(STD_WORK,net));
  }
  function overtimeRawMins(r){
    if(!r||!r.in||!r.out)return 0;
    const inM=hm(r.in), outM=hm(r.out);
    const pre = Math.max(0,Math.min(outM,hm(STD_START)) - inM);
    const post = Math.max(0,outM - Math.max(inM,hm(STD_END)));
    return pre + post;
  }
  function actualWorkMins(r){
    if(!r||!r.in||!r.out)return 0;
    return regularWorkMins(r) + overtimeRawMins(r);
  }
  function workMins(r){
    if(!r||!r.in||!r.out)return 0;
    if(['leave','half','half2','holiday'].includes(r.type)) return 0;
    return regularWorkMins(r);
  }
  function otMins(r){
    if(!r||!r.in||!r.out)return 0;
    if(['leave','half','half2','holiday'].includes(r.type)) return 0;
    return overtimeRawMins(r);
  }
  function leaveDays(type){
    if(type==='leave') return 1;
    if(type==='half') return 0.5;
    if(type==='half2') return 0.25;
    return 0;
  }

  /* ── 출근 ── */
  window.wtCheckin = function(){
    localStorage.setItem(KEY_LIVE, JSON.stringify({date:todayStr(), start:nowHHMM()}));
    wtUpdateBar();
  };

  /* ── 퇴근 ── */
  window.wtCheckout = function(){
    const live=getLive(); if(!live) return;
    const rec=getRec();
    if(!rec[live.date]) rec[live.date]={};
    rec[live.date].in   = live.start;
    rec[live.date].out  = nowHHMM();
    rec[live.date].type = rec[live.date].type||'work';
    rec[live.date].memo = rec[live.date].memo||'';
    saveRec(rec);
    localStorage.removeItem(KEY_LIVE);
    wtUpdateBar();
    if(typeof wmRenderAll==='function') wmRenderAll();
  };

  /* ── 버튼 활성화 상태 ── */
  window.wtUpdateBar = function(){
    const ci=document.getElementById('btnCI');
    const co=document.getElementById('btnCO');
    if(!ci||!co) return;
    const live=getLive();
    ci.disabled = !!live;
    co.disabled = !live;
  };

  /* ── 실시간 wt-bar 업데이트 (tickClock 후킹) ── */
  window.wtTickUpdate = function(now){
    const el={
      liveTime: document.getElementById('wtLiveTime'),
      liveDate: document.getElementById('wtLiveDate'),
      inTime:   document.getElementById('wtInTime'),
      outTime:  document.getElementById('wtOutTime'),
      remain:   document.getElementById('wtRemain'),
      liveWorkedLabel: document.getElementById('wtLiveWorkedLabel'),
      liveWorked: document.getElementById('wtLiveWorked'),
      liveOtLabel: document.getElementById('wtLiveOtLabel'),
      liveOt: document.getElementById('wtLiveOt'),
      regular:  document.getElementById('wtRegular'),
      overtime: document.getElementById('wtOvertime'),
      total:    document.getElementById('wtTotal'),
      fill:     document.getElementById('wtProgressFill'),
    };
    if(!el.liveTime) return;
    const days=['일','월','화','수','목','금','토'];
    el.liveTime.textContent = pad2(now.getHours())+':'+pad2(now.getMinutes())+':'+pad2(now.getSeconds());
    el.liveDate.textContent = (now.getMonth()+1)+'/'+now.getDate()+' ('+days[now.getDay()]+')';

    const live   = getLive();
    const rec    = getRec()[todayStr()];
    const inStr  = live ? live.start : rec ? rec.in  : null;
    const outStr = live ? null       : rec ? rec.out : null;

    el.inTime.textContent  = inStr  || '-';
    el.outTime.textContent = outStr || (live ? '근무중' : '-');

    const liveNowStr = pad2(now.getHours())+':'+pad2(now.getMinutes());
    if(inStr){
      const calcOutStr = outStr || liveNowStr;
      const calcRegular = workMins({in:inStr,out:calcOutStr,type:'work'});
      const calcOt = otMins({in:inStr,out:calcOutStr,type:'work'});
      const calcTotal = calcRegular + calcOt;
      if(el.liveWorked) el.liveWorked.textContent = fmtH(calcTotal);
      if(el.liveOt) el.liveOt.textContent = fmtH(calcOt);
      if(outStr){
        const wm=workMins({in:inStr,out:outStr,type:'work'});
        const ot=otMins({in:inStr,out:outStr,type:'work'});
        if(el.regular) el.regular.textContent = fmtH(wm);
        if(el.overtime) el.overtime.textContent = fmtH(ot);
        if(el.total) el.total.textContent = fmtH(wm+ot);
        el.remain.textContent = ot>0 ? '+'+fmtH(ot)+' 초과근무' : '퇴근완료';
        el.remain.className   = 'wt-remain '+(ot>0?'overtime':'done');
        el.fill.style.width   = Math.min(100,(wm/STD_WORK)*100)+'%';
        el.fill.className     = 'wt-progress-fill'+(ot>0?' ot':'');
      } else if(live){
        const liveRegular = workMins({in:inStr,out:liveNowStr,type:'work'});
        const liveOt = otMins({in:inStr,out:liveNowStr,type:'work'});
        const remainM = Math.max(0,STD_WORK-liveRegular);
        const liveTotal = liveRegular + liveOt;
        if(el.regular) el.regular.textContent = fmtH(liveRegular);
        if(el.overtime) el.overtime.textContent = fmtH(liveOt);
        if(el.total) el.total.textContent = fmtH(liveTotal);
        if(liveOt>0){
          el.remain.textContent = '+'+fmtH(liveOt)+' 초과근무중';
          el.remain.className   = 'wt-remain overtime';
        } else {
          el.remain.textContent = '잔여 '+fmtH(remainM);
          el.remain.className   = 'wt-remain on-time';
        }
        el.fill.style.width = Math.min(100,Math.max(0,(liveRegular/STD_WORK)*100))+'%';
        el.fill.className   = 'wt-progress-fill'+(liveOt>0?' ot':'');
      }
    } else {
      if(el.regular) el.regular.textContent='-'; if(el.overtime) el.overtime.textContent='-'; if(el.total) el.total.textContent='-';
      if(el.liveWorked) el.liveWorked.textContent='-';
      if(el.liveOt) el.liveOt.textContent='-';
      el.remain.textContent='';
      el.fill.style.width='0%';
      el.fill.className='wt-progress-fill';
    }
  };

  /* ── 출/퇴근 시간 인라인 수정 팝오버 ── */
  let _editMode = null; // 'in' | 'out'

  window.wtOpenEditPop = function(mode, triggerEl){
    const live = getLive();
    const rec  = getRec()[todayStr()];
    // 수정 가능 조건: 출근=live 또는 오늘 기록 있을 때 / 퇴근=오늘 기록 있을 때
    const inStr  = live ? live.start : rec ? rec.in  : null;
    const outStr = rec ? rec.out : null;
    if(mode==='in'  && !inStr)  return;
    if(mode==='out' && !outStr) return;

    _editMode = mode;
    const pop   = document.getElementById('wtEditPop');
    const label = document.getElementById('wtEditPopLabel');
    const inp   = document.getElementById('wtEditPopTime');
    label.textContent = mode==='in' ? '출근 시간 수정' : '퇴근 시간 수정';
    inp.value = mode==='in' ? (inStr||'08:30') : (outStr||'17:30');

    // 팝오버 위치: triggerEl 아래
    const rect = triggerEl.getBoundingClientRect();
    pop.style.top  = (rect.bottom + window.scrollY + 6)+'px';
    pop.style.left = (rect.left + window.scrollX)+'px';
    pop.style.position = 'absolute';
    pop.classList.add('show');
    setTimeout(()=>document.addEventListener('click', wtClickOutside, {once:true}), 10);
  };

  function wtClickOutside(e){
    const pop=document.getElementById('wtEditPop');
    if(pop && !pop.contains(e.target)) wtCloseEditPop();
  }

  window.wtCloseEditPop = function(){
    document.getElementById('wtEditPop').classList.remove('show');
    _editMode=null;
  };

  window.wtSaveEditPop = function(){
    const val = document.getElementById('wtEditPopTime').value;
    if(!val) return wtCloseEditPop();
    const live = getLive();
    const rec  = getRec();
    const today = todayStr();

    if(_editMode==='in'){
      if(live){
        // 근무 중 → live 업데이트
        live.start = val;
        localStorage.setItem(KEY_LIVE, JSON.stringify(live));
      } else if(rec[today]){
        // 이미 퇴근 → 기록 업데이트
        rec[today].in = val;
        saveRec(rec);
      }
    } else if(_editMode==='out'){
      if(rec[today]){
        rec[today].out = val;
        saveRec(rec);
      }
    }
    wtCloseEditPop();
    if(typeof wmRenderAll==='function') wmRenderAll();
  };

  /* ── 근무관리 패널 ── */
  let _wmTab='dash', _wmCalY=new Date().getFullYear(), _wmCalM=new Date().getMonth();

  window.wmRenderAll = function(){
    switch(_wmTab){
      case 'dash': wmRenderDash(); break;
      case 'cal':  wmRenderCal();  break;
      case 'year': wmRenderYear(); break;
    }
  };

  function wmRenderDash(){
    const y=new Date().getFullYear(), m=new Date().getMonth();
    const rec=getRec(); let days=0,wm=0,ot=0,lv=0,ylv=0;
    Object.keys(rec).forEach(ds=>{
      const[ry,rm]=ds.split('-').map(Number);
      const r=rec[ds];
      if(ry===y){
        ylv += leaveDays(r.type);
      }
      if(ry!==y||rm!==m+1) return;
      if(['leave','half','half2','holiday'].includes(r.type)){lv += leaveDays(r.type); return;}
      if(r.in&&r.out){days++;wm+=workMins(r);ot+=otMins(r);}
    });
    const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
    set('wm-mdays',days); set('wm-mhours',fmtH(wm)); set('wm-mot',fmtH(ot)); set('wm-mtotal',fmtH(wm+ot)); set('wm-leave',fmtLv(ylv)+'/'+TOTAL_LV);
    const lastD=new Date(y,m+1,0).getDate();
    const container=document.getElementById('wmMonthChart'); if(!container)return;
    const maxMins=Math.max(STD_WORK+120,...Object.keys(rec).filter(ds=>ds.startsWith(y+'-'+pad2(m+1))).map(ds=>workMins(rec[ds])+otMins(rec[ds])));
    let html='';
    for(let d=1;d<=lastD;d++){
      const ds=y+'-'+pad2(m+1)+'-'+pad2(d); const r=rec[ds];
      const wM=r&&r.in&&r.out?workMins(r):0, oM=r&&r.in&&r.out?otMins(r):0;
      const pct=maxMins>0?((wM+oM)/maxMins)*100:0;
      const isOT=oM>0;
      html+=`<div class="wm-bar-wrap" onclick="wmOpenModal('${ds}')">
        ${isOT?'<div class="wm-bar-ot-tag">+'+fmtH(oM)+'</div>':''}
        <div class="wm-bar-bg" style="height:${Math.max(pct,2)}px">
          <div class="wm-bar-fill ${isOT?'ot-bar hl':'normal'}" style="height:100%"></div>
        </div>
        <div class="wm-bar-label">${d}</div>
      </div>`;
    }
    container.innerHTML=html;
  }

  function wmRenderCal(){
    const y=_wmCalY,m=_wmCalM;
    const lbl=document.getElementById('wmMonthLabel'); if(lbl)lbl.textContent=y+'년 '+(m+1)+'월';
    const grid=document.getElementById('wmCalGrid'); if(!grid)return;
    const rec=getRec(),today=todayStr();
    const firstDay=new Date(y,m,1).getDay(), lastDate=new Date(y,m+1,0).getDate(), prevLast=new Date(y,m,0).getDate();
    let cells='';
    for(let i=0;i<firstDay;i++) cells+=`<div class="wm-cal-cell other"><div class="wm-cal-day">${prevLast-firstDay+1+i}</div></div>`;
    for(let d=1;d<=lastDate;d++){
      const ds=y+'-'+pad2(m+1)+'-'+pad2(d); const r=rec[ds]||{};
      let cls='wm-cal-cell',badge='',hrs='';
      if(ds===today)cls+=' today';
      if(r.type==='leave'||r.type==='half'||r.type==='half2'||r.type==='holiday'){
        cls+=' leave-day'; badge=`<div class="wm-leave-badge">${r.type==='leave'?'연차':r.type==='half'?'반차':r.type==='half2'?'반반차':'공휴'}</div>`;
      } else if(r.in&&r.out){
        const w=workMins(r), ot=otMins(r), total=w+ot; cls+=ot>0?' ot-day':' has-work'; hrs=ot>0?`${fmtH(w)} + ${fmtH(ot)}`:fmtH(total);
        if(ot>0)badge=`<div class="wm-ot-badge">총 ${fmtH(total)}</div>`;
      }
      cells+=`<div class="${cls}" onclick="wmOpenModal('${ds}')"><div class="wm-cal-day">${d}</div><div class="wm-cal-hrs">${hrs}</div>${badge}</div>`;
    }
    const rem=(firstDay+lastDate)%7===0?0:7-(firstDay+lastDate)%7;
    for(let i=1;i<=rem;i++) cells+=`<div class="wm-cal-cell other"><div class="wm-cal-day">${i}</div></div>`;
    grid.innerHTML=cells;
  }

  function wmRenderYear(){
    const y=new Date().getFullYear(); const rec=getRec();
    let ydays=0,ywm=0,yot=0,ylv=0; const monthly=Array(12).fill(null).map(()=>({wm:0,ot:0}));
    Object.keys(rec).forEach(ds=>{
      const[ry,rm]=ds.split('-').map(Number); if(ry!==y)return;
      const r=rec[ds];
      if(['leave','half','half2','holiday'].includes(r.type)){ylv+=leaveDays(r.type);return;}
      if(r.in&&r.out){const w=workMins(r),o=otMins(r);ydays++;ywm+=w;yot+=o;monthly[rm-1].wm+=w;monthly[rm-1].ot+=o;}
    });
    const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
    set('wm-ydays',ydays);set('wm-yhours',fmtH(ywm));set('wm-yot',fmtH(yot));set('wm-ytotal',fmtH(ywm+yot));set('wm-yleave',fmtLv(ylv)+'/'+TOTAL_LV);
    const container=document.getElementById('wmYearChart'); if(!container)return;
    const maxMins=Math.max(STD_WORK*22,...monthly.map(mo=>mo.wm+mo.ot));
    const mn=[1,2,3,4,5,6,7,8,9,10,11,12];
    let html='';
    monthly.forEach((mo,i)=>{
      const total=mo.wm+mo.ot,pct=maxMins>0?(total/maxMins)*100:0,isOT=mo.ot>0;
      html+=`<div class="wm-bar-wrap" onclick="wmToggleHL(this)">
        ${isOT?'<div class="wm-bar-ot-tag">+'+fmtH(mo.ot)+'</div>':''}
        <div class="wm-bar-bg" style="height:${Math.max(pct,2)}px">
          <div class="wm-bar-fill ${isOT?'ot-bar':'normal'}" style="height:100%"></div>
        </div>
        <div class="wm-bar-label">${mn[i]}월</div>
      </div>`;
    });
    container.innerHTML=html;
  }

  window.wmToggleHL=function(wrap){const f=wrap.querySelector('.wm-bar-fill.ot-bar');if(f)f.classList.toggle('hl');};

  function bindCalNav(){
    const prev=document.getElementById('wmPrev'),next=document.getElementById('wmNext');
    if(prev)prev.onclick=()=>{_wmCalM--;if(_wmCalM<0){_wmCalM=11;_wmCalY--;}wmRenderCal();};
    if(next)next.onclick=()=>{_wmCalM++;if(_wmCalM>11){_wmCalM=0;_wmCalY++;}wmRenderCal();};
  }

  function bindWmTabs(){
    document.querySelectorAll('.wm-tab-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        _wmTab=btn.dataset.wm;
        document.querySelectorAll('.wm-tab-btn').forEach(b=>b.classList.toggle('active',b===btn));
        document.querySelectorAll('.wm-panel').forEach(p=>p.classList.toggle('active',p.id==='wm-'+_wmTab));
        wmRenderAll();
      });
    });
  }

  window.wmOpenModal=function(ds){
    const rec=getRec()[ds]||{};
    document.getElementById('wmModalTitle').textContent=ds+' 근무';
    document.getElementById('wmModalDate').value=ds;
    document.getElementById('wmInDate').value=ds;
    document.getElementById('wmInStart').value=rec.in||'08:30';
    document.getElementById('wmInEnd').value=rec.out||'17:30';
    document.getElementById('wmInType').value=rec.type||'work';
    document.getElementById('wmInMemo').value=rec.memo||'';
    const del=document.getElementById('wmBtnDel'); if(del)del.style.display=(rec.in||['leave','half','half2','holiday'].includes(rec.type))?'':'none';
    document.getElementById('wmModalBg').classList.add('show');
  };
  window.wmCloseModal=function(){document.getElementById('wmModalBg').classList.remove('show');};
  window.wmSaveRecord=function(){
    const ds=document.getElementById('wmInDate').value,rec=getRec();
    const type=document.getElementById('wmInType').value;
    rec[ds]={in:document.getElementById('wmInStart').value,out:document.getElementById('wmInEnd').value,
      type,memo:document.getElementById('wmInMemo').value};
    if(['leave','half','half2','holiday'].includes(type)){ rec[ds].in=''; rec[ds].out=''; }
    saveRec(rec);wmCloseModal();wmRenderAll();
  };
  window.wmDeleteRecord=function(){
    const ds=document.getElementById('wmModalDate').value,rec=getRec();
    delete rec[ds];saveRec(rec);wmCloseModal();wmRenderAll();
  };

  window.initMarquee=function(){
    document.querySelectorAll('.name-ellipsis').forEach(el=>{
      if(el.scrollWidth>el.clientWidth){el.style.setProperty('--mq-d',-(el.scrollWidth-el.clientWidth+20)+'px');el.classList.add('mq');}
      else el.classList.remove('mq');
    });
  };

  document.addEventListener('DOMContentLoaded',()=>{
    wtUpdateBar(); bindCalNav(); bindWmTabs();
    document.getElementById('wmModalBg').addEventListener('click',function(e){if(e.target===this)wmCloseModal();});
    document.querySelectorAll('[data-tab]').forEach(btn=>{
      btn.addEventListener('click',()=>setTimeout(initMarquee,120));
    });
  });
})();

// ============================================================
// Edit-mode visual tweak logic
// ============================================================
// Edit-mode script: stores and applies visual tweak options.
(function(){
  const TWEAKS = /*EDITMODE-BEGIN*/{
    "dark": false,
    "compact": false,
    "bgTone": "warm",
    "accent": "blue"
  }/*EDITMODE-END*/;
  const state = Object.assign({}, TWEAKS);
  const panel = document.getElementById('tweaksPanel');
  const body = document.body;

  function applyBgTone(t){
    body.classList.remove('tone-warm','tone-cool','tone-neutral');
    body.classList.add('tone-'+t);
    const styles = {
      warm:   { bg:'#f2efe9', card:'#ffffff', cardAlt:'#faf8f3', glass:'rgba(252,250,245,0.74)' },
      cool:   { bg:'#eff1f4', card:'#ffffff', cardAlt:'#f7f8fa', glass:'rgba(248,250,253,0.74)' },
      neutral:{ bg:'#f0f0ef', card:'#ffffff', cardAlt:'#f9f9f8', glass:'rgba(251,251,250,0.74)' }
    }[t] || {};
    if (!body.classList.contains('dark-mode')) {
      document.documentElement.style.setProperty('--bg', styles.bg);
      document.documentElement.style.setProperty('--card', styles.card);
      document.documentElement.style.setProperty('--card-alt', styles.cardAlt);
      document.documentElement.style.setProperty('--glass', styles.glass);
    }
  }

  function applyAccent(a){
    const map = {
      blue:    { c:'#1f63e8', bg:'rgba(31,99,232,0.08)', bd:'rgba(31,99,232,0.2)' },
      green:   { c:'#1f8a48', bg:'rgba(31,138,72,0.09)', bd:'rgba(31,138,72,0.2)' },
      purple:  { c:'#7a4bc1', bg:'rgba(122,75,193,0.09)', bd:'rgba(122,75,193,0.2)' },
      orange:  { c:'#c8700a', bg:'rgba(200,112,10,0.1)', bd:'rgba(200,112,10,0.22)' },
      graphite:{ c:'#2a2a30', bg:'rgba(42,42,48,0.07)', bd:'rgba(42,42,48,0.2)' }
    };
    const v = map[a] || map.blue;
    document.documentElement.style.setProperty('--blue', v.c);
    document.documentElement.style.setProperty('--blue-bg', v.bg);
    document.documentElement.style.setProperty('--blue-border', v.bd);
  }

  function apply(){
    body.classList.toggle('dark-mode', !!state.dark);
    body.classList.toggle('density-compact', !!state.compact);
    applyBgTone(state.bgTone);
    applyAccent(state.accent);
    document.getElementById('twDark').classList.toggle('on', !!state.dark);
    document.getElementById('twCompact').classList.toggle('on', !!state.compact);
    document.getElementById('twBgTone').value = state.bgTone;
    document.getElementById('twAccent').value = state.accent;
  }

  function persist(keys){
    try {
      window.parent.postMessage({type:'__edit_mode_set_keys', edits: keys}, '*');
    } catch(e){}
    try {
      const saved = JSON.parse(localStorage.getItem('wb_tweaks_v22')||'{}');
      Object.assign(saved, keys);
      localStorage.setItem('wb_tweaks_v22', JSON.stringify(saved));
    } catch(e){}
  }

  // Load local persistence
  try {
    const saved = JSON.parse(localStorage.getItem('wb_tweaks_v22')||'{}');
    Object.assign(state, saved);
  } catch(e){}

  document.getElementById('twDark').addEventListener('click', () => {
    state.dark = !state.dark; apply(); persist({dark: state.dark});
  });
  document.getElementById('twCompact').addEventListener('click', () => {
    state.compact = !state.compact; apply(); persist({compact: state.compact});
  });
  document.getElementById('twBgTone').addEventListener('change', e => {
    state.bgTone = e.target.value; apply(); persist({bgTone: state.bgTone});
  });
  document.getElementById('twAccent').addEventListener('change', e => {
    state.accent = e.target.value; apply(); persist({accent: state.accent});
  });

  // Edit mode protocol
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === '__activate_edit_mode') panel.classList.add('show');
    if (d.type === '__deactivate_edit_mode') panel.classList.remove('show');
  });
  try { window.parent.postMessage({type:'__edit_mode_available'}, '*'); } catch(e){}

  apply();
})();
