/* Eval for the local user vector.

   This layer is the only one that persists anything about the person using the
   app, which makes it the only one where a bug is measured in trust rather than
   in tokens. Three separate things get gated here.

   Behaviour: does the vector actually learn a theme, and does the theme fade?
   A profile that never sharpens is decoration; a profile that never forgets is
   a growing pile of whatever the user cared about in their first week.

   Restraint: personalization re-ranks, it does not decide. The boost ceiling
   and the near-total dismissal of raw typing are the two properties that keep
   the search box finding what was literally typed, so both are asserted rather
   than assumed.

   Privacy: the last check reads profile.js off disk as text and fails on any
   network or tracking call. The footer promises nothing leaves the browser, and
   a promise that only lives in a comment is one edit away from being false.

   Runs in plain node, no browser, in milliseconds. */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'profile.js');

global.window = {};
// eslint-disable-next-line no-eval
eval(fs.readFileSync(SRC, 'utf8'));
const P = global.window.PS_PROFILE;
if (!P) { console.log('FAILED: profile.js did not load'); process.exit(1); }

const KEY = 'ps.profile.v1';

let failures = 0;
const fail = msg => { failures++; console.log('FAIL:', msg); };
const ok = msg => console.log('  ok:', msg);
const check = (cond, msg) => { if (cond) ok(msg); else fail(msg); };

/* A stand-in for localStorage that also lets the test look at what was really
   written — the point of several of these assertions is the bytes on disk, not
   just the in-memory answer. */
function fakeStore() {
  const m = new Map();
  return {
    keys: () => [...m.keys()],
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
  };
}

const reset = () => { const s = fakeStore(); P._useStorage(s); return s; };
const copyN = (n, text, extra) => {
  for (let i = 0; i < n; i++) P.observe(Object.assign({ type: 'copy', text }, extra || {}));
};

console.log('Local user vector eval');
console.log('─'.repeat(58));

/* 1. A profile that has met nobody must claim nothing. Any nonzero opinion here
      would be personalization invented out of an empty vector. */
console.log('== cold start ==');
reset();
check(P.affinity('sourdough starter hydration') === 0, 'fresh profile has zero affinity');
check(P.affinity('') === 0, 'empty text has zero affinity');
check(P.prefs('cook') === null, 'fresh prefs() returns null');
check(P.top(10).length === 0, 'fresh vector is empty');
check(P.recent(10).length === 0, 'fresh recent() is empty');
check(P.boost({ t: 'anything at all', d: 'cook' }) === 0, 'fresh boost is zero');

/* 2. The whole reason this layer exists: after a run of cooking asks, a new
      cooking ask must read as more familiar than an unrelated one. Asserted as
      an ordering, because the absolute number is a tuning detail and pinning it
      to a constant would make every future retune look like a regression. */
console.log('== learns a theme ==');
reset();
[
  'sourdough starter feeding schedule',
  'sourdough bread crumb too dense',
  'how long to proof sourdough dough',
  'best flour for sourdough baking',
  'sourdough hydration ratio explained',
  'why did my bread loaf collapse',
].forEach(t => P.observe({ type: 'copy', text: t, domain: 'cook' }));

const cookAsk = P.affinity('keep my sourdough starter alive while travelling');
const taxAsk = P.affinity('deduct a home office on my tax return');
check(cookAsk > taxAsk, `cooking ask (${cookAsk}) outranks tax ask (${taxAsk})`);
check(taxAsk === 0, 'a wholly unseen ask still scores exactly zero');
check(cookAsk > 0, 'a themed ask scores above zero');
check(P.top(3).some(x => x.token === 'sourdough'), 'top() surfaces the dominant token');
check(P.recent(3)[0] === 'why did my bread loaf collapse', 'recent() is newest first');
check(P.recent(10).length === 6, 'recent() holds every strong interaction');

/* One interaction is an anecdote. If a single copy could pin affinity near 1
   the app would start personalizing confidently for a user it has met once. */
reset();
P.observe({ type: 'copy', text: 'sourdough starter feeding schedule', domain: 'cook' });
const onceAff = P.affinity('sourdough starter feeding schedule');
check(onceAff > 0 && onceAff < 0.3, `one observation caps affinity low (${onceAff})`);

/* 3. The ceiling is the contract with the similarity engine. Tested against a
      deliberately absurd vector, because that is precisely the state in which a
      missing clamp would do the most damage to ranking. */
console.log('== boost stays small ==');
reset();
copyN(200, 'kubernetes ingress routing', { domain: 'code' });
const lopsided = [
  P.boost({ t: 'kubernetes ingress routing', d: 'code' }),
  P.boost({ t: 'kubernetes', d: 'code' }),
  P.boost({ t: 'kubernetes ingress routing kubernetes ingress routing', d: 'code' }),
  P.boost({ t: 'tax return deductions', d: 'money' }),
  P.boost({ t: '', d: 'code' }),
  P.boost({}),
  P.boost(null),
];
check(lopsided.every(b => b <= 0.12), `boost never exceeds 0.12 (max ${Math.max(...lopsided)})`);
check(lopsided.every(b => b >= 0), 'boost is never negative');
check(lopsided[0] > lopsided[3], 'boost still prefers the familiar doc over a foreign one');

