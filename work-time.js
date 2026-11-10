/* ============================================================
   Work Time Manager v18
   소정근무 08:30~17:30 (8h 근무 + 1h 휴게)
   ▶ 초과근무: 08:30 이전 + 17:30 이후
   ▶ 연차/반차/반반차는 근무시간에서 제외
   ============================================================ */
(function () {
  const KEY_REC = 'wt_rec';
  const KEY_LIVE = 'wt_live';
  const STD_START = '08:30';
  const STD_END = '17:30';
  const STD_WORK = 480; // 8h in mins
  const BREAK_UNIT_MINS = 30; // 4시간당 30분
  const BREAK_EVERY_MINS = 240;
  const MAX_STD_BREAK_MINS = 60;
  const TOTAL_LV = 16;

  function getRec() {
    try {
      return JSON.parse(localStorage.getItem(KEY_REC) || '{}');
    } catch {
      return {};
    }
  }
  function saveRec(r) {
    localStorage.setItem(KEY_REC, JSON.stringify(r));
  }
  function getLive() {
    try {
      return JSON.parse(localStorage.getItem(KEY_LIVE) || 'null');
    } catch {
      return null;
    }
  }
  function hm(str) {
    if (!str) return 0;
    const [h, m] = str.split(':').map(Number);
    return h * 60 + (m || 0);
  }
  function fmtH(mins) {
    if (mins <= 0) return '0h';
    const h = Math.floor(mins / 60),
      m = mins % 60;
    return m ? h + 'h ' + m + 'm' : h + 'h';
  }
  function fmtLv(days) {
    const n = Math.round(days * 100) / 100;
    return Number.isInteger(n)
      ? String(n)
      : String(n)
          .replace(/\.0+$/, '')
          .replace(/(\.\d*[1-9])0+$/, '$1');
  }
  function pad2(n) {
    return String(n).padStart(2, '0');
  }
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function nowHHMM() {
    const d = new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function clampOverlap(startA, endA, startB, endB) {
    return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
  }
  function stdOverlapMins(r) {
    if (!r || !r.in || !r.out) return 0;
    return clampOverlap(hm(r.in), hm(r.out), hm(STD_START), hm(STD_END));
  }
  function stdBreakMins(r) {
    const overlap = stdOverlapMins(r);
    if (overlap <= 0) return 0;
    const units = Math.floor(overlap / BREAK_EVERY_MINS);
    return Math.min(MAX_STD_BREAK_MINS, units * BREAK_UNIT_MINS);
  }
  function regularWorkMins(r) {
    if (!r || !r.in || !r.out) return 0;
    const net = stdOverlapMins(r) - stdBreakMins(r);
    return Math.max(0, Math.min(STD_WORK, net));
  }
  function overtimeRawMins(r) {
    if (!r || !r.in || !r.out) return 0;
    const inM = hm(r.in),
      outM = hm(r.out);
    const pre = Math.max(0, Math.min(outM, hm(STD_START)) - inM);
    const post = Math.max(0, outM - Math.max(inM, hm(STD_END)));
    return pre + post;
  }
  function actualWorkMins(r) {
    if (!r || !r.in || !r.out) return 0;
    return regularWorkMins(r) + overtimeRawMins(r);
  }
  function workMins(r) {
    if (!r || !r.in || !r.out) return 0;
    if (['leave', 'half', 'half2', 'holiday'].includes(r.type)) return 0;
    return regularWorkMins(r);
  }
  function otMins(r) {
    if (!r || !r.in || !r.out) return 0;
    if (['leave', 'half', 'half2', 'holiday'].includes(r.type)) return 0;
    return overtimeRawMins(r);
  }
  function leaveDays(type) {
    if (type === 'leave') return 1;
    if (type === 'half') return 0.5;
    if (type === 'half2') return 0.25;
    return 0;
  }

  /* ── 출근 ── */
  window.wtCheckin = function () {
    localStorage.setItem(KEY_LIVE, JSON.stringify({ date: todayStr(), start: nowHHMM() }));
    wtUpdateBar();
  };

  /* ── 퇴근 ── */
  window.wtCheckout = function () {
    const live = getLive();
    if (!live) return;
    const rec = getRec();
    if (!rec[live.date]) rec[live.date] = {};
    rec[live.date].in = live.start;
    rec[live.date].out = nowHHMM();
    rec[live.date].type = rec[live.date].type || 'work';
    rec[live.date].memo = rec[live.date].memo || '';
    saveRec(rec);
    localStorage.removeItem(KEY_LIVE);
    wtUpdateBar();
    if (typeof wmRenderAll === 'function') wmRenderAll();
  };

  /* ── 버튼 활성화 상태 ── */
  window.wtUpdateBar = function () {
    const ci = document.getElementById('btnCI');
    const co = document.getElementById('btnCO');
    if (!ci || !co) return;
    const live = getLive();
    ci.disabled = !!live;
    co.disabled = !live;
  };

  /* ── 실시간 wt-bar 업데이트 (tickClock 후킹) ── */
  window.wtTickUpdate = function (now) {
    const el = {
      liveTime: document.getElementById('wtLiveTime'),
      liveDate: document.getElementById('wtLiveDate'),
      inTime: document.getElementById('wtInTime'),
      outTime: document.getElementById('wtOutTime'),
      remain: document.getElementById('wtRemain'),
      liveWorkedLabel: document.getElementById('wtLiveWorkedLabel'),
      liveWorked: document.getElementById('wtLiveWorked'),
      liveOtLabel: document.getElementById('wtLiveOtLabel'),
      liveOt: document.getElementById('wtLiveOt'),
      regular: document.getElementById('wtRegular'),
      overtime: document.getElementById('wtOvertime'),
      total: document.getElementById('wtTotal'),
      fill: document.getElementById('wtProgressFill')
    };
    if (!el.liveTime) return;
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    el.liveTime.textContent =
      pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds());
    el.liveDate.textContent = now.getMonth() + 1 + '/' + now.getDate() + ' (' + days[now.getDay()] + ')';

    const live = getLive();
    const rec = getRec()[todayStr()];
    const inStr = live ? live.start : rec ? rec.in : null;
    const outStr = live ? null : rec ? rec.out : null;

    el.inTime.textContent = inStr || '-';
    el.outTime.textContent = outStr || (live ? '근무중' : '-');

    const liveNowStr = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    if (inStr) {
      const calcOutStr = outStr || liveNowStr;
      const calcRegular = workMins({ in: inStr, out: calcOutStr, type: 'work' });
      const calcOt = otMins({ in: inStr, out: calcOutStr, type: 'work' });
      const calcTotal = calcRegular + calcOt;
      if (el.liveWorked) el.liveWorked.textContent = fmtH(calcTotal);
      if (el.liveOt) el.liveOt.textContent = fmtH(calcOt);
      if (outStr) {
        const wm = workMins({ in: inStr, out: outStr, type: 'work' });
        const ot = otMins({ in: inStr, out: outStr, type: 'work' });
        if (el.regular) el.regular.textContent = fmtH(wm);
        if (el.overtime) el.overtime.textContent = fmtH(ot);
        if (el.total) el.total.textContent = fmtH(wm + ot);
        el.remain.textContent = ot > 0 ? '+' + fmtH(ot) + ' 초과근무' : '퇴근완료';
        el.remain.className = 'wt-remain ' + (ot > 0 ? 'overtime' : 'done');
        el.fill.style.width = Math.min(100, (wm / STD_WORK) * 100) + '%';
        el.fill.className = 'wt-progress-fill' + (ot > 0 ? ' ot' : '');
      } else if (live) {
        const liveRegular = workMins({ in: inStr, out: liveNowStr, type: 'work' });
        const liveOt = otMins({ in: inStr, out: liveNowStr, type: 'work' });
        const remainM = Math.max(0, STD_WORK - liveRegular);
        const liveTotal = liveRegular + liveOt;
        if (el.regular) el.regular.textContent = fmtH(liveRegular);
        if (el.overtime) el.overtime.textContent = fmtH(liveOt);
        if (el.total) el.total.textContent = fmtH(liveTotal);
        if (liveOt > 0) {
          el.remain.textContent = '+' + fmtH(liveOt) + ' 초과근무중';
          el.remain.className = 'wt-remain overtime';
        } else {
          el.remain.textContent = '잔여 ' + fmtH(remainM);
          el.remain.className = 'wt-remain on-time';
        }
        el.fill.style.width = Math.min(100, Math.max(0, (liveRegular / STD_WORK) * 100)) + '%';
        el.fill.className = 'wt-progress-fill' + (liveOt > 0 ? ' ot' : '');
      }
    } else {
      if (el.regular) el.regular.textContent = '-';
      if (el.overtime) el.overtime.textContent = '-';
      if (el.total) el.total.textContent = '-';
      if (el.liveWorked) el.liveWorked.textContent = '-';
      if (el.liveOt) el.liveOt.textContent = '-';
      el.remain.textContent = '';
      el.fill.style.width = '0%';
      el.fill.className = 'wt-progress-fill';
    }
  };

  /* ── 출/퇴근 시간 인라인 수정 팝오버 ── */
  let _editMode = null; // 'in' | 'out'

  window.wtOpenEditPop = function (mode, triggerEl) {
    const live = getLive();
    const rec = getRec()[todayStr()];
    // 수정 가능 조건: 출근=live 또는 오늘 기록 있을 때 / 퇴근=오늘 기록 있을 때
    const inStr = live ? live.start : rec ? rec.in : null;
    const outStr = rec ? rec.out : null;
    if (mode === 'in' && !inStr) return;
    if (mode === 'out' && !outStr) return;

    _editMode = mode;
    const pop = document.getElementById('wtEditPop');
    const label = document.getElementById('wtEditPopLabel');
    const inp = document.getElementById('wtEditPopTime');
    label.textContent = mode === 'in' ? '출근 시간 수정' : '퇴근 시간 수정';
    inp.value = mode === 'in' ? inStr || '08:30' : outStr || '17:30';

    // 팝오버 위치: triggerEl 아래
    const rect = triggerEl.getBoundingClientRect();
    pop.style.top = rect.bottom + window.scrollY + 6 + 'px';
    pop.style.left = rect.left + window.scrollX + 'px';
    pop.style.position = 'absolute';
    pop.classList.add('show');
    setTimeout(() => document.addEventListener('click', wtClickOutside, { once: true }), 10);
  };

  function wtClickOutside(e) {
    const pop = document.getElementById('wtEditPop');
    if (pop && !pop.contains(e.target)) wtCloseEditPop();
  }

  window.wtCloseEditPop = function () {
    document.getElementById('wtEditPop').classList.remove('show');
    _editMode = null;
  };

  window.wtSaveEditPop = function () {
    const val = document.getElementById('wtEditPopTime').value;
    if (!val) return wtCloseEditPop();
    const live = getLive();
    const rec = getRec();
    const today = todayStr();

    if (_editMode === 'in') {
      if (live) {
        // 근무 중 → live 업데이트
        live.start = val;
        localStorage.setItem(KEY_LIVE, JSON.stringify(live));
      } else if (rec[today]) {
        // 이미 퇴근 → 기록 업데이트
        rec[today].in = val;
        saveRec(rec);
      }
    } else if (_editMode === 'out') {
      if (rec[today]) {
        rec[today].out = val;
        saveRec(rec);
      }
    }
    wtCloseEditPop();
    if (typeof wmRenderAll === 'function') wmRenderAll();
  };

  /* ── 근무관리 패널 ── */
  let _wmTab = 'dash',
    _wmCalY = new Date().getFullYear(),
    _wmCalM = new Date().getMonth();

  window.wmRenderAll = function () {
    switch (_wmTab) {
      case 'dash':
        wmRenderDash();
        break;
      case 'cal':
        wmRenderCal();
        break;
      case 'year':
        wmRenderYear();
        break;
    }
  };

  function wmRenderDash() {
    const y = new Date().getFullYear(),
      m = new Date().getMonth();
    const rec = getRec();
    let days = 0,
      wm = 0,
      ot = 0,
      lv = 0,
      ylv = 0;
    Object.keys(rec).forEach((ds) => {
      const [ry, rm] = ds.split('-').map(Number);
      const r = rec[ds];
      if (ry === y) {
        ylv += leaveDays(r.type);
      }
      if (ry !== y || rm !== m + 1) return;
      if (['leave', 'half', 'half2', 'holiday'].includes(r.type)) {
        lv += leaveDays(r.type);
        return;
      }
      if (r.in && r.out) {
        days++;
        wm += workMins(r);
        ot += otMins(r);
      }
    });
    const set = (id, v) => {
      const e = document.getElementById(id);
      if (e) e.textContent = v;
    };
    set('wm-mdays', days);
    set('wm-mhours', fmtH(wm));
    set('wm-mot', fmtH(ot));
    set('wm-mtotal', fmtH(wm + ot));
    set('wm-leave', fmtLv(ylv) + '/' + TOTAL_LV);
    const lastD = new Date(y, m + 1, 0).getDate();
    const container = document.getElementById('wmMonthChart');
    if (!container) return;
    const maxMins = Math.max(
      STD_WORK + 120,
      ...Object.keys(rec)
        .filter((ds) => ds.startsWith(y + '-' + pad2(m + 1)))
        .map((ds) => workMins(rec[ds]) + otMins(rec[ds]))
    );
    let html = '';
    for (let d = 1; d <= lastD; d++) {
      const ds = y + '-' + pad2(m + 1) + '-' + pad2(d);
      const r = rec[ds];
      const wM = r && r.in && r.out ? workMins(r) : 0,
        oM = r && r.in && r.out ? otMins(r) : 0;
      const pct = maxMins > 0 ? ((wM + oM) / maxMins) * 100 : 0;
      const isOT = oM > 0;
      html += `<div class="wm-bar-wrap" data-wm-open="${ds}">
        ${isOT ? '<div class="wm-bar-ot-tag">+' + fmtH(oM) + '</div>' : ''}
        <div class="wm-bar-bg" style="height:${Math.max(pct, 2)}px">
          <div class="wm-bar-fill ${isOT ? 'ot-bar hl' : 'normal'}" style="height:100%"></div>
        </div>
        <div class="wm-bar-label">${d}</div>
      </div>`;
    }
    container.innerHTML = html;
  }

  function wmRenderCal() {
    const y = _wmCalY,
      m = _wmCalM;
    const lbl = document.getElementById('wmMonthLabel');
    if (lbl) lbl.textContent = y + '년 ' + (m + 1) + '월';
    const grid = document.getElementById('wmCalGrid');
    if (!grid) return;
    const rec = getRec(),
      today = todayStr();
    const firstDay = new Date(y, m, 1).getDay(),
      lastDate = new Date(y, m + 1, 0).getDate(),
      prevLast = new Date(y, m, 0).getDate();
    let cells = '';
    for (let i = 0; i < firstDay; i++)
      cells += `<div class="wm-cal-cell other"><div class="wm-cal-day">${prevLast - firstDay + 1 + i}</div></div>`;
    for (let d = 1; d <= lastDate; d++) {
      const ds = y + '-' + pad2(m + 1) + '-' + pad2(d);
      const r = rec[ds] || {};
      let cls = 'wm-cal-cell',
        badge = '',
        hrs = '';
      if (ds === today) cls += ' today';
      if (r.type === 'leave' || r.type === 'half' || r.type === 'half2' || r.type === 'holiday') {
        cls += ' leave-day';
        badge = `<div class="wm-leave-badge">${r.type === 'leave' ? '연차' : r.type === 'half' ? '반차' : r.type === 'half2' ? '반반차' : '공휴'}</div>`;
      } else if (r.in && r.out) {
        const w = workMins(r),
          ot = otMins(r),
          total = w + ot;
        cls += ot > 0 ? ' ot-day' : ' has-work';
        hrs = ot > 0 ? `${fmtH(w)} + ${fmtH(ot)}` : fmtH(total);
        if (ot > 0) badge = `<div class="wm-ot-badge">총 ${fmtH(total)}</div>`;
      }
      cells += `<div class="${cls}" data-wm-open="${ds}"><div class="wm-cal-day">${d}</div><div class="wm-cal-hrs">${hrs}</div>${badge}</div>`;
    }
    const rem = (firstDay + lastDate) % 7 === 0 ? 0 : 7 - ((firstDay + lastDate) % 7);
    for (let i = 1; i <= rem; i++)
      cells += `<div class="wm-cal-cell other"><div class="wm-cal-day">${i}</div></div>`;
    grid.innerHTML = cells;
  }

  function wmRenderYear() {
    const y = new Date().getFullYear();
    const rec = getRec();
    let ydays = 0,
      ywm = 0,
      yot = 0,
      ylv = 0;
    const monthly = Array(12)
      .fill(null)
      .map(() => ({ wm: 0, ot: 0 }));
    Object.keys(rec).forEach((ds) => {
      const [ry, rm] = ds.split('-').map(Number);
      if (ry !== y) return;
      const r = rec[ds];
      if (['leave', 'half', 'half2', 'holiday'].includes(r.type)) {
        ylv += leaveDays(r.type);
        return;
      }
      if (r.in && r.out) {
        const w = workMins(r),
          o = otMins(r);
        ydays++;
        ywm += w;
        yot += o;
        monthly[rm - 1].wm += w;
        monthly[rm - 1].ot += o;
      }
    });
    const set = (id, v) => {
      const e = document.getElementById(id);
      if (e) e.textContent = v;
    };
    set('wm-ydays', ydays);
    set('wm-yhours', fmtH(ywm));
    set('wm-yot', fmtH(yot));
    set('wm-ytotal', fmtH(ywm + yot));
    set('wm-yleave', fmtLv(ylv) + '/' + TOTAL_LV);
    const container = document.getElementById('wmYearChart');
    if (!container) return;
    const maxMins = Math.max(STD_WORK * 22, ...monthly.map((mo) => mo.wm + mo.ot));
    const mn = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    let html = '';
    monthly.forEach((mo, i) => {
      const total = mo.wm + mo.ot,
        pct = maxMins > 0 ? (total / maxMins) * 100 : 0,
        isOT = mo.ot > 0;
      html += `<div class="wm-bar-wrap" data-wm-toggle-ot="true">
        ${isOT ? '<div class="wm-bar-ot-tag">+' + fmtH(mo.ot) + '</div>' : ''}
        <div class="wm-bar-bg" style="height:${Math.max(pct, 2)}px">
          <div class="wm-bar-fill ${isOT ? 'ot-bar' : 'normal'}" style="height:100%"></div>
        </div>
        <div class="wm-bar-label">${mn[i]}월</div>
      </div>`;
    });
    container.innerHTML = html;
  }

  window.wmToggleHL = function (wrap) {
    const f = wrap.querySelector('.wm-bar-fill.ot-bar');
    if (f) f.classList.toggle('hl');
  };

  function bindCalNav() {
    const prev = document.getElementById('wmPrev'),
      next = document.getElementById('wmNext');
    if (prev)
      prev.onclick = () => {
        _wmCalM--;
        if (_wmCalM < 0) {
          _wmCalM = 11;
          _wmCalY--;
        }
        wmRenderCal();
      };
    if (next)
      next.onclick = () => {
        _wmCalM++;
        if (_wmCalM > 11) {
          _wmCalM = 0;
          _wmCalY++;
        }
        wmRenderCal();
      };
  }

  function bindWmTabs() {
    document.querySelectorAll('.wm-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        _wmTab = btn.dataset.wm;
        document.querySelectorAll('.wm-tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
        document
          .querySelectorAll('.wm-panel')
          .forEach((p) => p.classList.toggle('active', p.id === 'wm-' + _wmTab));
        wmRenderAll();
      });
    });
  }

  window.wmOpenModal = function (ds) {
    const rec = getRec()[ds] || {};
    document.getElementById('wmModalTitle').textContent = ds + ' 근무';
    document.getElementById('wmModalDate').value = ds;
    document.getElementById('wmInDate').value = ds;
    document.getElementById('wmInStart').value = rec.in || '08:30';
    document.getElementById('wmInEnd').value = rec.out || '17:30';
    document.getElementById('wmInType').value = rec.type || 'work';
    document.getElementById('wmInMemo').value = rec.memo || '';
    const del = document.getElementById('wmBtnDel');
    if (del)
      del.style.display = rec.in || ['leave', 'half', 'half2', 'holiday'].includes(rec.type) ? '' : 'none';
    document.getElementById('wmModalBg').classList.add('show');
  };
  window.wmCloseModal = function () {
    document.getElementById('wmModalBg').classList.remove('show');
  };
  window.wmSaveRecord = function () {
    const ds = document.getElementById('wmInDate').value,
      rec = getRec();
    const type = document.getElementById('wmInType').value;
    rec[ds] = {
      in: document.getElementById('wmInStart').value,
      out: document.getElementById('wmInEnd').value,
      type,
      memo: document.getElementById('wmInMemo').value
    };
    if (['leave', 'half', 'half2', 'holiday'].includes(type)) {
      rec[ds].in = '';
      rec[ds].out = '';
    }
    saveRec(rec);
    wmCloseModal();
    wmRenderAll();
  };
  window.wmDeleteRecord = function () {
    const ds = document.getElementById('wmModalDate').value,
      rec = getRec();
    delete rec[ds];
    saveRec(rec);
    wmCloseModal();
    wmRenderAll();
  };

  window.initMarquee = function () {
    document.querySelectorAll('.name-ellipsis').forEach((el) => {
      if (el.scrollWidth > el.clientWidth) {
        el.style.setProperty('--mq-d', -(el.scrollWidth - el.clientWidth + 20) + 'px');
        el.classList.add('mq');
      } else el.classList.remove('mq');
    });
  };

  document.addEventListener('DOMContentLoaded', () => {
    wtUpdateBar();
    bindCalNav();
    bindWmTabs();
    document
      .querySelectorAll('[data-wt-edit]')
      .forEach((el) => el.addEventListener('click', () => wtOpenEditPop(el.dataset.wtEdit, el)));
    document.querySelectorAll('[data-wt-action]').forEach((el) =>
      el.addEventListener('click', () => {
        const action = el.dataset.wtAction;
        if (action === 'checkin') wtCheckin();
        if (action === 'checkout') wtCheckout();
        if (action === 'close-edit') wtCloseEditPop();
        if (action === 'save-edit') wtSaveEditPop();
      })
    );
    document.querySelectorAll('[data-wm-action]').forEach((el) =>
      el.addEventListener('click', () => {
        const action = el.dataset.wmAction;
        if (action === 'close') wmCloseModal();
        if (action === 'delete') wmDeleteRecord();
        if (action === 'save') wmSaveRecord();
      })
    );
    document.body.addEventListener('click', (event) => {
      const openEl = event.target.closest('[data-wm-open]');
      if (openEl) {
        wmOpenModal(openEl.dataset.wmOpen);
        return;
      }
      const toggleEl = event.target.closest('[data-wm-toggle-ot]');
      if (toggleEl) wmToggleHL(toggleEl);
    });
    document.getElementById('wmModalBg').addEventListener('click', function (e) {
      if (e.target === this) wmCloseModal();
    });
    document.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => setTimeout(initMarquee, 120));
    });
  });
})();
