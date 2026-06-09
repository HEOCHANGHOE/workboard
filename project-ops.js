// Project operation page with goals, milestones, and timeline planning.
(function () {
  'use strict';

  const TASKS_KEY = 'work_dashboard_tasks_v1';
  const NOTES_KEY = 'work_project_notes_v1';
  const ORDER_KEY = 'work_project_order_v1';
  const OPS_KEY = 'work_project_ops_v1';
  const ACTIVE_TAB_KEY = 'work_board_active_tab';
  const OPS_ACTIVE_KEY = 'work_project_ops_active';
  const STATUS_LIST = ['미진행', '진행중', '대기', '완료'];
  const OPS_STATUS_LIST = ['정상', '주의', '지연', '보류', '완료'];

  const $ = (id) => document.getElementById(id);

  let activeProjectFilter = '전체';
  let activeStatusFilter = '전체';
  let activeEditorProject = '';

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

  function daysInclusive(startDate, endDate) {
    if (!startDate || !endDate) return 0;
    return Math.max(1, Math.round((endDate - startDate) / 86400000) + 1);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function readTasks() {
    const tasks = readJson(TASKS_KEY, []);
    return Array.isArray(tasks) ? tasks : [];
  }

  function readNotes() {
    const notes = readJson(NOTES_KEY, {});
    return notes && typeof notes === 'object' && !Array.isArray(notes) ? notes : {};
  }

  function readProjectOrder() {
    const order = readJson(ORDER_KEY, []);
    return Array.isArray(order) ? order.map((item) => String(item || '').trim()).filter(Boolean) : [];
  }

  function readOps() {
    const ops = readJson(OPS_KEY, {});
    return ops && typeof ops === 'object' && !Array.isArray(ops) ? ops : {};
  }

  function projectNameOf(task) {
    return String(task?.project || '').trim() || '미분류';
  }

  function getProjectNames() {
    const names = new Set();
    readProjectOrder().forEach((name) => names.add(name));
    readTasks().forEach((task) => names.add(projectNameOf(task)));
    Object.keys(readNotes()).forEach((name) => names.add(name));
    Object.keys(readOps()).forEach((name) => names.add(name));
    return Array.from(names).filter(Boolean).sort((a, b) => {
      const order = readProjectOrder();
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
      if (a === '미분류') return 1;
      if (b === '미분류') return -1;
      return a.localeCompare(b, 'ko');
    });
  }

  function taskStartDate(task) {
    return normalizeDate(String(task?.startedAt || task?.statusUpdatedAt || task?.createdAt || '').slice(0, 10)) ||
      normalizeDate(task?.dueDate);
  }

  function taskEndDate(task) {
    return normalizeDate(String(task?.completedAt || '').slice(0, 10)) ||
      normalizeDate(task?.dueDate) ||
      normalizeDate(String(task?.createdAt || '').slice(0, 10));
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
      id: String(stage?.id || `stage_${Date.now()}_${index}`),
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

  function getTasksForProject(name, tasks = readTasks()) {
    return tasks.filter((task) => projectNameOf(task) === name);
  }

  function getDateValues(values) {
    return values.map(parseDate).filter(Boolean);
  }

  function inferDateBounds(name, projectTasks, note, opsProject) {
    const stageStarts = Array.isArray(opsProject?.stages) ? opsProject.stages.map((stage) => stage.startDate) : [];
    const stageEnds = Array.isArray(opsProject?.stages) ? opsProject.stages.map((stage) => stage.endDate) : [];
    const starts = getDateValues([
      opsProject?.startDate,
      ...stageStarts,
      ...projectTasks.map(taskStartDate),
      normalizeDate(String(note?.updatedAt || '').slice(0, 10))
    ]);
    const ends = getDateValues([
      opsProject?.endDate,
      note?.dueDate,
      ...stageEnds,
      ...projectTasks.map(taskEndDate),
      normalizeDate(String(note?.reviewDate || '').slice(0, 10))
    ]);
    const today = new Date();
    const start = starts.length ? new Date(Math.min(...starts.map((date) => date.getTime()))) : new Date(today.getFullYear(), today.getMonth(), 1);
    const end = ends.length ? new Date(Math.max(...ends.map((date) => date.getTime()))) : addDays(start, name === '미분류' ? 14 : 30);
    return { startDate: toDateInput(start), endDate: toDateInput(end < start ? addDays(start, 14) : end) };
  }

  function statusFromProject(name, tasks, note, opsProject) {
    if (OPS_STATUS_LIST.includes(opsProject?.status)) return opsProject.status;
    if (OPS_STATUS_LIST.includes(note?.status)) return note.status;
    if (!tasks.length) return '정상';
    if (tasks.every((task) => task.status === '완료')) return '완료';
    const today = new Date();
    const hasOverdue = tasks.some((task) => {
      if (task.status === '완료') return false;
      const due = parseDate(task.dueDate);
      return due && due < new Date(today.getFullYear(), today.getMonth(), today.getDate());
    });
    if (hasOverdue) return '지연';
    if (tasks.some((task) => task.status === '대기')) return '주의';
    return name === '미분류' ? '주의' : '정상';
  }

  function projectProgress(project, tasks) {
    if (project.stages.length) {
      return Math.round(project.stages.reduce((sum, stage) => sum + stage.progress, 0) / project.stages.length);
    }
    if (!tasks.length) return project.status === '완료' ? 100 : 0;
    const score = tasks.reduce((sum, task) => {
      if (task.status === '완료') return sum + 1;
      if (task.status === '진행중') return sum + 0.5;
      return sum;
    }, 0);
    return Math.round((score / tasks.length) * 100);
  }

  function getProjectModel(name, tasks = readTasks(), notes = readNotes(), ops = readOps()) {
    const note = notes[name] || {};
    const saved = ops[name] || {};
    const projectTasks = getTasksForProject(name, tasks);
    const bounds = inferDateBounds(name, projectTasks, note, saved);
    const owner = String(saved.owner || note.owner || '').trim();
    const stages = Array.isArray(saved.stages)
      ? saved.stages.map((stage, index) => normalizeStage(stage, index, owner)).filter((stage) => stage.name)
      : [];
    const milestones = Array.isArray(saved.milestones)
      ? saved.milestones.map(normalizeMilestone).filter((milestone) => milestone.title)
      : [];
    const project = {
      name,
      goal: String(saved.goal || note.goal || '').trim(),
      owner,
      status: statusFromProject(name, projectTasks, note, saved),
      startDate: normalizeDate(saved.startDate) || bounds.startDate,
      endDate: normalizeDate(saved.endDate) || bounds.endDate,
      nextAction: String(saved.nextAction || note.next || note.focus || '').trim(),
      issue: String(saved.issue || note.issue || note.decision || '').trim(),
      stages,
      milestones,
      taskCount: projectTasks.length,
      doneTaskCount: projectTasks.filter((task) => task.status === '완료').length,
      updatedAt: saved.updatedAt || note.updatedAt || ''
    };
    project.progress = projectProgress(project, projectTasks);
    return project;
  }

  function getProjects() {
    const tasks = readTasks();
    const notes = readNotes();
    const ops = readOps();
    return getProjectNames().map((name) => getProjectModel(name, tasks, notes, ops));
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
          <span>${project.doneTaskCount}/${project.taskCount} 완료</span>
          <span>${project.progress}%</span>
        </div>
      </button>
    `).join('');
  }

  function getTimelineRows(projects) {
    const tasks = readTasks();
    const rows = [];
    projects.forEach((project) => {
      const projectTasks = getTasksForProject(project.name, tasks);
      const sourceRows = project.stages.length
        ? project.stages.map((stage) => ({
            project,
            label: stage.name,
            owner: stage.owner || project.owner,
            startDate: stage.startDate || project.startDate,
            endDate: stage.endDate || project.endDate,
            status: stage.status,
            progress: stage.progress,
            memo: stage.memo
          }))
        : projectTasks.map((task) => {
            const startDate = taskStartDate(task) || project.startDate;
            const endDate = taskEndDate(task) || project.endDate;
            return {
              project,
              label: String(task.name || '').trim(),
              owner: String(task.collaborators || task.owner || project.owner || '').trim(),
              startDate,
              endDate,
              status: STATUS_LIST.includes(task.status) ? task.status : '미진행',
              progress: estimateProgress(task.status, startDate, endDate),
              memo: String(task.description || '').trim()
            };
          });

      const safeRows = sourceRows.length ? sourceRows : [{
        project,
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

  function getTimelineRange(rows) {
    const dates = [];
    rows.forEach((row) => {
      const start = parseDate(row.startDate);
      const end = parseDate(row.endDate);
      if (start) dates.push(start);
      if (end) dates.push(end);
    });
    const today = new Date();
    dates.push(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
    if (!dates.length) {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start, end: addDays(start, 30) };
    }
    const start = new Date(Math.min(...dates.map((date) => date.getTime())));
    const end = new Date(Math.max(...dates.map((date) => date.getTime())));
    return { start: addDays(start, -3), end: addDays(end, 7) };
  }

  function getAxisTicks(range) {
    const totalDays = daysInclusive(range.start, range.end);
    const step = totalDays <= 45 ? 1 : totalDays <= 120 ? 7 : 30;
    const ticks = [];
    for (let date = new Date(range.start); date <= range.end; date = addDays(date, step)) {
      ticks.push({
        label: step === 1 ? `${date.getMonth() + 1}/${date.getDate()}` : `${date.getMonth() + 1}/${date.getDate()}`,
        offset: ((date - range.start) / Math.max(1, range.end - range.start)) * 100
      });
    }
    return ticks;
  }

  function getBarStyle(row, range) {
    const start = parseDate(row.startDate) || range.start;
    const end = parseDate(row.endDate) || start;
    const left = clamp(((start - range.start) / Math.max(1, range.end - range.start)) * 100, 0, 100);
    const right = clamp(((end - range.start) / Math.max(1, range.end - range.start)) * 100, 0, 100);
    const width = Math.max(1.5, right - left);
    return `left:${left}%;width:${width}%;`;
  }

  function getDoneDays(row) {
    const start = parseDate(row.startDate);
    const end = parseDate(row.endDate);
    return Math.round(daysInclusive(start, end) * (clamp(row.progress, 0, 100) / 100));
  }

  function renderTimeline(projects) {
    const target = $('opsTimeline');
    if (!target) return;
    const rows = getTimelineRows(projects);
    if (!rows.length) {
      target.innerHTML = '<div class="empty">타임라인 데이터 없음</div>';
      return;
    }
    const range = getTimelineRange(rows);
    const axis = getAxisTicks(range);
    const today = new Date();
    const todayOffset = clamp(((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - range.start) / Math.max(1, range.end - range.start)) * 100, 0, 100);
    target.innerHTML = `
      <div class="ops-timeline-grid">
        <div class="ops-timeline-row ops-timeline-head">
          <div>프로젝트명</div>
          <div>task</div>
          <div>담당PM</div>
          <div>착수일</div>
          <div>완료일</div>
          <div>업무일</div>
          <div>완료일수</div>
          <div>진행률</div>
          <div class="ops-axis">${axis.map((tick) => `<span style="left:${tick.offset}%">${escapeHtml(tick.label)}</span>`).join('')}</div>
        </div>
        ${rows.map((row) => {
          const totalDays = daysInclusive(parseDate(row.startDate), parseDate(row.endDate));
          return `
            <div class="ops-timeline-row">
              <div class="ops-project-cell">${row.firstInProject ? escapeHtml(row.project.name) : ''}</div>
              <div class="ops-task-cell" title="${escapeHtml(row.memo || row.label)}">${escapeHtml(row.label || '-')}</div>
              <div>${escapeHtml(row.owner || '-')}</div>
              <div>${escapeHtml(formatDate(row.startDate))}</div>
              <div>${escapeHtml(formatDate(row.endDate))}</div>
              <div>${totalDays || '-'}</div>
              <div>${getDoneDays(row) || 0}</div>
              <div>${row.progress}%</div>
              <div class="ops-bar-cell">
                <span class="ops-today-line" style="left:${todayOffset}%"></span>
                <span class="ops-bar-bg" style="${getBarStyle(row, range)}"></span>
                <span class="ops-bar-fill ops-task-${taskStatusClass(row.status)}" style="${row.progress <= 0 ? 'left:0;width:0;' : getBarStyle({ ...row, endDate: toDateInput(addDays(parseDate(row.startDate) || range.start, Math.max(0, Math.round((totalDays || 1) * row.progress / 100) - 1))) }, range)}"></span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
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

  function renderOpsPage() {
    const projects = getProjects();
    renderFilters(projects);
    const filtered = getFilteredProjects(projects);
    renderSummary(filtered);
    renderProjectList(filtered);
    renderTimeline(filtered);
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
    row.innerHTML = `
      <input class="input" data-mile-field="title" type="text" placeholder="마일스톤" value="${escapeHtml(milestone.title || '')}">
      <input class="input" data-mile-field="date" type="date" value="${escapeHtml(milestone.date || '')}">
      <select class="select" data-mile-field="status">${['예정', '진행', '완료', '지연'].map((status) => `<option value="${status}" ${milestone.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select>
      <button type="button" class="ops-row-remove" data-remove-row>×</button>
    `;
    return row;
  }

  function fillEditor(projectName = '') {
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

    const mileList = $('opsMilestoneList');
    mileList.innerHTML = '';
    project.milestones.forEach((milestone) => mileList.appendChild(createMilestoneRow(milestone)));
    if (!project.milestones.length) mileList.appendChild(createMilestoneRow({ title: '', date: project.endDate, status: '예정' }));

    $('opsModalTitle').textContent = project.name ? `${project.name} 운영정보` : '프로젝트 운영정보';
    $('opsModalSub').textContent = project.updatedAt ? `마지막 업데이트: ${formatDate(String(project.updatedAt).slice(0, 10))}` : '새 운영정보';
  }

  function openEditor(projectName = '') {
    fillEditor(projectName);
    $('opsModal')?.classList.add('open');
    $('opsProjectName')?.focus();
  }

  function closeEditor() {
    $('opsModal')?.classList.remove('open');
    activeEditorProject = '';
  }

  function collectRows(selector, fieldSelector, normalizer) {
    return Array.from(document.querySelectorAll(selector)).map((row, index) => {
      const raw = {};
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
    if (originalName && originalName !== name) delete ops[originalName];
    const stages = collectRows('.ops-stage-row', '[data-stage-field]', normalizeStage).filter((stage) => stage.name);
    const milestones = collectRows('.ops-mile-row', '[data-mile-field]', normalizeMilestone).filter((milestone) => milestone.title);
    ops[name] = {
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
    activeProjectFilter = name;
    closeEditor();
    renderOpsPage();
  }

  function deleteEditorMeta() {
    const name = $('opsOriginalName')?.value || activeEditorProject;
    if (!name) return;
    if (!window.confirm(`${name} 운영정보를 삭제할까요? 업무 목록은 삭제되지 않습니다.`)) return;
    const ops = readOps();
    delete ops[name];
    writeJson(OPS_KEY, ops);
    activeProjectFilter = '전체';
    closeEditor();
    renderOpsPage();
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
      const editButton = event.target?.closest?.('[data-ops-edit]');
      if (editButton) {
        openEditor(editButton.dataset.opsEdit || '');
        return;
      }
      const removeButton = event.target?.closest?.('[data-remove-row]');
      if (removeButton) removeButton.closest('.ops-stage-row, .ops-mile-row')?.remove();
    });

    ['saveBtn', 'detailModalSave', 'projectNoteSave'].forEach((id) => {
      $(id)?.addEventListener('click', () => window.setTimeout(renderOpsPage, 120));
    });
    window.addEventListener('storage', (event) => {
      if ([TASKS_KEY, NOTES_KEY, ORDER_KEY, OPS_KEY].includes(event.key)) renderOpsPage();
    });
  }

  function init() {
    ensureTab();
    createPageShell();
    patchWorkBoardRefresh();
    bindEvents();
    renderOpsPage();
    window.ProjectOpsApp = { render: renderOpsPage, show: showOpsPage };
    if (sessionStorage.getItem(ACTIVE_TAB_KEY) === 'ops' || sessionStorage.getItem(OPS_ACTIVE_KEY) === '1') showOpsPage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
