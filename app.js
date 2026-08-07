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
  local:     { em:"📍", label:"Nearby",    base:t=>`Recommend: ${t}.`, shapes:[
    "Top 3 only — name plus one line each.",
    "Top 5 in a table (name, why it's worth it, cost).",
    "Top 7 in a table (name, why, cost, time needed), grouped by area, plus the one tourist trap to skip." ]},
  decide:    { em:"🤔", label:"Decide",    base:t=>`Help me decide: ${t}.`, shapes:[
    "Your pick in one sentence, with the reason.",
    "Compare the options in a small table, then your pick in 2 sentences. If it depends, tell me the one deciding question.",
    "Compare in a table (option, best for, biggest risk), your pick with reasoning, and the deciding question if it depends." ]},
  summarize: { em:"📝", label:"Summarize", base:t=>`Summarize: ${t}.`, shapes:[
    "One-sentence bottom line only.\n\n[paste text below]",
    "5 bullets max, under 15 words each, keep numbers exact, then \"Bottom line:\" in one sentence.\n\n[paste text below]",
    "Key points grouped by theme, numbers exact, then \"Bottom line:\" and one thing the author underplays.\n\n[paste text below]" ]},
  analyze:   { em:"📊", label:"Analyze",   base:t=>`Analyze: ${t}.`, shapes:[ null,
    "Findings in a short table (finding, evidence, confidence), then the 2 actions you'd take. Flag anything surprising.", null ]},
  image:     { em:"🖼️", label:"Image",     base:t=>`Write one image-generation prompt for: ${t}.`, shapes:[
    "One flowing line: subject, style, mood. Nothing else.",
    "One flowing line covering subject, style, lighting, composition, mood — then a short negative prompt.",
    "Three variants (photoreal, illustration, minimal), each one flowing line, each with a short negative prompt." ]},
  agent:     { em:"🤖", label:"Agent",     base:t=>`Take this on end to end: ${t}.`, shapes:[
    "Plan briefly, do it, verify it works, then report: done and how verified, or blocked and why.",
    "Plan first: milestones, one line each. Execute step by step, verifying each before moving on. Stay in scope. Ask before anything destructive; if blocked, report what you need. Finish with what changed and how you verified it.",
    "Plan first: milestones and the main risk of each. Execute in small reversible steps, checkpointing progress after each milestone in one line. Ask before anything destructive; if blocked twice on the same thing, stop and report exactly what you need. Finish with a report: end state, how it is verified, what remains." ]},
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
  ["summarize",/\b(summariz|summary|tl;?dr|key points|recap|condense)/i],
  ["cook",    /\b(recipe|cook|bake|dinner|meal|marinade|air fryer|slow cooker)\b/i],
  ["local",   /\b(near me|nearby|nearest|closest|around here|in town|directions to|places to (see|eat|visit)|hidden gems|things to do|day trips?)\b/i],
  ["travel",  /\b(trip|itinerary|travel|vacation|days? in|visit)\b/i],
  // "on a budget" is a constraint on some other ask, not a finance question
  ["money",   /\b(invest|salary|mortgage|loan|savings?|retire|tax|debt|401k|credit)\b|\bbudgeting\b|\bbudget (for|of|plan|breakdown|spreadsheet)\b|\bmy budget\b/i],
  ["fit",     /\b(workout|gym|exercise|run(ning)?|strength|cardio|stretch|muscle)\b/i],
  ["health",  /\b(sleep|diet|pain|symptom|doctor|anxiety|stress|vitamin|allerg)\b/i],
  ["parent",  /\b(toddler|baby|kid|child|teen|potty|tantrum)\b/i],
  ["decide",  /\b(vs\.?|versus|should i|or should|which is|better|worth it|choose|decide)\b/i],
  ["shop",    /\b(buy|best (cheap|budget)|under \$|which .*to get|recommend a)\b/i],
  ["write",   /\b(write|draft|essay|blog|post|caption|bio|speech|story|resume|cover letter)\b/i],
  ["image",   /\b(image|logo|illustration|poster|icon|midjourney|art)\b/i],
  ["plan",    /\b(plan|organize|checklist|prepare|schedule)\b/i],
  ["math",    /\b(calculate|solve|equation|percent|probability|geometry)\b/i],
  ["learn",   /\b(explain|what is|what are|how does|difference between|understand|learn)\b/i],
  ["agent",   /\b(automate|workflow|step by step task|pipeline|agent)\b/i],
];

