# Prompt Studio ✦ — type less, get exactly what you want

A zero-cost, fully client-side prompt builder for everyone. Start typing anything —
one letter is enough — and a short, surgically specific prompt builds itself,
ready to copy or launch straight into ChatGPT, Claude, Gemini, or Perplexity.

## The idea

Most prompt tools make prompts *longer*. This one makes them **shorter and sharper**.
Every generated prompt is answer-shape-first ("3 bullets", "one table", "steps only")
with an explicit size cap, because that's what actually makes LLMs answer tightly.
Users have no attention span — neither should prompts.

## How it works

- **Type one letter → suggestions.** 352 built-in completions of things real people
  ask, across 31 life-and-work domains (cooking, money, code, parenting, travel,
  nearby places, …) with full a–z coverage, so the first keystroke always helps.
- **Two-tower-style similarity matching.** The query and every entry are embedded
  into the same IDF-weighted token space and scored by cosine blended with
  character-trigram Jaccard — typos ("explan machine lerning") and reordered
  words ("salary negotiate") still land on the right entry. Fully client-side.
- **Gold cache of the top real-world queries.** The head of the LLM query
  distribution — researched from published ChatGPT/Gemini/Perplexity usage data —
  ships as 60 hand-reasoned prompts, surfaced as pinned ★ "tuned" suggestions and
  served verbatim on similarity match, with chips and sliders still composable.
- **Complex asks.** A multi-intent ask ("10 days in japan with kids on a budget")
  gets one guard line — "Cover every constraint I stated." — so nothing is dropped.
- **Domain engine.** Each domain has a succinct prompt template in three depths
  (TL;DR / Standard / Deep) tuned to that kind of ask.
- **One-tap modifiers.** 28 chips — Diagram, ELI5, Table, Steps, Quiz me, Pros/cons… —
  each appends a short, battle-tested directive. The most relevant chips for your
  domain float to the front.
- **Two sliders.** Depth (TL;DR ↔ Deep) and Audience (Beginner ↔ Expert) reshape
  the prompt live.
- **Go-deeper menu (details on demand).** By default every prompt ends with
  "End with 3 numbered one-line ways to go deeper; I'll pick by number." — the
  model answers in a few highly relevant sentences, then offers drill-downs you
  invoke by replying with a number. Succinct understanding first, depth on demand.
- **The prompt is the control surface.** Click any piece of the generated prompt
  to edit it in place: click a modifier to remove it, click the answer-shape
  sentence to cycle depth, click the audience line to clear it.
- **One-tap launch.** Copy with ⏎, or open ChatGPT / Claude / Perplexity with the
  prompt pre-filled (Gemini: copied + opened).

## Steer: how much the prompt is allowed to shape the reply

A prompt that dictates form gets a *shaped* answer. A prompt that conveys intent
gets a *good* one. Sometimes you want the model's own voice — so shaping is a
control, not a default posture, and it starts in the middle.

| Steer | The prompt carries | Good for |
|---|---|---|
| **Native** | your words + what you want, and nothing else | letting the model answer the way it would answer a person |
| **Guided** (default) | light framing, your goal, and a follow-up menu | most asks |
| **Shaped** | also fixes the answer's shape and length | when you need a specific artifact |

Native is genuinely native: no answer shape, no word cap, no follow-up menu, and
reasoning phrased so it never touches the form of the reply. Only two things
always survive, because they are content rather than form — *preconditions*
("ask where I am first if it changes the answer") and what you actually want.

## Intent recognition

Domain answers *what this is about*. Intent answers the more useful question:
*what does this person want to happen?* The same topic carries different goals —
someone curious about fermentation and someone whose starter died this morning
both type "sourdough starter".

Nine goals are recognized — **understand · decide · make · do · fix · explore ·
check · plan · find** — each contributing one line that states the goal and
never the format. Recognition also drives two other things: it picks the domain
when no topic cue fires ("my wifi keeps dropping" names no domain noun but is
unmistakably a fix), and it stops a review request being framed as a drafting
request.

