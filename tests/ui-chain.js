/* Chaining, end to end in a real browser.

   The engine's own eval covers the link text. What this suite covers is the
   thing that actually decides whether chaining gets used: can someone build a
   two-step chain without being taught, does the second prompt really know what
   the first asked, and can they get both out of the app in one action. */

const { chromium } = require('playwright');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const URL = 'file://' + path.join(REPO, 'index.html');
const LAUNCH = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};

let failures = 0;
const fail = m => { failures++; console.log('FAIL:', m); };
const ok = m => console.log('  ok:', m);

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ viewport: { width: 1150, height: 980 },
                                         permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);

  const text = () => page.locator('#prompt').innerText();
  const set = async q => {
    await page.fill('#q', ''); await page.fill('#q', q);
    await page.keyboard.press('Escape'); await page.waitForTimeout(60);
  };

  // 1. there is nothing to chain yet, so the control isn't on screen at all
  if (await page.locator('#chainadd').isVisible())
    fail('the chain control is offered before there is a prompt to chain');
  else ok('nothing to chain yet — the control is not on screen');

  // 2. one tap commits the current prompt and clears the box for the next thought
  await set('10 days in japan with kids on a tight budget');
  const step1 = await text();
  await page.click('#chainadd');
  await page.waitForTimeout(60);
  if ((await page.inputValue('#q')) !== '') fail('the box was not cleared for the next step');
  else if (!(await page.locator('#chainstrip').isVisible())) fail('the chain strip did not appear');
  else ok('one tap keeps the prompt and clears the box for the next step');

  const strip = await page.locator('#chainstrip').innerText();
  if (!/japan/i.test(strip)) fail('committed step not shown in the strip: ' + strip);
  else ok('the committed step is visible above the box');

  // 3. THE POINT: a shorthand follow-up inherits the subject and the constraints
  await set('what should we pack');
  const step2 = await text();
  if (!/Step 1 asked:/.test(step2)) fail('follow-up does not know what step 1 asked: ' + step2);
  else ok('the follow-up carries what step 1 asked');
  if (!/build on it, don't repeat it/.test(step2))
    fail('follow-up does not tell the model to build on the answer: ' + step2);
  else ok('the follow-up builds on the previous answer instead of restarting');
  if (!/constraints still apply/.test(step2) || !/tight budget/.test(step2))
    fail('constraints did not carry into the follow-up: ' + step2);
  else ok('the constraints from step 1 still apply in step 2');

  // 4. the link is editable like everything else — click it away
  const linkSeg = page.locator('#prompt .seg', { hasText: 'build on it' }).first();
  await linkSeg.click();
  await page.waitForTimeout(60);
  if (/build on it, don't repeat it/.test(await text())) fail('clicking the link did not unlink the step');
  else ok('the link is clickable away like every other part of the prompt');
  /* Unlinking is a decision about this step, not about the character just
     typed, so it survives further typing — unlike the per-keystroke guards. */
  await set('what should we pack for the trip');
  if (/build on it, don't repeat it/.test(await text())) fail('unlinking was undone by typing');
  else ok('unlinking sticks while you keep editing the step');

  // 5. both ways out: this step alone, or the whole chain as one prompt
  if ((await page.locator('#copy').innerText()) !== 'Copy step 2')
    fail('copy button does not name the step: ' + await page.locator('#copy').innerText());
  else ok('the copy button names which step it copies');
  if (!(await page.locator('#copyall').isVisible())) fail('no way to copy the whole chain');
  else {
    await page.click('#copyall');
    await page.waitForTimeout(80);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    if (!/1\)/.test(clip) || !/2\)/.test(clip)) fail('chain copy is not a numbered pipeline: ' + clip);
    else if (!/japan/i.test(clip) || !/pack/i.test(clip)) fail('chain copy lost a step: ' + clip);
    else if (clip.indexOf('japan') > clip.indexOf('pack')) fail('chain copy is out of order');
    else ok('the whole chain copies as one ordered pipeline prompt');
  }

  // 6. a step can be removed, and the prompt stops carrying it
  await page.locator('#chainstrip .x').first().click();
  await page.waitForTimeout(60);
  if (await page.locator('#chainstrip').isVisible()) fail('strip still shown after removing the only step');
  else if (/Step 1 asked:/.test(await text())) fail('prompt still carries a removed step');
  else ok('removing a step drops it from the prompt too');

  // 7. a chain survives a reload, because it lives in the URL
  await set('plan a birthday party for 20 people');
  await page.click('#chainadd');
  await page.waitForTimeout(60);
  await set('what food should i order');
  const beforeReload = await text();
  const url = page.url();
  if (!/#/.test(url) || !/c=/.test(url)) fail('chain not written to the URL: ' + url);
  else ok('the chain lives in the URL, so it can be shared');
  await page.goto(url);
  await page.waitForTimeout(120);
  if (!(await page.locator('#chainstrip').isVisible()))
    fail('chain did not survive a reload');
  else if (!/birthday/i.test(await page.locator('#chainstrip').innerText()))
    fail('reloaded chain lost its step: ' + await page.locator('#chainstrip').innerText());
  else ok('a shared link rebuilds the whole chain');
  if (beforeReload.length < 10) fail('empty prompt before reload');

  // 8. chains are capped where they stop being followable
  await page.goto(URL);
  for (let i = 0; i < 8; i++) {
    await set('step number ' + i);
    if (!(await page.locator('#chainadd').isDisabled())) await page.click('#chainadd');
    await page.waitForTimeout(40);
  }
  const steps = await page.locator('#chainstrip .step').count();
  if (steps > 6) fail('chain grew past the cap: ' + steps);
  else ok('chains stop at a length a person can still hold in their head');

  if (errors.length) errors.forEach(e => fail('console/page error: ' + e));
  await browser.close();
  console.log(failures ? `\n${failures} FAILURES` : '\nALL CHAIN UI TESTS PASSED');
  process.exit(failures ? 1 : 0);
})();
