/* Eval for the counterfactual lab.

   An off-policy estimate is a number about something that never happened,
   which makes it the easiest kind of number to get confidently wrong. So this
   file does not test that the estimators return plausible values. It builds a
   world whose true answer is known by construction, logs traffic under one
   policy, asks about a different one, and checks the estimate against the
   truth it can compute directly.

   The other half is the failure modes, because an estimator that is right when
   the data supports it and silently wrong when it does not is worse than no
   estimator. The checks below cover barely-overlapping policies (the estimate
   must be marked not credible), missing propensities (dropped, never
   defaulted), and a deterministic logging policy (the case where the question
   genuinely has no answer and the module has to say so).

   Runs in plain node, no browser. */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'lab.js');
global.window = {};
// eslint-disable-next-line no-eval
eval(fs.readFileSync(SRC, 'utf8'));
const L = global.window.PS_LAB;
if (!L) { console.log('FAILED: lab.js did not load'); process.exit(1); }

let failures = 0;
const fail = msg => { failures++; console.log('FAIL:', msg); };
const ok = msg => console.log('  ok:', msg);
const check = (cond, msg) => { if (cond) ok(msg); else fail(msg); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------------------------------------------------------------------
   A world whose answer is known by construction.

   Seven actions, two contexts, and a fixed table of true mean rewards. Because
   the table is known, the exact value of ANY policy can be computed directly —
   which is the only way to tell whether an estimate of it is any good. */
const ARMS = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'];
const MU = {
  code: { a1: 0.20, a2: 0.35, a3: 0.90, a4: 0.45, a5: 0.30, a6: 0.25, a7: 0.40 },
  cook: { a1: 0.85, a2: 0.30, a3: 0.25, a4: 0.40, a5: 0.35, a6: 0.20, a7: 0.30 },
};
const DOMAINS = Object.keys(MU);
const BEST = { code: 'a3', cook: 'a1' };

/* The exact value of a policy, computed from the table rather than sampled. */
function trueValue(probsFor) {
  let total = 0;
  for (const d of DOMAINS) {
    const probs = probsFor(d);
    for (const a of ARMS) total += (probs[a] || 0) * MU[d][a];
  }
  return total / DOMAINS.length;
}

/* Log traffic under a behaviour policy that is deliberately WRONG: it favours
   a4 everywhere, which is mediocre in both contexts. If the estimators work,
   they recover the value of a policy the logs never followed. */
function behaviour(eps) {
  return () => {
    const share = eps / ARMS.length;
    const d = {};
    for (const a of ARMS) d[a] = share + (a === 'a4' ? 1 - eps : 0);
    return d;
  };
}

function makeLog(n, eps, seed, opts) {
  const o = opts || {};
  const r = rng(seed);
  const probsFor = behaviour(eps);
  const out = [];
  for (let i = 0; i < n; i++) {
    const domain = DOMAINS[(r() * DOMAINS.length) | 0];
    const probs = probsFor(domain);
    let roll = r(), acc = 0, arm = ARMS[ARMS.length - 1];
    for (const a of ARMS) { acc += probs[a]; if (roll <= acc) { arm = a; break; } }
    /* Bernoulli reward with the table's mean, so the log is a real sample
       rather than the expectation handed back in disguise. */
    const reward = r() < MU[domain][arm] ? 1 : 0;
    out.push({ arm, p: o.corruptP ? undefined : probs[arm], reward, domain, ask: 'ask ' + i });
  }
  return out;
}

/* ---------------------------------------------------------------------------- */
console.log('== it recovers a policy that was never run ==');

const log = makeLog(4000, 0.30, 7);

/* The target: always take the best action for the context. The logs almost
   never did this — a4 took 74% of the traffic — so every bit of evidence about
   it comes from the 30% spent exploring. */
const oracle = L.epsilonGreedy(r => BEST[r.domain], ARMS, 0);
const truth = trueValue(d => { const o = {}; for (const a of ARMS) o[a] = a === BEST[d] ? 1 : 0; return o; });
const res = L.evaluate(log, oracle, { arms: ARMS });

console.log(`     truth (computed, not sampled): ${truth.toFixed(3)}`);
console.log(`     what the logs averaged:        ${res.logged.toFixed(3)}`);
console.log(`     IPS   ${res.ips.toFixed(3)}   SNIPS ${res.snips.toFixed(3)}   DR ${res.dr.toFixed(3)}`);
console.log(`     ESS ${res.ess} of ${res.n}, max weight ${res.maxWeight}, overlap ${res.overlap}`);

check(near(res.snips, truth, 0.05), `SNIPS lands within 0.05 of the true value (${res.snips} vs ${truth.toFixed(3)})`);
check(near(res.dr, truth, 0.05), `DR lands within 0.05 of the true value (${res.dr} vs ${truth.toFixed(3)})`);
check(near(res.ips, truth, 0.08), `IPS lands within 0.08 of the true value (${res.ips} vs ${truth.toFixed(3)})`);
/* The whole point: the naive read of the same data is badly wrong. */
check(Math.abs(res.logged - truth) > 0.25,
  `and the logged average alone is off by ${Math.abs(res.logged - truth).toFixed(3)} — which is what you would have concluded without any of this`);
check(res.credible === true, 'the estimate is marked credible, because the policies genuinely overlap');

/* --------------------------------------------------------------------------- */
console.log('\n== it recovers a mediocre policy too, not just a good one ==');

/* An estimator that always says "better" is a cheerleader. Ask about a policy
   that is WORSE than the logs and it has to say so. */
const badTruth = trueValue(() => ({ a6: 1 }));
const badRes = L.evaluate(log, L.always('a6', ARMS), { arms: ARMS });
console.log(`     truth ${badTruth.toFixed(3)}   SNIPS ${badRes.snips.toFixed(3)}   DR ${badRes.dr.toFixed(3)}`);
check(near(badRes.snips, badTruth, 0.06),
  `SNIPS recovers a policy worse than the log (${badRes.snips} vs ${badTruth.toFixed(3)})`);
check(near(badRes.dr, badTruth, 0.06),
  `DR recovers it too (${badRes.dr} vs ${badTruth.toFixed(3)})`);
check(badRes.snips < badRes.logged, 'and reports it as worse than what the logs actually earned');

/* Regression guard. DR's baseline needs the target's probability for every
   action; a target that only reports the logged one used to make it collapse
   to 0.004 against a true 0.225 while SNIPS stayed correct. It now falls back
   to SNIPS rather than return that number. */
const noDist = L.evaluate(log, (r) => (r.arm === 'a6' ? 1 : 0), { arms: ARMS });
check(near(noDist.dr, badTruth, 0.06),
  `a target that cannot describe its full distribution falls back instead of collapsing (DR ${noDist.dr})`);

/* --------------------------------------------------------------------------- */
console.log('\n== uniform random, where every weight is small and equal ==');

const unif = L.uniform(ARMS);
const unifTruth = trueValue(() => { const o = {}; for (const a of ARMS) o[a] = 1 / ARMS.length; return o; });
const unifRes = L.evaluate(log, unif, { arms: ARMS });
check(near(unifRes.snips, unifTruth, 0.04),
  `SNIPS recovers uniform-random (${unifRes.snips} vs ${unifTruth.toFixed(3)})`);

/* --------------------------------------------------------------------------- */
console.log('\n== SNIPS cannot invent a reward nobody observed ==');

/* Plain IPS can and does return values outside the observed reward range when
   a rare action gets a big weight. Self-normalizing makes that impossible,
   which is why it is the one shown to people. */
const thin = makeLog(300, 0.06, 11);     // very little exploration
const thinRes = L.evaluate(thin, oracle, { arms: ARMS });
check(thinRes.snips >= 0 && thinRes.snips <= 1,
  `SNIPS stays inside the observed reward range on a thin log (${thinRes.snips})`);

/* --------------------------------------------------------------------------- */
console.log('\n== it refuses when the policies barely overlap ==');

/* Logged with almost no exploration, then asked about a policy that disagrees
   with the logger nearly everywhere. The answer exists but the evidence does
   not, and the module has to say which. */
const narrow = makeLog(400, 0.01, 23);
const narrowRes = L.evaluate(narrow, L.always('a3', ARMS), { arms: ARMS });
console.log(`     n=${narrowRes.n} but ESS=${narrowRes.ess}`);
check(narrowRes.ess < narrowRes.n / 4,
  `effective sample size collapses well below the raw count (${narrowRes.ess} of ${narrowRes.n})`);
check(narrowRes.credible === false, 'and the result is marked not credible');
check(typeof narrowRes.reason === 'string' && narrowRes.reason.includes('overlap'),
  'with a reason that names the actual problem rather than a code');

/* --------------------------------------------------------------------------- */
console.log('\n== a deterministic logging policy has no counterfactual at all ==');

/* The point the whole module rests on. With no exploration there is no
   evidence about anything else, and the honest output is a refusal — not a
   confident number computed from zero observations. */
const deterministic = makeLog(500, 0, 31);
const detRes = L.evaluate(deterministic, L.always('a3', ARMS), { arms: ARMS });
console.log(`     overlap ${detRes.overlap}, ESS ${detRes.ess}`);
check(detRes.overlap === 0,
  'nothing in the log overlaps the policy being asked about — every weight is zero');
check(detRes.credible === false,
  'so it is marked not credible rather than returning a confident zero');

/* The same question, with the 8% of randomization router.js actually spends.

   How much traffic that needs is worth printing rather than asserting, because
   the honest answer is "more than you would guess". The target here disagrees
   with the logger almost everywhere, so every bit of evidence about it comes
   from the 1.1% of decisions that explored onto a3 specifically. */
const a3truth = trueValue(() => ({ a3: 1 }));
console.log(`     target: always a3. truth ${a3truth.toFixed(3)}. logger explores 8% across 7 actions.`);
let becameCredible = null;
for (const n of [500, 1000, 2500, 5000, 15000]) {
  const r = L.evaluate(makeLog(n, 0.08, 31), L.always('a3', ARMS), { arms: ARMS });
  console.log(`       ${String(n).padStart(6)} logged  ESS ${String(r.ess).padStart(6)}  `
    + `credible ${String(r.credible).padEnd(5)}  SNIPS ${r.snips.toFixed(3)}`);
  if (r.credible && becameCredible === null) becameCredible = { n, r };
}
check(becameCredible !== null && becameCredible.n <= 5000,
  `8% exploration makes the question answerable by ~${becameCredible ? becameCredible.n : '?'} logged decisions`);
check(becameCredible && near(becameCredible.r.snips, a3truth, 0.08),
  `and the estimate is right once it is credible (${becameCredible ? becameCredible.r.snips : '?'} vs ${a3truth.toFixed(3)})`);

/* The property that matters more than accuracy: when it is wrong, it says so.
   At 500 records this estimator returns 1.000 against a truth of 0.575 — badly
   wrong — and marks itself not credible. Wrong-and-flagged is recoverable;
   wrong-and-confident is what gets shipped. */
const tiny = L.evaluate(makeLog(500, 0.08, 31), L.always('a3', ARMS), { arms: ARMS });
check(Math.abs(tiny.snips - a3truth) > 0.2 && tiny.credible === false,
  'and where it is badly wrong for lack of evidence, it is marked not credible rather than believed');

/* --------------------------------------------------------------------------- */
console.log('\n== a pooled diagnostic hides deficient support in one context ==');

/* The case that got through. A counterfactual demo asked what "always a3"
   would score from a log where the behaviour policy took a3 constantly in one
   context and essentially never in the other. Pooled ESS came back 96 — well
   past the credibility floor — and the estimate was 0.917 against a truth of
   0.555, because virtually every observation of a3 came from the context where
   a3 happens to be excellent.
   
   The mass was real. It was just all in one place, which a pooled number
   cannot see. */
function lopsidedLog(n, seed) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const domain = DOMAINS[(r() * DOMAINS.length) | 0];
    /* In 'code' the logger loves a3; in 'cook' it almost never tries it. */
    const probs = {};
    const favourite = domain === 'code' ? 'a3' : 'a1';
    const share = 0.06 / ARMS.length;
    for (const a of ARMS) probs[a] = share + (a === favourite ? 0.94 : 0);
    let roll = r(), acc = 0, arm = ARMS[ARMS.length - 1];
    for (const a of ARMS) { acc += probs[a]; if (roll <= acc) { arm = a; break; } }
    out.push({ arm, p: probs[arm], reward: r() < MU[domain][arm] ? 1 : 0, domain });
  }
  return out;
}

