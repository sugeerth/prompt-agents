/* PromptEngine — client-side prompt recommendation framework.
   Zero dependencies, zero network. Detect intent → score against a 7-dimension
   rubric → recommend a stronger rewrite → predict useful continuations. */

export const INTENTS = [
  { id: "code",      label: "Code generation",  sig: /\b(code|function|implement|script|class|python|javascript|typescript|api|refactor|algorithm|sql|regex|component)\b/i },
  { id: "debug",     label: "Debugging",        sig: /\b(error|bug|fix|traceback|exception|not working|fails?|crash|debug|undefined|stack ?trace)\b/i },
  { id: "writing",   label: "Writing & editing",sig: /\b(write|essay|email|blog|article|rewrite|edit|draft|story|letter|cover letter|linkedin post|tweet)\b/i },
  { id: "summarize", label: "Summarization",    sig: /\b(summar|tl;?dr|condense|key points|shorten|digest|recap)\b/i },
  { id: "analysis",  label: "Data analysis",    sig: /\b(analyz|analyse|data|compare|evaluate|metrics?|trends?|pros and cons|csv|dataset|statistics)\b/i },
  { id: "learning",  label: "Learning",         sig: /\b(explain|what is|what are|how does|how do|teach|understand|difference between|eli5|intuition)\b/i },
  { id: "brainstorm",label: "Brainstorming",    sig: /\b(ideas?|brainstorm|suggest|options|names?|alternatives|creative|possibilities)\b/i },
  { id: "image",     label: "Image generation", sig: /\b(image|logo|illustration|photo|picture|art style|render|icon|poster|midjourney|diffusion)\b/i },
  { id: "agent",     label: "Agents & automation", sig: /\b(agents?|automate|workflow|multi-?step|pipeline|orchestrat|tool call|browse|scrape|schedule|cron)\b/i },
  { id: "general",   label: "General",          sig: /./ },
];

export function detectIntent(text) {
  const t = text.toLowerCase();
  let best = INTENTS[INTENTS.length - 1], bestN = 0;
  for (const intent of INTENTS.slice(0, -1)) {
    const m = t.match(new RegExp(intent.sig.source, "gi"));
    const n = m ? m.length : 0;
    if (n > bestN) { best = intent; bestN = n; }
  }
  return best;
}

/* ---- rubric: 7 dimensions, each with detector, weight, and per-intent fix ---- */

