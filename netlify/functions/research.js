// Netlify Function. One call = one provider (the page tries Gemini, then Groq, then OpenRouter).
// Env vars: GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY
// Optional overrides: GEMINI_MODELS, GROQ_MODEL, OPENROUTER_MODELS (comma lists), AI_TIMEOUT_MS
const json = (c, o) => ({ statusCode: c, headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) });
const SUFFIX = ["", " how", " what", " why", " vs", " example", " template", " for", " guide", " model", " framework", " technique", " mistakes"];
let DEADLINE = 0;
const left = () => Math.max(1500, Math.min(Number(process.env.AI_TIMEOUT_MS) || 6500, DEADLINE - Date.now()));
const timeLeft = () => DEADLINE - Date.now() > 2500;

async function call(method, url, headers, body) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), left());
  try {
    const r = await fetch(url, { method, signal: ctl.signal, headers: { "Content-Type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
    const txt = await r.text();
    if (!r.ok) throw new Error(r.status + " " + txt.slice(0, 200));
    return JSON.parse(txt);
  } catch (e) { throw new Error(e.name === "AbortError" ? "timed out" : e.message); }
  finally { clearTimeout(t); }
}

async function autocomplete(q) {
  try {
    const r = await fetch("https://suggestqueries.google.com/complete/search?client=firefox&q=" + encodeURIComponent(q), { headers: { "User-Agent": "Mozilla/5.0" } });
    const j = await r.json(); return Array.isArray(j[1]) ? j[1] : [];
  } catch { return []; }
}

function prompt(kw, aud, used, sugg) {
  return `You are a senior SEO content strategist. Seed keyword: "${kw}". Audience: ${aud || "infer from the keyword"}.
First infer the search intent. Real Google autocomplete queries for this keyword (demand signals, use them):
${sugg.slice(0, 50).join("\n") || "none"}
Already published by the user (never repeat or paraphrase):
${used || "none"}

Propose exactly 10 blog topics that form a topical-authority cluster (pillar plus supporting topics that interlink). Each must be a specific, in-depth angle with strong search demand but low competition: named models, frameworks, techniques, exact syllabus or unit topics, worked examples, templates, common mistakes, comparisons. Use only real, correctly named concepts; never invent models, standards or statistics. Titles 55-70 characters, natural, not clickbait. No two ideas on the same sub-topic.
est_demand and est_competition are rough estimates: Low, Medium or High.

Return ONLY valid JSON (no markdown) in this shape:
{"intent":"...","ideas":[{"title":"...","primary_keyword":"...","angle":"Framework|Technique|Model|Unit deep-dive|Template|Comparison|Case study|Mistakes|Other","cluster":"Pillar|Supporting","pillar":"broader pillar topic","why":"one sentence on the gap","est_demand":"Low|Medium|High","est_competition":"Low|Medium|High","outline":["H2","H2","H2","H2"]}]}`;
}

function parse(text) {
  const s = String(text || "").replace(/```json|```/g, "");
  const o = JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1));
  if (!Array.isArray(o.ideas) || !o.ideas.length) throw new Error("no ideas in reply");
  const S = v => String(v == null ? "" : v).slice(0, 300);
  return {
    intent: S(o.intent),
    ideas: o.ideas.slice(0, 10).map(i => ({
      title: S(i.title), primary_keyword: S(i.primary_keyword), angle: S(i.angle), cluster: S(i.cluster), pillar: S(i.pillar),
      why: S(i.why), est_demand: S(i.est_demand), est_competition: S(i.est_competition),
      outline: (Array.isArray(i.outline) ? i.outline : []).slice(0, 6).map(S)
    }))
  };
}

// Try models in order until one returns parsable ideas.
async function tryModels(models, ask, label) {
  let last = new Error("no models to try");
  for (const m of models) {
    if (!timeLeft()) break;
    try { return { name: label + " " + m, ...parse(await ask(m)) }; } catch (e) { last = new Error(m + ": " + e.message); }
  }
  throw last;
}
const list = (env, def) => (process.env[env] || def).split(",").map(s => s.trim()).filter(Boolean);

