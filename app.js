/* Prompt Studio engine — type less, get exactly what you want.
   Zero dependencies, zero network. Vocabulary + modifiers live in data.js. */

/* ---------- domain engine ---------- */
/* Each domain: emoji, label, base line, and a deliverable shape per depth (0=TL;DR, 1=Standard, 2=Deep).
   Shapes are answer-shape-first and always end with an explicit size cap — that's what keeps replies short. */

const GENERIC_SHAPES = [
  "Just the short version — the single best answer in 2–3 sentences.",
  null, // domain provides its own standard shape
  null, // derived: standard + one level deeper
];

const DOMAINS = {
  learn:     { em:"📚", label:"Learn",     base:t=>`Explain ${t}.`, shapes:[
    "Core idea only, 3 short sentences.",
    "Core idea in 2 sentences, then the 3 things that matter most, then one real example. Max 120 words.",
    "Intuition first, then how it works step by step, one worked example, and the most common misconception. Max 350 words." ]},
  code:      { em:"💻", label:"Code",      base:t=>`Write code for: ${t}.`, shapes:[
    "Shortest working solution, one code block, no explanation.",
    "Complete runnable code in one block, then 3 bullet notes on key decisions. State your language assumption in the first line.",
    "Production-quality code with error handling and brief comments, then notes on edge cases and how to test it." ]},
  debug:     { em:"🔧", label:"Fix code",  base:t=>`Help me fix: ${t}.`, shapes:[
    "Most likely cause and the fix. Nothing else.",
    "Top 2 likely causes ranked, the fix for the most likely, and how to confirm it. If one detail from me would change your answer, ask it first.",
    "Reason from evidence: candidate causes ranked with what would confirm each, then the smallest possible fix and how to verify it." ]},
  write:     { em:"✍️", label:"Write",     base:t=>`Draft this: ${t}.`, shapes:[
    "One tight paragraph, ready to use.",
    "A ready-to-use draft in a natural voice, no filler phrases. Then one line on how to make it sound more like me.",
    "Two ready-to-use versions with different angles, then one line on when to pick which." ]},
  email:     { em:"📧", label:"Email",     base:t=>`Write this email: ${t}.`, shapes:[
    "Subject line + 3-sentence body.",
    "Subject line + body under 120 words. No filler openings. Warm but direct.",
    "Subject + body under 150 words, one alternative subject line, and an optional one-line P.S." ]},
  career:    { em:"💼", label:"Career",    base:t=>`Career help: ${t}.`, shapes:[ null,
    "The 3 highest-impact moves, each with the exact first step. Be direct — no generic advice.", null ]},
  health:    { em:"🩺", label:"Health",    base:t=>`Health question: ${t}.`, shapes:[ null,
    "Practical, evidence-based guidance in 5 bullets max, and say clearly if this needs a real doctor.", null ]},
  cook:      { em:"🍳", label:"Cooking",   base:t=>`Recipe: ${t}.`, shapes:[
    "Shortest good version — ingredients, then 5 steps max.",
    "Ingredients with amounts, then numbered steps with times. Note the one step people get wrong.",
    "Ingredients with amounts, numbered steps with times, substitutions, and make-ahead notes." ]},
  travel:    { em:"✈️", label:"Travel",    base:t=>`Plan this trip: ${t}.`, shapes:[ null,
    "Day-by-day outline, one line per day, the one thing to book ahead, and a realistic daily budget.", null ]},
  money:     { em:"💰", label:"Money",     base:t=>`Money question: ${t}.`, shapes:[ null,
    "The straightforward answer first, key numbers in a short table, then the one mistake to avoid. Be concrete.", null ]},
  fit:       { em:"🏋️", label:"Fitness",   base:t=>`Fitness: ${t}.`, shapes:[ null,
    "A simple plan I can start today, listed by day, with time per session and the one form cue that matters most.", null ]},
  home:      { em:"🏠", label:"Home",      base:t=>`Home help: ${t}.`, shapes:[ null,
    "Steps in order, tools and materials listed first, and when it's smarter to call a pro.", null ]},
  parent:    { em:"👶", label:"Parenting", base:t=>`Parenting: ${t}.`, shapes:[ null,
    "What usually works, in 4 bullets, plus the one thing to avoid. Realistic and judgment-free.", null ]},
  shop:      { em:"🛒", label:"Buying",    base:t=>`Buying advice: ${t}.`, shapes:[ null,
    "Top 3 picks in a table (pick, why, rough price), then your one-line recommendation for most people.", null ]},
  create:    { em:"🎨", label:"Ideas",     base:t=>`Creative help: ${t}.`, shapes:[
    "Your 3 best ideas, one line each.",
    "10 ideas, one line each — at least 3 unexpected. Mark your top 2.",
    "10 ideas in a table (idea, why it works, effort S/M/L) — at least 3 unexpected. Mark your top 2 and say why." ]},
  biz:       { em:"📈", label:"Business",  base:t=>`Business: ${t}.`, shapes:[ null,
    "The 3 most important moves ranked by impact, each with a concrete first step and rough effort.", null ]},
  market:    { em:"📣", label:"Marketing", base:t=>`Marketing: ${t}.`, shapes:[ null,
    "3 concrete tactics with a real example of each, ranked by effort-to-payoff. No buzzwords.", null ]},
  legal:     { em:"⚖️", label:"Legal",     base:t=>`Legal question: ${t}.`, shapes:[ null,
    "How this usually works in plain English, the key terms to know, and when you genuinely need a lawyer.", null ]},
  lang:      { em:"🗣️", label:"Language",  base:t=>`Language help: ${t}.`, shapes:[ null,
    "The answer with a short example dialogue, plus the mistake learners usually make.", null ]},
  math:      { em:"➗", label:"Math",      base:t=>`Math: ${t}.`, shapes:[
    "Answer first, then the one-line reason.",
    "State the answer first, then the shortest correct path step by step, one line per step.",
    "Answer first, full worked solution step by step, then a second method if one exists." ]},
  sci:       { em:"🔬", label:"Science",   base:t=>`Science: ${t}.`, shapes:[ null,
    "The accepted answer in 2 sentences, then how we know, then what's still debated. Max 130 words.", null ]},
  plan:      { em:"🗓️", label:"Plan",      base:t=>`Help me plan: ${t}.`, shapes:[ null,
    "A checklist in order with rough timing. Flag the step people underestimate.", null ]},
  social:    { em:"💬", label:"Say it",    base:t=>`What should I say: ${t}.`, shapes:[
    "One ready-to-send message.",
    "3 ready-to-send options — friendly, direct, playful. One line each.",
    "3 ready-to-send options — friendly, direct, playful — plus what to say if the reply is negative." ]},
  fun:       { em:"🎲", label:"Fun",       base:t=>`Fun: ${t}.`, shapes:[ null,
    "Best suggestions, quick and specific. No long intros.", null ]},
  tech:      { em:"📱", label:"Tech help", base:t=>`Tech help: ${t}.`, shapes:[ null,
    "The fix in numbered steps for a non-expert, plus what to check if it doesn't work.", null ]},
  decide:    { em:"🤔", label:"Decide",    base:t=>`Help me decide: ${t}.`, shapes:[
    "Your pick in one sentence, with the reason.",
    "Compare the options in a small table, then your pick in 2 sentences. If it depends, tell me the one deciding question.",
    "Compare in a table (option, best for, biggest risk), your pick with reasoning, and the deciding question if it depends." ]},
  summarize: { em:"📝", label:"Summarize", base:t=>`Summarize this: ${t}.`, shapes:[
    "One-sentence bottom line only.\n\n[paste text below]",
    "5 bullets max, under 15 words each, keep numbers exact, then \"Bottom line:\" in one sentence.\n\n[paste text below]",
    "Key points grouped by theme, numbers exact, then \"Bottom line:\" and one thing the author underplays.\n\n[paste text below]" ]},
  analyze:   { em:"📊", label:"Analyze",   base:t=>`Analyze: ${t}.`, shapes:[ null,
    "Findings in a short table (finding, evidence, confidence), then the 2 actions you'd take. Flag anything surprising.", null ]},
  image:     { em:"🖼️", label:"Image",     base:t=>`Write one image-generation prompt for: ${t}.`, shapes:[
    "One flowing line: subject, style, mood. Nothing else.",
    "One flowing line covering subject, style, lighting, composition, mood — then a short negative prompt.",
    "Three variants (photoreal, illustration, minimal), each one flowing line, each with a short negative prompt." ]},
  agent:     { em:"🤖", label:"Agent",     base:t=>`Do this task end to end: ${t}.`, shapes:[ null,
    "Plan briefly first, then execute step by step, verifying each step. Ask before anything destructive. Report the outcome, not the process.", null ]},
  general:   { em:"✳️", label:"General",   base:t=>`Help me with: ${t}.`, shapes:[
    "Direct answer only, 3 sentences max.",
    "Direct answer first, then only the essential detail. Max 130 words.",
    "Direct answer first, then the full picture: key details, trade-offs, your recommendation. Max 350 words." ]},
};

