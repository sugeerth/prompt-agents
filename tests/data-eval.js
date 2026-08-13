/* Eval for the generated data layer: vocabulary, modifiers, gold cache.

   data.js is the only file in the app that is generated rather than written,
   which makes it the easiest thing to silently corrupt — a bad regeneration,
   a hand-edit, a dropped entry. It is also the file the product promise rests
   on: "type one letter, get something useful" is a claim about this data, not
   about the engine. So it gets a gate.

   Two things here deserve a note. First, the domain id list is hardcoded rather
   than imported from app.js: importing would make the test agree with whatever
   app.js currently says, which is exactly the drift it is supposed to catch.
   Second, the pre-existing gold queries are hardcoded too — those prompts are
   the head of the query distribution and several are referenced by other
   suites, so dropping one must fail loudly rather than quietly degrade a
   cached answer into a generic one.

   Runs in plain node, no browser, in milliseconds. */

const fs = require('fs');
const path = require('path');

global.window = {};
// eslint-disable-next-line no-eval
eval(fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8'));

let failures = 0;
const fail = m => { failures++; console.log('FAIL:', m); };
const ok = m => console.log('  ok:', m);

/* Domain ids, copied from the DOMAINS table at the top of app.js.
   If app.js gains or renames a domain, update this list deliberately. */
const DOMAINS = ['learn', 'code', 'debug', 'write', 'email', 'career', 'health', 'cook',
  'travel', 'money', 'fit', 'home', 'parent', 'shop', 'create', 'biz', 'market', 'legal',
  'lang', 'math', 'sci', 'plan', 'social', 'fun', 'tech', 'decide', 'summarize', 'analyze',
  'image', 'agent', 'local', 'general'];

/* Every gold query that existed before the vocabulary expansion. A cached
   prompt is the best answer the app has for that ask; losing one is a
   regression no other test would notice. */
const LEGACY_GOLD = ['write an email', 'resignation letter', 'cover letter', 'improve my resume',
  'interview prep', 'ask for a raise', 'write my essay', 'rewrite this professionally',
  'fix my grammar', 'summarize this', 'explain quantum computing', "explain like i'm five",
  '7 day japan itinerary', '3 day paris itinerary', 'weekend getaway ideas', 'packing list',
  'best time to book flights', 'weekly meal plan', 'dinner ideas tonight',
  'recipes with what i have', 'weight loss plan', 'how to sleep better', 'beginner workout plan',
  'lose belly fat', 'business ideas', 'write a business plan', 'side hustle ideas',
  'business name ideas', 'validate my business idea', 'instagram caption ideas', 'marketing plan',
  'write a python script', 'explain this code', 'fix this error', 'excel formula help',
  'monthly budget', 'investing for beginners', 'best laptop 2026', 'gift ideas',
  'iphone vs android', 'pros and cons', 'restaurants near me', 'things to do near me',
  'coffee shops near me', 'date ideas near me', 'gyms near me', 'learn spanish', 'translate this',
  'solve this math problem', 'what to text back', 'apology message', 'write a poem',
  'toddler tantrums', 'cleaning schedule', 'tell me a joke', 'study schedule', 'review my lease',
  'analyze this data', 'generate a logo', 'research this topic', 'set up ci for my repo',
  'upgrade all my dependencies safely', 'migrate my database schema', 'keep my prs green',
  'refactor my codebase', 'build and deploy my website'];

/* Floors, not targets. They exist so a later edit that shrinks the corpus is
   loud rather than silent; raise them when the corpus grows. */
const VOCAB_FLOOR = 850;
const GOLD_FLOOR = 110;
const MAX_GOLD_WORDS = 60;

/* ---- 1. data.js parses and exposes the three tables ---- */
const { PS_VOCAB, PS_MODS, PS_GOLD } = global.window;
for (const [name, v] of [['PS_VOCAB', PS_VOCAB], ['PS_MODS', PS_MODS], ['PS_GOLD', PS_GOLD]]) {
  if (!Array.isArray(v) || !v.length) fail(`${name} is missing or empty`);
}
if (!failures) ok('data.js parses and exposes PS_VOCAB, PS_MODS, PS_GOLD');
if (failures) { console.log('\n1 FAILURES'); process.exit(1); }

/* ---- 2. no duplicates ---- */
{
  const seen = new Set();
  const dupes = [];
  for (const e of PS_VOCAB) { if (seen.has(e.t)) dupes.push(e.t); seen.add(e.t); }
  if (dupes.length) fail('duplicate vocabulary entries: ' + dupes.join(', '));
  else ok(`${PS_VOCAB.length} vocabulary entries, no duplicates`);

  const qs = new Set();
  const dupq = [];
  for (const g of PS_GOLD) { if (qs.has(g.q)) dupq.push(g.q); qs.add(g.q); }
  if (dupq.length) fail('duplicate gold queries: ' + dupq.join(', '));
  else ok(`${PS_GOLD.length} gold queries, no duplicates`);
}

/* ---- 3. entries look like something a person typed ---- */
{
  /* lowercase, trimmed, no sentence punctuation. Apostrophes and hyphens are
     allowed because "won't" and "x-ray" are how people actually type. */
  const SHAPE = /^[a-z0-9][a-z0-9 '\-&]*[a-z0-9]$/;
  const bad = [];
  for (const e of PS_VOCAB) {
    if (typeof e.t !== 'string' || typeof e.d !== 'string') { bad.push(JSON.stringify(e)); continue; }
    if (e.t !== e.t.trim()) bad.push(`untrimmed: "${e.t}"`);
    else if (e.t !== e.t.toLowerCase()) bad.push(`not lowercase: "${e.t}"`);
    else if (!SHAPE.test(e.t)) bad.push(`stray punctuation: "${e.t}"`);
    else {
      const w = e.t.split(/\s+/).length;
      if (w < 2 || w > 8) bad.push(`${w} words: "${e.t}"`);
      else if (e.t.length > 44) bad.push(`${e.t.length} chars: "${e.t}"`);
    }
  }
  if (bad.length) fail(`${bad.length} malformed entries — ` + bad.slice(0, 8).join(' | '));
  else ok('every entry is lowercase, trimmed, unpunctuated and 2-8 words');
}

/* ---- 4. every domain id used actually exists ---- */
{
  const known = new Set(DOMAINS);
  const unknown = new Set();
  for (const e of PS_VOCAB) if (!known.has(e.d)) unknown.add(`${e.d} (${e.t})`);
  for (const g of PS_GOLD) if (!known.has(g.d)) unknown.add(`${g.d} (${g.q})`);
  if (unknown.size) fail('unknown domain ids: ' + [...unknown].join(', '));
  else ok('every domain id used by an entry exists in the domain table');
}

/* ---- 5. a-z first-letter coverage: the one-keystroke promise ---- */
{
  const firsts = new Set(PS_VOCAB.map(e => e.t[0]));
  const missing = 'abcdefghijklmnopqrstuvwxyz'.split('').filter(c => !firsts.has(c));
  if (missing.length) fail('no vocabulary entry starts with: ' + missing.join(', '));
  else ok('every letter a-z has at least one vocabulary entry');

  /* beyond the first keystroke, the second should still help */
  const pairs = new Set(PS_VOCAB.map(e => e.t.slice(0, 2)));
  const COMMON = ['wh', 'ho', 'be', 'ca', 'ma', 'st', 're', 'co', 'de', 'pr', 'in', 'ex',
    'se', 'me', 'tr', 'un', 'wo', 'wr', 'pl', 'sh', 'gi', 'le', 'li', 'fi', 'fo'];
  const weak = COMMON.filter(p => !pairs.has(p));
  if (weak.length) fail('common two-letter prefixes with no entry: ' + weak.join(', '));
  else ok('common two-letter prefixes all resolve to at least one entry');
}

/* ---- 6. gold prompts obey the house rules ---- */
{
  /* Succinct output is the product thesis; a gold prompt that rambles is the
     one place the app contradicts itself. */
  const long = PS_GOLD.filter(g => g.p.split(/\s+/).length > MAX_GOLD_WORDS)
    .map(g => `${g.q} (${g.p.split(/\s+/).length}w)`);
  if (long.length) fail(`gold prompts over ${MAX_GOLD_WORDS} words: ` + long.join(', '));
  else ok(`every gold prompt is under ${MAX_GOLD_WORDS} words`);

  /* "You are an expert…" states nothing about what is wanted. Banned. */
  const ROLEPLAY = /\b(you are (an?|the) |act as|pretend (to be|you)|imagine you are|as an? (expert|professional|world.class))/i;
  const roles = PS_GOLD.filter(g => ROLEPLAY.test(g.p)).map(g => g.q);
  if (roles.length) fail('gold prompts using a role-play opener: ' + roles.join(', '));
  else ok('no gold prompt opens with role-play');

  const ps = new Set();
  const dupes = [];
  for (const g of PS_GOLD) { if (ps.has(g.p)) dupes.push(g.q); ps.add(g.p); }
  if (dupes.length) fail('gold prompts duplicated verbatim on: ' + dupes.join(', '));
  else ok('no two gold prompts are identical');

  /* The drill line is appended by the host at render time — a prompt that
     carries its own would emit it twice. */
  const drill = PS_GOLD.filter(g => /go deeper|reply with a number|numbered (ways|follow)/i.test(g.p)).map(g => g.q);
  if (drill.length) fail('gold prompts carrying the host drill line: ' + drill.join(', '));
  else ok('no gold prompt duplicates the host-appended drill line');
}

/* ---- 7. no previously cached prompt has been dropped ---- */
{
  const have = new Set(PS_GOLD.map(g => g.q));
  const gone = LEGACY_GOLD.filter(q => !have.has(q));
  if (gone.length) fail('gold queries removed or renamed: ' + gone.join(', '));
  else ok(`all ${LEGACY_GOLD.length} pre-existing gold queries are still served`);
}

/* ---- 8. counts meet their floors ---- */
{
  if (PS_VOCAB.length < VOCAB_FLOOR) fail(`vocabulary shrank to ${PS_VOCAB.length}, floor is ${VOCAB_FLOOR}`);
  else ok(`vocabulary at ${PS_VOCAB.length} entries (floor ${VOCAB_FLOOR})`);
  if (PS_GOLD.length < GOLD_FLOOR) fail(`gold cache shrank to ${PS_GOLD.length}, floor is ${GOLD_FLOOR}`);
  else ok(`gold cache at ${PS_GOLD.length} prompts (floor ${GOLD_FLOOR})`);
  /* modifiers are not generated from tools/ — this only catches truncation */
  if (PS_MODS.length < 30) fail(`PS_MODS shrank to ${PS_MODS.length}`);
  else ok(`${PS_MODS.length} one-tap modifiers intact`);
}

/* ---- 9. every domain the app can render has vocabulary behind it ---- */
{
  /* "general" is the fallback framing for free typing and carries no entries
     by design; every other domain should be reachable from autocomplete. */
  const used = new Set(PS_VOCAB.map(e => e.d));
  const empty = DOMAINS.filter(d => d !== 'general' && !used.has(d));
  if (empty.length) fail('domains with no vocabulary at all: ' + empty.join(', '));
  else ok('every non-fallback domain has vocabulary behind it');
}

console.log(failures ? `\n${failures} FAILURES` : `\nALL DATA TESTS PASSED`);
process.exit(failures ? 1 : 0);
