/* 聽道 v1 prototype — live transcription + Bible reference detection */
(function () {
  'use strict';
  const R = window.TingdaoRefs, C = window.TingdaoCorrections;
  const $ = (id) => document.getElementById(id);
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('tingdao.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('tingdao.' + k, JSON.stringify(v)); } catch {} },
  };

  // ---------- state ----------
  let bible = null;
  const settings = Object.assign({ god: '神', correct: true, keepAwake: true, font: 18 }, LS.get('settings', {}));
  let dictText = LS.get('dict', C.DEFAULT_TEXT);
  let rules = C.parse(dictText);
  let segments = LS.get('segments', []); // [{id,t,raw}]
  let seenLabels = new Map();            // label -> ref (unique list for the strip)
  let refRegistry = [];                  // refs rendered as chips this paint (index = data-i)
  let listening = false, rec = null, wakeLock = null;
  let active = false, interimText = '', lastFinal = '', restartTimer = null, quickEnds = 0, lastStart = 0;

  // ---------- utils ----------
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtTime = (t) => new Date(t).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  function annotate(raw) {
    // returns {html, refs}
    let text = raw, changes = [];
    if (settings.correct) { const r = C.apply(raw, rules); text = r.text; changes = r.changes; }
    const refs = R.findRefs(text, { bible });
    const marks = refs.map((r) => ({ s: r.start, e: r.end, type: 'ref', ref: r }));
    for (const c of changes) if (!refs.some((r) => c.start < r.end && c.end > r.start)) marks.push({ s: c.start, e: c.end, type: 'fix', c });
    marks.sort((a, b) => a.s - b.s);
    let html = '', pos = 0;
    for (const m of marks) {
      if (m.s < pos) continue;
      html += esc(text.slice(pos, m.s));
      if (m.type === 'ref') {
        const i = refRegistry.push(m.ref) - 1;
        html += `<button class="chip" data-i="${i}" title="${esc(m.ref.raw)}">${esc(m.ref.label)}</button>`;
      } else {
        html += `<span class="fix" title="原辨識：${esc(m.c.from)}">${esc(m.c.to)}</span>`;
      }
      pos = m.e;
    }
    html += esc(text.slice(pos));
    return { html, refs, text };
  }

  // ---------- rendering ----------
  const elT = $('transcript'), elI = $('interim');
  function nearBottom() { return elT.scrollHeight - elT.scrollTop - elT.clientHeight < 80; }
  function renderAll() {
    refRegistry = [];
    seenLabels = new Map();
    const stick = nearBottom();
    if (!segments.length) { elT.innerHTML = '<p class="empty" id="emptyHint">按下方「開始聆聽」，或用「貼上文字」測試。聽到經節（例如「約翰福音三章十六節」「羅8:28」）會自動標成可點選的經文提示。</p>'; }
    else {
      elT.innerHTML = segments.map((s) => {
        const a = annotate(s.raw);
        for (const r of a.refs) if (!seenLabels.has(r.label)) seenLabels.set(r.label, r);
        return `<div class="seg"><time>${fmtTime(s.t)}</time>${a.html}</div>`;
      }).join('');
      if (stick) elT.scrollTop = elT.scrollHeight;
    }
    renderStrip();
    renderInterim();
  }
  function renderInterim() {
    if (!interimText) { elI.innerHTML = ''; return; }
    const a = annotate(interimText);
    elI.innerHTML = a.html;
  }
  function renderStrip() {
    const strip = $('verseStrip');
    $('verseCount').textContent = String(seenLabels.size);
    if (!seenLabels.size) { strip.innerHTML = '<span class="muted small">尚未偵測到經節</span>'; return; }
    strip.innerHTML = [...seenLabels.values()].map((r) => { const i = refRegistry.push(r) - 1; return `<button class="chip" data-i="${i}">${esc(r.label)}</button>`; }).join('');
  }
  function appendSegment(raw) {
    raw = raw.trim();
    if (!raw) return;
    const seg = { id: Date.now() + Math.random(), t: Date.now(), raw };
    segments.push(seg);
    LS.set('segments', segments.slice(-500));
    const before = new Set(seenLabels.keys());
    const stick = nearBottom();
    const emptyEl = $('emptyHint'); if (emptyEl) emptyEl.remove();
    const a = annotate(raw);
    const div = document.createElement('div');
    div.className = 'seg';
    div.innerHTML = `<time>${fmtTime(seg.t)}</time>${a.html}`;
    elT.appendChild(div);
    const fresh = [];
    for (const r of a.refs) if (!seenLabels.has(r.label)) { seenLabels.set(r.label, r); fresh.push(r); }
    if (fresh.length) { renderStrip(); showToast(fresh[fresh.length - 1], fresh.length); }
    if (stick) elT.scrollTop = elT.scrollHeight;
  }

  // ---------- toast ----------
  let toastTimer = null;
  function showToast(ref, n) {
    const t = $('toast');
    t.innerHTML = `<span>📖 偵測到 <b>${esc(ref.label)}</b>${n > 1 ? `（另 ${n - 1} 處）` : ''}</span><button>看經文</button>`;
    t.hidden = false;
    t.querySelector('button').onclick = () => { t.hidden = true; openVerse(ref); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 7000);
  }

  // ---------- verse modal ----------
  let current = { ref: null, mode: 'ref' };
  function openVerse(ref, mode) {
    if (!bible) { toast2('經文還在載入，請稍候…'); return; }
    current = { ref, mode: mode || 'ref' };
    paintModal();
    $('modal').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function paintModal() {
    const { ref, mode } = current;
    const book = R.BOOKS[ref.bookId - 1];
    let title = ref.label, verses;
    const god = settings.god;
    if (mode === 'chapter') {
      verses = R.getPassage(bible, { bookId: ref.bookId, chapter: ref.chapter, endChapter: ref.chapter, segments: [], whole: true }, { god });
      const hit = new Set(R.getPassage(bible, ref, { god }).map((v) => v.c + ':' + v.v));
      verses.forEach((v) => (v.hit = ref.whole || hit.has(v.c + ':' + v.v)));
      title = `${book.name} ${ref.chapter}${ref.bookId === 19 ? '篇' : '章'}`;
    } else if (mode === 'ctx' && !ref.whole) {
      const bk = bible.b[ref.bookId - 1];
      const base = R.getPassage(bible, ref, { god });
      const first = base[0], last = base[base.length - 1];
      verses = [];
      const fix = (t) => (!t ? '（和合本此節從缺）' : settings.god === '上帝' ? t : t.split(bible.god).join('神'));
      // before
      let c = first.c, v = first.v;
      const pre = [];
      for (let k = 0; k < 3; k++) { v--; if (v < 1) { c--; if (c < 1) break; v = bk[c - 1].length; } pre.unshift({ c, v, text: fix(bk[c - 1][v - 1]), hit: false }); }
      verses.push(...pre, ...base);
      c = last.c; v = last.v;
      for (let k = 0; k < 3; k++) { v++; if (v > bk[c - 1].length) { c++; if (c > bk.length) break; v = 1; } verses.push({ c, v, text: fix(bk[c - 1][v - 1]), hit: false }); }
    } else {
      verses = R.getPassage(bible, ref, { god });
    }
    $('mTitle').textContent = title;
    $('mSub').textContent = `和合本（新標點）· ${god === '神' ? '神版' : '上帝版'}${ref.raw && mode === 'ref' ? ' · 聽到：「' + ref.raw + '」' : ''}`;
    let lastC = null, html = '';
    for (const v of verses) {
      if (verses[0].c !== verses[verses.length - 1].c && v.c !== lastC) { html += `<div class="chapter-sep">第 ${v.c} ${ref.bookId === 19 ? '篇' : '章'}</div>`; lastC = v.c; }
      html += `<span class="v ${v.hit ? 'hit' : 'ctx'}" ${v.hit && v === verses.find((x) => x.hit) ? 'id="firstHit"' : ''}><sup>${v.v}</sup>${esc(v.text)}</span>`;
    }
    const body = $('mBody');
    body.innerHTML = html;
    $('mCtx').hidden = ref.whole;
    $('mCtx').textContent = mode === 'ctx' ? '只看本段' : '前後文';
    $('mChapter').textContent = mode === 'chapter' ? '只看本段' : '整章';
    const fh = $('firstHit'); if (fh && mode !== 'ref') fh.scrollIntoView({ block: 'center' });
  }
  function closeModal() { $('modal').hidden = true; document.body.style.overflow = ''; }
  $('mClose').onclick = closeModal;
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
  $('mCtx').onclick = () => { current.mode = current.mode === 'ctx' ? 'ref' : 'ctx'; paintModal(); };
  $('mChapter').onclick = () => { current.mode = current.mode === 'chapter' ? 'ref' : 'chapter'; paintModal(); };
  $('mCopy').onclick = async () => {
    const txt = $('mTitle').textContent + '\n' + [...$('mBody').querySelectorAll('.v')].filter((e) => current.mode !== 'ctx' || e.classList.contains('hit')).map((e) => e.textContent).join('\n');
    try { await navigator.clipboard.writeText(txt); toast2('已複製'); } catch { toast2('無法複製，請長按選取'); }
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closeAll(); } });
  function closeAll() { for (const id of ['settings', 'moreMenu']) $(id).hidden = true; }
  function toast2(msg) {
    const t = $('toast'); t.innerHTML = `<span>${esc(msg)}</span>`; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }

  // chip clicks (delegated)
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip[data-i]');
    if (chip) { const ref = refRegistry[+chip.dataset.i]; if (ref) openVerse(ref); }
    if (e.target.matches('[data-close]')) closeAll();
    if (e.target.classList.contains('modal') && e.target.id !== 'modal') closeAll();
  });

  // ---------- lookup ----------
  $('lookupForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('lookupInput').value.trim();
    if (!q) return;
    if (!bible) return toast2('經文還在載入…');
    const ref = R.lookup(q, bible);
    if (!ref) return toast2('找不到這段經文，試試「約 3:16」或「創世記1章1節」');
    openVerse(ref);
  });

  // ---------- speech recognition ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const setStatus = (txt, on) => { $('statusText').textContent = txt; $('statusDot').classList.toggle('on', !!on); };
  function banner(msg, err) { const b = $('banner'); if (!msg) { b.hidden = true; return; } b.textContent = msg; b.className = 'banner' + (err ? ' err' : ''); b.hidden = false; }

  function buildRecognizer() {
    const r = new SR();
    r.lang = 'zh-TW'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    r.onstart = () => { active = true; lastStart = Date.now(); setStatus('聆聽中…', true); banner(''); };
    r.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const txt = res[0].transcript;
        if (res.isFinal) {
          let t = txt.trim();
          // Android Chrome sometimes re-sends the whole accumulated phrase: drop the already-committed prefix
          if (lastFinal.length >= 6 && t.startsWith(lastFinal)) t = t.slice(lastFinal.length).trim();
          lastFinal = txt.trim();
          if (t) appendSegment(t);
        } else interim += txt;
      }
      interimText = interim;
      renderInterim();
      if (nearBottom()) elT.scrollTop = elT.scrollHeight;
    };
    r.onerror = (ev) => {
      const e = ev.error;
      if (e === 'no-speech' || e === 'aborted') return;
      if (e === 'not-allowed' || e === 'service-not-allowed') { listening = false; banner('無法使用麥克風：請在瀏覽器網址列允許「麥克風」權限（需要 HTTPS 網址）。也可以先用「貼上文字」模式測試。', true); stop(true); }
      else if (e === 'audio-capture') { listening = false; banner('偵測不到麥克風，請檢查裝置。', true); stop(true); }
      else if (e === 'network') banner('語音辨識需要連線（瀏覽器會把聲音送到雲端辨識），目前網路有問題，會自動重試…', true);
      else banner('語音辨識錯誤：' + e, true);
    };
    r.onend = () => {
      active = false;
      interimText = ''; renderInterim();
      if (!listening) { setStatus('待機中', false); return; }
      // auto-restart; protect against tight crash loops
      quickEnds = Date.now() - lastStart < 1500 ? quickEnds + 1 : 0;
      if (quickEnds >= 6) { listening = false; stop(true); banner('語音辨識一直自動中斷，已停止。請再按一次「開始聆聽」。', true); return; }
      setStatus('重新連線…', true);
      clearTimeout(restartTimer);
      restartTimer = setTimeout(startRec, Math.min(250 + quickEnds * 400, 2500));
    };
    return r;
  }
  function startRec() {
    if (!listening || active) return;
    try { rec = buildRecognizer(); rec.start(); } catch (e) { restartTimer = setTimeout(startRec, 800); }
  }
  async function start() {
    if (!SR) { banner('這個瀏覽器不支援即時語音辨識。請改用 Chrome（Android／電腦）或 Safari（iOS 14.5 以上），不要用 LINE／Facebook 內建瀏覽器；或使用「貼上文字」測試。', true); $('pasteCard').hidden = false; return; }
    listening = true; quickEnds = 0; lastFinal = '';
    $('btnMic').setAttribute('aria-pressed', 'true'); $('micLabel').textContent = '停止聆聽';
    setStatus('準備中…', true);
    startRec();
    acquireWake();
  }
  function stop(silent) {
    listening = false;
    clearTimeout(restartTimer);
    try { rec && rec.stop(); } catch {}
    $('btnMic').setAttribute('aria-pressed', 'false'); $('micLabel').textContent = '開始聆聽';
    if (interimText) { appendSegment(interimText); interimText = ''; renderInterim(); }
    setStatus('待機中', false);
    releaseWake();
  }
  $('btnMic').onclick = () => (listening ? stop() : start());

  async function acquireWake() {
    if (!settings.keepAwake || !('wakeLock' in navigator)) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } catch {}
  }
  function releaseWake() { try { wakeLock && wakeLock.release(); } catch {} wakeLock = null; }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && listening) {
      acquireWake();
      if (!active) { clearTimeout(restartTimer); startRec(); }
    }
  });

  // ---------- paste mode ----------
  const SAMPLE = [
    '弟兄姐妹平安，今天我們一起來看約翰福音三章十六節，神愛世人，甚至將他的獨生子賜給他們。',
    '保羅在羅8:28-30告訴我們，萬事都互相效力，叫愛神的人得益處。',
    '還有創 1:1，起初神創造天地。以馬內力，耶和花與我們同在。',
    '請大家翻到詩篇23篇，耶和華是我的牧者；也看太 5章3節，虛心的人有福了，以及以弗所書二章八至九節。',
    '歌林多前書13章4節到7節講愛的真諦，哈里路亞，阿門。大約3:30我們會開始分組。',
  ].join('\n');
  $('btnPaste').onclick = () => { const c = $('pasteCard'); c.hidden = !c.hidden; $('btnPaste').setAttribute('aria-pressed', String(!c.hidden)); if (!c.hidden) c.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  $('btnSample').onclick = () => { $('pasteArea').value = SAMPLE; };
  $('btnPasteSend').onclick = () => {
    const t = $('pasteArea').value;
    if (!t.trim()) return;
    t.split(/\n+/).forEach(appendSegment);
    $('pasteArea').value = '';
  };

  // ---------- more menu ----------
  $('btnMore').onclick = () => { $('moreMenu').hidden = false; };
  const fullText = () => segments.map((s) => annotate(s.raw).text).join('\n');
  $('mCopyAll').onclick = async () => { try { await navigator.clipboard.writeText(fullText()); toast2('已複製逐字稿'); } catch { toast2('無法複製'); } closeAll(); };
  $('mDownload').onclick = () => {
    const blob = new Blob([fullText()], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `聽道-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`; a.click(); closeAll();
  };
  $('mClear').onclick = () => { if (confirm('確定清除目前逐字稿？')) { segments = []; LS.set('segments', []); renderAll(); } closeAll(); };

  // ---------- settings ----------
  function applyFont() { document.documentElement.style.setProperty('--fs', settings.font + 'px'); }
  $('btnSettings').onclick = () => {
    $('optGod').value = settings.god; $('optCorrect').checked = settings.correct; $('optKeepAwake').checked = settings.keepAwake;
    $('optFont').value = settings.font; $('dictArea').value = dictText; $('settings').hidden = false;
  };
  const saveSettings = () => { LS.set('settings', settings); applyFont(); renderAll(); };
  $('optGod').onchange = (e) => { settings.god = e.target.value; saveSettings(); };
  $('optCorrect').onchange = (e) => { settings.correct = e.target.checked; saveSettings(); };
  $('optKeepAwake').onchange = (e) => { settings.keepAwake = e.target.checked; saveSettings(); };
  $('optFont').oninput = (e) => { settings.font = +e.target.value; saveSettings(); };
  $('dictSave').onclick = () => { dictText = $('dictArea').value; LS.set('dict', dictText); rules = C.parse(dictText); renderAll(); toast2(`詞庫已儲存（${rules.length} 條規則）`); };
  $('dictReset').onclick = () => { dictText = C.DEFAULT_TEXT; $('dictArea').value = dictText; LS.set('dict', dictText); rules = C.parse(dictText); renderAll(); toast2('已還原預設詞庫'); };

  // ---------- boot ----------
  applyFont();
  renderAll();
  if (!SR) banner('這個瀏覽器不支援即時語音辨識（Web Speech API）。可使用 Chrome／Safari，或先用「貼上文字」模式測試。', false);
  fetch('data/cuv.json').then((r) => r.json()).then((j) => {
    bible = j; $('bibleStatus').textContent = '經文已載入（66 卷）'; renderAll();
  }).catch(() => { $('bibleStatus').textContent = '經文載入失敗'; banner('經文資料載入失敗，請重新整理。', true); });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__tingdao = { appendSegment, annotate, get bible() { return bible; }, openVerse };
})();
