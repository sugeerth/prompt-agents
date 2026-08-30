/* Prompt Studio engine — type less, get exactly what you want.
   Zero dependencies, zero network. Vocabulary + modifiers live in data.js. */

/* ---------- domain engine ---------- */
/* Each domain: emoji, label, base line, and a deliverable shape per depth (0=TL;DR, 1=Standard, 2=Deep).
   Shapes are answer-shape-first and always end with an explicit size cap — that's what keeps replies short. */

/* "compare these two photos" is not one picture, and telling the model to use
   "the image" when there are two is a small wrongness in the first sentence. */
const MANY_IMAGES = /\b(these|both|two|three|several|multiple|each|compare|difference between)\b/i;

const GENERIC_SHAPES = [
  "The short version only — no preamble, no caveats.",
  null, // domain provides its own standard shape
  null, // derived: standard + one level deeper
];

const DOMAINS = {
  /* A bare topic gets "Explain X"; a question that already reads as one keeps
     its own words, because "Explain why is the sky blue" is broken English and
     it is the first thing the user sees. */
  learn:     { em:"📚", label:"Learn",
    base:t=>/^(why|how|when|where|which|who|is|are|was|were|do|does|did|can|could|should|would|will)\b/i.test(t)
      ? `Help me understand: ${t}.` : `Explain ${t}.`, shapes:[
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
  /* The opposite of `image`: that one writes a prompt to MAKE a picture, this
     one reads a picture the user already has. The marker at the end is the same
     device `summarize` uses for pasted text — a prompt about an image is
     useless without the image, and people forget to attach it. */
  vision:    { em:"👁️", label:"Vision",    base:t=>`Using the ${MANY_IMAGES.test(t) ? "images" : "image"} I've attached: ${t}.`, shapes:[
    "Just the answer, one or two sentences.\n\n[attach the image]",
    "Answer directly from what's visible, then note anything the image doesn't show that would change the answer. Max 120 words.\n\n[attach the image]",
    "Answer from what's visible, then the details that support it, then what the image cannot tell you. Max 300 words.\n\n[attach the image]" ]},
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
  /* Checked first, deliberately. "Is this mushroom safe to eat" was landing in
     `analyze` and "translate this sign" in `lang`, so the prompt never
     mentioned the image at all — and the safety ceilings that exist for
     exactly those asks never fired. Note "document" and "form" are absent from
     the demonstrative list: "summarize this document" is usually pasted text,
     and summarize should keep it. */
  ["vision",  /\b(this|these|the|my|attached)(?: \w+){0,2}? (photos?|images?|pictures?|screenshots?|charts?|graphs?|diagrams?|receipts?|labels?|menus?|signs?|scans?|x-?rays?|drawings?|paintings?|handwriting|circuit boards?|sheet music|knitting patterns?|lab reports?|maps?|invoices?|meters?|dials?|tattoos?|whiteboards?|bills?)\b|\bin (this|the) (photo|image|picture|screenshot)\b|\b(alt ?text|transcribe|ocr)\b|\bwhat (does|do) (this|these|the|it|my)( \w+){0,2}? say\b|\b(identify|what is) this (plant|bug|insect|bird|tree|flower|mushroom|breed|font|rock|part|rash|mole|spider|stain|mould|mold)\b|\bwhat (plant|bug|insect|bird|breed|font|mushroom) is this\b|\bread (this|my) (receipt|label|menu|sign|handwriting|note|meter|prescription|form|document)\b|\bis (this|these) \w+ (safe|edible|poisonous|dangerous|serious|infected|cancerous|fake|real|legit|a scam|a fake)\b|\bis this (a scam|legit|fake|real|safe to eat)\b/i],
  ["debug",   /\b(error|bug|traceback|exception|not working|fails?|crash|undefined|stack ?trace)\b/i],
  // "script" alone matches "ask for a raise script", which is words to say,
  // not a program. It only counts as code with a programming context around it.
  ["code",    /\b(code|function|python|javascript|typescript|sql|regex|api|refactor|algorithm|component)\b|\b(shell|bash|node|python|build|deploy) script\b|\.(js|py|ts|sh)\b/i],
  ["email",   /\b(email|e-mail|reply to|follow ?up)\b/i],
  ["summarize",/\b(summariz|summary|tl;?dr|key points|recap|condense)/i],
  // explicit arithmetic is a calculation whatever the subject: "18% of 340 plus
  // tax" wants a number, not a finance lesson, so it outranks the money cue
  ["math",    /\d+\s*%\s*of\b|\d+\s*[+\-*\/x]\s*\d+|\bhow much is\b/i],
  ["cook",    /\b(recipe|cook|bake|dinner|meal|marinade|air fryer|slow cooker)\b/i],
  ["local",   /\b(near me|nearby|nearest|closest|around here|in town|directions to|places to (see|eat|visit)|hidden gems|things to do|day trips?)\b/i],
  ["travel",  /\b(trip|itinerary|travel|vacation|days? in|visit)\b/i],
  // "on a budget" is a constraint on some other ask, not a finance question
  ["money",   /\b(invest|salary|mortgage|loan|savings?|retire|tax|debt|401k|credit)\b|\bbudgeting\b|\bbudget (for|of|plan|breakdown|spreadsheet)\b|\bmy budget\b/i],
  ["fit",     /\b(workout|gym|exercise|cardio|stretch|reps|squat|deadlift|marathon|5k|10k)\b|\bstrength training\b|\brunning (shoes|plan|form|pace)\b|\b(couch to 5k|weight training)\b/i],
  // parenting outranks health: "my toddler won't sleep" is about the toddler
  ["parent",  /\b(toddler|baby|kid|child|teen|potty|tantrum|newborn|nursery)\b/i],
  ["health",  /\b(sleep|diet|pain|symptom|doctor|anxiety|stress|vitamin|allerg|chest pain|dizzy|fever|rash|hurts?|ache|sore|injur|swollen)\b/i],
  /* Nine domains had good hand-tuned shapes and no way to reach them by
     typing — they existed only behind a suggestion click. These are the
     everyday categories people actually bring to an AI, so the legal shape
     that says "when you genuinely need a lawyer" now fires for the person
     asking about their deposit. */
  ["legal",   /\b(landlord|tenant|deposit|evict|sue|lawsuit|lawyer|attorney|contract|my rights|small claims|custody|divorce|fired|wrongful|liable|warranty|refund policy|employer|fire me|my landlord)\b|\bmy lease\b|\blease (agreement|terms)\b|\bbreak the lease\b/i],
  ["career",  /\b(resume|cv|cover letter|laid off|promotion|a raise|interview|job offer|my manager|my boss|quit my job|career|underpaid|performance review)\b/i],
  ["home",    /\b(drain|leak|clog|plumb|faucet|paint the|drywall|mow|lawn|gutter|furnace|thermostat|mold|landlord fix|hang a|garage|declutter|plant|houseplant|garden|seedling|soil|repot|prune|weeds?|compost)\b/i],
  ["social",  /\b(what should i say|what do i say|apolog|condolence|awkward|text back|break the news|difficult conversation|toast|eulogy)\b/i],
  ["lang",    /\b(in spanish|in french|in japanese|in german|in italian|translate|pronounce|conjugat|fluent)\b/i],
  ["sci",     /\b(physics|chemistry|biology|astronomy|evolution|quantum|molecule|galaxy|climate change|vaccine)\b/i],
  ["market",  /\b(marketing|seo|advertis|campaign|audience|brand|social media|newsletter|landing page|conversion)\b/i],
  ["biz",     /\b(business|startup|revenue|customers?|pricing|competitors?|invoice|freelanc|llc|profit margin)\b/i],
  ["fun",     /\b(party game|board game|trivia|joke|riddle|things to do tonight|date night|icebreaker)\b/i],
  ["decide",  /\b(vs\.?|versus|should i|or should|which is|better|worth it|choose|decide)\b/i],
  ["shop",    /\b(buy|best (cheap|budget)|under \$|which .*to get|recommend a)\b/i],
  ["write",   /\b(write|draft|essay|blog|post|caption|bio|speech|story|resume|cover letter)\b/i],
  ["image",   /\b(image|logo|illustration|poster|icon|midjourney|art)\b/i],
  ["plan",    /\b(plan|organize|checklist|prepare|schedule)\b/i],
  ["math",    /\b(calculate|solve|equation|percent|probability|geometry)\b|\d+\s*%|\d+\s*[+\-*\/x]\s*\d+/i],
  // "learn" only counts as a cue where it heads the ask or takes an object
  // clause — "i want to get fit and learn spanish" is a plan, not a lesson
  ["learn",   /\b(explain|what is|what are|how does|difference between|understand)\b|^learn\b|\blearn (about|how)\b/i],
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
  /* "fix all failing tests in my repo" is the same hand-off wearing a fix verb:
     the object is your own infrastructure, so it is work to be done, not a
     diagnosis to be explained. */
  if (r && r.id === "fix" && r.confidence >= 0.5 &&
      /\b(my|our) (repo|repos|codebase|tests?|build|pipeline|ci|deploys?|servers?)\b/i.test(text))
    return "agent";
  for (const [id, re] of SIGS) {
    if (!re.test(text)) continue;
    /* "review my resume" and "fix my resume" are the same request — judge a
       thing that already exists. Framing either as "draft this" answers a
       question nobody asked. */
    if (r && (r.id === "check" || r.id === "fix") && r.confidence >= 0.6 && ARTIFACT_DOMAINS.has(id))
      return "analyze";
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
  email:     /^(write\s+)?(an?\s+)?e-?mails?\s+/i,
  summarize: /^summariz(e|ing)\s+/i,
  decide:    /^(help me\s+)?(decide|choose)\s+(between\s+)?/i,
  cook:      /^(recipe\s+for|how to (cook|make))\s+/i,
  travel:    /^(plan\s+)?(a\s+|my\s+)?(road\s+)?trip\s+(to\s+)?/i,
  plan:      /^(help me\s+)?plan(ning)?\s+/i,
  math:      /^(solve|calculate)\s+/i,
  analyze:   /^analy[sz]e\s+/i,
  biz:       /^business\s+(?=plan|idea)/i,
  social:    /^what (to|should i) say\s+/i,
  image:     /^(image|picture|logo)\s+of\s+/i,
};

/* Preconditions, not formatting: information the model simply cannot answer
   well without. These survive every steer level, including Native — telling a
   model to ask where you are is not telling it how to write. */
const NEEDS = {
  local: "Ask where I am first if it changes the answer.",
  summarize: "Work only from the text I paste below.",
  // without this, Native returns a description of a logo rather than a prompt for one
  image: "Write this as one image-generation prompt.",
  /* The one instruction that most improves a vision answer. A vision model's
     characteristic failure is not refusing — it is describing something
     plausible that is not in the picture, confidently. */
  vision: "Work only from what's actually in the image — if something isn't visible, say so instead of guessing.",
};

/* Delegated work is not one thing. Each class of task has its own real proof
   and its own way of going wrong, so the harness names the actual evidence
   and the actual safety rule for THAT class — "verified" by test output is
   not "verified" by row counts. First match wins; checked most-specific
   first. These are content preconditions, so they survive every steer level. */
const AGENT_CLASSES = [
  { sig: /\b(database|db|schema|migrations?|migrate|tables?|records|dataset)\b/i,
    line: "Back up first. Verify each step with a count or checksum; never drop data without asking." },
  /* Only a PURE observation task. "keep my prs green" is a standing
     instruction to fix things, and telling that agent to observe and not act
     forbids the entire job — the app's own gold prompt for the same query says
     to apply the fixes. */
  { sig: /\b(keep|watch|monitor(ing)?|alerts?|logs?|uptime|green)\b/i,
    not: /\b(fix|repair|resolve|merge|deploy|apply|update|prs?|repo|codebase|tests?|build|pipeline)\b/i,
    line: "This is ongoing: say what you'll check, how often, and what triggers action — then verify the first check live." },
  { sig: /\b(files?|folders?|inbox|photos|downloads|organi[sz]e|rename|clean ?up)\b/i,
    line: "Dry run first: list what would change and wait for my OK before changing anything." },
  { sig: /\b(research|find out|look into|investigate|compare\b.*\b(options|providers|plans))\b/i,
    line: "Name the source for each key claim; separate what you verified from what you assumed." },
  { sig: /\b(book|order|reserve|purchase|renew|cancel|subscribe|buy|pay)\b/i,
    line: "Show the exact option, price and terms before committing; never spend or cancel without my explicit OK." },
  { sig: /\b(reach out|contact|schedule|invite|coordinate|rsvp|follow up|email .*(everyone|all|list|clients|vendors))\b/i,
    line: "Show me every message before it goes out; never send on my behalf without my OK." },
  { sig: /\b(repo|repos|codebase|refactor|ci|cd|tests?|dependenc|deploy|pipeline|prs?|website|app)\b/i,
    line: "Verify with the tests before and after; work in small commits; paste the output that proves it passes." },
];
function agentNeed(domId, t) {
  if (domId !== "agent") return null;
  for (const c of AGENT_CLASSES) if (c.sig.test(t) && !(c.not && c.not.test(t))) return c.line;
  return null;
}

/* What a picture can and cannot settle.

   Vision asks divide into kinds with genuinely different failure modes, and
   two of them are dangerous. "Is this mushroom safe to eat" and "is this mole
   cancerous" are among the most common things people photograph and ask about,
   and both invite an answer that reads as authoritative and can be badly
   wrong — a confident "looks fine" is the worst possible output. Those two get
   an explicit ceiling on what a photograph can establish.

   The rest are craft: a transcription should not silently invent a digit, an
   identification should name what it could otherwise be, a chart reading
   should not estimate a value it cannot see. First match wins, most specific
   first. These are content, not formatting, so they survive every steer
   level. */
const VISION_CLASSES = [
  { sig: /\b(safe to eat|edible|poisonous|toxic|mushroom|forage|foraging|wild (berry|berries|plant|garlic))\b/i,
    line: "Never confirm from a photo that something is safe to eat: give the likely identification, name the dangerous lookalikes, and say plainly that only an expert in person can confirm it." },
  { sig: /\b(rash|mole|lesion|wound|infection|infected|swelling|bite|x-?ray|cancer|melanoma|is this serious)\b/i,
    line: "A photo cannot diagnose: say what it could be, what would make it urgent, and that this needs a real clinician — do not reassure me." },
  { sig: /\b(scam|phishing|fraud|fake|legit|counterfeit)\b/i,
    line: "Point to the specific visible signs either way, and say what to check before trusting it." },
  { sig: /\b(read|transcribe|translat\w*|ocr|handwriting|receipt|invoice|label|menu|prescription|meter|form|contract|sign)\b|\bwhat (does|do) (this|these|the|it)( \w+)? say\b/i,
    line: "Transcribe exactly what is written before interpreting it, keeping numbers and spelling as they appear, and mark anything you cannot read clearly as [unclear]." },
  { sig: /\b(chart|graph|plot|dashboard|figure|axis|data)\b/i,
    line: "Read the actual values off the image; if a value isn't legible, say so rather than estimating it." },
  { sig: /\b(error|stack ?trace|traceback|log|console|terminal|build|exception)\b/i,
    line: "Quote the exact error text visible in the image before interpreting it." },
  { sig: /\b(identify|what is this|what plant|what bug|what bird|what breed|what font|species)\b/i,
    line: "Give your best identification with the visible features that led to it, and list what else it could plausibly be." },
  { sig: /\b(alt ?text|accessib|screen ?reader)\b/i,
    line: "Write alt text that conveys the purpose of the image, not an inventory of everything in it." },
  { sig: /\b(critique|feedback|improve|better|composition|design|layout|outfit)\b/i,
    line: "Tie every point to something actually visible in the image." },
];
function visionNeed(domId, t) {
  if (domId !== "vision") return null;
  for (const c of VISION_CLASSES) if (c.sig.test(t)) return c.line;
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
    not: /\b(fix|repair|resolve|merge|deploy|apply|update|prs?|repo|codebase|tests?|build|pipeline)\b/i,
    done: "the first check has run live and you've shown me its output",
    verify: "run the first check live and paste its output",
    rule: "report changes in what you observe, don't act on them without asking" },
  { sig: /\b(files?|folders?|inbox|photos|downloads|organi[sz]e|rename|clean ?up)\b/i,
    done: "the approved dry-run list has been applied, nothing else",
    verify: "show me the list of changes and get my OK before applying it",
    rule: "never delete — move aside instead" },
  { sig: /\b(research|find out|look into|investigate|compare\b.*\b(options|providers|plans))\b/i,
    done: "findings are written up with sources I can check",
    verify: "name or link the source for each key claim",
    rule: "separate what you verified from what you assumed" },
  { sig: /\b(book|order|reserve|purchase|renew|cancel|subscribe|buy|pay)\b/i,
    done: "the choice is confirmed, with a reference I can check",
    verify: "show the exact option, price and terms before committing",
    rule: "never spend or cancel without my explicit OK" },
  { sig: /\b(reach out|contact|schedule|invite|coordinate|rsvp|follow up|email .*(everyone|all|list|clients|vendors))\b/i,
    done: "every message is drafted and approved before it goes out",
    verify: "show me each message before sending",
    rule: "never send on my behalf without my OK" },
  { sig: /\b(report|digest|summary|newsletter|export|sync|backup)\b.*\b(weekly|daily|monthly|automat)|\bautomat\w+\b.*\b(report|digest|export|sync|backup)\b/i,
    done: "one run has produced the real output and you've shown it to me",
    verify: "run it once end to end and paste the output",
    rule: "never send or publish the output without my OK" },
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
  const cls = AGENT_BRIEF.find(c => c.sig.test(t) && !(c.not && c.not.test(t))) || AGENT_BRIEF_DEFAULT;

  /* The brief consumes the reasoning layer. The graph's critical path becomes
     the plan, a discovered cycle becomes a Watch-out, and the complexity
     ladder governs rigor: a coupled hand-off earns checkpoints and stop rules
     even at Standard depth, a trivial one stays terse. Depth remains the
     user's override upward — auto-rigor never lowers what they asked for. */
  const sig = (REASON && REASON.briefSignals && state.reason !== "off")
    ? REASON.briefSignals(REASON.analyze(t))
    : { milestones: null, tension: null, rigor: 0 };
  const rigor = Math.max(depth, sig.rigor);

  const segs = [{ text: `Mission: ${t}.`, add: false, kind: "base", label: "Mission" }];
  const B = (label, body, kind, add) =>
    segs.push({ text: `\n${label}: ${body}.`, add: !!add, kind: kind || "brief", label });
  B("Done when", cls.done);
  if (rigor >= 1) {
    const plan = sig.milestones
      ? `${sig.milestones.join(" → ")}, one line each`
      : "milestones, one line each";
    B("Plan first", plan + (rigor >= 2 ? ", with the main risk of each; checkpoint after each milestone" : ""), "shape");
  }
  B("Ground rules", cls.rule + "; ask before anything destructive or irreversible" +
    (rigor >= 2 ? "; if blocked twice on one thing, stop and ask" : ""));
  if (sig.tension)
    B("Watch out", `${sig.tension} pull against each other — surface the tradeoff before committing`, "brief", true);
  if (rigor >= 1) B("Verify", cls.verify);
  B("Report", rigor === 0
    ? "one line — done and how verified, or blocked and why"
    : "what changed, how you verified it, what remains");
  for (const m of activeMods) segs.push({ text: m.text, add: true, kind: "mod", modId: m.id });
  return segs;
}

const AUDIENCE = [
  "Assume I know nothing about this.",
  null,
  "I know the basics — skip them.",
];

/* Depth said as a want rather than a format. Guided's whole rule is to state
   what you're after and leave the form alone — and how much you want IS what
   you're after, not how it should look. Standard says nothing, because the
   middle of a slider should not add a sentence. */
const WANT = [
  "Keep it short — just the essentials.",
  null,
  "Go deep — I'd rather have the whole picture.",
];

function shapeFor(dom, depth) {
  const s = dom.shapes[depth];
  if (s) return s;
  if (depth === 0) return GENERIC_SHAPES[0];
  const std = dom.shapes[1];
  if (depth !== 2) return std;
  /* Deep, derived. Appending "go one level deeper" to a shape that ends in
     "5 bullets max" asks for more inside a cap that forbids it — so where
     there is a count, Deep raises it rather than arguing with it. */
  const raised = std
    .replace(/\b(\d+) (bullets?|actions?|moves?|tactics?|picks?|points?|ideas?)\b/i,
             (m, n, u) => `${+n * 2} ${u}`)
    .replace(/\bMax (\d+) words\b/i, (m, n) => `Max ${Math.round(+n * 2)} words`);
  return raised !== std ? raised : std + " Then the part people most often get wrong, in detail.";
}

/* One line that turns every answer into progressive disclosure:
   tight reply first, numbered drill-downs the user can pick from. */
const DRILL = "Then 3 numbered ways to go deeper.";

/* The follow-up menu is what makes a short answer safe: it says "there is
   more, ask for it". But an agent executing a mission does not offer its
   operator three ways to go deeper, and an image prompt has nothing to drill
   into — so those are the two places it stays out of. */
function effectiveDrill(domId) {
  return state.drill && domId !== "agent" && domId !== "image" && state.steer !== "native" &&
    // a TL;DR shape says "this and nothing else"; a follow-up menu is more things
    !(state.steer === "shaped" && state.depth === 0);
}

/* Build the prompt as typed segments — every piece knows what produced it,
   so the rendered prompt can be edited by clicking the piece itself. */
function buildPrompt(topic, domId, depth, tone, activeMods, drill) {
  const dom = DOMAINS[domId] || DOMAINS.general;
  let t = topic.trim().replace(/\s+/g, " ").replace(/[.?!]+$/, "");
  if (STRIPS[domId]) {
    const stripped = t.replace(STRIPS[domId], "");
    if (stripped.trim()) t = stripped.trim();
  }
  /* A single word that is only a framing verb carries no ask — echoing it back
     as "Help me plan: plan." is worse than showing nothing. */
  if (!t || /^(plan|write|draft|fix|explain|summari[sz]e|analy[sz]e|review|help|make|create|build|design)$/i.test(t))
    return [];
  if (domId === "agent") return buildBrief(t, depth, activeMods, drill);
  const segs = [{ text: dom.base(t), add: false, kind: "base" }];
  if (NEEDS[domId] && !state.noNeed) segs.push({ text: NEEDS[domId], add: true, kind: "need" });
  const classNeed = agentNeed(domId, t) || visionNeed(domId, t);
  if (classNeed && !state.noNeed) segs.push({ text: classNeed, add: true, kind: "need" });
  const shape = shapeFor(dom, depth);
  /* A trailing [bracketed] line is a marker, not part of the answer shape: it
     tells the USER to bring something — text to paste, an image to attach.
     Splitting it out here keeps it last in the prompt and keeps it alive in
     Guided, which drops the shape sentence but still needs the attachment. */
  const mk = shape.match(/\n\n(\[[^\]]+\])\s*$/);
  const shapeCore = mk ? shape.slice(0, shape.length - mk[0].length) : shape;
  segs.push({ text: shapeCore, add: depth !== 1, kind: "shape" });
  if (depth === 0 && !/nothing else|no explanation|no long intros|\bonly\b/i.test(shapeCore))
    segs.push({ text: "No preamble.", add: true, kind: "shape" });
  if (AUDIENCE[tone]) segs.push({ text: AUDIENCE[tone], add: true, kind: "aud" });
  for (const m of activeMods) segs.push({ text: m.text, add: true, kind: "mod", modId: m.id });
  if (drill) segs.push({ text: DRILL, add: false, kind: "drill" });
  if (mk) {
    const label = domId === "vision" && MANY_IMAGES.test(t)
      ? "[attach the images]" : mk[1];
    segs.push({ text: "\n" + label, add: false, kind: "marker" });
  }
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
                drill: true, gold: null, reason: "auto", graphOpen: false, steer: "guided",
                /* steps already committed; the one being typed is always the last, unsaved one */
                chain: [], padTouched: false };
const REASON = window.PS_REASON;
const INTENT = window.PS_INTENT;
const CHAIN = window.PS_CHAIN;
const PROFILE = window.PS_PROFILE;
const BRIDGE = window.PS_BRIDGE;

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
  /* Tiers, strongest evidence first: a hand-tuned prompt for this exact ask,
     then what starts with what you typed, then what merely contains it, then
     what only resembles it. The tier is never traded away — it is the reason
     the list feels predictable. */
  const seen = new Set(golds.map(g => g.t));
  const keep = (v, tier) => (seen.has(v.t) ? null : (seen.add(v.t), { ...v, tier }));
  let out = golds.map(g => ({ ...g, tier: 0 }))
    .concat(starts.map(v => keep(v, 1)).filter(Boolean))
    .concat(contains.map(v => keep(v, 2)).filter(Boolean));

  if (out.length < 7 && t.length >= 4) {
    const fuzzy = [];
    for (const d of SIM.docs) {
      if (d.ref.type !== "vocab") continue;
      const v = VOCAB[d.ref.i];
      if (seen.has(v.t)) continue;
      const s = score(qEmb, d);
      if (s >= 0.34) fuzzy.push({ ...v, s, tier: 3 });
    }
    fuzzy.sort((a, b) => b.s - a.s);
    out = out.concat(fuzzy);
  }

  /* Personalization breaks ties; it never crosses a tier. Someone who cooks
     every day should see the cooking reading of an ambiguous word first — but
     an exact prefix match still outranks a merely familiar one, however often
     they have used it. Re-ranking inside a tier is the whole permitted power. */
  if (PROFILE && PROFILE.enabled() && out.length > 1) {
    out = out
      .map((o, i) => ({ o, i, k: (o.s || 0) + PROFILE.boost(o) }))
      .sort((a, b) => a.o.tier - b.o.tier || b.k - a.k || a.i - b.i)
      .map(b => b.o);
  }
  return out.slice(0, 7);
}

