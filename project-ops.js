// Project operation page with goals, milestones, and timeline planning.
(function () {
  'use strict';

  const OPS_KEY = 'work_project_ops_v1';
  const ACTIVE_TAB_KEY = 'work_board_active_tab';
  const OPS_ACTIVE_KEY = 'work_project_ops_active';
  const STATUS_LIST = ['미진행', '진행중', '대기', '완료'];
  const OPS_STATUS_LIST = ['정상', '주의', '지연', '보류', '완료'];
  const TIMELINE_VIEW_LIST = ['daily', 'weekly', 'monthly'];
  const TIMELINE_VIEW_LABELS = {
    daily: 'Daily',
    weekly: 'Weekly',
    monthly: 'Monthly'
  };

  const $ = (id) => document.getElementById(id);

  let activeProjectFilter = '전체';
  let activeStatusFilter = '전체';
  let activeEditorProject = '';
  let timelineView = 'weekly';
  let timelineCursor = new Date();
  let timelineAxisDrag = null;
  let timelineAxisWheelLocked = false;

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

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeDate(value) {
    const text = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
  }

  function parseDate(value) {
    const date = normalizeDate(value);
    if (!date) return null;
    const parts = date.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
  }

  function toDateInput(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function formatDate(value) {
    const date = parseDate(value);
    if (!date) return '-';
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function addMonths(date, months) {
    const next = new Date(date);
    next.setMonth(next.getMonth() + months);
    return next;
  }

  function addYears(date, years) {
    const next = new Date(date);
    next.setFullYear(next.getFullYear() + years);
    return next;
  }

  function startOfDay(date) {
    const next = new Date(date);
    next.setHours(0, 0, 0, 0);
    return next;
  }

  function endOfDay(date) {
    const next = new Date(date);
    next.setHours(23, 59, 59, 999);
    return next;
  }

  function startOfWeek(date) {
    const base = startOfDay(date);
    const day = base.getDay();
    return addDays(base, day === 0 ? -6 : 1 - day);
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  }

  function endOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
  }

  function startOfYear(date) {
    return new Date(date.getFullYear(), 0, 1, 0, 0, 0, 0);
  }

  function endOfYear(date) {
    return new Date(date.getFullYear(), 11, 31, 23, 59, 59, 999);
  }

  function daysInclusive(startDate, endDate) {
    if (!startDate || !endDate) return 0;
    return Math.max(1, Math.round((endDate - startDate) / 86400000) + 1);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function readOps() {
    const ops = readJson(OPS_KEY, {});
    return ops && typeof ops === 'object' && !Array.isArray(ops) ? ops : {};
  }

  function getProjectEntries(ops = readOps()) {
    return Object.keys(ops)
      .map((name) => String(name || '').trim())
      .filter(Boolean)
      .map((name) => {
        const order = Number(ops[name]?.order);
        return {
          name,
          order: Number.isFinite(order) ? order : null
        };
      })
      .sort((a, b) => {
        if (a.order != null || b.order != null) {
          const orderDiff = (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
          if (orderDiff !== 0) return orderDiff;
        }
        return a.name.localeCompare(b.name, 'ko');
      });
  }

  function getProjectNames() {
    return getProjectEntries().map((entry) => entry.name);
  }

  function getNextProjectOrder(ops) {
    const orders = getProjectEntries(ops)
      .map((entry) => entry.order)
      .filter((order) => order != null);
    return orders.length ? Math.max(...orders) + 1 : getProjectEntries(ops).length;
  }

  function saveProjectOrder(ops, orderedNames) {
    orderedNames.forEach((name, index) => {
      if (ops[name]) ops[name] = { ...ops[name], order: index };
    });
  }

  function createStageId(index = 0) {
    return `stage_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function estimateProgress(status, startDate, endDate) {
    if (status === '완료') return 100;
    if (status === '미진행' || status === '대기') return 0;
    const start = parseDate(startDate);
    const end = parseDate(endDate);
    if (!start || !end) return 50;
    const total = Math.max(1, end - start);
    return clamp(Math.round(((new Date() - start) / total) * 100), 5, 95);
  }

  function normalizeStage(stage, index, fallbackOwner) {
    const status = STATUS_LIST.includes(stage?.status) ? stage.status : '미진행';
    const startDate = normalizeDate(stage?.startDate);
    const endDate = normalizeDate(stage?.endDate);
    const explicitProgress = Number(stage?.progress);
    return {
      id: String(stage?.id || createStageId(index)),
      name: String(stage?.name || '').trim(),
      owner: String(stage?.owner || fallbackOwner || '').trim(),
      startDate,
      endDate,
      status,
      progress: Number.isFinite(explicitProgress) ? clamp(Math.round(explicitProgress), 0, 100) : estimateProgress(status, startDate, endDate),
      memo: String(stage?.memo || '').trim()
    };
  }

  function normalizeMilestone(raw, index) {
    return {
      id: String(raw?.id || `mile_${Date.now()}_${index}`),
      title: String(raw?.title || '').trim(),
      date: normalizeDate(raw?.date),
      status: ['예정', '진행', '완료', '지연'].includes(raw?.status) ? raw.status : '예정'
    };
  }

  function getDateValues(values) {
    return values.map(parseDate).filter(Boolean);
  }

  function inferDateBounds(opsProject) {
    const stageStarts = Array.isArray(opsProject?.stages) ? opsProject.stages.map((stage) => stage.startDate) : [];
    const stageEnds = Array.isArray(opsProject?.stages) ? opsProject.stages.map((stage) => stage.endDate) : [];
    const milestoneDates = Array.isArray(opsProject?.milestones) ? opsProject.milestones.map((milestone) => milestone.date) : [];
    const starts = getDateValues([
      opsProject?.startDate,
      ...stageStarts,
      ...milestoneDates
    ]);
    const ends = getDateValues([
      opsProject?.endDate,
      ...stageEnds,
      ...milestoneDates
    ]);
    const today = new Date();
    const start = starts.length ? new Date(Math.min(...starts.map((date) => date.getTime()))) : new Date(today.getFullYear(), today.getMonth(), 1);
    const end = ends.length ? new Date(Math.max(...ends.map((date) => date.getTime()))) : addDays(start, 30);
    return { startDate: toDateInput(start), endDate: toDateInput(end < start ? addDays(start, 14) : end) };
  }

  function statusFromProject(opsProject) {
    if (OPS_STATUS_LIST.includes(opsProject?.status)) return opsProject.status;
    const end = parseDate(opsProject?.endDate);
    if (end && end < startOfDay(new Date())) return '지연';
    return '정상';
  }

  function projectProgress(project) {
    if (project.stages.length) {
      return Math.round(project.stages.reduce((sum, stage) => sum + stage.progress, 0) / project.stages.length);
    }
    return project.status === '완료' ? 100 : 0;
  }

  function getProjectModel(name, ops = readOps()) {
    const saved = ops[name] || {};
    const bounds = inferDateBounds(saved);
    const owner = String(saved.owner || '').trim();
    const stages = Array.isArray(saved.stages)
      ? saved.stages.map((stage, index) => normalizeStage(stage, index, owner)).filter((stage) => stage.name)
      : [];
    const milestones = Array.isArray(saved.milestones)
      ? saved.milestones.map(normalizeMilestone).filter((milestone) => milestone.title)
      : [];
    const project = {
      name,
      goal: String(saved.goal || '').trim(),
      owner,
      status: statusFromProject(saved),
      startDate: normalizeDate(saved.startDate) || bounds.startDate,
      endDate: normalizeDate(saved.endDate) || bounds.endDate,
      nextAction: String(saved.nextAction || '').trim(),
      issue: String(saved.issue || '').trim(),
      stages,
      milestones,
      order: Number.isFinite(Number(saved.order)) ? Number(saved.order) : null,
      updatedAt: saved.updatedAt || ''
    };
    project.progress = projectProgress(project);
    return project;
  }

  function getProjects() {
    const ops = readOps();
    return getProjectNames().map((name) => getProjectModel(name, ops));
  }

  function statusClass(status) {
    return {
      정상: 'normal',
      주의: 'watch',
      지연: 'delay',
      보류: 'hold',
      완료: 'done'
    }[status] || 'normal';
  }

  function taskStatusClass(status) {
    return {
      미진행: 'todo',
      진행중: 'doing',
      대기: 'hold',
      완료: 'done'
    }[status] || 'todo';
  }

  function getFilteredProjects(projects = getProjects()) {
    return projects.filter((project) => {
      const projectMatch = activeProjectFilter === '전체' || project.name === activeProjectFilter;
      const statusMatch = activeStatusFilter === '전체' || project.status === activeStatusFilter;
      return projectMatch && statusMatch;
    });
  }

  function ensureVisibleFilters(projects) {
    if (activeProjectFilter !== '전체' && !projects.some((project) => project.name === activeProjectFilter)) {
      activeProjectFilter = '전체';
    }
    if (activeStatusFilter !== '전체' && !OPS_STATUS_LIST.includes(activeStatusFilter)) {
      activeStatusFilter = '전체';
    }
    const filtered = getFilteredProjects(projects);
    if (projects.length && !filtered.length) {
      activeProjectFilter = '전체';
      activeStatusFilter = '전체';
    }
  }

  function renderSummary(projects) {
    const total = projects.length;
    const active = projects.filter((project) => project.status !== '완료' && project.status !== '보류').length;
    const risk = projects.filter((project) => project.status === '주의' || project.status === '지연').length;
    const done = projects.filter((project) => project.status === '완료').length;
    const avg = total ? Math.round(projects.reduce((sum, project) => sum + project.progress, 0) / total) : 0;
    const stats = [
      ['전체 프로젝트', total, ''],
      ['운영중', active, 'blue'],
      ['리스크', risk, 'orange'],
      ['완료', done, 'green'],
      ['평균 진행률', `${avg}%`, 'purple']
    ];
    const target = $('opsSummary');
    if (!target) return;
    target.innerHTML = stats.map(([label, value, tone]) => `
      <div class="ops-stat">
        <div class="ops-stat-value ${tone ? `tone-${tone}` : ''}">${escapeHtml(value)}</div>
        <div class="ops-stat-label">${escapeHtml(label)}</div>
      </div>
    `).join('');
  }

  function renderFilters(projects) {
    const projectSelect = $('opsProjectFilter');
    const statusSelect = $('opsStatusFilter');
    if (projectSelect) {
      const current = activeProjectFilter;
      projectSelect.innerHTML = ['전체', ...projects.map((project) => project.name)]
        .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
        .join('');
      activeProjectFilter = current === '전체' || projects.some((project) => project.name === current) ? current : '전체';
      projectSelect.value = activeProjectFilter;
    }
    if (statusSelect) {
      statusSelect.innerHTML = ['전체', ...OPS_STATUS_LIST]
        .map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`)
        .join('');
      statusSelect.value = activeStatusFilter;
    }
  }

  function renderProjectList(projects) {
    const target = $('opsProjectList');
    if (!target) return;
    if (!projects.length) {
      target.innerHTML = '<div class="empty">표시할 프로젝트 없음</div>';
      return;
    }
    target.innerHTML = projects.map((project) => `
      <button type="button" class="ops-project-card" data-ops-edit="${escapeHtml(project.name)}">
        <div class="ops-project-main">
          <span class="ops-status ops-${statusClass(project.status)}">${escapeHtml(project.status)}</span>
          <strong>${escapeHtml(project.name)}</strong>
          <span>${escapeHtml(project.owner || '담당 미정')}</span>
        </div>
        <div class="ops-project-goal">${escapeHtml(project.goal || '목표 미입력')}</div>
        <div class="ops-progress-line">
          <span style="width:${project.progress}%"></span>
        </div>
        <div class="ops-project-meta">
          <span>${escapeHtml(formatDate(project.startDate))} ~ ${escapeHtml(formatDate(project.endDate))}</span>
          <span>단계 ${project.stages.length}</span>
          <span>마일스톤 ${project.milestones.length}</span>
          <span>${project.progress}%</span>
        </div>
      </button>
    `).join('');
  }

  function getTimelineRows(projects) {
    const rows = [];
    projects.forEach((project) => {
      const sourceRows = project.stages.length
        ? project.stages.map((stage) => ({
            project,
            stageId: stage.id,
            label: stage.name,
            owner: stage.owner || project.owner,
            startDate: stage.startDate || project.startDate,
            endDate: stage.endDate || project.endDate,
            status: stage.status,
            progress: stage.progress,
            memo: stage.memo
          }))
        : [];

      const safeRows = sourceRows.length ? sourceRows : [{
        project,
        stageId: '',
        label: '운영 계획',
        owner: project.owner,
        startDate: project.startDate,
        endDate: project.endDate,
        status: project.status === '완료' ? '완료' : '진행중',
        progress: project.progress,
        memo: project.goal
      }];

      safeRows.forEach((row, index) => rows.push({ ...row, firstInProject: index === 0 }));
    });
    return rows;
  }

  function getTimelineRange() {
    if (timelineView === 'daily') {
      const start = startOfWeek(timelineCursor);
      return { start, end: endOfDay(addDays(start, 6)) };
    }
    if (timelineView === 'monthly') {
      return { start: startOfYear(timelineCursor), end: endOfYear(timelineCursor) };
    }
    return { start: startOfMonth(timelineCursor), end: endOfMonth(timelineCursor) };
  }

  function formatTimelineRange(range) {
    if (timelineView === 'daily') return `${formatDate(toDateInput(range.start))} ~ ${formatDate(toDateInput(range.end))}`;
    if (timelineView === 'monthly') return `${range.start.getFullYear()}년`;
    return `${range.start.getFullYear()}년 ${range.start.getMonth() + 1}월`;
  }

  function moveTimelinePeriod(direction) {
    const step = Number(direction) < 0 ? -1 : 1;
    if (timelineView === 'daily') timelineCursor = addDays(timelineCursor, step * 7);
    else if (timelineView === 'monthly') timelineCursor = addYears(timelineCursor, step);
    else timelineCursor = addMonths(timelineCursor, step);
    renderOpsPage();
  }

  function setTimelineView(view) {
    if (!TIMELINE_VIEW_LIST.includes(view)) return;
    timelineView = view;
    renderOpsPage();
  }

  function resetTimelineCursor() {
    timelineCursor = new Date();
    renderOpsPage();
  }

  function getAxisTicks(range) {
    const centerOffset = (start, end) => {
      const midpoint = start.getTime() + ((end.getTime() - start.getTime()) / 2);
      return ((midpoint - range.start.getTime()) / Math.max(1, range.end.getTime() - range.start.getTime())) * 100;
    };
    const ticks = [];

    if (timelineView === 'daily') {
      for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
        const start = addDays(range.start, dayIndex);
        ticks.push({
          label: `${start.getMonth() + 1}/${start.getDate()}`,
          offset: centerOffset(start, endOfDay(start))
        });
      }
      return ticks;
    }

    if (timelineView === 'weekly') {
      let weekStart = startOfDay(range.start);
      let weekIndex = 1;
      while (weekStart <= range.end) {
        const weekEnd = endOfDay(new Date(Math.min(addDays(weekStart, 6).getTime(), range.end.getTime())));
        ticks.push({
          label: `${weekIndex}주차`,
          offset: centerOffset(weekStart, weekEnd)
        });
        weekStart = addDays(weekStart, 7);
        weekIndex += 1;
      }
      return ticks;
    }

    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      const start = new Date(range.start.getFullYear(), monthIndex, 1, 0, 0, 0, 0);
      ticks.push({
        label: `${monthIndex + 1}월`,
        offset: centerOffset(start, endOfMonth(start))
      });
    }
    return ticks;
  }

  function getTimelineMoveText(direction) {
    const unit = timelineView === 'daily' ? '주' : timelineView === 'weekly' ? '월' : '년';
    return direction < 0 ? `이전 ${unit}` : `다음 ${unit}`;
  }

  function getBarStyle(row, range) {
    const metrics = getBarMetrics(row, range);
    return metrics ? `left:${metrics.left}%;width:${metrics.width}%;` : '';
  }

  function getBarMetrics(row, range) {
    const start = parseDate(row.startDate) || range.start;
    const end = endOfDay(parseDate(row.endDate) || start);
    if (end < range.start || start > range.end) return null;
    const visibleStart = start < range.start ? range.start : start;
    const visibleEnd = end > range.end ? range.end : end;
    const left = clamp(((visibleStart - range.start) / Math.max(1, range.end - range.start)) * 100, 0, 100);
    const right = clamp(((visibleEnd - range.start) / Math.max(1, range.end - range.start)) * 100, 0, 100);
    const width = Math.max(1.5, right - left);
    return { left, width };
  }

  function getProgressBarStyle(row, range) {
    if (row.progress <= 0) return '';
    const metrics = getBarMetrics(row, range);
    if (!metrics) return '';
    const progressWidth = metrics.width * (clamp(row.progress, 0, 100) / 100);
    return `left:${metrics.left}%;width:${Math.max(1.5, progressWidth)}%;`;
  }

  function getDoneDays(row) {
    const start = parseDate(row.startDate);
    const end = parseDate(row.endDate);
    return Math.round(daysInclusive(start, end) * (clamp(row.progress, 0, 100) / 100));
  }

  function renderProjectTimelineCell(row) {
    if (!row.firstInProject) return '';
    return `
      <div class="ops-inline-project">
        <span class="ops-project-name" title="${escapeHtml(row.project.name)}">${escapeHtml(row.project.name)}</span>
        <span class="ops-order-controls">
          <button type="button" class="ops-order-btn" data-ops-move-project="up" data-ops-project-name="${escapeHtml(row.project.name)}" title="프로젝트 위로">&#8593;</button>
          <button type="button" class="ops-order-btn" data-ops-move-project="down" data-ops-project-name="${escapeHtml(row.project.name)}" title="프로젝트 아래로">&#8595;</button>
        </span>
      </div>
    `;
  }

  function renderTaskTimelineCell(row) {
    return `
      <div class="ops-inline-task">
        <input class="ops-inline-input ops-task-name-input" data-ops-inline-field="name" type="text" value="${escapeHtml(row.label || '')}" title="${escapeHtml(row.memo || row.label || '')}" placeholder="Task">
        <span class="ops-order-controls">
          <button type="button" class="ops-order-btn" data-ops-move-stage="up" data-ops-stage-project="${escapeHtml(row.project.name)}" data-ops-stage-id="${escapeHtml(row.stageId || '')}" title="Task 위로" ${row.stageId ? '' : 'disabled'}>&#8593;</button>
          <button type="button" class="ops-order-btn" data-ops-move-stage="down" data-ops-stage-project="${escapeHtml(row.project.name)}" data-ops-stage-id="${escapeHtml(row.stageId || '')}" title="Task 아래로" ${row.stageId ? '' : 'disabled'}>&#8595;</button>
        </span>
      </div>
    `;
  }

  function focusTimelineInput(stageId, field = 'name') {
    if (!stageId) return;
    window.setTimeout(() => {
      const target = $('opsTimeline');
      const row = Array.from(target?.querySelectorAll('[data-ops-stage-id]') || [])
        .find((item) => item.dataset.opsStageId === stageId);
      const input = row?.querySelector(`[data-ops-inline-field="${field}"]`) || row?.querySelector('[data-ops-inline-field="name"]');
      input?.focus();
      if (input?.select && input.type !== 'date') input.select();
    }, 0);
  }

  function renderTimeline(projects, options = {}) {
    const target = $('opsTimeline');
    if (!target) return;
    const range = getTimelineRange();
    const rows = getTimelineRows(projects);
    const label = $('opsTimelineLabel');
    if (label) label.textContent = formatTimelineRange(range);
    document.querySelectorAll('[data-ops-view]').forEach((button) => {
      button.classList.toggle('active', button.dataset.opsView === timelineView);
    });
    if (!rows.length) {
      target.innerHTML = '<div class="empty">해당 기간 타임라인 없음</div>';
      return;
    }
    const axis = getAxisTicks(range);
    const today = new Date();
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const showToday = todayDate >= range.start && todayDate <= range.end;
    const todayOffset = clamp(((todayDate - range.start) / Math.max(1, range.end - range.start)) * 100, 0, 100);
    const gridStep = 100 / Math.max(1, axis.length);
    target.innerHTML = `
      <div class="ops-timeline-grid ops-timeline-${timelineView}" style="--ops-grid-step:${gridStep}%">
        <div class="ops-timeline-row ops-timeline-head">
          <div>프로젝트명</div>
          <div>task</div>
          <div>담당PM</div>
          <div>착수일</div>
          <div>완료일</div>
          <div>업무일</div>
          <div>완료일수</div>
          <div>진행률</div>
          <div class="ops-axis" data-ops-axis title="좌우 드래그 또는 가로 스크롤로 기간 이동">
            ${axis.map((tick) => `<span style="left:${tick.offset}%">${escapeHtml(tick.label)}</span>`).join('')}
            <button type="button" class="ops-axis-nav ops-axis-prev" data-ops-axis-move="-1" title="${escapeHtml(getTimelineMoveText(-1))}" aria-label="${escapeHtml(getTimelineMoveText(-1))}">&#8249;</button>
            <button type="button" class="ops-axis-nav ops-axis-next" data-ops-axis-move="1" title="${escapeHtml(getTimelineMoveText(1))}" aria-label="${escapeHtml(getTimelineMoveText(1))}">&#8250;</button>
          </div>
        </div>
        ${rows.map((row) => {
          const totalDays = daysInclusive(parseDate(row.startDate), parseDate(row.endDate));
          const barStyle = getBarStyle(row, range);
          const progressBarStyle = getProgressBarStyle(row, range);
          return `
            <div class="ops-timeline-row ops-timeline-task-row" data-ops-stage-project="${escapeHtml(row.project.name)}" data-ops-stage-id="${escapeHtml(row.stageId || '')}">
              <div class="ops-project-cell">${renderProjectTimelineCell(row)}</div>
              <div class="ops-task-cell">${renderTaskTimelineCell(row)}</div>
              <div><input class="ops-inline-input" data-ops-inline-field="owner" type="text" value="${escapeHtml(row.owner || '')}" placeholder="담당"></div>
              <div><input class="ops-inline-input ops-date-input" data-ops-inline-field="startDate" type="date" value="${escapeHtml(normalizeDate(row.startDate))}"></div>
              <div><input class="ops-inline-input ops-date-input" data-ops-inline-field="endDate" type="date" value="${escapeHtml(normalizeDate(row.endDate))}"></div>
              <div>${totalDays || '-'}</div>
              <div>${getDoneDays(row) || 0}</div>
              <div>
                <div class="ops-inline-progress">
                  <input class="ops-inline-input ops-progress-input" data-ops-inline-field="progress" type="number" min="0" max="100" value="${row.progress}">
                  <span>%</span>
                </div>
              </div>
              <div class="ops-bar-cell ${barStyle ? '' : 'ops-outside-range'}">
                ${showToday ? `<span class="ops-today-line" style="left:${todayOffset}%"></span>` : ''}
                ${barStyle ? `<span class="ops-bar-bg" style="${barStyle}"></span>` : ''}
                ${progressBarStyle ? `<span class="ops-bar-fill ops-task-${taskStatusClass(row.status)}" style="${progressBarStyle}"></span>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
    if (options.focusTimelineStageId) focusTimelineInput(options.focusTimelineStageId, options.focusTimelineField);
  }

  function renderMilestones(projects) {
    const target = $('opsMilestones');
    if (!target) return;
    const milestones = projects.flatMap((project) => project.milestones.map((milestone) => ({ ...milestone, project: project.name })))
      .sort((a, b) => (parseDate(a.date)?.getTime() || Number.MAX_SAFE_INTEGER) - (parseDate(b.date)?.getTime() || Number.MAX_SAFE_INTEGER))
      .slice(0, 10);
    if (!milestones.length) {
      target.innerHTML = '<div class="empty">등록된 마일스톤 없음</div>';
      return;
    }
    target.innerHTML = milestones.map((milestone) => `
      <div class="ops-milestone">
        <span class="ops-mile-status ops-mile-${escapeHtml(milestone.status)}">${escapeHtml(milestone.status)}</span>
        <div>
          <strong>${escapeHtml(milestone.title)}</strong>
          <span>${escapeHtml(milestone.project)} · ${escapeHtml(formatDate(milestone.date))}</span>
        </div>
      </div>
    `).join('');
  }

  function renderIssueBoard(projects) {
    const target = $('opsIssues');
    if (!target) return;
    const items = projects
      .filter((project) => project.issue || project.nextAction || project.status === '지연' || project.status === '주의')
      .slice(0, 8);
    if (!items.length) {
      target.innerHTML = '<div class="empty">관리 중인 이슈 없음</div>';
      return;
    }
    target.innerHTML = items.map((project) => `
      <button type="button" class="ops-issue" data-ops-edit="${escapeHtml(project.name)}">
        <span class="ops-status ops-${statusClass(project.status)}">${escapeHtml(project.status)}</span>
        <div>
          <strong>${escapeHtml(project.name)}</strong>
          <p>${escapeHtml(project.issue || project.nextAction || '이슈 미입력')}</p>
        </div>
      </button>
    `).join('');
  }

  function renderOpsPage(options = {}) {
    const projects = getProjects();
    if (options.ensureVisible) ensureVisibleFilters(projects);
    renderFilters(projects);
    const filtered = getFilteredProjects(projects);
    renderSummary(filtered);
    renderProjectList(filtered);
    renderTimeline(filtered, options);
    renderMilestones(filtered);
    renderIssueBoard(filtered);
  }

  function createPageShell() {
    if (!$('page-ops')) {
      const workPage = $('page-work');
      const page = document.createElement('section');
      page.className = 'page';
      page.id = 'page-ops';
      page.innerHTML = `
        <div class="ops-layout">
          <div class="ops-head">
            <div>
              <div class="card-title">PROJECT OPERATIONS</div>
              <h2>프로젝트 운영</h2>
            </div>
            <div class="ops-actions">
              <select id="opsProjectFilter" class="select ops-filter"></select>
              <select id="opsStatusFilter" class="select ops-filter"></select>
              <button type="button" class="btn btn-secondary" id="opsEditSelected">편집</button>
              <button type="button" class="btn btn-primary" id="opsAddProject">프로젝트 추가</button>
            </div>
          </div>
          <div class="ops-summary" id="opsSummary"></div>
          <div class="ops-main-grid">
            <div class="card ops-card">
              <div class="card-head">
                <div class="card-title">GOALS</div>
              </div>
              <div class="ops-project-list" id="opsProjectList"></div>
            </div>
            <div class="card ops-card">
              <div class="card-head">
                <div class="card-title">MILESTONES</div>
              </div>
              <div class="ops-side-list" id="opsMilestones"></div>
            </div>
          </div>
          <div class="card ops-card">
            <div class="card-head">
              <div class="card-title">TIMELINE</div>
              <div class="ops-timeline-controls">
                <div class="ops-view-tabs">
                  ${TIMELINE_VIEW_LIST.map((view) => `<button type="button" class="ops-view-btn" data-ops-view="${view}">${TIMELINE_VIEW_LABELS[view]}</button>`).join('')}
                </div>
                <button type="button" class="report-nav-btn" id="opsTimelinePrev">&#8249;</button>
                <div class="report-label ops-timeline-label" id="opsTimelineLabel"></div>
                <button type="button" class="report-nav-btn" id="opsTimelineNext">&#8250;</button>
                <button type="button" class="btn btn-secondary ops-today-btn" id="opsTimelineToday">오늘</button>
                <button type="button" class="btn btn-secondary ops-today-btn" id="opsTimelineAddTask">Task 추가</button>
              </div>
            </div>
            <div class="ops-timeline-scroll" id="opsTimeline"></div>
          </div>
          <div class="card ops-card">
            <div class="card-head">
              <div class="card-title">RISKS & NEXT</div>
            </div>
            <div class="ops-issue-list" id="opsIssues"></div>
          </div>
        </div>
      `;
      if (workPage) workPage.before(page);
      else document.querySelector('.wrap')?.appendChild(page);
    }

    if (!$('opsModal')) {
      const modal = document.createElement('div');
      modal.className = 'modal';
      modal.id = 'opsModal';
      modal.innerHTML = `
        <div class="modal-box ops-modal-box">
          <div class="modal-head">
            <div>
              <div class="modal-title" id="opsModalTitle">프로젝트 운영정보</div>
              <div class="modal-sub" id="opsModalSub">운영정보</div>
            </div>
            <button class="modal-close" type="button" id="opsModalClose">×</button>
          </div>
          <div class="modal-body">
            <input type="hidden" id="opsOriginalName">
            <div class="ops-form-grid">
              <div class="field">
                <label class="label" for="opsProjectName">프로젝트명</label>
                <input id="opsProjectName" class="input" type="text" placeholder="프로젝트명">
              </div>
              <div class="field">
                <label class="label" for="opsOwner">담당PM</label>
                <input id="opsOwner" class="input" type="text" placeholder="담당자">
              </div>
              <div class="field">
                <label class="label" for="opsStatus">운영 상태</label>
                <select id="opsStatus" class="select">${OPS_STATUS_LIST.map((status) => `<option value="${status}">${status}</option>`).join('')}</select>
              </div>
              <div class="field">
                <label class="label" for="opsStartDate">착수일</label>
                <input id="opsStartDate" class="input" type="date">
              </div>
              <div class="field">
                <label class="label" for="opsEndDate">완료일</label>
                <input id="opsEndDate" class="input" type="date">
              </div>
            </div>
            <div class="field">
              <label class="label" for="opsGoal">목표</label>
              <textarea id="opsGoal" class="textarea compact" placeholder="목표"></textarea>
            </div>
            <div class="ops-form-grid">
              <div class="field">
                <label class="label" for="opsNextAction">다음 액션</label>
                <textarea id="opsNextAction" class="textarea compact" placeholder="다음 액션"></textarea>
              </div>
              <div class="field">
                <label class="label" for="opsIssue">리스크/이슈</label>
                <textarea id="opsIssue" class="textarea compact" placeholder="리스크/이슈"></textarea>
              </div>
            </div>
            <div class="ops-editor-section">
              <div class="ops-editor-head">
                <div class="project-note-section-title">Timeline Tasks</div>
                <button type="button" class="btn btn-secondary" id="opsAddStage">단계 추가</button>
              </div>
              <div class="ops-stage-list" id="opsStageList"></div>
            </div>
            <div class="ops-editor-section">
              <div class="ops-editor-head">
                <div class="project-note-section-title">Milestones</div>
                <button type="button" class="btn btn-secondary" id="opsAddMilestone">마일스톤 추가</button>
              </div>
              <div class="ops-mile-list" id="opsMilestoneList"></div>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-danger" id="opsDeleteMeta">운영정보 삭제</button>
            <button type="button" class="btn btn-secondary" id="opsModalCancel">취소</button>
            <button type="button" class="btn btn-primary" id="opsModalSave">저장</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }
  }

  function ensureTab() {
    if (!$('tabOps')) {
      const tab = document.createElement('button');
      tab.className = 'tab';
      tab.dataset.tab = 'ops';
      tab.id = 'tabOps';
      tab.textContent = '프로젝트 운영';
      const monthly = document.querySelector('[data-tab="monthly"]');
      if (monthly) monthly.after(tab);
      else document.querySelector('.tabs')?.appendChild(tab);
    }
  }

  function showOpsPage() {
    document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === 'ops'));
    document.querySelectorAll('.page').forEach((page) => page.classList.toggle('active', page.id === 'page-ops'));
    sessionStorage.setItem(ACTIVE_TAB_KEY, 'ops');
    sessionStorage.setItem(OPS_ACTIVE_KEY, '1');
    renderOpsPage();
  }

  function patchWorkBoardRefresh() {
    const app = window.WorkBoardApp;
    if (!app || app.__projectOpsPatch || typeof app.refreshFromStorage !== 'function') return;
    const originalRefresh = app.refreshFromStorage.bind(app);
    app.refreshFromStorage = function projectOpsRefreshFromStorage() {
      const wasOpsActive = sessionStorage.getItem(ACTIVE_TAB_KEY) === 'ops' || $('page-ops')?.classList.contains('active');
      const result = originalRefresh();
      window.setTimeout(() => {
        renderOpsPage();
        if (wasOpsActive) showOpsPage();
      }, 0);
      return result;
    };
    app.__projectOpsPatch = true;
  }

  function createStageRow(stage = {}) {
    const row = document.createElement('div');
    row.className = 'ops-stage-row';
    if (stage.id) row.dataset.stageId = String(stage.id);
    row.innerHTML = `
      <input class="input" data-stage-field="name" type="text" placeholder="단계명" value="${escapeHtml(stage.name || '')}">
      <input class="input" data-stage-field="owner" type="text" placeholder="담당" value="${escapeHtml(stage.owner || '')}">
      <input class="input" data-stage-field="startDate" type="date" value="${escapeHtml(stage.startDate || '')}">
      <input class="input" data-stage-field="endDate" type="date" value="${escapeHtml(stage.endDate || '')}">
      <select class="select" data-stage-field="status">${STATUS_LIST.map((status) => `<option value="${status}" ${stage.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select>
      <input class="input" data-stage-field="progress" type="number" min="0" max="100" value="${Number.isFinite(Number(stage.progress)) ? Number(stage.progress) : 0}">
      <button type="button" class="ops-row-remove" data-remove-row>×</button>
    `;
    return row;
  }

  function createMilestoneRow(milestone = {}) {
    const row = document.createElement('div');
    row.className = 'ops-mile-row';
    if (milestone.id) row.dataset.mileId = String(milestone.id);
    row.innerHTML = `
      <input class="input" data-mile-field="title" type="text" placeholder="마일스톤" value="${escapeHtml(milestone.title || '')}">
      <input class="input" data-mile-field="date" type="date" value="${escapeHtml(milestone.date || '')}">
      <select class="select" data-mile-field="status">${['예정', '진행', '완료', '지연'].map((status) => `<option value="${status}" ${milestone.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select>
      <button type="button" class="ops-row-remove" data-remove-row>×</button>
    `;
    return row;
  }

  function getStageDefaults(project = {}) {
    const range = getTimelineRange();
    return {
      name: '',
      owner: project.owner || '',
      startDate: project.startDate || toDateInput(range.start),
      endDate: project.endDate || toDateInput(range.end),
      status: '미진행',
      progress: 0
    };
  }

  function focusStageRow(stageId) {
    if (!stageId) return;
    window.setTimeout(() => {
      const row = Array.from(document.querySelectorAll('.ops-stage-row')).find((item) => item.dataset.stageId === stageId);
      if (!row) return;
      row.classList.add('focused');
      row.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      row.querySelector('[data-stage-field="name"]')?.focus();
    }, 0);
  }

  function fillEditor(projectName = '', options = {}) {
    const createNew = projectName == null;
    const names = getProjectNames();
    const name = createNew ? '' : (projectName || names[0] || '');
    const project = name ? getProjectModel(name) : {
      name: '',
      goal: '',
      owner: '',
      status: '정상',
      startDate: toDateInput(new Date()),
      endDate: toDateInput(addDays(new Date(), 30)),
      nextAction: '',
      issue: '',
      stages: [],
      milestones: []
    };
    activeEditorProject = project.name;
    $('opsOriginalName').value = project.name;
    $('opsProjectName').value = project.name;
    $('opsOwner').value = project.owner;
    $('opsStatus').value = project.status;
    $('opsStartDate').value = project.startDate;
    $('opsEndDate').value = project.endDate;
    $('opsGoal').value = project.goal;
    $('opsNextAction').value = project.nextAction;
    $('opsIssue').value = project.issue;

    const stageList = $('opsStageList');
    stageList.innerHTML = '';
    project.stages.forEach((stage) => stageList.appendChild(createStageRow(stage)));
    if (!project.stages.length) stageList.appendChild(createStageRow({ name: '기획', owner: project.owner, startDate: project.startDate, endDate: project.endDate, status: '진행중', progress: project.progress || 0 }));
    if (options.addStage && project.name) {
      const row = createStageRow(getStageDefaults(project));
      stageList.appendChild(row);
      window.setTimeout(() => row.querySelector('[data-stage-field="name"]')?.focus(), 0);
    }

    const mileList = $('opsMilestoneList');
    mileList.innerHTML = '';
    project.milestones.forEach((milestone) => mileList.appendChild(createMilestoneRow(milestone)));
    if (!project.milestones.length) mileList.appendChild(createMilestoneRow({ title: '', date: project.endDate, status: '예정' }));

    $('opsModalTitle').textContent = project.name ? `${project.name} 운영정보` : '프로젝트 운영정보';
    $('opsModalSub').textContent = project.updatedAt ? `마지막 업데이트: ${formatDate(String(project.updatedAt).slice(0, 10))}` : '새 운영정보';
    if (options.focusStageId) focusStageRow(options.focusStageId);
  }

  function openEditor(projectName = '', options = {}) {
    fillEditor(projectName, options);
    $('opsModal')?.classList.add('open');
    if (!options.focusStageId && !options.addStage) $('opsProjectName')?.focus();
  }

  function closeEditor() {
    $('opsModal')?.classList.remove('open');
    activeEditorProject = '';
  }

  function collectRows(selector, fieldSelector, normalizer) {
    return Array.from(document.querySelectorAll(selector)).map((row, index) => {
      const raw = {};
      if (row.dataset.stageId) raw.id = row.dataset.stageId;
      if (row.dataset.mileId) raw.id = row.dataset.mileId;
      row.querySelectorAll(fieldSelector).forEach((field) => {
        const key = field.dataset.stageField || field.dataset.mileField;
        raw[key] = field.value;
      });
      return normalizer(raw, index, $('opsOwner')?.value || '');
    });
  }

  function saveEditor() {
    const name = String($('opsProjectName')?.value || '').trim();
    if (!name) {
      $('opsProjectName')?.focus();
      return;
    }
    const originalName = $('opsOriginalName')?.value || activeEditorProject;
    const ops = readOps();
    const existing = ops[originalName] || ops[name] || {};
    const existingOrder = Number(existing.order);
    if (originalName && originalName !== name) delete ops[originalName];
    const stages = collectRows('.ops-stage-row', '[data-stage-field]', normalizeStage).filter((stage) => stage.name);
    const milestones = collectRows('.ops-mile-row', '[data-mile-field]', normalizeMilestone).filter((milestone) => milestone.title);
    ops[name] = {
      order: Number.isFinite(existingOrder) ? existingOrder : getNextProjectOrder(ops),
      goal: $('opsGoal')?.value.trim() || '',
      owner: $('opsOwner')?.value.trim() || '',
      status: $('opsStatus')?.value || '정상',
      startDate: normalizeDate($('opsStartDate')?.value),
      endDate: normalizeDate($('opsEndDate')?.value),
      nextAction: $('opsNextAction')?.value.trim() || '',
      issue: $('opsIssue')?.value.trim() || '',
      stages,
      milestones,
      updatedAt: new Date().toISOString()
    };
    writeJson(OPS_KEY, ops);
    closeEditor();
    renderOpsPage({ ensureVisible: true });
  }

  function getStatusForProgress(progress) {
    if (progress >= 100) return '완료';
    if (progress > 0) return '진행중';
    return '미진행';
  }

  function getInlineStageSeed(project) {
    const defaults = getStageDefaults(project);
    return normalizeStage({
      ...defaults,
      id: createStageId(project.stages.length),
      name: project.stages.length ? '새 Task' : '운영 계획',
      status: getStatusForProgress(Number(defaults.progress) || 0)
    }, project.stages.length, project.owner);
  }

  function saveTimelineStageField(projectName, stageId, field, value) {
    if (!projectName || !['name', 'owner', 'startDate', 'endDate', 'progress'].includes(field)) return;
    const ops = readOps();
    if (!ops[projectName]) return;
    const project = getProjectModel(projectName, ops);
    const stages = project.stages.slice();
    let stageIndex = stages.findIndex((stage) => stage.id === stageId);
    if (stageIndex < 0) {
      stages.push(getInlineStageSeed(project));
      stageIndex = stages.length - 1;
    }

    const stage = { ...stages[stageIndex] };
    if (field === 'name') {
      const text = String(value || '').trim();
      if (!text) {
        renderOpsPage({ ensureVisible: true, focusTimelineStageId: stage.id, focusTimelineField: field });
        return;
      }
      stage.name = text;
    } else if (field === 'owner') {
      stage.owner = String(value || '').trim();
    } else if (field === 'startDate') {
      stage.startDate = normalizeDate(value);
      if (parseDate(stage.startDate) && parseDate(stage.endDate) && parseDate(stage.endDate) < parseDate(stage.startDate)) {
        stage.endDate = stage.startDate;
      }
    } else if (field === 'endDate') {
      stage.endDate = normalizeDate(value);
      if (parseDate(stage.startDate) && parseDate(stage.endDate) && parseDate(stage.endDate) < parseDate(stage.startDate)) {
        stage.startDate = stage.endDate;
      }
    } else if (field === 'progress') {
      const progress = Number(value);
      stage.progress = Number.isFinite(progress) ? clamp(Math.round(progress), 0, 100) : stage.progress;
      stage.status = getStatusForProgress(stage.progress);
    }

    stages[stageIndex] = stage;
    ops[projectName] = {
      ...ops[projectName],
      stages,
      updatedAt: new Date().toISOString()
    };
    writeJson(OPS_KEY, ops);
    renderOpsPage({ ensureVisible: true, focusTimelineStageId: stage.id, focusTimelineField: field });
  }

  function deleteEditorMeta() {
    const name = $('opsOriginalName')?.value || activeEditorProject;
    if (!name) return;
    if (!window.confirm(`${name} 운영정보를 삭제할까요?`)) return;
    const ops = readOps();
    delete ops[name];
    writeJson(OPS_KEY, ops);
    activeProjectFilter = '전체';
    closeEditor();
    renderOpsPage({ ensureVisible: true });
  }

  function getProjectForTimelineAdd() {
    if (activeProjectFilter !== '전체') return activeProjectFilter;
    return getFilteredProjects()[0]?.name || null;
  }

  function openTimelineTaskAdd() {
    const projectName = getProjectForTimelineAdd();
    if (!projectName) {
      openEditor(null);
      return;
    }
    const ops = readOps();
    if (!ops[projectName]) return;
    const project = getProjectModel(projectName, ops);
    const stages = project.stages.slice();
    const stage = normalizeStage({
      ...getStageDefaults(project),
      id: createStageId(stages.length),
      name: '새 Task'
    }, stages.length, project.owner);
    stages.push(stage);
    ops[projectName] = {
      ...ops[projectName],
      stages,
      updatedAt: new Date().toISOString()
    };
    writeJson(OPS_KEY, ops);
    renderOpsPage({ ensureVisible: true, focusTimelineStageId: stage.id, focusTimelineField: 'name' });
  }

  function moveProject(projectName, direction) {
    const ops = readOps();
    if (!ops[projectName]) return;
    const orderedNames = getProjectEntries(ops).map((entry) => entry.name);
    const visibleNames = getFilteredProjects(orderedNames.map((name) => getProjectModel(name, ops))).map((project) => project.name);
    const visibleIndex = visibleNames.indexOf(projectName);
    const swapName = visibleNames[visibleIndex + direction];
    if (!swapName) return;
    const currentIndex = orderedNames.indexOf(projectName);
    const swapIndex = orderedNames.indexOf(swapName);
    if (currentIndex < 0 || swapIndex < 0) return;
    [orderedNames[currentIndex], orderedNames[swapIndex]] = [orderedNames[swapIndex], orderedNames[currentIndex]];
    saveProjectOrder(ops, orderedNames);
    writeJson(OPS_KEY, ops);
    renderOpsPage({ ensureVisible: true });
  }

  function moveTimelineStage(projectName, stageId, direction) {
    const ops = readOps();
    if (!ops[projectName] || !stageId) return;
    const project = getProjectModel(projectName, ops);
    const stages = project.stages.slice();
    const currentIndex = stages.findIndex((stage) => stage.id === stageId);
    const swapIndex = currentIndex + direction;
    if (currentIndex < 0 || swapIndex < 0 || swapIndex >= stages.length) return;
    [stages[currentIndex], stages[swapIndex]] = [stages[swapIndex], stages[currentIndex]];
    ops[projectName] = {
      ...ops[projectName],
      stages,
      updatedAt: new Date().toISOString()
    };
    writeJson(OPS_KEY, ops);
    renderOpsPage({ ensureVisible: true, focusTimelineStageId: stageId, focusTimelineField: 'name' });
  }

  function handleTimelineInlineChange(event) {
    const field = event.target?.dataset?.opsInlineField;
    if (!field) return;
    const row = event.target.closest?.('[data-ops-stage-project]');
    if (!row) return;
    saveTimelineStageField(row.dataset.opsStageProject || '', row.dataset.opsStageId || '', field, event.target.value);
  }

  function handleTimelineInlineKeydown(event) {
    if (!event.target?.dataset?.opsInlineField) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.target.blur();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      renderOpsPage({ ensureVisible: true });
    }
  }

  function getTimelineAxis(event) {
    return event.target?.closest?.('[data-ops-axis]') || null;
  }

  function handleTimelineAxisWheel(event) {
    const axis = getTimelineAxis(event);
    if (!axis || timelineAxisWheelLocked) return;
    const delta = Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : 0;
    if (!delta) return;
    event.preventDefault();
    timelineAxisWheelLocked = true;
    moveTimelinePeriod(delta > 0 ? 1 : -1);
    window.setTimeout(() => {
      timelineAxisWheelLocked = false;
    }, 320);
  }

  function clearTimelineAxisDrag() {
    timelineAxisDrag?.axis?.classList.remove('is-dragging');
    timelineAxisDrag = null;
  }

  function handleTimelineAxisPointerDown(event) {
    const axis = getTimelineAxis(event);
    if (!axis || event.target?.closest?.('button')) return;
    timelineAxisDrag = {
      axis,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY
    };
    axis.classList.add('is-dragging');
    axis.setPointerCapture?.(event.pointerId);
  }

  function handleTimelineAxisPointerUp(event) {
    if (!timelineAxisDrag) return;
    const drag = timelineAxisDrag;
    clearTimelineAxisDrag();
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    moveTimelinePeriod(deltaX < 0 ? 1 : -1);
  }

  function bindEvents() {
    $('tabOps')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      showOpsPage();
    }, true);
    document.querySelector('.tabs')?.addEventListener('click', (event) => {
      const tab = event.target?.closest?.('.tab');
      if (tab && tab.dataset.tab !== 'ops') sessionStorage.removeItem(OPS_ACTIVE_KEY);
    });

    $('opsProjectFilter')?.addEventListener('change', (event) => {
      activeProjectFilter = event.target.value;
      renderOpsPage();
    });
    $('opsStatusFilter')?.addEventListener('change', (event) => {
      activeStatusFilter = event.target.value;
      renderOpsPage();
    });
    document.querySelectorAll('[data-ops-view]').forEach((button) => {
      button.addEventListener('click', () => setTimelineView(button.dataset.opsView));
    });
    $('opsTimelinePrev')?.addEventListener('click', () => moveTimelinePeriod(-1));
    $('opsTimelineNext')?.addEventListener('click', () => moveTimelinePeriod(1));
    $('opsTimelineToday')?.addEventListener('click', resetTimelineCursor);
    $('opsTimelineAddTask')?.addEventListener('click', openTimelineTaskAdd);
    $('opsTimeline')?.addEventListener('change', handleTimelineInlineChange);
    $('opsTimeline')?.addEventListener('keydown', handleTimelineInlineKeydown);
    $('opsTimeline')?.addEventListener('wheel', handleTimelineAxisWheel, { passive: false });
    $('opsTimeline')?.addEventListener('pointerdown', handleTimelineAxisPointerDown);
    $('opsTimeline')?.addEventListener('pointerup', handleTimelineAxisPointerUp);
    $('opsTimeline')?.addEventListener('pointercancel', clearTimelineAxisDrag);
    $('opsTimeline')?.addEventListener('lostpointercapture', clearTimelineAxisDrag);
    $('opsAddProject')?.addEventListener('click', () => openEditor(null));
    $('opsEditSelected')?.addEventListener('click', () => {
      const projectName = activeProjectFilter === '전체' ? getFilteredProjects()[0]?.name || null : activeProjectFilter;
      openEditor(projectName);
    });
    $('opsModalClose')?.addEventListener('click', closeEditor);
    $('opsModalCancel')?.addEventListener('click', closeEditor);
    $('opsModalSave')?.addEventListener('click', saveEditor);
    $('opsDeleteMeta')?.addEventListener('click', deleteEditorMeta);
    $('opsAddStage')?.addEventListener('click', () => $('opsStageList')?.appendChild(createStageRow({ status: '미진행', progress: 0 })));
    $('opsAddMilestone')?.addEventListener('click', () => $('opsMilestoneList')?.appendChild(createMilestoneRow()));
    $('opsModal')?.addEventListener('click', (event) => {
      if (event.target?.id === 'opsModal') closeEditor();
    });

    document.body.addEventListener('click', (event) => {
      const axisMoveButton = event.target?.closest?.('[data-ops-axis-move]');
      if (axisMoveButton) {
        event.preventDefault();
        moveTimelinePeriod(axisMoveButton.dataset.opsAxisMove);
        return;
      }
      const projectMoveButton = event.target?.closest?.('[data-ops-move-project]');
      if (projectMoveButton) {
        event.preventDefault();
        moveProject(projectMoveButton.dataset.opsProjectName || '', projectMoveButton.dataset.opsMoveProject === 'up' ? -1 : 1);
        return;
      }
      const stageMoveButton = event.target?.closest?.('[data-ops-move-stage]');
      if (stageMoveButton) {
        event.preventDefault();
        moveTimelineStage(stageMoveButton.dataset.opsStageProject || '', stageMoveButton.dataset.opsStageId || '', stageMoveButton.dataset.opsMoveStage === 'up' ? -1 : 1);
        return;
      }
      const timelineRow = event.target?.closest?.('[data-ops-stage-project]');
      if (timelineRow) {
        if (!event.target?.closest?.('input, select, textarea, button')) {
          timelineRow.querySelector('[data-ops-inline-field="name"]')?.focus();
        }
        return;
      }
      const editButton = event.target?.closest?.('[data-ops-edit]');
      if (editButton) {
        openEditor(editButton.dataset.opsEdit || '');
        return;
      }
      const removeButton = event.target?.closest?.('[data-remove-row]');
      if (removeButton) removeButton.closest('.ops-stage-row, .ops-mile-row')?.remove();
    });

    document.body.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target?.closest?.('input, select, textarea, button')) return;
      const timelineRow = event.target?.closest?.('[data-ops-stage-project]');
      if (!timelineRow) return;
      event.preventDefault();
      timelineRow.querySelector('[data-ops-inline-field="name"]')?.focus();
    });

    window.addEventListener('storage', (event) => {
      if (event.key === OPS_KEY) renderOpsPage();
    });
  }

  function init() {
    ensureTab();
    createPageShell();
    patchWorkBoardRefresh();
    bindEvents();
    renderOpsPage();
    window.ProjectOpsApp = { render: renderOpsPage, show: showOpsPage, setView: setTimelineView, movePeriod: moveTimelinePeriod };
    if (sessionStorage.getItem(ACTIVE_TAB_KEY) === 'ops' || sessionStorage.getItem(OPS_ACTIVE_KEY) === '1') showOpsPage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