const FIXES = {
  role: {
    code: "You are a senior software engineer who writes production-quality, well-tested code.",
    debug: "You are a senior engineer doing root-cause analysis; you reason from evidence, not guesses.",
    writing: "You are a sharp editor with a clear, concrete, no-fluff style.",
    summarize: "You are a precise analyst who preserves key facts and numbers.",
    analysis: "You are a data analyst who states assumptions and quantifies uncertainty.",
    learning: "You are a patient expert teacher who builds intuition before formalism.",
    brainstorm: "You are a creative strategist who generates diverse, non-obvious options.",
    image: "Style direction: (describe the artistic style, mood, and references you want).",
    agent: "You are an autonomous agent; plan first, then execute step by step, verifying as you go.",
    general: "You are an expert assistant; be direct and concrete.",
  },
  context: {
    code: "Context: <language/framework, versions, existing code it must fit into>",
    debug: "Context: <paste the exact error message / stack trace, and the relevant code>",
    writing: "Context: <who it's for, the situation, key facts to include>",
    summarize: "Source: <paste the text to summarize here>",
    analysis: "Data: <paste the data or describe its shape, source, and time range>",
    learning: "My background: <what I already know, so you can pitch the level right>",
    brainstorm: "Context: <the problem, who it's for, what's been tried already>",
    image: "Subject: <main subject, setting, lighting, camera/composition details>",
    agent: "Environment: <what tools/APIs/files the agent can use, and its constraints>",
    general: "Context: <the background the assistant needs to give a good answer>",
  },
  format: {
    code: "Output: the complete code in one block, then a short explanation of key decisions.",
    debug: "Output: (1) most likely root cause, (2) the fix as a diff, (3) how to verify it.",
    writing: "Output: <length> in <tone> tone, structured as <e.g. hook, 3 points, close>.",
    summarize: "Output: 5 bullet points max, each under 20 words, keep all numbers exact.",
    analysis: "Output: a table of findings, then 3 takeaways ranked by impact.",
    learning: "Output: a 2-sentence intuition first, then the detailed explanation, then one example.",
    brainstorm: "Output: 10 options in a table with a one-line rationale each; mark the 3 most promising.",
    image: "Format: <aspect ratio, level of detail, color palette, what to avoid>.",
    agent: "Output: a numbered plan first; after each step, report what was done and verified.",
    general: "Output format: <bullets / table / length limit — say what you want back>.",
  },
  constraints: {
    code: "Constraints: <no new dependencies / must pass existing tests / performance budget>",
    debug: "Constraints: smallest possible change; do not refactor unrelated code.",
    writing: "Constraints: <words to avoid, reading level, things that must not be claimed>",
    summarize: "Constraints: no interpretation or opinion — only what the source says.",
    analysis: "Constraints: state confidence for each claim; separate correlation from causation.",
    learning: "Constraints: no jargon without defining it first.",
    brainstorm: "Constraints: <budget, time, brand, technical limits the ideas must respect>",
    image: "Negative: <what must NOT appear — text artifacts, extra limbs, clutter>",
    agent: "Constraints: ask before destructive actions; stop and report if blocked.",
    general: "Constraints: <what to avoid, limits to respect>",
  },
  examples: {
    code: "Example: given input <X>, the function should return <Y>.",
    writing: "Here's an example of the tone I want: \"<paste a sentence you like>\"",
    image: "Reference: in the style of <artist/work/photo you like>.",
    general: "Example of what good looks like: <paste one>",
  },
  criteria: {
    code: "Success: it compiles, handles the edge cases listed, and a reviewer would approve it.",
    debug: "Success: the original repro no longer fails, and you explain WHY it failed.",
    writing: "Success: <the reader should feel/do X after reading>.",
    summarize: "Success: someone who reads only the summary makes the same decision as someone who read it all.",
    analysis: "Success: each conclusion is traceable to specific data points.",
    learning: "Success: I could re-explain it to a colleague afterwards.",
    brainstorm: "Success: at least 3 ideas I couldn't have thought of myself.",
    image: "Success: usable as-is for <where it will be used>.",
    agent: "Success: the end state is verified, not assumed — show the evidence.",
    general: "Success looks like: <how you'll judge the answer>.",
  },
};

function fixFor(dim, intentId) {
  const table = FIXES[dim];
  return table ? (table[intentId] || table.general) : null;
}

