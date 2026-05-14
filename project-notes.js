// Extended project note fields and mini task management.
(function () {
  'use strict';

  const NOTES_KEY = 'work_project_notes_v1';
  const TASK_STATUSES = ['미진행', '진행중', '대기', '완료'];

  let activeProjectName = '';
  let currentMiniTasks = [];

  const $ = (id) => document.getElementById(id);

  function readNotes() {
    try {
      const parsed = JSON.parse(localStorage.getItem(NOTES_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      console.error('Project notes parse error:', error);
      return {};
    }
  }

  function writeNotes(notes) {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  }

  function normalizeDate(value) {
    const text = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
  }

  function formatShortDate(value) {
    const date = normalizeDate(value);
    if (!date) return '';
    const parts = date.split('-');
    return `${Number(parts[1])}.${Number(parts[2])}`;
  }

  function normalizeMiniTask(raw, index) {
    const status = TASK_STATUSES.includes(raw?.status) ? raw.status : '미진행';
    return {
      id: String(raw?.id || `mini_${Date.now()}_${index}`),
      status,
      title: String(raw?.title || '').trim(),
      owner: String(raw?.owner || '').trim(),
      dueDate: normalizeDate(raw?.dueDate),
      memo: String(raw?.memo || '').trim()
    };
  }

  function getProjectNote(projectName) {
    const note = readNotes()[projectName] || {};
    const miniTasks = Array.isArray(note.miniTasks)
      ? note.miniTasks.map(normalizeMiniTask).filter((task) => task.title)
      : [];
    return { ...note, miniTasks };
  }

  function resetMiniTaskEntry() {
    if ($('projectMiniTaskStatus')) $('projectMiniTaskStatus').value = '미진행';
    if ($('projectMiniTaskTitle')) $('projectMiniTaskTitle').value = '';
    if ($('projectMiniTaskOwner')) $('projectMiniTaskOwner').value = '';
    if ($('projectMiniTaskDueDate')) $('projectMiniTaskDueDate').value = '';
    if ($('projectMiniTaskMemo')) $('projectMiniTaskMemo').value = '';
  }

  function createTextNode(tagName, className, text) {
    const el = document.createElement(tagName);
    el.className = className;
    el.textContent = text || '-';
    return el;
  }

  function renderMiniTasks() {
    const container = $('projectMiniTasks');
    if (!container) return;
    container.innerHTML = '';

    if (!currentMiniTasks.length) {
      const empty = document.createElement('div');
      empty.className = 'empty project-mini-task-empty';
      empty.textContent = '등록된 작업 없음';
      container.appendChild(empty);
      return;
    }

    currentMiniTasks.forEach((task) => {
      const row = document.createElement('div');
      row.className = 'project-mini-task-row';

      const statusSelect = document.createElement('select');
      statusSelect.className = `project-mini-task-status status-${task.status}`;
      statusSelect.dataset.miniTaskStatus = task.id;
      TASK_STATUSES.forEach((status) => {
        const option = document.createElement('option');
        option.value = status;
        option.textContent = status;
        option.selected = task.status === status;
        statusSelect.appendChild(option);
      });

      const dueText = task.dueDate ? formatShortDate(task.dueDate) : '-';
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'project-mini-task-delete';
      deleteButton.dataset.miniTaskDelete = task.id;
      deleteButton.setAttribute('aria-label', `${task.title} 삭제`);
      deleteButton.textContent = '×';

      row.appendChild(statusSelect);
      row.appendChild(createTextNode('div', 'project-mini-task-title', task.title));
      row.appendChild(createTextNode('div', 'project-mini-task-meta', task.owner));
      row.appendChild(createTextNode('div', 'project-mini-task-meta', dueText));
      row.appendChild(createTextNode('div', 'project-mini-task-meta', task.memo));
      row.appendChild(deleteButton);
      container.appendChild(row);
    });
  }

  function fillProjectNoteFields(projectName) {
    activeProjectName = projectName;
    const note = getProjectNote(projectName);
    currentMiniTasks = note.miniTasks.slice();

    if ($('projectNoteGoal')) $('projectNoteGoal').value = note.goal || '';
    if ($('projectNoteOwner')) $('projectNoteOwner').value = note.owner || '';
    if ($('projectNoteDueDate')) $('projectNoteDueDate').value = normalizeDate(note.dueDate);
    if ($('projectNoteReviewDate')) $('projectNoteReviewDate').value = normalizeDate(note.reviewDate);
    if ($('projectNoteFocus')) $('projectNoteFocus').value = note.focus || '';
    if ($('projectNoteDecision')) $('projectNoteDecision').value = note.decision || '';

    resetMiniTaskEntry();
    renderMiniTasks();
  }

  function collectProjectNoteFields() {
    return {
      goal: $('projectNoteGoal')?.value.trim() || '',
      owner: $('projectNoteOwner')?.value.trim() || '',
      dueDate: normalizeDate($('projectNoteDueDate')?.value),
      reviewDate: normalizeDate($('projectNoteReviewDate')?.value),
      focus: $('projectNoteFocus')?.value.trim() || '',
      decision: $('projectNoteDecision')?.value.trim() || '',
      miniTasks: currentMiniTasks.map((task, index) => normalizeMiniTask(task, index)).filter((task) => task.title)
    };
  }

  function addMiniTask() {
    const title = $('projectMiniTaskTitle')?.value.trim() || '';
    if (!title) {
      $('projectMiniTaskTitle')?.focus();
      return;
    }

    currentMiniTasks.push({
      id: `mini_${Date.now()}`,
      status: $('projectMiniTaskStatus')?.value || '미진행',
      title,
      owner: $('projectMiniTaskOwner')?.value.trim() || '',
      dueDate: normalizeDate($('projectMiniTaskDueDate')?.value),
      memo: $('projectMiniTaskMemo')?.value.trim() || ''
    });
    resetMiniTaskEntry();
    renderMiniTasks();
  }

  function removeMiniTask(taskId) {
    currentMiniTasks = currentMiniTasks.filter((task) => task.id !== taskId);
    renderMiniTasks();
  }

  function updateMiniTaskStatus(taskId, status) {
    if (!TASK_STATUSES.includes(status)) return;
    currentMiniTasks = currentMiniTasks.map((task) => (
      task.id === taskId ? { ...task, status } : task
    ));
    renderMiniTasks();
  }

  function decorateProjectSummaries() {
    const notes = readNotes();
    document.querySelectorAll('[data-action="open-project-note"][data-project]').forEach((button) => {
      const projectName = button.dataset.project || '';
      const note = notes[projectName] || {};
      const head = button.closest('.project-group-head');
      const titleWrap = head?.querySelector('.project-title-wrap');
      if (!titleWrap) return;

      const chips = [];
      if (String(note.owner || '').trim()) chips.push(`담당 ${note.owner.trim()}`);
      const due = formatShortDate(note.dueDate);
      if (due) chips.push(`마감 ${due}`);
      const review = formatShortDate(note.reviewDate);
      if (review) chips.push(`확인 ${review}`);
      const openTaskCount = Array.isArray(note.miniTasks)
        ? note.miniTasks.filter((task) => task?.title && task.status !== '완료').length
        : 0;
      if (openTaskCount) chips.push(`작업 ${openTaskCount}`);

      const existingChips = Array.from(titleWrap.querySelectorAll('.project-note-chip.extended'));
      const isSame = existingChips.length === chips.length && existingChips.every((chip, index) => {
        const label = chips[index];
        return chip.textContent === label && chip.classList.contains('due') === label.startsWith('마감');
      });
      if (isSame) return;

      existingChips.forEach((chip) => chip.remove());
      chips.forEach((label) => {
        const chip = document.createElement('span');
        chip.className = `project-note-chip extended${label.startsWith('마감') ? ' due' : ''}`;
        chip.textContent = label;
        titleWrap.appendChild(chip);
      });
    });
  }

  function persistExtendedNote(projectName, fields) {
    const notes = readNotes();
    notes[projectName] = {
      ...(notes[projectName] || {}),
      ...fields,
      updatedAt: new Date().toISOString()
    };
    writeNotes(notes);
  }

  function bindProjectNoteExtensions() {
    document.body.addEventListener('click', (event) => {
      const openButton = event.target?.closest?.('[data-action="open-project-note"][data-project]');
      if (openButton) {
        const projectName = openButton.dataset.project || '';
        setTimeout(() => fillProjectNoteFields(projectName), 0);
        return;
      }

      const deleteButton = event.target?.closest?.('[data-mini-task-delete]');
      if (deleteButton) {
        removeMiniTask(deleteButton.dataset.miniTaskDelete || '');
      }
    });

    document.body.addEventListener('change', (event) => {
      const statusSelect = event.target?.closest?.('[data-mini-task-status]');
      if (!statusSelect) return;
      updateMiniTaskStatus(statusSelect.dataset.miniTaskStatus || '', statusSelect.value);
    });

    $('projectMiniTaskAdd')?.addEventListener('click', addMiniTask);
    $('projectMiniTaskTitle')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addMiniTask();
      }
    });

    $('projectNoteSave')?.addEventListener('click', () => {
      const projectName = $('projectNoteName')?.value.trim() || activeProjectName;
      const fields = collectProjectNoteFields();
      if (!projectName) return;

      setTimeout(() => {
        persistExtendedNote(projectName, fields);
        window.WorkBoardApp?.refreshFromStorage?.();
        setTimeout(decorateProjectSummaries, 0);
      }, 0);
    }, true);

    const tableBody = $('taskTableBody');
    if (tableBody) {
      const observer = new MutationObserver(() => decorateProjectSummaries());
      observer.observe(tableBody, { childList: true, subtree: true });
    }

    decorateProjectSummaries();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindProjectNoteExtensions);
  } else {
    bindProjectNoteExtensions();
  }
})();
