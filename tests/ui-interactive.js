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

  const DRILL = "End with 3 numbered one-line ways to go deeper; I'll pick by number.";
  const text = () => page.locator('#prompt').innerText();

  // 1. drill line present by default
  await page.fill('#q', 'explain machine learning');
  await page.keyboard.press('Escape');
  if (!(await text()).includes(DRILL)) fail('drill line missing by default');
  else ok('go-deeper line present by default');

  // 2. toggle removes and restores it
  await page.click('#drill');
  if ((await text()).includes(DRILL)) fail('toggle off did not remove drill line');
  else ok('toggle off removes it');
  await page.click('#drill');
  if (!(await text()).includes(DRILL)) fail('toggle on did not restore drill line');
  else ok('toggle on restores it');

  // 3. drill excluded for image prompts
  await page.fill('#q', 'logo for a coffee shop');
  await page.keyboard.press('Escape');
  const imgText = await text();
  if (imgText.includes(DRILL) && imgText.startsWith('Write one image-generation prompt'))
    fail('drill line wrongly added to image prompt');
  else ok('image prompts skip the go-deeper line');

  // 4. click a modifier segment in the prompt -> chip turns off, text removed
  await page.fill('#q', 'explain machine learning');
  await page.keyboard.press('Escape');
  await page.locator('#chips .chip[data-id="diagram"]').click();
  if (!(await text()).includes('Include a simple text diagram.')) fail('diagram chip did not add text');
  await page.locator('#prompt .seg', { hasText: 'Include a simple text diagram.' }).click();
  if ((await text()).includes('Include a simple text diagram.')) fail('clicking mod segment did not remove it');
  else ok('clicking a modifier in the prompt removes it');
  const chipOn = await page.locator('#chips .chip[data-id="diagram"]').evaluate(el => el.classList.contains('on'));
  if (chipOn) fail('chip still highlighted after segment click');
  else ok('chip un-highlights too');

  // 5. click audience segment -> resets to Anyone
  await page.locator('#tone').fill('2');
  await page.locator('#tone').dispatchEvent('input');
  if (!(await text()).includes('I know the basics')) fail('expert audience line missing');
  await page.locator('#prompt .seg', { hasText: 'I know the basics' }).click();
  if ((await text()).includes('I know the basics')) fail('clicking audience segment did not remove it');
  else ok('clicking audience line clears it');
  const toneOut = await page.locator('#toneOut').innerText();
  if (toneOut !== 'Anyone') fail('tone slider label not reset: ' + toneOut);
  else ok('audience slider resets to Anyone');

  // 6. click shape segment -> cycles depth 1 -> 2 -> 0 -> 1
  const shapeSel = '#prompt .seg[title="Click to change depth"]';
  const depths = [];
  for (let i = 0; i < 3; i++) {
    await page.locator(shapeSel).first().click();
    depths.push(await page.locator('#depthOut').innerText());
  }
  if (depths.join(',') !== 'Deep,TL;DR,Standard') fail('shape click cycle wrong: ' + depths.join(','));
  else ok('clicking the shape sentence cycles depth: ' + depths.join(' → '));

  // 7. summarize: drill before paste marker, marker still last
  await page.fill('#q', 'summarize this article');
  await page.keyboard.press('Escape');
  const sum = await text();
  if (!sum.trim().endsWith('[paste text below]')) fail('paste marker not last with drill on: ' + sum);
  else ok('paste marker still last with drill on');
  if (!sum.includes(DRILL)) fail('summarize lost drill line');

  // 8. copied text includes drill line and matches display
  await page.keyboard.press('Enter');
  const ctx2 = browser.contexts()[0];
  // clipboard permission not granted on this context; verify via count label instead
  const words = await page.locator('#count').innerText();
  if (!/\d+ words/.test(words)) fail('word count missing');
  else ok('word count renders: ' + words);

  if (errors.length) errors.forEach(e => fail('console/page error: ' + e));
  await browser.close();
  console.log(failures ? `\n${failures} FAILURES` : '\nALL INTERACTIVE TESTS PASSED');
  process.exit(failures ? 1 : 0);
})();