/* free-typing fallback: keyword → domain, checked in order */
const SIGS = [
  ["debug",   /\b(error|bug|traceback|exception|not working|fails?|crash|undefined|stack ?trace)\b/i],
  ["code",    /\b(code|function|script|python|javascript|typescript|sql|regex|api|refactor|algorithm|component)\b/i],
  ["email",   /\b(email|e-mail|reply to|follow ?up)\b/i],
  ["summarize",/\b(summar|tl;?dr|key points|recap|condense)\b/i],
  ["cook",    /\b(recipe|cook|bake|dinner|meal|marinade|air fryer|slow cooker)\b/i],
  ["travel",  /\b(trip|itinerary|travel|vacation|days? in|visit)\b/i],
  ["money",   /\b(invest|budget|salary|mortgage|loan|savings?|retire|tax|debt|401k|credit)\b/i],
  ["fit",     /\b(workout|gym|exercise|run(ning)?|strength|cardio|stretch|muscle)\b/i],
  ["health",  /\b(sleep|diet|pain|symptom|doctor|anxiety|stress|vitamin|allerg)\b/i],
  ["parent",  /\b(toddler|baby|kid|child|teen|potty|tantrum)\b/i],
  ["decide",  /\b(vs\.?|versus|or should|which is|better|worth it|choose|decide)\b/i],
  ["shop",    /\b(buy|best (cheap|budget)|under \$|which .*to get|recommend a)\b/i],
  ["write",   /\b(write|draft|essay|blog|post|caption|bio|speech|story|resume|cover letter)\b/i],
  ["image",   /\b(image|logo|illustration|poster|icon|midjourney|art)\b/i],
  ["plan",    /\b(plan|organize|checklist|prepare|schedule)\b/i],
  ["math",    /\b(calculate|solve|equation|percent|probability|geometry)\b/i],
  ["learn",   /\b(explain|what is|what are|how does|difference between|understand|learn)\b/i],
  ["agent",   /\b(automate|workflow|step by step task|pipeline|agent)\b/i],
];

