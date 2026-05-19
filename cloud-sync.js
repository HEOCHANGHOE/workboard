// Backup and Supabase cloud sync layer.
(function () {
  'use strict';

  const DATA_KEYS = [
    'work_dashboard_tasks_v1',
    'work_weekly_history_v1',
    'work_monthly_history_v1',
    'work_project_order_v1',
    'work_project_collapse_v1',
    'work_project_notes_v1',
    'wt_rec',
    'wt_live',
    'wb_tweaks_v22'
  ];
  const SNAPSHOT_VERSION = 2;
  const LOCAL_UPDATED_KEY = 'work_board_local_updated_at';
  const APPLIED_HASH_KEY = 'work_board_applied_snapshot_hash';
  const SAFETY_BACKUPS_KEY = 'work_board_safety_backups_v1';
  const PRE_SYNC_BACKUP_KEY = 'work_board_pre_sync_backup';
  const ACTIVE_TAB_KEY = 'work_board_active_tab';
  const CONFIG = window.WORK_BOARD_CONFIG || {};
  const PLACEHOLDER_URL = 'https://YOUR-PROJECT-REF.supabase.co';
  const AUTO_SYNC_INTERVAL_MS = 8000;
  const MAX_SAFETY_BACKUPS = 20;
  const STALE_CONTENT_GAP_MS = 36 * 60 * 60 * 1000;
  const MAX_BACKUP_FILE_BYTES = 2 * 1024 * 1024;
  const MAX_JSON_DEPTH = 8;
  const MAX_OBJECT_KEYS = 500;
  const MAX_STRING_LENGTH = 12000;
  const DATA_KEY_RULES = {
    work_dashboard_tasks_v1: { type: 'array', maxItems: 3000 },
    work_weekly_history_v1: { type: 'array', maxItems: 1000 },
    work_monthly_history_v1: { type: 'array', maxItems: 1000 },
    work_project_order_v1: { type: 'array', maxItems: 1000 },
    work_project_collapse_v1: { type: 'array', maxItems: 1000 },
    work_project_notes_v1: { type: 'object', maxKeys: 1000 },
    wt_rec: { type: 'object', maxKeys: 5000 },
    wt_live: { type: 'objectOrNull', maxKeys: 20 },
    wb_tweaks_v22: { type: 'object', maxKeys: 40 }
  };
  let client = null;
  let session = null;
  let accessProfile = null;
  let uploadTimer = null;
  let syncTimer = null;
  let isSyncing = false;
  let suppressUpload = false;
  let initialRemoteChecked = false;
  let pendingUploadAfterInitialCheck = false;
  let isStoragePatched = false;

  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;

  function isCloudConfigured() {
    return Boolean(
      CONFIG.supabaseUrl &&
      CONFIG.supabaseAnonKey &&
      CONFIG.supabaseUrl !== PLACEHOLDER_URL &&
      CONFIG.supabaseAnonKey !== 'YOUR-SUPABASE-ANON-KEY'
    );
  }

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setState(text, mode) {
    const el = $('syncState');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('online', 'warn', 'error');
    if (mode) el.classList.add(mode);
  }

  function isApprovedProfile(profile = accessProfile) {
    return Boolean(profile && profile.status === 'approved' && ['owner', 'admin', 'member'].includes(profile.role));
  }

  function isAdminProfile(profile = accessProfile) {
    return Boolean(profile && profile.status === 'approved' && ['owner', 'admin'].includes(profile.role));
  }

  function setCloudControls(isSignedIn, profile = accessProfile) {
    const login = $('googleLoginBtn');
    const logout = $('logoutBtn');
    const pull = $('cloudPullBtn');
    const push = $('cloudPushBtn');
    const users = $('userManageBtn');
    const approved = isSignedIn && isApprovedProfile(profile);
    const admin = isSignedIn && isAdminProfile(profile);
    if (login) login.hidden = isSignedIn || !isCloudConfigured();
    if (logout) logout.hidden = !isSignedIn;
    if (pull) pull.hidden = !approved;
    if (push) push.hidden = !approved;
    if (users) users.hidden = !admin;
  }

  function markLocalUpdated() {
    originalSetItem.call(localStorage, LOCAL_UPDATED_KEY, new Date().toISOString());
  }

  function getLocalUpdatedAt() {
    return localStorage.getItem(LOCAL_UPDATED_KEY) || null;
  }

  function isEmptyArrayValue(value) {
    return value == null || (Array.isArray(value) && value.length === 0);
  }

  function isEmptyObjectValue(value) {
    return value == null || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
  }

  function snapshotHasMeaningfulData(snapshot) {
    if (!snapshot || !snapshot.data) return false;
    return !isEmptyArrayValue(snapshot.data.work_dashboard_tasks_v1) ||
      !isEmptyArrayValue(snapshot.data.work_weekly_history_v1) ||
      !isEmptyArrayValue(snapshot.data.work_monthly_history_v1) ||
      !isEmptyObjectValue(snapshot.data.work_project_notes_v1) ||
      !isEmptyObjectValue(snapshot.data.wt_rec);
  }

  function localHasMeaningfulData() {
    return !isEmptyArrayValue(readJsonKey('work_dashboard_tasks_v1')) ||
      !isEmptyArrayValue(readJsonKey('work_weekly_history_v1')) ||
      !isEmptyArrayValue(readJsonKey('work_monthly_history_v1')) ||
      !isEmptyObjectValue(readJsonKey('work_project_notes_v1')) ||
      !isEmptyObjectValue(readJsonKey('wt_rec'));
  }

  function readJsonKey(key) {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      return raw;
    }
  }

  function parseTime(value) {
    const time = Date.parse(value || '');
    return Number.isFinite(time) ? time : 0;
  }

  function getLocalUpdatedTime() {
    return parseTime(getLocalUpdatedAt());
  }

  function getRemoteUpdatedTime(remote) {
    return parseTime(remote?.updated_at || remote?.payload?.localUpdatedAt || remote?.payload?.exportedAt);
  }

  function cloneSnapshot(snapshot) {
    const clone = JSON.parse(JSON.stringify(snapshot || {}));
    delete clone.safetyBackups;
    return clone;
  }

  function summarizeSnapshot(snapshot) {
    const data = (snapshot && snapshot.data) || {};
    return {
      tasks: Array.isArray(data.work_dashboard_tasks_v1) ? data.work_dashboard_tasks_v1.length : 0,
      weekly: Array.isArray(data.work_weekly_history_v1) ? data.work_weekly_history_v1.length : 0,
      monthly: Array.isArray(data.work_monthly_history_v1) ? data.work_monthly_history_v1.length : 0,
      notes: data.work_project_notes_v1 && typeof data.work_project_notes_v1 === 'object'
        ? Object.keys(data.work_project_notes_v1).length
        : 0
    };
  }

  function getSafetyBackups() {
    const raw = localStorage.getItem(SAFETY_BACKUPS_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((item) => item && item.snapshot) : [];
    } catch (error) {
      console.error(error);
      return [];
    }
  }

  function compactSafetyBackups(entries) {
    const seen = new Set();
    return entries
      .filter((entry) => entry && entry.snapshot && snapshotHasMeaningfulData(entry.snapshot))
      .filter((entry) => {
        const hash = snapshotDataHash(entry.snapshot);
        if (seen.has(hash)) return false;
        seen.add(hash);
        return true;
      })
      .slice(0, MAX_SAFETY_BACKUPS);
  }

  function makeSafetyBackupEntry(snapshot, reason, source, capturedAt) {
    const safeSnapshot = cloneSnapshot(snapshot);
    return {
      id: `backup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      capturedAt: capturedAt || new Date().toISOString(),
      reason: reason || '자동 보호',
      source: source || 'local',
      summary: summarizeSnapshot(safeSnapshot),
      snapshot: safeSnapshot
    };
  }

  function createSafetyBackup(reason, snapshot = buildSnapshot(), source = 'local') {
    if (!snapshotHasMeaningfulData(snapshot)) return null;
    const entry = makeSafetyBackupEntry(snapshot, reason, source);
    const backups = compactSafetyBackups([entry, ...getSafetyBackups()]);
    originalSetItem.call(localStorage, SAFETY_BACKUPS_KEY, JSON.stringify(backups));
    return entry;
  }

  function snapshotContentTime(snapshot) {
    const keys = new Set(['createdAt', 'updatedAt', 'savedAt']);
    let latest = 0;
    const visit = (value, key = '') => {
      if (value == null) return;
      if (typeof value === 'string') {
        if (keys.has(key)) latest = Math.max(latest, parseTime(value));
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((item) => visit(item));
        return;
      }
      if (typeof value === 'object') {
        Object.entries(value).forEach(([childKey, childValue]) => visit(childValue, childKey));
      }
    };
    visit((snapshot && snapshot.data) || {});
    return latest;
  }

  function contentLooksCurrent(contentTime, updatedTime) {
    if (!contentTime || !updatedTime) return false;
    return Math.abs(updatedTime - contentTime) <= STALE_CONTENT_GAP_MS;
  }

  function entryContentTime(entry) {
    const keys = new Set(['createdAt', 'updatedAt', 'savedAt']);
    let latest = 0;
    const visit = (value, key = '') => {
      if (value == null) return;
      if (typeof value === 'string') {
        if (keys.has(key)) latest = Math.max(latest, parseTime(value));
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((item) => visit(item));
        return;
      }
      if (typeof value === 'object') {
        Object.entries(value).forEach(([childKey, childValue]) => visit(childValue, childKey));
      }
    };
    visit(entry);
    return latest;
  }

  function snapshotEntryMap(snapshot) {
    const data = (snapshot && snapshot.data) || {};
    const entries = new Map();
    [
      ['task', data.work_dashboard_tasks_v1],
      ['weekly', data.work_weekly_history_v1],
      ['monthly', data.work_monthly_history_v1]
    ].forEach(([prefix, list]) => {
      if (!Array.isArray(list)) return;
      list.forEach((item) => {
        if (item && item.id != null) entries.set(`${prefix}:${String(item.id)}`, item);
      });
    });
    const notes = data.work_project_notes_v1;
    if (notes && typeof notes === 'object' && !Array.isArray(notes)) {
      Object.entries(notes).forEach(([name, note]) => entries.set(`note:${name}`, note));
    }
    return entries;
  }

  function snapshotEntryIds(snapshot) {
    return new Set(snapshotEntryMap(snapshot).keys());
  }

  function hasEntriesMissingFrom(candidate, baseline) {
    const candidateIds = snapshotEntryIds(candidate);
    const baselineIds = snapshotEntryIds(baseline);
    return Array.from(candidateIds).some((id) => !baselineIds.has(id));
  }

  function missingEntryContentTime(candidate, baseline) {
    const candidateEntries = snapshotEntryMap(candidate);
    const baselineIds = snapshotEntryIds(baseline);
    let latest = 0;
    candidateEntries.forEach((entry, id) => {
      if (!baselineIds.has(id)) latest = Math.max(latest, entryContentTime(entry));
    });
    return latest;
  }

  function chooseSnapshotWinner(localSnapshot, remote) {
    if (!remote || !remote.payload || sameSnapshotData(localSnapshot, remote.payload)) return 'same';
    const localHasData = snapshotHasMeaningfulData(localSnapshot);
    const remoteHasData = snapshotHasMeaningfulData(remote.payload);
    if (!localHasData && remoteHasData) return 'remote';
    if (localHasData && !remoteHasData) return 'local';
    const localClock = getLocalUpdatedTime();
    const remoteClock = getRemoteUpdatedTime(remote);
    const localContent = snapshotContentTime(localSnapshot);
    const remoteContent = snapshotContentTime(remote.payload);
    const localContentCurrent = contentLooksCurrent(localContent, localClock);
    const remoteContentCurrent = contentLooksCurrent(remoteContent, remoteClock);
    const localOnlyEntries = hasEntriesMissingFrom(localSnapshot, remote.payload);
    const remoteOnlyEntries = hasEntriesMissingFrom(remote.payload, localSnapshot);
    const localMissingTime = missingEntryContentTime(localSnapshot, remote.payload);
    const remoteMissingTime = missingEntryContentTime(remote.payload, localSnapshot);
    if (localOnlyEntries && !remoteOnlyEntries && localContentCurrent && localMissingTime > remoteContent + 1000) return 'local-content-newer';
    if (remoteOnlyEntries && !localOnlyEntries && remoteContentCurrent && remoteMissingTime > localContent + 1000) return 'remote-content-newer';
    if (localContentCurrent && localContent > remoteContent + 1000 && remoteClock > localClock + 1000) return 'local-content-newer';
    if (remoteContentCurrent && remoteContent > localContent + 1000 && localClock > remoteClock + 1000) return 'remote-content-newer';
    if (remoteClock > localClock + 1000 || (localClock === 0 && remoteHasData)) return 'remote';
    if (localClock > remoteClock + 1000) return 'local';
    if (localContent > remoteContent + 1000) return 'local';
    if (remoteContent > localContent + 1000) return 'remote';
    return 'conflict';
  }

  function buildSnapshot() {
    const data = {};
    DATA_KEYS.forEach((key) => {
      data[key] = readJsonKey(key);
    });
    return {
      app: 'work-board',
      version: SNAPSHOT_VERSION,
      exportedAt: new Date().toISOString(),
      localUpdatedAt: getLocalUpdatedAt(),
      data
    };
  }

  function arrayById(value) {
    return Array.isArray(value) ? value.filter((item) => item && item.id != null) : [];
  }

  function mergeArrayById(remoteValue, localValue) {
    const map = new Map();
    arrayById(remoteValue).forEach((item) => map.set(String(item.id), item));
    arrayById(localValue).forEach((item) => map.set(String(item.id), item));
    return Array.from(map.values());
  }

  function mergeUniqueArray(remoteValue, localValue) {
    return Array.from(new Set([
      ...(Array.isArray(remoteValue) ? remoteValue : []),
      ...(Array.isArray(localValue) ? localValue : [])
    ].filter((item) => item != null && String(item).trim() !== '')));
  }

  function sameSnapshotData(a, b) {
    return JSON.stringify((a && a.data) || {}) === JSON.stringify((b && b.data) || {});
  }

  function snapshotUpdatedTime(snapshot, fallback) {
    return Date.parse((snapshot && (snapshot.localUpdatedAt || snapshot.exportedAt)) || fallback || '1970-01-01T00:00:00.000Z') || 0;
  }

  function snapshotDataHash(snapshot) {
    return JSON.stringify((snapshot && snapshot.data) || {});
  }

  function rememberActiveTab() {
    const activeTab = document.querySelector('.tab.active')?.dataset?.tab;
    if (activeTab) sessionStorage.setItem(ACTIVE_TAB_KEY, activeTab);
  }

  function refreshAfterSnapshot(snapshot) {
    const hash = snapshotDataHash(snapshot);
    if (!hash || sessionStorage.getItem(APPLIED_HASH_KEY) === hash) return false;
    sessionStorage.setItem(APPLIED_HASH_KEY, hash);
    rememberActiveTab();
    if (window.WorkBoardApp && typeof window.WorkBoardApp.refreshFromStorage === 'function') {
      suppressUpload = true;
      try {
        window.WorkBoardApp.refreshFromStorage();
      } finally {
        suppressUpload = false;
      }
    } else {
      window.setTimeout(() => window.location.reload(), 250);
    }
    return true;
  }

  function isPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function safeTimestamp(value, fallback) {
    const time = Date.parse(value || '');
    return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
  }

  function sanitizeJsonValue(value, depth = 0, maxObjectKeys = MAX_OBJECT_KEYS) {
    if (depth > MAX_JSON_DEPTH) return null;
    if (value == null) return null;
    if (typeof value === 'string') return value.slice(0, MAX_STRING_LENGTH);
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'boolean') return value;
    if (Array.isArray(value)) {
      return value.slice(0, 3000).map((item) => sanitizeJsonValue(item, depth + 1, maxObjectKeys));
    }
    if (typeof value === 'object') {
      const out = {};
      Object.entries(value).slice(0, maxObjectKeys).forEach(([key, childValue]) => {
        const safeKey = String(key).slice(0, 160);
        out[safeKey] = sanitizeJsonValue(childValue, depth + 1, maxObjectKeys);
      });
      return out;
    }
    return null;
  }

  function sanitizeDataValue(key, value) {
    const rule = DATA_KEY_RULES[key];
    if (!rule) throw new Error('허용되지 않은 백업 데이터 항목입니다.');
    if (value == null) return null;
    if (rule.type === 'array') {
      if (!Array.isArray(value)) throw new Error(`${key} 형식이 올바르지 않습니다.`);
      return value.slice(0, rule.maxItems).map((item) => sanitizeJsonValue(item));
    }
    if (rule.type === 'object') {
      if (!isPlainObject(value)) throw new Error(`${key} 형식이 올바르지 않습니다.`);
      return sanitizeJsonValue(value, 0, rule.maxKeys);
    }
    if (rule.type === 'objectOrNull') {
      if (value == null) return null;
      if (!isPlainObject(value)) throw new Error(`${key} 형식이 올바르지 않습니다.`);
      return sanitizeJsonValue(value, 0, rule.maxKeys);
    }
    throw new Error(`${key} 형식이 올바르지 않습니다.`);
  }

  function sanitizeSnapshot(snapshot) {
    if (!isPlainObject(snapshot) || !isPlainObject(snapshot.data)) {
      throw new Error('올바른 Work Board 백업 파일이 아닙니다.');
    }
    if (snapshot.app && snapshot.app !== 'work-board') {
      throw new Error('다른 앱의 백업 파일입니다.');
    }
    if (snapshot.version && Number(snapshot.version) > SNAPSHOT_VERSION) {
      throw new Error('현재 앱보다 새 버전에서 만든 백업입니다.');
    }
    const data = {};
    DATA_KEYS.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(snapshot.data, key)) {
        data[key] = sanitizeDataValue(key, snapshot.data[key]);
      }
    });
    const now = new Date().toISOString();
    return {
      app: 'work-board',
      version: SNAPSHOT_VERSION,
      exportedAt: safeTimestamp(snapshot.exportedAt, now),
      localUpdatedAt: safeTimestamp(snapshot.localUpdatedAt, snapshot.exportedAt || now),
      data
    };
  }

  function applySnapshot(snapshot) {
    if (!snapshot || !snapshot.data || typeof snapshot.data !== 'object') {
      throw new Error('올바른 Work Board 백업 파일이 아닙니다.');
    }
    const safeSnapshot = sanitizeSnapshot(snapshot);
    suppressUpload = true;
    try {
      DATA_KEYS.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(safeSnapshot.data, key)) {
          const value = safeSnapshot.data[key];
          if (value == null) originalRemoveItem.call(localStorage, key);
          else originalSetItem.call(localStorage, key, JSON.stringify(value));
        }
      });
      originalSetItem.call(localStorage, LOCAL_UPDATED_KEY, safeSnapshot.localUpdatedAt || safeSnapshot.exportedAt || new Date().toISOString());
    } finally {
      suppressUpload = false;
    }
    return safeSnapshot;
  }

  function exportBackup() {
    const snapshot = buildSnapshot();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `work-board-backup-${date}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setState('저장됨', 'online');
  }

  function importBackup(file) {
    if (!file) return;
    if (file.size > MAX_BACKUP_FILE_BYTES) {
      alert('백업 파일이 너무 큽니다. 2MB 이하의 Work Board 백업만 가져올 수 있습니다.');
      setState('복원 실패', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const snapshot = JSON.parse(String(reader.result || '{}'));
        createSafetyBackup('가져오기 전 현재 상태', buildSnapshot(), 'local');
        const appliedSnapshot = applySnapshot(snapshot);
        setState('복원됨', 'online');
        rememberActiveTab();
        refreshAfterSnapshot(appliedSnapshot);
      } catch (error) {
        alert(error.message || '백업 파일을 읽을 수 없습니다.');
        setState('복원 실패', 'error');
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  function getSignedInUser() {
    return session && session.user ? session.user : null;
  }

  function getUser() {
    const user = getSignedInUser();
    return user && isApprovedProfile(accessProfile) ? user : null;
  }

  async function fetchRemoteSnapshot() {
    const user = getUser();
    if (!client || !user) return null;
    const { data, error } = await client
      .from('work_board_snapshots')
      .select('payload, updated_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  function applyRemoteSnapshot(remote, reason = '클라우드 적용 전 로컬 백업') {
    if (!remote || !remote.payload) return false;
    const localSnapshot = buildSnapshot();
    if (snapshotHasMeaningfulData(localSnapshot) && !sameSnapshotData(localSnapshot, remote.payload)) {
      createSafetyBackup(reason, localSnapshot, 'local');
    }
    const appliedSnapshot = applySnapshot(remote.payload);
    originalSetItem.call(
      localStorage,
      LOCAL_UPDATED_KEY,
      remote.updated_at || remote.payload.localUpdatedAt || remote.payload.exportedAt || new Date().toISOString()
    );
    pendingUploadAfterInitialCheck = false;
    refreshAfterSnapshot(appliedSnapshot);
    return true;
  }

  function completeInitialCloudCheck() {
    if (initialRemoteChecked) return;
    initialRemoteChecked = true;
    if (pendingUploadAfterInitialCheck) {
      pendingUploadAfterInitialCheck = false;
      scheduleCloudUpload();
    }
  }

  function attachRemoteBackupTrail(localSnapshot, remote, reason = '클라우드 덮어쓰기 전 백업') {
    const existingRemoteBackups = Array.isArray(remote?.payload?.safetyBackups) ? remote.payload.safetyBackups : [];
    const nextBackups = remote?.payload && snapshotHasMeaningfulData(remote.payload) && !sameSnapshotData(localSnapshot, remote.payload)
      ? [makeSafetyBackupEntry(remote.payload, reason, 'cloud', remote.updated_at), ...existingRemoteBackups]
      : existingRemoteBackups;
    localSnapshot.safetyBackups = compactSafetyBackups(nextBackups);
    return localSnapshot;
  }

  async function pushToCloud(options = {}) {
    const user = getUser();
    if (!client || !user) return;
    const force = Boolean(options.force);
    const manual = Boolean(options.manual);
    const localSnapshot = buildSnapshot();
    const remote = await fetchRemoteSnapshot();
    const localHasData = snapshotHasMeaningfulData(localSnapshot);
    const remoteHasData = snapshotHasMeaningfulData(remote && remote.payload);
    if (!localHasData && remoteHasData) {
      applyRemoteSnapshot(remote, '빈 로컬 보호 백업');
      setState('최신 상태', 'online');
      return;
    }
    const winner = remote && remote.payload ? chooseSnapshotWinner(localSnapshot, remote) : 'local';
    if (!force && remoteHasData && winner === 'remote') {
      applyRemoteSnapshot(remote, '오래된 로컬 업로드 차단 전 백업');
      setState('클라우드 최신 적용', 'warn');
      if (manual) alert('이 기기 데이터가 클라우드보다 오래되어 올리기를 막고, 클라우드 최신 내용을 적용했습니다. 적용 전 로컬 상태는 복구 지점에 보관했습니다.');
      return;
    }
    if (!force && remoteHasData && winner === 'remote-content-newer') {
      applyRemoteSnapshot(remote, '내용 기준 클라우드 최신 적용 전 백업');
      setState('클라우드 최신 적용', 'warn');
      if (manual) alert('클라우드 쪽 내용이 더 최신으로 보여 올리기를 막았습니다. 적용 전 로컬 상태는 복구 지점에 보관했습니다.');
      return;
    }
    if (!force && remoteHasData && winner === 'conflict') {
      setState('충돌 확인 필요', 'warn');
      if (!manual || !confirm('클라우드와 이 기기 데이터가 서로 다릅니다. 현재 이 기기 데이터로 클라우드를 덮어쓸까요?')) return;
    }
    const now = new Date().toISOString();
    if (!getLocalUpdatedAt() || force) originalSetItem.call(localStorage, LOCAL_UPDATED_KEY, now);
    localSnapshot.localUpdatedAt = getLocalUpdatedAt() || now;
    localSnapshot.exportedAt = now;
    attachRemoteBackupTrail(localSnapshot, remote);
    const { error } = await client
      .from('work_board_snapshots')
      .upsert({
        user_id: user.id,
        payload: localSnapshot
      }, { onConflict: 'user_id' });
    if (error) throw error;
    originalSetItem.call(localStorage, LOCAL_UPDATED_KEY, now);
    setState('저장됨', 'online');
  }

  async function syncWithCloud(options = {}) {
    const user = getUser();
    if (!client || !user || isSyncing) return;
    isSyncing = true;
    try {
      const localSnapshot = buildSnapshot();
      const remote = await fetchRemoteSnapshot();
      if (!remote || !remote.payload) {
        if (snapshotHasMeaningfulData(localSnapshot)) await pushToCloud({ silent: options.silent });
        return;
      }
      const winner = chooseSnapshotWinner(localSnapshot, remote);
      if (winner === 'remote' || winner === 'remote-content-newer') {
        applyRemoteSnapshot(remote, '동기화 적용 전 로컬 백업');
        setState('최신 상태', 'online');
      } else if (winner === 'local' || winner === 'local-content-newer') {
        await pushToCloud({ force: winner === 'local-content-newer', silent: options.silent });
        if (winner === 'local-content-newer') setState('로컬 최신 보호', 'warn');
      } else if (winner === 'conflict') {
        setState('충돌 확인 필요', 'warn');
      } else if (!options.silent) {
        setState('최신 상태', 'online');
      }
    } catch (error) {
      console.error(error);
      setState('동기화 실패', 'error');
    } finally {
      isSyncing = false;
      completeInitialCloudCheck();
    }
  }

  async function pullFromCloud(force) {
    try {
      const remote = await fetchRemoteSnapshot();
      if (!remote || !remote.payload) {
        setState('저장된 데이터 없음', 'warn');
        return;
      }
      if (!force && !confirm('클라우드 데이터를 이 기기에 덮어쓸까요?')) return;
      applyRemoteSnapshot(remote, '수동 불러오기 전 로컬 백업');
      setState('불러옴', 'online');
    } catch (error) {
      console.error(error);
      setState('불러오기 실패', 'error');
      alert(error.message || '클라우드 데이터를 불러오지 못했습니다.');
    }
  }

  function formatBackupLabel(entry, index) {
    const captured = new Date(entry.capturedAt || entry.snapshot?.exportedAt || '');
    const capturedText = Number.isNaN(captured.getTime()) ? '시간 알 수 없음' : captured.toLocaleString('ko-KR');
    const summary = entry.summary || summarizeSnapshot(entry.snapshot);
    return `${index + 1}. ${capturedText} · 업무 ${summary.tasks} · 주간 ${summary.weekly} · 월간 ${summary.monthly} · 노트 ${summary.notes} · ${entry.reason || entry.source || '백업'}`;
  }

  async function collectSafetyBackups() {
    const localBackups = getSafetyBackups();
    const legacyBackupRaw = localStorage.getItem(PRE_SYNC_BACKUP_KEY);
    const legacyBackups = [];
    if (legacyBackupRaw) {
      try {
        const legacySnapshot = JSON.parse(legacyBackupRaw);
        legacyBackups.push(makeSafetyBackupEntry(
          legacySnapshot,
          '동기화 전 되돌리기 백업',
          'local',
          legacySnapshot.localUpdatedAt || legacySnapshot.exportedAt
        ));
      } catch (error) {
        console.error(error);
      }
    }
    let remoteBackups = [];
    try {
      const remote = await fetchRemoteSnapshot();
      remoteBackups = Array.isArray(remote?.payload?.safetyBackups) ? remote.payload.safetyBackups : [];
    } catch (error) {
      console.error(error);
    }
    return compactSafetyBackups([...legacyBackups, ...localBackups, ...remoteBackups])
      .sort((a, b) => parseTime(b.capturedAt || b.snapshot?.exportedAt) - parseTime(a.capturedAt || a.snapshot?.exportedAt));
  }

  async function restoreSafetyBackup() {
    const backups = await collectSafetyBackups();
    if (!backups.length) {
      alert('아직 사용할 수 있는 복구 지점이 없습니다.');
      setState('복구 지점 없음', 'warn');
      return;
    }
    const listText = backups.map(formatBackupLabel).join('\n');
    const answer = prompt(`복구할 번호를 입력하세요.\n\n${listText}`);
    if (answer == null) return;
    const index = Number(answer.trim()) - 1;
    if (!Number.isInteger(index) || !backups[index]) {
      alert('번호를 다시 확인해 주세요.');
      return;
    }
    if (!confirm('선택한 복구 지점으로 현재 화면 데이터를 바꿀까요? 현재 상태도 복구 지점에 먼저 보관됩니다.')) return;
    createSafetyBackup('복구 실행 전 현재 상태', buildSnapshot(), 'local');
    const appliedSnapshot = applySnapshot(backups[index].snapshot);
    originalRemoveItem.call(localStorage, PRE_SYNC_BACKUP_KEY);
    const now = new Date().toISOString();
    originalSetItem.call(localStorage, LOCAL_UPDATED_KEY, now);
    setState('복구됨', 'warn');
    refreshAfterSnapshot(appliedSnapshot);
    if (client && getUser() && confirm('복구한 내용을 클라우드에도 저장할까요?')) {
      pushToCloud({ force: true, manual: true }).catch((error) => {
        console.error(error);
        setState('복구 올리기 실패', 'error');
        alert(error.message || '복구한 내용을 클라우드에 저장하지 못했습니다.');
      });
    }
  }

  function scheduleCloudUpload() {
    if (suppressUpload || !client || !getUser()) return;
    if (!initialRemoteChecked) {
      pendingUploadAfterInitialCheck = true;
      setState('동기화 확인 중', 'warn');
      return;
    }
    window.clearTimeout(uploadTimer);
    uploadTimer = window.setTimeout(() => {
      pushToCloud({ silent: true }).catch((error) => {
        console.error(error);
        setState('동기화 실패', 'error');
      });
    }, 900);
  }

  function scheduleLocalRefreshFromStorage() {
    window.clearTimeout(window.workBoardStorageRefreshTimer);
    window.workBoardStorageRefreshTimer = window.setTimeout(() => {
      if (window.WorkBoardApp && typeof window.WorkBoardApp.refreshFromStorage === 'function') {
        suppressUpload = true;
        try {
          window.WorkBoardApp.refreshFromStorage();
        } finally {
          suppressUpload = false;
        }
      }
    }, 120);
  }

  function patchLocalStorage() {
    if (isStoragePatched) return;
    isStoragePatched = true;
    Storage.prototype.setItem = function patchedSetItem(key, value) {
      const previous = this.getItem(key);
      originalSetItem.call(this, key, value);
      if (!suppressUpload && DATA_KEYS.includes(key) && previous !== value) {
        markLocalUpdated();
        scheduleCloudUpload();
      }
    };
    Storage.prototype.removeItem = function patchedRemoveItem(key) {
      const previous = this.getItem(key);
      originalRemoveItem.call(this, key);
      if (!suppressUpload && DATA_KEYS.includes(key) && previous !== null) {
        markLocalUpdated();
        scheduleCloudUpload();
      }
    };
    window.addEventListener('storage', (event) => {
      if (DATA_KEYS.includes(event.key)) scheduleLocalRefreshFromStorage();
    });
  }

  async function signInWithGoogle() {
    if (!client) {
      setState('설정 필요', 'warn');
      alert('config.js에 Supabase URL과 anon key를 먼저 입력하세요.');
      return;
    }
    const redirectTo = CONFIG.redirectUrl || (window.location.origin + window.location.pathname);
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo }
    });
    if (error) {
      console.error(error);
      setState('로그인 실패', 'error');
      alert(error.message || 'Google 로그인을 시작하지 못했습니다.');
    }
  }

  async function signOut() {
    if (!client) return;
    await client.auth.signOut();
    session = null;
    accessProfile = null;
    setCloudControls(false);
    renderAccessGate(null);
    setState('로컬 모드', 'warn');
  }

  function profileEmail(profile = accessProfile) {
    return profile?.email || getSignedInUser()?.email || '';
  }

  function renderAccessGate(profile) {
    const gate = $('accessGate');
    if (!gate) return;
    const signedIn = Boolean(getSignedInUser());
    if (!signedIn || isApprovedProfile(profile)) {
      gate.hidden = true;
      return;
    }
    gate.hidden = false;
    const title = $('accessGateTitle');
    const body = $('accessGateBody');
    const meta = $('accessGateMeta');
    const email = profileEmail(profile);
    const status = profile?.status || 'checking';
    if (status === 'blocked') {
      if (title) title.textContent = '접근이 차단되었습니다';
      if (body) body.textContent = '관리자가 이 Google 계정의 Work Board 클라우드 접근을 차단했습니다.';
    } else if (status === 'pending') {
      if (title) title.textContent = '승인 대기 중입니다';
      if (body) body.textContent = '관리자가 승인하면 이 계정으로 클라우드 동기화를 사용할 수 있습니다.';
    } else {
      if (title) title.textContent = '승인 상태 확인 중';
      if (body) body.textContent = 'Google 계정 승인 상태를 확인하고 있습니다.';
    }
    if (meta) {
      meta.textContent = email ? `로그인 계정: ${email}` : '로그인 계정 정보를 확인 중입니다.';
    }
  }

  async function ensureAccessProfile() {
    const user = getSignedInUser();
    if (!client || !user) {
      accessProfile = null;
      renderAccessGate(null);
      setCloudControls(false);
      return null;
    }
    setState('승인 확인 중', 'warn');
    const { data, error } = await client.rpc('work_board_register_current_user');
    if (error) throw error;
    accessProfile = Array.isArray(data) ? data[0] : data;
    renderAccessGate(accessProfile);
    setCloudControls(true, accessProfile);
    if (isApprovedProfile(accessProfile)) {
      setState('동기화 연결됨', 'online');
    } else if (accessProfile?.status === 'blocked') {
      setState('접근 차단됨', 'error');
      completeInitialCloudCheck();
    } else {
      setState('승인 대기 중', 'warn');
      completeInitialCloudCheck();
    }
    return accessProfile;
  }

  async function refreshSession() {
    if (!client) return;
    const result = await client.auth.getSession();
    session = result.data.session;
    const user = getSignedInUser();
    if (user) {
      await ensureAccessProfile();
      return;
    } else {
      accessProfile = null;
      renderAccessGate(null);
      setCloudControls(false);
      setState('로그인 필요', 'warn');
    }
  }

  async function checkRemoteFreshness() {
    if (!client || !getUser()) {
      completeInitialCloudCheck();
      return;
    }
    try {
      const remote = await fetchRemoteSnapshot();
      if (!remote || !remote.payload) return;
      const localUpdated = Date.parse(getLocalUpdatedAt() || '1970-01-01T00:00:00.000Z');
      const remoteUpdated = Date.parse(remote.updated_at || remote.payload.exportedAt || '1970-01-01T00:00:00.000Z');
      const localEmpty = !localHasMeaningfulData();
      const remoteHasData = snapshotHasMeaningfulData(remote.payload);
      if (localEmpty && remoteHasData) {
        const appliedSnapshot = applySnapshot(remote.payload);
        refreshAfterSnapshot(appliedSnapshot);
        return;
      }
      if (remoteUpdated > localUpdated + 1000) {
        syncWithCloud({ silent: true });
      }
    } catch (error) {
      console.error(error);
      setState('동기화 확인 실패', 'error');
    } finally {
      completeInitialCloudCheck();
    }
  }

  function statusLabel(status) {
    return { pending: '승인 대기', approved: '승인됨', blocked: '차단됨' }[status] || status || '-';
  }

  function roleLabel(role) {
    return { owner: '소유자', admin: '관리자', member: '사용자' }[role] || role || '-';
  }

  function formatProfileDate(value) {
    const date = new Date(value || '');
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('ko-KR');
  }

  function openUserAccessModal() {
    if (!isAdminProfile()) return;
    $('userAccessModal')?.classList.add('open');
    loadUserAccessList();
  }

  function closeUserAccessModal() {
    $('userAccessModal')?.classList.remove('open');
  }

  function renderUserAccessList(items) {
    const list = $('userAccessList');
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<div class="empty">사용자 요청이 없습니다.</div>';
      return;
    }
    list.innerHTML = items.map((profile) => {
      const isSelf = profile.user_id === getSignedInUser()?.id;
      const roleDisabled = !isAdminProfile() || (profile.role === 'owner' && accessProfile?.role !== 'owner') || isSelf;
      const ownerLocked = profile.role === 'owner' && accessProfile?.role !== 'owner';
      const disabled = isSelf || ownerLocked ? 'disabled' : '';
      return `
        <div class="user-access-row" data-user-id="${escapeHtml(profile.user_id)}">
          <div class="user-access-person">
            <div class="user-access-email">${escapeHtml(profile.email)}</div>
            <div class="user-access-meta">${escapeHtml(profile.display_name || '')} · 요청 ${escapeHtml(formatProfileDate(profile.requested_at))}</div>
          </div>
          <select class="user-access-select" data-user-status ${disabled}>
            ${['pending', 'approved', 'blocked'].map((status) => `<option value="${status}" ${profile.status === status ? 'selected' : ''}>${statusLabel(status)}</option>`).join('')}
          </select>
          <select class="user-access-select" data-user-role ${roleDisabled ? 'disabled' : ''}>
            ${['member', 'admin', 'owner'].map((role) => `<option value="${role}" ${profile.role === role ? 'selected' : ''}>${roleLabel(role)}</option>`).join('')}
          </select>
          <button class="btn btn-secondary user-access-save" type="button" data-user-save ${disabled}>저장</button>
        </div>`;
    }).join('');
  }

  async function loadUserAccessList() {
    const list = $('userAccessList');
    if (!client || !isAdminProfile()) return;
    if (list) list.innerHTML = '<div class="empty">불러오는 중...</div>';
    try {
      const { data, error } = await client
        .from('work_board_user_profiles')
        .select('user_id,email,display_name,role,status,requested_at,approved_at,updated_at')
        .order('requested_at', { ascending: false });
      if (error) throw error;
      renderUserAccessList(data || []);
    } catch (error) {
      console.error(error);
      if (list) list.innerHTML = '<div class="empty">사용자 목록을 불러오지 못했습니다.</div>';
    }
  }

  async function saveUserAccess(row) {
    if (!row || !client || !isAdminProfile()) return;
    const userId = row.dataset.userId;
    const status = row.querySelector('[data-user-status]')?.value;
    const role = row.querySelector('[data-user-role]')?.value;
    if (!userId || !status || !role) return;
    const button = row.querySelector('[data-user-save]');
    if (button) button.disabled = true;
    try {
      const { error } = await client.rpc('work_board_set_user_access', {
        target_user_id: userId,
        next_status: status,
        next_role: role
      });
      if (error) throw error;
      await loadUserAccessList();
      setState('사용자 권한 저장됨', 'online');
    } catch (error) {
      console.error(error);
      alert(error.message || '사용자 권한을 저장하지 못했습니다.');
      if (button) button.disabled = false;
    }
  }

  function bindUi() {
    const syncTools = $('syncTools');
    const syncMenu = $('syncMenu');
    const syncMenuBtn = $('syncMenuBtn');
    syncMenuBtn?.addEventListener('click', () => {
      if (!syncMenu) return;
      const willOpen = syncMenu.hidden;
      syncMenu.hidden = !willOpen;
      syncMenuBtn.setAttribute('aria-expanded', String(willOpen));
    });
    document.addEventListener('click', (event) => {
      if (!syncMenu || syncMenu.hidden || !syncTools || syncTools.contains(event.target)) return;
      syncMenu.hidden = true;
      syncMenuBtn?.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !syncMenu || syncMenu.hidden) return;
      syncMenu.hidden = true;
      syncMenuBtn?.setAttribute('aria-expanded', 'false');
    });
    $('exportBackupBtn')?.addEventListener('click', exportBackup);
    $('importBackupBtn')?.addEventListener('click', () => $('backupFileInput')?.click());
    $('restoreSafetyBackupBtn')?.addEventListener('click', restoreSafetyBackup);
    $('backupFileInput')?.addEventListener('change', (event) => {
      importBackup(event.target.files && event.target.files[0]);
      event.target.value = '';
    });
    $('googleLoginBtn')?.addEventListener('click', signInWithGoogle);
    $('logoutBtn')?.addEventListener('click', signOut);
    $('accessGateLogout')?.addEventListener('click', signOut);
    $('accessGateRefresh')?.addEventListener('click', () => {
      ensureAccessProfile()
        .then((profile) => {
          if (isApprovedProfile(profile)) syncWithCloud({ silent: true });
        })
        .catch((error) => {
          console.error(error);
          setState('승인 확인 실패', 'error');
        });
    });
    $('userManageBtn')?.addEventListener('click', openUserAccessModal);
    $('userAccessClose')?.addEventListener('click', closeUserAccessModal);
    $('userAccessDone')?.addEventListener('click', closeUserAccessModal);
    $('userAccessRefresh')?.addEventListener('click', loadUserAccessList);
    $('userAccessModal')?.addEventListener('click', (event) => {
      if (event.target.id === 'userAccessModal') closeUserAccessModal();
    });
    $('userAccessList')?.addEventListener('click', (event) => {
      const button = event.target?.closest?.('[data-user-save]');
      if (!button || button.disabled) return;
      saveUserAccess(button.closest('[data-user-id]'));
    });
    $('cloudPushBtn')?.addEventListener('click', () => {
      pushToCloud({ manual: true }).catch((error) => {
        console.error(error);
        setState('올리기 실패', 'error');
        alert(error.message || '클라우드 저장에 실패했습니다.');
      });
    });
    $('cloudPullBtn')?.addEventListener('click', () => pullFromCloud(false));
  }

  function initClient() {
    if (!isCloudConfigured()) {
      setCloudControls(false);
      setState('로컬 모드', 'warn');
      return;
    }
    if (!window.supabase || !window.supabase.createClient) {
      setCloudControls(false);
      setState('Supabase 로드 실패', 'error');
      return;
    }
    client = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
    client.auth.onAuthStateChange((_event, nextSession) => {
      session = nextSession;
      const user = getSignedInUser();
      setCloudControls(Boolean(user), accessProfile);
      if (user) {
        ensureAccessProfile()
          .then((profile) => {
            if (isApprovedProfile(profile)) syncWithCloud({ silent: true });
          })
          .catch((error) => {
            console.error(error);
            setState('승인 확인 실패', 'error');
            renderAccessGate({ email: user.email, status: 'checking' });
        });
        return;
      } else {
        accessProfile = null;
        renderAccessGate(null);
        setCloudControls(false);
        setState('로그인 필요', 'warn');
      }
    });
    refreshSession().then(() => {
      checkRemoteFreshness();
      window.clearInterval(syncTimer);
      syncTimer = window.setInterval(() => syncWithCloud({ silent: true }), AUTO_SYNC_INTERVAL_MS);
      window.addEventListener('focus', () => syncWithCloud({ silent: true }));
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) syncWithCloud({ silent: true });
      });
    }).catch((error) => {
      console.error(error);
      setState('로그인 확인 실패', 'error');
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    bindUi();
    patchLocalStorage();
    initClient();
  });
})();