/* The rest of the highlighted suggestion, drawn in place behind the cursor.
   Tab takes it. This is the shortest path from one keystroke to a full ask,
   and it only appears when it can be honest: the suggestion must actually
   continue what was typed, and the text must be short enough that the input
   hasn't scrolled, or the grey half would sit under the wrong letters. */
function renderGhost() {
  const el = $("ghost");
  if (!el) return;
  const v = q.value;
  const pick = state.matches[state.sel >= 0 ? state.sel : 0];
  const fits = v.length > 0 && v.length <= 38 && !/^\s|\s$/.test(v);
  const can = fits && pick && sug.classList.contains("open") &&
    pick.t.length > v.length && pick.t.toLowerCase().startsWith(v.toLowerCase());
  el.innerHTML = can
    ? `<span class="gtyped">${esc(v)}</span>${esc(pick.t.slice(v.length))}`
    : "";
}

/* A listbox nobody is told about is a listbox that does not exist. The input
   is a combobox: it has to say that it is expanded, which option is active,
   and each option has to say whether it is the selected one. Without this the
   app's headline feature — type one letter, get suggestions — is invisible to
   a screen reader, and Enter silently swaps in something never announced. */
function syncCombo() {
  const open = sug.classList.contains("open");
  q.setAttribute("aria-expanded", String(open));
  if (open && state.sel >= 0) q.setAttribute("aria-activedescendant", "s-opt-" + state.sel);
  else q.removeAttribute("aria-activedescendant");
}

