/* Eval for user-intent recognition.

   Intent decides what the prompt tells the model the user WANTS. Getting it
   wrong aims the whole answer in the wrong direction — worse than saying
   nothing, which is why low confidence must fall back to asking rather than
   guessing. So it gets a labelled corpus, an accuracy gate, and a check that
   the intent lines never smuggle in formatting instructions. */

const fs = require('fs');
const path = require('path');

global.window = {};
// eslint-disable-next-line no-eval
eval(fs.readFileSync(path.join(__dirname, '..', 'intent.js'), 'utf8'));
const { recognize, INTENTS, CLARIFY } = global.window.PS_INTENT;

const CORPUS = [
  // understand — wants the thing to make sense
  ['explain machine learning', 'understand'],
  ['what is inflation', 'understand'],
  ['why does the sky look blue', 'understand'],
  ['how does a heat pump work', 'understand'],
  ['eli5 quantum entanglement', 'understand'],
  ['difference between tcp and udp', 'understand'],

  // decide — wants a call made
  ['should i rent or buy', 'decide'],
  ['react vs vue', 'decide'],
  ['mac or windows for video editing', 'decide'],
  ['is a heat pump worth it', 'decide'],
  ['choose between three job offers', 'decide'],
  ['which laptop should i get', 'decide'],

  // make — wants an artifact
  ['write a resignation letter', 'make'],
  ['draft an email to my landlord', 'make'],
  ['write a cover letter for a design role', 'make'],
  ['create a linkedin bio', 'make'],
  ['rewrite this paragraph', 'make'],

  // do — wants to perform it
  ['how do i change a tire', 'do'],
  ['how do i book a flight', 'do'],
  ['how to set up a home network', 'do'],
  ['walk me through filing taxes', 'do'],
  ['install python on a mac', 'do'],

  // delegate — wants it done end to end, not instructions
  /* A question is never a hand-off, however many delegate verbs it contains.
     "is my landlord allowed to keep my deposit" once built a mission brief
     with monitoring rules in place of a legal answer. */
  ['how do i automate my weekly report', 'do'],
  ['set up ci for my repo', 'delegate'],
  ['automate my weekly report', 'delegate'],
  ['migrate my database to postgres', 'delegate'],
  ['build and deploy a landing page', 'delegate'],
  ['keep my prs green end to end', 'delegate'],
  ['monitor my logs for errors', 'delegate'],
  ['book a plumber to fix my sink', 'delegate'],
  ['research the best health insurance for me', 'delegate'],
  ['renew my car registration for me', 'delegate'],

  // fix — wants it working
  ['fix my login bug', 'fix'],
  ['my wifi keeps dropping', 'fix'],
  ['python indentation error', 'fix'],
  ['dishwasher not draining', 'fix'],
  ['why is my laptop so slow', 'fix'],

  // explore — wants possibilities
  ['side hustle ideas', 'explore'],
  ['brainstorm names for a bakery', 'explore'],
  ['gift ideas for my dad', 'explore'],
  ['what could i do with leftover rice', 'explore'],

  // check — wants judgement on their work
  ['review my resume', 'check'],
  ['is this email too aggressive', 'check'],
  ['is my resume good enough', 'check'],
  ['proofread this paragraph', 'check'],
  ['is this sql query correct', 'check'],
  ['what is wrong with my css', 'check'],

  // plan — wants a followable plan
  ['plan a wedding', 'plan'],
  ['7 day japan itinerary', 'plan'],
  ['marathon training plan', 'plan'],
  ['organize a move to a new city', 'plan'],

  // find — wants specific real suggestions
  ['best tacos near me', 'find'],
  ['coffee shops nearby', 'find'],
  ['where can i buy a used bike', 'find'],
  ['nearest hiking trails', 'find'],
];

const N = CORPUS.length;
const misses = [];
const perIntent = {};

for (const [q, want] of CORPUS) {
  const r = recognize(q);
  perIntent[want] = perIntent[want] || { n: 0, ok: 0 };
  perIntent[want].n++;
  if (r.id === want) perIntent[want].ok++;
  else misses.push({ q, want, got: r.id, conf: r.confidence, scores: r.scores });
}

const correct = N - misses.length;
const acc = (correct / N) * 100;

console.log('Intent recognition eval');
console.log('─'.repeat(58));
for (const [id, s] of Object.entries(perIntent)) {
  const pct = ((s.ok / s.n) * 100).toFixed(0).padStart(3);
  console.log(`  ${id.padEnd(12)} ${String(s.ok).padStart(2)}/${s.n}  ${pct}%`);
}
console.log('─'.repeat(58));
for (const m of misses) {
  console.log(`MISS  want ${m.want} got ${m.got} (conf ${m.conf})  "${m.q}"`);
  console.log(`      scores: ${JSON.stringify(m.scores)}`);
}

let invariantFailures = 0;
const bad = msg => { invariantFailures++; console.log('INVARIANT FAIL:', msg); };

/* 1. An intent line states what the user WANTS. The moment it dictates shape,
      length or structure, it stops conveying intent and starts forcing form —
      which is the failure this whole layer exists to correct. */
const FORM_WORDS = /\b(bullet|bullets|table|numbered|steps only|max \d|under \d+ words?|word limit|sentences? max|format as|\d+ bullets?|one paragraph)\b/i;
for (const i of INTENTS) {
  if (FORM_WORDS.test(i.line)) bad(`intent line dictates format: "${i.line}"`);
  if (i.line.split(/\s+/).length > 16) bad(`intent line too long: "${i.line}"`);
}
if (FORM_WORDS.test(CLARIFY)) bad('clarify line dictates format');

/* 2. Ambiguity must produce low confidence, so the caller asks instead of
      assuming. A bare topic carries no goal at all. */
for (const vague of ['sourdough', 'python', 'insurance', 'my car']) {
  const r = recognize(vague);
  if (r.confidence > 0.5) bad(`bare topic "${vague}" claimed confidence ${r.confidence} (${r.id})`);
}

/* 3. Empty input must never assert an intent. */
if (recognize('').id !== 'open') bad('empty input did not fall back to open');

const THRESHOLD = 85;
console.log(`\naccuracy ${correct}/${N} = ${acc.toFixed(1)}%  (gate: ${THRESHOLD}%)`);

if (acc < THRESHOLD) { console.log('\nFAILED: intent accuracy below gate'); process.exit(1); }
if (invariantFailures) { console.log(`\nFAILED: ${invariantFailures} invariant violation(s)`); process.exit(1); }
console.log('PASSED');
