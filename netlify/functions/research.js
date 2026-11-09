// Netlify Function: Google autocomplete + AI (Gemini -> Groq -> OpenRouter fallback).
// Env vars: GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY
// Optional: GEMINI_MODEL, GROQ_MODEL, OPENROUTER_MODELS (comma list), AI_TIMEOUT_MS
const T = () => Number(process.env.AI_TIMEOUT_MS) || 8000;
const json = (c, o) => ({ statusCode: c, headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) });
const SUFFIX = ["", " how", " what", " why", " vs", " example", " template", " for", " guide", " model", " framework", " technique", " mistakes"];

async function post(url, headers, body) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), T());
  try {
    const r = await fetch(url, { method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
    const txt = await r.text();
    if (!r.ok) throw new Error(r.status + " " + txt.slice(0, 160));
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
First infer the search intent. If you can search the web, look at the current top 10 results for the seed keyword and avoid angles they already cover.
Real Google autocomplete queries for this keyword (demand signals, use them):
${sugg.slice(0, 60).join("\n") || "none"}
Already published by the user (never repeat or paraphrase):
${used || "none"}

Propose exactly 10 blog topics that form a topical-authority cluster (pillar plus supporting topics that interlink). Each must be a specific, in-depth angle with strong search demand but low competition: named models, frameworks, techniques, exact syllabus or unit topics, worked examples, templates, common mistakes, comparisons. Use only real, correctly named concepts; never invent models, standards or statistics. Titles 55-70 characters, natural, not clickbait. No two ideas on the same sub-topic.
est_demand and est_competition are rough estimates: Low, Medium or High.

Return ONLY valid JSON (no markdown) in this shape:
{"intent":"...","ideas":[{"title":"...","primary_keyword":"...","angle":"Framework|Technique|Model|Unit deep-dive|Template|Comparison|Case study|Mistakes|Other","cluster":"Pillar|Supporting","pillar":"broader pillar topic","why":"one sentence on the gap","est_demand":"Low|Medium|High","est_competition":"Low|Medium|High","outline":["H2","H2","H2","H2"]}]}`;
}

function parse(text) {
  const s = String(text || "").replace(/```json|```/g, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  const o = JSON.parse(s.slice(a, b + 1));
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

const gemini = (p) => async () => {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent";
  const h = { "x-goog-api-key": process.env.GEMINI_API_KEY };
  const read = d => (d.candidates?.[0]?.content?.parts || []).map(x => x.text || "").join("");
  try { // 1st try: with live Google Search grounding
    const d = await post(url, h, { contents: [{ parts: [{ text: p }] }], tools: [{ google_search: {} }] });
    const sources = (d.candidates?.[0]?.groundingMetadata?.groundingChunks || []).map(c => c.web).filter(Boolean).map(w => ({ title: w.title, url: w.uri })).slice(0, 10);
    return { text: read(d), grounded: true, sources, name: "Gemini " + model };
  } catch (e1) { // 2nd try: plain JSON mode
    const d = await post(url, h, { contents: [{ parts: [{ text: p }] }], generationConfig: { responseMimeType: "application/json" } });
    return { text: read(d), grounded: false, sources: [], name: "Gemini " + model };
  }
};
const groq = (p) => async () => {
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const d = await post("https://api.groq.com/openai/v1/chat/completions", { Authorization: "Bearer " + process.env.GROQ_API_KEY },
    { model, messages: [{ role: "user", content: p }], response_format: { type: "json_object" }, temperature: 0.7 });
  return { text: d.choices?.[0]?.message?.content, grounded: false, sources: [], name: "Groq " + model };
};
const openrouter = (p) => async () => {
  const models = (process.env.OPENROUTER_MODELS || "meta-llama/llama-3.3-70b-instruct:free,google/gemma-3-27b-it:free").split(",").map(s => s.trim()).filter(Boolean);
  let last;
  for (const model of models) {
    try {
      const d = await post("https://openrouter.ai/api/v1/chat/completions", { Authorization: "Bearer " + process.env.OPENROUTER_API_KEY },
        { model, messages: [{ role: "user", content: p }] });
      return { text: d.choices?.[0]?.message?.content, grounded: false, sources: [], name: "OpenRouter " + model };
    } catch (e) { last = e; }
  }
  throw last || new Error("no OpenRouter models set");
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Use POST" });
  let b; try { b = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON" }); }
  const kw = String(b.keyword || "").trim().slice(0, 120);
  if (!kw) return json(400, { error: "Enter a keyword." });
  const aud = String(b.audience || "").slice(0, 120);
  const used = String(b.used || "").split("\n").map(s => s.trim()).filter(Boolean).slice(0, 300).join("\n");

  const sugg = [...new Set((await Promise.all(SUFFIX.map(s => autocomplete(kw + s)))).flat())];
  const p = prompt(kw, aud, used, sugg);

  const chain = [];
  if (process.env.GEMINI_API_KEY) chain.push(["Gemini", gemini(p)]);
  if (process.env.GROQ_API_KEY) chain.push(["Groq", groq(p)]);
  if (process.env.OPENROUTER_API_KEY) chain.push(["OpenRouter", openrouter(p)]);
  if (!chain.length) return json(500, { error: "No API keys set. Add GEMINI_API_KEY, GROQ_API_KEY and OPENROUTER_API_KEY in Netlify environment variables." });

  const failed = [];
  for (const [label, run] of chain) {
    try {
      const r = await run();
      const out = parse(r.text);
      return json(200, { keyword: kw, provider: r.name, grounded: r.grounded, sources: r.sources, failed, intent: out.intent, ideas: out.ideas });
    } catch (e) { failed.push(label + ": " + String(e.message).slice(0, 140)); }
  }
  return json(502, { error: "All providers failed. " + failed.join(" | ") });
};