function renderSug() {
  const t = q.value.trim().toLowerCase();
  if (!state.matches.length) { sug.classList.remove("open"); renderGhost(); syncCombo(); return; }
  sug.innerHTML = state.matches.map((m, i) => {
    const dom = DOMAINS[m.d] || DOMAINS.general;
    const idx = m.t.indexOf(t);
    const label = idx >= 0
      ? m.t.slice(0, idx) + "<b>" + m.t.slice(idx, idx + t.length) + "</b>" + m.t.slice(idx + t.length)
      : m.t;
    const em = m.gold ? "★" : dom.em;
    const dl = m.gold ? "★ tuned" : dom.label;
    return `<div class="s-item${i === state.sel ? " sel" : ""}${m.gold ? " s-gold" : ""}" data-i="${i}" id="s-opt-${i}" role="option" aria-selected="${i === state.sel}">
      <span class="em">${em}</span><span>${label}</span><span class="dl">${dl}</span></div>`;
  }).join("");
  sug.classList.add("open");
  renderGhost();
  syncCombo();
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
  observe("accept");
}

/* ---------- chips ---------- */
function renderChips() {
  const domId = state.topic.trim() ? effectiveDomain() : (state.domain || "general");
  const scored = MODIFIERS.map((m, i) => ({ m, i, rel: m.doms && m.doms.includes(domId) ? 0 : 1 }));
  scored.sort((a, b) => a.rel - b.rel || a.i - b.i);
  const expanded = chipsEl.dataset.more === "1";
  /* A hand-tuned prompt that asks for a seven-row table cannot also answer in
     three bullets. Chips that name a count are withheld while one is showing
     rather than silently contradicting it. */
  const COUNTED = new Set(["bul3", "top3", "w100"]);
  const filtered = state.gold ? scored.filter(x => !COUNTED.has(x.m.id)) : scored;
  const shown = expanded ? filtered : filtered.slice(0, 12);
  chipsEl.innerHTML = shown.map(({ m }) =>
    `<button class="chip${state.mods.has(m.id) ? " on" : ""}" data-id="${m.id}" type="button" ` +
    `aria-pressed="${state.mods.has(m.id)}">${m.label}</button>`
  ).join("") +
  (filtered.length > 12
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
  /* The mission brief consumes the reasoning layer directly — its Plan,
     Watch-out and rigor ARE the reasoning output. Appending the generic
     scaffold after it would say everything twice. */
  if (domId === "agent") return [];
  const m = REASON.analyze(state.topic);
  /* Chain-of-Draft's five-word steps are a second step format wherever one is
     already named, so the layer needs to know that before it spends the line. */
  const dom = DOMAINS[domId];
  /* Only a shape that will actually ship counts. Guided strips the domain
     shape, so reading it there would suppress the compute line over a sentence
     the user never sees. */
  const shapeNow = (state.steer === "shaped" && dom) ? (shapeFor(dom, state.depth) || "") : "";
  m.stepShaped = /step by step|one line per step|numbered steps|no explanation|Nothing else/i
    .test(shapeNow + " " + (state.gold ? state.gold.p : ""));
  /* Shaped and gold prompts carry their own answer shape, so the scaffold must
     not carry a second one. */
  const style = state.steer === "native" ? "native"
    : (state.steer === "shaped" || state.gold) ? "shaped" : "guided";
  const out = REASON.scaffoldFor(m, domId, state.reason, style)
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

/* Structure handed in by another system, on the same terms as our own graph:
   one line at most, and only the labels that survived sanitizing.

   Kept separate from the reasoning scaffold because it has to reach places the
   scaffold deliberately doesn't. A delegated task is the likeliest thing a host
   planner has a graph about, and the mission brief replaces the generic
   scaffold entirely — so routing this through the scaffold would silently drop
   it exactly where it matters most. */
function externalSegs() {
  if (!BRIDGE || !BRIDGE.findings) return [];
  if (state.steer === "native" || state.reason === "off" || state.noGraph) return [];
  return BRIDGE.findings().map(s => ({ text: s.text, add: true, kind: "graph" }));
}

/* Where the domain's own framing already carries the goal. "Help me decide:"
   followed by "I have to make a call here" is one sentence written twice, and
   this pairing accounted for 8-14 wasted words on roughly half of all asks. */
const INTENT_IMPLIED = {
  decide: ["decide"], make: ["write", "email", "image"],
  plan: ["plan", "travel"], delegate: ["agent"], find: ["local", "shop"],
  explore: ["create"], check: ["analyze", "vision"], understand: ["vision"],
  do: ["cook"],
};
/* Only pairs where the prefix says the whole thing. "Help me decide:" and "I
   need to make a call" are one sentence written twice. "Tech help:" and "Lead
   with what is actually wrong" are not — the second states a behaviour the
   first only hints at, and dropping it would be trading meaning for brevity
   rather than cutting waste. */

/* What the user WANTS, stated once — never how to format it. */
function intentSegs(domId) {
  if (!INTENT || state.noIntent || !state.topic.trim()) return [];
  const r = INTENT.recognize(state.topic);
  const out = [];
  const floor = state.steer === "native" ? 0.25 : 0.4;
  if (r.line && r.confidence >= floor) {
    /* Native has no domain prefix at all — the base line is the user's own
       words — so nothing is implied there and the goal must still be said. */
    const framed = state.steer !== "native";
    if (!framed || !(INTENT_IMPLIED[r.id] || []).includes(domId))
      out.push({ text: r.line, add: true, kind: "intent" });
  }
  /* Asking beats guessing — but only where there is genuinely nothing to go on.
     The gate used to test sentence FORM, which fired on a third of all asks:
     "panic attack" and "tell me a joke" are not ambiguous, they are short. What
     matters is information content, so it now fires only when the ask carries
     almost no content words AND no goal was recognized at all. A gold prompt is
     hand-tuned and a chained step has the previous step for context, so neither
     needs it either. */
  else if (isBare(state.topic) && !state.gold && !state.chain.length)
    out.push({ text: INTENT.CLARIFY, add: true, kind: "intent" });
  return out;
}

const BARE_STOP = new Set(("a an the my our your this that some for to of in on at and or is are be " +
  "me i we you it how what why do does can should would help").split(" "));
const isBare = t => {
  const content = String(t).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter(w => w.length > 2 && !BARE_STOP.has(w));
  const r = INTENT ? INTENT.recognize(t) : null;
  return content.length <= 1 && (!r || r.confidence === 0);
};

/* Native is the user's own words, so mangling them is the one thing it must
   not do: a question turned into a statement, or a bare "i", reads as sloppy
   in the mode whose entire promise is fidelity. */
const tidy = t => {
  const s = t.trim().replace(/\s+/g, " ").replace(/\bi\b/g, "I");
  if (/[.?!]$/.test(s)) return s.charAt(0).toUpperCase() + s.slice(1);
  const asks = /^(is|are|was|were|can|could|do|does|did|should|would|will|am|has|have|what|why|how|when|where|which|who)\b/i.test(s);
  return s.charAt(0).toUpperCase() + s.slice(1) + (asks ? "?" : ".");
};

/* ---------- chaining ----------
   The steps already committed, plus the one being typed. Prompts are rebuilt
   from topics rather than stored, so a chain can never hold a stale prompt. */
/* "write the letter" after "my landlord kept my deposit" is still a legal
   matter, and "then deploy it" is not a fresh mission briefing — a step that
   leans on the previous one inherits its framing rather than being re-detected
   from three words of shorthand. */
function effectiveDomain() {
  const own = state.domain || detectDomain(state.topic);
  if (!CHAIN || !state.chain.length || state.noChain || !state.topic.trim()) return own;
  const prev = state.chain[state.chain.length - 1];
  if (prev.domain && CHAIN.leansOnPrevious(state.topic, prev.topic)) return prev.domain;
  return own;
}

function chainSteps() {
  return state.chain.concat([{
    topic: state.topic,
    constraints: CHAIN ? CHAIN.constraints(state.topic) : [],
  }]);
}

/* What links this step to the one before it: what that step asked, the
   instruction to build rather than restate, and any constraint still in force.
   Written for the user so they only ever type the new part. */
function chainSegs() {
  if (!CHAIN || !state.chain.length || !state.topic.trim() || state.noChain) return [];
  return CHAIN.linkSegs(chainSteps(), state.chain.length)
    .map(s => ({ text: s.text, add: true, kind: "chain" }));
}

function currentSegs() {
  const segs = stepSegs();
  const link = chainSegs();
  /* The link goes directly after the ask itself: the model should know what
     it is continuing before it reads how to answer. */
  if (link.length && segs.length) segs.splice(1, 0, ...link);
  return segs;
}

function stepSegs() {
  const active = MODIFIERS.filter(m => state.mods.has(m.id));

  /* Native: the ask in the user's own words, aimed by intent, then out of the
     way. No answer shape, no size cap, no follow-up menu — the model answers
     the way it would answer a person. */
  if (state.steer === "native") {
    if (!state.topic.trim()) return [];
    const domId = effectiveDomain();
    const segs = [{ text: tidy(state.gold ? state.gold.q : state.topic), add: false, kind: "base" }];
    if (state.gold && !state.noNeed) {
      const slot = (state.gold.p.match(/<[^>]{3,80}>\s*$/) || [])[0];
      if (slot) segs.push({ text: slot.trim(), add: true, kind: "need" });
    }
    if (NEEDS[domId] && !state.noNeed) segs.push({ text: NEEDS[domId], add: true, kind: "need" });
    const nClassNeed = agentNeed(domId, state.topic) || visionNeed(domId, state.topic);
    if (nClassNeed && !state.noNeed) segs.push({ text: nClassNeed, add: true, kind: "need" });
    segs.push(...intentSegs(domId));
    if (AUDIENCE[state.tone]) segs.push({ text: AUDIENCE[state.tone], add: true, kind: "aud" });
    for (const m of active) segs.push({ text: m.text, add: true, kind: "mod", modId: m.id });
    segs.push(...reasonSegs(domId));
    /* The attach reminder is for the user, not the model, so it belongs in
       every mode — a vision prompt pasted without its image is just wrong. */
    if (domId === "vision") segs.push({
      text: MANY_IMAGES.test(state.topic) ? "\n[attach the images]" : "\n[attach the image]",
      add: false, kind: "marker" });
    return segs;
  }

  if (state.gold) {
    // cached hand-tuned prompt for a top query: served as-is, still composable
    const g = state.gold;
    const segs = [{ text: g.p, add: false, kind: "base" }];
    if (state.steer === "guided") segs.push(...intentSegs(g.d));
    if (AUDIENCE[state.tone]) segs.push({ text: AUDIENCE[state.tone], add: true, kind: "aud" });
    for (const m of active) segs.push({ text: m.text, add: true, kind: "mod", modId: m.id });
    segs.push(...reasonSegs(g.d));
    segs.push(...externalSegs());
    if (effectiveDrill(g.d)) segs.push({ text: DRILL, add: false, kind: "drill" });
    return segs;
  }
  const domId = effectiveDomain();
  const segs = buildPrompt(state.topic, domId, state.depth, state.tone, active, effectiveDrill(domId));
  if (!segs.length) return segs;
  /* Guided: keep the domain's framing and the follow-up menu, but drop the
     answer-shape sentence and its size caps — say what's wanted, not how long
     the reply may be. */
  const extra = [];
  if (state.steer === "guided") {
    // the mission brief is a behavioral contract, not an answer shape — keep it whole
    if (domId !== "agent")
      for (let i = segs.length - 1; i >= 0; i--) if (segs[i].kind === "shape") segs.splice(i, 1);
    /* The shape is gone but the appetite isn't: say how much is wanted without
       saying what the answer must look like. */
    if (domId !== "agent" && WANT[state.depth])
      extra.push({ text: WANT[state.depth], add: true, kind: "want" });
  }
  /* What the user wants is content, not form, so Shaped keeps it too — the
     control is described as "also fixes the answer's shape", and "also" has to
     mean adding a shape rather than dropping the goal. */
  if (state.steer !== "native") segs.splice(1, 0, ...intentSegs(domId));
  // reasoning goes before the go-deeper menu and the paste marker
  extra.push(...reasonSegs(domId));
  extra.push(...externalSegs());
  /* Two answer shapes in one prompt is a contradiction, and the fix used to be
     deleting the domain's shape whenever the scaffold declared one. That made
     the Depth control do nothing at all on every L2/L3 ask in Shaped — the one
     level whose entire promise is that it fixes the answer's form. So the
     scaffold yields instead: in Shaped it buys thinking and says nothing about
     form (see SHAPED_SCAFFOLD), and the domain shape owns the contract.
     A gold prompt is hand-tuned and already names its own shape, so it wins on
     the same principle. */
  if (state.gold && domId !== "agent")
    for (let i = segs.length - 1; i >= 0; i--) if (segs[i].kind === "shape") segs.splice(i, 1);
  const at = segs.findIndex(s => s.kind === "drill" || s.kind === "marker");
  if (at === -1) segs.push(...extra); else segs.splice(at, 0, ...extra);
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
  chain: "Carried from the previous step — click to unlink this step",
  want: "How much you asked for — click to reset to Standard",
};

/* The app has two states: waiting for a topic, and working on one. Everything
   below the card belongs to the second, so it isn't rendered in the first —
   the controls arrive at the moment they can actually do something. A chain in
   progress counts as working, or the controls would vanish between steps. */
function syncExamples() {
  const live = !!(state.topic.trim() || state.chain.length);
  // looked up lazily: update() runs during init, before the examples row renders
  const el = document.getElementById("examples");
  if (el) el.style.display = live ? "none" : "flex";
  const m = document.querySelector("main");
  if (m) m.classList.toggle("live", live);
}

function update() {
  syncExamples();
  if (state.topic.trim()) applyRemembered(effectiveDomain());
  const segs = currentSegs();
  if (!segs.length) {
    // no prompt means nothing to report on — pills describing an empty ask are
    // the app analysing something the user cannot see
    metricsEl.innerHTML = "";
    graphEl.classList.remove("open");
    announce("");
    promptEl.className = "empty";
    /* Says something the subtitle above doesn't: what to DO with the prompt
       once it's here. Two restatements of the same promise on one screen is
       one too many. */
    promptEl.textContent = "Your prompt appears here as you type. Tap any part of it to change that part — then ⏎ copies.";
    countEl.textContent = "";
    return;
  }
  promptEl.className = "";
  promptEl.innerHTML = segs.map((s, i) => {
    const hint = SEG_HINTS[s.kind];
    const cls = (s.add ? "adds" : "") + (hint ? " seg" : "");
    let body = s.text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    if (s.label) {
      const at = body.indexOf(s.label + ":");
      if (at >= 0) body = body.slice(0, at) + "<b>" + s.label + ":</b>" + body.slice(at + s.label.length + 1);
    }
    /* Focusable spans rather than buttons, deliberately. A button is an atomic
       inline box — the browser coerces display:inline back to inline-block — so
       each piece would claim its own line and the prompt would read as a list
       of directives instead of the paragraph that actually gets copied. A span
       with a button role, a tab stop and Enter/Space handling is operable the
       same way and flows as prose. */
    return hint
      ? `<span class="${cls.trim()}" data-i="${i}" role="button" tabindex="0" title="${hint}">${body}</span>`
      : `<span class="${cls.trim()}">${body}</span>`;
  }).join(" ");
  const text = segsToText(segs);
  const words = text.split(/\s+/).length;
  countEl.textContent = words + " words";
  announce(`Prompt ready, ${words} words` +
    (state.chain.length ? `, step ${state.chain.length + 1} of the chain` : "") + ".");
  renderMetrics();
}

/* Typing rebuilds the prompt on every keystroke and, on the first one, reveals
   a whole row of controls. A live region on the prompt itself would re-read
   the lot on every letter, so the announcement is debounced and summarised:
   one sentence, once the typing stops. */
let announceTimer = null;
function announce(msg) {
  const el = document.getElementById("promptStatus");
  if (!el) return;
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => { el.textContent = msg; }, 700);
}

/* ---------- reasoning readout: the graph the layer actually measured ---------- */
const metricsEl = $("metrics"), graphEl = $("graph");

function renderMetrics() {
  if (!REASON || !state.topic.trim()) { metricsEl.innerHTML = ""; graphEl.classList.remove("open"); return; }
  const m = REASON.analyze(state.topic);
  const spent = state.reason === "off" ? "no reasoning spent"
    : REASON.scaffoldFor(m, effectiveDomain(), state.reason).length
      ? "reasoning spent" : "no reasoning needed";
  const r = INTENT ? INTENT.recognize(state.topic) : null;
  const wants = r && r.confidence >= 0.4
    ? `<span class="want">wants: ${r.label}</span>`
    : `<span class="want">goal unclear — will ask</span>`;
  /* three plain pills; the graph detail (topics, constraints, node counts)
     waits behind the badge for whoever actually wants it */
  metricsEl.innerHTML = wants +
    `<button class="cx" data-l="${m.level}" type="button" aria-expanded="${!!state.graphOpen}" ` +
    `aria-controls="graph" title="How complex this ask is — click to see why">` +
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
  /* The summary line is the picture's real alternative — it is the finding the
     drawing illustrates. Naming the image "intent graph" described the file
     type rather than the content. */
  parts.push(`<div id="graphwhy" style="font-size:12px;color:var(--muted);padding-bottom:2px">${m.why}` +
    (g ? ` · ${g.n} ${g.n === 1 ? "node" : "nodes"}, ${g.m} ${g.m === 1 ? "link" : "links"}` : "") + `</div>`);
  parts.push(`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-labelledby="graphwhy">`);
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

/* the prompt itself is the control surface: click a piece — or focus it and
   press Enter — to edit it */
promptEl.addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
  const span = e.target.closest(".seg");
  if (!span) return;
  e.preventDefault();
  span.click();
});