/* When no topic cue fires, what the user WANTS is the next best evidence for
   which domain to frame the ask as. "my wifi keeps dropping" names no domain
   noun, but the goal is unmistakably to fix something. */
const INTENT_DOMAIN = {
  fix: "tech", make: "write", explore: "create", plan: "plan", delegate: "agent",
  find: "local", decide: "decide", understand: "learn", check: "analyze",
};

/* Domains that produce an artifact. Asking to *review* one is the opposite
   job — "review my resume" must not be framed as "draft this". */
const ARTIFACT_DOMAINS = new Set(["write", "email", "code", "create", "image"]);

function detectDomain(text) {
  const r = INTENT ? INTENT.recognize(text) : null;
  /* A confident hand-off outranks topic keywords: "refactor my codebase" is
     agent work that HAPPENS to be about code, not a request for code. */
  if (r && r.id === "delegate" && r.confidence >= 0.5) return "agent";
  for (const [id, re] of SIGS) {
    if (!re.test(text)) continue;
    if (r && r.id === "check" && r.confidence >= 0.6 && ARTIFACT_DOMAINS.has(id)) return "analyze";
    return id;
  }
  if (r && r.confidence >= 0.5 && INTENT_DOMAIN[r.id]) return INTENT_DOMAIN[r.id];
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

/* Preconditions, not formatting: information the model simply cannot answer
   well without. These survive every steer level, including Native — telling a
   model to ask where you are is not telling it how to write. */
const NEEDS = {
  local: "Ask where I am first if it changes the answer.",
  summarize: "Work only from the text I paste below.",
};

/* Delegated work is not one thing. Each class of task has its own real proof
   and its own way of going wrong, so the harness names the actual evidence
   and the actual safety rule for THAT class — "verified" by test output is
   not "verified" by row counts. First match wins; checked most-specific
   first. These are content preconditions, so they survive every steer level. */
const AGENT_CLASSES = [
  { sig: /\b(database|db|schema|migrations?|migrate|tables?|records|dataset)\b/i,
    line: "Back up first. Verify each step with a count or checksum; never drop data without asking." },
  { sig: /\b(keep|watch|monitor(ing)?|alerts?|logs?|uptime|green)\b/i,
    line: "This is ongoing: say what you'll check, how often, and what triggers action — then verify the first check live." },
  { sig: /\b(files?|folders?|inbox|photos|downloads|organi[sz]e|rename|clean ?up)\b/i,
    line: "Dry run first: list what would change and wait for my OK before changing anything." },
  { sig: /\b(repo|repos|codebase|refactor|ci|cd|tests?|dependenc|deploy|pipeline|prs?|website|app)\b/i,
    line: "Verify with the tests before and after; work in small commits; paste the output that proves it passes." },
];
function agentNeed(domId, t) {
  if (domId !== "agent") return null;
  for (const c of AGENT_CLASSES) if (c.sig.test(t)) return c.line;
  return null;
}

/* An agent is briefed like an operator, not like a search box: a mission with
   a verifiable end state, then the rules of engagement. "Done when" is the
   centerpiece — the single line that most determines whether a long-horizon
   agent succeeds — and it is derived from the task class, because "done" for
   a database migration is checksums, not vibes. */
const AGENT_BRIEF = [
  { sig: /\b(database|db|schema|migrations?|migrate|tables?|records|dataset)\b/i,
    done: "the change is applied and a count or checksum check passes",
    verify: "run the count/checksum before and after; paste both",
    rule: "back up first; never drop data without asking" },
  { sig: /\b(keep|watch|monitor(ing)?|alerts?|logs?|uptime|green)\b/i,
    done: "the first check has run live and you've shown me its output",
    verify: "say what you'll check, how often, and what triggers action; verify the first check live",
    rule: "report changes in what you observe, don't act on them without asking" },
  { sig: /\b(files?|folders?|inbox|photos|downloads|organi[sz]e|rename|clean ?up)\b/i,
    done: "the approved dry-run list has been applied, nothing else",
    verify: "dry run first: list what would change and wait for my OK",
    rule: "never delete — move aside instead" },
  { sig: /\b(repo|repos|codebase|refactor|ci|cd|tests?|dependenc|deploy|pipeline|prs?|website|app)\b/i,
    done: "the tests pass before and after, with output pasted",
    verify: "paste the output that proves it passes",
    rule: "work in small commits; stay in scope" },
];
const AGENT_BRIEF_DEFAULT = {
  done: "you can show evidence it worked, not just say so",
  verify: "state how you verified it, with the evidence",
  rule: "stay in scope",
};

function buildBrief(t, depth, activeMods, drill) {
  const cls = AGENT_BRIEF.find(c => c.sig.test(t)) || AGENT_BRIEF_DEFAULT;
  const segs = [{ text: `Mission: ${t}.`, add: false, kind: "base", label: "Mission" }];
  const B = (label, body, kind) =>
    segs.push({ text: `\n${label}: ${body}.`, add: false, kind: kind || "brief", label });
  B("Done when", cls.done);
  if (depth >= 1) B("Plan first", "milestones, one line each" +
    (depth >= 2 ? ", with the main risk of each; checkpoint after each milestone" : ""), "shape");
  B("Ground rules", cls.rule + "; ask before anything destructive or irreversible" +
    (depth >= 2 ? "; if blocked twice on one thing, stop and ask" : ""));
  if (depth >= 1) B("Verify", cls.verify);
  B("Report", depth === 0
    ? "one line — done and how verified, or blocked and why"
    : "what changed, how you verified it, what remains");
  for (const m of activeMods) segs.push({ text: m.text, add: true, kind: "mod", modId: m.id });
  if (drill) segs.push({ text: DRILL, add: false, kind: "drill" });
  return segs;
}

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

/* One line that turns every answer into progressive disclosure:
   tight reply first, numbered drill-downs the user can pick from. */
const DRILL = "End with 3 numbered one-line ways to go deeper; I'll pick by number.";

/* Build the prompt as typed segments — every piece knows what produced it,
   so the rendered prompt can be edited by clicking the piece itself. */
function buildPrompt(topic, domId, depth, tone, activeMods, drill) {
  const dom = DOMAINS[domId] || DOMAINS.general;
  let t = topic.trim().replace(/\s+/g, " ").replace(/[.?!]+$/, "");
  if (STRIPS[domId]) {
    const stripped = t.replace(STRIPS[domId], "");
    if (stripped.trim()) t = stripped.trim();
  }
  if (!t) return [];
  if (domId === "agent") return buildBrief(t, depth, activeMods, drill);
  const segs = [{ text: dom.base(t), add: false, kind: "base" }];
  if (NEEDS[domId] && !state.noNeed) segs.push({ text: NEEDS[domId], add: true, kind: "need" });
  const classNeed = agentNeed(domId, t);
  if (classNeed && !state.noNeed) segs.push({ text: classNeed, add: true, kind: "need" });
  const shape = shapeFor(dom, depth);
  // keep [paste text below] marker at the very end
  const marker = shape.includes("\n\n[paste text below]");
  const shapeCore = marker ? shape.replace("\n\n[paste text below]", "") : shape;
  segs.push({ text: shapeCore, add: depth !== 1, kind: "shape" });
  if (depth === 0) segs.push({ text: "No preamble.", add: true, kind: "shape" });
  if (AUDIENCE[tone]) segs.push({ text: AUDIENCE[tone], add: true, kind: "aud" });
  for (const m of activeMods) segs.push({ text: m.text, add: true, kind: "mod", modId: m.id });
  if (drill && domId !== "image" && state.steer !== "native")
    segs.push({ text: DRILL, add: false, kind: "drill" });
  if (marker) segs.push({ text: "\n[paste text below]", add: false, kind: "marker" });
  return segs;
}

const segsToText = segs => segs.map(s => s.text).join(" ").replace(/ \n/g, "\n").trim();

/* ---------- data ---------- */
const VOCAB = (window.PS_VOCAB || []);
const MODIFIERS = (window.PS_MODS || []);
const GOLD = (window.PS_GOLD || []);

/* ---------- similarity engine ----------
   Two-tower-style matching in the browser: both the query and every entry are
   embedded into the same sparse IDF-weighted token space and scored by cosine,
   blended with character-trigram Jaccard so typos and word-order changes still
   land. Cheap enough to score every entry on every keystroke. */

const tokenize = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
function trigrams(s) {
  s = " " + s.toLowerCase() + " ";
  const out = new Set();
  for (let i = 0; i < s.length - 2; i++) out.add(s.slice(i, i + 3));
  return out;
}

const SIM = (() => {
  const docs = [];
  VOCAB.forEach((v, i) => docs.push({ t: v.t, ref: { type: "vocab", i } }));
  GOLD.forEach((g, i) => docs.push({ t: g.q, ref: { type: "gold", i } }));
  const df = new Map();
  for (const d of docs) {
    d.toks = tokenize(d.t);
    for (const tok of new Set(d.toks)) df.set(tok, (df.get(tok) || 0) + 1);
  }
  const N = docs.length || 1;
  const idf = tok => Math.log(1 + N / (df.get(tok) || 1));
  for (const d of docs) {
    d.vec = new Map(d.toks.map(tok => [tok, idf(tok)]));
    d.norm = Math.sqrt([...d.vec.values()].reduce((s, x) => s + x * x, 0)) || 1;
    d.tris = trigrams(d.t);
  }
  return { docs, idf, df };
})();

function embedQuery(text) {
  const toks = tokenize(text);
  // a final token the corpus has never seen and that isn't followed by a space
  // is still being typed — treat it as a prefix, not a full token, so
  // "japan itin" matches "7 day japan itinerary"
  let part = null;
  if (!/\s$/.test(text) && toks.length > 1 && !SIM.df.has(toks[toks.length - 1]))
    part = toks.pop();
  const vec = new Map(toks.map(tok => [tok, SIM.idf(tok)]));
  const norm = Math.sqrt([...vec.values()].reduce((s, x) => s + x * x, 0)) || 1;
  return { vec, norm, tris: trigrams(text), part };
}

function score(qEmb, d) {
  let dot = 0;
  for (const [tok, w] of qEmb.vec) if (d.vec.has(tok)) dot += w * d.vec.get(tok);
  const cos = dot / (qEmb.norm * d.norm);
  let inter = 0;
  for (const t of qEmb.tris) if (d.tris.has(t)) inter++;
  const jac = inter / (qEmb.tris.size + d.tris.size - inter || 1);
  let s = 0.7 * cos + 0.3 * jac;
  if (qEmb.part && d.toks.some(t => t.startsWith(qEmb.part))) s += 0.2;
  return s;
}

/* ---------- state ---------- */
const state = { topic: "", domain: null, depth: 1, tone: 1, mods: new Set(), sel: -1, matches: [],
                drill: true, gold: null, reason: "auto", graphOpen: false, steer: "guided" };
const REASON = window.PS_REASON;
const INTENT = window.PS_INTENT;

/* ---------- elements ---------- */
const $ = id => document.getElementById(id);
const q = $("q"), sug = $("sug"), promptEl = $("prompt"), chipsEl = $("chips"),
      countEl = $("count"), toast = $("toast");

/* ---------- suggestions ----------
   Pipeline: gold-cache similarity hits (pinned, ★) → exact prefix →
   substring → similarity fallback for typos and reworded asks. */
function findMatches(text) {
  const t = text.trim().toLowerCase();
  if (!t) return [];
  const qEmb = embedQuery(t);

  const golds = [];
  if (t.length >= 3) {
    for (const d of SIM.docs) {
      if (d.ref.type !== "gold") continue;
      const g = GOLD[d.ref.i];
      const s = d.t.startsWith(t) ? 1 : score(qEmb, d);
      if (s >= 0.45) golds.push({ t: g.q, d: g.d, gold: g, s });
    }
    golds.sort((a, b) => b.s - a.s);
    golds.length = Math.min(golds.length, 2);
  }

  const starts = [], contains = [];
  for (const v of VOCAB) {
    const i = v.t.indexOf(t);
    if (i === 0) starts.push(v);
    else if (i > 0) contains.push(v);
  }
  let out = golds.concat(
    starts.concat(contains).filter(v => !golds.some(g => g.t === v.t))
  );

  if (out.length < 7 && t.length >= 4) {
    const fuzzy = [];
    for (const d of SIM.docs) {
      if (d.ref.type !== "vocab") continue;
      const v = VOCAB[d.ref.i];
      if (out.some(o => o.t === v.t)) continue;
      const s = score(qEmb, d);
      if (s >= 0.34) fuzzy.push({ ...v, s });
    }
    fuzzy.sort((a, b) => b.s - a.s);
    out = out.concat(fuzzy);
  }
  return out.slice(0, 7);
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
    const em = m.gold ? "★" : dom.em;
    const dl = m.gold ? "★ tuned" : dom.label;
    return `<div class="s-item${i === state.sel ? " sel" : ""}${m.gold ? " s-gold" : ""}" data-i="${i}" role="option">
      <span class="em">${em}</span><span>${label}</span><span class="dl">${dl}</span></div>`;
  }).join("");
  sug.classList.add("open");
}

