// Backup and Supabase cloud sync layer.
(function () {
  'use strict';

  const DATA_KEYS = [
    'work_dashboard_tasks_v1',
    'work_weekly_history_v1',
    'work_monthly_history_v1',
    'work_project_order_v1',
    'work_project_collapse_v1',
    'wt_rec',
    'wt_live',
    'wb_tweaks_v22'
  ];
  const SNAPSHOT_VERSION = 1;
  const LOCAL_UPDATED_KEY = 'work_board_local_updated_at';
  const APPLIED_HASH_KEY = 'work_board_applied_snapshot_hash';
  const ACTIVE_TAB_KEY = 'work_board_active_tab';
  const CONFIG = window.WORK_BOARD_CONFIG || {};
  const PLACEHOLDER_URL = 'https://YOUR-PROJECT-REF.supabase.co';
  const AUTO_SYNC_INTERVAL_MS = 8000;
  let client = null;
  let session = null;
  let uploadTimer = null;
  let syncTimer = null;
  let isSyncing = false;
  let suppressUpload = false;

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

  function setState(text, mode) {
    const el = $('syncState');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('online', 'warn', 'error');
    if (mode) el.classList.add(mode);
  }

  function setCloudControls(isSignedIn) {
    const login = $('googleLoginBtn');
    const logout = $('logoutBtn');
    const pull = $('cloudPullBtn');
    const push = $('cloudPushBtn');
    if (login) login.hidden = isSignedIn || !isCloudConfigured();
    if (logout) logout.hidden = !isSignedIn;
    if (pull) pull.hidden = !isSignedIn;
    if (push) push.hidden = !isSignedIn;
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
      !isEmptyObjectValue(snapshot.data.wt_rec);
  }

  function localHasMeaningfulData() {
    return !isEmptyArrayValue(readJsonKey('work_dashboard_tasks_v1')) ||
      !isEmptyArrayValue(readJsonKey('work_weekly_history_v1')) ||
      !isEmptyArrayValue(readJsonKey('work_monthly_history_v1')) ||
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

  function mergeObjects(remoteValue, localValue) {
    const remoteObject = remoteValue && typeof remoteValue === 'object' && !Array.isArray(remoteValue) ? remoteValue : {};
    const localObject = localValue && typeof localValue === 'object' && !Array.isArray(localValue) ? localValue : {};
    return Object.assign({}, remoteObject, localObject);
  }

  function mergeSnapshots(localSnapshot, remoteSnapshot) {
    const localData = (localSnapshot && localSnapshot.data) || {};
    const remoteData = (remoteSnapshot && remoteSnapshot.data) || {};
    const data = Object.assign({}, remoteData, localData);
    data.work_dashboard_tasks_v1 = mergeArrayById(remoteData.work_dashboard_tasks_v1, localData.work_dashboard_tasks_v1);
    data.work_weekly_history_v1 = mergeArrayById(remoteData.work_weekly_history_v1, localData.work_weekly_history_v1);
    data.work_monthly_history_v1 = mergeArrayById(remoteData.work_monthly_history_v1, localData.work_monthly_history_v1);
    data.work_project_order_v1 = mergeUniqueArray(remoteData.work_project_order_v1, localData.work_project_order_v1);
    data.work_project_collapse_v1 = mergeUniqueArray(remoteData.work_project_collapse_v1, localData.work_project_collapse_v1);
    data.wt_rec = mergeObjects(remoteData.wt_rec, localData.wt_rec);
    data.wb_tweaks_v22 = mergeObjects(remoteData.wb_tweaks_v22, localData.wb_tweaks_v22);
    return {
      app: 'work-board',
      version: SNAPSHOT_VERSION,
      exportedAt: new Date().toISOString(),
      localUpdatedAt: new Date().toISOString(),
      data
    };
  }

  function sameSnapshotData(a, b) {
    return JSON.stringify((a && a.data) || {}) === JSON.stringify((b && b.data) || {});
  }

  function snapshotDataHash(snapshot) {
    return JSON.stringify((snapshot && snapshot.data) || {});
  }

  function rememberActiveTab() {
    const activeTab = document.querySelector('.tab.active')?.dataset?.tab;
    if (activeTab) sessionStorage.setItem(ACTIVE_TAB_KEY, activeTab);
  }

  function reloadOnceForSnapshot(snapshot) {
    const hash = snapshotDataHash(snapshot);
    if (!hash || sessionStorage.getItem(APPLIED_HASH_KEY) === hash) return false;
    sessionStorage.setItem(APPLIED_HASH_KEY, hash);
    rememberActiveTab();
    window.setTimeout(() => window.location.reload(), 250);
    return true;
  }

  function applySnapshot(snapshot) {
    if (!snapshot || !snapshot.data || typeof snapshot.data !== 'object') {
      throw new Error('올바른 Work Board 백업 파일이 아닙니다.');
    }
    suppressUpload = true;
    DATA_KEYS.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(snapshot.data, key)) {
        const value = snapshot.data[key];
        if (value == null) originalRemoveItem.call(localStorage, key);
        else originalSetItem.call(localStorage, key, typeof value === 'string' ? value : JSON.stringify(value));
      }
    });
    originalSetItem.call(localStorage, LOCAL_UPDATED_KEY, snapshot.localUpdatedAt || snapshot.exportedAt || new Date().toISOString());
    suppressUpload = false;
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
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const snapshot = JSON.parse(String(reader.result || '{}'));
        applySnapshot(snapshot);
        setState('복원됨', 'online');
        rememberActiveTab();
        window.setTimeout(() => window.location.reload(), 250);
      } catch (error) {
        alert(error.message || '백업 파일을 읽을 수 없습니다.');
        setState('복원 실패', 'error');
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  function getUser() {
    return session && session.user ? session.user : null;
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

  async function pushToCloud() {
    const user = getUser();
    if (!client || !user) return;
    const localSnapshot = buildSnapshot();
    const remote = await fetchRemoteSnapshot();
    const snapshot = remote && remote.payload
      ? mergeSnapshots(localSnapshot, remote.payload)
      : localSnapshot;
    const now = new Date().toISOString();
    const { error } = await client
      .from('work_board_snapshots')
      .upsert({
        user_id: user.id,
        payload: snapshot,
        updated_at: now
      }, { onConflict: 'user_id' });
    if (error) throw error;
    if (!sameSnapshotData(localSnapshot, snapshot)) {
      applySnapshot(snapshot);
    }
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
        if (snapshotHasMeaningfulData(localSnapshot)) await pushToCloud();
        return;
      }
      const merged = mergeSnapshots(localSnapshot, remote.payload);
      const localChanged = !sameSnapshotData(localSnapshot, merged);
      const remoteChanged = !sameSnapshotData(remote.payload, merged);
      if (localChanged) {
        applySnapshot(merged);
      }
      if (remoteChanged) {
        const now = new Date().toISOString();
        const { error } = await client
          .from('work_board_snapshots')
          .upsert({
            user_id: user.id,
            payload: merged,
            updated_at: now
          }, { onConflict: 'user_id' });
        if (error) throw error;
        originalSetItem.call(localStorage, LOCAL_UPDATED_KEY, now);
      }
      if (localChanged) {
        setState('최신 상태', 'online');
        if (!reloadOnceForSnapshot(merged)) {
          setState('최신 상태', 'online');
        }
      } else if (!options.silent) {
        setState('최신 상태', 'online');
      }
    } catch (error) {
      console.error(error);
      setState('동기화 실패', 'error');
    } finally {
      isSyncing = false;
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
      const merged = mergeSnapshots(buildSnapshot(), remote.payload);
      applySnapshot(merged);
      originalSetItem.call(localStorage, LOCAL_UPDATED_KEY, remote.updated_at || remote.payload.exportedAt || new Date().toISOString());
      setState('불러옴', 'online');
      rememberActiveTab();
      window.setTimeout(() => window.location.reload(), 250);
    } catch (error) {
      console.error(error);
      setState('불러오기 실패', 'error');
      alert(error.message || '클라우드 데이터를 불러오지 못했습니다.');
    }
  }

  function scheduleCloudUpload() {
    if (suppressUpload || !client || !getUser()) return;
    window.clearTimeout(uploadTimer);
    uploadTimer = window.setTimeout(() => {
      pushToCloud().catch((error) => {
        console.error(error);
        setState('동기화 실패', 'error');
      });
    }, 900);
  }

  function patchLocalStorage() {
    Storage.prototype.setItem = function patchedSetItem(key, value) {
      originalSetItem.call(this, key, value);
      if (DATA_KEYS.includes(key)) {
        markLocalUpdated();
        scheduleCloudUpload();
      }
    };
    Storage.prototype.removeItem = function patchedRemoveItem(key) {
      originalRemoveItem.call(this, key);
      if (DATA_KEYS.includes(key)) {
        markLocalUpdated();
        scheduleCloudUpload();
      }
    };
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
    setCloudControls(false);
    setState('로컬 모드', 'warn');
  }

  async function refreshSession() {
    if (!client) return;
    const result = await client.auth.getSession();
    session = result.data.session;
    const user = getUser();
    setCloudControls(Boolean(user));
    if (user) {
      setState('동기화 켜짐', 'online');
    } else {
      setState('로그인 필요', 'warn');
    }
  }

  async function checkRemoteFreshness() {
    if (!client || !getUser()) return;
    try {
      const remote = await fetchRemoteSnapshot();
      if (!remote || !remote.payload) return;
      const localUpdated = Date.parse(getLocalUpdatedAt() || '1970-01-01T00:00:00.000Z');
      const remoteUpdated = Date.parse(remote.updated_at || remote.payload.exportedAt || '1970-01-01T00:00:00.000Z');
      const localEmpty = !localHasMeaningfulData();
      const remoteHasData = snapshotHasMeaningfulData(remote.payload);
      if (localEmpty && remoteHasData) {
        suppressUpload = true;
        applySnapshot(remote.payload);
        suppressUpload = false;
        reloadOnceForSnapshot(remote.payload);
        return;
      }
      if (remoteUpdated > localUpdated + 1000) {
        syncWithCloud({ silent: true });
      }
    } catch (error) {
      console.error(error);
      setState('동기화 확인 실패', 'error');
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
    $('backupFileInput')?.addEventListener('change', (event) => {
      importBackup(event.target.files && event.target.files[0]);
      event.target.value = '';
    });
    $('googleLoginBtn')?.addEventListener('click', signInWithGoogle);
    $('logoutBtn')?.addEventListener('click', signOut);
    $('cloudPushBtn')?.addEventListener('click', () => {
      pushToCloud().catch((error) => {
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
      const user = getUser();
      setCloudControls(Boolean(user));
      if (user) {
        setState('동기화 켜짐', 'online');
        syncWithCloud({ silent: true });
      } else {
        setState('로그인 필요', 'warn');
      }
    });
    refreshSession().then(() => {
      checkRemoteFreshness();
      window.clearInterval(syncTimer);
      syncTimer = window.setInterval(() => syncWithCloud({ silent: true }), AUTO_SYNC_INTERVAL_MS);
    }).catch((error) => {
      console.error(error);
      setState('로그인 확인 실패', 'error');
    });
  }

  patchLocalStorage();
  window.addEventListener('DOMContentLoaded', () => {
    bindUi();
    initClient();
  });
})();