When confidence is low, the prompt asks instead of assuming: *"If my goal here
is ambiguous, ask me one question before answering."* A confidently wrong frame
costs more than a round trip.

## The reasoning layer

The newest mode. Instead of treating every ask the same, the app models it as a
small **intent graph** and spends reasoning in proportion to that graph's shape.

- **Nodes** — entities (what the ask is about), constraints (what bounds it),
  options (what's being chosen between).
- **Edges** — CONSTRAIN, COMPARE, SEQUENCE (dependency depth), CONDITION
  (branching), COUPLE (one constraint pulling on several entities at once —
  the real driver of difficulty).
- **Metrics → ladder** — node/edge counts, density, longest dependency path,
  max out-degree, comparison arity and constraint coupling place the ask on a
  4-level ladder: **L0 Atomic · L1 Shaped · L2 Composite · L3 Coupled**.

What each level buys:

| Level | Signature | Reasoning spent |
|---|---|---|
| L0 | one thing, unbounded | none — a scaffold here costs tokens and can *lower* accuracy |
| L1 | one thing, bounded | none, except a compressed 5-word-step chain for computational asks |
| L2 | parts must resolve before an answer exists | integrate the sub-questions, show only the result + one line of why |
| L3 | several things weighed at once, or a chain under constraints | weigh 3 approaches against the constraints, show only the winner, why, and what would flip the call |

High-stakes domains (money, health, legal, code, math) additionally get a
single verification line at L2+.

**Deep reasoning, shallow output.** The scaffolds never ask for *less* thinking:
telling a model to be brief on a hard ask measurably degrades its reasoning
([Short-Path Prompting, arXiv 2504.09586](https://arxiv.org/abs/2504.09586)), so
each line grants unlimited reasoning and constrains only what gets rendered —
today's providers keep that chain in hidden thinking tokens. Every scaffold also
keeps a residual "one line of why" slot, which preserves far more accuracy than
a bare "just answer". The L1 computational line follows
[Chain of Draft (arXiv 2502.18600)](https://arxiv.org/abs/2502.18600); the L0
no-scaffold branch follows
[AdaptThink (arXiv 2505.13417)](https://arxiv.org/abs/2505.13417), where skipping
thought on easy items *improved* accuracy while cutting length by half. L3 ships
compressed candidate-scoring rather than pretending to run tree/graph search — a
single prompt has no search loop, and asking for one buys the vocabulary of
search at several times the tokens.

Click the **L2 Composite** style badge under any prompt to see the intent graph
the level was derived from. The **Reasoning** control cycles Auto (spend only
when the structure earns it) → Always → Off.

## Tests

`npm test` runs everything; CI (`.github/workflows/eval.yml`) runs it on every
push and PR.

- `npm run test:eval` — two scored evals, no browser. The **complexity ladder**
  against a labelled corpus with a confusion matrix, gated on accuracy plus
  three invariants (no reasoning spent on an atomic ask, no scaffold suppresses
  reasoning, spend monotonic in complexity). The **intent recognizer** against a
  labelled corpus, gated on accuracy plus invariants that no intent line ever
  dictates format and that ambiguous input yields low confidence.
- `npm run test:ui` — drives the real app in headless Chromium: the domain
  engine across every domain, all modifier chips, clipboard, launch URLs, XSS
  escaping, deep links, mobile overflow, similarity matching, the gold cache,
  the reasoning layer, and every steer level — including a check that Native
  never dictates shape, length or structure.

No build step, no dependencies, no network calls, nothing leaves the browser.
`index.html` + `app.js` (engine) + `intent.js` (goal recognition) + `reason.js`
(reasoning layer) + `data.js` (vocabulary, modifiers, gold cache) — that is the
whole app.

Modifier phrasings and prompt patterns are distilled from public prompt-engineering
guidance (Anthropic, OpenAI, Google) and community prompt libraries.