promptEl.addEventListener("click", e => {
  const span = e.target.closest(".seg");
  if (!span) return;
  const seg = currentSegs()[+span.dataset.i];
  if (!seg) return;
  if (seg.kind === "mod") { state.mods.delete(seg.modId); renderChips(); }
  else if (seg.kind === "aud") { state.tone = 1; $("tone").value = "1"; syncToneUI(); }
  else if (seg.kind === "shape") { state.depth = (state.depth + 1) % 3; $("depth").value = String(state.depth); syncDepthUI(); }
  else if (seg.kind === "multi") state.noMulti = true;
  else if (seg.kind === "intent") state.noIntent = true;
  else if (seg.kind === "need") state.noNeed = true;
  else if (seg.kind === "graph") state.noGraph = true;
  else if (seg.kind === "reason" || seg.kind === "verify") { state.reason = "off"; syncReasonUI(); }
  else if (seg.kind === "drill") { state.drill = false; syncDrillUI(); }
  else if (seg.kind === "chain") state.noChain = true;
  else if (seg.kind === "want") { state.depth = 1; $("depth").value = "1"; syncDepthUI(); }
  update();
});

/* ---------- copy + launch ---------- */
function copyPrompt(silent, why) {
  const segs = currentSegs();
  if (!segs.length) { q.focus(); return ""; }
  const text = segsToText(segs);
  navigator.clipboard && navigator.clipboard.writeText(text);
  if (!silent) showToast("Copied — paste it into any AI ✦");
  observe(why || "copy");
  return text;
}