function detectDomain(text) {
  for (const [id, re] of SIGS) if (re.test(text)) return id;
  return "general";
}

/* If the user already typed the framing verb, drop it so the base line doesn't repeat it. */
const STRIPS = {
  learn:     /^(explain|what is|what are|how does|how do|teach me|understand(ing)?)\s+/i,
  code:      /^(write\s+)?code\s+(for|to)\s+/i,
  debug:     /^(help me\s+)?fix(ing)?\s+/i,
  write:     /^(write|draft)\s+(me\s+)?/i,
  email:     /^write\s+/i,
  summarize: /^summariz(e|ing)\s+/i,
  decide:    /^(help me\s+)?(decide|choose)\s+(between\s+)?/i,
  cook:      /^(recipe\s+for|how to (cook|make))\s+/i,
  travel:    /^(plan\s+)?(a\s+|my\s+)?trip\s+(to\s+)?/i,
  plan:      /^(help me\s+)?plan(ning)?\s+/i,
  math:      /^(solve|calculate)\s+/i,
  image:     /^(image|picture|logo)\s+of\s+/i,
};

const AUDIENCE = [
  "Assume I know nothing about this.",
  null,
  "I know the basics — skip them.",
];

function shapeFor(dom, depth) {
  const s = dom.shapes[depth];
  if (s) return s;
  if (depth === 0) return GENERIC_SHAPES[0];
  const std = dom.shapes[1];
  return depth === 2 ? std + " Then go one level deeper on the most important part." : std;
}

