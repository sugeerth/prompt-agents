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

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);
  const text = () => page.locator('#prompt').innerText();
  const sugTexts = () => page.locator('#sug .s-item').allInnerTexts();

  // 1. typo tolerance: similarity fallback finds the right entry
  await page.fill('#q', 'explan machine lerning');
  await page.waitForTimeout(80);
  let sugs = (await sugTexts()).join(' | ');
  if (!sugs.includes('explain machine learning')) fail('typo query did not match: ' + sugs);
  else ok('typos still match ("explan machine lerning" → explain machine learning)');

  // 2. word-order tolerance
  await page.fill('#q', ''); await page.fill('#q', 'salary negotiate');
  await page.waitForTimeout(80);
  sugs = (await sugTexts()).join(' | ');
  if (!sugs.includes('negotiate salary offer')) fail('reordered query did not match: ' + sugs);
  else ok('word order ignored ("salary negotiate" → negotiate salary offer)');

  // 3. local domain: near-me asks
  await page.fill('#q', ''); await page.fill('#q', 'best tacos near me');
  await page.keyboard.press('Escape');
  let t = await text();
  if (!t.startsWith('Recommend:') || !t.includes('location')) fail('local domain not applied: ' + t);
  else ok('near-me asks use the Nearby domain (asks location, table shape)');

  // 4. compound ask gets the constraint guard, click removes it
  await page.fill('#q', ''); await page.fill('#q', '10 days in japan with kids on a budget');
  await page.keyboard.press('Escape');
  t = await text();
  if (!t.includes('Cover every constraint I stated.')) fail('compound guard missing: ' + t);
  else ok('complex multi-intent ask gets the constraint guard line');
  await page.locator('#prompt .seg', { hasText: 'Cover every constraint I stated.' }).click();
  t = await text();
  if (t.includes('Cover every constraint I stated.')) fail('clicking guard did not remove it');
  else ok('clicking the guard removes it');

  // 5. simple ask does NOT get the guard
  await page.fill('#q', ''); await page.fill('#q', 'explain machine learning');
  await page.keyboard.press('Escape');
  if ((await text()).includes('Cover every constraint')) fail('guard wrongly added to simple ask');
  else ok('simple asks skip the guard');

  // 6. gold cache: known top query surfaces a pinned ★ suggestion
  const gold0 = await page.evaluate(() => window.PS_GOLD[0]);
  await page.fill('#q', ''); await page.fill('#q', gold0.q.slice(0, Math.max(4, gold0.q.length - 2)));
  await page.waitForTimeout(80);
  const firstItem = await page.locator('#sug .s-item').first();
  const firstCls = await firstItem.getAttribute('class');
  const items = await sugTexts();
  const goldShown = items.some(s => s.includes('★ tuned'));
  if (!goldShown) fail('gold suggestion not shown for: ' + gold0.q + ' — got: ' + items.join(' | '));
  else ok('gold ★ suggestion appears for top query "' + gold0.q + '"');

  // 7. accepting gold serves the cached prompt verbatim (+ drill), chips still compose
  // click the gold item specifically
  const goldIdx = items.findIndex(s => s.includes('★ tuned'));
  await page.locator('#sug .s-item').nth(goldIdx).click();
  t = await text();
  if (!t.includes(gold0.p)) fail('gold prompt not served verbatim.\n  want: ' + gold0.p + '\n  got:  ' + t);
  else ok('gold prompt served verbatim');
  if (!t.includes("I'll pick by number") && gold0.d !== 'image') fail('drill line missing on gold prompt');
  else ok('drill line still appended to gold');
  await page.locator('#chips .chip[data-id="table"]').click();
  t = await text();
  if (!t.includes('Format as a compact table.')) fail('chip did not compose onto gold prompt');
  else ok('chips compose onto gold prompts');
  await page.locator('#chips .chip[data-id="table"]').click();

  // 8. typing again leaves the gold prompt
  await page.fill('#q', (await page.inputValue('#q')) + ' x');
  t = await text();
  if (t.includes(gold0.p)) fail('typing did not clear gold state');
  else ok('typing resumes normal engine');

  // 9. every gold entry is well-formed at runtime + similarity self-match
  const goldCheck = await page.evaluate(() => {
    const bad = [];
    for (const g of window.PS_GOLD) {
      if (!g.q || !g.p || !g.d) bad.push('malformed: ' + JSON.stringify(g).slice(0, 60));
      if (g.p.split(/\s+/).length > 60) bad.push('too long: ' + g.q);
    }
    return bad;
  });
  goldCheck.forEach(b => fail('gold: ' + b));
  if (!goldCheck.length) ok('all gold entries well-formed at runtime');

  // 10. footer mentions gold count
  const foot = await page.locator('#vocabnote').innerText();
  if (!/hand-tuned/.test(foot)) fail('footer missing gold note: ' + foot);
  else ok('footer: ' + foot);

  if (errors.length) errors.forEach(e => fail('console/page error: ' + e));
  await browser.close();
  console.log(failures ? `\n${failures} FAILURES` : '\nALL SIMILARITY/GOLD TESTS PASSED');
  process.exit(failures ? 1 : 0);
})();
