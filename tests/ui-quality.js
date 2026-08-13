/* Prompt quality, gated.

   Every other suite checks that a feature works. This one checks the thing the
   product is actually for: that the prompt which comes out is short, says each
   thing once, and reads like a person wrote it.

   Quality regressions are invisible to feature tests — a duplicated idea or an
   extra fifteen words breaks nothing and fails nothing, it just quietly makes
   the product worse. Every line added to a prompt has to earn its place, and
   this is where that gets enforced. */

const { chromium } = require('playwright');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const URL = 'file://' + path.join(REPO, 'index.html');
const LAUNCH = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};

let failures = 0;
const fail = m => { failures++; console.log('FAIL:', m); };
const ok = m => console.log('  ok:', m);

/* Budgets by what the ask actually is. A trivial question that produces a
   paragraph of instructions is the failure mode this product exists to avoid;
   an agent brief is legitimately longer because it is a contract, not a
   question. Ceilings, not targets — going under is always fine. */
const CASES = [
  ['pasta recipe', 40, 'trivial'],
  ['explain machine learning', 40, 'trivial'],
  ['what is inflation', 40, 'trivial'],
  ['why is my laptop slow', 45, 'everyday'],
  ['fix my resume', 45, 'everyday'],
  ['how do i negotiate a raise', 45, 'everyday'],
  ['best laptop for video editing under 1500', 65, 'bounded choice'],
  ['dinner for 6 vegetarian in 30 minutes', 65, 'bounded'],
  ['should i lease or buy a car', 65, 'decision'],
  ['10 days in japan with kids on a tight budget', 75, 'complex'],
  ['migrate my database then update the api', 95, 'agent brief'],
  ['set up ci for my repo', 95, 'agent brief'],
];

const STOP = new Set(('the a an of to for in on at by with and or is are be it this that then than as ' +
  'i my me we our you your what how why when do does did should would could can will not no ' +
  'one two three only just any all more less each other them they').split(' '));
const content = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
  .filter(w => w.length >= 4 && !STOP.has(w));

/* Two sentences that share most of their content words are one sentence with a
   rewrite, however different they look. */
function overlap(a, b) {
  const A = new Set(content(a)), B = new Set(content(b));
  if (A.size < 3 || B.size < 3) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size);
}

const sentences = t => t.split(/(?<=[.?!])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 12);

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 1150, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);

  const set = async q => {
    await page.fill('#q', ''); await page.fill('#q', q);
    await page.keyboard.press('Escape'); await page.waitForTimeout(70);
    return (await page.locator('#prompt').innerText()).trim();
  };

  const all = [];
  let overBudget = 0, dup = 0, echo = 0, artefact = 0;

  for (const [q, budget, kind] of CASES) {
    const raw = await set(q);
    /* Segments are joined with a space for display, so a line-leading segment
       renders as " \n". The copied text collapses that — and the copied text is
       what the user actually pastes, so it is what gets judged here. */
    const t = raw.replace(/ +\n/g, '\n');
    const words = t.split(/\s+/).length;
    all.push({ q, words, kind, t });

    if (words > budget) { fail(`"${q}" (${kind}) is ${words} words, budget ${budget}: ${t}`); overBudget++; }

    // the same idea twice, however it is worded
    const ss = sentences(t);
    for (let i = 0; i < ss.length; i++)
      for (let j = i + 1; j < ss.length; j++)
        if (overlap(ss[i], ss[j]) >= 0.6) {
          fail(`"${q}" says the same thing twice:\n     A: ${ss[i]}\n     B: ${ss[j]}`); dup++;
        }

    // literally the same sentence twice
    const seen = new Set();
    for (const s of ss) {
      const k = s.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (seen.has(k)) { fail(`"${q}" repeats a sentence verbatim: ${s}`); echo++; }
      seen.add(k);
    }

    // text artefacts that mean the assembler slipped
    if (/\s{2,}/.test(t) || / \./.test(t) || /\.\./.test(t) || /,\s*,/.test(t)) {
      fail(`"${q}" has assembly artefacts: ${JSON.stringify(t)}`); artefact++;
    }
    if (!/[.?!\]]$/.test(t)) { fail(`"${q}" does not end cleanly: ${JSON.stringify(t.slice(-40))}`); artefact++; }

    // asking for brevity and depth in the same breath
    if (/Keep it short/.test(t) && /Go thorough/.test(t))
      fail(`"${q}" asks for short and thorough at once`);
  }

  if (!overBudget) ok(`every prompt is inside its word budget (${CASES.length} asks)`);
  if (!dup) ok('no prompt says the same thing twice in different words');
  if (!echo) ok('no prompt repeats a sentence verbatim');
  if (!artefact) ok('no assembly artefacts — spacing and punctuation are clean');

  // the shape of the distribution matters as much as any single case: a tool
  // whose median prompt is long has lost the plot regardless of its ceilings
  const counts = all.map(a => a.words).sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)];
  const mean = Math.round(counts.reduce((s, n) => s + n, 0) / counts.length);
  if (median > 55) fail(`median prompt is ${median} words — too long for the product's promise`);
  else ok(`median prompt is ${median} words, mean ${mean}, range ${counts[0]}–${counts[counts.length - 1]}`);

  // trivial asks must stay dramatically shorter than complex ones, or the
  // engine is spending the same effort everywhere and adapting to nothing
  const triv = all.filter(a => a.kind === 'trivial').reduce((s, a) => s + a.words, 0) / 3;
  const cplx = all.find(a => a.kind === 'complex').words;
  if (!(triv * 1.8 < cplx)) fail(`spend is not adapting: trivial ${triv.toFixed(0)} vs complex ${cplx}`);
  else ok(`spend adapts to the ask: trivial ~${triv.toFixed(0)} words vs complex ${cplx}`);

  // and every prompt must still contain the user's own words, unmangled
  /* Framing verbs are deliberately stripped ("what is inflation" becomes
     "Explain inflation."), so what must survive is the SUBJECT — the words that
     carry the ask. Losing those means the engine rewrote the user. */
  for (const { q, t } of all) {
    const subject = q.split(' ').filter(w => w.length > 3)
      .filter(w => !/^(what|how|why|when|does|should|then|this|that|your)$/.test(w));
    const kept = subject.filter(w => t.toLowerCase().includes(w));
    if (subject.length && kept.length < Math.ceil(subject.length * 0.6))
      fail(`"${q}" lost the user's own words: kept ${kept.length}/${subject.length} in: ${t}`);
  }
  ok("every prompt keeps the words that carry the ask");

  if (errors.length) errors.forEach(e => fail('console/page error: ' + e));
  await browser.close();
  console.log(failures ? `\n${failures} FAILURES` : '\nALL QUALITY TESTS PASSED');
  process.exit(failures ? 1 : 0);
})();