/* Build the prompt as segments so chip/slider additions can be highlighted. */
function buildPrompt(topic, domId, depth, tone, activeMods) {
  const dom = DOMAINS[domId] || DOMAINS.general;
  let t = topic.trim().replace(/\s+/g, " ").replace(/[.?!]+$/, "");
  if (STRIPS[domId]) {
    const stripped = t.replace(STRIPS[domId], "");
    if (stripped.trim()) t = stripped.trim();
  }
  if (!t) return [];
  const segs = [{ text: dom.base(t), add: false }];
  const shape = shapeFor(dom, depth);
  // keep [paste text below] marker at the very end
  const marker = shape.includes("\n\n[paste text below]");
  const shapeCore = marker ? shape.replace("\n\n[paste text below]", "") : shape;
  segs.push({ text: shapeCore, add: depth !== 1 });
  if (depth === 0) segs.push({ text: "No preamble.", add: true });
  if (AUDIENCE[tone]) segs.push({ text: AUDIENCE[tone], add: true });
  for (const m of activeMods) segs.push({ text: m.text, add: true });
  if (marker) segs.push({ text: "\n[paste text below]", add: false });
  return segs;
}

const segsToText = segs => segs.map(s => s.text).join(" ").replace(/ \n/g, "\n").trim();

/* ---------- data ---------- */
const VOCAB = (window.PS_VOCAB || []);
const MODIFIERS = (window.PS_MODS || []);

/* ---------- state ---------- */
const state = { topic: "", domain: null, depth: 1, tone: 1, mods: new Set(), sel: -1, matches: [] };

/* ---------- elements ---------- */
const $ = id => document.getElementById(id);
const q = $("q"), sug = $("sug"), promptEl = $("prompt"), chipsEl = $("chips"),
      countEl = $("count"), toast = $("toast");

/* ---------- suggestions ---------- */
function findMatches(text) {
  const t = text.trim().toLowerCase();
  if (!t) return [];
  const starts = [], contains = [];
  for (const v of VOCAB) {
    const i = v.t.indexOf(t);
    if (i === 0) starts.push(v);
    else if (i > 0) contains.push(v);
  }
  return starts.concat(contains).slice(0, 7);
}

function renderSug() {
  const t = q.value.trim().toLowerCase();
  if (!state.matches.length) { sug.classList.remove("open"); return; }
  sug.innerHTML = state.matches.map((m, i) => {
    const dom = DOMAINS[m.d] || DOMAINS.general;
    const idx = m.t.indexOf(t);
    const label = idx >= 0
      ? m.t.slice(0, idx) + "<b>" + m.t.slice(idx, idx + t.length) + "</b>" + m.t.slice(idx + t.length)
      : m.t;
    return `<div class="s-item${i === state.sel ? " sel" : ""}" data-i="${i}" role="option">
      <span class="em">${dom.em}</span><span>${label}</span><span class="dl">${dom.label}</span></div>`;
  }).join("");
  sug.classList.add("open");
}

function accept(i) {
  const m = state.matches[i];
  if (!m) return;
  q.value = m.t;
  state.topic = m.t;
  state.domain = m.d;
  state.matches = []; state.sel = -1;
  renderSug(); update();
}

/* ---------- chips ---------- */
function renderChips() {
  const domId = state.domain || detectDomain(state.topic || "");
  const scored = MODIFIERS.map((m, i) => ({ m, i, rel: m.doms && m.doms.includes(domId) ? 0 : 1 }));
  scored.sort((a, b) => a.rel - b.rel || a.i - b.i);
  const expanded = chipsEl.dataset.more === "1";
  const shown = expanded ? scored : scored.slice(0, 12);
  chipsEl.innerHTML = shown.map(({ m }) =>
    `<button class="chip${state.mods.has(m.id) ? " on" : ""}" data-id="${m.id}" type="button">${m.label}</button>`
  ).join("") +
  (MODIFIERS.length > 12
    ? `<button class="chip" data-more="1" type="button">${expanded ? "− less" : "+ more"}</button>` : "");
}

chipsEl.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.more) { chipsEl.dataset.more = chipsEl.dataset.more === "1" ? "" : "1"; renderChips(); return; }
  const id = b.dataset.id;
  state.mods.has(id) ? state.mods.delete(id) : state.mods.add(id);
  renderChips(); update();
});

