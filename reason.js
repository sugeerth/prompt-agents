/* Prompt Studio — reasoning layer.

   Models the user's ask as a small intent graph, measures its structure, and
   spends reasoning instructions in proportion to what that structure demands.

   Nodes   entities (what the ask is about), constraints (what bounds it),
           options (what is being chosen between)
   Edges   CONSTRAIN (constraint → entity), COMPARE (option ↔ option),
           SEQUENCE (step → step, gives dependency depth),
           CONDITION (branch points), COUPLE (one constraint pulling on
           several entities at once — the real driver of difficulty)

   The graph metrics map onto a 4-level ladder. L0/L1 asks get NO scaffold:
   over-reasoning a simple question costs tokens, invites hallucinated
   decomposition, and bloats the answer. L2/L3 asks get one line that buys
   real reasoning — always phrased so the working stays internal and the
   answer stays terse. Deep reasoning, shallow output. */

(function () {
  const STOP = new Set(("a an the my our your his her its their this that these those i me we us you he she they it " +
    "is are was were be been being am do does did doing have has had having " +
    "of in on at to for from with by about into over under again further then once " +
    "and or but so as if than too very just also " +
    "how what why when where which who whom whose can could should would will shall may might must " +
    "me myself help give show tell make get need want please").split(" "));

  /* cheap lexical detectors — each edge type has its own cue set */
  const CUE = {
    constraint: [
      /\bunder \$?\d+/, /\bover \$?\d+/, /\bless than\b/, /\bat least\b/, /\bat most\b/, /\bno more than\b/,
      /\bmax(imum)?\b/, /\bmin(imum)?\b/, /\bbudget\b/, /\bcheap(ly)?\b/, /\baffordable\b/, /\bfree\b/,
      /\bwithin \d+/, /\bin \d+ (day|week|month|hour|minute|year)/, /\bby (monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next \w+)\b/,
      /\bwithout\b/, /\bavoid(ing)?\b/, /\bexcept\b/, /\bonly\b/, /\bmust\b/, /\bcan'?t\b/, /\bdon'?t\b/, /\bnot\b/,
      /\bkids?|children|toddler|family|teens?\b/,
      /\bvegan|vegetarian|gluten|dairy|keto|halal|kosher\b/, /\bremote|part.?time|full.?time\b/,
      /\bfor (a|an|my|our) \w+/, /\bwith (a|an|my|our|no) \w+/, /\btight\b/, /\bsmall\b/, /\bquick(ly)?\b/, /\bfast\b/,
    ],
    compare: [/\bvs\.?\b/, /\bversus\b/, /\bcompare\b/, /\bbetter than\b/, /\bwhich (one|is|should)\b/,
      /\bpros and cons\b/, /\bchoose between\b/, /\bdecide between\b/, /\bor\b/],
    sequence: [/\bthen\b/, /\bafter(wards)?\b/, /\bbefore\b/, /\bfirst\b/, /\bnext\b/, /\bfinally\b/,
      /\bfollowed by\b/, /\bonce (i|we|you|it)\b/, /\bstep by step\b/, /\bstages?\b/, /\bphases?\b/],
    condition: [/\bif\b/, /\bunless\b/, /\bdepending on\b/, /\bin case\b/, /\bwhether\b/, /\botherwise\b/],
    /* framing constraints set tone and level, not the shape of the solution —
       the Audience control already owns these, so they must not inflate the
       structural complexity of the ask */
    framing: [/\bbeginner|expert|novice|advanced|layman|non.?technical\b/, /\beli5\b/,
      /\b\d+ year old\b/, /\bsimple terms\b/, /\blike i'?m \w+\b/],
    couple: [/\btrad(e|ing).?offs?\b/, /\bbalanc(e|ing)\b/, /\bwithout sacrificing\b/, /\bwhile (also |still )?\w+ing\b/,
      /\bbut also\b/, /\bat the same time\b/, /\bboth\b/, /\bas well as\b/,
      /\bweigh(ing|s)?\b.*\band\b/, /\bfactoring in\b/, /\btaking into account\b/],
  };

  /* spelled-out counts, so "three job offers" is read as arity 3 */
  const NUMWORD = { two: 2, three: 3, four: 4, five: 5, "2": 2, "3": 3, "4": 4, "5": 5 };

  const count = (t, list) => list.reduce((n, re) => n + (re.test(t) ? 1 : 0), 0);

  function entitiesOf(t) {
    const seen = new Set();
    for (const w of t.toLowerCase().replace(/[^a-z0-9\s$]/g, " ").split(/\s+/)) {
      if (w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)) seen.add(w);
    }
    return [...seen];
  }

  /* how many things are being compared: "react vs vue vs svelte" → 3,
     "three job offers" → 3, "choose between A and B" → 2 */
  function comparisonArity(t) {
    const parts = t.split(/\bvs\.?\b|\bversus\b|\bor\b|\bcompared? to\b/);
    let arity = parts.length >= 2 ? parts.filter(p => p.trim().length > 1).length : 0;

    const counted = t.match(/\b(two|three|four|five|[2-5])\s+\w*\s*(options?|offers?|choices?|candidates?|alternatives?|approaches?|paths?|plans?|ways)\b/);
    if (counted) arity = Math.max(arity, NUMWORD[counted[1]] || 0);

    if (/\b(choose|decide|pick|deciding|choosing)\s+(between|among)\b/.test(t)) {
      arity = Math.max(arity, 2);
      const listed = t.match(/\b(?:between|among)\b([^.?!]*)/);
      if (listed) {
        const n = (listed[1].match(/\band\b|,/g) || []).length + 1;
        arity = Math.max(arity, Math.min(n, 5));
      }
    }
    return arity;
  }

  function analyze(text) {
    const t = " " + text.toLowerCase().trim() + " ";
    const words = text.trim().split(/\s+/).filter(Boolean).length;

    const entities = entitiesOf(text);
    const framing = count(t, CUE.framing);
    const constraints = count(t, CUE.constraint);   // structural only
    const sequence = count(t, CUE.sequence);
    const condition = count(t, CUE.condition);
    const coupling = count(t, CUE.couple);
    const arity = comparisonArity(t);
    const compare = count(t, CUE.compare) > 0 || arity >= 2;

    // graph size: one node per distinct entity, constraint, and option
    const options = arity >= 2 ? arity : 0;
    const V = entities.length + constraints + options;
    // edges: every constraint binds to the ask, options pair up, steps chain,
    // conditions branch, coupling cues cross-link constraints to entities
    const E = constraints + (options >= 2 ? options - 1 : 0) + sequence + condition + coupling;
    const density = V ? +(E / V).toFixed(2) : 0;
    const depth = sequence > 0 ? sequence + 1 : 1;          // longest dependency chain
    const branch = Math.max(options, condition > 0 ? condition + 1 : 1); // max out-degree

    /* --- ladder ---------------------------------------------------------
       L3 coupled/combinatorial: several things weighed at once, or a chain
                                 of dependent steps under real constraints
       L2 composite:            multiple parts that must be resolved before
                                the answer exists
       L1 shaped:               one thing, bounded
       L0 atomic:               one thing, unbounded                       */
    let level;
    if (arity >= 3 ||
        (coupling >= 1 && (constraints >= 1 || compare)) ||
        (depth >= 3 && constraints >= 1) ||
        (compare && constraints >= 2) ||
        (constraints >= 3 && entities.length >= 3))
      level = 3;
    else if (compare || constraints >= 2 || depth >= 2 || condition >= 1 ||
             (entities.length >= 4 && constraints >= 1))
      level = 2;
    else if (constraints >= 1 || framing >= 1 || entities.length >= 3 || words >= 6)
      level = 1;
    else
      level = 0;

    return {
      level, V, E, density, depth, branch, arity, coupling, framing,
      entities: entities.slice(0, 8), constraints, compare,
      why: whyText({ level, entities, constraints, arity, depth, branch, coupling, compare }),
    };
  }

  function whyText(m) {
    const bits = [];
    bits.push(m.entities.length + (m.entities.length === 1 ? " topic" : " topics"));
    if (m.constraints) bits.push(m.constraints + (m.constraints === 1 ? " constraint" : " constraints"));
    if (m.arity >= 2) bits.push(m.arity + " options weighed");
    if (m.depth >= 2) bits.push("dependency depth " + m.depth);
    if (m.branch >= 2) bits.push("branching " + m.branch);
    if (m.coupling) bits.push("interacting constraints");
    return bits.join(" · ");
  }

  /* --- scaffolds ---------------------------------------------------------
     One line each, every word load-bearing.

     Phrasing follows the evidence, not intuition. "Be brief" applied to a hard
     ask measurably degrades reasoning (Short-Path Prompting, arXiv 2504.09586),
     so these lines never ask for LESS thinking — they grant unlimited reasoning
     and constrain only what gets rendered. Today's providers keep that chain in
     hidden thinking tokens, so depth costs the reader nothing.

     Every scaffold also keeps a residual "one line of why" slot: leaving the
     model somewhere to land its conclusion preserves far more accuracy than a
     bare "just answer".

     L3 deliberately ships compressed candidate-scoring rather than asking for
     tree/graph search. A single prompt cannot run a search loop; asking for one
     buys the vocabulary of search at 3-10x the tokens and none of the
     backtracking (ToT, arXiv 2305.10601; GoT, arXiv 2308.09687). */
  const SCAFFOLD = {
    0: null,
    1: null,
    2: "Reason as long as you need, then show only the integrated answer and one line of why.",
    3: "Reason as long as you need: weigh 3 approaches against my constraints, then show only the winner, one line of why, and what would flip the call.",
  };

  /* Where the bottleneck is calculation rather than composition, even a simple
     ask benefits from a compressed chain — dense 5-word steps retain most of
     chain-of-thought's accuracy at a fraction of its length
     (Chain of Draft, arXiv 2502.18600). */
  const COMPUTE_DOMAINS = new Set(["math", "code", "debug", "analyze", "money"]);
  const COMPUTE_STEPS = "Work in brief steps, five words each, then give the final answer.";

  /* domains where a wrong answer is expensive get one verification line */
  const VERIFY_DOMAINS = new Set(["money", "health", "legal", "code", "debug", "math", "analyze", "biz"]);
  const VERIFY = "Check the answer once for the most likely error before replying.";

  function scaffoldFor(metrics, domId, mode) {
    if (mode === "off") return [];
    const level = mode === "force" ? Math.max(metrics.level, 2) : metrics.level;
    const out = [];
    if (SCAFFOLD[level]) out.push({ text: SCAFFOLD[level], kind: "reason" });
    else if (level === 1 && COMPUTE_DOMAINS.has(domId))
      out.push({ text: COMPUTE_STEPS, kind: "reason" });
    if (level >= 2 && VERIFY_DOMAINS.has(domId)) out.push({ text: VERIFY, kind: "verify" });
    return out;
  }

  const LEVEL_NAME = ["Atomic", "Shaped", "Composite", "Coupled"];

  window.PS_REASON = { analyze, scaffoldFor, LEVEL_NAME };
})();
