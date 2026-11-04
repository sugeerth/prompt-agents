/* Eval for the learning router.

   This layer is allowed to move a control the user can see, which is more
   authority than any other personalization in the app has. Three things are
   gated here, and the middle one is the reason the file exists at all.

   Restraint: does it keep quiet before it knows anything, and does it refuse
   to name a winner while the intervals overlap? A router that starts moving
   sliders on its first observation is worse than no router, because the user
   cannot tell a considered default from a random one.

   Benefit: does it actually beat what it replaced? profile.js remembers the
   last composition endorsed in a domain. That is a real baseline and it is
   implemented here, so the claim "the bandit is better" is a measurement in
   this file rather than a sentence in a comment. If the gap ever closes, this
   layer should be deleted and the test says so.

   Privacy: the last block reads router.js off disk as text and fails on any
   network call or on a second storage key, exactly as profile-eval.js does.

   Runs in plain node, no browser, in well under a second. */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'router.js');

global.window = {};
// eslint-disable-next-line no-eval
eval(fs.readFileSync(SRC, 'utf8'));
const R = global.window.PS_ROUTER;
if (!R) { console.log('FAILED: router.js did not load'); process.exit(1); }

const KEY = 'ps.router.v1';

let failures = 0;
const fail = msg => { failures++; console.log('FAIL:', msg); };
const ok = msg => console.log('  ok:', msg);
const check = (cond, msg) => { if (cond) ok(msg); else fail(msg); };

function fakeStore() {
  const m = new Map();
  return {
    keys: () => [...m.keys()],
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
  };
}

/* Deterministic PRNG. A learning test that passes on some seeds and not others
   is not a test, it is a coin flip with extra steps. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const reset = () => { R._useStorage(fakeStore()); R.setEnabled(true); R.forget(); };

/* ---------------------------------------------------------------- */
console.log('== the arms ==');

reset();
check(R.ARMS.length === 7, `seven arms, not nine (${R.ARMS.length})`);
check(R.ARMS.filter(a => a.startsWith('native')).length === 1,
  'Native collapses to one arm — depth is not live there, so three would be one arm wearing three hats');
check(R.armOf('native', 2) === 'native:1', 'a Native request normalizes to the single Native arm');
check(R.armOf('shaped', 2) === 'shaped:2' && R.armOf('bogus', 9) === 'guided:1',
  'unknown compositions fall back to the app default rather than inventing an arm');

/* ---------------------------------------------------------------- */
console.log('\n== restraint ==');

reset();
check(R.offer('fix my failing build', 'code') === null,
  'says nothing at all before it has seen anything');

for (let i = 0; i < 4; i++) {
  R.record({ ask: 'fix my failing build', domain: 'code', arm: 'shaped:2', outcome: 'took' });
}
check(R.offer('fix my failing build', 'code') === null,
  'still says nothing after four observations — below MIN_EVIDENCE it defers to the app default');

for (let i = 0; i < 6; i++) {
  R.record({ ask: 'fix my failing build', domain: 'code', arm: 'shaped:2', outcome: 'took' });
}
const warm = R.offer('fix my failing build', 'code');
check(warm && warm.arm === 'shaped:2',
  'once past MIN_EVIDENCE it offers the composition the user kept taking');
check(R.explain('code').ready === true, 'explain() reports when it has enough to speak');

/* Every labelled ask scores every arm, so after ten consistent observations
   there is real evidence about all seven and naming a favourite is correct.
   The untried-arm guard is exercised below, on the abandon path, which is the
   only one that reveals no label. */
const lead0 = R.leader('code');
check(lead0 && lead0.arm === 'shaped:2',
  'names the winner once every arm has evidence and the intervals separate');

reset();
for (let i = 0; i < 20; i++) {
  R.record({ ask: 'an abandoned ask', domain: 'misc', arm: 'guided:1', outcome: 'abandoned' });
}
check(R.leader('misc') === null,
  'but never while arms remain untried — an abandon reveals no label, so only the arm on screen learns anything');

/* ---------------------------------------------------------------- */
console.log('\n== it explores ==');

reset();
/* A single lucky copy must not lock the axes forever — that is precisely the
   failure mode of the thing this replaces. */
