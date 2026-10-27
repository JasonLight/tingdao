/* 聽道 — optional LLM layer (UMD). OpenAI-compatible /chat/completions, user's own key, called straight from the browser. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./refs.js'));
  else root.TingdaoLLM = factory(root.TingdaoRefs);
})(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  const SYSTEM = `你是「聽道」的輔助分析員，協助聽道者在聆聽講道時，快速找到相關經文，並提醒「可能需要再對照聖經」的說法。
立場與原則：
1. 以歷代基督教共同信仰（使徒信經、尼西亞信經）與主流基督新教（福音派／改革宗／信義宗等共同認可的立場）為基準，使用和合本經文章節。
2. 對講員抱持善意與寬容：先假設講員的意思是正確的，把可能的意譯、舉例、比喻、修辭、禱告用語、聽寫錯誤（語音辨識常有同音字、簡繁混用、斷句錯誤）納入考慮。講員自己隨後更正的口誤不要提。
3. 區分「錯誤」與「基督徒之間有不同看法的次要議題」（例如洗禮方式、末世論細節、恩賜停止論、預定與自由意志、聖餐觀、醫治與宣告等）。後者請標為 level="debated"，只說明各方看法，不要說成錯誤。
4. 每一則警示都必須引用具體經文（書卷 章:節，用和合本簡稱，如「約 3:16」「羅 8:28-30」），不可捏造經文；不確定就不要列。
5. 為每則警示給出 confidence（0 到 1）。低於 0.5 的就不要輸出。寧可少報，不要多報。
6. 不要評論講員的人格、動機或所屬宗派；只談「這句話」與聖經的關係。
7. 只輸出 JSON，不要任何額外說明或 Markdown 圍欄。

【要特別留意的六類問題】（關鍵字規則抓不到、需要你理解語意與脈絡的部分；每則警示請填 kind）
- misapplied：引用了某節經文，卻把它用在原文脈絡並不支持的意思上（例如把腓 4:13 的「知足」當成「考試一定拿第一」，或把太 18:20 說成「人多禱告就必成就」）。要比對「他引的經文原本在說什麼」與「他由此推出什麼」。
- personal-claim：把個人的感動、領受、推測、異象說成「聖經說的」「神的應許」「聖經記載」，或以個人領受要求聽眾照做；沒有明說「這是我個人的看法」。
- speculation：對聖經沒有說明的屬靈細節（天使、魔鬼、末日時間、天上的事、被造秩序）下肯定的斷言，如具體比例、數量、時程。
- transactional：交易式或定律式的說法（你給多少神就還你多少、做了某件事就必得到某結果、宣告必成就），忽略恩典、神的主權與旨意。
- misattributed：經文出處、人物、事件記錯或混用（例如把這卷書的話說成另一卷、把甲的事蹟說成乙的），或引用的精確數字沒有根據。
- inconsistent：同一場講道前後說法互相矛盾，或結論超出前提（例如「天國取決於你怎麼待人」與「因信稱義、本乎恩」衝突）。
只有達到「明顯」程度才提出；單純的立場差異、詩意說法、禱告與敬拜用語、把經文當作應用的類比，不要報。

【如何使用上下文】逐字稿會附前文。若前文已說明講員的引用或限定語（「我個人覺得」「這只是比喻」），要納入判斷；若前後文顯示是同一論點的延續，請整體判斷而不是只看這一句。`;

  function analyzePrompt(chunk, ctx) {
    ctx = ctx || {};
    return `請分析下面這段講道逐字稿（語音辨識產生，可能有錯字、簡繁混用、沒有標點）。${ctx.prev ? '\n【前文（僅供語境，不必分析）】\n' + ctx.prev : ''}
【要分析的段落】
${chunk}

請用繁體中文輸出 JSON，格式：
{
 "hints": [ {"ref": "約 3:16", "why": "講員這句話與此節呼應（一句話）"} ],
 "warnings": [ {
   "claim": "講員原話（簡短引用）",
   "problem": "問題的簡短標題（10-20字）",
   "kind": "misapplied | personal-claim | speculation | transactional | misattributed | inconsistent | other",
   "why": "為什麼需要再對照聖經（2-4句，客觀、不攻擊；若是 misapplied，請說明原經文的脈絡）",
   "refs": ["羅 3:28", "弗 2:8-9"],
   "correct": "較符合聖經的說法（1-2句）",
   "level": "error | caution | debated",
   "confidence": 0.0
 } ]
}
hints 最多 3 則，warnings 最多 3 則；這段沒有明顯問題就輸出空陣列（大多數段落應該是空的）。`;
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

  // Endpoint presets. cors = what was measured from a real Chrome page on https://jasonlight.github.io (2026-10-27), with NO real key:
  //   'ok'     preflight passes AND an invalid-key (401/400) response is readable by the page
  //   'opaque' preflight passes but an invalid-key response carries no CORS header → a wrong key looks like "Failed to fetch"
  // (a successful 200 with a valid key could not be probed without a key; third-party tests dated 2026-07 report ACAO on success for OpenAI.)
  const PRESETS = [
    { id: 'openai', name: 'OpenAI', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini', cors: 'opaque', keyUrl: 'https://platform.openai.com/api-keys', note: '金鑰錯誤時瀏覽器只會顯示「無法連線」，請先確認金鑰。' },
    { id: 'gemini', name: 'Google Gemini（OpenAI 相容）', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', cors: 'ok', keyUrl: 'https://aistudio.google.com/apikey', note: '有免費額度；免費層的資料可能被用於改善服務，請留意隱私。' },
    { id: 'openrouter', name: 'OpenRouter（一個 Key 通多家模型）', endpoint: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', cors: 'ok', keyUrl: 'https://openrouter.ai/keys', note: '可選多家模型；也有部分免費模型（品質與穩定度不一）。' },
    { id: 'groq', name: 'Groq（速度快）', endpoint: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', cors: 'ok', keyUrl: 'https://console.groq.com/keys', note: '有免費額度；中文與神學判斷力依模型而異。' },
    { id: 'deepseek', name: 'DeepSeek', endpoint: 'https://api.deepseek.com', model: 'deepseek-chat', cors: 'ok', keyUrl: 'https://platform.deepseek.com/api_keys', note: '中文佳、價格低；資料會送到中國境內伺服器。' },
    { id: 'mistral', name: 'Mistral', endpoint: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', cors: 'ok', keyUrl: 'https://console.mistral.ai/api-keys', note: '' },
    { id: 'together', name: 'Together AI', endpoint: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', cors: 'ok', keyUrl: 'https://api.together.ai/settings/api-keys', note: '' },
    { id: 'dashscope', name: '阿里雲百煉（通義千問）', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', cors: 'ok', keyUrl: 'https://bailian.console.aliyun.com/', note: '中文佳；資料會送到中國境內伺服器。' },
    { id: 'cerebras', name: 'Cerebras', endpoint: 'https://api.cerebras.ai/v1', model: 'llama-3.3-70b', cors: 'opaque', keyUrl: 'https://cloud.cerebras.ai/', note: '金鑰錯誤時瀏覽器只會顯示「無法連線」。' },
    { id: 'ollama', name: '本機 Ollama', endpoint: 'http://localhost:11434/v1', model: 'qwen2.5:7b', cors: 'local', keyUrl: 'https://ollama.com/', note: '資料不離開你的電腦。需先設定環境變數 OLLAMA_ORIGINS=https://jasonlight.github.io 後重啟 Ollama；Key 可隨便填一個字。小模型的神學判斷力有限。' },
    { id: 'custom', name: '自訂（任何 OpenAI 相容服務）', endpoint: '', model: '', cors: 'unknown', keyUrl: '', note: '服務必須允許瀏覽器跨來源呼叫（CORS）。Anthropic 的原生 API 格式不同，請改用 OpenRouter 等相容閘道。' },
  ];
  function presetById(id) { return PRESETS.find((p) => p.id === id) || null; }
  function presetFor(endpoint) { const e = (endpoint || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, ''); return PRESETS.find((p) => p.endpoint && p.endpoint === e) || null; }

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
      if (e instanceof TypeError) throw new Error('無法連線：可能是網路問題；或 API Key 錯誤（OpenAI、Cerebras 等在金鑰錯誤時不回傳 CORS 標頭，瀏覽器會顯示成連線失敗）；或此服務不允許從瀏覽器直接呼叫（CORS）');
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
        ruleId: 'llm', src: 'llm', level, kind: String(w.kind || '').slice(0, 20), title: String(w.problem).slice(0, 60), heard: String(w.claim || '').slice(0, 160), sentence: String(w.claim || '').slice(0, 160),
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

  return { PRESETS, presetById, presetFor, SYSTEM, analyzePrompt, summaryPrompt, endpointUrl, callChat, parseJSON, normalizeAnalysis, analyzeChunk, summarizeSession, confNum };
});
