/* 聽道 v2 — live transcription, Bible refs, related-verse hints, doctrinal cautions, summaries & archive */
(function () {
  'use strict';
  const R = window.TingdaoRefs, C = window.TingdaoCorrections, T = window.TingdaoThemes, V = window.TingdaoVerses,
    D = window.TingdaoDoctrine, PL = window.TingdaoPipeline, S = window.TingdaoSummary, A = window.TingdaoArchive, L = window.TingdaoLLM;
  const $ = (id) => document.getElementById(id);
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('tingdao.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('tingdao.' + k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem('tingdao.' + k); } catch {} },
  };

  // ---------- state ----------
  let bible = null, vidx = null;
  const settings = Object.assign({ god: '神', correct: true, s2t: true, keepAwake: true, font: 18, hints: true, warn: true }, LS.get('settings', {}));
  const llmCfg = Object.assign({ endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini', key: '', enabled: false, jsonMode: true }, LS.get('llm', {}));
  let dictText = LS.get('dict', C.DEFAULT_TEXT);
  let rules = C.parse(dictText);
  let dismissed = new Set(LS.get('dismissed', []));
  let session = A.newSession();       // current session (persisted to IndexedDB once it has content)
  let segments = [];                  // [{id,t,raw, a:runtime analysis}] mirrors session.segments
  let refRegistry = [];
  let listening = false, rec = null, wakeLock = null;
  let active = false, interimText = '', lastFinal = '', restartTimer = null, quickEnds = 0, lastStart = 0;
  let store = A.defaultStore();
  let uidN = 0;
  const nid = (p) => p + Date.now().toString(36) + (++uidN);

  // ---------- utils ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtTime = (t) => new Date(t).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const fixGod = (t) => (!t ? '' : settings.god === '上帝' ? t : t.split(bible.god).join('神'));
  const verseText = (b, c, v) => (bible ? fixGod(bible.b[b - 1][c - 1][v - 1]) : '');
  const verseLabel = (b, c, v) => R.formatLabel(R.BOOKS[b - 1], { bookId: b, chapter: c, endChapter: c, segments: [[v, v]], whole: false });
  function refFromVerse(b, c, v, raw) {
    return { bookId: b, chapter: c, endChapter: c, segments: [[v, v]], whole: false, raw: raw || '', book: R.BOOKS[b - 1].name, label: verseLabel(b, c, v) };
  }
  const slimRef = (r) => ({ bookId: r.bookId, chapter: r.chapter, endChapter: r.endChapter, segments: r.segments, whole: !!r.whole, label: r.label });
  const vchip = (label, raw) => `<button class="chip" data-l="${esc(label)}"${raw ? ` data-raw="${esc(raw)}"` : ''}>${esc(label)}</button>`;

  // ---------- analysis pipeline (offline) ----------
  function expandRefs(refs) {
    const out = [];
    for (const r of refs) {
      if (r.whole || !bible) continue;
      try { for (const v of R.getPassage(bible, r, { god: '上帝' }).slice(0, 12)) out.push([r.bookId, v.c, v.v]); } catch {}
    }
    return out;
  }
  const conf3 = (c) => D.confLabel(c);
  const dKey = (w) => w.ruleId + '|' + String(w.heard || '').slice(0, 24);

  function addHint(seg, item) {
    item.id = nid('h'); item.segId = seg.id; item.t = seg.t;
    session.hints.push(item);
    return item;
  }
  function addWarning(seg, w) {
    if (dismissed.has(dKey(w))) return null;
    w.id = nid('w'); w.segId = seg.id; w.t = seg.t;
    session.warnings.push(w);
    return w;
  }

  const pipe = PL.create({ R, C, T, V, D, Z: window.TingdaoZh, settings, getBible: () => bible, getIdx: () => vidx, getRules: () => rules, addHint, addWarning });

  /** Process one finalized segment (shared pipeline in pipeline.js). */
  function processSegment(seg) { return pipe.process(seg); }

  /** Rebuild all offline hints/warnings from the transcript (keeps AI-derived ones). */
  function rebuild() {
    const keepH = session.hints.filter((h) => h.src === 'llm'), keepW = session.warnings.filter((w) => w.src === 'llm');
    session.hints = []; session.warnings = [];
    pipe.reset();
    for (const s of segments) processSegment(s);
    session.hints.push(...keepH); session.warnings.push(...keepW);
  }

  // ---------- rendering ----------
  const reg = (ref) => refRegistry.push(ref) - 1;
  function annotateLite(raw) {
    let text = raw, changes = [];
    if (settings.correct) { const r = C.apply(raw, rules); text = r.text; changes = r.changes; }
    const refs = R.findRefs(text, { bible });
    return { text, changes, refs, marks: [] };
  }
  function renderText(a) {
    const marks = a.refs.map((r) => ({ s: r.start, e: r.end, type: 'ref', ref: r, pri: 0 }));
    for (const c of a.changes) marks.push({ s: c.start, e: c.end, type: 'fix', c, pri: 9 });
    for (const m of a.marks) marks.push(m);
    marks.sort((x, y) => x.s - y.s || x.pri - y.pri);
    let html = '', pos = 0;
    for (const m of marks) {
      if (m.s < pos) continue;
      html += esc(a.text.slice(pos, m.s));
      const seg = esc(a.text.slice(m.s, m.e));
      if (m.type === 'ref') html += `<button class="chip" data-i="${reg(m.ref)}" title="${esc(m.ref.raw)}">${esc(m.ref.label)}</button>`;
      else if (m.type === 'fix') html += `<span class="fix" title="原辨識：${esc(m.c.from)}">${seg}</span>`;
      else if (m.type === 'wm') html += `<mark class="wspan">${seg}</mark><button class="wchip" data-wid="${m.wid}" aria-label="查看提醒">⚠️</button>`;
      else if (m.type === 'qt') html += `<span class="qt" data-l="${esc(m.label)}" data-raw="${esc(m.heard)}" role="button" tabindex="0" title="像是 ${esc(m.label)}">${seg}<small>💡${esc(m.label)}</small></span>`;
      pos = m.e;
    }
    return html + esc(a.text.slice(pos));
  }
  const elT = $('transcript'), elI = $('interim');
  const EMPTY = '<p class="empty" id="emptyHint">按下方「開始聆聽」，或用「貼上文字」測試。聽到經節（例如「約翰福音三章十六節」「羅8:28」）會自動標成可點選的經文提示；引用經文沒說出處也會認得，說到相關主題會聯想經文，有疑慮的說法會提醒你對照聖經。</p>';
  function nearBottom() { return elT.scrollHeight - elT.scrollTop - elT.clientHeight < 80; }
  function segHtml(s) { return `<div class="seg"><time>${fmtTime(s.t)}</time>${renderText(s.a)}</div>`; }
  function renderAll() {
    refRegistry = [];
    const stick = nearBottom();
    if (!segments.length) elT.innerHTML = EMPTY;
    else { elT.innerHTML = segments.map(segHtml).join(''); if (stick) elT.scrollTop = elT.scrollHeight; }
    renderStrip(); renderHints(); renderWarnings(); renderInterim(); renderSessBar();
  }
  function renderInterim() {
    if (!interimText) { elI.innerHTML = ''; return; }
    elI.innerHTML = renderText(annotateLite(interimText));
  }
  function renderStrip() {
    const strip = $('verseStrip');
    $('verseCount').textContent = String(pipe.seenLabels.size);
    if (!pipe.seenLabels.size) { strip.innerHTML = '<span class="muted small">尚未偵測到經節</span>'; return; }
    strip.innerHTML = [...pipe.seenLabels.values()].map((r) => `<button class="chip" data-i="${reg(r)}">${esc(r.label)}</button>`).join('');
  }
  const KIND = { quote: '引用經文（沒說出處）', allusion: '可能呼應', theme: '相關主題', llm: 'AI 聯想' };
  function renderHints() {
    $('hintsCard').hidden = !settings.hints;
    const list = session.hints;
    $('hintCount').textContent = String(list.length);
    const el = $('hintList');
    if (!list.length) { el.innerHTML = '<span class="muted small">聽到引用、呼應或主題相近的經文時，會在這裡提示（離線運作，不需要金鑰）。</span>'; return; }
    el.innerHTML = list.slice(-30).reverse().map((h) => {
      const kind = h.kind === 'theme' ? `主題：${esc(h.theme)}` : KIND[h.kind] || '提示';
      const chips = (h.refs || []).map((r) => vchip(r.label, h.kind === 'theme' ? '' : h.heard)).join('');
      return `<div class="item hint ${esc(h.kind)}"><div class="item-top"><span class="tag2">${kind}</span><time>${fmtTime(h.t)}</time></div>` +
        `${h.kind === 'theme' ? '' : `<div class="heard">「${esc((h.heard || '').slice(0, 60))}」</div>`}` +
        `<div class="chips">${chips}</div>${h.src === 'llm' && h.why ? `<div class="why">${esc(h.why)}</div>` : ''}</div>`;
    }).join('');
  }
  const LV = (w) => (D.LEVELS[w.level] || D.LEVELS.caution);
  function renderWarnings() {
    $('warnCard').hidden = !settings.warn;
    const list = session.warnings;
    $('warnCount').textContent = String(list.length);
    const el = $('warnList');
    if (!list.length) { el.innerHTML = '<span class="muted small">沒有需要斟酌的說法。</span>'; return; }
    el.innerHTML = list.slice(-20).reverse().map((w) => {
      return `<div class="item warn lv-${esc(w.level)}"><button class="wtitle" data-wid="${w.id}"><span>${LV(w).icon} ${esc(w.title)}</span><span class="conf conf-${conf3(w.conf) === '高' ? 'h' : conf3(w.conf) === '中' ? 'm' : 'l'}">把握度 ${conf3(w.conf)}</span></button>` +
        `<div class="heard">「${esc((w.heard || '').slice(0, 70))}」</div>` +
        `<div class="why">${esc(String(w.why || '').slice(0, 90))}${(w.why || '').length > 90 ? '…' : ''}</div>` +
        `<div class="chips">${(w.verses || []).slice(0, 4).map((v) => vchip(v)).join('')}</div></div>`;
    }).join('');
  }
  function renderSessBar() {
    if (document.activeElement !== $('sessTitle')) $('sessTitle').value = session.title || '';
    if (document.activeElement !== $('sessSpeaker')) $('sessSpeaker').value = session.speaker || '';
    const n = segments.length;
    $('sessInfo').textContent = n ? `已自動存檔 · ${n} 段 · ${session.hints.length} 則聯想 · ${session.warnings.length} 則提醒` : '開始聆聽或貼上文字後會自動存檔到「紀錄」。';
  }

  function appendSegment(raw) {
    raw = String(raw || '').trim();
    if (!raw) return;
    const seg = { id: Date.now() + Math.random(), t: Date.now(), raw };
    segments.push(seg);
    const beforeRefs = new Set(pipe.seenLabels.keys());
    const a = processSegment(seg);
    const stick = nearBottom();
    const emptyEl = $('emptyHint'); if (emptyEl) emptyEl.remove();
    const div = document.createElement('div');
    div.className = 'seg';
    div.innerHTML = `<time>${fmtTime(seg.t)}</time>${renderText(a)}`;
    elT.appendChild(div);
    const fresh = [...pipe.seenLabels.values()].filter((r) => !beforeRefs.has(r.label));
    renderStrip(); renderHints(); renderWarnings(); renderSessBar();
    if (a.newWarnings.length) showWarnToast(a.newWarnings[0], a.newWarnings.length);
    else if (fresh.length) showToast(fresh[fresh.length - 1], fresh.length);
    else if (a.newHints.length && a.newHints[0].kind !== 'theme') showHintToast(a.newHints[0]);
    if (stick) elT.scrollTop = elT.scrollHeight;
    scheduleSave();
    feedLLM(seg, a.text);
  }

  // ---------- toast ----------
  let toastTimer = null;
  function toastHtml(html, btnLabel, onclick, ms) {
    const t = $('toast');
    t.innerHTML = `<span>${html}</span>${btnLabel ? `<button>${esc(btnLabel)}</button>` : ''}`;
    t.hidden = false;
    if (btnLabel) t.querySelector('button').onclick = () => { t.hidden = true; onclick(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms || 7000);
  }
  function showToast(ref, n) { toastHtml(`📖 偵測到 <b>${esc(ref.label)}</b>${n > 1 ? `（另 ${n - 1} 處）` : ''}`, '看經文', () => openVerse(ref)); }
  function showHintToast(h) { toastHtml(`💡 這段像是 <b>${esc(h.label)}</b>`, '看經文', () => openLabel(h.label, h.heard), 6000); }
  function showWarnToast(w, n) { toastHtml(`⚠️ <b>${esc(w.title)}</b>${n > 1 ? `（另 ${n - 1} 則）` : ''}`, '看原因', () => openWarning(w.id), 9000); }


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
  function closeAll() { for (const id of ['settings', 'moreMenu', 'wModal', 'sumModal', 'detail']) $(id).hidden = true; detailS = null; }
  function toast2(msg) {
    const t = $('toast'); t.innerHTML = `<span>${esc(msg)}</span>`; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }


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
    flushLLM(true); saveNow();
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


  // ---------- delegated clicks ----------
  document.addEventListener('click', (e) => {
    const t = e.target;
    const chip = t.closest('.chip[data-i]');
    if (chip) { const ref = refRegistry[+chip.dataset.i]; if (ref) openVerse(ref); return; }
    const wc = t.closest('[data-wid]');
    if (wc) { openWarning(wc.dataset.wid); return; }
    const lc = t.closest('[data-l]');
    if (lc) { openLabel(lc.dataset.l, lc.dataset.raw); return; }
    if (t.matches('[data-close]')) { const m = t.closest('.modal'); if (m) m.hidden = true; return; }
    if (t.classList.contains('modal') && t.id !== 'modal') t.hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('qt')) { e.preventDefault(); openLabel(e.target.dataset.l, e.target.dataset.raw); }
  });
  function openLabel(label, heard) {
    if (!bible) return toast2('經文還在載入…');
    const ref = R.lookup(label, bible);
    if (!ref) return toast2('找不到這段經文：' + label);
    openVerse(Object.assign({}, ref, { raw: heard || '' }));
  }

  // ---------- warning sheet ----------
  let detailS = null, curW = null;
  const SRC = { rule: '離線規則比對', quote: '經文比對（離線）', llm: 'AI 分析（你的 API）' };
  function findWarning(id) { return session.warnings.find((w) => w.id === id) || (detailS && detailS.warnings.find((w) => w.id === id)) || null; }
  function openWarning(id) {
    const w = findWarning(id); if (!w) return;
    curW = w;
    $('wTitle').textContent = `${LV(w).icon} ${w.title}`;
    $('wSub').textContent = `${LV(w).label} · 把握度 ${conf3(w.conf)}（${Math.round(w.conf * 100)}%）`;
    let h = '';
    if (w.heard) h += `<blockquote>聽到：「${esc(w.heard)}」</blockquote>`;
    h += `<h4>為什麼需要留意</h4><p>${esc(w.why)}</p>`;
    if (w.diffs && w.diffs.length) h += '<ul class="diffs">' + w.diffs.slice(0, 4).map((d) => `<li>${d.from ? `聽到 <del>${esc(d.from)}</del>` : '少了'}${d.to ? ` → 經文 <ins>${esc(d.to)}</ins>` : ''}</li>`).join('') + '</ul>';
    if (w.verses && w.verses.length) h += `<h4>對照經文（點開閱讀）</h4><div class="chips">${w.verses.map((v) => vchip(v)).join('')}</div>`;
    if (w.correct) h += `<h4>${w.src === 'quote' ? '經文原文' : '較符合聖經的說法'}</h4><p>${esc(w.correct)}</p>`;
    h += `<p class="muted tiny">來源：${SRC[w.src] || '離線規則'}。${w.level === 'debated' ? '這是基督徒之間有不同看法的議題，不一定是錯誤。' : ''}提示僅供參考，可能誤判（例如語音辨識錯字、講員意譯或正在糾正別人的說法）；請以聖經與牧者教導為準。</p>`;
    $('wBody').innerHTML = h;
    $('wDismiss').hidden = !!detailS && !session.warnings.includes(w);
    $('wModal').hidden = false;
  }
  $('wDismiss').onclick = () => {
    if (!curW) return;
    dismissed.add(dKey(curW)); LS.set('dismissed', [...dismissed].slice(-300));
    session.warnings = session.warnings.filter((x) => x !== curW);
    $('wModal').hidden = true; rebuild(); renderAll(); scheduleSave(); toast2('已忽略這類提示');
  };
  $('wCopy').onclick = async () => {
    if (!curW) return;
    const txt = `${curW.title}\n聽到：${curW.heard}\n${curW.why}\n對照：${(curW.verses || []).join('、')}\n${curW.correct || ''}`;
    try { await navigator.clipboard.writeText(txt); toast2('已複製'); } catch { toast2('無法複製'); }
  };

  // ---------- session persistence ----------
  let saveTimer = null;
  function quoteRefs() {
    const out = [];
    for (const s of segments) if (s.a) for (const m of s.a.marks) if (m.type === 'qt' && m.label) { const r = bible && R.lookup(m.label, bible); if (r) out.push(slimRef(r)); }
    for (const h of session.hints) if (h.kind === 'quote') for (const r of h.refs || []) out.push(r);
    return out;
  }
  function snapshot() {
    session.segments = segments.map((s) => ({ id: s.id, t: s.t, raw: s.raw }));
    session.transcript = segments.map((s) => (s.a ? s.a.text : s.raw)).join('\n');
    const seen = new Map();
    for (const r of [...pipe.seenLabels.values(), ...quoteRefs()]) if (!seen.has(r.label)) seen.set(r.label, slimRef(r));
    session.refs = [...seen.values()];
    if (segments.length) session.date = segments[0].t;
    session.updated = Date.now();
    return session;
  }
  const sanitizeForSave = () => {
    const s = JSON.parse(JSON.stringify(snapshot()));
    s.hints = s.hints.map((h) => ({ id: h.id, segId: h.segId, t: h.t, kind: h.kind, theme: h.theme, label: h.label, heard: h.heard, why: h.why, refs: h.refs, src: h.src }));
    s.warnings = s.warnings.map((w) => ({ id: w.id, segId: w.segId, t: w.t, ruleId: w.ruleId, level: w.level, title: w.title, heard: w.heard, why: w.why, verses: w.verses, correct: w.correct, conf: w.conf, src: w.src, diffs: w.diffs }));
    return s;
  };
  async function saveNow() {
    clearTimeout(saveTimer);
    if (!segments.length) return;
    try { await store.put(sanitizeForSave()); LS.set('current', session.id); } catch (e) { fallbackStore('儲存失敗：' + (e && e.message || e)); }
  }
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 700); }
  function fallbackStore(why) {
    if (store.kind === 'memory') return;
    store = A.memoryStore();
    banner('這個瀏覽器無法使用本機儲存（' + why + '）。紀錄只會暫存在本頁，關閉後消失；請用「匯出」備份。', true);
  }
  function resetRuntime() { segments = []; pipe.reset(); llmBuf = ''; llmPrev = ''; refRegistry = []; }
  async function newSessionNow() {
    if (listening) stop();
    await flushLLM(true); await saveNow();
    session = A.newSession(); resetRuntime(); LS.del('current'); renderAll(); toast2('已開始新的講道');
  }
  function loadSession(s) {
    if (listening) stop();
    session = JSON.parse(JSON.stringify(s)); session.hints = (session.hints || []).filter((h) => h.src === 'llm'); session.warnings = (session.warnings || []).filter((w) => w.src === 'llm');
    resetRuntime();
    segments = (s.segments || []).map((x) => ({ id: x.id, t: x.t, raw: x.raw }));
    rebuild(); renderAll(); LS.set('current', session.id);
  }
  $('sessTitle').addEventListener('input', (e) => { session.title = e.target.value; scheduleSave(); });
  $('sessSpeaker').addEventListener('input', (e) => { session.speaker = e.target.value; scheduleSave(); });
  $('btnNewSess').onclick = () => { if (!segments.length) return toast2('目前是空的新講道'); newSessionNow(); };
  $('btnFinish').onclick = () => finishSession();

  // ---------- summary ----------
  function buildSummary() {
    const full = segments.map((s) => (s.a ? s.a.text : s.raw)).join('\n');
    let th = T.scoreThemes(full, { min: 4 }).slice(0, 3);
    if (!th.length) th = T.scoreThemes(full, { min: 2 }).slice(0, 2);
    snapshot();
    return S.summarize(segments.map((s) => (s.a ? s.a.text : s.raw)), { refs: session.refs.map((r) => r.label).slice(0, 14), themes: th.map((x) => x.theme.name) });
  }
  const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
  function summaryHtml(s) {
    const sm = s.summary; let h = '';
    if (s.llmSummary && s.llmSummary.text) h += `<h4>🤖 AI 摘要 <span class="muted tiny">${esc(s.llmSummary.model || '')}</span></h4><div class="llm-sum">${md(s.llmSummary.text)}</div>`;
    if (sm) {
      if (sm.points && sm.points.length) h += `<h4>重點（自動摘錄）</h4><ol class="pts">${sm.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>`;
      else h += '<p class="muted">內容太少，無法摘要。</p>';
      if (sm.themes && sm.themes.length) h += `<h4>主題</h4><p>${sm.themes.map((t) => `<span class="tag2">${esc(t)}</span>`).join(' ')}</p>`;
    }
    if (s.refs && s.refs.length) h += `<h4>提到的經文</h4><div class="chips">${s.refs.map((r) => vchip(r.label)).join('')}</div>`;
    if (s.warnings && s.warnings.length) h += `<h4>需要斟酌的說法（${s.warnings.length}）</h4><div class="chips">${s.warnings.map((w) => `<button class="wtitle sm" data-wid="${w.id}">${LV(w).icon} ${esc(w.title)}</button>`).join('')}</div>`;
    return h;
  }
  async function finishSession() {
    if (!segments.length) return toast2('還沒有逐字稿可以整理');
    if (listening) stop();
    await flushLLM(true);
    session.summary = buildSummary();
    if (!session.title) { session.title = session.summary.title; }
    renderSessBar(); await saveNow();
    openSummary();
  }
  function openSummary() {
    if (!segments.length) return toast2('還沒有逐字稿可以整理');
    if (!session.summary) session.summary = buildSummary();
    $('sumTitle').textContent = session.title || session.summary.title || '本篇摘要';
    $('sumSub').textContent = `${A.localDateTime(session.date)}${session.speaker ? ' · ' + session.speaker : ''} · 已存入紀錄`;
    $('sumBody').innerHTML = summaryHtml(session);
    $('sumAI').hidden = !llmReady();
    $('sumModal').hidden = false;
  }
  $('mSummary').onclick = () => { closeAll(); if (!segments.length) return toast2('還沒有逐字稿'); session.summary = buildSummary(); scheduleSave(); openSummary(); };
  $('sumMd').onclick = () => { snapshot(); download(`${safeName(session.title || '講道')}.md`, A.toMarkdown(session), 'text/markdown'); };
  $('sumArchive').onclick = () => { $('sumModal').hidden = true; openArchive(); };
  $('sumAI').onclick = async () => {
    const b = $('sumAI'); b.disabled = true; b.textContent = '🤖 整理中…';
    try {
      snapshot();
      session.llmSummary = await L.summarizeSession(llmCfg, session.transcript, { refs: session.refs.map((r) => r.label) });
      if (session.llmSummary.title && !session.title) session.title = session.llmSummary.title;
      await saveNow(); $('sumBody').innerHTML = summaryHtml(session); renderSessBar();
    } catch (e) { toast2('AI 摘要失敗：' + e.message); }
    b.disabled = false; b.textContent = '🤖 AI 摘要';
  };

  // ---------- downloads ----------
  const safeName = (s) => String(s).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || '講道';
  function download(name, text, mime) {
    const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---------- archive ----------
  let arcAll = [];
  const filt = () => ({ q: $('fQ').value, verse: $('fVerse').value, book: $('fBook').value, from: $('fFrom').value, to: $('fTo').value });
  async function openArchive() {
    await flushLLM(false); await saveNow();
    $('archive').hidden = false; document.body.style.overflow = 'hidden';
    await refreshArchive();
  }
  function closeArchive() { $('archive').hidden = true; $('arcMore').hidden = true; document.body.style.overflow = ''; }
  async function refreshArchive() {
    try { arcAll = await store.all(); } catch (e) { arcAll = []; toast2('讀取紀錄失敗'); }
    const f = filt();
    const hasF = Object.values(f).some((x) => x && x.trim());
    let res; let verseBad = false;
    if (f.verse.trim() && !R.lookup(f.verse.trim(), null)) { res = []; verseBad = true; } else res = A.search(arcAll, f);
    $('arcCount').textContent = hasF ? `${res.length} / ${arcAll.length} 篇` : `${arcAll.length} 篇`;
    const el = $('arcList');
    if (!res.length) { el.innerHTML = `<p class="empty card">${arcAll.length ? (verseBad ? '看不懂這個經節格式，試試「約 3:16」或「羅馬書 8 章」。' : '沒有符合條件的講道。') : '還沒有紀錄。開始聆聽或貼上文字後，講道會自動存到這裡。'}</p>`; return; }
    el.innerHTML = res.map((s) => {
      const refs = (s.refs || []).slice(0, 4).map((r) => esc(r.label)).join('、');
      return `<button class="arc-item" data-sid="${esc(s.id)}"><div class="at">${esc(s.title || '未命名講道')}</div>` +
        `<div class="am">${A.localDateTime(s.date)}${s.speaker ? ' · ' + esc(s.speaker) : ''} · ${(s.transcript || '').length} 字${(s.warnings || []).length ? ` · ⚠️${s.warnings.length}` : ''}</div>` +
        `${refs ? `<div class="ar">📖 ${refs}${(s.refs || []).length > 4 ? '…' : ''}</div>` : ''}` +
        `<div class="as">${esc(A.snippet(s, f.q, 70))}</div></button>`;
    }).join('');
  }
  $('btnArchive').onclick = openArchive;
  $('arcBack').onclick = closeArchive;
  for (const id of ['fQ', 'fVerse', 'fBook', 'fFrom', 'fTo']) $(id).addEventListener('input', refreshArchive);
  $('fClear').onclick = () => { for (const id of ['fQ', 'fVerse', 'fBook', 'fFrom', 'fTo']) $(id).value = ''; refreshArchive(); };
  $('arcMenu').onclick = () => { $('arcMore').hidden = !$('arcMore').hidden; };
  $('arcList').addEventListener('click', (e) => { const b = e.target.closest('[data-sid]'); if (b) openDetail(b.dataset.sid); });
  function openDetail(id) {
    const s = arcAll.find((x) => x.id === id); if (!s) return;
    detailS = s;
    $('dTitle').textContent = s.title || '未命名講道';
    $('dSub').textContent = `${A.localDateTime(s.date)}${s.speaker ? ' · ' + s.speaker : ''}`;
    let h = summaryHtml(s);
    if (s.hints && s.hints.length) h += `<h4>相關經文提示（${s.hints.length}）</h4><div class="chips">${[...new Set(s.hints.flatMap((x) => (x.refs || []).map((r) => r.label)))].slice(0, 20).map((l) => vchip(l)).join('')}</div>`;
    h += `<h4>逐字稿</h4><details><summary>展開（${(s.transcript || '').length} 字）</summary><div class="transcript-pre">${esc(s.transcript || '')}</div></details>`;
    $('dBody').innerHTML = h;
    $('detail').hidden = false;
  }
  $('detail').addEventListener('click', (e) => { if (e.target.id === 'detail' || e.target.matches('[data-close]')) detailS = null; });
  $('dMd').onclick = () => { if (detailS) download(`${safeName(detailS.title || '講道')}.md`, A.toMarkdown(detailS), 'text/markdown'); };
  $('dJson').onclick = () => { if (detailS) download(`${safeName(detailS.title || '講道')}.json`, A.exportJSON([detailS]), 'application/json'); };
  $('dOpen').onclick = () => { if (!detailS) return; loadSession(detailS); $('detail').hidden = true; detailS = null; closeArchive(); toast2('已載入，可繼續聆聽或編輯'); };
  $('dDel').onclick = async () => {
    if (!detailS || !confirm(`確定刪除「${detailS.title || '未命名講道'}」？此動作無法復原（建議先匯出備份）。`)) return;
    const id = detailS.id;
    await store.del(id);
    if (session.id === id) { session = A.newSession(); resetRuntime(); LS.del('current'); renderAll(); }
    detailS = null; $('detail').hidden = true; refreshArchive();
  };
  $('arcExpJson').onclick = () => { download(`聽道備份-${A.localDate(Date.now())}.json`, A.exportJSON(arcAll), 'application/json'); };
  $('arcExpMd').onclick = () => { download(`聽道講道集-${A.localDate(Date.now())}.md`, arcAll.map((s) => A.toMarkdown(s)).join('\n\n\n'), 'text/markdown'); };
  $('arcImport').onclick = () => $('arcFile').click();
  $('arcFile').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const { sessions, skipped } = A.parseImport(await f.text());
      const cur = await store.all();
      const m = A.merge(cur, sessions);
      const curMap = new Map(cur.map((s) => [s.id, s]));
      for (const s of m.merged) { const c = curMap.get(s.id); if (!c || s !== c) await store.put(s); }
      toast2(`匯入完成：新增 ${m.added}、更新 ${m.updated}、略過 ${m.kept + skipped}`);
      refreshArchive();
    } catch (err) { toast2('匯入失敗：' + err.message); }
    $('arcMore').hidden = true;
  };

  // ---------- AI layer (optional) ----------
  const llmReady = () => !!(llmCfg.enabled && llmCfg.key && llmCfg.endpoint && llmCfg.model);
  let llmBuf = '', llmBusy = false, llmPrev = '', llmBackoff = 0, llmLastSeg = null, llmErrAt = 0;
  function feedLLM(seg, text) {
    if (!llmReady()) return;
    llmBuf += text + '\n'; llmLastSeg = seg;
    if (llmBuf.length >= 220) flushLLM(false);
  }
  async function flushLLM(force) {
    if (!llmReady()) return;
    if (llmBusy) { if (!force) return; for (let i = 0; i < 100 && llmBusy; i++) await new Promise((r) => setTimeout(r, 200)); }
    if (llmBusy || Date.now() < llmBackoff) return;
    if (llmBuf.length < (force ? 30 : 200)) return;
    const chunk = llmBuf; llmBuf = ''; llmBusy = true; renderSessBar();
    try {
      const res = await L.analyzeChunk(llmCfg, chunk, { prev: llmPrev }, bible);
      llmPrev = chunk.slice(-150);
      const seg = llmLastSeg || { id: 0, t: Date.now() };
      let firstW = null, nW = 0;
      for (const h of res.hints) {
        if (session.hints.some((x) => x.label === h.label)) continue;
        session.hints.push({ id: nid('h'), segId: seg.id, t: Date.now(), kind: 'llm', src: 'llm', label: h.label, heard: '', refs: [slimRef(h.ref)], why: h.why });
      }
      for (const w of res.warnings) {
        if (session.warnings.some((x) => x.title === w.title) || dismissed.has(dKey(w))) continue;
        delete w.refObjs; w.id = nid('w'); w.segId = seg.id; w.t = Date.now();
        session.warnings.push(w); nW++; firstW = firstW || w;
      }
      renderHints(); renderWarnings(); scheduleSave();
      if (firstW) showWarnToast(firstW, nW);
    } catch (e) {
      llmBackoff = Date.now() + 30000;
      if (Date.now() - llmErrAt > 20000) { llmErrAt = Date.now(); toast2('AI 分析暫停（30 秒後重試）：' + e.message); }
    } finally { llmBusy = false; renderSessBar(); if (llmBuf.length >= 220) flushLLM(false); }
  }
  const CORS_TXT = { ok: '✅ 已實測：可從瀏覽器直接呼叫', opaque: '⚠️ 可呼叫，但金鑰錯誤時瀏覽器只會顯示「無法連線」', local: '🏠 本機服務，需允許本頁來源', unknown: '❔ 未知，請按「測試連線」' };
  function presetNote() {
    const p = L.presetFor($('llmEndpoint').value) || L.presetById($('llmPreset').value);
    $('llmPresetNote').textContent = p ? [CORS_TXT[p.cors], p.note, p.keyUrl ? '取得 Key：' + p.keyUrl : ''].filter(Boolean).join('　') : '';
  }
  (function initPresets() {
    const sel = $('llmPreset'); sel.innerHTML = '<option value="">（請選擇）</option>' + L.PRESETS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
    sel.onchange = () => { const p = L.presetById(sel.value); if (p && p.id !== 'custom') { $('llmEndpoint').value = p.endpoint; $('llmModel').value = p.model; } presetNote(); };
    $('llmEndpoint').oninput = () => { const p = L.presetFor($('llmEndpoint').value); sel.value = p ? p.id : (sel.value === 'custom' ? 'custom' : ''); presetNote(); };
  })();
  function fillLLMForm() {
    $('llmOn').checked = llmCfg.enabled; $('llmEndpoint').value = llmCfg.endpoint; $('llmModel').value = llmCfg.model; $('llmKey').value = llmCfg.key; $('llmJson').checked = llmCfg.jsonMode;
    { const p = L.presetFor(llmCfg.endpoint); $('llmPreset').value = p ? p.id : (llmCfg.endpoint ? 'custom' : ''); presetNote(); }
    $('llmMsg').textContent = llmReady() ? '已啟用。' : (llmCfg.key ? '已儲存，但尚未啟用。' : '尚未設定 Key（離線功能不受影響）。');
  }
  function readLLMForm() {
    llmCfg.enabled = $('llmOn').checked; llmCfg.endpoint = $('llmEndpoint').value.trim(); llmCfg.model = $('llmModel').value.trim(); llmCfg.key = $('llmKey').value.trim(); llmCfg.jsonMode = $('llmJson').checked;
  }
  $('llmSave').onclick = () => { readLLMForm(); LS.set('llm', llmCfg); fillLLMForm(); toast2(llmReady() ? 'AI 分析已啟用' : '已儲存'); };
  $('llmTest').onclick = async () => {
    readLLMForm(); $('llmMsg').textContent = '測試中…';
    try { const r = await L.callChat(llmCfg, [{ role: 'user', content: '請只回覆「OK」兩個字。' }], { json: false, timeoutMs: 20000 }); $('llmMsg').textContent = '✅ 連線成功：' + r.trim().slice(0, 30); }
    catch (e) { $('llmMsg').textContent = '❌ ' + e.message; }
  };
  $('llmClear').onclick = () => { llmCfg.key = ''; llmCfg.enabled = false; LS.set('llm', llmCfg); fillLLMForm(); toast2('已清除 API Key'); };


  // ---------- paste mode ----------
  const SAMPLE = [
    '弟兄姐妹平安，今天我們一起來看約翰福音三章十六節，神愛世人，甚至將他的獨生子賜給他們。',
    '保羅在羅8:28-30告訴我們，萬事都互相效力，叫愛神的人得益處。',
    '還有創 1:1，起初神創造天地。以馬內力，耶和花與我們同在。',
    '請大家翻到詩篇23篇，耶和華是我的牧者；也看太 5章3節，虛心的人有福了，以及以弗所書二章八至九節。',
    '歌林多前書13章4節到7節講愛的真諦，哈里路亞，阿門。大約3:30我們會開始分組。',
    '剛才我們讀到的，耶穌說凡勞苦擔重擔的人可以到我這裡來，我就使你們得安息，這是主給我們的邀請。',
    '經上說，神愛世人，甚至將他的獨生子賜給他們，叫一切信他的人必得永生。',
    '有時候我們憂慮到睡不著，要記得不要為明天憂慮，把一切的重擔卸給神，因為祂顧念我們。',
    '很多人常說，天助自助者，這就是聖經教導我們的。',
    '我也要提醒大家，聖經說金錢是萬惡之根，所以我們要遠離錢。',
    '放心，神不會給你承受不了的，所以你一定撐得過去。',
    '只要多做善事就能進天堂，這是最簡單的道理。',
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
  const fullText = () => segments.map((s) => (s.a ? s.a.text : s.raw)).join('\n');
  $('mCopyAll').onclick = async () => { try { await navigator.clipboard.writeText(fullText()); toast2('已複製逐字稿'); } catch { toast2('無法複製'); } closeAll(); };
  $('mDownload').onclick = () => { download(`聽道-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`, fullText()); closeAll(); };
  $('mClear').onclick = async () => {
    if (confirm('確定清除目前這篇的逐字稿？（已存入「紀錄」的版本也會刪除）')) {
      try { await store.del(session.id); } catch {}
      session = A.newSession(); resetRuntime(); LS.del('current'); renderAll();
    }
    closeAll();
  };

  // ---------- settings ----------
  function applyFont() { document.documentElement.style.setProperty('--fs', settings.font + 'px'); }
  $('btnSettings').onclick = () => {
    $('optGod').value = settings.god; $('optCorrect').checked = settings.correct; $('optS2t').checked = settings.s2t !== false; $('optKeepAwake').checked = settings.keepAwake;
    $('optHints').checked = settings.hints; $('optWarn').checked = settings.warn;
    $('optFont').value = settings.font; $('dictArea').value = dictText; fillLLMForm(); $('settings').hidden = false;
  };
  const saveSettings = (re) => { LS.set('settings', settings); applyFont(); if (re) rebuild(); renderAll(); };
  $('optGod').onchange = (e) => { settings.god = e.target.value; saveSettings(); };
  $('optCorrect').onchange = (e) => { settings.correct = e.target.checked; saveSettings(true); };
  $('optS2t').onchange = (e) => { settings.s2t = e.target.checked; saveSettings(true); };
  $('optHints').onchange = (e) => { settings.hints = e.target.checked; saveSettings(true); };
  $('optWarn').onchange = (e) => { settings.warn = e.target.checked; saveSettings(true); };
  $('optKeepAwake').onchange = (e) => { settings.keepAwake = e.target.checked; saveSettings(); };
  $('optFont').oninput = (e) => { settings.font = +e.target.value; saveSettings(); };
  $('dictSave').onclick = () => { dictText = $('dictArea').value; LS.set('dict', dictText); rules = C.parse(dictText); rebuild(); renderAll(); toast2(`詞庫已儲存（${rules.length} 條規則）`); };
  $('dictReset').onclick = () => { dictText = C.DEFAULT_TEXT; $('dictArea').value = dictText; LS.set('dict', dictText); rules = C.parse(dictText); rebuild(); renderAll(); toast2('已還原預設詞庫'); };

  // ---------- boot ----------
  async function restore() {
    let s = null;
    const id = LS.get('current', null);
    try { if (id) s = await store.get(id); } catch (e) { fallbackStore(e && e.message || 'IndexedDB'); }
    if (!s) {
      const old = LS.get('segments', []);
      if (old && old.length) { s = A.newSession(old[0].t); s.segments = old.map((x) => ({ id: x.id, t: x.t, raw: x.raw })); LS.del('segments'); }
    }
    if (s && s.segments && s.segments.length) loadSession(s);
  }
  applyFont();
  renderAll();
  if (!SR) banner('這個瀏覽器不支援即時語音辨識（Web Speech API）。可使用 Chrome／Safari，或先用「貼上文字」模式測試。', false);
  (async () => {
    try {
      bible = await (await fetch('data/cuv.json')).json();
      $('bibleStatus').textContent = '經文已載入（66 卷），建立聯想索引…';
      await new Promise((r) => setTimeout(r, 30));
      vidx = V.buildIndex(bible);
      $('bibleStatus').textContent = '經文已載入（66 卷）· 離線聯想索引就緒';
    } catch (e) { $('bibleStatus').textContent = '經文載入失敗'; banner('經文資料載入失敗，請重新整理。', true); return; }
    await restore();
    if (segments.length) { rebuild(); }
    else if (session.segments.length === 0 && segments.length === 0) { /* nothing */ }
    renderAll();
    window.__tingdaoReady = true;
  })();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__tingdao = {
    appendSegment, annotate: annotateLite, get bible() { return bible; }, openVerse, openLabel, finishSession, newSessionNow, openArchive, saveNow,
    get session() { return session; }, get hints() { return session.hints; }, get warnings() { return session.warnings; }, get store() { return store; },
    settings, llmCfg, flushLLM, get ready() { return !!window.__tingdaoReady; },
  };
})();