/* 4. Typing is not intent. At keystroke rates a raw type event carries the same
      structural signal as a deliberate copy, so if it were weighted anywhere
      near as heavily, idle exploration would drown out everything the user
      actually took. */
console.log('== typing does not count as intent ==');
const THEME = 'kubernetes ingress routing';
reset();
for (let i = 0; i < 20; i++) P.observe({ type: 'type', text: THEME, domain: 'code' });
const typedAff = P.affinity(THEME);
const typedRecent = P.recent(10).length;
reset();
copyN(20, THEME, { domain: 'code' });
const copiedAff = P.affinity(THEME);
check(typedAff < copiedAff * 0.25,
  `20 type events (${typedAff}) score far below 20 copies (${copiedAff})`);
check(typedRecent === 0, 'type events never reach recent()');
check(P.summary().asks === 20 && typedAff > 0, 'copies count as asks, typing leaves only a trace');

/* 5. Decay, tested at equal frequency so the ordering can only come from
      recency. Both themes are observed the same number of times; the older one
      must rank lower purely because the newer observations aged it. */
console.log('== old interests fade ==');
reset();
copyN(40, 'sourdough starter hydration', { domain: 'cook' });
copyN(40, 'kubernetes ingress routing', { domain: 'code' });
const ranked = P.top(10).map(x => x.token);
const oldRank = ranked.indexOf('sourdough');
const newRank = ranked.indexOf('kubernetes');
check(newRank >= 0 && oldRank >= 0 && newRank < oldRank,
  `newer theme outranks equally frequent older theme (kubernetes #${newRank + 1}, sourdough #${oldRank + 1})`);
const wOf = t => (P.top(240).find(x => x.token === t) || { w: 0 }).w;
check(wOf('kubernetes') > wOf('sourdough'),
  `decayed weight is lower for the older theme (${wOf('sourdough')} < ${wOf('kubernetes')})`);
check(P.affinity('kubernetes ingress routing') > P.affinity('sourdough starter hydration'),
  'affinity follows the same recency ordering');

/* 6. Unbounded growth would turn a nicety into the reason a browser starts
      evicting the origin's data. */
console.log('== storage stays bounded ==');
const pruneStore = reset();
for (let i = 0; i < 400; i++) {
  P.observe({ type: 'copy', text: `alpha${i} beta${i} gamma${i}`, domain: 'code' });
}
check(P.summary().tokens === 240, `vector capped at 240 tokens after 1200 distinct ones (${P.summary().tokens})`);
check(P.top(1000).length === 240, 'top() cannot report more than the cap');
check(P.recent(1000).length <= 30, `recent() capped at 30 (${P.recent(1000).length})`);
check(pruneStore.keys().length === 1 && pruneStore.keys()[0] === KEY,
  'exactly one storage key is ever written');

/* 7. Controls are remembered from the moment they were endorsed, which is when
      the prompt left the app — not while the user was still browsing. */
console.log('== remembered controls ==');
reset();
P.observe({ type: 'copy', text: 'roast chicken', domain: 'cook', steer: 'shaped', depth: 2 });
P.observe({ type: 'accept', text: 'roast duck', domain: 'cook', steer: 'guided', depth: 1 });
P.observe({ type: 'type', text: 'roast goose', domain: 'cook', steer: 'guided', depth: 0 });
let pr = P.prefs('cook');
check(!!pr && pr.steer === 'shaped' && pr.depth === 2,
  'prefs() keeps the copy-endorsed settings, ignoring accept and type');
P.observe({ type: 'launch', text: 'braised short rib', domain: 'cook', steer: 'native', depth: 0 });
pr = P.prefs('cook');
check(!!pr && pr.steer === 'native' && pr.depth === 0, 'a later launch replaces the remembered settings');
check(P.prefs('money') === null, 'prefs() for an unseen domain is null');
check(P.prefs('') === null && P.prefs(undefined) === null, 'prefs() tolerates a missing domain');

/* 8. Erasure has to be real, not a flag that hides the data. */
console.log('== forget ==');
const forgetStore = reset();
copyN(10, 'sourdough starter hydration', { domain: 'cook' });
check(forgetStore.getItem(KEY) !== null, 'observations were persisted before the wipe');
P.forget();
check(P.top(10).length === 0, 'forget() empties the vector');
check(P.recent(10).length === 0, 'forget() clears recent()');
check(P.affinity('sourdough starter hydration') === 0, 'forget() drops affinity to zero');
check(P.prefs('cook') === null, 'forget() drops remembered prefs');
check(P.summary().tokens === 0 && P.summary().asks === 0, 'forget() resets the summary');
check(forgetStore.getItem(KEY) === null, 'forget() removes the storage key');