/* ---------- chain UI ----------
   A chain is worth having only if it costs almost nothing to build: one tap to
   keep the current prompt, then type the next thought in shorthand. The strip
   above the box is the whole mental model — these are the steps so far, this
   is the one you're writing. */
const chainEl = $("chainstrip"), chainAddBtn = $("chainadd");
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

function renderChain() {
  if (!CHAIN) return;
  const n = state.chain.length;
  chainEl.classList.toggle("on", n > 0);
  if (!n) { chainEl.innerHTML = ""; syncChainUI(); return; }
  chainEl.innerHTML = `<span class="exlabel">Chain:</span>` + state.chain.map((s, i) =>
    `<span class="step"><span class="n">${i + 1}</span>` +
    `<span class="t" title="${esc(s.topic)}">${esc(CHAIN.condense(s.topic, 40))}</span>` +
    `<button class="x" data-i="${i}" type="button" title="Remove this step" aria-label="Remove step ${i + 1}">×</button></span>` +
    `<span class="steparrow">→</span>`
  ).join("") + `<span class="step"><span class="n">${n + 1}</span><span class="t">writing…</span></span>`;
  syncChainUI();
}

function syncChainUI() {
  const has = state.chain.length > 0;
  const full = state.chain.length >= CHAIN.MAX - 1;
  chainAddBtn.textContent = has ? "+ Step " + (state.chain.length + 2) : "+ Next step";
  chainAddBtn.disabled = full;
  chainAddBtn.title = full
    ? "A chain this long is better split into separate asks"
    : "Keep this prompt and write the next one — it will know what this one asked";
  $("copy").textContent = has ? "Copy step " + (state.chain.length + 1) : "Copy prompt";
  let all = $("copyall");
  if (has && !all) {
    all = document.createElement("button");
    all.className = "btn"; all.id = "copyall"; all.type = "button";
    all.addEventListener("click", () => {
      const text = CHAIN.pipeline(chainWithCurrent());
      if (!text) return;
      navigator.clipboard && navigator.clipboard.writeText(text);
      showToast(`Copied all ${state.chain.length + 1} steps as one prompt ✦`);
    });
    chainAddBtn.after(all);
  }
  if (all) {
    all.style.display = has ? "" : "none";
    all.textContent = `Copy all ${state.chain.length + 1}`;
    all.title = "All steps as one prompt, run in order — for an agent that can do the whole sequence";
  }
}