export const RUBRIC = [
  {
    id: "task", name: "Task clarity", weight: 1.4,
    detect: t => {
      const words = t.trim().split(/\s+/).length;
      const hasVerb = /\b(write|create|build|fix|explain|summarize|analyze|generate|make|implement|design|compare|list|draft|refactor|translate|review|plan|find|extract|classify|debug)\b/i.test(t);
      if (words < 4) return 15;
      if (!hasVerb) return 40;
      return Math.min(100, 55 + words * 1.5);
    },
    advice: "Say exactly what you want done — one clear action verb and a concrete deliverable.",
  },
  {
    id: "role", name: "Role / persona", weight: 0.8,
    detect: t => /\b(you are|act as|as a|persona|role:)\b/i.test(t) ? 100 : 0,
    advice: "Give the model a role — it anchors tone, depth, and standards.",
  },
  {
    id: "context", name: "Context provided", weight: 1.3,
    detect: t => {
      const words = t.trim().split(/\s+/).length;
      const cues = (t.match(/\b(context|given|background|currently|my|our|i have|i am|we are|here is|attached|below)\b/gi) || []).length;
      return Math.min(100, cues * 30 + Math.max(0, words - 15) * 1.2);
    },
    advice: "The model only knows what you tell it — add the background, data, or code it needs.",
  },
  {
    id: "format", name: "Output format", weight: 1.1,
    detect: t => /\b(format|bullet|table|json|markdown|list|numbered|paragraphs?|words?|sentences?|sections?|structure|output:|return)\b/i.test(t) ? 100 : 0,
    advice: "Specify the shape of the answer: length, structure, medium.",
  },
  {
    id: "constraints", name: "Constraints", weight: 1.0,
    detect: t => /\b(must|should not|shouldn't|don't|do not|avoid|only|no more than|at most|at least|without|never|limit|except)\b/i.test(t) ? 100 : 0,
    advice: "State boundaries — what to avoid, limits to respect. Constraints prevent generic answers.",
  },
  {
    id: "examples", name: "Examples", weight: 0.7,
    detect: t => /\b(for example|e\.g\.|example:|like this|such as|similar to|here's an example|input:.*output:)\b/i.test(t) ? 100 : 0,
    advice: "One good example beats three paragraphs of description.",
  },
  {
    id: "criteria", name: "Success criteria", weight: 0.9,
    detect: t => /\b(success|so that|goal is|criteria|should result|i'll judge|good looks like|audience|for (my|the|a) (boss|team|recruiter|client|ceo|professor|customer))\b/i.test(t) ? 100 : 0,
    advice: "Say how you'll judge the answer and who it's for.",
  },
];

export function scorePrompt(text) {
  const dims = RUBRIC.map(d => ({ ...d, score: Math.round(d.detect(text)) }));
  const totalW = RUBRIC.reduce((s, d) => s + d.weight, 0);
  const overall = Math.round(dims.reduce((s, d) => s + d.score * d.weight, 0) / totalW);
  const grade = overall >= 85 ? "A" : overall >= 70 ? "B" : overall >= 55 ? "C" : overall >= 35 ? "D" : "F";
  return { overall, grade, dims };
}

/* ---- rewriter: compose a stronger prompt, marking added lines ---- */

export function recommend(text, intent, scored) {
  const lines = [];
  const weak = id => scored.dims.find(d => d.id === id).score < 50;

  if (weak("role")) lines.push({ text: fixFor("role", intent.id), added: true });
  lines.push({ text: "Task: " + text.trim().replace(/\s+/g, " "), added: false });
  if (weak("context")) lines.push({ text: fixFor("context", intent.id), added: true });
  if (weak("constraints")) lines.push({ text: fixFor("constraints", intent.id), added: true });
  if (weak("format")) lines.push({ text: fixFor("format", intent.id), added: true });
  if (weak("criteria")) lines.push({ text: fixFor("criteria", intent.id), added: true });
  if (weak("examples") && fixFor("examples", intent.id) && FIXES.examples[intent.id])
    lines.push({ text: fixFor("examples", intent.id), added: true });

  return lines;
}

export function recommendText(lines) {
  return lines.map(l => l.text).join("\n");
}

/* ---- prediction: curated continuations per intent, shown as type-ahead chips ---- */

const CONTINUATIONS = {
  code: ["…in Python 3, with type hints and docstrings", "…with unit tests using pytest", "…that handles empty input and errors gracefully", "…as a single file with no external dependencies"],
  debug: ["…here is the full error message: ", "…it worked before I changed ", "…expected X but got Y", "…minimal code to reproduce: "],
  writing: ["…in a warm but professional tone", "…under 150 words", "…for a hiring manager who skims", "…with a strong first sentence"],
  summarize: ["…in 5 bullet points", "…keeping all numbers and names exact", "…for someone who hasn't read the original", "…plus one-line takeaway"],
  analysis: ["…and rank findings by impact", "…stating your confidence in each claim", "…in a table with columns: finding, evidence, action", "…flagging anything surprising"],
  learning: ["…starting with the intuition, then the details", "…assuming I know the basics but not the math", "…with one concrete example", "…and the most common misconception"],
  brainstorm: ["…give me 10 options, mark your top 3", "…include at least 2 unconventional ones", "…with a one-line rationale for each", "…that could ship within a week"],
  image: ["…minimalist, lots of negative space", "…soft natural lighting, shallow depth of field", "…flat vector style, 2-color palette", "…no text in the image"],
  agent: ["…plan the steps first, then execute one at a time", "…verify each step before moving on", "…ask before anything destructive", "…report progress after each step"],
  general: ["…be specific and concrete", "…tell me what you'd need to know to do this well", "…give the short answer first, then the detail", "…format the answer as a checklist"],
};

export function predict(text, intent) {
  const base = CONTINUATIONS[intent.id] || CONTINUATIONS.general;
  const t = text.toLowerCase();
  return base.filter(c => !t.includes(c.slice(1, 18).toLowerCase())).slice(0, 4);
}

/* ---- gold prompt library ---- */

export const LIBRARY = [
  { intent: "code", title: "Production-grade function", prompt: "You are a senior software engineer. Write a Python 3 function that <task>. Context: it will run inside <where>, inputs look like <example input>. Constraints: standard library only, handle malformed input by raising ValueError with a clear message. Output: the complete function with type hints and a docstring, then 3 unit tests covering the edge cases you consider most likely to break it. Success: a reviewer merges it without change requests." },
  { intent: "debug", title: "Root-cause a failure", prompt: "You are a senior engineer doing root-cause analysis. Here is the error:\n<paste full traceback>\nHere is the relevant code:\n<paste code>\nIt started failing after <what changed>. Reason from the evidence — list 2–3 candidate causes ranked by likelihood, say what evidence would confirm each, then give the smallest fix as a diff and how to verify it. Do not refactor unrelated code." },
  { intent: "writing", title: "High-stakes email", prompt: "You are a sharp editor. Draft an email to <who> about <what>. Context: <the situation and history>. The reader should come away thinking <desired takeaway> and do <desired action>. Constraints: under 150 words, no filler openings ('I hope this finds you well'), confident but not pushy. Output: subject line + body, then one alternative subject line." },
  { intent: "summarize", title: "Decision-grade summary", prompt: "You are a precise analyst. Summarize the following for <audience> who must decide <decision>:\n<paste source>\nOutput: 5 bullets max, each under 20 words, all numbers exact; then one line: 'Bottom line: …'. Constraints: only what the source says — no interpretation. Success: reading only your summary leads to the same decision as reading everything." },
  { intent: "analysis", title: "Data → ranked actions", prompt: "You are a data analyst who states assumptions explicitly. Analyze this data:\n<paste data or describe shape/source/time range>\nQuestion: <what you want to learn>. Output: a table of findings (finding, evidence, confidence), then 3 recommended actions ranked by expected impact. Constraints: separate correlation from causation; flag data-quality issues before conclusions." },
  { intent: "learning", title: "Build real intuition", prompt: "You are a patient expert teacher. Explain <topic> to someone who knows <my background>. Start with a 2-sentence intuition, then the mechanism step by step, then one concrete worked example, then the single most common misconception. Constraints: define any jargon at first use. Success: I can re-explain it to a colleague tomorrow." },
  { intent: "brainstorm", title: "Divergent options table", prompt: "You are a creative strategist. Generate 10 ideas for <problem>. Context: <who it's for, what's been tried, constraints like budget/time>. Output: a table — idea, one-line rationale, effort (S/M/L), risk. Mark your top 3 and say why. Constraints: at least 2 ideas must be unconventional; none may require <hard limit>." },
  { intent: "image", title: "Art-directed image brief", prompt: "Subject: <main subject doing what, where>. Style: <e.g. minimalist flat vector / cinematic photo>, <color palette>, <mood>. Composition: <framing, negative space, focal point>. Lighting: <e.g. soft golden hour, high-key studio>. Format: <aspect ratio>. Negative: no text, no watermarks, no clutter. Reference: in the spirit of <artist/work>." },
  { intent: "agent", title: "Long-running agent task", prompt: "You are an autonomous agent working over multiple steps. Goal: <end state, stated as something verifiable>. Environment: you can use <tools/files/APIs>. Plan first: list the steps and what could go wrong. Then execute one step at a time; after each, state what you did and how you verified it. Constraints: ask before destructive actions; if blocked, report exactly what you need. Success: the end state is verified with evidence, not assumed." },
  { intent: "agent", title: "Agent evaluation harness", prompt: "You are an evaluation engineer. Design an eval for an agent that <what the agent does>. Output: (1) 5 test scenarios from easy to adversarial, (2) for each, the exact success criterion a script could check, (3) 3 failure modes you'd expect and how the eval catches each, (4) one metric to track over time. Constraints: every criterion must be objectively checkable — no 'seems good'." },
  { intent: "code", title: "Refactor with a safety net", prompt: "You are a senior engineer who refactors in small, verifiable steps. Refactor this code to <goal>:\n<paste code>\nConstraints: behavior must not change; keep each step independently reviewable; no new dependencies. Output: the refactor as a sequence of small diffs, each with one sentence on why it's safe, then the final code. Success: existing tests still pass, and the code is easier to change next time." },
  { intent: "writing", title: "Resume bullet upgrade", prompt: "You are a recruiter-savvy editor. Rewrite these resume bullets for a <target role> application:\n<paste bullets>\nContext: <team size, scope, real numbers you can claim>. Constraints: ground every claim in the facts I gave — do not invent metrics; strong verbs; each bullet under 22 words. Output: each bullet rewritten, with the changed part bolded, plus one line on what evidence would strengthen it further." },
];