/* ---------- prompt render ---------- */
function currentSegs() {
  const domId = state.domain || detectDomain(state.topic);
  const active = MODIFIERS.filter(m => state.mods.has(m.id));
  return buildPrompt(state.topic, domId, state.depth, state.tone, active);
}

function update() {
  const segs = currentSegs();
  if (!segs.length) {
    promptEl.className = "empty";
    promptEl.textContent = "Your prompt appears here as you type — short, specific, ready to paste.";
    countEl.textContent = "";
    return;
  }
  promptEl.className = "";
  promptEl.innerHTML = segs.map(s =>
    `<span class="${s.add ? "adds" : ""}">${s.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>`
  ).join(" ");
  const text = segsToText(segs);
  countEl.textContent = text.split(/\s+/).length + " words";
}

/* ---------- copy + launch ---------- */
function copyPrompt(silent) {
  const segs = currentSegs();
  if (!segs.length) { q.focus(); return ""; }
  const text = segsToText(segs);
  navigator.clipboard && navigator.clipboard.writeText(text);
  if (!silent) showToast("Copied — paste it into any AI ✦");
  return text;
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 2200);
}

const TOOLS = [
  { name: "ChatGPT",    url: t => "https://chatgpt.com/?q=" + encodeURIComponent(t) },
  { name: "Claude",     url: t => "https://claude.ai/new?q=" + encodeURIComponent(t) },
  { name: "Gemini",     url: null, home: "https://gemini.google.com/app" },
  { name: "Perplexity", url: t => "https://www.perplexity.ai/search?q=" + encodeURIComponent(t) },
];

const launchEl = $("launch");
launchEl.innerHTML = TOOLS.map((t, i) =>
  `<button class="btn" data-t="${i}" type="button">${t.name} ↗</button>`).join("");
launchEl.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  const tool = TOOLS[+b.dataset.t];
  const text = copyPrompt(true);
  if (!text) return;
  if (tool.url) window.open(tool.url(text), "_blank");
  else { window.open(tool.home, "_blank"); showToast("Copied — paste it into " + tool.name + " ✦"); }
});

$("copy").addEventListener("click", () => copyPrompt());

/* ---------- input events ---------- */
q.addEventListener("input", () => {
  state.topic = q.value;
  state.domain = null;          // re-detect while free-typing
  state.matches = findMatches(q.value);
  state.sel = state.matches.length ? 0 : -1;
  renderSug(); renderChips(); update();
});

q.addEventListener("keydown", e => {
  const open = sug.classList.contains("open");
  if (e.key === "ArrowDown" && open) { e.preventDefault(); state.sel = (state.sel + 1) % state.matches.length; renderSug(); }
  else if (e.key === "ArrowUp" && open) { e.preventDefault(); state.sel = (state.sel - 1 + state.matches.length) % state.matches.length; renderSug(); }
  else if (e.key === "Tab" && open && state.sel >= 0) { e.preventDefault(); accept(state.sel); }
  else if (e.key === "Enter") {
    e.preventDefault();
    if (open && state.sel >= 0) accept(state.sel);
    else copyPrompt();
  }
  else if (e.key === "Escape") { state.matches = []; renderSug(); }
});

sug.addEventListener("mousedown", e => {
  const item = e.target.closest(".s-item");
  if (item) { e.preventDefault(); accept(+item.dataset.i); }
});

document.addEventListener("click", e => {
  if (!e.target.closest(".inputwrap")) { state.matches = []; renderSug(); }
});

/* ---------- sliders ---------- */
const depthLabels = ["TL;DR", "Standard", "Deep"];
const toneLabels = ["Beginner", "Anyone", "Expert"];
$("depth").addEventListener("input", e => { state.depth = +e.target.value; $("depthOut").textContent = depthLabels[state.depth]; update(); });
$("tone").addEventListener("input", e => { state.tone = +e.target.value; $("toneOut").textContent = toneLabels[state.tone]; update(); });

/* ---------- init ---------- */
$("vocabnote").textContent = VOCAB.length ? VOCAB.length + " starter ideas built in." : "";
renderChips(); update();

/* deep link: #t=<topic> */
const hash = new URLSearchParams(location.hash.slice(1));
if (hash.get("t")) { q.value = hash.get("t"); q.dispatchEvent(new Event("input")); }