const lop = lopsidedLog(600, 77);
const lopTruth = trueValue(() => ({ a3: 1 }));
const lopRes = L.evaluate(lop, L.always('a3', ARMS), { arms: ARMS });
console.log(`     truth ${lopTruth.toFixed(3)}   SNIPS ${lopRes.snips.toFixed(3)}   pooled ESS ${lopRes.ess}`);
console.log(`     per context: ${lopRes.contexts.map(c => `${c.key} ESS ${c.ess} overlap ${c.overlap}`).join('  |  ')}`);

check(lopRes.ess >= L.MIN_ESS,
  `the POOLED effective sample size clears the floor (${lopRes.ess}) — which is exactly why it fooled the first version`);
check(Math.abs(lopRes.snips - lopTruth) > 0.15,
  `yet the estimate is badly wrong (${lopRes.snips} vs ${lopTruth.toFixed(3)})`);
check(lopRes.credible === false,
  'and the per-context gate catches it where the pooled one could not');
check(typeof lopRes.reason === 'string' && lopRes.reason.includes('context'),
  'naming the context that has almost no evidence, rather than reporting a healthy-looking pool');
check(lopRes.weakestContext && lopRes.weakestContext.ess < lopRes.ess,
  `the weakest context is reported alongside the pooled figure (${lopRes.weakestContext.ess} vs ${lopRes.ess})`);