for (let i = 0; i < 10; i++) {
  R.record({ ask: 'plan a trip to japan', domain: 'travel', arm: 'guided:1', outcome: 'took' });
}
const seen = new Set();
for (let i = 0; i < 60; i++) {
  const o = R.offer('plan a trip to japan', 'travel');
  if (o) seen.add(o.arm);
  /* Feed a neutral abandon so evidence accumulates without teaching a
     preference; the question is whether the arm set ever widens. */
  R.record({ ask: 'plan a trip to japan', domain: 'travel', arm: o ? o.arm : 'guided:1', outcome: 'abandoned' });
}
check(seen.size > 1, `offers more than one composition as the favourite decays (${seen.size} distinct)`);

/* ---------------------------------------------------------------- */
console.log('\n== the counterfactual ==');

reset();
for (let i = 0; i < 12; i++) {
  /* The user was shown guided:1, dragged to shaped:2, and took that. The arm
     they moved to is the only direct comparison the app ever gets. */
  R.record({ ask: 'write the launch email', domain: 'write',
             arm: 'guided:1', taken: 'shaped:2', outcome: 'changed' });
}
const after = R.stats('write');
const moved = after.find(r => r.arm === 'shaped:2');
const offered = after.find(r => r.arm === 'guided:1');
check(moved.mean > offered.mean,
  `the arm they moved TO outscores the one they were shown (${moved.mean} vs ${offered.mean})`);
check(offered.mean < 0.5,
  'being dragged away from counts against an arm, but is not scored as harshly as a walk-away');
const pick = R.offer('write the launch email', 'write');
check(pick && pick.arm === 'shaped:2', 'and it then offers what they kept dragging to');

/* ---------------------------------------------------------------- */
console.log('\n== does it beat what it replaces? ==');

/* The baseline is profile.js's actual behaviour: remember the last composition
   endorsed in this domain, and open on it next time.

   The user is stochastic, because real ones are. In `code` they want shaped:2
   seven times out of ten and guided:2 the rest; in `cook` they want guided:0
   three quarters of the time. Nothing about the world changes — this is not a
   drift test, it is the plain case, and last-write-wins still loses it, because
   following the last sample means following the noise. The ceiling for any
   policy is the mode: 0.70 in code, 0.75 in cook. */
const WORLD = {
  code: [['shaped:2', 0.70], ['guided:2', 1.00]],
  cook: [['guided:0', 0.75], ['guided:1', 1.00]],
};
const ASKS = {
  code: ['fix my failing build', 'debug this stack trace', 'why does this test hang',
         'refactor the parser module', 'speed up this query'],
  cook: ['sourdough starter hydration', 'what to do with leftover rice',
         'how long to rest a steak', 'substitute for buttermilk', 'sharpen a kitchen knife'],
};
function want(domain, r) {
  const roll = r();
  for (const [arm, upto] of WORLD[domain]) if (roll <= upto) return arm;
  return WORLD[domain][0][0];
}

function runTrial(seed, policy) {
  const r = rng(seed);
  const last = {};                       // the last-write-wins baseline's entire model
  reset();
  let matched = 0, n = 0;
  for (let i = 0; i < 600; i++) {
    const domain = r() < 0.5 ? 'code' : 'cook';
    const ask = ASKS[domain][(r() * ASKS[domain].length) | 0];
    const truth = want(domain, r);

    let offered;
    if (policy === 'router') {
      const o = R.offer(ask, domain);
      offered = o ? o.arm : 'guided:1';
    } else {
      offered = last[domain] || 'guided:1';
    }

    /* Scored only once both policies have had the same chance to learn, so the
       router is not credited for the warm-up it spends deliberately silent. */
    if (i >= 100) { n++; if (offered === truth) matched++; }

    if (offered === truth) {
      R.record({ ask, domain, arm: offered, outcome: 'took', offered: true });
      last[domain] = truth;
    } else {
      R.record({ ask, domain, arm: offered, taken: truth, outcome: 'changed', offered: true });
      last[domain] = truth;              // the baseline remembers whatever was last taken
    }
  }
  return matched / n;
}

let routerSum = 0, lastSum = 0, wins = 0;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const gaps = [];
for (const s of SEEDS) {
  const a = runTrial(s, 'router');
  const b = runTrial(s, 'last');
  routerSum += a; lastSum += b;
  gaps.push(+(a - b).toFixed(3));
  if (a > b) wins++;
}
const routerRate = routerSum / SEEDS.length;
const lastRate = lastSum / SEEDS.length;
const ceiling = 0.5 * 0.70 + 0.5 * 0.75;        // the mode of each domain, the best any policy can do