/* Every committed step plus the one on screen, each with its prompt text. */
function chainWithCurrent() {
  const cur = segsToText(currentSegs());
  const steps = state.chain.map(s => ({ topic: s.topic, prompt: s.prompt }));
  if (cur) steps.push({ topic: state.topic, prompt: cur });
  return steps;
}

function addStep() {
  if (!CHAIN) return;
  const segs = currentSegs();
  if (!segs.length || state.chain.length >= CHAIN.MAX - 1) return;
  state.chain.push({
    topic: state.topic,
    prompt: segsToText(segs),
    constraints: CHAIN.constraints(state.topic),
    domain: effectiveDomain(),
  });
  q.value = ""; state.topic = ""; state.domain = null; state.gold = null;
  state.matches = []; state.sel = -1; state.noChain = false;
  q.placeholder = "then… what happens next?";
  renderChain(); renderSug(); renderChips(); update(); saveChain();
  q.focus();
}

function removeStep(i) {
  state.chain.splice(i, 1);
  if (!state.chain.length) q.placeholder = "explain machine learning · fix my resume · trip to japan…";
  renderChain(); update(); saveChain();
}

chainAddBtn.addEventListener("click", addStep);
chainEl.addEventListener("click", e => {
  const b = e.target.closest(".x");
  if (b) removeStep(+b.dataset.i);
});

