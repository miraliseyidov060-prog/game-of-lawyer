(() => {
  'use strict';

  const cfg = window.GFL_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  const BUCKET = 'question-media';
  const PAGE = 25;
  const TARGET_PER_LEVEL = 30;
  const levelLabel = (n) => (n === 1 ? '1 — ən asan' : n === 12 ? '12 — ən çətin' : String(n));
  const STATUS = { draft: 'Qaralama', in_review: 'Yoxlamada', published: 'Dərc olunub', archived: 'Arxiv' };
  const MEDIA_TYPES = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/webm': 'weba',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  };
  const MIME_ALIASES = { 'audio/x-m4a': 'audio/mp4', 'audio/mp3': 'audio/mpeg', 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav' };
  const MAX_BYTES = { image: 10 * 1024 * 1024, audio: 25 * 1024 * 1024, video: 50 * 1024 * 1024 };
  const ERR = {
    forbidden: 'Bu əməliyyata icazəniz yoxdur.',
    body_required: 'Sual mətni boş ola bilməz.',
    bad_level: 'Çətinlik 1–12 arasında olmalıdır.',
    category_required: 'Kateqoriya seçin.',
    four_options_required: '4 variant lazımdır.',
    option_empty: 'Bütün variantları doldurun.',
    bad_correct: 'Düzgün variantı seçin.',
    not_found: 'Sual tapılmadı (silinib ola bilər).',
    author_cannot_review: 'Müəllif öz sualını dərc edə bilməz. Başqa redaktor yoxlamalıdır.',
    legal_ref_required: 'Dərc üçün qanun istinadı yazın.',
    bad_transition: 'Bu status dəyişikliyi mümkün deyil.',
    only_drafts_can_be_deleted: 'Yalnız qaralama silinə bilər. Digərlərini arxivləyin.',
    question_in_use: 'Bu sual oyunlarda istifadə olunub, arxivləyin.',
    last_admin: 'Sonuncu admini aşağı sala bilməzsiniz.',
    bad_role: 'Yanlış rol.',
    rows_required: 'İdxal üçün sətir yoxdur.',
    media_pair: 'Media faylı və növü uyğun deyil.',
    published_needs_review: 'Dərc üçün qanun istinadı və rəyçi lazımdır.',
  };

  const S = {
    me: null, role: null, cats: [], view: 'boot',
    list: { page: 0, status: '', cat: '', level: '', q: '', rows: [], total: 0, stats: {}, loading: false, tableBox: null },
    edit: null,
    imp: { rows: null, error: '', result: null, fileName: '' },
    users: [], coverage: [], hardest: [], easiest: [], busy: false,
  };
  const $root = document.getElementById('root');
  const $toast = document.getElementById('toast');

  /* ---------- Köməkçilər ---------- */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const brandMark = () => h('div', { class: 'brand' },
    h('img', { class: 'emb', src: '../brand/emblem.png', alt: '' }),
    h('img', { class: 'wm', src: '../brand/wordmark-dark.png', alt: 'KALKHAN' }),
    h('span', { class: 'tag' }, 'Admin'));
  const fullLogo = () => h('picture', {}, h('source', { srcset: '../brand/logo-full-dark.png', media: '(prefers-color-scheme: dark)' }),
    h('img', { class: 'full', src: '../brand/logo-full.png', alt: 'KALKHAN' }));

  function toast(msg, ms = 3600) {
    $toast.textContent = msg;
    $toast.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => $toast.classList.remove('show'), ms);
  }
  function errText(e) {
    const m = String((e && e.message) || e || '');
    for (const [k, v] of Object.entries(ERR)) if (m.startsWith(k) || m.includes(`"${k}"`) || m.includes(k + ' ')) return v;
    if (m.startsWith('unknown_category')) return `Naməlum kateqoriya: ${m.split(':').slice(1).join(':').trim()}`;
    if (/fetch|network/i.test(m)) return 'Şəbəkə xətası. İnternet bağlantısını yoxlayın.';
    if (/invalid input syntax|invalid_text/i.test(m)) return 'Rəqəm sahəsində yanlış dəyər var.';
    if (/violates check constraint "?media/i.test(m)) return ERR.media_pair;
    return `Xəta: ${m || 'naməlum'}`;
  }
  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args);
    if (error) throw error;
    return data;
  }
  const fmtDate = (s) => (s ? new Date(s).toLocaleDateString('az') : '—');
  const publicUrl = (path) => sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const badge = (status) => h('span', { class: `badge b-${status}` }, STATUS[status] || status);
  const isAdmin = () => S.role === 'admin';

  /* ---------- Giriş və qabıq ---------- */
  function viewLogin(message) {
    const err = h('div', { class: 'error', role: 'alert' }, message || '');
    const u = h('input', { id: 'u', type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true });
    const p = h('input', { id: 'p', type: 'password', autocomplete: 'current-password', required: true });
    const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Daxil ol');
    return h('form', {
      class: 'card login',
      onsubmit: async (ev) => {
        ev.preventDefault();
        err.textContent = '';
        btn.disabled = true;
        const { error } = await sb.auth.signInWithPassword({ email: `${u.value.trim().toLowerCase()}@${cfg.EMAIL_DOMAIN}`, password: p.value });
        if (error) { err.textContent = 'Ad və ya parol səhvdir.'; btn.disabled = false; return; }
        await start();
      },
    },
    fullLogo(),
    h('div', { class: 'field' }, h('label', { for: 'u' }, 'İstifadəçi adı'), u),
    h('div', { class: 'field' }, h('label', { for: 'p' }, 'Parol'), p),
    err, btn);
  }

  function viewNoAccess() {
    return h('div', { class: 'card login' },
      fullLogo(),
      h('div', { class: 'notice' }, `"${S.me}" hesabının admin panelə icazəsi yoxdur. Admin sizə "editor" və ya "admin" rolu verməlidir, sonra yenidən daxil olun.`),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: logout }, 'Çıxış'));
  }

  async function logout() { await sb.auth.signOut(); S.me = null; S.role = null; S.view = 'login'; render(); }

  function shell(content) {
    const items = [['list', 'Suallar'], ['new', 'Yeni sual'], ['import', 'CSV idxalı'], ['cats', 'Kateqoriyalar'], ['stats', 'Statistika']];
    if (isAdmin()) items.push(['users', 'İstifadəçilər']);
    const active = S.view === 'edit' ? (S.edit && S.edit.id ? 'list' : 'new') : S.view;
    return h('div', {},
      h('div', { class: 'header' },
        h('div', { class: 'header-in' },
          brandMark(),
          h('div', { class: 'who' }, h('span', {}, S.me), h('span', { class: 'badge b-role' }, S.role),
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: logout }, 'Çıxış'))),
        h('nav', { class: 'nav', 'aria-label': 'Bölmələr' }, items.map(([key, label]) => h('button', {
          type: 'button', 'aria-current': key === active ? 'page' : null, onclick: () => go(key),
        }, label)))),
      h('main', { class: 'wrap' }, content));
  }

  function render() {
    if (S.view === 'boot') { $root.replaceChildren(h('p', { class: 'muted', style: 'padding:24px' }, 'Yüklənir…')); return; }
    if (S.view === 'login') { $root.replaceChildren(viewLogin()); return; }
    if (S.view === 'noaccess') { $root.replaceChildren(viewNoAccess()); return; }
    const views = { list: viewList, edit: viewEdit, new: viewEdit, import: viewImport, cats: viewCats, stats: viewStats, users: viewUsers };
    $root.replaceChildren(shell(views[S.view]()));
    if (S.view === 'list') renderTable();
  }

  async function go(view, arg) {
    S.view = view;
    try {
      if (view === 'list') { render(); await loadList(); return; }
      if (view === 'new') { S.view = 'edit'; S.edit = blankEdit(); render(); return; }
      if (view === 'edit') { await loadEdit(arg); return; }
      if (view === 'cats') { await loadCats(); }
      if (view === 'stats') { await loadStats(); }
      if (view === 'users') { S.users = await rpc('list_users'); }
      if (view === 'import') { S.imp = { rows: null, error: '', result: null, fileName: '' }; }
    } catch (e) {
      toast(errText(e));
      if (view === 'edit') S.view = 'list';
    }
    render();
    window.scrollTo(0, 0);
  }

  async function loadCats() {
    const { data, error } = await sb.from('categories').select('id,slug,title_az,sort_order,is_active').order('sort_order').order('id');
    if (error) throw error;
    S.cats = data || [];
  }

  /* ---------- Suallar siyahısı ---------- */
  function viewList() {
    const L = S.list;
    const sel = (value, options, onchange) => h('select', { onchange: (e) => onchange(e.target.value) },
      options.map(([v, label]) => h('option', { value: v, selected: String(v) === String(value) }, label)));
    let timer = null;
    L.tableBox = h('div', { class: 'card' });
    return h('div', { class: 'stack' },
      h('div', { class: 'title-row' }, h('h2', {}, 'Suallar'), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => go('new') }, '+ Yeni sual')),
      h('div', { class: 'card row' },
        h('div', { class: 'field' }, h('label', {}, 'Status'), sel(L.status, [['', 'Hamısı'], ...Object.entries(STATUS)], (v) => { L.status = v; L.page = 0; loadList(); })),
        h('div', { class: 'field' }, h('label', {}, 'Kateqoriya'), sel(L.cat, [['', 'Hamısı'], ...S.cats.map((c) => [c.id, c.title_az])], (v) => { L.cat = v; L.page = 0; loadList(); })),
        h('div', { class: 'field' }, h('label', {}, 'Çətinlik'), sel(L.level, [['', 'Hamısı'], ...Array.from({ length: 12 }, (_, i) => [i + 1, levelLabel(i + 1)])], (v) => { L.level = v; L.page = 0; loadList(); })),
        h('div', { class: 'field grow' }, h('label', {}, 'Axtarış'), h('input', {
          type: 'search', value: L.q, placeholder: 'Sual mətnində axtar…',
          oninput: (e) => { clearTimeout(timer); timer = setTimeout(() => { L.q = e.target.value; L.page = 0; loadList(); }, 300); },
        }))),
      L.tableBox);
  }

  function trashIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: '18', height: '18', fill: 'none', stroke: 'currentColor',
      'stroke-width': '2.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6');
    svg.append(path);
    return svg;
  }

  async function deleteFromList(r) {
    if (S.busy) return;
    const short = r.body.length > 90 ? `${r.body.slice(0, 90)}…` : r.body;
    const warn = r.status === 'draft'
      ? 'Bu qaralama həmişəlik silinəcək.'
      : 'Bu sual silinəcək. Əgər oyunlarda istifadə olunubsa, silinmir, arxivə göndərilir.';
    if (!window.confirm(`${warn}\n\n“${short}”\n\nDavam edək?`)) return;
    S.busy = true;
    try {
      const res = await rpc('remove_question', { p_id: r.id });
      if (res === 'archived') toast('Sual oyunlarda istifadə olunub, ona görə silinmədi — arxivə göndərildi.', 5200);
      else if (res === 'in_use') toast('Sual oyunlarda istifadə olunub və artıq arxivdədir, bazadan silinə bilməz.', 5200);
      else {
        toast('Silindi.');
        if (r.media_path) sb.storage.from(BUCKET).remove([r.media_path]).catch(() => {});
        if (S.list.rows.length === 1 && S.list.page > 0) S.list.page -= 1;
      }
    } catch (e) { toast(errText(e)); }
    S.busy = false;
    await loadList();
  }

  async function loadList() {
    const L = S.list;
    L.loading = true;
    renderTable();
    let q = sb.from('questions')
      .select('id,level,body,status,legal_ref,media_type,media_path,category_id,updated_at,categories(title_az)', { count: 'exact' });
    if (L.status) q = q.eq('status', L.status);
    if (L.cat) q = q.eq('category_id', Number(L.cat));
    if (L.level) q = q.eq('level', Number(L.level));
    if (L.q.trim()) q = q.ilike('body', `%${L.q.trim()}%`);
    const { data, error, count } = await q.order('updated_at', { ascending: false }).range(L.page * PAGE, L.page * PAGE + PAGE - 1);
    if (error) { toast(errText(error)); L.rows = []; L.total = 0; } else { L.rows = data || []; L.total = count || 0; }
    L.stats = {};
    if (L.rows.length) {
      const ids = L.rows.map((r) => r.id);
      const st = await sb.from('question_stats').select('question_id,answered,correct_rate').in('question_id', ids);
      for (const s of st.data || []) L.stats[s.question_id] = s;
    }
    L.loading = false;
    renderTable();
  }

  function renderTable() {
    const L = S.list;
    if (!L.tableBox) return;
    if (L.loading) { L.tableBox.replaceChildren(h('p', { class: 'muted' }, 'Yüklənir…')); return; }
    if (!L.rows.length) { L.tableBox.replaceChildren(h('p', { class: 'muted' }, 'Sual tapılmadı.')); return; }
    const mediaLabel = { image: 'Şəkil', audio: 'Səs', video: 'Video' };
    const from = L.page * PAGE + 1;
    const to = L.page * PAGE + L.rows.length;
    const rows = L.rows.map((r) => {
      const st = L.stats[r.id];
      return h('tr', { class: 'click', tabindex: '0', onclick: () => go('edit', r.id), onkeydown: (e) => { if (e.key === 'Enter') go('edit', r.id); } },
        h('td', {}, `${r.level}`), h('td', {}, r.categories ? r.categories.title_az : ''),
        h('td', { class: 'q-body' }, r.body.length > 140 ? `${r.body.slice(0, 140)}…` : r.body),
        h('td', {}, r.media_type ? mediaLabel[r.media_type] : ''), h('td', {}, badge(r.status)),
        h('td', {}, r.legal_ref ? 'var' : h('span', { class: 'muted' }, 'yoxdur')),
        h('td', {}, st ? `${st.answered} · ${Math.round(Number(st.correct_rate) * 100)}%` : '—'),
        h('td', {}, fmtDate(r.updated_at)),
        h('td', { class: 'act' }, h('button', {
          class: 'btn btn-danger btn-icon', type: 'button', title: 'Sil', 'aria-label': 'Sualı sil',
          onclick: (e) => { e.stopPropagation(); deleteFromList(r); },
          onkeydown: (e) => e.stopPropagation(),
        }, trashIcon())));
    });
    L.tableBox.replaceChildren(
      h('div', { class: 'scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, [...['Çətinlik', 'Kateqoriya', 'Sual', 'Media', 'Status', 'İstinad', 'Cavab · düzgün', 'Yenilənib'].map((t) => h('th', {}, t)),
          h('th', { class: 'act' }, h('span', { class: 'sr' }, 'Sil'))])),
        h('tbody', {}, rows))),
      h('div', { class: 'row', style: 'margin-top:12px;justify-content:space-between;align-items:center' },
        h('span', { class: 'muted small' }, `${from}–${to} / ${L.total}`),
        h('div', { class: 'actions' },
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: L.page === 0, onclick: () => { L.page -= 1; loadList(); } }, '← Əvvəlki'),
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: to >= L.total, onclick: () => { L.page += 1; loadList(); } }, 'Növbəti →'))));
  }

  /* ---------- Redaktor ---------- */
  function blankEdit() {
    return {
      id: null, status: 'draft', dirty: false, file: null, fileUrl: null, removeMedia: false, previewBox: null,
      meta: { created_by: null, created_by_name: '', reviewed_by_name: '', last_verified_at: null, self_reviewed: false },
      form: { category_id: S.cats[0] ? S.cats[0].id : '', level: 1, body: '', opts: ['', '', '', ''], correct: -1,
        explanation: '', legal_ref: '', media_type: null, media_path: null, media_alt: '' },
    };
  }

  async function loadEdit(id) {
    const [q, o, k] = await Promise.all([
      sb.from('questions').select('*').eq('id', id).single(),
      sb.from('question_options').select('pos,body').eq('question_id', id).order('pos'),
      sb.from('question_keys').select('correct_pos,explanation').eq('question_id', id).maybeSingle(),
    ]);
    if (q.error) throw q.error;
    const ids = [q.data.created_by, q.data.reviewed_by].filter(Boolean);
    const names = {};
    if (ids.length) {
      const p = await sb.from('profiles').select('id,username').in('id', ids);
      for (const r of p.data || []) names[r.id] = r.username;
    }
    const opts = ['', '', '', ''];
    for (const row of o.data || []) opts[row.pos - 1] = row.body;
    S.view = 'edit';
    S.edit = {
      id, status: q.data.status, dirty: false, file: null, fileUrl: null, removeMedia: false, previewBox: null,
      meta: { created_by: q.data.created_by, created_by_name: names[q.data.created_by] || '—', reviewed_by_name: names[q.data.reviewed_by] || '—',
        last_verified_at: q.data.last_verified_at, self_reviewed: q.data.self_reviewed },
      form: { category_id: q.data.category_id, level: q.data.level, body: q.data.body, opts,
        correct: k.data ? k.data.correct_pos - 1 : -1, explanation: (k.data && k.data.explanation) || '', legal_ref: q.data.legal_ref || '',
        media_type: q.data.media_type, media_path: q.data.media_path, media_alt: q.data.media_alt || '' },
    };
    render();
    window.scrollTo(0, 0);
  }

  function currentMedia() {
    const E = S.edit; const f = E.form;
    if (E.file) return { type: E.file.type.split('/')[0], url: E.fileUrl, alt: f.media_alt };
    if (f.media_path && !E.removeMedia) return { type: f.media_type, url: publicUrl(f.media_path), alt: f.media_alt };
    return null;
  }

  function mediaNode(m) {
    if (!m) return null;
    if (m.type === 'image') return h('img', { src: m.url, alt: m.alt || '' });
    if (m.type === 'audio') return h('audio', { src: m.url, controls: true, preload: 'metadata' });
    return h('video', { src: m.url, controls: true, playsinline: true, preload: 'metadata' });
  }

  function renderPreview() {
    const E = S.edit; if (!E || !E.previewBox) return;
    const f = E.form; const L = ['A', 'B', 'C', 'D'];
    E.previewBox.replaceChildren(...[
      mediaNode(currentMedia()),
      h('div', { class: 'p-q' }, f.body || 'Sual mətni burada görünəcək'),
      f.opts.map((t, i) => h('div', { class: `p-opt${f.correct === i ? ' ok' : ''}` }, h('b', {}, L[i]), h('span', {}, t || `Variant ${L[i]}`))),
      f.explanation ? h('p', { class: 'small muted' }, `İzah: ${f.explanation}`) : null,
    ].flat().filter(Boolean));
  }

  function checkFile(file) {
    const type = MIME_ALIASES[file.type] || file.type;
    if (!MEDIA_TYPES[type]) return 'Bu fayl növü dəstəklənmir. Şəkil (jpg, png, webp, gif), səs (mp3, m4a, ogg, wav) və ya video (mp4, webm, mov) seçin.';
    const kind = type.split('/')[0];
    if (kind !== 'image' && file.size > MAX_BYTES[kind]) {
      return `Fayl çox böyükdür (${(file.size / 1048576).toFixed(1)} MB). ${kind === 'video' ? 'Video' : 'Səs'} üçün limit ${MAX_BYTES[kind] / 1048576} MB-dır; qısa klip tövsiyə olunur.`;
    }
    return '';
  }

  async function prepareFile(file) {
    const type = MIME_ALIASES[file.type] || file.type;
    if (/^image\/(jpeg|png|webp)$/.test(type) && window.createImageBitmap) {
      try {
        const bmp = await createImageBitmap(file);
        const sc = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
        const c = document.createElement('canvas');
        c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.85));
        if (blob && blob.size < file.size) return { blob, type: 'image/webp' };
      } catch (_) { /* sıxmaq alınmasa orijinal yüklənir */ }
    }
    return { blob: file, type };
  }

  async function uploadMedia(file) {
    const { blob, type } = await prepareFile(file);
    if (type.startsWith('image/') && blob.size > MAX_BYTES.image) throw new Error('Şəkil 10 MB-dan böyükdür.');
    const path = `${crypto.randomUUID()}.${MEDIA_TYPES[type]}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: type, upsert: false });
    if (error) throw error;
    return { path, type: type.split('/')[0] };
  }

  function validateForm() {
    const f = S.edit.form;
    if (!f.category_id) return 'Kateqoriya seçin.';
    if (!f.body.trim()) return 'Sual mətnini yazın.';
    if (f.opts.some((o) => !o.trim())) return 'Bütün 4 variantı doldurun.';
    if (f.correct < 0) return 'Düzgün variantı seçin.';
    return '';
  }

  async function saveEdit({ silent } = {}) {
    const E = S.edit; const f = E.form;
    const bad = validateForm();
    if (bad) { toast(bad); return false; }
    if (E.status === 'published' && E.id && !silent
        && !window.confirm('Dərc olunmuş sualı dəyişsəniz, o yenidən yoxlamaya qayıdacaq və oyundan çıxacaq. Davam edək?')) return false;
    S.busy = true; render();
    let uploaded = null;
    try {
      let mediaType = f.media_type; let mediaPath = f.media_path; let oldPath = null;
      if (E.removeMedia) { oldPath = f.media_path; mediaType = null; mediaPath = null; }
      if (E.file) { uploaded = await uploadMedia(E.file); oldPath = f.media_path || oldPath; mediaType = uploaded.type; mediaPath = uploaded.path; }
      const id = await rpc('save_question', { p: {
        id: E.id, category_id: Number(f.category_id), level: Number(f.level), body: f.body, options: f.opts,
        correct_pos: f.correct + 1, explanation: f.explanation, legal_ref: f.legal_ref,
        media_type: mediaType, media_path: mediaPath, media_alt: mediaType ? f.media_alt : null } });
      if (oldPath && oldPath !== mediaPath) sb.storage.from(BUCKET).remove([oldPath]).catch(() => {});
      S.busy = false;
      await loadEdit(id);
      if (!silent) toast('Saxlanıldı.');
      return true;
    } catch (e) {
      if (uploaded) sb.storage.from(BUCKET).remove([uploaded.path]).catch(() => {});
      S.busy = false; render(); toast(errText(e));
      return false;
    }
  }

  async function changeStatus(next, selfReview) {
    const E = S.edit;
    if (E.dirty || !E.id || E.file || E.removeMedia) { if (!(await saveEdit({ silent: true }))) return; }
    try {
      await rpc('set_question_status', { p_id: S.edit.id, p_status: next, p_self_review: !!selfReview });
      toast(`Status: ${STATUS[next]}`);
      await loadEdit(S.edit.id);
    } catch (e) { toast(errText(e)); }
  }

  async function deleteDraft() {
    const E = S.edit;
    if (!window.confirm('Bu qaralama həmişəlik silinəcək. Davam edək?')) return;
    try {
      const res = await rpc('remove_question', { p_id: E.id });
      if (res === 'deleted') {
        if (E.form.media_path) sb.storage.from(BUCKET).remove([E.form.media_path]).catch(() => {});
        toast('Silindi.');
      } else toast('Sual oyunlarda istifadə olunub, ona görə silinmədi — arxivə göndərildi.', 5200);
      go('list');
    } catch (e) { toast(errText(e)); }
  }

  function viewEdit() {
    const E = S.edit; const f = E.form;
    const touch = () => { E.dirty = true; renderPreview(); };

    const catSel = h('select', { id: 'cat', onchange: (e) => { f.category_id = Number(e.target.value); touch(); } },
      S.cats.filter((c) => c.is_active || c.id === f.category_id).map((c) => h('option', { value: c.id, selected: c.id === f.category_id }, c.title_az)));
    const lvlSel = h('select', { id: 'lvl', onchange: (e) => { f.level = Number(e.target.value); touch(); } },
      Array.from({ length: 12 }, (_, i) => h('option', { value: i + 1, selected: i + 1 === f.level }, levelLabel(i + 1))));

    const opts = f.opts.map((t, i) => h('div', { class: 'opt' },
      h('input', { type: 'radio', name: 'correct', 'aria-label': `Variant ${'ABCD'[i]} düzgündür`, checked: f.correct === i, onchange: () => { f.correct = i; touch(); } }),
      h('span', { class: 'letter' }, 'ABCD'[i]),
      h('input', { type: 'text', id: `o${i}`, value: t, maxlength: '300', 'aria-label': `Variant ${'ABCD'[i]}`, oninput: (e) => { f.opts[i] = e.target.value; touch(); } })));

    const fileInput = h('input', {
      type: 'file', id: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif,audio/*,video/mp4,video/webm,video/quicktime',
      onchange: (e) => {
        const file = e.target.files && e.target.files[0]; if (!file) return;
        const bad = checkFile(file);
        if (bad) { toast(bad, 6000); e.target.value = ''; return; }
        if (E.fileUrl) URL.revokeObjectURL(E.fileUrl);
        E.file = new File([file], file.name, { type: MIME_ALIASES[file.type] || file.type });
        E.fileUrl = URL.createObjectURL(E.file); E.removeMedia = false; E.dirty = true;
        render();
      },
    });
    const m = currentMedia();
    const mediaBox = h('div', { class: 'media-box' },
      m ? mediaNode(m) : h('p', { class: 'muted small' }, 'Media əlavə olunmayıb. Şəkil, səs və ya video seçə bilərsiniz (video üçün limit 50 MB).'),
      h('div', { class: 'actions' }, fileInput,
        m ? h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: () => {
          E.file = null; if (E.fileUrl) URL.revokeObjectURL(E.fileUrl); E.fileUrl = null; E.removeMedia = true; E.dirty = true; render(); } }, 'Mediani sil') : null),
      m ? h('div', { class: 'field' }, h('label', { for: 'alt' }, 'Təsvir (görmə məhdudiyyəti olanlar üçün)'),
        h('input', { type: 'text', id: 'alt', value: f.media_alt, maxlength: '200', oninput: (e) => { f.media_alt = e.target.value; touch(); } })) : null);

    // Status əməliyyatları
    const acts = [];
    const isAuthorHint = E.id && E.meta.created_by_name && S.me === E.meta.created_by_name;
    if (E.status === 'draft') acts.push(h('button', { class: 'btn btn-accent', type: 'button', onclick: () => changeStatus('in_review') }, 'Yoxlamaya göndər'));
    if (E.status === 'in_review') {
      if (isAuthorHint && !isAdmin()) acts.push(h('div', { class: 'notice' }, 'Bu sualı siz yazmısınız, başqa redaktor yoxlamalıdır.'));
      else if (isAuthorHint) acts.push(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { if (window.confirm('Bu sualı özünüz yoxlayıb dərc edirsiniz. Bu, "özü yoxlanıb" kimi qeyd olunacaq. Davam edək?')) changeStatus('published', true); } }, 'Özüm yoxlayıb dərc et'));
      else acts.push(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => changeStatus('published') }, 'Yoxladım, dərc et'));
      acts.push(h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => changeStatus('draft') }, 'Qaralamaya qaytar'));
    }
    if (E.status === 'archived') acts.push(h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => changeStatus('draft') }, 'Qaralamaya qaytar'));
    if (E.id && E.status !== 'archived') acts.push(h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { if (window.confirm('Sual arxivə köçürülsün? Oyunda göstərilməyəcək.')) changeStatus('archived'); } }, 'Arxivlə'));
    if (E.id && E.status === 'draft') acts.push(h('button', { class: 'btn btn-danger', type: 'button', onclick: deleteDraft }, 'Sil'));

    E.previewBox = h('div', { class: 'preview' });
    setTimeout(renderPreview, 0);

    return h('div', { class: 'stack' },
      h('div', { class: 'title-row' },
        h('div', { class: 'row', style: 'align-items:center' }, h('h2', {}, E.id ? 'Sualı redaktə et' : 'Yeni sual'), E.id ? badge(E.status) : null),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => go('list') }, '← Siyahı')),
      h('div', { class: 'editor' },
        h('div', { class: 'stack' },
          h('div', { class: 'card stack' },
            h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', { for: 'cat' }, 'Kateqoriya'), catSel), h('div', { class: 'field' }, h('label', { for: 'lvl' }, 'Çətinlik'), lvlSel)),
            h('div', { class: 'field' }, h('label', { for: 'body' }, 'Sual mətni'),
              h('textarea', { id: 'body', rows: '4', maxlength: '1000', value: f.body, oninput: (e) => { f.body = e.target.value; touch(); } })),
            h('div', { class: 'field' }, h('label', {}, 'Variantlar (düzgünü işarələyin)'), h('div', { class: 'stack', style: 'gap:8px' }, opts)),
            h('div', { class: 'field' }, h('label', { for: 'expl' }, 'İzah (oyunçu cavabdan sonra görür)'),
              h('textarea', { id: 'expl', rows: '3', maxlength: '1500', value: f.explanation, oninput: (e) => { f.explanation = e.target.value; touch(); } })),
            h('div', { class: 'field' }, h('label', { for: 'ref' }, 'Qanun istinadı (dərc üçün məcburi)'),
              h('input', { type: 'text', id: 'ref', value: f.legal_ref, maxlength: '300', placeholder: 'Məsələn: akt adı, maddə, redaksiya tarixi', oninput: (e) => { f.legal_ref = e.target.value; touch(); } }))),
          h('div', { class: 'card stack' }, h('h3', {}, 'Media (şəkil, səs, video)'), mediaBox)),
        h('div', { class: 'stack sticky' },
          h('div', { class: 'card stack' },
            h('div', { class: 'actions' },
              h('button', { class: 'btn btn-primary', type: 'button', id: 'save', disabled: S.busy, onclick: () => saveEdit() }, S.busy ? 'Saxlanılır…' : 'Saxla'),
              acts),
            E.id ? h('dl', { class: 'meta' },
              h('dt', {}, 'Müəllif'), h('dd', {}, E.meta.created_by_name),
              h('dt', {}, 'Rəyçi'), h('dd', {}, E.meta.reviewed_by_name + (E.meta.self_reviewed ? ' (özü yoxlayıb)' : '')),
              h('dt', {}, 'Son yoxlama'), h('dd', {}, fmtDate(E.meta.last_verified_at))) : null,
            E.status === 'published' ? h('p', { class: 'small muted' }, 'Dərc olunmuş sualı dəyişsəniz, yenidən yoxlamaya qayıdır.') : null),
          h('div', { class: 'card stack' }, h('h3', {}, 'Oyunçuya belə görünəcək'), E.previewBox))));
  }

  /* ---------- CSV idxalı ---------- */
  const CSV_COLS = ['category', 'level', 'body', 'opt1', 'opt2', 'opt3', 'opt4', 'correct', 'explanation', 'legal_ref'];

  function parseCSV(text) {
    const src = text.replace(/^﻿/, '');
    const first = src.split(/\r?\n/, 1)[0] || '';
    const delim = [';', '\t', ','].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let row = []; let cur = ''; let inQ = false;
    for (let i = 0; i < src.length; i += 1) {
      const c = src[i];
      if (inQ) {
        if (c === '"') { if (src[i + 1] === '"') { cur += '"'; i += 1; } else inQ = false; } else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim() !== ''));
  }

  function csvToObjects(text) {
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error('Faylda başlıq və ən azı 1 sətir olmalıdır.');
    const head = rows[0].map((x) => x.trim().toLowerCase());
    const missing = CSV_COLS.filter((c) => !head.includes(c));
    if (missing.length) throw new Error(`Çatışmayan sütunlar: ${missing.join(', ')}`);
    return rows.slice(1).map((r) => Object.fromEntries(CSV_COLS.map((c) => [c, (r[head.indexOf(c)] || '').trim()])));
  }

  function downloadTemplate() {
    const slug = S.cats[0] ? S.cats[0].slug : 'konstitusiya';
    const csv = `${CSV_COLS.join(',')}\r\n${slug},1,NÜMUNƏ sual mətni?,Variant A,Variant B,Variant C,Variant D,2,NÜMUNƏ izah,NÜMUNƏ akt və maddə\r\n`;
    const a = h('a', { href: URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })), download: 'suallar-sablon.csv' });
    document.body.append(a); a.click(); a.remove();
  }

  function viewImport() {
    const I = S.imp;
    const resultBox = h('div', { class: 'stack' });
    if (I.error) resultBox.append(h('div', { class: 'notice bad' }, I.error));
    if (I.rows) {
      resultBox.append(
        h('p', {}, `${I.fileName || 'Yapışdırılmış mətn'}: ${I.rows.length} sual oxundu. İlk 5 sətir:`),
        h('div', { class: 'scroll' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Kateqoriya', 'Çətinlik', 'Sual', 'Düzgün', 'İstinad'].map((t) => h('th', {}, t)))),
          h('tbody', {}, I.rows.slice(0, 5).map((r) => h('tr', {}, h('td', {}, r.category), h('td', {}, r.level), h('td', { class: 'q-body' }, r.body.slice(0, 120)), h('td', {}, r.correct), h('td', {}, r.legal_ref)))))),
        h('button', { class: 'btn btn-primary', type: 'button', disabled: S.busy, onclick: runImport }, S.busy ? 'İdxal olunur…' : `${I.rows.length} sualı qaralama kimi idxal et`));
    }
    if (I.result) {
      resultBox.append(
        h('div', { class: `notice ${I.result.errors.length ? '' : 'good'}` }, `İdxal olundu: ${I.result.inserted}. Səhvli sətir: ${I.result.errors.length}.`),
        I.result.errors.length ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Sətir'), h('th', {}, 'Səhv'))),
          h('tbody', {}, I.result.errors.map((e) => h('tr', {}, h('td', {}, `${e.row + 1}`), h('td', {}, errText({ message: e.error })))))) : null,
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { S.list.status = 'draft'; S.list.page = 0; go('list'); } }, 'Qaralamalara bax'));
    }
    const ta = h('textarea', { rows: '6', placeholder: 'Və ya CSV mətnini bura yapışdırın (Google Sheets: Fayl → Yüklə → CSV)…' });
    return h('div', { class: 'stack' },
      h('h2', {}, 'CSV ilə kütləvi idxal'),
      h('div', { class: 'card stack' },
        h('p', {}, 'Sualları Google Sheets və ya Excel-də yazın, CSV kimi yükləyin. Hər sətir qaralama kimi yaradılır, sonra yoxlanılıb dərc olunur. Şəkil, səs və video redaktorda əlavə edilir.'),
        h('p', { class: 'small muted' }, `Sütunlar: ${CSV_COLS.join(', ')}. "category" sütununa kateqoriyanın qısa adını (${S.cats.map((c) => c.slug).join(', ')}) yazın. "correct" 1–4 (A–D). Vergül, nöqtəli vergül və tab ayırıcıları avtomatik tanınır.`),
        h('div', { class: 'actions' }, h('button', { class: 'btn btn-ghost', type: 'button', onclick: downloadTemplate }, 'Şablonu yüklə (CSV)'),
          h('input', { type: 'file', id: 'csv', accept: '.csv,text/csv,text/plain', onchange: async (e) => {
            const file = e.target.files && e.target.files[0]; if (!file) return;
            readImport(await file.text(), file.name);
          } })),
        ta, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => readImport(ta.value, '') }, 'Mətni oxu')),
      resultBox);
  }

  function readImport(text, name) {
    S.imp = { rows: null, error: '', result: null, fileName: name };
    try { S.imp.rows = csvToObjects(text); } catch (e) { S.imp.error = e.message; }
    render();
  }

  async function runImport() {
    const I = S.imp; S.busy = true; render();
    const total = { inserted: 0, errors: [] };
    try {
      for (let i = 0; i < I.rows.length; i += 100) {
        const res = await rpc('import_questions', { p_rows: I.rows.slice(i, i + 100) });
        total.inserted += res.inserted;
        for (const er of res.errors) total.errors.push({ row: er.row + i, error: er.error });
      }
      I.result = total; I.rows = null;
    } catch (e) { I.error = errText(e); }
    S.busy = false; render();
  }

  /* ---------- Kateqoriyalar ---------- */
  function viewCats() {
    const rows = S.cats.map((c) => {
      const title = h('input', { type: 'text', value: c.title_az, maxlength: '80', 'aria-label': 'Ad' });
      const sort = h('input', { type: 'number', value: String(c.sort_order), 'aria-label': 'Sıra', style: 'width:90px' });
      const act = h('input', { type: 'checkbox', checked: c.is_active, 'aria-label': 'Aktiv' });
      return h('tr', {}, h('td', {}, c.slug), h('td', {}, title), h('td', {}, sort), h('td', {}, act),
        h('td', {}, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
          const { error } = await sb.from('categories').update({ title_az: title.value.trim(), sort_order: Number(sort.value) || 0, is_active: act.checked }).eq('id', c.id);
          if (error) toast(errText(error)); else { toast('Saxlanıldı.'); await loadCats(); }
        } }, 'Saxla')));
    });
    const slug = h('input', { type: 'text', placeholder: 'qısa-ad (latın, tire)', maxlength: '40' });
    const title = h('input', { type: 'text', placeholder: 'Ad (Azərbaycan dilində)', maxlength: '80' });
    return h('div', { class: 'stack' },
      h('h2', {}, 'Kateqoriyalar'),
      h('div', { class: 'card scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Qısa ad', 'Ad', 'Sıra', 'Aktiv', ''].map((t) => h('th', {}, t)))), h('tbody', {}, rows))),
      h('div', { class: 'card row' },
        h('div', { class: 'field grow' }, h('label', {}, 'Yeni kateqoriya: qısa ad'), slug),
        h('div', { class: 'field grow' }, h('label', {}, 'Ad'), title),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
          const s = slug.value.trim().toLowerCase();
          if (!/^[a-z0-9-]{2,40}$/.test(s) || !title.value.trim()) { toast('Qısa ad latın hərf, rəqəm və tire olmalı, ad boş olmamalıdır.'); return; }
          const { error } = await sb.from('categories').insert({ slug: s, title_az: title.value.trim(), sort_order: S.cats.length + 1 });
          if (error) toast(/duplicate|unique/i.test(error.message) ? 'Bu qısa ad artıq var.' : errText(error)); else { toast('Əlavə olundu.'); await loadCats(); render(); }
        } }, 'Əlavə et')));
  }

  /* ---------- Statistika ---------- */
  async function loadStats() {
    S.coverage = await rpc('question_coverage');
    const lists = await Promise.all([
      sb.from('question_stats').select('question_id,answered,correct_rate').gte('answered', 5).order('correct_rate', { ascending: true }).limit(10),
      sb.from('question_stats').select('question_id,answered,correct_rate').gte('answered', 5).order('correct_rate', { ascending: false }).limit(10),
    ]);
    const ids = [...new Set(lists.flatMap((l) => (l.data || []).map((r) => r.question_id)))];
    const info = {};
    if (ids.length) {
      const q = await sb.from('questions').select('id,level,body').in('id', ids);
      for (const r of q.data || []) info[r.id] = r;
    }
    const enrich = (l) => (l.data || []).map((r) => ({ ...r, ...(info[r.question_id] || { level: '?', body: '' }) }));
    S.hardest = enrich(lists[0]); S.easiest = enrich(lists[1]);
  }

  function viewStats() {
    const grid = {};
    for (let l = 1; l <= 12; l += 1) grid[l] = { published: 0, in_review: 0, draft: 0, archived: 0 };
    for (const r of S.coverage) grid[r.level][r.status] = Number(r.n);
    const total = Object.values(grid).reduce((a, g) => a + g.published, 0);
    const rows = Object.entries(grid).map(([lvl, g]) => {
      const cls = g.published >= TARGET_PER_LEVEL ? 'ok' : g.published >= 10 ? 'mid' : 'low';
      return h('tr', {}, h('td', {}, `Çətinlik ${lvl}`), h('td', { class: `num ${cls}` }, String(g.published)),
        h('td', { class: 'num' }, String(g.in_review)), h('td', { class: 'num' }, String(g.draft)), h('td', { class: 'num' }, String(g.archived)));
    });
    const list = (title, arr) => h('div', { class: 'card scroll' }, h('h3', {}, title),
      arr.length ? h('table', {}, h('thead', {}, h('tr', {}, ['Çətinlik', 'Sual', 'Cavab', 'Düzgün'].map((t) => h('th', {}, t)))),
        h('tbody', {}, arr.map((r) => h('tr', { class: 'click', onclick: () => go('edit', r.question_id) }, h('td', {}, String(r.level)), h('td', { class: 'q-body' }, r.body.slice(0, 100)),
          h('td', {}, String(r.answered)), h('td', {}, `${Math.round(Number(r.correct_rate) * 100)}%`)))))
        : h('p', { class: 'muted small' }, 'Hələ kifayət qədər cavab yoxdur (hər sual üçün ən azı 5).'));
    return h('div', { class: 'stack' },
      h('h2', {}, 'Statistika'),
      h('div', { class: 'card scroll' },
        h('p', {}, `Dərc olunmuş suallar: ${total}. Hədəf: hər çətinlik səviyyəsində ən azı ${TARGET_PER_LEVEL} (cəmi ${TARGET_PER_LEVEL * 12}).`),
        h('table', { class: 'cov' }, h('thead', {}, h('tr', {}, h('th', {}, 'Çətinlik'), ['Dərc olunub', 'Yoxlamada', 'Qaralama', 'Arxiv'].map((t) => h('th', { class: 'num' }, t)))), h('tbody', {}, rows))),
      list('Ən çətin suallar (düzgün cavab faizi ən aşağı)', S.hardest),
      list('Ən asan suallar (düzgün cavab faizi ən yuxarı)', S.easiest));
  }

  /* ---------- İstifadəçilər (yalnız admin) ---------- */
  function viewUsers() {
    let filter = '';
    const box = h('div', { class: 'card scroll' });
    const draw = () => {
      const rows = S.users.filter((u) => u.username.includes(filter)).map((u) => {
        const sel = h('select', { 'aria-label': `${u.username} rolu`, style: 'width:auto' },
          ['player', 'editor', 'admin'].map((r) => h('option', { value: r, selected: u.role === r }, r)));
        return h('tr', {}, h('td', {}, u.username), h('td', {}, sel), h('td', {}, String(u.games_played)), h('td', {}, String(u.best_score)), h('td', {}, fmtDate(u.created_at)),
          h('td', {}, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
            try { await rpc('set_user_role', { p_user: u.id, p_role: sel.value }); u.role = sel.value; toast(`${u.username}: ${sel.value}`); } catch (e) { toast(errText(e)); sel.value = u.role; }
          } }, 'Saxla')));
      });
      box.replaceChildren(h('table', {}, h('thead', {}, h('tr', {}, ['İstifadəçi', 'Rol', 'Oyun', 'Ən yaxşı xal', 'Qeydiyyat', ''].map((t) => h('th', {}, t)))), h('tbody', {}, rows)));
    };
    setTimeout(draw, 0);
    return h('div', { class: 'stack' },
      h('h2', {}, 'İstifadəçilər'),
      h('div', { class: 'notice' }, 'editor: sual yaza və başqasının sualını yoxlaya bilər. admin: bunlarla yanaşı rolları idarə edir və öz sualını özü yoxlaya bilər. Yeni işçi əvvəl oyunda qeydiyyatdan keçməlidir, sonra ona rol verin.'),
      h('div', { class: 'field' }, h('label', {}, 'Axtarış'), h('input', { type: 'search', oninput: (e) => { filter = e.target.value.trim().toLowerCase(); draw(); } })),
      box);
  }

  /* ---------- Başlanğıc ---------- */
  async function start() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { S.view = 'login'; render(); return; }
    try {
      const prof = await sb.from('profiles').select('username').eq('id', session.user.id).single();
      S.me = prof.data ? prof.data.username : session.user.email;
      S.role = await rpc('my_role');
    } catch (e) { S.view = 'login'; render(); toast(errText(e)); return; }
    if (S.role !== 'editor' && S.role !== 'admin') { S.view = 'noaccess'; render(); return; }
    try { await loadCats(); } catch (e) { toast(errText(e)); }
    S.view = 'list';
    render();
    await loadList();
  }

  start();
})();