console.log(`     last-write-wins (what profile.js does): ${(lastRate * 100).toFixed(1)}%`);
console.log(`     learning router:                        ${(routerRate * 100).toFixed(1)}%`);
console.log(`     ceiling (always offer the mode):        ${(ceiling * 100).toFixed(1)}%`);
console.log(`     per-seed gap:                           ${gaps.map(g => (g * 100).toFixed(1)).join(', ')}`);

/* Asserted per-seed rather than on the mean. A mean can be carried by one
   lucky seed, and "it is better on average" is a weaker claim than the one
   this layer needs to justify its existence. */
check(wins === SEEDS.length,
  `the router opens on the right composition more often than last-write-wins, on every one of ${SEEDS.length} seeds (${wins}/${SEEDS.length})`);
check(routerRate > lastRate + 0.03,
  `and by a margin worth the code (+${((routerRate - lastRate) * 100).toFixed(1)} points)`);
check(routerRate <= ceiling + 0.02,
  'without exceeding the mode, which would mean the harness is measuring something other than it thinks');

/* ---------------------------------------------------------------- */
console.log('\n== it generalizes across the ask, not just the label ==');

reset();
/* Train only on these four phrasings, all in one domain. */
for (let i = 0; i < 20; i++) {
  for (const ask of ['fix my failing build', 'debug this stack trace',
                     'why does this test hang', 'repair the broken import']) {
    R.record({ ask, domain: 'code', arm: 'shaped:2', outcome: 'took' });
  }
}
/* Now ask something never seen, under a domain the router has NO tally for.
   Only the contextual layer can carry this — the domain term is empty. */
const transfer = R.offer('debug the failing import in this build', 'debug');
check(transfer && transfer.arm === 'shaped:2',
  'a never-seen phrasing in an unseen domain inherits through the shared words');

/* ---------------------------------------------------------------- */
console.log('\n== a changed template does not inherit the old one\'s results ==');

reset();
R.setTemplateVersion('money', 'fp-a');
for (let i = 0; i < 15; i++) {
  R.record({ ask: 'how much to save for a house', domain: 'money', arm: 'shaped:0', outcome: 'took' });
}
const before = R.stats('money').find(x => x.arm === 'shaped:0').n;
const didReset = R.setTemplateVersion('money', 'fp-b');
const afterFp = R.stats('money').find(x => x.arm === 'shaped:0').n;
check(didReset === true, 'a new template fingerprint reports that it cleared the domain');
check(afterFp < before, `the domain tally drops when the template changes (${before} -> ${afterFp})`);
check(R.setTemplateVersion('money', 'fp-b') === false, 'and re-stating the same fingerprint is a no-op');
/* The person did not change — only one template did — so what was learned about
   the person has to survive. */
check(R.explain('money').observations > 10,
  'the global and contextual layers survive a template change: they are about the person');

/* ---------------------------------------------------------------- */
console.log('\n== it tracks a preference that changes ==');

reset();
for (let i = 0; i < 40; i++) {
  R.record({ ask: 'summarize this contract', domain: 'legal', arm: 'guided:0', outcome: 'took' });
}
check(R.offer('summarize this contract', 'legal').arm === 'guided:0', 'settles on the early preference');
for (let i = 0; i < 60; i++) {
  R.record({ ask: 'summarize this contract', domain: 'legal',
             arm: 'guided:0', taken: 'shaped:2', outcome: 'changed' });
}
check(R.offer('summarize this contract', 'legal').arm === 'shaped:2',
  'and moves to the new one when the user changes their mind — decay is what makes this possible');

/* ---------------------------------------------------------------- */
console.log('\n== leader() calls a winner only when there is one ==');

reset();
const coin = rng(99);
for (let i = 0; i < 160; i++) {
  /* Every arm tried, all of them equally good. There is no winner here and
     claiming one would be reporting noise. */
  const arm = R.ARMS[(coin() * R.ARMS.length) | 0];
  R.record({ ask: 'a neutral ask', domain: 'misc', arm, outcome: coin() < 0.5 ? 'took' : 'abandoned' });
}
check(R.leader('misc') === null, 'no winner when every arm performs the same');

reset();
for (let i = 0; i < 40; i++) {
  for (const arm of R.ARMS) {
    R.record({ ask: 'a decisive ask', domain: 'clear', arm,
               outcome: arm === 'shaped:1' ? 'took' : 'abandoned' });
  }
}
const lead = R.leader('clear');
check(lead && lead.arm === 'shaped:1', 'a genuine winner is named once its interval clears the runner-up');

/* ---------------------------------------------------------------- */
console.log('\n== storage ==');

