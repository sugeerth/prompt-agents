# tools/ — the data pipeline

`data.js` at the repo root is **generated**. It is the only file in the project
that is not written by hand, and hand-edits to it are lost on the next
regeneration. The sources of truth live here:

| file | what it holds |
| --- | --- |
| `vocab.json` | the autocomplete vocabulary — `{"t": "<what someone types>", "d": "<domain id>"}` |
| `gold.json` | the hand-tuned prompt cache — `{"q": "<query>", "d": "<domain id>", "p": "<prompt served verbatim>"}` |
| `gen-data.js` | validates both, then writes `../data.js` |

`PS_MODS` (the one-tap modifiers) is deliberately **not** stored here. The
generator lifts that block verbatim out of the current `data.js`, so
regenerating the vocabulary can never perturb the modifier list.

## Regenerate

```sh
node tools/gen-data.js     # writes ../data.js
node tests/data-eval.js    # gate: shape, duplicates, coverage, floors
```

The generator throws on the first problem it finds rather than emitting a bad
`data.js`, so a failed run leaves the previous file intact.

## Adding a vocabulary entry

Append an object to `vocab.json`. Ordering does not matter — the generator
sorts shortest-first on the way out.

```json
{"t": "dispute a medical bill", "d": "legal"}
```

Rules, all enforced by `gen-data.js` and again by `tests/data-eval.js`:

- **It is what a person types.** Lowercase, 2–8 words, no sentence punctuation.
  Apostrophes and hyphens are fine (`won't`, `x-ray`) because that is how people
  actually type. No invented corporate phrasing.
- **No near-duplicates.** If an existing entry is the same ask reworded, the
  suggestion list gets worse, not better — the similarity engine will already
  match both.
- **`d` is one of the domain ids** in the `DOMAINS` table at the top of `app.js`.
  `general` exists as the free-typing fallback and carries no entries.
- **The tag should agree with what the engine would infer.** `app.js` has a
  `detectDomain()` that routes free text via the `SIGS` keyword table and the
  intent recognizer. A vocabulary entry carries its own `d`, so the tag wins —
  but if `detectDomain()` would confidently route the same text somewhere else
  *and be right*, the tag is wrong or the entry text is unclear. Prefer fixing
  the wording. (Tagging something the engine reads as `general` is fine: that
  just means no keyword fired and the tag is adding information.)
- **Aim at the long tail.** The list is easy to skew toward software and
  self-improvement. What it is actually for is bureaucracy, care work, grief,
  small-business admin, accessibility, pets, cars, gardening, and life outside
  the US — the asks a prompt tool usually misses.
- **Cover the keyboard.** Every letter a–z must have entries, and common
  two-letter prefixes should too. The whole promise is that the first keystroke
  or two already helps.

## Adding a gold prompt

A gold entry short-circuits the whole engine: on a strong similarity match its
`p` is served verbatim. So it must be the single best prompt the app has for
that ask, not a template.

```json
{
 "q": "dispute a medical bill",
 "d": "legal",
 "p": "Steps in order: request an itemized bill, … Say plainly when this needs a lawyer."
}
```

House rules, all enforced:

- **State the answer shape and cap it.** Succinct output is the entire product
  thesis. Every prompt says what form the answer takes and ends with an explicit
  size limit — a word count, a row count, a bullet count.
- **Say what is wanted. Never cast a role.** `You are an expert…` is banned and
  the generator rejects it; so are `act as`, `pretend you are`, and friends.
  No politeness padding.
- **Ask one question rather than assume.** Where the answer is worthless without
  a detail the user did not give (which country, how long they will stay, what
  actually hurts), the prompt tells the model to ask that one thing first.
- **60 words maximum.**
- **High-stakes domains do not fake authority.** `money`, `health` and `legal`
  prompts say plainly when a real professional is needed — no boilerplate
  disclaimers, one honest sentence where it matters.
- **Use `<angle bracket slots>`** for the context the user must paste or fill in.
- **Do not carry the drill line.** The host appends the "go deeper" affordance at
  render time; a prompt that includes its own emits it twice.
- **Never remove or rename an existing `q`.** Those queries are the head of the
  real distribution and several are asserted by name in `tests/data-eval.js`.
  Dropping one silently downgrades a cached answer to a generic one.

## Floors

`gen-data.js` and `tests/data-eval.js` both hold a floor on the corpus size
(currently 850 vocabulary entries, 110 gold prompts). They exist so a later edit
that shrinks the corpus fails loudly. Raise them as the corpus grows; do not
lower them to make a build pass.
