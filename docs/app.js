(() => {
  'use strict';

  const cfg = window.GFL_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  const RANKS = ['Tələbə', 'Köməkçi', 'Stajyor', 'Hüquqşünas', 'Məsləhətçi', 'Vəkil',
    'Prokuror', 'Hakim', 'Apellyasiya hakimi', 'Kassasiya hakimi', 'Konstitusiya hakimi', 'Ədalət zirvəsi'];
  const LETTERS = ['A', 'B', 'C', 'D'];
  const TIME_LIMIT_MS = 30000;
  const CHECKPOINTS = [4, 8];
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
    screen: 'boot',
    authMode: 'login',
    user: null,
    profile: null,
    result: null,
    board: { period: 'weekly', rows: [], loading: false },
    sound: (() => { try { return localStorage.getItem('gfl.sound') !== 'off'; } catch (_) { return true; } })(),
    installEvt: null,
  };
  let G = null; // cari oyun
  let timerHandle = null;

  const $app = document.getElementById('app');
  const $toast = document.getElementById('toast');
  const fmt = (n) => new Intl.NumberFormat('az').format(n || 0);

  class AppError extends Error {
    constructor(code) { super(code); this.code = code; }
  }

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

  function icon(markup) {
    const t = document.createElement('template');
    t.innerHTML = markup.trim();
    return t.content.firstChild;
  }

  const LOGO = '<svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="11" fill="#0F5C5C"/>'
    + '<rect x="9" y="29" width="8" height="10" rx="1.5" fill="#F6F1E7"/><rect x="20" y="22" width="8" height="17" rx="1.5" fill="#F6F1E7"/>'
    + '<rect x="31" y="15" width="8" height="24" rx="1.5" fill="#F6F1E7"/><circle cx="35" cy="9" r="4" fill="#B8862B"/></svg>';
  const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const ICON_CROSS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const ICON_SOUND_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z"/><path d="M15.5 9a4 4 0 010 6M18 6.5a8 8 0 010 11"/></svg>';
  const ICON_SOUND_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';

  function toast(msg, ms = 3400) {
    $toast.textContent = msg;
    $toast.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => $toast.classList.remove('show'), ms);
  }

  function errMsg(e) {
    if (e instanceof AppError) return MSG[e.code] || MSG.generic;
    const m = String((e && e.message) || e || '');
    if (/not enough published/i.test(m)) return MSG.not_enough;
    if (/fetch|network|load failed/i.test(m)) return MSG.network;
    return MSG.generic;
  }

  /* ---------- Səs və titrəyiş (öz sintezimiz, lisenziya problemi yoxdur) ---------- */
  let actx = null;
  function tone(freq, dur, type = 'sine', delay = 0, gain = 0.08) {
    if (!S.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const t0 = actx.currentTime + delay;
      const osc = actx.createOscillator();
      const g = actx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(actx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    } catch (_) { /* səs işləməsə oyun davam edir */ }
  }
  const sfx = {
    tap() { tone(660, 0.05, 'sine', 0, 0.04); },
    tick() { tone(880, 0.05, 'square', 0, 0.025); },
    correct() { tone(523, 0.12, 'triangle'); tone(784, 0.22, 'triangle', 0.11); },
    wrong() { tone(196, 0.22, 'sawtooth', 0, 0.045); tone(147, 0.32, 'sawtooth', 0.17, 0.045); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, 'triangle', i * 0.13)); },
  };
  function buzz(pattern) { if (S.sound && navigator.vibrate) navigator.vibrate(pattern); }

  /* ---------- Server çağırışları ---------- */
  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args);
    if (error) throw error;
    return data;
  }

  async function signup(username, password) {
    let res;
    try {
      res = await fetch(`${cfg.SUPABASE_URL}/functions/v1/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.SUPABASE_KEY },
        body: JSON.stringify({ username, password }),
      });
    } catch (_) { throw new AppError('network'); }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new AppError(body.error || 'create_failed');
  }

  async function login(username, password) {
    const { error } = await sb.auth.signInWithPassword({
      email: `${username}@${cfg.EMAIL_DOMAIN}`,
      password,
    });
    if (error) {
      if (/fetch|network/i.test(error.message)) throw new AppError('network');
      throw new AppError('bad_login');
    }
  }

  async function loadProfile() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { S.user = null; S.profile = null; return false; }
    S.user = session.user;
    const { data, error } = await sb.from('profiles')
      .select('username,best_score,games_played').eq('id', session.user.id).single();
    if (error) throw error;
    S.profile = data;
    return true;
  }

  /* ---------- Naviqasiya ---------- */
  function go(screen) {
    stopTimer();
    S.screen = screen;
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    const views = { boot: viewBoot, auth: viewAuth, home: viewHome, game: viewGame, result: viewResult, board: viewBoard };
    $app.replaceChildren(views[S.screen]());
  }

  function soundButton() {
    return h('button', {
      class: 'icon-btn', type: 'button', 'aria-label': S.sound ? 'Səsi söndür' : 'Səsi aç',
      onclick: () => {
        S.sound = !S.sound;
        try { localStorage.setItem('gfl.sound', S.sound ? 'on' : 'off'); } catch (_) { /* məxfi rejim */ }
        sfx.tap();
        render();
      },
    }, icon(S.sound ? ICON_SOUND_ON : ICON_SOUND_OFF));
  }

  function brand(big) {
    const el = h('div', { class: big ? 'brand big' : 'brand' });
    el.append(icon(LOGO), h('span', {}, 'Game for Lawyer'));
    return el;
  }

  /* ---------- Ekranlar ---------- */
  function viewBoot() {
    return h('div', { class: 'screen' }, h('div', { class: 'hero' }, brand(true), h('p', { class: 'muted' }, 'Yüklənir…')));
  }

  function viewAuth() {
    const isSignup = S.authMode === 'signup';
    const errBox = h('div', { class: 'error', role: 'alert' });
    const user = h('input', {
      id: 'u', name: 'username', type: 'text', autocomplete: 'username', autocapitalize: 'none',
      autocorrect: 'off', spellcheck: 'false', maxlength: '20', required: true,
    });
    const pass = h('input', {
      id: 'p', name: 'password', type: 'password', required: true, minlength: '6', maxlength: '72',
      autocomplete: isSignup ? 'new-password' : 'current-password',
    });
    const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, isSignup ? 'Qeydiyyatdan keç' : 'Daxil ol');

    const form = h('form', {
      class: 'form',
      onsubmit: async (ev) => {
        ev.preventDefault();
        errBox.textContent = '';
        const u = user.value.trim().toLowerCase();
        const p = pass.value;
        submit.disabled = true;
        submit.textContent = 'Gözləyin…';
        try {
          if (isSignup) await signup(u, p);
          await login(u, p);
          await loadProfile();
          sfx.tap();
          go('home');
        } catch (e) {
          errBox.textContent = errMsg(e);
          submit.disabled = false;
          submit.textContent = isSignup ? 'Qeydiyyatdan keç' : 'Daxil ol';
        }
      },
    },
    h('div', { class: 'field' }, h('label', { for: 'u' }, 'İstifadəçi adı'), user),
    h('div', { class: 'field' }, h('label', { for: 'p' }, 'Parol'), pass),
    errBox, submit);

    const tab = (mode, label) => h('button', {
      class: 'tab', type: 'button', role: 'tab', 'aria-selected': S.authMode === mode ? 'true' : 'false',
      onclick: () => { S.authMode = mode; render(); },
    }, label);

    return h('div', { class: 'screen' },
      h('div', { class: 'hero' }, brand(true), h('p', { class: 'muted' }, 'Azərbaycan hüququ üzrə pilləli sual oyunu')),
      h('div', { class: 'card screen' },
        h('div', { class: 'tabs', role: 'tablist' }, tab('login', 'Daxil ol'), tab('signup', 'Qeydiyyat')),
        form,
        h('p', { class: 'muted small' }, isSignup
          ? 'E-poçt lazım deyil. Hələlik parolu bərpa etmək mümkün deyil, onu yadda saxlayın.'
          : 'Hesabınız yoxdur? "Qeydiyyat" bölməsindən 10 saniyəyə açın.')),
    );
  }

  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

  function installCard() {
    if (isStandalone()) return null;
    if (S.installEvt) {
      return h('div', { class: 'card install' },
        h('div', {}, h('strong', {}, 'Tətbiq kimi quraşdırın'), h('p', { class: 'muted small' }, 'Ana ekranda ikon kimi açılır.')),
        h('button', {
          class: 'btn btn-ghost', type: 'button',
          onclick: async () => {
            const evt = S.installEvt;
            S.installEvt = null;
            evt.prompt();
            await evt.userChoice.catch(() => {});
            render();
          },
        }, 'Quraşdır'));
    }
    const hint = isIOS()
      ? 'Safari-də "Paylaş" düyməsini basın, sonra "Ana ekrana əlavə et" seçin.'
      : 'Brauzer menyusundan "Tətbiqi quraşdır" və ya "Ana ekrana əlavə et" seçin.';
    return h('div', { class: 'card' }, h('strong', {}, 'Tətbiq kimi quraşdırın'), h('p', { class: 'muted small' }, hint));
  }

  function viewHome() {
    const p = S.profile || { username: '', best_score: 0, games_played: 0 };
    return h('div', { class: 'screen' },
      h('div', { class: 'topbar' }, brand(false), soundButton()),
      h('div', { class: 'card screen' },
        h('div', {}, h('p', { class: 'muted small' }, 'Salam,'), h('h2', {}, p.username)),
        h('div', { class: 'stats' },
          h('div', { class: 'stat' }, h('b', {}, fmt(p.best_score)), h('span', {}, 'Ən yaxşı xal')),
          h('div', { class: 'stat' }, h('b', {}, fmt(p.games_played)), h('span', {}, 'Oyun sayı'))),
        h('button', { class: 'btn btn-primary btn-block', type: 'button', id: 'start', onclick: startGame }, 'Oyuna başla'),
        h('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: openBoard }, 'Reytinq')),
      h('div', { class: 'card' },
        h('strong', {}, 'Qaydalar'),
        h('ul', { class: 'rules' },
          h('li', {}, '12 pillə: hər pillədə sual çətinləşir.'),
          h('li', {}, 'Hər suala 30 saniyə, tez cavab əlavə xal verir.'),
          h('li', {}, '4-cü və 8-ci pillələr təhlükəsiz nöqtədir: səhv cavabda xal oraya qayıdır.'),
          h('li', {}, '"Məcəllə" yardımı oyunda bir dəfə iki səhv variantı silir.'))),
      installCard(),
      h('button', {
        class: 'btn btn-ghost', type: 'button',
        onclick: async () => { await sb.auth.signOut(); S.user = null; S.profile = null; S.authMode = 'login'; go('auth'); },
      }, 'Çıxış'),
    );
  }

  /* ---------- Oyun ---------- */
  async function startGame() {
    const btn = document.getElementById('start');
    if (btn) { btn.disabled = true; btn.textContent = 'Hazırlanır…'; }
    try {
      const st = await rpc('start_run', { p_mode: 'solo' });
      G = { runId: st.run_id, level: st.level, score: st.score, banked: 0, q: st.question, hidden: [],
        lifelines: st.lifelines_used || [], phase: 'asking', chosen: null, result: null, refs: {},
        lastPct: null, lastSec: null };
      sfx.tap();
      go('game');
      startTimer(TIME_LIMIT_MS - (st.elapsed_ms || 0));
    } catch (e) {
      toast(errMsg(e));
      if (btn) { btn.disabled = false; btn.textContent = 'Oyuna başla'; }
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
      G.lastPct = (left / TIME_LIMIT_MS) * 100;
      G.lastSec = sec;
      if (fill) {
        fill.style.width = `${G.lastPct}%`;
        fill.classList.toggle('warn', sec <= 10 && sec > 5);
        fill.classList.toggle('crit', sec <= 5);
      }
      if (secs) secs.textContent = String(sec);
      if (sec !== lastSec) { lastSec = sec; if (sec <= 5 && sec > 0) sfx.tick(); }
      if (left <= 0) { stopTimer(); answer(null); }
    };
    tick();
    timerHandle = setInterval(tick, 100);
  }

  async function answer(pos) {
    if (!G || G.phase !== 'asking') return;
    G.phase = 'locked';
    G.chosen = pos;
    stopTimer();
    render();
    try {
      const r = await rpc('submit_answer', { p_run: G.runId, p_choice: pos });
      G.result = r;
      G.score = r.score;
      G.banked = r.banked || 0;
      G.phase = 'feedback';
      if (r.correct) { sfx.correct(); buzz(30); } else { sfx.wrong(); buzz([60, 40, 60]); }
      render();
      const fb = document.querySelector('.feedback');
      if (fb && fb.scrollIntoView) fb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (e) {
      toast(errMsg(e));
      G.phase = 'asking';
      G.chosen = null;
      render();
      startTimer(8000); // şəbəkə xətasından sonra yenidən cəhd üçün qısa görünən saat; real limiti server yoxlayır
    }
  }

  async function nextStep() {
    if (!G || G.phase !== 'feedback') return;
    if (G.result.finished) {
      S.result = { status: G.result.status, score: G.result.score, level: G.level, banked: G.result.banked || 0 };
      stopTimer();
      try { await loadProfile(); } catch (_) { /* statistika yenilənməsə də davam */ }
      if (S.result.status === 'finished') sfx.win();
      go('result');
      return;
    }
    const btn = document.getElementById('next');
    if (btn) { btn.disabled = true; }
    try {
      const st = await rpc('reveal_question', { p_run: G.runId });
      G.level = st.level;
      G.q = st.question;
      G.hidden = [];
      G.chosen = null;
      G.result = null;
      G.lastPct = null;
      G.lastSec = null;
      G.phase = 'asking';
      sfx.tap();
      render();
      startTimer(TIME_LIMIT_MS - (st.elapsed_ms || 0));
    } catch (e) {
      toast(errMsg(e));
      if (btn) btn.disabled = false;
    }
  }

  async function useLifeline() {
    if (!G || G.phase !== 'asking' || G.lifelines.includes('eliminate')) return;
    try {
      const hide = await rpc('use_lifeline_eliminate', { p_run: G.runId });
      G.hidden = hide || [];
      G.lifelines.push('eliminate');
      sfx.tap();
      render();
    } catch (e) { toast(errMsg(e)); }
  }

  function quitGame() {
    if (!window.confirm('Oyundan çıxmaq istəyirsiniz? Bu oyunun irəliləyişi itəcək.')) return;
    G = null;
    go('home');
  }

  function seal(ok) {
    const s = h('div', { class: 'seal', 'aria-hidden': 'true' });
    s.append(icon(ok ? ICON_CHECK : ICON_CROSS));
    return s;
  }

  function viewGame() {
    const g = G;
    const rank = RANKS[g.level - 1];
    const pips = [];
    for (let i = 1; i <= 12; i += 1) {
      const cls = ['pip'];
      if (i < g.level) cls.push('done');
      if (i === g.level) cls.push('current');
      if (CHECKPOINTS.includes(i)) cls.push('cp');
      pips.push(h('div', { class: cls.join(' ') }));
    }

    const lastPct = g.lastPct == null ? 100 : g.lastPct;
    const lastSec = g.lastSec == null ? 30 : g.lastSec;
    const fill = h('div', { class: `timer-fill${lastSec <= 5 ? ' crit' : lastSec <= 10 ? ' warn' : ''}`, style: `width:${lastPct}%` });
    const secs = h('div', { class: 'timer-sec' }, String(lastSec));
    g.refs = { fill, secs };

    const answers = h('div', { class: 'answers', role: 'group', 'aria-label': 'Cavab variantları' },
      g.q.options.map((o) => {
        const cls = ['answer'];
        const eliminated = g.hidden.includes(o.pos);
        if (eliminated) cls.push('eliminated');
        if (g.phase !== 'asking' && g.chosen === o.pos) cls.push('selected');
        if (g.phase === 'feedback') {
          if (o.pos === g.result.correct_pos) cls.push('correct');
          else if (g.chosen === o.pos) cls.push('wrong');
        }
        return h('button', {
          class: cls.join(' '), type: 'button', 'data-pos': String(o.pos),
          disabled: g.phase !== 'asking' || eliminated, onclick: () => answer(o.pos),
        }, h('span', { class: 'pos' }, LETTERS[o.pos - 1]), h('span', {}, o.body));
      }));

    const used = g.lifelines.includes('eliminate');
    const lifeline = h('div', { class: 'lifelines' },
      h('button', {
        class: 'btn btn-ghost lifeline', type: 'button', id: 'lifeline',
        disabled: used || g.phase !== 'asking', onclick: useLifeline,
      }, used ? 'Məcəllə istifadə olunub' : 'Məcəllə: iki səhvi sil'));

    let feedback = null;
    if (g.phase === 'feedback') {
      const r = g.result;
      let title = 'Düzgün cavab!';
      let sub = `+${fmt(r.gain)} xal`;
      if (!r.correct) {
        title = g.chosen == null ? 'Vaxt bitdi' : 'Səhv cavab';
        sub = r.score > 0 ? `Təhlükəsiz nöqtədən ${fmt(r.score)} xal saxlanıldı` : 'Bu oyunda xal qazanılmadı';
      }
      feedback = h('div', { class: `feedback ${r.correct ? 'good' : 'bad'}`, role: 'status' },
        h('div', { class: 'fb-head' }, seal(r.correct), h('div', {}, h('strong', {}, title), h('span', {}, sub))),
        r.explanation ? h('p', { class: 'expl' }, r.explanation) : null,
        h('button', { class: 'btn btn-primary btn-block', type: 'button', id: 'next', onclick: nextStep },
          r.finished ? 'Nəticəyə bax' : 'Növbəti sual'));
    }

    return h('div', { class: 'screen game' },
      h('div', { class: 'game-top' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Oyundan çıx', onclick: quitGame }, '←'),
        h('div', { class: 'level-info' }, h('strong', {}, `Pillə ${g.level} / 12`), h('span', {}, rank)),
        h('div', { class: 'score' }, fmt(g.score), h('small', {}, ' xal'))),
      h('div', { class: 'ladder', role: 'img', 'aria-label': `12 pillədən ${g.level}-cisi` }, pips),
      h('div', { class: 'legend' }, h('span', {}, 'Təhlükəsiz: 4 və 8')),
      h('div', { class: 'timer' }, h('div', { class: 'timer-bar' }, fill), secs),
      h('div', { class: 'card question' }, g.q.body),
      answers,
      g.phase === 'feedback' ? feedback : lifeline,
    );
  }

  function viewResult() {
    const r = S.result;
    const won = r.status === 'finished';
    return h('div', { class: 'screen result' },
      h('div', { class: won ? 'good' : 'bad' }, seal(won)),
      h('h1', {}, won ? 'Ədalət zirvəsinə çatdınız!' : 'Oyun bitdi'),
      h('div', { class: 'big-score' }, fmt(r.score)),
      h('p', { class: 'muted' }, 'xal'),
      h('div', { class: 'card' },
        h('p', {}, `Çatdığınız pillə: ${r.level} / 12 (${RANKS[r.level - 1]})`),
        !won && r.score > 0 ? h('p', { class: 'muted small' }, 'Xal ən son təhlükəsiz nöqtədən saxlanıldı.') : null,
        S.profile ? h('p', { class: 'muted small' }, `Ən yaxşı xalınız: ${fmt(S.profile.best_score)}`) : null),
      h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => { go('home'); startGame(); } }, 'Yenidən oyna'),
      h('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: openBoard }, 'Reytinq'),
      h('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick: () => go('home') }, 'Ana səhifə'),
    );
  }

  /* ---------- Reytinq ---------- */
  async function openBoard() {
    S.board.loading = true;
    go('board');
    await loadBoard();
  }

  async function loadBoard() {
    S.board.loading = true;
    if (S.screen === 'board') render();
    try {
      S.board.rows = (await rpc('get_leaderboard', { p_period: S.board.period, p_limit: 50 })) || [];
    } catch (e) {
      S.board.rows = [];
      toast(errMsg(e));
    }
    S.board.loading = false;
    if (S.screen === 'board') render();
  }

  function viewBoard() {
    const me = S.profile && S.profile.username;
    const tab = (period, label) => h('button', {
      class: 'tab', type: 'button', role: 'tab', 'aria-selected': S.board.period === period ? 'true' : 'false',
      onclick: () => { S.board.period = period; loadBoard(); },
    }, label);

    let body;
    if (S.board.loading) body = h('p', { class: 'muted empty' }, 'Yüklənir…');
    else if (!S.board.rows.length) body = h('p', { class: 'muted empty' }, 'Hələ nəticə yoxdur. İlk siz olun!');
    else {
      body = h('ol', { class: 'board' }, S.board.rows.map((r) => h('li', { class: `row${r.username === me ? ' me' : ''}` },
        h('span', { class: 'rk' }, `#${r.rank}`), h('span', { class: 'nm' }, r.username), h('span', { class: 'sc' }, fmt(r.score)))));
    }

    return h('div', { class: 'screen' },
      h('div', { class: 'topbar' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Geri', onclick: () => go('home') }, '←'),
        h('h2', {}, 'Reytinq'), h('span', { style: 'width:44px' })),
      h('div', { class: 'tabs', role: 'tablist' }, tab('weekly', 'Bu həftə'), tab('alltime', 'Ümumi')),
      body,
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: loadBoard }, 'Yenilə'),
    );
  }

  /* ---------- Açılış ---------- */
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    S.installEvt = e;
    if (S.screen === 'home') render();
  });
  window.addEventListener('keydown', (e) => {
    if (S.screen !== 'game' || !G || G.phase !== 'asking') return;
    const n = Number(e.key);
    if (n >= 1 && n <= 4 && !G.hidden.includes(n)) answer(n);
  });

  async function boot() {
    render();
    try {
      go((await loadProfile()) ? 'home' : 'auth');
    } catch (e) {
      go('auth');
      toast(errMsg(e));
    }
    sb.auth.onAuthStateChange((evt) => {
      if (evt === 'SIGNED_OUT' && S.screen !== 'auth') { S.user = null; S.profile = null; go('auth'); }
    });
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  boot();
})();