function accept(i) {
  const m = state.matches[i];
  if (!m) return;
  q.value = m.t;
  state.topic = m.t;
  state.domain = m.d;
  state.gold = m.gold || null;
  state.matches = []; state.sel = -1;
  renderSug(); renderChips(); update();
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
/* the reasoning layer decides, from the ask's own structure, how much
   thinking to buy — and phrases it so depth never becomes length.
   A multi-constraint ask also gets one completeness guard, but only when no
   scaffold already points the model at those constraints: two lines saying
   the same thing is two lines too many. */
function reasonSegs(domId) {
  if (!REASON || !state.topic.trim()) return [];
  const m = REASON.analyze(state.topic);
  const out = REASON.scaffoldFor(m, domId, state.reason, state.steer === "native" ? "native" : "shaped")
    .map(s => ({ text: s.text, add: true, kind: s.kind }));
  /* What the graph found about the problem's structure. Native stays the
     user's own words plus their goal, so structural guidance waits for a
     steer level that has asked for help. */
  if (state.steer !== "native" && state.reason !== "off" && !state.noGraph)
    out.push(...REASON.graphFindings(m).map(s => ({ text: s.text, add: true, kind: s.kind })));
  const covered = out.some(s => /my constraints/.test(s.text));
  if (!state.noMulti && m.constraints >= 2 && !covered)
    out.unshift({ text: "Cover every constraint I stated.", add: true, kind: "multi" });
  return out;
}

/* What the user WANTS, stated once — never how to format it. */
function intentSegs() {
  if (!INTENT || state.noIntent || !state.topic.trim()) return [];
  const r = INTENT.recognize(state.topic);
  const out = [];
  if (r.line && r.confidence >= 0.4) out.push({ text: r.line, add: true, kind: "intent" });
  // when the goal genuinely isn't readable, asking beats guessing wrong —
  // a bare topic ("sourdough") is the clearest case of all
  else if (r.confidence < 0.35)
    out.push({ text: INTENT.CLARIFY, add: true, kind: "intent" });
  return out;
}

const tidy = t => {
  const s = t.trim().replace(/\s+/g, " ");
  return (s.charAt(0).toUpperCase() + s.slice(1)) + (/[.?!]$/.test(s) ? "" : ".");
};

function currentSegs() {
  const active = MODIFIERS.filter(m => state.mods.has(m.id));

  /* Native: the ask in the user's own words, aimed by intent, then out of the
     way. No answer shape, no size cap, no follow-up menu — the model answers
     the way it would answer a person. */
  if (state.steer === "native") {
    if (!state.topic.trim()) return [];
    const domId = state.domain || detectDomain(state.topic);
    const segs = [{ text: tidy(state.gold ? state.gold.q : state.topic), add: false, kind: "base" }];
    if (NEEDS[domId] && !state.noNeed) segs.push({ text: NEEDS[domId], add: true, kind: "need" });
    const nClassNeed = agentNeed(domId, state.topic);
    if (nClassNeed && !state.noNeed) segs.push({ text: nClassNeed, add: true, kind: "need" });
    segs.push(...intentSegs());
    if (AUDIENCE[state.tone]) segs.push({ text: AUDIENCE[state.tone], add: true, kind: "aud" });
    for (const m of active) segs.push({ text: m.text, add: true, kind: "mod", modId: m.id });
    segs.push(...reasonSegs(domId));
    return segs;
  }

  if (state.gold) {
    // cached hand-tuned prompt for a top query: served as-is, still composable
    const g = state.gold;
    const segs = [{ text: g.p, add: false, kind: "base" }];
    if (state.steer === "guided") segs.push(...intentSegs());
    if (AUDIENCE[state.tone]) segs.push({ text: AUDIENCE[state.tone], add: true, kind: "aud" });
    for (const m of active) segs.push({ text: m.text, add: true, kind: "mod", modId: m.id });
    segs.push(...reasonSegs(g.d));
    if (state.drill && g.d !== "image") segs.push({ text: DRILL, add: false, kind: "drill" });
    return segs;
  }
  const domId = state.domain || detectDomain(state.topic);
  const segs = buildPrompt(state.topic, domId, state.depth, state.tone, active, state.drill);
  if (!segs.length) return segs;
  /* Guided: keep the domain's framing and the follow-up menu, but drop the
     answer-shape sentence and its size caps — say what's wanted, not how long
     the reply may be. */
  if (state.steer === "guided") {
    // the mission brief is a behavioral contract, not an answer shape — keep it whole
    if (domId !== "agent")
      for (let i = segs.length - 1; i >= 0; i--) if (segs[i].kind === "shape") segs.splice(i, 1);
    segs.splice(1, 0, ...intentSegs());
  }
  // reasoning goes before the go-deeper menu and the paste marker
  const at = segs.findIndex(s => s.kind === "drill" || s.kind === "marker");
  const rs = reasonSegs(domId);
  if (at === -1) segs.push(...rs); else segs.splice(at, 0, ...rs);
  return segs;
}

const SEG_HINTS = {
  shape: "Click to change depth",
  aud: "Click to remove",
  mod: "Click to remove",
  multi: "Click to remove",
  intent: "What the app thinks you want — click to remove",
  need: "Click to remove",
  graph: "Found by the intent graph — click to remove",
  reason: "Added by the reasoning layer — click to turn reasoning off",
  verify: "Added by the reasoning layer — click to turn reasoning off",
  drill: "Click to remove the go-deeper menu",
};

function syncExamples() {
  // looked up lazily: update() runs during init, before the examples row renders
  const el = document.getElementById("examples");
  if (el) el.style.display = state.topic.trim() ? "none" : "flex";
}

function update() {
  syncExamples();
  const segs = currentSegs();
  if (!segs.length) {
    promptEl.className = "empty";
    promptEl.textContent = "Your prompt appears here as you type — short, specific, ready to paste. Click any part of it to change or remove that part.";
    countEl.textContent = "";
    return;
  }
  promptEl.className = "";
  promptEl.innerHTML = segs.map((s, i) => {
    const hint = SEG_HINTS[s.kind];
    const cls = (s.add ? "adds" : "") + (hint ? " seg" : "");
    const attrs = hint ? ` data-i="${i}" title="${hint}"` : "";
    let body = s.text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    if (s.label) {
      const at = body.indexOf(s.label + ":");
      if (at >= 0) body = body.slice(0, at) + "<b>" + s.label + ":</b>" + body.slice(at + s.label.length + 1);
    }
    return `<span class="${cls.trim()}"${attrs}>${body}</span>`;
  }).join(" ");
  const text = segsToText(segs);
  countEl.textContent = text.split(/\s+/).length + " words";
  renderMetrics();
}

/* ---------- reasoning readout: the graph the layer actually measured ---------- */
const metricsEl = $("metrics"), graphEl = $("graph");

function renderMetrics() {
  if (!REASON || !state.topic.trim()) { metricsEl.innerHTML = ""; graphEl.classList.remove("open"); return; }
  const m = REASON.analyze(state.topic);
  const spent = state.reason === "off" ? "no reasoning spent"
    : REASON.scaffoldFor(m, state.domain || detectDomain(state.topic), state.reason).length
      ? "reasoning spent" : "no reasoning needed";
  const r = INTENT ? INTENT.recognize(state.topic) : null;
  const wants = r && r.confidence >= 0.4
    ? `<span class="want">wants: ${r.label}</span>`
    : `<span class="want">goal unclear — will ask</span>`;
  /* three plain pills; the graph detail (topics, constraints, node counts)
     waits behind the badge for whoever actually wants it */
  metricsEl.innerHTML = wants +
    `<button class="cx" data-l="${m.level}" type="button" title="How complex this ask is — click to see why">` +
    `L${m.level} ${REASON.LEVEL_NAME[m.level]}</button>` +
    `<span>${spent}</span>`;
  if (state.graphOpen) drawGraph(m); else graphEl.classList.remove("open");
}

metricsEl.addEventListener("click", e => {
  if (!e.target.closest(".cx")) return;
  state.graphOpen = !state.graphOpen;
  renderMetrics();
});

/* a small radial view: the ask at the centre, topics around it, constraints
   attached to the ring — the structure the level was derived from */
function drawGraph(m) {
  const W = 560, H = 150, cx = W / 2, cy = H / 2;
  const ents = m.entities.slice(0, 6);
  const parts = [];
  const g = m.graph;
  parts.push(`<div style="font-size:12px;color:var(--muted);padding-bottom:2px">${m.why}` +
    (g ? ` · ${g.n} ${g.n === 1 ? "node" : "nodes"}, ${g.m} ${g.m === 1 ? "link" : "links"}` : "") + `</div>`);
  parts.push(`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="intent graph">`);
  const R = 52;
  ents.forEach((word, i) => {
    const a = (i / Math.max(ents.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * (R + 46), y = cy + Math.sin(a) * R;
    parts.push(`<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="currentColor" stroke-opacity=".22"/>`);
    parts.push(`<circle cx="${x}" cy="${y}" r="4.5" fill="currentColor" fill-opacity=".45"/>`);
    const anchor = x < cx ? "end" : "start";
    parts.push(`<text x="${x + (x < cx ? -8 : 8)}" y="${y + 3}" text-anchor="${anchor}">${
      word.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`);
  });
  parts.push(`<circle cx="${cx}" cy="${cy}" r="9" fill="currentColor" fill-opacity=".8"/>`);
  parts.push(`<text x="${cx}" y="${cy + 24}" text-anchor="middle">ask</text>`);
  // constraint ring: one tick per constraint bounding the whole ask
  for (let i = 0; i < Math.min(m.constraints, 8); i++) {
    const a = (i / 8) * Math.PI * 2;
    parts.push(`<circle cx="${cx + Math.cos(a) * 20}" cy="${cy + Math.sin(a) * 20}" r="2.5" fill="currentColor" fill-opacity=".5"/>`);
  }
  parts.push("</svg>");
  graphEl.innerHTML = parts.join("");
  graphEl.classList.add("open");
}

/* the prompt itself is the control surface: click a piece to edit it */
promptEl.addEventListener("click", e => {
  const span = e.target.closest(".seg");
  if (!span) return;
  const seg = currentSegs()[+span.dataset.i];
  if (!seg) return;
  if (seg.kind === "mod") { state.mods.delete(seg.modId); renderChips(); }
  else if (seg.kind === "aud") { state.tone = 1; $("tone").value = "1"; $("toneOut").textContent = toneLabels[1]; }
  else if (seg.kind === "shape") { state.depth = (state.depth + 1) % 3; $("depth").value = String(state.depth); $("depthOut").textContent = depthLabels[state.depth]; }
  else if (seg.kind === "multi") state.noMulti = true;
  else if (seg.kind === "intent") state.noIntent = true;
  else if (seg.kind === "need") state.noNeed = true;
  else if (seg.kind === "graph") state.noGraph = true;
  else if (seg.kind === "reason" || seg.kind === "verify") { state.reason = "off"; syncReasonUI(); }
  else if (seg.kind === "drill") { state.drill = false; syncDrillUI(); }
  update();
});

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
  state.gold = null;            // typing leaves the cached prompt
  state.noMulti = false;
  state.noIntent = false;
  state.noNeed = false;
  state.noGraph = false;
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

/* details-on-demand toggle */
function syncDrillUI() {
  const b = $("drill");
  b.classList.toggle("on", state.drill);
  b.setAttribute("aria-pressed", String(state.drill));
  $("drillOut").textContent = state.drill ? "On" : "Off";
}
$("drill").addEventListener("click", () => { state.drill = !state.drill; syncDrillUI(); update(); });
syncDrillUI();

/* steer: how much the prompt is allowed to shape the model's reply */
const STEER_MODES = ["native", "guided", "shaped"];
const STEER_LABEL = { native: "Native", guided: "Guided", shaped: "Shaped" };
const STEER_HINT = {
  native: "model's own voice",
  guided: "say what I want",
  shaped: "fix the answer's form",
};
function syncSteerUI() {
  $("steer").textContent = STEER_LABEL[state.steer];
  $("steerOut").textContent = STEER_HINT[state.steer];
  // Depth only means anything when the prompt is shaping the answer
  $("depthWrap").style.display = state.steer === "shaped" ? "" : "none";
  // so does the follow-up menu
  $("drill").disabled = state.steer === "native";
  $("drill").style.opacity = state.steer === "native" ? ".4" : "";
}
$("steer").addEventListener("click", () => {
  state.steer = STEER_MODES[(STEER_MODES.indexOf(state.steer) + 1) % STEER_MODES.length];
  syncSteerUI(); update();
});
syncSteerUI();

/* reasoning mode: auto (spend only when the structure earns it) → always → off */
const REASON_MODES = ["auto", "force", "off"];
const REASON_LABEL = { auto: "Auto", force: "Always", off: "Off" };
// the button already names the mode — the label says what the mode does
const REASON_HINT = { auto: "when earned", force: "forced", off: "never" };
function syncReasonUI() {
  $("reason").textContent = REASON_LABEL[state.reason];
  $("reasonOut").textContent = REASON_HINT[state.reason];
}
$("reason").addEventListener("click", () => {
  state.reason = REASON_MODES[(REASON_MODES.indexOf(state.reason) + 1) % REASON_MODES.length];
  syncReasonUI(); update();
});
syncReasonUI();

/* ---------- init ---------- */
$("vocabnote").textContent = VOCAB.length
  ? VOCAB.length + " starter ideas" + (GOLD.length ? " + " + GOLD.length + " hand-tuned top prompts" : "") + " built in."
  : "";
renderChips(); update();

/* ---------- first-run intuitiveness: show, don't explain ---------- */

/* One example per flavour of ask — tapping one demonstrates the whole app
   faster than any copy could. Shown only while the box is empty. */
const EXAMPLES = [
  "explain machine learning",
  "10 days in japan with kids on a tight budget",
  "fix my resume",
  "set up ci for my repo",
];
const examplesEl = $("examples");
examplesEl.innerHTML = `<span class="exlabel">Try one:</span>` +
  EXAMPLES.map(e => `<button class="chip" type="button">${e}</button>`).join("");
examplesEl.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  q.value = b.textContent;
  q.dispatchEvent(new Event("input"));
  state.matches = []; renderSug();
  q.focus();
});

/* the expert controls live behind one calm disclosure */
const tuneEl = $("tune"), tuneBtn = $("tunebtn");
tuneBtn.addEventListener("click", () => {
  const open = tuneEl.classList.toggle("open");
  tuneBtn.textContent = open ? "Fine-tune ▾" : "Fine-tune ▸";
  tuneBtn.setAttribute("aria-expanded", String(open));
});

/* deep link: #t=<topic>, applied on load and on hash change */
function applyHash() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const t = hash.get("t");
  if (t) { q.value = t; q.dispatchEvent(new Event("input")); state.matches = []; renderSug(); }
}
window.addEventListener("hashchange", applyHash);
applyHash();