/* A chain is worth sharing, so it lives in the URL. Written without firing a
   navigation so the hash listener doesn't re-apply what we just wrote — and
   wrapped, because some browsers refuse history writes on a file:// page. */
function saveChain() {
  try {
    const c = CHAIN.encode(state.chain);
    const h = new URLSearchParams(location.hash.slice(1));
    c ? h.set("c", c) : h.delete("c");
    const s = h.toString();
    history.replaceState(null, "", s ? "#" + s : location.pathname + location.search);
  } catch (e) { /* a URL we can't update is not a reason to lose the chain */ }
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
  const text = copyPrompt(true, "launch");
  if (!text) return;
  const needsImage = state.topic.trim() && effectiveDomain() === "vision";
  if (tool.url) {
    window.open(tool.url(text), "_blank");
    /* The launch link can carry the prompt but not the picture — better to say
       so than to let someone wonder why the answer describes nothing. */
    if (needsImage) showToast("Opened in " + tool.name + " — now attach your image ✦");
  } else {
    window.open(tool.home, "_blank");
    showToast(needsImage
      ? "Copied — paste it into " + tool.name + " and attach your image ✦"
      : "Copied — paste it into " + tool.name + " ✦");
  }
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
  /* Reopen what Escape closed. Without this the only way back to the
     suggestions is to edit the text, which is a dead end for a keyboard user. */
  else if (e.key === "ArrowDown" && !open && q.value.trim()) {
    e.preventDefault();
    state.matches = findMatches(q.value);
    state.sel = state.matches.length ? 0 : -1;
    renderSug();
  }
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
function syncDepthUI() {
  $("depth").setAttribute("aria-valuetext", depthLabels[state.depth]);
  $("depthOut").textContent = depthLabels[state.depth];
}
function syncToneUI() {
  $("tone").setAttribute("aria-valuetext", toneLabels[state.tone]);
  $("toneOut").textContent = toneLabels[state.tone];
}
$("depth").addEventListener("input", e => {
  state.depth = +e.target.value; state.padTouched = true;
  syncDepthUI(); update();
});
$("tone").addEventListener("input", e => { state.tone = +e.target.value; syncToneUI(); update(); });
syncDepthUI(); syncToneUI();

/* details-on-demand toggle */
function syncDrillUI() {
  const b = $("drill");
  b.classList.toggle("on", state.drill);
  b.setAttribute("aria-pressed", String(state.drill));
  $("drillOut").textContent = state.drill ? "On" : "Off";
}
$("drill").addEventListener("click", () => { state.drill = !state.drill; syncDrillUI(); update(); });
syncDrillUI();

/* Two axes define the prompt, and they are not independent: across is how much
   you steer, up is how much you want. Depth only exists once you are shaping
   the answer — until then the length is the model's call — so the vertical
   axis locks rather than lying about having an effect. Showing it locked
   teaches the relationship; hiding it would just look broken. */
const STEER_MODES = ["native", "guided", "shaped"];
const STEER_LABEL = { native: "Native", guided: "Guided", shaped: "Shaped" };
const STEER_HINT = {
  native: "model's own voice",
  guided: "say what I want",
  shaped: "fix the answer's form",
};
function syncSteerUI() {
  const i = STEER_MODES.indexOf(state.steer);
  $("steer").value = String(i);
  /* Arrowing this control should say "Shaped", not "2". */
  $("steer").setAttribute("aria-valuetext", STEER_LABEL[state.steer]);
  $("steerOut").textContent = STEER_LABEL[state.steer];
  $("steerHint").textContent = STEER_HINT[state.steer];
  /* Native hands length to the model entirely, so the vertical axis has
     nothing to say there. Everywhere else it does: as a want in Guided, as a
     shape in Shaped. */
  const locked = state.steer === "native";
  $("depthWrap").classList.toggle("locked", locked);
  $("depth").disabled = locked;
  $("depthWrap").title = locked
    ? "Native leaves the length to the model — slide Steer right to ask for more or less"
    : "How much of the answer you want";
  /* A dimmed, disabled control with the reason in a tooltip tells a
     screen-reader user nothing at all about why it stopped working. */
  if (locked) $("depth").setAttribute("aria-describedby", "depthlock");
  else $("depth").removeAttribute("aria-describedby");
  // the follow-up menu is also a shape, so Native has no use for it
  $("drill").disabled = state.steer === "native";
  $("drill").style.opacity = state.steer === "native" ? ".4" : "";
}
$("steer").addEventListener("input", e => {
  state.steer = STEER_MODES[+e.target.value] || "guided";
  state.padTouched = true;
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

/* ---------- personalization ----------
   The app gets better at YOUR asks by watching which prompts you actually take
   — nothing more. It stays in this browser: no account, no cookie, no beacon,
   nothing sent anywhere. That is not a limitation to work around, it is the
   product; a prompt box that phones home is not one people should paste their
   real problems into. The switch and the forget button are in plain sight
   because a memory you cannot inspect or erase is not a feature, it's a leak. */
function observe(type) {
  if (!PROFILE || !state.topic.trim()) return;
  const domId = state.domain || detectDomain(state.topic);
  const r = INTENT ? INTENT.recognize(state.topic) : null;
  PROFILE.observe({
    type, text: state.gold ? state.gold.q : state.topic, domain: domId,
    intent: r ? r.id : null, steer: state.steer, depth: state.depth,
  });
  if (type !== "type") syncLearnUI();
}

/* Settings the user endorsed last time they took a prompt in this domain.
   Applied only until they touch the axes themselves — a remembered default is
   a starting point, never an override of a live decision. */
let lastDomain = null;
function applyRemembered(domId) {
  if (!PROFILE || !PROFILE.enabled() || state.padTouched || domId === lastDomain) return;
  lastDomain = domId;
  const p = PROFILE.prefs(domId);
  if (!p) return;
  if (p.steer && STEER_MODES.indexOf(p.steer) >= 0) { state.steer = p.steer; syncSteerUI(); }
  if (typeof p.depth === "number" && p.depth >= 0 && p.depth <= 2) {
    state.depth = p.depth;
    $("depth").value = String(p.depth);
    syncDepthUI();
  }
}

function syncLearnUI() {
  if (!PROFILE) return;
  const on = PROFILE.enabled(), b = $("learn"), note = $("learnnote");
  b.classList.toggle("on", on);
  b.setAttribute("aria-pressed", String(on));
  $("learnOut").textContent = on ? "On" : "Off";
  const s = on ? PROFILE.summary() : null;
  note.innerHTML = !on
    ? "Off — nothing about you is stored."
    : s && s.tokens
      ? `Remembers ${s.tokens} words from ${s.asks} ${s.asks === 1 ? "ask" : "asks"}, in this browser only. ` +
        `<button data-forget="1" type="button">Forget everything</button>`
      : "Nothing remembered yet. Whatever it learns stays in this browser.";
}
if (PROFILE) {
  $("learn").addEventListener("click", () => { PROFILE.setEnabled(!PROFILE.enabled()); syncLearnUI(); });
  $("learnnote").addEventListener("click", e => {
    if (!e.target.closest("[data-forget]")) return;
    PROFILE.forget(); syncLearnUI(); showToast("Forgotten — nothing remembered ✦");
  });
  syncLearnUI();
}

/* ---------- external structure ----------
   The reasoning layer reads the shape of the ask. Sometimes another system
   already knows that shape better — a planner's dependency graph, a host page
   that knows the project. This lets that system hand its graph in.

   Everything arriving this way is untrusted, on the same footing as text
   pasted by a stranger: bridge.js counts its structure but only ever names a
   label that survives the same sanitizer the app uses on its own graph. */
if (BRIDGE) {
  try {
    if (BRIDGE.listen) BRIDGE.listen(window);
    if (BRIDGE.adopt) BRIDGE.adopt(window, location);
  } catch (e) { /* a host that hands us nonsense must not take the app down */ }
}

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
  "what is this plant",
  "fix my resume",
  "research the best health insurance for me",
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

/* ---------- works with no connection ----------
   Nothing here talks to a server after load, so there is no reason the app
   should stop working when the network does. Registered late and quietly: a
   failure to register costs nothing, and a prompt box that throws on startup
   because of an optional offline feature would be a bad trade. */
if ("serviceWorker" in navigator &&
    (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => { /* offline is a bonus, not a requirement */ });
  });
}

/* Deep link: #t=<topic> for one prompt, #c=<step|step|…> for a whole chain.
   Chains store only the typed topics — each step's prompt is rebuilt by the
   current engine, so a link shared today can't paste yesterday's wording. */
function rebuildStep(topic) {
  const held = { topic: state.topic, domain: state.domain, gold: state.gold };
  state.topic = topic; state.domain = null; state.gold = null;
  const prompt = segsToText(stepSegs());
  state.topic = held.topic; state.domain = held.domain; state.gold = held.gold;
  return { topic, prompt, domain: detectDomain(topic),
           constraints: CHAIN ? CHAIN.constraints(topic) : [] };
}

function applyHash() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const c = hash.get("c");
  if (c && CHAIN) {
    state.chain = CHAIN.decode(c).map(s => rebuildStep(s.topic));
    if (state.chain.length) q.placeholder = "then… what happens next?";
    renderChain();
  }
  const t = hash.get("t");
  if (t) { q.value = t; q.dispatchEvent(new Event("input")); state.matches = []; renderSug(); }
  else update();
}
window.addEventListener("hashchange", applyHash);
renderChain();
applyHash();
