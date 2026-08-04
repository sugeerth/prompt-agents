const { chromium } = require('playwright');

const path = require('path');
const REPO = path.resolve(__dirname, '..');
const URL = 'file://' + path.join(REPO, 'index.html');
// CI installs Chromium via `npx playwright install`; this env var lets a
// sandbox point at a pre-installed binary instead.
const LAUNCH = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};

let failures = 0;
const fail = m => { failures++; console.log('FAIL:', m); };
const ok = m => console.log('  ok:', m);

/* Anything that dictates the SHAPE of the reply rather than the goal. In
   Native the model must be left to answer its own way, so none of this may
   appear. */
const FORM = /\b(\d+ bullets?|bullet points?|max \d+ words?|under \d+ words?|in a table|Format as|one line per day|2 sentences|numbered one-line|Output:)\b/i;

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 1150, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);
  await page.evaluate(() => { const t = document.getElementById('tune'); if (t) t.classList.add('open'); });

  const text = () => page.locator('#prompt').innerText();
  const metrics = () => page.locator('#metrics').innerText();
  const set = async q => { await page.fill('#q', ''); await page.fill('#q', q); await page.keyboard.press('Escape'); await page.waitForTimeout(50); };
  const steer = async mode => { while ((await page.locator('#steer').innerText()) !== mode) await page.click('#steer'); await page.waitForTimeout(40); };

  // 1. default posture is Guided — not the most forcing one
  if ((await page.locator('#steer').innerText()) !== 'Guided') fail('default steer is not Guided');
  else ok('defaults to Guided, not Shaped');

  // 2. Native never dictates form
  await steer('Native');
  for (const q of ['explain machine learning', '10 days in japan with kids on a tight budget',
                   'write a cover letter', 'best tacos near me', 'summarize this article']) {
    await set(q);
    const t = await text();
    const hit = t.match(FORM);
    if (hit) fail(`Native dictated form on "${q}": ${hit[0]}  ::  ${t}`);
  }
  ok('Native never dictates shape, length or structure');

  // 3. Native drops the follow-up menu and disables its toggle
  await set('explain machine learning');
  if ((await text()).includes("pick by number")) fail('Native still appends the go-deeper menu');
  else ok('Native drops the go-deeper menu');
  if (!(await page.locator('#drill').isDisabled())) fail('go-deeper toggle not disabled in Native');
  else ok('go-deeper toggle disabled in Native');

  // 4. Native keeps the user's own words as the ask
  await set('my wifi keeps dropping');
  let t = await text();
  if (!t.startsWith('My wifi keeps dropping.')) fail('Native did not lead with the user\'s words: ' + t);
  else ok("Native leads with the user's own words");

  // 5. Native still carries intent
  if (!t.includes('I want this working')) fail('Native lost the intent line: ' + t);
  else ok('Native still states what the user wants');

  // 6. Depth is hidden where it would do nothing
  if (await page.locator('#depthWrap').isVisible()) fail('Depth shown in Native where it has no effect');
  else ok('Depth hidden in Native');
  await steer('Guided');
  if (await page.locator('#depthWrap').isVisible()) fail('Depth shown in Guided where it has no effect');
  else ok('Depth hidden in Guided');
  await steer('Shaped');
  if (!(await page.locator('#depthWrap').isVisible())) fail('Depth missing in Shaped');
  else ok('Depth shown in Shaped');

  // 7. Guided states intent but sets no size cap
  await steer('Guided');
  await set('explain machine learning');
  t = await text();
  if (!t.includes('I want to genuinely understand')) fail('Guided lost the intent line: ' + t);
  else ok('Guided states intent');
  if (/max \d+ words/i.test(t)) fail('Guided imposed a word cap: ' + t);
  else ok('Guided sets no word cap');

  // 8. Shaped keeps the full shaping
  await steer('Shaped');
  t = await text();
  if (!/Max \d+ words/i.test(t)) fail('Shaped lost its size cap: ' + t);
  else ok('Shaped still fixes shape and length');

  // 9. escalation is monotonic: each step adds, never removes
  const lens = [];
  for (const mode of ['Native', 'Guided', 'Shaped']) {
    await steer(mode); await set('explain machine learning');
    lens.push((await text()).split(/\s+/).length);
  }
  if (!(lens[0] < lens[1] && lens[1] < lens[2])) fail('steer not monotonic: ' + lens.join(','));
  else ok('Native → Guided → Shaped grows monotonically: ' + lens.join(' → ') + ' words');

  // 10. intent readout appears, and admits when it doesn't know
  await steer('Guided');
  await set('review my resume');
  if (!(await metrics()).includes('wants: check my work')) fail('intent readout wrong: ' + await metrics());
  else ok('intent readout shows the recognized goal');
  await set('sourdough');
  if (!(await metrics()).includes('goal unclear')) fail('did not admit unclear goal: ' + await metrics());
  else ok('admits when the goal is unclear');
  if (!(await text()).includes('ask me one question')) fail('no clarifying fallback on a bare topic');
  else ok('bare topic asks a question instead of guessing');

  // 11. a review request is not framed as a drafting request
  await set('review my resume');
  t = await text();
  if (/^Draft this|^Write /.test(t)) fail('review framed as drafting: ' + t);
  else ok('review is not framed as drafting');

  // 12. intent line is removable like every other piece
  await set('my wifi keeps dropping');
  await page.locator('#prompt .seg', { hasText: 'I want this working' }).click();
  if ((await text()).includes('I want this working')) fail('clicking the intent line did not remove it');
  else ok('intent line is clickable-removable');

  // 13. intent informs the domain when no topic cue fires
  await set('my wifi keeps dropping');
  if (!(await text()).startsWith('Tech help')) fail('intent did not inform domain: ' + await text());
  else ok('intent informs domain when no topic cue fires');

  if (errors.length) errors.forEach(e => fail('console/page error: ' + e));
  await browser.close();
  console.log(failures ? `\n${failures} FAILURES` : '\nALL STEER/INTENT TESTS PASSED');
  process.exit(failures ? 1 : 0);
})();