const st = fakeStore();
R._useStorage(st);
R.setEnabled(true);
R.forget();
/* Varied asks across several domains, because that is what the stored size
   actually depends on. An earlier version of this check repeated ONE ask and
   reported 1.1 KB, which was true and unrepresentative: one ask touches a
   handful of hash buckets, so almost every slot in every arm's arrays stayed
   at its prior and serialized short. Real use fills them. Measuring the easy
   case and quoting it as the model's size is how a number ends up on a README
   being wrong by a factor of seven. */
const VARIED = ['fix my failing build', 'sourdough starter hydration',
                'how much to save for a house', 'summarize this contract',
                'plan a trip to japan with kids', 'write the launch email'];
for (let i = 0; i < 240; i++) {
  R.record({ ask: VARIED[i % VARIED.length] + ' ' + i, domain: 'dom' + (i % 6),
             arm: R.ARMS[i % R.ARMS.length], outcome: 'took' });
}
check(st.keys().length === 1 && st.keys()[0] === KEY, `exactly one key written (${st.keys().join(', ')})`);
const size = (st.getItem(KEY) || '').length;
console.log(`     stored size, 6 domains x 240 varied asks: ${size} bytes (${(size / 1024).toFixed(1)} KB)`);
check(size < 12000, `the whole model stays bounded (${size} bytes) — a nicety must not get the origin evicted`);
/* The cap is what matters, but a sudden collapse would mean the model stopped
   recording something, so the floor is asserted too. */
check(size > 1500, `and is actually holding a model rather than silently emptying (${size} bytes)`);

/* It has to survive a page load, or none of the learning above matters. */
R._useStorage(st);
check(R.explain('money').observations > 10, 'the model reloads from storage on the next page load');

/* Twenty domains touched, twelve kept. */
R.forget();
for (let d = 0; d < 20; d++) {
  for (let i = 0; i < 3; i++) R.record({ ask: `ask number ${d}`, domain: `d${d}`, arm: 'guided:1', outcome: 'took' });
}
check(R.explain().domains <= 12, `domain tallies are capped (${R.explain().domains} kept of 20 touched)`);

/* Corrupt data is discarded, not repaired. */
const bad = fakeStore();
bad.setItem(KEY, '{"v":1,"on":true,"arms":{"guided:1":{"w":"not a number","a":[1,2],"b":null}}}');
let threw = null;
try { R._useStorage(bad); } catch (e) { threw = e; }
check(!threw, 'malformed stored state does not throw on load');
check(R.explain().observations === 0, 'and is discarded rather than half-read into the model');

const foreign = fakeStore();
foreign.setItem(KEY, 'not json at all');
R._useStorage(foreign);
check(foreign.getItem(KEY) === null, 'unparseable state is dropped from storage, not left to fail again');

/* Erasure has to be real. */
R._useStorage(fakeStore());
R.setEnabled(true);
for (let i = 0; i < 20; i++) R.record({ ask: 'something private', domain: 'health', arm: 'guided:1', outcome: 'took' });
R.setEnabled(false);
check(R.explain().observations === 0 && R.offer('something private', 'health') === null,
  'switching it off wipes the model as well as stopping it');
R.setEnabled(true);
check(R.explain().observations === 0, 'and switching it back on starts from nothing, not from what was hidden');

/* No storage at all: private browsing, and node. */
let e2 = null;
try {
  R._useStorage(null);
  R.setEnabled(true);
  for (let i = 0; i < 12; i++) R.record({ ask: 'memory only', domain: 'code', arm: 'shaped:2', outcome: 'took' });
} catch (e) { e2 = e; }
check(!e2 && R.offer('memory only', 'code') !== null,
  'works entirely in memory when storage is unavailable');

/* ---------------------------------------------------------------- */
console.log('\n== privacy ==');

const src = fs.readFileSync(SRC, 'utf8');
const FORBIDDEN = ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'document.cookie', 'googletagmanager',
                   'WebSocket', 'EventSource', 'importScripts'];
const found = FORBIDDEN.filter(f => src.includes(f));
check(found.length === 0, `no network or tracking calls in router.js${found.length ? ' — found ' + found.join(', ') : ''}`);
const keysUsed = [...new Set(src.match(/ps\.router\.[a-z0-9]+/g) || [])];
check(keysUsed.length === 1 && keysUsed[0] === KEY, `exactly one storage key named in the source (${keysUsed.join(', ')})`);

console.log('─'.repeat(58));
if (failures) { console.log(`\nFAILED: ${failures} check(s)`); process.exit(1); }
console.log('\nPASSED: all checks');
process.exit(0);
