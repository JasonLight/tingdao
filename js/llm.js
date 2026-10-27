/* 聽道 — optional LLM layer (UMD). OpenAI-compatible /chat/completions, user's own key, called straight from the browser. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./refs.js'));
  else root.TingdaoLLM = factory(root.TingdaoRefs);
})(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  const SYSTEM = `你是「聽道」的輔助分析員，協助聽道者在聆聽講道時，快速找到相關經文，並提醒「可能需要再對照聖經」的說法。
立場與原則：
1. 以歷代基督教共同信仰（使徒信經、尼西亞信經）與主流基督新教（福音派／改革宗／信義宗等共同認可的立場）為基準，使用和合本經文章節。
2. 對講員抱持善意與寬容：先假設講員的意思是正確的，把可能的意譯、舉例、比喻、修辭、聽寫錯誤（語音辨識常有同音字錯誤）納入考慮。只有在明顯與聖經教導衝突、明顯誤引經文、或把非聖經的話說成聖經時才提出警示。
3. 區分「錯誤」與「基督徒之間有不同看法的次要議題」（例如洗禮方式、末世論細節、恩賜停止論、預定與自由意志、聖餐觀等）。後者請標為 level="debated"，只說明各方看法，不要說成錯誤。
4. 每一則提示或警示都必須引用具體經文（書卷 章:節，用和合本簡稱，如「約 3:16」「羅 8:28-30」），不可捏造經文；不確定就不要列。
5. 為每則警示給出 confidence（0 到 1）。低於 0.5 的就不要輸出。寧可少報，不要多報。
6. 不要評論講員的人格、動機或所屬宗派；只談「這句話」與聖經的關係。
7. 只輸出 JSON，不要任何額外說明或 Markdown 圍欄。`;

  function analyzePrompt(chunk, ctx) {
    ctx = ctx || {};
    return `請分析下面這段講道逐字稿（語音辨識產生，可能有錯字、沒有標點）。${ctx.prev ? '\n【前文（僅供語境，不必分析）】\n' + ctx.prev : ''}
【要分析的段落】
${chunk}

請輸出 JSON，格式：
{
 "hints": [ {"ref": "約 3:16", "why": "講員這句話與此節呼應（一句話）"} ],
 "warnings": [ {
   "claim": "講員原話（簡短引用）",
   "problem": "問題的簡短標題（10-20字）",
   "why": "為什麼需要再對照聖經（2-4句，客觀、不攻擊）",
   "refs": ["羅 3:28", "弗 2:8-9"],
   "correct": "較符合聖經的說法（1-2句）",
   "level": "error | caution | debated",
   "confidence": 0.0
 } ]
}
hints 最多 3 則，warnings 最多 2 則；沒有就輸出空陣列。`;
  }

  function summaryPrompt(transcript, meta) {
    meta = meta || {};
    return `請為下面這篇講道整理摘要（逐字稿來自語音辨識，可能有同音錯字，請合理推斷）。${meta.refs && meta.refs.length ? '\n講員提到的經文：' + meta.refs.join('、') : ''}
【逐字稿】
${transcript}

請用繁體中文，輸出 JSON：
{
 "title": "20字內的標題",
 "main": "一句話主旨",
 "points": ["3-6 個重點，每點一句"],
 "verses": ["講道中重要的經文，如 約 3:16"],
 "themes": ["2-4 個主題詞"],
 "application": ["1-3 個生活應用（若講道有提到）"],
 "cautions": ["如有需要對照聖經再確認的說法，簡述並附經文；沒有就空陣列"]
}`;
  }

  function endpointUrl(base) {
    base = (base || '').trim().replace(/\/+$/, '');
    if (!base) return '';
    if (/\/chat\/completions$/.test(base)) return base;
    return base + '/chat/completions';
  }

  async function callChat(cfg, messages, opts) {
    opts = opts || {};
    const f = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) throw new Error('此環境無法連線');
    const url = endpointUrl(cfg.endpoint);
    if (!url) throw new Error('尚未設定 API 位址');
    if (!cfg.key) throw new Error('尚未設定 API Key');
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeoutMs || 45000) : null;
    try {
      const body = { model: cfg.model, messages, temperature: 0.2 };
      if (opts.json !== false && cfg.jsonMode) body.response_format = { type: 'json_object' };
      const res = await f(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key }, body: JSON.stringify(body), signal: ctrl ? ctrl.signal : undefined });
      if (!res.ok) {
        let detail = ''; try { detail = (await res.text()).slice(0, 200); } catch {}
        const e = new Error(res.status === 401 ? 'API Key 無效或沒有權限（401）' : res.status === 429 ? '請求太頻繁或額度用完（429）' : `API 錯誤 ${res.status}${detail ? '：' + detail : ''}`);
        e.status = res.status; throw e;
      }
      const j = await res.json();
      const c = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (typeof c !== 'string') throw new Error('API 回傳格式不符');
      return c;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('連線逾時');
      if (e instanceof TypeError) throw new Error('無法連線（可能是網路問題，或此服務不允許從瀏覽器直接呼叫／CORS）');
      throw e;
    } finally { if (timer) clearTimeout(timer); }
  }

  function parseJSON(text) {
    if (typeof text !== 'string') return null;
    let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(t); } catch {}
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
    return null;
  }

  function confNum(c) {
    if (typeof c === 'string') { const m = { high: 0.85, medium: 0.65, low: 0.4, 高: 0.85, 中: 0.65, 低: 0.4 }; if (m[c] != null) return m[c]; c = parseFloat(c); }
    if (typeof c !== 'number' || !isFinite(c)) return 0.5;
    if (c > 1) c = c / 100;
    return Math.max(0, Math.min(1, c));
  }

  /** Validate model output. Drops hints/warnings whose verses do not resolve in the bundled Bible. */
  function normalizeAnalysis(obj, bible) {
    const out = { hints: [], warnings: [] };
    if (!obj || typeof obj !== 'object') return out;
    const resolve = (s) => { try { const r = R.lookup(String(s), bible); return r && R.validate(r, bible) !== false ? r : null; } catch { return null; } };
    for (const h of (Array.isArray(obj.hints) ? obj.hints : []).slice(0, 4)) {
      const r = h && resolve(h.ref); if (!r) continue;
      out.hints.push({ ref: r, label: r.label, why: String(h.why || '').slice(0, 200) });
    }
    for (const w of (Array.isArray(obj.warnings) ? obj.warnings : []).slice(0, 3)) {
      if (!w || !w.problem) continue;
      const refs = (Array.isArray(w.refs) ? w.refs : []).map(resolve).filter(Boolean);
      if (!refs.length) continue; // must cite real verses
      const conf = confNum(w.confidence);
      if (conf < 0.5) continue;
      const level = ['error', 'caution', 'debated'].includes(w.level) ? w.level : 'caution';
      out.warnings.push({
        ruleId: 'llm', src: 'llm', level, title: String(w.problem).slice(0, 60), heard: String(w.claim || '').slice(0, 160), sentence: String(w.claim || '').slice(0, 160),
        why: String(w.why || '').slice(0, 600), verses: refs.map((r) => r.label), refObjs: refs, correct: String(w.correct || '').slice(0, 300), conf: Math.round(conf * 100) / 100, suppressed: false,
      });
    }
    return out;
  }

  async function analyzeChunk(cfg, chunk, ctx, bible, opts) {
    const msg = [{ role: 'system', content: SYSTEM }, { role: 'user', content: analyzePrompt(chunk, ctx) }];
    const txt = await callChat(cfg, msg, opts);
    const obj = parseJSON(txt);
    if (!obj) throw new Error('模型沒有回傳可解析的 JSON');
    return normalizeAnalysis(obj, bible);
  }

  async function summarizeSession(cfg, transcript, meta, opts) {
    // cap very long transcripts: keep head and tail
    let t = transcript;
    if (t.length > 14000) t = t.slice(0, 8000) + '\n……（中間省略）……\n' + t.slice(-5500);
    const txt = await callChat(cfg, [{ role: 'system', content: SYSTEM }, { role: 'user', content: summaryPrompt(t, meta) }], opts);
    const o = parseJSON(txt);
    if (!o) return { src: 'llm', model: cfg.model, text: txt.trim(), points: [], title: '' };
    const lines = [];
    if (o.main) lines.push('**主旨**：' + o.main);
    if (Array.isArray(o.points) && o.points.length) { lines.push('', '**重點**'); o.points.forEach((p, i) => lines.push(`${i + 1}. ${p}`)); }
    if (Array.isArray(o.application) && o.application.length) { lines.push('', '**生活應用**'); o.application.forEach((p) => lines.push('- ' + p)); }
    if (Array.isArray(o.cautions) && o.cautions.length) { lines.push('', '**需要對照聖經再確認**'); o.cautions.forEach((p) => lines.push('- ' + p)); }
    return { src: 'llm', model: cfg.model, title: String(o.title || ''), text: lines.join('\n'), points: Array.isArray(o.points) ? o.points : [], themes: Array.isArray(o.themes) ? o.themes : [], verses: Array.isArray(o.verses) ? o.verses : [] };
  }

  return { SYSTEM, analyzePrompt, summaryPrompt, endpointUrl, callChat, parseJSON, normalizeAnalysis, analyzeChunk, summarizeSession, confNum };
});
