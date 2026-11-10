// ============================================================
// Edit-mode visual tweak logic
// ============================================================
// Edit-mode script: stores and applies visual tweak options.
(function () {
  const TWEAKS = /*EDITMODE-BEGIN*/ {
    'dark': false,
    'compact': false,
    'bgTone': 'warm',
    'accent': 'blue'
  }; /*EDITMODE-END*/
  const state = Object.assign({}, TWEAKS);
  const panel = document.getElementById('tweaksPanel');
  const body = document.body;

  function applyBgTone(t) {
    body.classList.remove('tone-warm', 'tone-cool', 'tone-neutral');
    body.classList.add('tone-' + t);
    const styles =
      {
        warm: { bg: '#f2efe9', card: '#ffffff', cardAlt: '#faf8f3', glass: 'rgba(252,250,245,0.74)' },
        cool: { bg: '#eff1f4', card: '#ffffff', cardAlt: '#f7f8fa', glass: 'rgba(248,250,253,0.74)' },
        neutral: { bg: '#f0f0ef', card: '#ffffff', cardAlt: '#f9f9f8', glass: 'rgba(251,251,250,0.74)' }
      }[t] || {};
    if (!body.classList.contains('dark-mode')) {
      document.documentElement.style.setProperty('--bg', styles.bg);
      document.documentElement.style.setProperty('--card', styles.card);
      document.documentElement.style.setProperty('--card-alt', styles.cardAlt);
      document.documentElement.style.setProperty('--glass', styles.glass);
    }
  }

  function applyAccent(a) {
    const map = {
      blue: { c: '#1f63e8', bg: 'rgba(31,99,232,0.08)', bd: 'rgba(31,99,232,0.2)' },
      green: { c: '#1f8a48', bg: 'rgba(31,138,72,0.09)', bd: 'rgba(31,138,72,0.2)' },
      purple: { c: '#7a4bc1', bg: 'rgba(122,75,193,0.09)', bd: 'rgba(122,75,193,0.2)' },
      orange: { c: '#c8700a', bg: 'rgba(200,112,10,0.1)', bd: 'rgba(200,112,10,0.22)' },
      graphite: { c: '#2a2a30', bg: 'rgba(42,42,48,0.07)', bd: 'rgba(42,42,48,0.2)' }
    };
    const v = map[a] || map.blue;
    document.documentElement.style.setProperty('--blue', v.c);
    document.documentElement.style.setProperty('--blue-bg', v.bg);
    document.documentElement.style.setProperty('--blue-border', v.bd);
  }

  function apply() {
    body.classList.toggle('dark-mode', !!state.dark);
    body.classList.toggle('density-compact', !!state.compact);
    applyBgTone(state.bgTone);
    applyAccent(state.accent);
    document.getElementById('twDark').classList.toggle('on', !!state.dark);
    document.getElementById('twCompact').classList.toggle('on', !!state.compact);
    document.getElementById('twBgTone').value = state.bgTone;
    document.getElementById('twAccent').value = state.accent;
  }

  const editModeTargetOrigin = window.location.origin;
  function postEditModeMessage(message) {
    if (window.parent === window) return;
    try {
      window.parent.postMessage(message, editModeTargetOrigin);
    } catch (e) {}
  }

  function persist(keys) {
    try {
      postEditModeMessage({ type: '__edit_mode_set_keys', edits: keys });
    } catch (e) {}
    try {
      const saved = JSON.parse(localStorage.getItem('wb_tweaks_v22') || '{}');
      Object.assign(saved, keys);
      localStorage.setItem('wb_tweaks_v22', JSON.stringify(saved));
    } catch (e) {}
  }

  // Load local persistence
  try {
    const saved = JSON.parse(localStorage.getItem('wb_tweaks_v22') || '{}');
    Object.assign(state, saved);
  } catch (e) {}

  document.getElementById('twDark').addEventListener('click', () => {
    state.dark = !state.dark;
    apply();
    persist({ dark: state.dark });
  });
  document.getElementById('twCompact').addEventListener('click', () => {
    state.compact = !state.compact;
    apply();
    persist({ compact: state.compact });
  });
  document.getElementById('twBgTone').addEventListener('change', (e) => {
    state.bgTone = e.target.value;
    apply();
    persist({ bgTone: state.bgTone });
  });
  document.getElementById('twAccent').addEventListener('change', (e) => {
    state.accent = e.target.value;
    apply();
    persist({ accent: state.accent });
  });

  // Edit mode protocol
  window.addEventListener('message', (e) => {
    if (e.origin !== editModeTargetOrigin) return;
    const d = e.data || {};
    if (d.type === '__activate_edit_mode') panel.classList.add('show');
    if (d.type === '__deactivate_edit_mode') panel.classList.remove('show');
  });
  postEditModeMessage({ type: '__edit_mode_available' });

  apply();
})();
