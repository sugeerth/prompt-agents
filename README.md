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
- **Two axes.** Steer runs across the page, Depth runs up it — the pair defines
  the prompt in one glance. Depth is locked only in Native, where the model owns
  the length; in Guided it states how much you *want*, in Shaped it fixes the
  answer's form. Audience (Beginner ↔ Expert) lives behind Fine-tune.
- **Inline completion.** The rest of the highlighted suggestion is drawn in
  place, in grey, behind the cursor. Tab takes it. One keystroke to a whole ask.
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

Ten goals are recognized — **understand · decide · make · do · delegate · fix ·
explore · check · plan · find** — each contributing one line that states the goal and
never the format. Recognition also drives two other things: it picks the domain
when no topic cue fires ("my wifi keeps dropping" names no domain noun but is
unmistakably a fix), and it stops a review request being framed as a drafting
request.

When confidence is low, the prompt asks instead of assuming: *"If my goal here
is ambiguous, ask me one question before answering."* A confidently wrong frame
costs more than a round trip.

## Agent tasks: hand it off, with a harness

Some asks aren't questions — they're work: *set up ci for my repo*,
*migrate my database*, *keep my prs green*. The intent layer recognizes
**delegate** as its own goal ("Do this end to end — I want the result, not
instructions"), distinct from *do-it-myself*: "how do I set up CI" wants
instructions, "set up CI for my repo" wants it done.

Delegated asks build an **agent harness** instead of an answer shape — a
behavioral contract for whatever agent you paste it into (Claude Code, Cursor,
anything agentic): a verifiable end state, plan-first, stepwise execution with
verification, scope control, ask-before-destructive, escalation on being
blocked, and a completion report stating *how* the result was verified —
evidence, not the word "verified". Depth scales the contract from a terse
one-liner to full checkpoints and two-strike stop rules. Agent chips (Plan
first, Define done, Show proof, Scope guard, Escalate, Clean up) cover the
top failure modes of long-horizon agents, and six gold prompts ship for the
most-delegated tasks.

## Chaining: prompts that know about each other

One prompt is rarely the whole job. You ask for a trip plan, then what to pack,
then what it will cost. Today people retype the context every time — or worse,
they don't, and the model answers the second question as if the first never
happened.

**+ Next step** keeps the current prompt and clears the box. Type the next
thought in shorthand and the link is written for you:

> Help me with: what should we pack. **Step 1 asked:** 10 days in japan with kids on a tight budget. This continues from your answer to step 1 — build on it, don't repeat it. **The constraints still apply:** on a tight budget, with kids.

Three things carry across a step boundary, and each is there for a reason:

- **The subject**, but only when the new step can't stand on its own. "What
  should we pack" leans on step 1; "what winter clothes should we pack for our
  japan trip" doesn't, and restating it would just make the prompt longer.
  Detection is two independent tells — a continuation opener or an anaphor, or a
  short ask sharing no content word with the step before it.
- **Don't-repeat-it**, which is what actually keeps chained answers short.
- **The constraints.** "On a tight budget" was said once, in step 1, and it still
  governs step 3. The extractor is deliberately narrow — money, time, company,
  dietary and skill floors only — because a wrongly carried constraint silently
  changes the answer, while a missed one costs a retype.

Chains come out two ways: **Copy step N** for pasting as the conversation
progresses, or **Copy all N** for one numbered pipeline prompt an agent can run
end to end. A chain lives in the URL (`#c=…`), so it survives a reload and can be
shared — and because only the typed topics are stored, each step's prompt is
rebuilt by the current engine rather than pasted from an older one.

## Personalization, without telling anyone

The app gets better at *your* asks by watching which prompts you actually take —
a small **user vector** over the words you use, decayed so old interests fade
(~30-day half-life), pruned to 240 tokens, and weighted by how much each signal
really reveals: copying or launching a prompt counts fully, picking a suggestion
counts half, idle typing barely counts at all.

It re-ranks suggestions and restores the Steer/Depth you last endorsed in that
domain. Two limits keep it honest: the boost is **capped at 0.12 and can never
cross a match tier**, so an exact prefix match always outranks a merely familiar
one; and remembered settings apply only until you touch the axes yourself.

**Nothing leaves the browser.** No account, no cookie, no analytics, no beacon,
no third party — one `localStorage` key, an on/off switch, a line saying exactly
how much is remembered, and a Forget-everything button, all in plain sight.
`profile.js` is tested for this: its eval greps the source and fails if a network
API appears anywhere in it. (Cross-site browsing history is not available to a
web page at all — browsers block it by design — so no honest version of this
feature can read what you did on other sites, and this one doesn't try.)

## Taking structure from another system

`bridge.js` lets a host page, planner or knowledge graph hand its own structure
graph to the reasoning layer, through three entry points that all land in the
same validator: `postMessage` (`{type:"ps:graph", payload}`), a
`window.PS_EXTERNAL_GRAPH` global set before load, or a `#g=` URL fragment.

```js
{ nodes: [{ id, label, kind? }],
  edges: [{ from, to, type? }],   // constrain | seq | cond | couple
  source: "planner-x" }
```

An external graph is **untrusted input on the same footing as text pasted by a
stranger**. Its structure is counted freely; its words are only ever *named* if
they survive the same sanitizer the app uses on its own graph — lowercased, at
most three words and 24 characters, no instruction verbs, no markup, no generic
filler. Everything else becomes an anonymous node: it still shapes the reasoning,
it just never speaks. Malformed payloads are dropped rather than thrown, nodes
and edges are capped, and the file has no path to a code or DOM sink at all.

## The reasoning layer

The newest mode. Instead of treating every ask the same, the app models it as a
small **intent graph** and spends reasoning in proportion to that graph's shape.

It is a real graph with real algorithms (`graph.js`), not a keyword tally.

- **Nodes** — entities (what the ask is about), constraints (what bounds it).
- **Edges** — CONSTRAIN, SEQUENCE (ordering), CONDITION (branching), COUPLE
  (encoded in *both* directions, so a mutual constraint becomes a genuine
  cycle that the algorithm discovers rather than a regex asserting it).
- **Algorithms** — Tarjan SCC (mutually constraining quantities), topological
  sort + longest path over the cycle condensation (the forced order of
  dependent steps), PageRank (the crux), connected components (genuinely
  separate sub-problems), Hopcroft–Tarjan articulation points (the hinge),
  transitive reduction (removing implied edges before anything counts them),
  and a min-degree **treewidth** bound.
- **Metrics → ladder** — placed on **L0 Atomic · L1 Shaped · L2 Composite ·
  L3 Coupled**. Treewidth and circuit rank (`E − V + components`) carry the
  most weight because they are integer invariants: on a 5-node graph one extra
  cue match swings density by 0.2 and can flip a level, while treewidth moves
  by whole units or not at all. Treewidth is also the only metric that
  separates five constraints *in a chain* (width 1, easy) from five that all
  touch each other (width ≥3, genuinely hard) — the distinction CSP
  tractability theory (Freuder 1985/1990; Dechter & Pearl 1989) says is the
  real source of difficulty.

**What the graph says out loud.** At most one line, describing the structure of
the *problem* and never the form of the answer:

> *small, family, under 20k depend on each other — fixing one changes what the others can be.*
> *Resolve in order: bug → deploy → notify.*

If it finds nothing structural it says nothing at all. It fires on 13% of the
eval corpus by design: a missed finding costs nothing, while a false one
actively damages the answer, so the gates favour precision over recall.

**Slots are treated as hostile input.** A node label is user text being
interpolated into instruction position, so markup is stripped before parsing,
anything extracted from a clause that reads like an injected instruction may be
counted but never *named*, and every slot must pass a character, length and
denylist check. Anything that fails drops to a slotless phrasing — it never
fails open.

**Deliberately not implemented:** Tree/Graph-of-Thoughts search (needs a
controller loop; a single prompt buys the vocabulary of search with none of the
backtracking), knowledge-graph methods (Think-on-Graph, RoG — need a KG and a
retrieval step), trained GNN prompting, and Leiden/modularity community
detection, which is numerically degenerate on an 8-node graph. Connected
components is what that degrades to at this scale, so it is what we use.

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
(reasoning layer) + `graph.js` (the intent graph) + `chain.js` (prompt chaining) +
`profile.js` (the local user vector) + `bridge.js` (external structure) +
`data.js` (vocabulary, modifiers, gold cache) — that is the whole app.

Modifier phrasings and prompt patterns are distilled from public prompt-engineering
guidance (Anthropic, OpenAI, Google) and community prompt libraries.