/* And it must not fire on a log that genuinely covers every context, or it
   would make the whole module useless by refusing everything. */
check(res.credible === true && res.contexts.length === DOMAINS.length,
  'a well-covered log is still credible, with every context reported');
check(res.contexts.every(c => c.ess >= L.MIN_CONTEXT_ESS),
  'because every one of its contexts carries real evidence');

/* --------------------------------------------------------------------------- */
console.log('\n== bad records are dropped, never defaulted ==');

const dirty = [
  { arm: 'a1', p: 0.5, reward: 1 },
  { arm: 'a1', reward: 1 },                    // no propensity
  { arm: 'a1', p: 0, reward: 1 },              // impossible propensity
  { arm: 'a1', p: 1.4, reward: 1 },            // out of range
  { arm: 'a1', p: 0.5, reward: 'yes' },        // not a number
  { p: 0.5, reward: 1 },                       // no action
  null, 'nonsense', 42,
];
const dirtyRes = L.evaluate(dirty, L.always('a1', ARMS), { arms: ARMS });
check(dirtyRes.n === 1,
  `only the one usable record survives (${dirtyRes.n} of ${dirty.length}) — a defaulted propensity produces a confident wrong answer`);
check(L.evaluate([], L.always('a1', ARMS)).credible === false, 'an empty log is not credible');
check(L.evaluate(null, L.always('a1', ARMS)).n === 0, 'a non-array log does not throw');