const providers = {
  gemini: async (p) => tryModels(list("GEMINI_MODELS", "gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite"), async (m) => {
    const d = await call("POST", "https://generativelanguage.googleapis.com/v1beta/models/" + m + ":generateContent",
      { "x-goog-api-key": process.env.GEMINI_API_KEY },
      { contents: [{ parts: [{ text: p }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.7 } });
    return (d.candidates?.[0]?.content?.parts || []).map(x => x.text || "").join("");
  }, "Gemini"),

  groq: async (p) => {
    const H = { Authorization: "Bearer " + process.env.GROQ_API_KEY };
    const ask = async (m) => (await call("POST", "https://api.groq.com/openai/v1/chat/completions", H,
      { model: m, messages: [{ role: "user", content: p }], temperature: 0.7 })).choices?.[0]?.message?.content;
    try { return await tryModels(list("GROQ_MODEL", "openai/gpt-oss-120b,openai/gpt-oss-20b"), ask, "Groq"); }
    catch (e) { // model names change: look up what this account can use right now
      if (!timeLeft()) throw e;
      const ms = await call("GET", "https://api.groq.com/openai/v1/models", H);
      const ids = (ms.data || []).map(x => x.id).filter(id => !/whisper|guard|tts|orpheus|compound|distil|embed/i.test(id)).slice(0, 3);
      if (!ids.length) throw e;
      return tryModels(ids, ask, "Groq");
    }
  },

  openrouter: async (p) => {
    const H = { Authorization: "Bearer " + process.env.OPENROUTER_API_KEY };
    let models = list("OPENROUTER_MODELS", "");
    if (!models.length) { // only models that cost $0 for both input and output
      const ms = await call("GET", "https://openrouter.ai/api/v1/models", H);
      models = (ms.data || [])
        .filter(x => x.pricing && Number(x.pricing.prompt) === 0 && Number(x.pricing.completion) === 0 && !Number(x.pricing.request || 0))
        .filter(x => !/vision|image|audio|embed|guard|safeguard/i.test(x.id))
        .sort((a, b) => (b.context_length || 0) - (a.context_length || 0)).map(x => x.id).slice(0, 4);
    }
    if (!models.length) throw new Error("no free models found");
    return tryModels(models, async (m) => (await call("POST", "https://openrouter.ai/api/v1/chat/completions", H,
      { model: m, messages: [{ role: "user", content: p }] })).choices?.[0]?.message?.content, "OpenRouter");
  }
};
const KEYS = { gemini: "GEMINI_API_KEY", groq: "GROQ_API_KEY", openrouter: "OPENROUTER_API_KEY" };

exports.handler = async (event) => {
  DEADLINE = Date.now() + 9300;
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST" });
  let b; try { b = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON" }); }
  const kw = String(b.keyword || "").trim().slice(0, 120);
  if (!kw) return json(400, { error: "Enter a keyword." });
  const prov = String(b.provider || "gemini");
  if (!providers[prov]) return json(400, { error: "Unknown provider" });
  if (!process.env[KEYS[prov]]) return json(400, { error: KEYS[prov] + " is not set" });
  const used = String(b.used || "").split("\n").map(s => s.trim()).filter(Boolean).slice(0, 300).join("\n");
  const sugg = [...new Set((await Promise.all(SUFFIX.map(s => autocomplete(kw + s)))).flat())];
  try {
    const r = await providers[prov](prompt(kw, String(b.audience || "").slice(0, 120), used, sugg));
    return json(200, { keyword: kw, provider: r.name, grounded: false, sources: [], intent: r.intent, ideas: r.ideas });
  } catch (e) { return json(502, { error: String(e.message).slice(0, 260) }); }
};
