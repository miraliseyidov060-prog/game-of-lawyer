(() => {
  'use strict';

  const cfg = window.GFL_CONFIG;
  // E-poçt/Google linkindən qayıdış: supabase-js URL-i oxuyub təmizləməmişdən əvvəl götürürük
  const AUTH_RETURN = (() => {
    const hp = new URLSearchParams(location.hash.replace(/^#/, ''));
    const qp = new URLSearchParams(location.search);
    return { type: hp.get('type'), error: hp.get('error_description') || qp.get('error_description') || null };
  })();
  const REDIRECT = location.origin + location.pathname.replace(/index\.html$/, '');
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
  });

  const LETTERS = ['A', 'B', 'C', 'D'];
  const TOTAL = 12;
  const TIME_LIMIT_MS = 30000;
  const SHIELDS = [4, 8]; // "Qalxan": bu suallardan sonra xal qorunur
  const MSG = {
    bad_username: 'Ad 3–20 simvol olmalıdır: latın kiçik hərfləri, rəqəmlər və _.',
    bad_password: 'Parol çox zəifdir. Ən azı 8 simvol istifadə edin.',
    username_taken: 'Bu ad artıq götürülüb.',
    bad_login: 'Ad və ya parol səhvdir.',
    create_failed: 'Hesab yaradıla bilmədi. Bir az sonra yenidən cəhd edin.',
    network: 'Şəbəkə xətası. İnternet bağlantısını yoxlayın.',
    not_enough: 'Bu bölmədə hələ kifayət qədər sual yoxdur.',
    bad_email: 'E-poçt ünvanı düzgün deyil.',
    pw_short: 'Parol ən azı 8 simvol olmalıdır.',
    pw_mismatch: 'Parollar eyni deyil.',
    rate_limit: 'Çox cəhd edildi. Bir az gözləyib yenidən cəhd edin.',
    same_password: 'Yeni parol köhnədən fərqli olmalıdır.',
    bad_current: 'Cari parol səhvdir.',
    name_mismatch: 'Yazdığınız ad hesabınızla uyğun gəlmir.',
    staff_cannot_self_delete: 'Redaktor və admin hesabı özü silinə bilməz. Əvvəlcə administratordan rolunuzu dəyişməsini istəyin.',
    no_feature: 'Bu funksiya hələ aktiv deyil.',
    generic: 'Xəta baş verdi. Yenidən cəhd edin.',
  };
  const RESERVED = ['admin', 'root', 'system', 'system_seed', 'support', 'moderator', 'editor', 'kalkhan'];
  const nameOk = (n) => /^[a-z0-9_]{3,20}$/.test(n) && !n.startsWith('oyuncu_') && !RESERVED.includes(n);

  const store = {
    get(k, d = null) { try { const v = localStorage.getItem(`kalkhan.${k}`); return v == null ? d : v; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(`kalkhan.${k}`, v); } catch (_) { /* məxfi rejim */ } },
  };
  const S = {
    screen: 'boot', authMode: 'login', user: null, profile: null, result: null, animate: false,
    board: { period: 'weekly', rows: [], loading: false },
    practice: { rows: [], loading: false, error: '' },
    set: { open: null },
    providers: { google: false, autoconfirm: false },
    theme: store.get('theme', 'system'),
    motion: store.get('motion', 'system'),
    sound: store.get('sound') !== 'off',
    haptics: store.get('haptics') !== 'off',
    installEvt: null,
  };
  let G = null; // cari oyun
  let timerHandle = null;

  const mqDark = window.matchMedia('(prefers-color-scheme: dark)');
  const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => S.motion === 'reduce' || (S.motion !== 'full' && mqReduce.matches);
  function applyTheme() {
    const root = document.documentElement;
    if (S.theme === 'light' || S.theme === 'dark') root.setAttribute('data-theme', S.theme); else root.removeAttribute('data-theme');
    const dark = S.theme === 'dark' || (S.theme !== 'light' && mqDark.matches);
    const tc = document.getElementById('tc'); if (tc) tc.setAttribute('content', dark ? '#0E0E0E' : '#F6F1E8');
  }
  function applyMotion() {
    const root = document.documentElement;
    root.classList.toggle('reduce-motion', S.motion === 'reduce');
    root.classList.toggle('full-motion', S.motion === 'full');
  }
  try { mqDark.addEventListener('change', () => { if (S.theme === 'system') applyTheme(); }); } catch (_) { /* köhnə brauzer */ }

  const $app = document.getElementById('app');
  const $toast = document.getElementById('toast');
  const fmt = (n) => new Intl.NumberFormat('az').format(n || 0);
  const cap = (str) => (str ? str.charAt(0).toLocaleUpperCase('az') + str.slice(1) : '');
  const sleep = (ms) => new Promise((r) => setTimeout(r, reduced() ? 0 : ms));

  class AppError extends Error { constructor(code) { super(code); this.code = code; } }

  /* ---------- Köməkçilər ---------- */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  function icon(markup) { const t = document.createElement('template'); t.innerHTML = markup.trim(); return t.content.firstChild; }

  const I = {
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg>',
    soundOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="M3 9.5v5h4l5 4.5V5L7 9.5H3z" fill="currentColor"/><path d="M15.5 9a4 4 0 010 6M18.5 6a8 8 0 010 12"/></svg>',
    soundOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="M3 9.5v5h4l5 4.5V5L7 9.5H3z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="square" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>',
    sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square" aria-hidden="true"><path d="M3 7h10M19 7h2M3 12h3M12 12h9M3 17h11M20 17h1"/><circle cx="16" cy="7" r="2.3"/><circle cx="9" cy="12" r="2.3"/><circle cx="17" cy="17" r="2.3"/></svg>',
    shield: '<svg viewBox="0 0 16 19" fill="currentColor" aria-hidden="true"><path d="M8 0l7 2.4v6.1c0 4.3-2.9 7.7-7 10.5C3.9 16.200 1 12.800 1 8.500V2.400z"/></svg>',
  };

  // İki şəkil də DOM-dadır, CSS mövzuya görə birini göstərir (əl ilə seçilmiş mövzu da işləsin deyə)
  function themed(light, dark, alt) {
    return h('span', { class: 'themed' },
      h('img', { src: light, alt, class: 'lt', decoding: 'async' }),
      h('img', { src: dark, alt: '', 'aria-hidden': 'true', class: 'dk', decoding: 'async' }));
  }
  const wordmark = () => themed('brand/wordmark.png', 'brand/wordmark-dark.png', 'KALKHAN');
  const fullLogo = () => themed('brand/logo-full.png', 'brand/logo-full-dark.png', 'KALKHAN');

  function toast(msg, ms = 3400) {
    $toast.textContent = msg; $toast.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => $toast.classList.remove('show'), ms);
  }
  function errMsg(e) {
    if (e instanceof AppError) return MSG[e.code] || MSG.generic;
    const m = String((e && e.message) || e || '');
    if (MSG[m]) return MSG[m];
    if (/not enough published/i.test(m)) return MSG.not_enough;
    if (/could not find the function|does not exist|PGRST202/i.test(m)) return MSG.no_feature;
    if (/fetch|network|load failed/i.test(m)) return MSG.network;
    return MSG.generic;
  }

  function countUp(el, from, to, ms, prefix = '') {
    if (!el) return;
    if (reduced() || from === to) { el.textContent = prefix + fmt(to); return; }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      el.textContent = prefix + fmt(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ---------- Səs və titrəyiş (öz sintezimiz) ---------- */
  let actx = null;
  function tone(freq, dur, type = 'sine', delay = 0, gain = 0.08) {
    if (!S.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const t0 = actx.currentTime + delay;
      const osc = actx.createOscillator(); const g = actx.createGain();
      osc.type = type; osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(actx.destination); osc.start(t0); osc.stop(t0 + dur + 0.05);
    } catch (_) { /* səs işləməsə oyun davam edir */ }
  }
  const sfx = {
    tap() { tone(520, 0.05, 'square', 0, 0.03); },
    tick() { tone(1040, 0.04, 'square', 0, 0.02); },
    pick() { tone(330, 0.07, 'triangle', 0, 0.06); },
    correct() { tone(392, 0.1, 'triangle'); tone(587, 0.1, 'triangle', 0.09); tone(784, 0.24, 'triangle', 0.18); },
    wrong() { tone(150, 0.3, 'sawtooth', 0, 0.05); tone(110, 0.4, 'sawtooth', 0.14, 0.05); },
    shield() { tone(660, 0.08, 'square', 0, 0.035); tone(990, 0.2, 'triangle', 0.08, 0.06); },
    slam() { tone(90, 0.28, 'triangle', 0, 0.16); tone(55, 0.35, 'sine', 0.02, 0.18); },
    win() { [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', i * 0.11)); },
  };
  function buzz(pattern) { if (S.haptics && navigator.vibrate) navigator.vibrate(pattern); }

  /* ---------- Server ---------- */
  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args);
    if (error) throw error;
    return data;
  }
  const isLegacyEmail = (e) => !!e && e.endsWith(`@${cfg.EMAIL_DOMAIN}`);

  // Supabase Auth xətasını bizim kodlara çevirir
  function authCode(error) {
    const m = String((error && error.message) || ''); const c = (error && error.code) || '';
    if (/fetch|network|load failed/i.test(m)) return 'network';
    if (c === 'weak_password' || /password.*(short|weak|least)/i.test(m)) return 'bad_password';
    if (c === 'over_email_send_rate_limit' || c === 'over_request_rate_limit' || /rate limit|too many/i.test(m)) return 'rate_limit';
    if (c === 'same_password' || /different from the old/i.test(m)) return 'same_password';
    return 'generic';
  }
  // Qeydiyyat: e-poçtsuz, istifadəçi adı + parol (Edge Function hesabı yaradır)
  async function signup(username, password) {
    let res;
    try {
      res = await fetch(`${cfg.SUPABASE_URL}/functions/v1/signup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: cfg.SUPABASE_KEY }, body: JSON.stringify({ username, password }),
      });
    } catch (_) { throw new AppError('network'); }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new AppError(body.error || 'create_failed');
  }
  async function login(username, password) {
    const { error } = await sb.auth.signInWithPassword({ email: `${username.trim().toLowerCase()}@${cfg.EMAIL_DOMAIN}`, password });
    if (error) throw new AppError(/fetch|network/i.test(error.message) ? 'network' : 'bad_login');
  }
  async function googleSignIn() {
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: REDIRECT, queryParams: { prompt: 'select_account' } } });
    if (error) throw new AppError(authCode(error));
  }
  async function usernameAvailable(name) {
    try { const { data, error } = await sb.rpc('username_available', { p_name: name }); return error ? null : !!data; } catch (_) { return null; }
  }
  // Hansı giriş üsulları açıqdır (Google düyməsi yalnız Supabase-də aktiv olanda görünür)
  async function loadProviders() {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 2500);
    try {
      const r = await fetch(`${cfg.SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: cfg.SUPABASE_KEY }, signal: ctl.signal });
      const j = await r.json();
      S.providers = { google: !!(j.external && j.external.google), autoconfirm: !!j.mailer_autoconfirm };
    } catch (_) { /* naməlum: Google düyməsi göstərilmir */ } finally { clearTimeout(to); }
  }
  async function loadProfile() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { S.user = null; S.profile = null; return false; }
    S.user = session.user;
    const { data, error } = await sb.from('profiles').select('username,best_score,games_played').eq('id', session.user.id).single();
    if (error) {
      if (error.code === 'PGRST116') { await sb.auth.signOut({ scope: 'local' }); S.user = null; S.profile = null; return false; } // hesab silinib
      throw error;
    }
    S.profile = data;
    return true;
  }
  const needsUsername = () => !!S.profile && S.profile.username.startsWith('oyuncu_');
  async function afterLogin() {
    try { await loadProfile(); } catch (e) { toast(errMsg(e)); go('auth'); return; }
    go(!S.user ? 'auth' : needsUsername() ? 'username' : 'home');
  }

  /* ---------- Naviqasiya ---------- */
  function go(screen) {
    stopTimer();
    S.screen = screen; S.animate = true;
    render();
    window.scrollTo(0, 0);
  }
  function render() {
    const views = { boot: viewBoot, auth: viewAuth, username: viewUsername,
      home: viewHome, practice: viewPractice, settings: viewSettings, game: viewGame, result: viewResult, board: viewBoard };
    const node = views[S.screen]();
    if (S.animate) { node.classList.add('enter'); S.animate = false; }
    $app.replaceChildren(node);
    if (S.screen === 'game') afterGameRender();
  }

  function soundButton() {
    return h('button', {
      class: 'icon-btn', type: 'button', 'aria-label': S.sound ? 'Səsi söndür' : 'Səsi aç',
      onclick: () => {
        S.sound = !S.sound;
        store.set('sound', S.sound ? 'on' : 'off');
        sfx.tap(); render();
      },
    }, icon(S.sound ? I.soundOn : I.soundOff));
  }
  // Loqo bloku: nişan + KALKHAN sözü yanaşı, bir xətt üzərində
  const topBar = (right) => h('header', { class: 'bar' }, h('div', { class: 'logo' }, h('img', { class: 'emb', src: 'brand/emblem.png', alt: '' }), wordmark()), right || null);

  /* ---------- Ekranlar ---------- */
  function viewBoot() {
    return h('div', { class: 'screen boot' }, h('img', { src: 'brand/emblem.png', alt: 'KALKHAN' }));
  }

  /* ---------- Giriş ekranları ---------- */
  function field(id, label, attrs, extra) {
    const input = h('input', Object.assign({ id, name: id }, attrs));
    return { input, node: h('div', { class: 'field' }, h('label', { for: id, class: 'label' }, label), input, extra || null) };
  }
  function pwField(id, label, auto, attrs, extra) {
    const input = h('input', Object.assign({ id, name: id, type: 'password', autocomplete: auto, maxlength: '72', required: true }, attrs));
    const peek = h('button', { class: 'peek', type: 'button', 'aria-label': 'Parolu göstər və ya gizlət', onclick: () => {
      const show = input.type === 'password'; input.type = show ? 'text' : 'password'; peek.textContent = show ? 'Gizlət' : 'Göstər';
    } }, 'Göstər');
    return { input, node: h('div', { class: 'field' }, h('label', { for: id, class: 'label' }, label), h('div', { class: 'pw' }, input, peek), extra || null) };
  }
  const setBusy = (btn, on, label) => { btn.disabled = on; btn.replaceChildren(...(on ? ['Gözləyin…'] : [label, icon(I.arrow)])); };
  const setHint = (el, text, kind) => { el.textContent = text || ''; el.className = `hint${kind ? ` ${kind}` : ''}`; };
  const errBoxEl = () => h('div', { class: 'error', role: 'alert' });
  function bindMatch(a, b, hint) {
    const check = () => { if (!b.value) setHint(hint, ''); else if (a.value === b.value) setHint(hint, 'Parollar eyni ✓', 'ok'); else setHint(hint, 'Parollar eyni deyil', 'no'); };
    a.addEventListener('input', check); b.addEventListener('input', check);
  }
  function bindUsername(input, hint) {
    let t = null; let seq = 0;
    input.addEventListener('input', () => {
      clearTimeout(t); const v = input.value.trim().toLowerCase(); seq += 1; const mine = seq;
      if (!v) { setHint(hint, ''); return; }
      if (!nameOk(v)) { setHint(hint, '3–20 simvol: a–z, 0–9, _', 'no'); return; }
      setHint(hint, 'Yoxlanılır…');
      t = setTimeout(async () => {
        const ok = await usernameAvailable(v); if (mine !== seq) return;
        if (ok === null) setHint(hint, ''); else setHint(hint, ok ? 'Bu ad boşdur ✓' : 'Bu ad götürülüb', ok ? 'ok' : 'no');
      }, 350);
    });
  }
  const googleBlock = () => (!S.providers.google ? [] : [
    h('div', { class: 'divider' }, 'və ya'),
    h('button', { class: 'btn btn-g', type: 'button', onclick: async () => { try { toast('Google-a yönləndirilir…'); await googleSignIn(); } catch (e) { toast(errMsg(e)); } } },
      h('span', { class: 'g', 'aria-hidden': 'true' }, 'G'), 'Google ilə davam et')]);
  const privacyLink = () => h('a', { href: 'privacy.html', target: '_blank', rel: 'noopener' }, 'Məxfilik siyasəti');

  function viewAuth() {
    const isSignup = S.authMode === 'signup';
    const errBox = errBoxEl();
    const label = isSignup ? 'Qeydiyyatdan keç' : 'Daxil ol';
    const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, label, icon(I.arrow));
    const nameHint = h('div', { class: 'hint', 'aria-live': 'polite' });
    const user = field('u', 'İstifadəçi adı', { type: 'text', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', maxlength: '20', required: true }, isSignup ? nameHint : null);
    let form;
    if (isSignup) {
      bindUsername(user.input, nameHint);
      const matchHint = h('div', { class: 'hint', 'aria-live': 'polite' });
      const p1 = pwField('p', 'Parol', 'new-password', { minlength: '8' });
      const p2 = pwField('p2', 'Parolu təkrar yazın', 'new-password', { minlength: '8' }, matchHint);
      bindMatch(p1.input, p2.input, matchHint);
      form = h('form', {
        class: 'form', novalidate: true,
        onsubmit: async (ev) => {
          ev.preventDefault(); errBox.textContent = '';
          const u = user.input.value.trim().toLowerCase(); const a = p1.input.value; const b = p2.input.value;
          const bad = !nameOk(u) ? 'bad_username' : a.length < 8 ? 'pw_short' : a !== b ? 'pw_mismatch' : null;
          if (bad) { errBox.textContent = MSG[bad]; return; }
          setBusy(submit, true);
          try {
            if ((await usernameAvailable(u)) === false) throw new AppError('username_taken');
            await signup(u, a); await login(u, a); sfx.tap(); await afterLogin();
          } catch (e) { errBox.textContent = errMsg(e); setBusy(submit, false, label); }
        },
      }, user.node, p1.node, p2.node,
      h('p', { class: 'fineprint' }, 'E-poçt lazım deyil, amma parolu bərpa etmək mümkün olmayacaq: onu yadda saxlayın. Davam etməklə ', privacyLink(), ' ilə razılaşırsınız.'),
      errBox, submit, ...googleBlock());
    } else {
      const pass = pwField('p', 'Parol', 'current-password');
      form = h('form', {
        class: 'form',
        onsubmit: async (ev) => {
          ev.preventDefault(); errBox.textContent = '';
          setBusy(submit, true);
          try { await login(user.input.value, pass.input.value); sfx.tap(); await afterLogin(); } catch (e) { errBox.textContent = errMsg(e); setBusy(submit, false, label); }
        },
      }, user.node, pass.node, errBox, submit, ...googleBlock());
    }
    const tab = (mode, text) => h('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': S.authMode === mode ? 'true' : 'false', onclick: () => { S.authMode = mode; render(); } }, text);

    return h('div', { class: 'screen' },
      h('div', { class: 'hero' }, fullLogo(), h('p', { class: 'muted' }, 'Hüquq biliyi sınağı. 12 sual, 30 saniyə, bir qalxan.')),
      h('div', { class: 'panel screen' },
        h('div', { class: 'tabs', role: 'tablist' }, tab('login', 'Daxil ol'), tab('signup', 'Qeydiyyat')),
        form));
  }

  // Google ilə ilk giriş və ya avtomatik ad: reytinqdə görünəcək adı seçmək
  function viewUsername() {
    const errBox = errBoxEl(); const hint = h('div', { class: 'hint', 'aria-live': 'polite' });
    const f = field('u', 'İstifadəçi adı', { type: 'text', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', maxlength: '20', required: true }, hint);
    bindUsername(f.input, hint);
    const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Davam et', icon(I.arrow));
    return h('div', { class: 'screen' },
      h('div', { class: 'hero' }, fullLogo()),
      h('div', { class: 'panel screen' },
        h('h2', { class: 'disp', style: 'font-size:32px' }, 'Adınızı seçin'),
        h('p', { class: 'muted' }, 'Reytinqdə bu ad görünəcək. 3–20 simvol: kiçik latın hərfləri, rəqəmlər və _.'),
        h('form', {
          class: 'form', novalidate: true,
          onsubmit: async (ev) => {
            ev.preventDefault(); errBox.textContent = '';
            const v = f.input.value.trim().toLowerCase();
            if (!nameOk(v)) { errBox.textContent = MSG.bad_username; return; }
            setBusy(submit, true);
            try { await rpc('set_username', { p_name: v }); await loadProfile(); sfx.tap(); go('home'); } catch (e) { errBox.textContent = errMsg(e); setBusy(submit, false, 'Davam et'); }
          },
        }, f.node, errBox, submit)),
      h('button', { class: 'btn btn-text', type: 'button', onclick: async () => { await sb.auth.signOut(); } }, 'Çıxış'));
  }

  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

  function installCard() {
    if (isStandalone()) return null;
    if (S.installEvt) {
      return h('div', { class: 'panel install' },
        h('div', {}, h('b', { class: 'disp', style: 'font-size:22px' }, 'Tətbiq kimi quraşdır'), h('p', { class: 'muted small' }, 'Ana ekranda ikon kimi açılır.')),
        h('button', { class: 'btn', type: 'button', onclick: async () => {
          const evt = S.installEvt; S.installEvt = null; evt.prompt(); await evt.userChoice.catch(() => {}); render();
        } }, 'Quraşdır'));
    }
    const hint = isIOS() ? 'Safari-də "Paylaş" düyməsini basın, sonra "Ana ekrana əlavə et" seçin.' : 'Brauzer menyusundan "Tətbiqi quraşdır" və ya "Ana ekrana əlavə et" seçin.';
    return h('div', { class: 'panel' }, h('b', { class: 'disp', style: 'font-size:22px' }, 'Tətbiq kimi quraşdır'), h('p', { class: 'muted small' }, hint));
  }

  async function signOut() { await sb.auth.signOut(); S.user = null; S.profile = null; S.authMode = 'login'; go('auth'); }

  function viewHome() {
    const p = S.profile || { username: '', best_score: 0, games_played: 0 };
    const rule = (n, title, text) => h('li', {}, h('span', { class: 'n' }, n), h('div', {}, h('b', {}, title), h('span', { class: 'muted' }, text)));
    return h('div', { class: 'screen' },
      topBar(h('div', { class: 'right' }, soundButton(),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Ayarlar', onclick: () => openSettings() }, icon(I.sliders)))),
      h('h2', { class: 'hello' }, 'Salam, ', h('span', { class: 'nm' }, cap(p.username))),
      h('div', { class: 'tiles' },
        h('div', { class: 'tile black' }, h('span', { class: 'label' }, 'Ən yaxşı xal'), h('b', {}, fmt(p.best_score))),
        h('div', { class: 'tile orange' }, h('span', { class: 'label' }, 'Oyun sayı'), h('b', {}, fmt(p.games_played)))),
      h('button', { class: 'btn btn-primary', type: 'button', id: 'start', onclick: () => startGame() }, 'Oyuna başla', icon(I.arrow)),
      h('button', { class: 'btn', type: 'button', onclick: openPractice }, 'Məşq: bir sahə üzrə'),
      h('button', { class: 'btn', type: 'button', onclick: openBoard }, 'Reytinq'),
      h('div', { class: 'panel' },
        h('p', { class: 'label' }, 'Qaydalar'),
        h('ol', { class: 'rules' },
          rule('01', '12 sual', 'Çətinlik hər sualda artır.'),
          rule('02', '30 saniyə', 'Tez cavab əlavə xal gətirir.'),
          rule('03', 'Qalxan', '4-cü və 8-ci sualdan sonra xalınız qorunur: sonrakı səhv onu silmir.'),
          rule('04', 'Məcəllə', 'Oyunda bir dəfə iki səhv variantı silir.'))),
      installCard(),
      h('button', { class: 'btn btn-text', type: 'button', onclick: signOut }, 'Çıxış'));
  }

  /* ---------- Ayarlar ---------- */
  async function openSettings() {
    S.set = { open: null, note: '' }; go('settings');
    try { const { data } = await sb.auth.getUser(); if (data && data.user) { S.user = data.user; if (S.screen === 'settings') render(); } } catch (_) { /* oflayn */ }
  }

  function viewSettings() {
    const u = S.user || {}; const email = u.email || '';
    const providers = (u.app_metadata && u.app_metadata.providers) || [];
    const hasPassword = providers.includes('email');
    const toggle = (k) => { S.set.open = S.set.open === k ? null : k; S.set.note = ''; render(); };
    const seg = (cur, items, on) => h('div', { class: 'seg-tabs three', role: 'radiogroup' }, items.map(([v, t]) =>
      h('button', { type: 'button', role: 'radio', 'aria-checked': cur === v ? 'true' : 'false', onclick: () => on(v) }, t)));
    const sw = (label, desc, on, change) => h('div', { class: 'srow' },
      h('div', { class: 't' }, h('b', {}, label), desc ? h('span', {}, desc) : null),
      h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': label, onclick: () => change(!on) }));
    const kv = (label, value, extra) => h('div', { class: 'kv' }, h('span', { class: 'label' }, label), h('span', { class: 'v' }, value), extra || null);

    const nameForm = () => {
      const err = errBoxEl(); const hint = h('div', { class: 'hint', 'aria-live': 'polite' });
      const f = field('nn', 'Yeni ad', { type: 'text', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', maxlength: '20', required: true }, hint);
      bindUsername(f.input, hint);
      const btn = h('button', { class: 'btn btn-sm btn-primary', type: 'submit' }, 'Yadda saxla');
      return h('form', { class: 'inline-form', novalidate: true, onsubmit: async (ev) => {
        ev.preventDefault(); err.textContent = '';
        const v = f.input.value.trim().toLowerCase();
        if (!nameOk(v)) { err.textContent = MSG.bad_username; return; }
        btn.disabled = true;
        try { await rpc('set_username', { p_name: v }); await loadProfile(); S.set.open = null; S.set.note = 'Ad dəyişdirildi.'; render(); } catch (e) { err.textContent = errMsg(e); btn.disabled = false; }
      } }, f.node, err, btn);
    };
    const passForm = () => {
      const err = errBoxEl(); const mh = h('div', { class: 'hint' });
      const cur = pwField('cp', 'Cari parol', 'current-password');
      const p1 = pwField('np', 'Yeni parol', 'new-password', { minlength: '8' });
      const p2 = pwField('np2', 'Yeni parolu təkrar yazın', 'new-password', { minlength: '8' }, mh);
      bindMatch(p1.input, p2.input, mh);
      const btn = h('button', { class: 'btn btn-sm btn-primary', type: 'submit' }, 'Parolu dəyiş');
      return h('form', { class: 'inline-form', novalidate: true, onsubmit: async (ev) => {
        ev.preventDefault(); err.textContent = '';
        const a = p1.input.value;
        if (a.length < 8) { err.textContent = MSG.pw_short; return; }
        if (a !== p2.input.value) { err.textContent = MSG.pw_mismatch; return; }
        btn.disabled = true;
        try {
          const re = await sb.auth.signInWithPassword({ email, password: cur.input.value });
          if (re.error) throw new AppError('bad_current');
          const { error } = await sb.auth.updateUser({ password: a });
          if (error) throw new AppError(authCode(error));
          S.set.open = null; S.set.note = 'Parol dəyişdirildi.'; render();
        } catch (e) { err.textContent = errMsg(e); btn.disabled = false; }
      } }, cur.node, p1.node, p2.node, err, btn);
    };
    const deleteForm = () => {
      const err = errBoxEl();
      const f = field('dn', 'Təsdiq üçün istifadəçi adınızı yazın', { type: 'text', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', required: true });
      const btn = h('button', { class: 'btn btn-danger btn-sm', type: 'submit' }, 'Hesabı həmişəlik sil');
      return h('form', { class: 'inline-form', novalidate: true, onsubmit: async (ev) => {
        ev.preventDefault(); err.textContent = '';
        if (f.input.value.trim().toLowerCase() !== (S.profile && S.profile.username)) { err.textContent = MSG.name_mismatch; return; }
        btn.disabled = true;
        try {
          await rpc('delete_my_account');
          await sb.auth.signOut({ scope: 'local' }).catch(() => {});
          S.user = null; S.profile = null; S.authMode = 'login'; go('auth'); toast('Hesabınız silindi.', 5000);
        } catch (e) { err.textContent = errMsg(e); btn.disabled = false; }
      } }, h('p', { class: 'muted small' }, 'Hesabınız, oyun tarixçəniz və reytinq nəticələriniz həmişəlik silinəcək. Bu geri qaytarılmır.'), f.node, err, btn);
    };

    const look = h('section', { class: 'panel sec' }, h('h3', {}, 'Görünüş'),
      h('div', { class: 'srow stack' }, h('div', { class: 't' }, h('b', {}, 'Mövzu'), h('span', {}, 'Gecə rejimi gözlərinizi qaranlıqda yormur.')),
        seg(S.theme, [['system', 'Sistem'], ['light', 'İşıqlı'], ['dark', 'Gecə']], (v) => { S.theme = v; store.set('theme', v); applyTheme(); render(); })));

    const game = h('section', { class: 'panel sec' }, h('h3', {}, 'Oyun'),
      sw('Səs', 'Düymə, düzgün/səhv və nəticə səsləri', S.sound, (v) => { S.sound = v; store.set('sound', v ? 'on' : 'off'); sfx.tap(); render(); }),
      navigator.vibrate ? sw('Titrəyiş', 'Cavab verəndə yüngül titrəyiş', S.haptics, (v) => { S.haptics = v; store.set('haptics', v ? 'on' : 'off'); if (v) navigator.vibrate(20); render(); }) : null,
      sw('Animasiyaları azalt', 'Hərəkətli effektləri sadələşdirir', reduced(), (v) => { S.motion = v ? 'reduce' : 'full'; store.set('motion', S.motion); applyMotion(); render(); }));

    const account = h('section', { class: 'panel sec' }, h('h3', {}, 'Hesab'),
      S.set.note ? h('div', { class: 'notice good', role: 'status' }, S.set.note) : null,
      h('div', { class: 'srow' }, kv('İstifadəçi adı', S.profile ? S.profile.username : ''),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => toggle('name') }, 'Dəyiş')),
      S.set.open === 'name' ? nameForm() : null,
      providers.includes('google') ? h('div', { class: 'srow' }, kv('Google hesabı', email)) : null,
      hasPassword ? h('div', { class: 'srow' }, kv('Parol', '••••••••'), h('button', { class: 'btn btn-sm', type: 'button', onclick: () => toggle('pass') }, 'Dəyiş')) : null,
      S.set.open === 'pass' ? passForm() : null,
      h('button', { class: 'btn', type: 'button', onclick: signOut }, 'Çıxış'));

    const privacy = h('section', { class: 'panel sec' }, h('h3', {}, 'Məxfilik'),
      h('a', { class: 'btn', href: 'privacy.html', target: '_blank', rel: 'noopener' }, 'Məxfilik siyasəti'),
      S.set.open === 'delete' ? deleteForm() : h('button', { class: 'btn btn-danger', type: 'button', onclick: () => toggle('delete') }, 'Hesabı sil'));

    return h('div', { class: 'screen' },
      h('header', { class: 'bar' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Geri', onclick: () => go('home') }, icon(I.close)),
        h('h2', { class: 'disp', style: 'font-size:34px' }, 'Ayarlar'), h('span', { style: 'width:46px' })),
      look, game, account, privacy);
  }

  /* ---------- Məşq rejimi ---------- */
  async function openPractice() {
    S.practice = { rows: [], loading: true, error: '' }; go('practice');
    try { S.practice.rows = (await rpc('practice_categories')) || []; } catch (e) { S.practice.error = errMsg(e); }
    S.practice.loading = false; if (S.screen === 'practice') render();
  }
  function viewPractice() {
    const P = S.practice; const last = store.get('lastcat');
    let body;
    if (P.loading) body = h('p', { class: 'muted empty' }, 'Yüklənir…');
    else if (P.error) body = h('p', { class: 'muted empty' }, P.error);
    else if (!P.rows.length) body = h('p', { class: 'muted empty' }, 'Hələ bölmə yoxdur.');
    else body = h('div', { class: 'cats' }, P.rows.map((c, i) => h('button', {
      class: `cat${String(c.id) === last && c.playable ? ' last' : ''}`, type: 'button', style: `--i:${i}`, disabled: !c.playable,
      onclick: () => { store.set('lastcat', String(c.id)); startGame({ category: c.id, title: c.title_az }); },
    }, h('span', {}, c.title_az, h('small', {}, c.playable ? 'Məşq üçün hazırdır' : 'Hələ kifayət qədər sual yoxdur (ən azı 12)')), h('span', { class: 'cnt' }, String(c.question_count)))));
    return h('div', { class: 'screen' },
      h('header', { class: 'bar' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Geri', onclick: () => go('home') }, icon(I.close)),
        h('h2', { class: 'disp', style: 'font-size:34px' }, 'Məşq'), h('span', { style: 'width:46px' })),
      h('div', { class: 'panel' },
        h('p', {}, 'Bir hüquq sahəsi seçin: 12 sualın hamısı yalnız ondan gəlir.'),
        h('p', { class: 'muted small' }, 'Məşq nəticəsi reytinqə, ən yaxşı xala və oyun sayına təsir etmir.')),
      body);
  }

  /* ---------- Oyun ---------- */
  let starting = false;
  async function startGame(opts = {}) {
    if (starting) return;
    const practice = opts.category != null;
    const btn = practice ? null : document.getElementById('start');
    if (btn) { btn.disabled = true; btn.textContent = 'Hazırlanır…'; }
    starting = true;
    try {
      const st = practice ? await rpc('start_practice', { p_category: opts.category }) : await rpc('start_run', { p_mode: 'solo' });
      G = { runId: st.run_id, level: st.level, score: st.score, shownScore: st.score, banked: 0, q: st.question, hidden: [],
        lifelines: st.lifelines_used || [], phase: 'asking', chosen: null, result: null, refs: {}, lastPct: null, lastSec: null, mediaEl: null, entering: true, shieldsOn: [],
        practice, category: practice ? opts.category : null, categoryTitle: opts.title || '' };
      sfx.tap(); go('game'); startTimer(TIME_LIMIT_MS - (st.elapsed_ms || 0));
    } catch (e) {
      toast(errMsg(e));
      if (btn) { btn.disabled = false; btn.textContent = 'Oyuna başla'; btn.append(icon(I.arrow)); }
    }
    starting = false;
  }

  function stopTimer() { if (timerHandle) { clearInterval(timerHandle); timerHandle = null; } }
  function startTimer(remainingMs) {
    stopTimer();
    const end = performance.now() + Math.max(0, remainingMs);
    let lastSec = null;
    const tick = () => {
      if (!G || G.phase !== 'asking') { stopTimer(); return; }
      const left = Math.max(0, end - performance.now());
      const sec = Math.ceil(left / 1000);
      const { fill, secs } = G.refs;
      G.lastPct = (left / TIME_LIMIT_MS) * 100; G.lastSec = sec;
      if (fill) { fill.style.width = `${G.lastPct}%`; fill.classList.toggle('crit', sec <= 5); }
      if (secs) { secs.textContent = String(sec); secs.classList.toggle('crit', sec <= 5); }
      if (sec !== lastSec) { lastSec = sec; if (sec <= 5 && sec > 0) sfx.tick(); }
      if (left <= 0) { stopTimer(); answer(null); }
    };
    tick(); timerHandle = setInterval(tick, 100);
  }

  async function answer(pos) {
    if (!G || G.phase !== 'asking') return;
    G.phase = 'locked'; G.chosen = pos; stopTimer();
    if (pos != null) { sfx.pick(); buzz(12); }
    render();
    try {
      const prevLevel = G.level;
      const r = await rpc('submit_answer', { p_run: G.runId, p_choice: pos });
      G.result = r; G.score = r.score; G.banked = r.banked || 0; G.phase = 'feedback';
      G.shielded = r.correct && SHIELDS.includes(prevLevel);
      if (G.shielded) G.shieldsOn.push(prevLevel);
      if (r.correct) { sfx.correct(); buzz(30); if (G.shielded) setTimeout(sfx.shield, 380); } else { sfx.wrong(); buzz([70, 40, 70]); }
      render();
      const fb = document.querySelector('.feedback');
      if (fb && fb.scrollIntoView) fb.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
    } catch (e) {
      toast(errMsg(e)); G.phase = 'asking'; G.chosen = null; render();
      startTimer(8000); // şəbəkə xətasından sonra yenidən cəhd üçün qısa görünən saat; real limiti server yoxlayır
    }
  }

  async function nextStep() {
    if (!G || G.phase !== 'feedback') return;
    if (G.result.finished) {
      S.result = { status: G.result.status, score: G.result.score, level: G.level, banked: G.result.banked || 0, from: 0,
        practice: G.practice, category: G.category, categoryTitle: G.categoryTitle };
      stopTimer();
      if (!G.practice) { try { await loadProfile(); } catch (_) { /* statistika yenilənməsə də davam */ } }
      go('result');
      return;
    }
    const btn = document.getElementById('next'); if (btn) btn.disabled = true;
    const stage = document.querySelector('.stage'); if (stage) stage.classList.add('leave');
    try {
      const [st] = await Promise.all([rpc('reveal_question', { p_run: G.runId }), sleep(170)]);
      G.level = st.level; G.q = st.question; G.mediaEl = null; G.hidden = []; G.chosen = null; G.result = null; G.shielded = false;
      G.lastPct = null; G.lastSec = null; G.phase = 'asking'; G.entering = true;
      sfx.tap(); render(); startTimer(TIME_LIMIT_MS - (st.elapsed_ms || 0));
    } catch (e) {
      toast(errMsg(e)); if (stage) stage.classList.remove('leave'); if (btn) btn.disabled = false;
    }
  }

  async function useLifeline() {
    if (!G || G.phase !== 'asking' || G.lifelines.includes('eliminate')) return;
    try {
      const hide = await rpc('use_lifeline_eliminate', { p_run: G.runId });
      G.hidden = hide || []; G.lifelines.push('eliminate'); sfx.tap(); render();
    } catch (e) { toast(errMsg(e)); }
  }

  function quitGame() {
    if (!window.confirm(G && G.practice ? 'Məşqdən çıxmaq istəyirsiniz?' : 'Oyundan çıxmaq istəyirsiniz? Bu oyunun irəliləyişi itəcək.')) return;
    G = null; go('home');
  }

  function mediaNode(m) {
    if (!m) return null;
    const url = `${cfg.SUPABASE_URL}/storage/v1/object/public/question-media/${m.path.split('/').map(encodeURIComponent).join('/')}`;
    if (m.type === 'image') return h('img', { class: 'q-media', src: url, alt: m.alt || '', decoding: 'async' });
    if (m.type === 'audio') return h('audio', { class: 'q-media', src: url, controls: true, preload: 'metadata', 'aria-label': m.alt || 'Səs' });
    return h('video', { class: 'q-media', src: url, controls: true, playsinline: true, preload: 'metadata', 'aria-label': m.alt || 'Video' });
  }

  function viewGame() {
    const g = G;
    const segs = [];
    for (let i = 1; i <= TOTAL; i += 1) {
      const cls = ['seg'];
      if (i < g.level) cls.push('done');
      if (i === g.level) cls.push('cur');
      const seg = h('div', { class: cls.join(' ') });
      if (SHIELDS.includes(i)) seg.append(h('span', { class: `shield${g.shieldsOn.includes(i) ? ' on' : ''}`, title: 'Qalxan' }, icon(I.shield)));
      segs.push(seg);
    }

    const lastPct = g.lastPct == null ? 100 : g.lastPct;
    const lastSec = g.lastSec == null ? 30 : g.lastSec;
    const fill = h('div', { class: `fill${lastSec <= 5 ? ' crit' : ''}`, style: `width:${lastPct}%` });
    const secs = h('div', { class: `t-sec${lastSec <= 5 && g.phase === 'asking' ? ' crit' : ''}` }, String(lastSec));
    const scoreEl = h('b', {}, fmt(g.shownScore));
    g.refs = { fill, secs, score: scoreEl };

    const answers = h('div', { class: 'answers', role: 'group', 'aria-label': 'Cavab variantları' },
      g.q.options.map((o, i) => {
        const cls = ['answer'];
        const out = g.hidden.includes(o.pos);
        if (out) cls.push('out');
        if (g.phase === 'locked' && g.chosen === o.pos) cls.push('picked');
        if (g.phase === 'feedback') {
          if (o.pos === g.result.correct_pos) cls.push('correct');
          else if (g.chosen === o.pos) cls.push('wrong');
        }
        return h('button', { class: cls.join(' '), type: 'button', 'data-pos': String(o.pos), style: `--i:${i}`, disabled: g.phase !== 'asking' || out, onclick: () => answer(o.pos) },
          h('span', { class: 'k' }, LETTERS[o.pos - 1]), h('span', { class: 't' }, o.body));
      }));

    const used = g.lifelines.includes('eliminate');
    let bottom;
    if (g.phase === 'feedback') {
      const r = g.result;
      const timeout = !r.correct && g.chosen == null;
      const stampText = r.correct ? 'Düzgün' : timeout ? 'Vaxt bitdi' : 'Səhv';
      const gainEl = r.correct ? h('div', { class: 'gain' }, `+${fmt(r.gain)}`) : null;
      bottom = h('div', { class: `panel feedback ${r.correct ? 'good' : 'bad'}`, role: 'status' },
        h('div', { class: 'fb-head' }, h('span', { class: 'stamp' }, stampText), gainEl),
        g.shielded ? h('div', { class: 'shield-note' }, icon(I.shield), h('span', {}, `Qalxan aktivdir: ${fmt(r.score)} xal qorunur.`)) : null,
        !r.correct && r.score > 0 ? h('div', { class: 'shield-note' }, icon(I.shield), h('span', {}, `Qalxan xalınızı qorudu: ${fmt(r.score)} xal saxlanıldı.`)) : null,
        r.explanation ? h('p', { class: 'expl' }, r.explanation) : null,
        h('button', { class: 'btn btn-primary', type: 'button', id: 'next', onclick: nextStep }, r.finished ? 'Nəticəyə bax' : 'Növbəti sual', icon(I.arrow)));
      g.refs.gain = gainEl;
    } else {
      bottom = h('button', { class: 'btn lifeline', type: 'button', id: 'lifeline', disabled: used || g.phase !== 'asking', onclick: useLifeline },
        used ? 'Məcəllə istifadə olunub' : 'Məcəllə: iki səhvi sil');
    }

    if (!g.mediaEl) g.mediaEl = mediaNode(g.q.media); // eyni media elementi yenidən çəkilişdə saxlanılır ki, səs/video kəsilməsin
    const stage = h('div', { class: `stage${g.entering ? ' enter' : ''}` },
      h('div', { class: 'panel qcard' }, g.mediaEl, h('div', { class: 'qtext' }, g.q.body)), answers, bottom);
    g.entering = false;

    return h('div', { class: 'screen' },
      h('div', { class: 'game-top' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Oyundan çıx', onclick: quitGame }, icon(I.close)),
        h('div', { class: 'q-count' }, `Sual ${g.level}`, h('small', {}, ` / ${TOTAL}`), g.practice ? h('span', { class: 'tag-practice' }, 'Məşq') : null),
        h('div', { class: 'score' }, scoreEl, h('span', { class: 'label' }, 'xal'))),
      h('div', { class: 'segs', role: 'img', 'aria-label': `${TOTAL} sualdan ${g.level}-cisi` }, segs),
      h('div', { class: 'timer' }, h('div', { class: 'bar-t' }, fill), secs),
      stage);
  }

  function afterGameRender() {
    const g = G; if (!g) return;
    if (g.phase === 'feedback' && g.shownScore !== g.score) {
      countUp(g.refs.score, g.shownScore, g.score, 800);
      if (g.refs.gain) countUp(g.refs.gain, 0, g.result.gain, 650, '+');
      g.shownScore = g.score;
    }
  }

  function viewResult() {
    const r = S.result;
    const won = r.status === 'finished';
    const scoreEl = h('div', { class: 'big' }, '0');
    setTimeout(() => { countUp(scoreEl, 0, r.score, 1100); sfx.slam(); if (won) setTimeout(sfx.win, 250); }, 300);
    const stampText = r.practice ? (won ? 'Məşq tamamlandı' : 'Məşq bitdi') : (won ? 'Tamamlandı' : 'Oyun bitdi');
    const info = [
      r.practice && r.categoryTitle ? h('p', { class: 'label' }, r.categoryTitle) : null,
      h('p', {}, won ? 'Bütün 12 sualı cavablandırdınız.' : `${r.level} / ${TOTAL} sualda dayandınız.`),
      !won && r.score > 0 ? h('p', { class: 'muted small' }, 'Qalxan xalınızı qorudu: xal ən son qalxan nöqtəsindən saxlanıldı.') : null,
      r.practice ? h('p', { class: 'muted small' }, 'Bu məşq reytinqə və ən yaxşı xalınıza təsir etmədi.')
        : (S.profile ? h('p', { class: 'muted small' }, `Ən yaxşı xalınız: ${fmt(S.profile.best_score)}`) : null)];
    const actions = r.practice ? [
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => startGame({ category: r.category, title: r.categoryTitle }) }, 'Yenidən məşq et', icon(I.arrow)),
      h('button', { class: 'btn', type: 'button', onclick: openPractice }, 'Başqa sahə'),
      h('button', { class: 'btn btn-text', type: 'button', onclick: () => go('home') }, 'Ana səhifə')] : [
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { go('home'); startGame(); } }, 'Yenidən oyna', icon(I.arrow)),
      h('button', { class: 'btn', type: 'button', onclick: openBoard }, 'Reytinq'),
      h('button', { class: 'btn btn-text', type: 'button', onclick: () => go('home') }, 'Ana səhifə')];
    return h('div', { class: 'screen result' },
      h('img', { class: 'emb', src: 'brand/emblem.png', alt: '' }),
      h('span', { class: 'stamp', style: `color:var(--${won ? 'good' : 'bad'})` }, stampText),
      scoreEl,
      h('p', { class: 'label' }, 'xal'),
      h('div', { class: 'panel' }, info),
      actions);
  }

  /* ---------- Reytinq ---------- */
  async function openBoard() { S.board.loading = true; go('board'); await loadBoard(); }
  async function loadBoard() {
    S.board.loading = true; if (S.screen === 'board') render();
    try { S.board.rows = (await rpc('get_leaderboard', { p_period: S.board.period, p_limit: 50 })) || []; } catch (e) { S.board.rows = []; toast(errMsg(e)); }
    S.board.loading = false; if (S.screen === 'board') render();
  }
  function viewBoard() {
    const me = S.profile && S.profile.username;
    const tab = (period, text) => h('button', { type: 'button', role: 'tab', 'aria-selected': S.board.period === period ? 'true' : 'false', onclick: () => { S.board.period = period; loadBoard(); } }, text);
    let body;
    if (S.board.loading) body = h('p', { class: 'muted empty' }, 'Yüklənir…');
    else if (!S.board.rows.length) body = h('p', { class: 'muted empty' }, 'Hələ nəticə yoxdur. İlk siz olun!');
    else body = h('ol', { class: 'board' }, S.board.rows.map((r, i) => h('li', { class: `row${r.username === me ? ' me' : ''}`, style: `--i:${i}` },
      h('span', { class: 'rk' }, String(r.rank)), h('span', { class: 'nm' }, r.username), h('span', { class: 'sc' }, fmt(r.score)))));
    return h('div', { class: 'screen' },
      h('header', { class: 'bar' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Geri', onclick: () => go('home') }, icon(I.close)),
        h('h2', { class: 'disp', style: 'font-size:34px' }, 'Reytinq'), h('span', { style: 'width:46px' })),
      h('div', { class: 'seg-tabs', role: 'tablist' }, tab('weekly', 'Bu həftə'), tab('alltime', 'Ümumi')),
      body,
      h('button', { class: 'btn btn-text', type: 'button', onclick: loadBoard }, 'Yenilə'));
  }

  /* ---------- Açılış ---------- */
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; if (S.screen === 'home') render(); });
  window.addEventListener('keydown', (e) => {
    if (S.screen !== 'game' || !G || G.phase !== 'asking') return;
    const n = Number(e.key);
    if (n >= 1 && n <= 4 && !G.hidden.includes(n)) answer(n);
  });

  function onAuth(evt) {
    if (evt === 'SIGNED_OUT') { if (S.booted && S.screen !== 'auth') { S.user = null; S.profile = null; setTimeout(() => go('auth'), 0); } return; }
    // Başqa tabda Google ilə daxil olunubsa, bu tab da avtomatik davam edir
    if (evt === 'SIGNED_IN' && S.booted && !S.user && S.screen === 'auth') setTimeout(afterLogin, 0);
  }

  async function boot() {
    applyTheme(); applyMotion();
    render();
    sb.auth.onAuthStateChange(onAuth);
    let has = false;
    try { [has] = await Promise.all([loadProfile(), loadProviders()]); } catch (e) { toast(errMsg(e)); }
    S.booted = true;
    if (has) await afterLogin(); else go('auth');
    if (AUTH_RETURN.error) toast(/access_denied|denied|cancel/i.test(AUTH_RETURN.error) ? 'Google ilə giriş ləğv edildi.' : 'Giriş alınmadı. Yenidən cəhd edin.', 6000);
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  boot();
})();