/* A target that throws must not take the estimate down with it. */
let threw = null;
try {
  const r = L.evaluate(log, () => { throw new Error('boom'); }, { arms: ARMS });
  check(r.n > 0 && r.overlap === 0, 'a target policy that throws is treated as giving zero probability');
} catch (e) { threw = e; }
check(!threw, 'and does not propagate out of evaluate()');

/* --------------------------------------------------------------------------- */
console.log('\n== weight clipping is applied and reported ==');

const clipRes = L.evaluate(makeLog(600, 0.04, 41), oracle, { arms: ARMS });
check(clipRes.maxWeight <= L.MAX_WEIGHT + 1e-6,
  `no weight exceeds the clip (${clipRes.maxWeight} <= ${L.MAX_WEIGHT})`);
check(typeof clipRes.clipped === 'number',
  `and the count of clipped records is reported (${clipRes.clipped}), because silently dropping the tail of a weight distribution changes the answer`);

/* --------------------------------------------------------------------------- */
console.log('\n== DR survives a reward model that is wrong ==');

/* Doubly robust earns its name only if a bad model does not wreck it — the
   propensities are supposed to carry it. A model that claims everything scores
   0.5 is wrong about every action here. */
const wrongModel = () => 0.5;
const drWrong = L.doublyRobust(
  (() => {
    const rows = [];
    for (const r of log) {
      const q = oracle(r)[r.arm] || 0;
      rows.push({ ...r, q, w: Math.min(q / r.p, L.MAX_WEIGHT), targetProbs: oracle(r) });
    }
    return rows;
  })(), wrongModel, ARMS);
console.log(`     DR with a deliberately wrong model: ${drWrong.toFixed(3)} vs truth ${truth.toFixed(3)}`);
check(near(drWrong, truth, 0.08),
  'DR stays close to the truth even when the reward model is wrong about everything');

/* --------------------------------------------------------------------------- */
console.log('\n== more logged traffic tightens the estimate ==');

const small = L.evaluate(makeLog(250, 0.3, 5), oracle, { arms: ARMS });
const large = L.evaluate(makeLog(4000, 0.3, 5), oracle, { arms: ARMS });
check(large.se < small.se,
  `the standard error shrinks with more data (${large.se} < ${small.se})`);
check(large.ess > small.ess, `and the effective sample size grows (${large.ess} > ${small.ess})`);

/* --------------------------------------------------------------------------- */
console.log('\n== purity ==');

/* Strip comments before grepping. The first version of this check failed on
   the word "localStorage" inside a comment explaining that this file does not
   use localStorage — a false positive that would have pushed the next person
   to weaken the prose rather than keep the property. Comments are not code;
   the check should look at code. */
const src = fs.readFileSync(SRC, 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
const FORBIDDEN = ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'document.cookie',
                   'localStorage', 'sessionStorage', 'document.', 'WebSocket'];
const found = FORBIDDEN.filter(f => code.includes(f));
check(found.length === 0,
  `no storage, DOM or network in lab.js${found.length ? ' — found ' + found.join(', ') : ''}`);

console.log('─'.repeat(58));
if (failures) { console.log(`\nFAILED: ${failures} check(s)`); process.exit(1); }
console.log('\nPASSED: all checks');
process.exit(0);
