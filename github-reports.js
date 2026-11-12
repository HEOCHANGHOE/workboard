// Github 관리: shows the daily "algorithm update review" report routine's output —
// repo status, daily run log and report summaries — from a feed file built by
// tools/github-feed-export.py. The feed is stored per user in Supabase
// (work_board_github_feed, RLS) and cached on this device; it is never part of
// the public repository or the synced snapshot.
(function () {
  'use strict';

  const CACHE_KEY = 'work_github_feed_v1'; // local only, not in cloud-sync DATA_KEYS
  const TABLE = 'work_board_github_feed';
  const FEED_TYPE = 'workboard-github-feed';
  const MAX_FILE_BYTES = 4 * 1024 * 1024;
  const PAGE_SIZE = 40;
  const CLOUD_REFRESH_MS = 60 * 1000;

  let feed = null;
  let source = ''; // 'cloud' | 'local' | ''
  let view = 'runs';
  let repoFilter = '';
  let changedOnly = true;
  let kindFilter = '';
  let searchText = '';
  let shown = PAGE_SIZE;
  let expandedId = '';
  let lastCloudFetch = 0;
  let statusText = '';

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) =>
    String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  const str = (v, max = 4000) =>
    typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max);
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  // Escape first, then allow the run log's **bold** markers.
  const richText = (value) =>
    escapeHtml(value)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');

  // ---------------------------------------------------------------------------
  // Feed validation: the file comes from disk or the cloud, so every field is coerced.
  function cleanFeed(raw) {
    if (!raw || typeof raw !== 'object' || raw.type !== FEED_TYPE) return null;
    const repos = (Array.isArray(raw.repos) ? raw.repos : []).slice(0, 100).map((r) => ({
      name: str(r?.name, 200),
      short: str(r?.short, 120) || str(r?.name, 200).split('/').pop(),
      lastChecked: str(r?.lastChecked, 40),
      lastCommit: str(r?.lastCommit, 60),
      lastTag: str(r?.lastTag, 160),
      lastRelease: str(r?.lastRelease, 160),
      commitReports: num(r?.commitReports),
      releaseReports: num(r?.releaseReports)
    }));
    const runs = (Array.isArray(raw.runs) ? raw.runs : []).slice(0, 5000).map((r, i) => ({
      id: `run-${i}`,
      date: str(r?.date, 10),
      time: str(r?.time, 5),
      mode: str(r?.mode, 40),
      text: str(r?.text, 20000),
      headline: str(r?.headline, 400),
      checked: num(r?.checked),
      newReports: num(r?.newReports),
      changed: Boolean(r?.changed),
      totalAfter: num(r?.totalAfter)
    }));
    const reports = (Array.isArray(raw.reports) ? raw.reports : []).slice(0, 20000).map((r, i) => ({
      id: `rep-${i}`,
      repo: str(r?.repo, 120),
      kind: ['commit', 'release', 'quarterly'].includes(r?.kind) ? r.kind : 'commit',
      key: str(r?.key, 160),
      file: str(r?.file, 400),
      date: str(r?.date, 10),
      modified: str(r?.modified, 16),
      revised: Boolean(r?.revised),
      title: str(r?.title, 300),
      requested: str(r?.requested, 20),
      version: str(r?.version, 200),
      scale: str(r?.scale, 200),
      authors: str(r?.authors, 200),
      summary: (Array.isArray(r?.summary) ? r.summary : []).slice(0, 10).map((s) => str(s, 800))
    }));
    return {
      generatedAt: str(raw.generatedAt, 40),
      schedule: str(raw.schedule, 60),
      baseline: str(raw.baseline, 40),
      repos,
      runs,
      reports
    };
  }

  // ---------------------------------------------------------------------------
  // Storage
  function readCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      const cleaned = raw ? cleanFeed(raw.feed) : null;
      return cleaned ? { feed: cleaned, from: raw.from === 'cloud' ? 'cloud' : 'local' } : null;
    } catch {
      return null;
    }
  }

  function writeCache(raw, from) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ from, feed: raw }));
      return true;
    } catch (error) {
      console.warn('GitHub feed was not cached on this device:', error);
      return false;
    }
  }

  function cloud() {
    const handle = window.WorkBoardCloud;
    return handle?.isReady?.() ? { client: handle.getClient(), userId: handle.getUserId() } : null;
  }

  async function fetchCloud(force = false) {
    const c = cloud();
    if (!c) return;
    if (!force && Date.now() - lastCloudFetch < CLOUD_REFRESH_MS) return;
    lastCloudFetch = Date.now();
    const { data, error } = await c.client.from(TABLE).select('feed, updated_at').maybeSingle();
    if (error) {
      console.warn('GitHub feed could not be loaded:', error.message || error);
      return;
    }
    if (!data?.feed) return;
    const next = cleanFeed(data.feed);
    if (!next) return;
    // Keep whichever is newer, so a fresh local import is not replaced by an older cloud copy.
    if (feed && source === 'local' && feed.generatedAt > next.generatedAt) return;
    feed = next;
    source = 'cloud';
    writeCache(data.feed, 'cloud');
    render();
  }

  async function saveFeed(raw) {
    const cleaned = cleanFeed(raw);
    if (!cleaned) throw new Error('Work Board용 GitHub 피드 파일이 아닙니다.');
    feed = cleaned;
    source = 'local';
    let cached = writeCache(raw, 'local');
    const c = cloud();
    if (c) {
      const { error } = await c.client.from(TABLE).upsert(
        {
          user_id: c.userId,
          feed: raw,
          generated_at: cleaned.generatedAt || null,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'user_id' }
      );
      if (!error) {
        source = 'cloud';
        cached = writeCache(raw, 'cloud');
        lastCloudFetch = Date.now();
        return 'cloud';
      }
      console.warn('GitHub feed was not saved to the cloud:', error.message || error);
      return cached ? 'local-cloud-failed' : 'none';
    }
    return cached ? 'local' : 'none';
  }

  async function importFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setStatus('파일이 너무 큽니다 (4MB 이하).');
      return;
    }
    setStatus('가져오는 중…');
    try {
      const raw = JSON.parse(await file.text());
      const where = await saveFeed(raw);
      setStatus(
        {
          cloud: '가져왔습니다. 클라우드에 저장되어 다른 기기에서도 보입니다.',
          local: '가져왔습니다. 로그인하지 않아 이 기기에만 저장했습니다.',
          'local-cloud-failed':
            '가져왔지만 클라우드 저장에 실패해 이 기기에만 저장했습니다. (supabase-schema.sql 적용 여부 확인)',
          none: '가져왔지만 저장 공간이 부족해 새로고침하면 사라집니다.'
        }[where]
      );
      shown = PAGE_SIZE;
      expandedId = '';
      render();
    } catch (error) {
      setStatus(
        error instanceof SyntaxError ? 'JSON 파일을 읽지 못했습니다.' : error.message || String(error)
      );
    }
  }

  function setStatus(text) {
    statusText = text || '';
    const el = $('ghStatus');
    if (el) el.textContent = statusText;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  const fmtDateTime = (iso) => {
    if (!iso) return '-';
    const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
    return m ? `${m[1]} ${m[2]}` : String(iso);
  };
  const reportDate = (r) => r.date || r.modified.slice(0, 10);
  const kindLabel = { commit: '커밋', release: '릴리즈', quarterly: '분기 종합' };

  function renderSummary() {
    const meta = $('ghMeta');
    const body = $('ghRepoBody');
    if (!meta || !body) return;
    if (!feed) {
      meta.textContent = '';
      body.innerHTML = `<tr><td colspan="6" class="gh-empty">아직 가져온 데이터가 없습니다. <b>피드 가져오기</b>로 <code>workboard_feed.json</code>을 선택하세요.</td></tr>`;
      return;
    }
    const lastChecked = feed.repos
      .map((r) => r.lastChecked)
      .sort()
      .pop();
    const lastRun = feed.runs[0];
    meta.innerHTML = [
      `마지막 확인 <b>${escapeHtml(fmtDateTime(lastChecked))}</b>`,
      feed.schedule ? `예약 ${escapeHtml(feed.schedule)}` : '',
      lastRun ? `최근 실행 신규 보고서 ${lastRun.newReports}건` : '',
      `데이터 생성 ${escapeHtml(fmtDateTime(feed.generatedAt))}`,
      source === 'cloud' ? '클라우드 저장됨' : source === 'local' ? '이 기기에만 저장됨' : ''
    ]
      .filter(Boolean)
      .join(' · ');

    const latestByRepo = {};
    feed.reports.forEach((r) => {
      const d = reportDate(r);
      if (r.repo && (!latestByRepo[r.repo] || d > latestByRepo[r.repo])) latestByRepo[r.repo] = d;
    });
    body.innerHTML = feed.repos
      .map((r) => {
        const active = repoFilter === r.short ? ' active' : '';
        return `<tr class="gh-repo-row${active}" data-gh-repo="${escapeHtml(r.short)}" tabindex="0" title="이 저장소만 보기">
          <td class="gh-repo-name">${escapeHtml(r.short)}</td>
          <td><code>${escapeHtml(r.lastCommit || '-')}</code></td>
          <td class="gh-tag">${escapeHtml(r.lastTag || '-')}</td>
          <td class="gh-num">${r.commitReports}</td>
          <td class="gh-num">${r.releaseReports}</td>
          <td class="gh-date">${escapeHtml(latestByRepo[r.short] || '-')}</td>
        </tr>`;
      })
      .join('');
  }

  function matches(text) {
    if (!searchText) return true;
    return text.toLowerCase().includes(searchText.toLowerCase());
  }

  function filteredRuns() {
    return feed.runs.filter(
      (r) =>
        (!changedOnly || r.changed) &&
        (!repoFilter || r.text.includes(repoFilter)) &&
        matches(`${r.date} ${r.text}`)
    );
  }

  function filteredReports() {
    return feed.reports.filter(
      (r) =>
        (!kindFilter || r.kind === kindFilter) &&
        (!repoFilter || r.repo === repoFilter) &&
        matches(`${r.repo} ${r.key} ${r.title} ${r.authors} ${r.summary.join(' ')}`)
    );
  }

  function runItem(r) {
    const open = expandedId === r.id;
    const badge = r.changed
      ? `<span class="gh-badge gh-badge-new">신규 ${r.newReports}건</span>`
      : `<span class="gh-badge">변경 없음</span>`;
    let detail = '';
    if (open) {
      const sameDay = feed.reports.filter(
        (p) => p.modified.slice(0, 10) === r.date && p.kind !== 'quarterly'
      );
      detail = `<div class="gh-detail">
        <div class="gh-run-text">${r.text
          .split(' | ')
          .map((part) => `<p>${richText(part)}</p>`)
          .join('')}</div>
        ${
          sameDay.length
            ? `<div class="mt-block"><div class="mt-block-title">이날 생성된 보고서 ${sameDay.length}건</div>
               <ul class="gh-report-links">${sameDay
                 .map(
                   (p) =>
                     `<li><button type="button" class="text-link" data-gh-open-report="${p.id}">${escapeHtml(p.title || `${p.repo} ${p.key}`)}</button> <span class="gh-muted">${kindLabel[p.kind]}</span></li>`
                 )
                 .join('')}</ul></div>`
            : ''
        }
      </div>`;
    }
    return `<div class="mt-item${open ? ' open' : ''}">
      <button type="button" class="mt-item-head gh-item-head" data-gh-toggle="${r.id}" aria-expanded="${open}">
        <span class="mt-item-title">${escapeHtml(r.date)} ${escapeHtml(r.time)}</span>
        <span class="mt-item-lead">${escapeHtml(r.headline.replace(/\*\*/g, ''))}</span>
        ${badge}
      </button>${detail}</div>`;
  }

  function reportItem(r) {
    const open = expandedId === r.id;
    const lead = r.summary[0] || r.title || r.file.split('/').pop();
    let detail = '';
    if (open) {
      const facts = [
        ['버전', r.version],
        ['변경 규모', r.scale],
        ['코드 수정자', r.authors],
        ['검토 요청일', r.requested],
        ['파일', r.file]
      ].filter(([, v]) => v);
      detail = `<div class="gh-detail">
        ${r.title ? `<div class="gh-report-title">${escapeHtml(r.title)}</div>` : ''}
        ${
          r.summary.length
            ? `<div class="mt-block"><div class="mt-block-title">요약</div><ul class="mt-bullets">${r.summary.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul></div>`
            : `<p class="gh-muted">요약은 2026-06 이후 보고서에만 들어 있습니다. 원문은 보고서 파일에서 확인하세요.</p>`
        }
        <dl class="gh-facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>
      </div>`;
    }
    return `<div class="mt-item${open ? ' open' : ''}" id="gh-${r.id}">
      <button type="button" class="mt-item-head gh-item-head gh-report-head" data-gh-toggle="${r.id}" aria-expanded="${open}">
        <span class="mt-item-title">${escapeHtml(reportDate(r))}</span>
        <span class="mt-item-tag">${escapeHtml(r.repo || '전체')} · ${kindLabel[r.kind]}${r.kind === 'release' ? ` ${escapeHtml(r.key)}` : ''}${r.revised ? ' (개정)' : ''}</span>
        <span class="mt-item-lead">${escapeHtml(lead)}</span>
      </button>${detail}</div>`;
  }

  function renderList() {
    const list = $('ghList');
    const count = $('ghCount');
    if (!list) return;
    document.querySelectorAll('[data-gh-view]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.ghView === view);
    });
    if ($('ghChangedOnlyWrap')) $('ghChangedOnlyWrap').hidden = view !== 'runs';
    if ($('ghKindFilter')) $('ghKindFilter').hidden = view !== 'reports';
    if ($('ghRepoFilter')) {
      const sel = $('ghRepoFilter');
      const names = feed ? feed.repos.map((r) => r.short) : [];
      const want = `<option value="">전체 저장소</option>${names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')}`;
      if (sel.dataset.built !== want) {
        sel.innerHTML = want;
        sel.dataset.built = want;
      }
      sel.value = repoFilter;
    }
    if (!feed) {
      list.innerHTML = '';
      if (count) count.textContent = '';
      return;
    }
    const items = view === 'runs' ? filteredRuns() : filteredReports();
    if (count) count.textContent = `${items.length}건`;
    if (!items.length) {
      list.innerHTML = `<div class="gh-empty">조건에 맞는 항목이 없습니다.</div>`;
      return;
    }
    const html = items
      .slice(0, shown)
      .map(view === 'runs' ? runItem : reportItem)
      .join('');
    const more =
      items.length > shown
        ? `<div class="gh-more"><button type="button" class="btn btn-secondary" data-gh-more>더 보기 (${items.length - shown}건 남음)</button></div>`
        : '';
    list.innerHTML = html + more;
  }

  function render() {
    renderSummary();
    renderList();
    setStatus(statusText);
  }

  // ---------------------------------------------------------------------------
  function bind() {
    $('ghImportBtn')?.addEventListener('click', () => $('ghImportFile')?.click());
    $('ghImportFile')?.addEventListener('change', (e) => {
      importFile(e.target.files?.[0]);
      e.target.value = '';
    });
    document.querySelectorAll('[data-gh-view]').forEach((btn) =>
      btn.addEventListener('click', () => {
        view = btn.dataset.ghView;
        shown = PAGE_SIZE;
        expandedId = '';
        renderList();
      })
    );
    $('ghRepoFilter')?.addEventListener('change', (e) => {
      repoFilter = e.target.value;
      shown = PAGE_SIZE;
      render();
    });
    $('ghKindFilter')?.addEventListener('change', (e) => {
      kindFilter = e.target.value;
      shown = PAGE_SIZE;
      renderList();
    });
    $('ghChangedOnly')?.addEventListener('change', (e) => {
      changedOnly = e.target.checked;
      shown = PAGE_SIZE;
      renderList();
    });
    $('ghSearch')?.addEventListener('input', (e) => {
      searchText = e.target.value.trim();
      shown = PAGE_SIZE;
      renderList();
    });
    const pickRepo = (row) => {
      repoFilter = repoFilter === row.dataset.ghRepo ? '' : row.dataset.ghRepo;
      shown = PAGE_SIZE;
      render();
    };
    $('ghRepoBody')?.addEventListener('click', (e) => {
      const row = e.target.closest('[data-gh-repo]');
      if (row) pickRepo(row);
    });
    $('ghRepoBody')?.addEventListener('keydown', (e) => {
      const row = e.target.closest('[data-gh-repo]');
      if (row && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        pickRepo(row);
      }
    });
    $('ghList')?.addEventListener('click', (e) => {
      const openReport = e.target.closest('[data-gh-open-report]');
      if (openReport) {
        view = 'reports';
        kindFilter = '';
        searchText = '';
        if ($('ghSearch')) $('ghSearch').value = '';
        if ($('ghKindFilter')) $('ghKindFilter').value = '';
        const target = feed.reports.find((r) => r.id === openReport.dataset.ghOpenReport);
        repoFilter = target?.repo || '';
        expandedId = openReport.dataset.ghOpenReport;
        const index = filteredReports().findIndex((r) => r.id === expandedId);
        shown = Math.max(PAGE_SIZE, index + 1);
        render();
        $(`gh-${expandedId}`)?.scrollIntoView?.({ block: 'center' });
        return;
      }
      if (e.target.closest('[data-gh-more]')) {
        shown += PAGE_SIZE;
        renderList();
        return;
      }
      const toggle = e.target.closest('[data-gh-toggle]');
      if (toggle) {
        expandedId = expandedId === toggle.dataset.ghToggle ? '' : toggle.dataset.ghToggle;
        renderList();
      }
    });
  }

  // Sign-in finishes after page load, so retry briefly until the cloud handle is ready.
  function onShow(attempt = 0) {
    if (attempt === 0) render();
    if (!cloud()) {
      if (attempt < 10) setTimeout(() => onShow(attempt + 1), 1500);
      return;
    }
    fetchCloud().catch((error) => console.warn(error));
  }

  let initialized = false;
  function init() {
    if (initialized) return;
    initialized = true;
    const cached = readCache();
    feed = cached?.feed || null;
    source = cached?.from || '';
    bind();
    render();
  }

  window.WorkBoardGithub = { render: () => onShow(), cleanFeed, importFeed: saveFeed };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