/* 9. Opting out must stop the learning, not merely stop the display of it. */
console.log('== opt out ==');
const offStore = reset();
copyN(5, 'sourdough starter hydration', { domain: 'cook' });
P.setEnabled(false);
check(P.enabled() === false, 'setEnabled(false) reports disabled');
check(P.affinity('sourdough starter hydration') === 0, 'affinity is zero while disabled');
copyN(10, 'sourdough starter hydration', { domain: 'cook' });
check(P.summary().tokens === 0 && P.summary().asks === 0, 'observe() is a no-op while disabled');
check(P.boost({ t: 'sourdough starter hydration', d: 'cook' }) === 0, 'boost is zero while disabled');
check(P.prefs('cook') === null, 'prefs are gone while disabled');
const offRaw = offStore.getItem(KEY) || '';
check(!/sourdough/.test(offRaw), 'nothing about the user survives in storage after opting out');
P._useStorage(offStore);
check(P.enabled() === false, 'the opt-out itself survives a reload');
P.setEnabled(true);
copyN(5, 'sourdough starter hydration', { domain: 'cook' });
check(P.enabled() === true && P.affinity('sourdough starter hydration') > 0,
  'setEnabled(true) resumes learning from scratch');

/* 10. The profile is worthless if it does not survive the tab closing. */
console.log('== persistence ==');
const s1 = reset();
[
  'sourdough starter feeding schedule',
  'sourdough bread crumb too dense',
  'best flour for sourdough baking',
].forEach(t => P.observe({ type: 'copy', text: t, domain: 'cook', steer: 'shaped', depth: 2 }));
const beforeAff = P.affinity('sourdough hydration ratio');
const beforeTop = P.top(5).map(x => x.token).join(',');
const beforeSummary = P.summary();
P._useStorage(s1);
check(P.affinity('sourdough hydration ratio') === beforeAff, 'affinity survives a reload');
check(P.top(5).map(x => x.token).join(',') === beforeTop, 'token ranking survives a reload');
check(P.recent(3)[0] === 'best flour for sourdough baking', 'recent() survives a reload');
const pr2 = P.prefs('cook');
check(!!pr2 && pr2.steer === 'shaped' && pr2.depth === 2, 'prefs survive a reload');
check(P.summary().asks === beforeSummary.asks, 'the ask count survives a reload');

/* 11. Another tab, an extension, or a half-finished write can leave anything at
       all under that key. Half-parsing it into a weight map produces a profile
       that is wrong in ways nobody can debug, so the only safe move is to start
       over — and under no circumstances to throw on page load. */
console.log('== corrupt storage ==');
const bad = fakeStore();
bad.setItem(KEY, '{not json');
let threw = null;
try { P._useStorage(bad); } catch (e) { threw = e; }
check(!threw, 'corrupt storage does not throw on load');
check(P.top(10).length === 0 && P.affinity('anything') === 0, 'corrupt storage resets to a clean profile');
check(bad.getItem(KEY) === null, 'the unreadable value is discarded rather than kept');
copyN(3, 'sourdough starter hydration', { domain: 'cook' });
check(P.affinity('sourdough starter hydration') > 0, 'the profile works normally after a reset');

for (const junk of ['[]', 'null', '"a string"', '{"w":"not an object"}', '{"w":{"x":"NaN"},"recent":5}', '42']) {
  const s = fakeStore();
  s.setItem(KEY, junk);
  let e2 = null;
  try { P._useStorage(s); P.observe({ type: 'copy', text: 'sanity check text', domain: 'cook' }); }
  catch (e) { e2 = e; }
  if (e2) fail(`storage payload ${junk} threw: ${e2.message}`);
}
ok('assorted foreign payloads load without throwing');

/* No storage at all is the private-browsing case and the node case. The app
   must degrade to memory rather than losing a feature or a page load. */
let e3 = null;
try {
  P._useStorage(null);
  copyN(4, 'sourdough starter hydration', { domain: 'cook' });
} catch (e) { e3 = e; }
check(!e3 && P.affinity('sourdough starter hydration') > 0,
  'works entirely in memory when storage is unavailable');

/* 12. The privacy promise gets a test, not just a comment. This reads the
       source as text so it fails on the edit that introduces a call, long
       before anyone would notice traffic leaving a browser. */
console.log('== privacy ==');
const src = fs.readFileSync(SRC, 'utf8');
const FORBIDDEN = ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'document.cookie', 'googletagmanager'];
const found = FORBIDDEN.filter(f => src.includes(f));
check(found.length === 0, `no network or tracking calls in profile.js${found.length ? ' — found ' + found.join(', ') : ''}`);
const keysUsed = [...new Set(src.match(/ps\.profile\.[a-z0-9]+/g) || [])];
check(keysUsed.length === 1 && keysUsed[0] === KEY, `exactly one storage key named in the source (${keysUsed.join(', ')})`);

console.log('─'.repeat(58));
if (failures) { console.log(`\nFAILED: ${failures} check(s)`); process.exit(1); }
console.log('\nPASSED: all checks');
process.exit(0);
