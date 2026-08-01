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

No build step, no dependencies, no network calls, nothing leaves the browser.
`index.html` + `app.js` (engine) + `data.js` (vocabulary & modifiers) — that's the whole app.

Modifier phrasings and prompt patterns are distilled from public prompt-engineering
guidance (Anthropic, OpenAI, Google) and community prompt libraries.
