/* Eval for the reasoning layer's complexity ladder.

   The ladder decides how much reasoning each ask is worth. Getting it wrong is
   expensive in both directions: under-scaffolding an L2/L3 ask costs
   correctness, over-scaffolding an L0/L1 ask costs tokens and — per AdaptThink
   (arXiv 2505.13417) — sometimes costs accuracy too. So it gets a labelled
   corpus and a hard gate, not a spot check.

   Runs in plain node, no browser, in milliseconds. */

const fs = require('fs');
const path = require('path');

global.window = {};
// eslint-disable-next-line no-eval
eval(fs.readFileSync(path.join(__dirname, '..', 'reason.js'), 'utf8'));
const { analyze, scaffoldFor, LEVEL_NAME } = global.window.PS_REASON;

/* label = the level a careful human would assign, judging only structure */
const CORPUS = [
  // ---- L0 atomic: one thing, unbounded ----
  ['explain gravity', 0],
  ['pasta recipe', 0],
  ['what is inflation', 0],
  ['photosynthesis', 0],
  ['capital of peru', 0],
  ['define entropy', 0],

  // ---- L1 shaped: one thing, bounded (framing or a single constraint) ----
  ['explain gravity to a 10 year old', 1],
  ['explain machine learning to a beginner', 1],
  ['quick pasta recipe', 1],
  ['explain machine learning', 1],
  ['negotiate salary offer', 1],
  ['best noise cancelling headphones', 1],
  ['eli5 quantum entanglement', 1],
  ['30 minute dinner ideas', 1],
  ['resignation letter template', 1],

  // ---- L2 composite: parts must resolve before an answer exists ----
  ['compare react vs vue', 2],
  ['mac or windows for video editing', 2],
  ['7 day japan itinerary with kids', 2],
  ['meal prep for the week under $50', 2],
  ['should i rent or buy', 2],
  ['fix login bug then deploy', 2],
  ['marathon training plan in 16 weeks', 2],
  ['if the tests fail should i rollback', 2],
  ['iphone or android for photography', 2],

  // ---- L3 coupled: several things weighed at once, or a chain under constraints ----
  ['react vs vue vs svelte for a small team', 3],
  ['10 days in japan with kids on a tight budget', 3],
  ['plan a wedding under 20k balancing family expectations and a small venue', 3],
  ['choose between three job offers weighing salary and remote work', 3],
  ['launch a side business while working full time without quitting', 3],
  ['pick between two apartments trading off commute and rent', 3],
  ['low carb meal plan for a family with a nut allergy on a budget', 3],
];

const N = CORPUS.length;
const confusion = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
const misses = [];

for (const [q, want] of CORPUS) {
  const m = analyze(q);
  confusion[want][m.level]++;
  if (m.level !== want) misses.push({ q, want, got: m.level, m });
}

const correct = N - misses.length;
const acc = (correct / N) * 100;

console.log('Reasoning ladder eval');
console.log('─'.repeat(58));
console.log('        predicted');
console.log('actual   L0   L1   L2   L3');
confusion.forEach((row, i) => {
  console.log(`  L${i}  ` + row.map(v => String(v).padStart(4)).join(' '));
});
console.log('─'.repeat(58));

for (const x of misses) {
  console.log(`MISS  want L${x.want} got L${x.got}  "${x.q}"`);
  console.log(`      V=${x.m.V} E=${x.m.E} depth=${x.m.depth} branch=${x.m.branch} ` +
              `arity=${x.m.arity} constraints=${x.m.constraints} coupling=${x.m.coupling}`);
}

/* Guard the two properties that must never break, independent of accuracy. */
let invariantFailures = 0;
const bad = msg => { invariantFailures++; console.log('INVARIANT FAIL:', msg); };

// 1. no scaffold may ever be spent on an atomic ask (the over-reasoning tax)
for (const [q, want] of CORPUS.filter(c => c[1] === 0)) {
  if (scaffoldFor(analyze(q), 'general', 'auto').length) bad(`reasoning spent on atomic ask "${q}"`);
}

// 2. every scaffold must grant reasoning rather than suppress it, and must
//    leave a place for the model to land its conclusion
//    (Short-Path Prompting, arXiv 2504.09586)
for (const [q] of CORPUS.filter(c => c[1] >= 2)) {
  for (const s of scaffoldFor(analyze(q), 'general', 'auto')) {
    if (s.kind !== 'reason') continue;
    if (!/Reason as long as you need/.test(s.text)) bad(`scaffold suppresses reasoning: "${s.text}"`);
    if (!/show only/.test(s.text)) bad(`scaffold has no output contract: "${s.text}"`);
    if (!/one line of why/.test(s.text)) bad(`scaffold has no justification slot: "${s.text}"`);
  }
}

// 3. spend must be monotonic: a higher level never costs fewer words
const spend = [0, 1, 2, 3].map(l => {
  const sample = CORPUS.filter(c => c[1] === l);
  const words = sample.map(([q]) =>
    scaffoldFor(analyze(q), 'general', 'auto').reduce((n, s) => n + s.text.split(/\s+/).length, 0));
  return Math.round(words.reduce((a, b) => a + b, 0) / Math.max(words.length, 1));
});
console.log(`\navg scaffold words by level: ${spend.map((w, i) => `L${i}=${w}`).join('  ')}`);
for (let i = 1; i < 4; i++) if (spend[i] < spend[i - 1]) bad(`spend not monotonic at L${i}`);

const THRESHOLD = 90;
console.log(`\naccuracy ${correct}/${N} = ${acc.toFixed(1)}%  (gate: ${THRESHOLD}%)`);

if (acc < THRESHOLD) { console.log('\nFAILED: ladder accuracy below gate'); process.exit(1); }
if (invariantFailures) { console.log(`\nFAILED: ${invariantFailures} invariant violation(s)`); process.exit(1); }
console.log('PASSED');
