(() => {
  'use strict';

  const cfg = window.GFL_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  const LETTERS = ['A', 'B', 'C', 'D'];
  const TOTAL = 12;
  const TIME_LIMIT_MS = 30000;
  const SHIELDS = [4, 8]; // "Qalxan": bu suallardan sonra xal qorunur
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MSG = {
    bad_username: 'Ad 3–20 simvol olmalıdır: latın kiçik hərfləri, rəqəmlər və _.',
    bad_password: 'Parol ən azı 6 simvol olmalıdır.',
    username_taken: 'Bu ad artıq götürülüb.',
    bad_login: 'Ad və ya parol səhvdir.',
    create_failed: 'Hesab yaradıla bilmədi. Bir az sonra yenidən cəhd edin.',
    network: 'Şəbəkə xətası. İnternet bağlantısını yoxlayın.',
    not_enough: 'Hələ kifayət qədər sual yoxdur.',
    generic: 'Xəta baş verdi. Yenidən cəhd edin.',
  };

  const S = {
    screen: 'boot', authMode: 'login', user: null, profile: null, result: null, animate: false,
    board: { period: 'weekly', rows: [], loading: false },
    sound: (() => { try { return localStorage.getItem('kalkhan.sound') !== 'off'; } catch (_) { return true; } })(),
    installEvt: null,
  };
  let G = null; // cari oyun
  let timerHandle = null;

  const $app = document.getElementById('app');
  const $toast = document.getElementById('toast');
  const fmt = (n) => new Intl.NumberFormat('az').format(n || 0);
  const sleep = (ms) => new Promise((r) => setTimeout(r, REDUCED ? 0 : ms));

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
    shield: '<svg viewBox="0 0 16 19" fill="currentColor" aria-hidden="true"><path d="M8 0l7 2.4v6.1c0 4.3-2.9 7.7-7 10.5C3.9 16.200 1 12.800 1 8.500V2.400z"/></svg>',
  };

  function picture(light, dark, alt, cls) {
    return h('picture', {}, h('source', { srcset: dark, media: '(prefers-color-scheme: dark)' }), h('img', { src: light, alt, class: cls || null, decoding: 'async' }));
  }
  const wordmark = () => picture('brand/wordmark.png', 'brand/wordmark-dark.png', 'KALKHAN');
  const fullLogo = () => picture('brand/logo-full.png', 'brand/logo-full-dark.png', 'KALKHAN');

  function toast(msg, ms = 3400) {
    $toast.textContent = msg; $toast.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => $toast.classList.remove('show'), ms);
  }
  function errMsg(e) {
    if (e instanceof AppError) return MSG[e.code] || MSG.generic;
    const m = String((e && e.message) || e || '');
    if (/not enough published/i.test(m)) return MSG.not_enough;
    if (/fetch|network|load failed/i.test(m)) return MSG.network;
    return MSG.generic;
  }

  function countUp(el, from, to, ms, prefix = '') {
    if (!el) return;
    if (REDUCED || from === to) { el.textContent = prefix + fmt(to); return; }
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
  function buzz(pattern) { if (S.sound && navigator.vibrate) navigator.vibrate(pattern); }

  /* ---------- Server ---------- */
  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args);
    if (error) throw error;
    return data;
  }
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
    const { error } = await sb.auth.signInWithPassword({ email: `${username}@${cfg.EMAIL_DOMAIN}`, password });
    if (error) throw new AppError(/fetch|network/i.test(error.message) ? 'network' : 'bad_login');
  }
  async function loadProfile() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { S.user = null; S.profile = null; return false; }
    S.user = session.user;
    const { data, error } = await sb.from('profiles').select('username,best_score,games_played').eq('id', session.user.id).single();
    if (error) throw error;
    S.profile = data;
    return true;
  }

  /* ---------- Naviqasiya ---------- */
  function go(screen) {
    stopTimer();
    S.screen = screen; S.animate = true;
    render();
    window.scrollTo(0, 0);
  }
  function render() {
    const views = { boot: viewBoot, auth: viewAuth, home: viewHome, game: viewGame, result: viewResult, board: viewBoard };
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
        try { localStorage.setItem('kalkhan.sound', S.sound ? 'on' : 'off'); } catch (_) { /* məxfi rejim */ }
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

  function viewAuth() {
    const isSignup = S.authMode === 'signup';
    const errBox = h('div', { class: 'error', role: 'alert' });
    const user = h('input', { id: 'u', name: 'username', type: 'text', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', maxlength: '20', required: true });
    const pass = h('input', { id: 'p', name: 'password', type: 'password', required: true, minlength: '6', maxlength: '72', autocomplete: isSignup ? 'new-password' : 'current-password' });
    const label = isSignup ? 'Qeydiyyatdan keç' : 'Daxil ol';
    const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, label, icon(I.arrow));
    const form = h('form', {
      class: 'form',
      onsubmit: async (ev) => {
        ev.preventDefault(); errBox.textContent = '';
        const u = user.value.trim().toLowerCase(); const p = pass.value;
        submit.disabled = true; submit.textContent = 'Gözləyin…';
        try {
          if (isSignup) await signup(u, p);
          await login(u, p); await loadProfile(); sfx.tap(); go('home');
        } catch (e) {
          errBox.textContent = errMsg(e); submit.disabled = false; submit.textContent = label; submit.append(icon(I.arrow));
        }
      },
    },
    h('div', { class: 'field' }, h('label', { for: 'u', class: 'label' }, 'İstifadəçi adı'), user),
    h('div', { class: 'field' }, h('label', { for: 'p', class: 'label' }, 'Parol'), pass),
    errBox, submit);
    const tab = (mode, text) => h('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': S.authMode === mode ? 'true' : 'false', onclick: () => { S.authMode = mode; render(); } }, text);

    return h('div', { class: 'screen' },
      h('div', { class: 'hero' }, fullLogo(), h('p', { class: 'muted' }, 'Hüquq biliyi sınağı. 12 sual, 30 saniyə, bir qalxan.')),
      h('div', { class: 'panel screen' },
        h('div', { class: 'tabs', role: 'tablist' }, tab('login', 'Daxil ol'), tab('signup', 'Qeydiyyat')),
        form,
        h('p', { class: 'muted small' }, isSignup ? 'E-poçt lazım deyil. Hələlik parolu bərpa etmək mümkün deyil, onu yadda saxlayın.' : 'Hesabınız yoxdur? "Qeydiyyat" bölməsindən 10 saniyəyə açın.')));
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

  function viewHome() {
    const p = S.profile || { username: '', best_score: 0, games_played: 0 };
    const rule = (n, title, text) => h('li', {}, h('span', { class: 'n' }, n), h('div', {}, h('b', {}, title), h('span', { class: 'muted' }, text)));
    return h('div', { class: 'screen' },
      topBar(soundButton()),
      h('div', { class: 'hello' }, h('p', { class: 'label' }, 'Salam'), h('h2', { class: 'disp' }, p.username)),
      h('div', { class: 'tiles' },
        h('div', { class: 'tile black' }, h('span', { class: 'label' }, 'Ən yaxşı xal'), h('b', {}, fmt(p.best_score))),
        h('div', { class: 'tile orange' }, h('span', { class: 'label' }, 'Oyun sayı'), h('b', {}, fmt(p.games_played)))),
      h('button', { class: 'btn btn-primary', type: 'button', id: 'start', onclick: startGame }, 'Oyuna başla', icon(I.arrow)),
      h('button', { class: 'btn', type: 'button', onclick: openBoard }, 'Reytinq'),
      h('div', { class: 'panel' },
        h('p', { class: 'label' }, 'Qaydalar'),
        h('ol', { class: 'rules' },
          rule('01', '12 sual', 'Çətinlik hər sualda artır.'),
          rule('02', '30 saniyə', 'Tez cavab əlavə xal gətirir.'),
          rule('03', 'Qalxan', '4-cü və 8-ci sualdan sonra xalınız qorunur: sonrakı səhv onu silmir.'),
          rule('04', 'Məcəllə', 'Oyunda bir dəfə iki səhv variantı silir.'))),
      installCard(),
      h('button', { class: 'btn btn-text', type: 'button', onclick: async () => { await sb.auth.signOut(); S.user = null; S.profile = null; S.authMode = 'login'; go('auth'); } }, 'Çıxış'));
  }

  /* ---------- Oyun ---------- */
  async function startGame() {
    const btn = document.getElementById('start');
    if (btn) { btn.disabled = true; btn.textContent = 'Hazırlanır…'; }
    try {
      const st = await rpc('start_run', { p_mode: 'solo' });
      G = { runId: st.run_id, level: st.level, score: st.score, shownScore: st.score, banked: 0, q: st.question, hidden: [],
        lifelines: st.lifelines_used || [], phase: 'asking', chosen: null, result: null, refs: {}, lastPct: null, lastSec: null, mediaEl: null, entering: true, shieldsOn: [] };
      sfx.tap(); go('game'); startTimer(TIME_LIMIT_MS - (st.elapsed_ms || 0));
    } catch (e) {
      toast(errMsg(e));
      if (btn) { btn.disabled = false; btn.textContent = 'Oyuna başla'; btn.append(icon(I.arrow)); }
    }
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
      if (fb && fb.scrollIntoView) fb.scrollIntoView({ block: 'nearest', behavior: REDUCED ? 'auto' : 'smooth' });
    } catch (e) {
      toast(errMsg(e)); G.phase = 'asking'; G.chosen = null; render();
      startTimer(8000); // şəbəkə xətasından sonra yenidən cəhd üçün qısa görünən saat; real limiti server yoxlayır
    }
  }

  async function nextStep() {
    if (!G || G.phase !== 'feedback') return;
    if (G.result.finished) {
      S.result = { status: G.result.status, score: G.result.score, level: G.level, banked: G.result.banked || 0, from: 0 };
      stopTimer();
      try { await loadProfile(); } catch (_) { /* statistika yenilənməsə də davam */ }
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
    if (!window.confirm('Oyundan çıxmaq istəyirsiniz? Bu oyunun irəliləyişi itəcək.')) return;
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
        h('div', { class: 'q-count' }, `Sual ${g.level}`, h('small', {}, ` / ${TOTAL}`)),
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
    return h('div', { class: 'screen result' },
      h('img', { class: 'emb', src: 'brand/emblem.png', alt: '' }),
      h('span', { class: 'stamp', style: `color:var(--${won ? 'good' : 'bad'})` }, won ? 'Tamamlandı' : 'Oyun bitdi'),
      scoreEl,
      h('p', { class: 'label' }, 'xal'),
      h('div', { class: 'panel' },
        h('p', {}, won ? 'Bütün 12 sualı cavablandırdınız.' : `${r.level} / ${TOTAL} sualda dayandınız.`),
        !won && r.score > 0 ? h('p', { class: 'muted small' }, 'Qalxan xalınızı qorudu: xal ən son qalxan nöqtəsindən saxlanıldı.') : null,
        S.profile ? h('p', { class: 'muted small' }, `Ən yaxşı xalınız: ${fmt(S.profile.best_score)}`) : null),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { go('home'); startGame(); } }, 'Yenidən oyna', icon(I.arrow)),
      h('button', { class: 'btn', type: 'button', onclick: openBoard }, 'Reytinq'),
      h('button', { class: 'btn btn-text', type: 'button', onclick: () => go('home') }, 'Ana səhifə'));
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

  async function boot() {
    render();
    try { go((await loadProfile()) ? 'home' : 'auth'); } catch (e) { go('auth'); toast(errMsg(e)); }
    sb.auth.onAuthStateChange((evt) => { if (evt === 'SIGNED_OUT' && S.screen !== 'auth') { S.user = null; S.profile = null; go('auth'); } });
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  boot();
})();
