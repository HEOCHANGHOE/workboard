// Meeting notes: paste a transcript, load a text file, or type rough notes.
// AI turns it into summary / decisions / action items; action items become tasks.
// Minutes live in the synced snapshot. The full original text is kept separately
// (cloud table when signed in, plus a small local cache) because transcripts are large.
(function () {
  'use strict';

  const MEETINGS_KEY = 'work_meetings_v1';
  const RAW_CACHE_KEY = 'work_meeting_raw_v1'; // local only, not part of the synced snapshot
  const RAW_TABLE = 'work_board_meeting_texts';
  const VIEW_KEY = 'work_meetings_view';
  const MAX_TEXT_CHARS = 150000;
  const MAX_FILE_BYTES = 2 * 1024 * 1024;
  const TRANSCRIPT_HINT_CHARS = 3000;
  const RAW_CACHE_LIMIT = 8;

  let meetings = [];
  let view = 'date';
  let filterProject = '전체';
  let filterMonth = '';
  let searchText = '';
  let expandedId = '';
  let loadedFileName = '';
  let busy = false;
  const rawShown = new Map(); // meetingId -> text currently displayed

  const $ = (id) => document.getElementById(id);
  const pad2 = (n) => String(n).padStart(2, '0');
  const todayInput = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };
  const escapeHtml = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  const strings = (value, maxItems, maxLength) =>
    (Array.isArray(value) ? value : [])
      .map((item) =>
        String(item ?? '')
          .trim()
          .slice(0, maxLength)
      )
      .filter(Boolean)
      .slice(0, maxItems);

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------
  function normalizeMeeting(raw, index) {
    const actionItems = (Array.isArray(raw?.actionItems) ? raw.actionItems : [])
      .map((item) => ({
        name: String(item?.name || '')
          .trim()
          .slice(0, 200),
        owner: String(item?.owner || '')
          .trim()
          .slice(0, 40),
        dueDate: isDate(item?.dueDate) ? item.dueDate : '',
        mine: item?.mine !== false,
        taskId: item?.taskId ? String(item.taskId) : ''
      }))
      .filter((item) => item.name)
      .slice(0, 60);
    return {
      id: raw?.id ? String(raw.id) : `meet_${Date.now()}_${index}`,
      date: isDate(raw?.date) ? raw.date : todayInput(),
      title:
        String(raw?.title || '')
          .trim()
          .slice(0, 200) || '제목 없는 회의',
      project: String(raw?.project || '')
        .trim()
        .slice(0, 80),
      kind: raw?.kind === 'memo' ? 'memo' : 'transcript',
      organized: raw?.organized === true,
      summary: strings(raw?.summary, 12, 600),
      decisions: strings(raw?.decisions, 40, 600),
      actionItems,
      openIssues: strings(raw?.openIssues, 40, 600),
      rawLength: Number(raw?.rawLength) || 0,
      fileName: String(raw?.fileName || '').slice(0, 200),
      createdAt: raw?.createdAt || new Date().toISOString(),
      updatedAt: raw?.updatedAt || new Date().toISOString()
    };
  }

  function loadMeetings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MEETINGS_KEY) || '[]');
      meetings = (Array.isArray(parsed) ? parsed : []).map(normalizeMeeting);
    } catch (error) {
      console.error('Meetings parse error:', error);
      meetings = [];
    }
  }

  function saveMeetings() {
    localStorage.setItem(MEETINGS_KEY, JSON.stringify(meetings));
  }

  function readRawCache() {
    try {
      const parsed = JSON.parse(localStorage.getItem(RAW_CACHE_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  // Keeps only the most recent few transcripts locally so browser storage does not fill up.
  function writeRawCache(cache) {
    const entries = Object.entries(cache).sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0));
    for (let keep = Math.min(entries.length, RAW_CACHE_LIMIT); keep >= 0; keep -= 1) {
      try {
        localStorage.setItem(RAW_CACHE_KEY, JSON.stringify(Object.fromEntries(entries.slice(0, keep))));
        return keep;
      } catch (error) {
        // Storage full: retry with fewer transcripts.
      }
    }
    return 0;
  }

  function cloud() {
    const handle = window.WorkBoardCloud;
    return handle?.isReady?.() ? { client: handle.getClient(), userId: handle.getUserId() } : null;
  }

  // Returns where the original text ended up: 'cloud', 'local', or 'none'.
  async function saveRaw(meetingId, text) {
    const cache = readRawCache();
    cache[meetingId] = { text, at: Date.now() };
    const keptLocally = writeRawCache(cache) > 0 && Boolean(readRawCache()[meetingId]);
    const c = cloud();
    if (c) {
      const { error } = await c.client
        .from(RAW_TABLE)
        .upsert(
          { user_id: c.userId, meeting_id: meetingId, raw_text: text, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,meeting_id' }
        );
      if (!error) return 'cloud';
      console.warn('Meeting text was not saved to the cloud:', error.message || error);
    }
    return keptLocally ? 'local' : 'none';
  }

  async function loadRaw(meetingId) {
    const cached = readRawCache()[meetingId];
    if (cached?.text) return cached.text;
    const c = cloud();
    if (!c) return '';
    const { data, error } = await c.client
      .from(RAW_TABLE)
      .select('raw_text')
      .eq('meeting_id', meetingId)
      .maybeSingle();
    if (error) {
      console.warn('Meeting text could not be loaded:', error.message || error);
      return '';
    }
    return data?.raw_text || '';
  }

  async function deleteRaw(meetingId) {
    const cache = readRawCache();
    delete cache[meetingId];
    writeRawCache(cache);
    const c = cloud();
    if (!c) return;
    const { error } = await c.client.from(RAW_TABLE).delete().eq('meeting_id', meetingId);
    if (error) console.warn('Meeting text could not be deleted from the cloud:', error.message || error);
  }

  // ---------------------------------------------------------------------------
  // Input handling
  // ---------------------------------------------------------------------------
  // Subtitle formats (.vtt/.srt) carry cue numbers and timestamps that are noise for a summary.
  function cleanTranscript(text, fileName = '') {
    let out = String(text || '').replace(/\r\n?/g, '\n');
    if (/\.(vtt|srt)$/i.test(fileName) || /^WEBVTT/.test(out)) {
      out = out
        .split('\n')
        .filter(
          (line) =>
            !/^WEBVTT/.test(line) && !/^\d+$/.test(line.trim()) && !/-->/.test(line) && !/^NOTE\b/.test(line)
        )
        .join('\n');
    }
    return out.replace(/\n{3,}/g, '\n\n').trim();
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
      reader.readAsText(file);
    });
  }

  async function onFileChosen(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (/\.(mp3|m4a|wav|mp4|aac|ogg|webm|flac)$/i.test(file.name) || /^(audio|video)\//.test(file.type)) {
      setStatus(
        '녹음 파일 자체는 읽을 수 없습니다. 녹음 앱에서 텍스트로 변환한 파일(.txt, .vtt, .srt)을 올리세요.',
        'warn'
      );
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setStatus('파일이 너무 큽니다. 2MB 이하의 텍스트 파일만 올릴 수 있습니다.', 'warn');
      return;
    }
    try {
      const text = cleanTranscript(await readFile(file), file.name);
      if (!text) {
        setStatus('파일에서 글자를 찾지 못했습니다. 텍스트 파일인지 확인하세요.', 'warn');
        return;
      }
      $('meetingText').value = text.slice(0, MAX_TEXT_CHARS);
      loadedFileName = file.name;
      if (!$('meetingTitle').value.trim())
        $('meetingTitle').value = file.name.replace(/\.[^.]+$/, '').slice(0, 80);
      setStatus(
        `${file.name} 불러옴 (${text.length.toLocaleString('ko-KR')}자)${text.length > MAX_TEXT_CHARS ? ', 앞부분 15만 자만 사용' : ''}`,
        'ok'
      );
    } catch (error) {
      setStatus(error.message || '파일을 읽지 못했습니다.', 'error');
    }
  }

  function setStatus(message, tone = '') {
    const el = $('meetingStatus');
    if (!el) return;
    el.textContent = message;
    el.dataset.tone = tone;
  }

  function projectNames() {
    const fromTasks = window.WorkBoardApp?.getProjectNames?.() || [];
    const fromMeetings = meetings.map((meeting) => meeting.project).filter(Boolean);
    return Array.from(new Set([...fromTasks, ...fromMeetings]));
  }

  // Registers action items as tasks and remembers the link on the item.
  function registerActionItems(meeting, indexes) {
    const app = window.WorkBoardApp;
    if (!app) return 0;
    const targets = indexes.map((index) => meeting.actionItems[index]).filter((item) => item && !item.taskId);
    if (!targets.length) return 0;
    const settings = window.WorkBoardCapture?.readSettings?.() || { defaultDueTime: '18:00' };
    const [hour, minute] = String(settings.defaultDueTime).split(':').map(Number);
    const dueTime = window.WorkBoardCapture?.toKoreanTime?.(hour, minute) || '오후 06:00';
    const created = app.addTasks(
      targets.map((item) => ({
        name: item.name,
        project: meeting.project,
        channel: '회의',
        dueDate: item.dueDate,
        dueTime: item.dueDate ? dueTime : '',
        impact: 2,
        urgency: 2,
        linkage: 2,
        status: '미진행',
        description: `회의: ${meeting.title} (${meeting.date})${item.owner ? `\n담당: ${item.owner}` : ''}`
      }))
    );
    created.forEach((task, index) => {
      targets[index].taskId = task.id;
    });
    return created.length;
  }

  async function organize(text, hint, kind) {
    const capture = window.WorkBoardCapture;
    if (!capture?.aiReady?.()) throw new Error('AI_NOT_CONNECTED');
    const data = await capture.callAi({
      mode: 'meeting',
      text,
      kind,
      today: todayInput(),
      projects: projectNames(),
      people: capture.readSettings().people,
      hint
    });
    return data.meeting || {};
  }

  async function createMeeting(useAi) {
    if (busy) return;
    const text = $('meetingText').value.trim().slice(0, MAX_TEXT_CHARS);
    if (!text) {
      setStatus('회의 내용을 붙여 넣거나 파일을 올리세요.', 'warn');
      $('meetingText').focus();
      return;
    }
    const hint = {
      date: isDate($('meetingDate').value) ? $('meetingDate').value : todayInput(),
      title: $('meetingTitle').value.trim(),
      project: $('meetingProject').value
    };
    const kind = loadedFileName || text.length > TRANSCRIPT_HINT_CHARS ? 'transcript' : 'memo';
    busy = true;
    $('meetingOrganize').disabled = true;
    $('meetingSaveRaw').disabled = true;
    let result = null;
    let aiFailed = false;
    try {
      if (useAi) {
        setStatus('AI가 회의 내용을 정리하는 중… 긴 녹취록은 1분 정도 걸립니다.');
        try {
          result = await organize(text, hint, kind);
        } catch (error) {
          aiFailed = true;
          if (String(error?.message) !== 'AI_NOT_CONNECTED') console.warn('Meeting AI failed:', error);
        }
      }
      const known = projectNames();
      const aiProject = String(result?.project || '').trim();
      const meeting = normalizeMeeting(
        {
          id: `meet_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          date: hint.date,
          title:
            hint.title ||
            result?.title ||
            (loadedFileName ? loadedFileName.replace(/\.[^.]+$/, '') : text.split('\n')[0].slice(0, 40)),
          project: hint.project || (known.includes(aiProject) ? aiProject : ''),
          kind,
          organized: Boolean(result),
          summary: result?.summary,
          decisions: result?.decisions,
          actionItems: result?.actionItems,
          openIssues: result?.openIssues,
          rawLength: text.length,
          fileName: loadedFileName
        },
        0
      );
      let registered = 0;
      if (result && window.WorkBoardCapture?.readSettings?.().autoApplyNew !== false) {
        const mine = meeting.actionItems
          .map((item, index) => (item.mine ? index : -1))
          .filter((index) => index >= 0);
        registered = registerActionItems(meeting, mine);
      }
      meetings.unshift(meeting);
      saveMeetings();
      const rawPlace = await saveRaw(meeting.id, text);
      $('meetingText').value = '';
      $('meetingTitle').value = '';
      loadedFileName = '';
      expandedId = meeting.id;
      render();
      const rawNote =
        rawPlace === 'cloud'
          ? ''
          : rawPlace === 'local'
            ? ' 원문은 이 기기에만 저장했습니다.'
            : ' 원문은 저장 공간이 부족해 보관하지 못했습니다.';
      if (result)
        setStatus(
          `정리해서 저장했습니다. 내 액션아이템 ${registered}건을 업무로 등록했습니다.${rawNote}`,
          'ok'
        );
      else if (useAi && aiFailed)
        setStatus(
          `AI에 연결하지 못해 원문만 저장했습니다. 연결 후 "다시 정리"를 누르면 요약됩니다.${rawNote}`,
          'warn'
        );
      else setStatus(`원문을 저장했습니다.${rawNote}`, 'ok');
    } catch (error) {
      console.error(error);
      setStatus('저장하지 못했습니다. 입력한 내용은 그대로 남아 있습니다.', 'error');
    } finally {
      busy = false;
      $('meetingOrganize').disabled = false;
      $('meetingSaveRaw').disabled = false;
    }
  }

  async function reorganize(meetingId) {
    const meeting = meetings.find((item) => item.id === meetingId);
    if (!meeting || busy) return;
    busy = true;
    setStatus('원문을 불러와 다시 정리하는 중…');
    try {
      const text = await loadRaw(meetingId);
      if (!text) {
        setStatus('이 회의의 원문을 찾지 못해 다시 정리할 수 없습니다.', 'warn');
        return;
      }
      const result = await organize(
        text,
        { date: meeting.date, title: meeting.title, project: meeting.project },
        meeting.kind
      );
      const linked = new Map(
        meeting.actionItems.filter((item) => item.taskId).map((item) => [item.name, item.taskId])
      );
      const next = normalizeMeeting(
        {
          ...meeting,
          ...result,
          title: meeting.title,
          project: meeting.project,
          organized: true,
          updatedAt: new Date().toISOString()
        },
        0
      );
      next.actionItems.forEach((item) => {
        if (linked.has(item.name)) item.taskId = linked.get(item.name);
      });
      meetings = meetings.map((item) => (item.id === meetingId ? next : item));
      saveMeetings();
      render();
      setStatus('다시 정리했습니다.', 'ok');
    } catch (error) {
      if (String(error?.message) !== 'AI_NOT_CONNECTED') console.warn('Meeting AI failed:', error);
      setStatus('AI에 연결하지 못했습니다. 로그인 상태와 서버 함수 배포를 확인하세요.', 'warn');
    } finally {
      busy = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function filtered() {
    const query = searchText.trim().toLowerCase();
    return meetings
      .filter((meeting) => {
        if (
          filterProject === '__unassigned__'
            ? meeting.project
            : filterProject !== '전체' && meeting.project !== filterProject
        )
          return false;
        if (filterMonth && !meeting.date.startsWith(filterMonth)) return false;
        if (!query) return true;
        const haystack = [
          meeting.title,
          meeting.project,
          ...meeting.summary,
          ...meeting.decisions,
          ...meeting.openIssues,
          ...meeting.actionItems.map((item) => item.name)
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) =>
        a.date === b.date
          ? String(b.createdAt).localeCompare(String(a.createdAt))
          : b.date.localeCompare(a.date)
      );
  }

  function formatDay(dateText) {
    const [year, month, day] = dateText.split('-').map(Number);
    const weekday = ['일', '월', '화', '수', '목', '금', '토'][new Date(year, month - 1, day).getDay()];
    return `${year}.${pad2(month)}.${pad2(day)} (${weekday})`;
  }

  function listHtml(title, items) {
    if (!items.length) return '';
    return `<div class="mt-block"><div class="mt-block-title">${escapeHtml(title)}</div><ul class="mt-bullets">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`;
  }

  function detailHtml(meeting) {
    const liveIds = new Set((window.WorkBoardApp?.getTasks?.() || []).map((task) => task.id));
    const actions = meeting.actionItems.length
      ? `<div class="mt-block"><div class="mt-block-title">액션아이템</div>${meeting.actionItems
          .map((item, index) => {
            const linked = item.taskId && liveIds.has(item.taskId);
            const meta = [item.owner, item.dueDate].filter(Boolean).join(', ');
            return `
            <div class="mt-action">
              <div class="mt-action-text"><span>${escapeHtml(item.name)}</span>${meta ? `<span class="mt-action-meta">${escapeHtml(meta)}</span>` : ''}</div>
              ${
                linked
                  ? `<button type="button" class="text-link" data-meeting-action="open-task" data-task="${escapeHtml(item.taskId)}">업무 보기</button>`
                  : `<button type="button" class="btn btn-secondary mt-small-btn" data-meeting-action="register" data-id="${escapeHtml(meeting.id)}" data-index="${index}">업무로 등록</button>`
              }
            </div>`;
          })
          .join('')}</div>`
      : '';
    const projects = projectNames();
    const projectOptions = [
      '<option value="">미분류</option>',
      ...projects.map(
        (name) =>
          `<option value="${escapeHtml(name)}" ${name === meeting.project ? 'selected' : ''}>${escapeHtml(name)}</option>`
      )
    ].join('');
    const raw = rawShown.get(meeting.id);
    const body = meeting.organized
      ? listHtml('요약', meeting.summary) +
        listHtml('결정사항', meeting.decisions) +
        actions +
        listHtml('남은 이슈', meeting.openIssues)
      : '<div class="mt-pending">아직 정리되지 않은 회의록입니다. 원문만 저장되어 있습니다.</div>';
    return `
      <div class="mt-detail">
        <div class="mt-edit-row">
          <input class="input" type="text" value="${escapeHtml(meeting.title)}" data-meeting-field="title" data-id="${escapeHtml(meeting.id)}" aria-label="회의 제목" />
          <input class="input" type="date" value="${escapeHtml(meeting.date)}" data-meeting-field="date" data-id="${escapeHtml(meeting.id)}" aria-label="회의 날짜" />
          <select class="select" data-meeting-field="project" data-id="${escapeHtml(meeting.id)}" aria-label="프로젝트">${projectOptions}</select>
        </div>
        ${body}
        ${raw != null ? `<div class="mt-block"><div class="mt-block-title">원문</div><pre class="mt-raw">${escapeHtml(raw || '원문이 이 기기와 클라우드 어디에도 없습니다.')}</pre></div>` : ''}
        <div class="mt-detail-actions">
          <button type="button" class="btn btn-secondary mt-small-btn" data-meeting-action="toggle-raw" data-id="${escapeHtml(meeting.id)}">${raw != null ? '원문 닫기' : '원문 보기'}</button>
          <button type="button" class="btn btn-secondary mt-small-btn" data-meeting-action="reorganize" data-id="${escapeHtml(meeting.id)}">${meeting.organized ? '다시 정리' : 'AI로 정리'}</button>
          <button type="button" class="btn btn-danger mt-small-btn" data-meeting-action="delete" data-id="${escapeHtml(meeting.id)}">삭제</button>
        </div>
      </div>`;
  }

  function itemHtml(meeting, showDate) {
    const open = meeting.id === expandedId;
    const counts = meeting.organized
      ? `결정 ${meeting.decisions.length}, 액션 ${meeting.actionItems.length}`
      : '정리 전';
    const lead = meeting.organized
      ? meeting.summary[0] || ''
      : `원문 ${meeting.rawLength.toLocaleString('ko-KR')}자`;
    return `
      <div class="mt-item ${open ? 'open' : ''}">
        <button type="button" class="mt-item-head" data-meeting-action="toggle" data-id="${escapeHtml(meeting.id)}" aria-expanded="${open}">
          <span class="mt-item-title">${escapeHtml(meeting.title)}</span>
          <span class="mt-item-tag">${escapeHtml(showDate ? formatDay(meeting.date) : meeting.project || '미분류')}</span>
          <span class="mt-item-lead">${escapeHtml(lead)}</span>
          <span class="mt-item-count">${escapeHtml(counts)}</span>
        </button>
        ${open ? detailHtml(meeting) : ''}
      </div>`;
  }

  function renderFilters() {
    const select = $('meetingFilterProject');
    const formSelect = $('meetingProject');
    const names = projectNames();
    if (select) {
      const hasUnassigned = meetings.some((meeting) => !meeting.project);
      select.innerHTML = [
        '<option value="전체">전체 프로젝트</option>',
        ...names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`),
        hasUnassigned ? '<option value="__unassigned__">미분류</option>' : ''
      ].join('');
      if (![...select.options].some((option) => option.value === filterProject)) filterProject = '전체';
      select.value = filterProject;
    }
    if (formSelect) {
      const previous = formSelect.value;
      formSelect.innerHTML = [
        '<option value="">자동 분류</option>',
        ...names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
      ].join('');
      formSelect.value = names.includes(previous) ? previous : '';
    }
    document
      .querySelectorAll('[data-meeting-view]')
      .forEach((button) => button.classList.toggle('active', button.dataset.meetingView === view));
  }

  function render() {
    const box = $('meetingList');
    if (!box) return;
    loadMeetings();
    renderFilters();
    if ($('meetingDate') && !$('meetingDate').value) $('meetingDate').value = todayInput();
    const list = filtered();
    const count = $('meetingCount');
    if (count) count.textContent = meetings.length ? `${list.length}건` : '';
    if (!meetings.length) {
      box.innerHTML =
        '<div class="empty">저장된 회의록이 없습니다. 위에 회의 내용을 붙여 넣고 "정리해서 저장"을 누르세요.</div>';
      return;
    }
    if (!list.length) {
      box.innerHTML = '<div class="empty">조건에 맞는 회의록이 없습니다. 필터를 바꿔 보세요.</div>';
      return;
    }
    const groups = new Map();
    list.forEach((meeting) => {
      const key = view === 'project' ? meeting.project || '미분류' : meeting.date;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(meeting);
    });
    let keys = Array.from(groups.keys());
    if (view === 'project')
      keys = keys.sort((a, b) => (a === '미분류' ? 1 : b === '미분류' ? -1 : a.localeCompare(b, 'ko')));
    box.innerHTML = keys
      .map(
        (key) => `
        <div class="mt-group">
          <div class="mt-group-head">${escapeHtml(view === 'project' ? key : formatDay(key))}<span class="mt-group-count">${groups.get(key).length}건</span></div>
          ${groups
            .get(key)
            .map((meeting) => itemHtml(meeting, view === 'project'))
            .join('')}
        </div>`
      )
      .join('');
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  async function onListClick(event) {
    const button = event.target?.closest?.('[data-meeting-action]');
    if (!button) return;
    const action = button.dataset.meetingAction;
    const id = button.dataset.id;
    const meeting = meetings.find((item) => item.id === id);
    if (action === 'toggle') {
      expandedId = expandedId === id ? '' : id;
      render();
    } else if (action === 'open-task') {
      window.WorkBoardApp?.openTaskDetail?.(button.dataset.task);
    } else if (action === 'register' && meeting) {
      const added = registerActionItems(meeting, [Number(button.dataset.index)]);
      saveMeetings();
      render();
      setStatus(added ? '업무로 등록했습니다.' : '이미 등록된 항목입니다.', 'ok');
    } else if (action === 'toggle-raw' && meeting) {
      if (rawShown.has(id)) rawShown.delete(id);
      else rawShown.set(id, await loadRaw(id));
      render();
    } else if (action === 'reorganize' && meeting) {
      await reorganize(id);
    } else if (action === 'delete' && meeting) {
      if (
        !window.confirm(
          `"${meeting.title}" 회의록을 삭제할까요? 원문도 함께 지워지며 되돌릴 수 없습니다. 등록된 업무는 남습니다.`
        )
      )
        return;
      meetings = meetings.filter((item) => item.id !== id);
      rawShown.delete(id);
      saveMeetings();
      await deleteRaw(id);
      render();
      setStatus('회의록을 삭제했습니다.', 'ok');
    }
  }

  function onFieldChange(event) {
    const field = event.target?.dataset?.meetingField;
    if (!field) return;
    const meeting = meetings.find((item) => item.id === event.target.dataset.id);
    if (!meeting) return;
    const value = String(event.target.value || '').trim();
    if (field === 'title') meeting.title = value.slice(0, 200) || meeting.title;
    if (field === 'date' && isDate(value)) meeting.date = value;
    if (field === 'project') meeting.project = value;
    meeting.updatedAt = new Date().toISOString();
    saveMeetings();
    render();
  }

  function init() {
    if (!$('meetingList')) return;
    try {
      view = localStorage.getItem(VIEW_KEY) === 'project' ? 'project' : 'date';
    } catch (error) {
      view = 'date';
    }
    $('meetingOrganize').addEventListener('click', () => createMeeting(true));
    $('meetingSaveRaw').addEventListener('click', () => createMeeting(false));
    $('meetingFile').addEventListener('change', onFileChosen);
    $('meetingFilterProject').addEventListener('change', (event) => {
      filterProject = event.target.value;
      render();
    });
    $('meetingFilterMonth').addEventListener('change', (event) => {
      filterMonth = /^\d{4}-\d{2}$/.test(event.target.value) ? event.target.value : '';
      render();
    });
    $('meetingSearch').addEventListener('input', (event) => {
      searchText = event.target.value;
      render();
    });
    document.querySelectorAll('[data-meeting-view]').forEach((button) =>
      button.addEventListener('click', () => {
        view = button.dataset.meetingView === 'project' ? 'project' : 'date';
        localStorage.setItem(VIEW_KEY, view);
        render();
      })
    );
    $('meetingList').addEventListener('click', onListClick);
    $('meetingList').addEventListener('change', onFieldChange);
    render();
  }

  window.WorkBoardMeetings = { render, cleanTranscript };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
