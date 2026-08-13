/* The two axes that define the prompt, and the completion that fills the box.

   Steer across, depth up. The pair is the app's main control surface, so this
   suite checks the things a user would notice immediately if they broke: that
   both axes are real controls, that they say what they currently mean, that
   the vertical one is honest about when it has no effect, and that one
   keystroke plus Tab still produces a whole ask. */

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
  const page = await browser.newPage({ viewport: { width: 1150, height: 980 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);

  const text = () => page.locator('#prompt').innerText();
  const set = async q => {
    await page.fill('#q', ''); await page.fill('#q', q);
    await page.keyboard.press('Escape'); await page.waitForTimeout(60);
  };
  const slide = async (id, v) => {
    await page.locator('#' + id).fill(String(v));
    await page.locator('#' + id).dispatchEvent('input');
    await page.waitForTimeout(50);
  };

  // 1. the axes aren't on screen until there is a prompt for them to shape
  if (await page.locator('.pad').isVisible())
    fail('the shaping axes are offered before there is anything to shape');
  else ok('the axes stay off screen until there is a prompt to shape');
  await set('explain machine learning');
  if (!(await page.locator('.pad').isVisible())) fail('the axes never arrived');
  else ok('they arrive with the prompt');

  for (const id of ['steer', 'depth']) {
    const t = await page.locator('#' + id).getAttribute('type');
    if (t !== 'range') fail(`${id} is not a real slider (type=${t})`);
  }
  ok('both axes are real sliders, not custom widgets');

  // 2. they are laid out as axes: depth vertical, steer horizontal
  const d = await page.locator('#depth').boundingBox();
  const s = await page.locator('#steer').boundingBox();
  if (!(d.height > d.width)) fail(`depth is not vertical: ${d.width}x${d.height}`);
  else if (!(s.width > s.height)) fail(`steer is not horizontal: ${s.width}x${s.height}`);
  else ok('depth runs up the page, steer runs across it');

  // 3. each axis names its current value
  if ((await page.locator('#steerOut').innerText()) !== 'Guided') fail('steer does not name its value');
  else ok('the steer axis names where it is');
  await slide('steer', 2);
  if ((await page.locator('#steerOut').innerText()) !== 'Shaped') fail('steer label did not follow the slider');
  else ok('moving the axis renames it');
  await slide('depth', 2);
  if ((await page.locator('#depthOut').innerText()) !== 'Deep') fail('depth label did not follow the slider');
  else ok('the depth axis names where it is');

  // 4. the axes actually change the prompt, and in the expected direction
  const deep = (await text()).split(/\s+/).length;
  await slide('depth', 0);
  const terse = (await text()).split(/\s+/).length;
  if (!(terse < deep)) fail(`depth did not shorten the ask: ${terse} vs ${deep}`);
  else ok('sliding depth down asks for less');

  await slide('steer', 0);
  const native = await text();
  await slide('steer', 2);
  const shaped = await text();
  if (native.length >= shaped.length) fail('steer did not change how much the prompt shapes the answer');
  else ok('sliding steer across changes how much the prompt shapes the answer');

  // 5. depth is live wherever it means something, and locked — visibly — where it doesn't
  await slide('steer', 1);
  if (await page.locator('#depth').isDisabled()) fail('depth locked in Guided, where it says how much you want');
  else ok('depth stays live in Guided, as a want rather than a format');
  await slide('depth', 0);
  if (!/Keep it short/.test(await text())) fail('depth had no effect in Guided: ' + await text());
  else ok('sliding depth in Guided asks for less without dictating the form');
  await slide('depth', 1);

  await slide('steer', 0);
  if (!(await page.locator('#depth').isDisabled())) fail('depth is live in Native where the model decides length');
  else if (!(await page.locator('#depthWrap').isVisible())) fail('depth vanished instead of locking');
  else ok('depth locks — visibly — in Native, where the model owns the length');
  const title = await page.locator('#depthWrap').getAttribute('title');
  if (!/Steer/.test(title || '')) fail('locked axis does not say how to unlock it: ' + title);
  else ok('the locked axis says how to unlock it');
  await slide('steer', 2);
  if (await page.locator('#depth').isDisabled()) fail('depth still locked in Shaped');
  else ok('steering to Shaped unlocks depth');

  // 6. one keystroke, one Tab, a whole ask — the completion is shown in place
  await page.fill('#q', '');
  await page.fill('#q', 'expl');
  await page.waitForTimeout(90);
  const ghost = await page.locator('#ghost').innerText();
  if (!ghost || ghost.length <= 4) fail('no inline completion shown for "expl": ' + JSON.stringify(ghost));
  else if (!ghost.toLowerCase().startsWith('expl')) fail('completion does not continue what was typed: ' + ghost);
  else ok('the rest of the suggestion is shown in place as you type');

  const top = await page.locator('#sug .s-item').first().innerText();
  await page.keyboard.press('Tab');
  await page.waitForTimeout(80);
  const filled = await page.inputValue('#q');
  if (filled.length <= 4) fail('Tab did not complete the ask: ' + filled);
  else if (!top.toLowerCase().includes(filled.toLowerCase())) fail(`Tab took something other than the shown completion: "${filled}" vs "${top}"`);
  else ok('Tab takes the completion that was shown');
  if (!(await text()).length) fail('no prompt built after completing');

  // 7. the completion never lies: it is hidden when it would not fit the box
  await page.fill('#q', '');
  await page.fill('#q', 'a very long thing i am typing that will certainly overflow the input box by now');
  await page.waitForTimeout(90);
  if ((await page.locator('#ghost').innerText()).length) fail('completion still drawn on an overflowing input');
  else ok('the completion hides rather than sit under the wrong letters');

  // 8. arrowing down moves the completion with the selection
  await page.fill('#q', '');
  await page.fill('#q', 'how');
  await page.waitForTimeout(90);
  const g1 = await page.locator('#ghost').innerText();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(60);
  const g2 = await page.locator('#ghost').innerText();
  if (g1 && g2 && g1 === g2) fail('completion did not follow the arrow selection');
  else ok('the completion follows what is selected in the list');

  // 9. what the app remembers about you is visible, switchable and erasable
  await page.evaluate(() => { const t = document.getElementById('tune'); if (t) t.classList.add('open'); });
  if (!(await page.locator('#learn').isVisible())) fail('no control for what the app learns');
  else if ((await page.locator('#learnOut').innerText()) !== 'On') fail('learning switch does not show its state');
  else ok('the learning switch is in plain sight and says where it stands');

  const fresh = await page.locator('#learnnote').innerText();
  if (!/browser/i.test(fresh)) fail('the note does not say where what it learns is kept: ' + fresh);
  else ok('it says up front that what it learns stays in this browser');

  await set('a lentil soup recipe for tonight');
  await page.click('#copy');
  await page.waitForTimeout(120);
  const learned = await page.locator('#learnnote').innerText();
  if (!/Remembers \d+ words/.test(learned)) fail('taking a prompt taught it nothing: ' + learned);
  else ok('taking a prompt is what it learns from');
  if (!(await page.locator('#learnnote button').isVisible())) fail('no way to erase what it remembers');
  else {
    await page.locator('#learnnote button').click();
    await page.waitForTimeout(80);
    if (/Remembers/.test(await page.locator('#learnnote').innerText())) fail('forget did not erase');
    else ok('one click erases everything it remembered');
  }

  await page.click('#learn');
  await page.waitForTimeout(60);
  if ((await page.locator('#learnOut').innerText()) !== 'Off') fail('learning could not be switched off');
  else if (!/nothing about you is stored/i.test(await page.locator('#learnnote').innerText()))
    fail('switching off does not say what it now stores');
  else ok('learning switches off, and says so plainly');

  // and the promise the switch makes is real: no network reachable from the page
  const requests = [];
  page.on('request', r => { if (!r.url().startsWith('file://')) requests.push(r.url()); });
  await page.click('#learn');
  await set('what should i cook for a dinner party');
  await page.click('#copy');
  await page.waitForTimeout(150);
  if (requests.length) fail('the page talked to the network: ' + requests.join(', '));
  else ok('nothing is sent anywhere — the page makes no network request at all');

  if (errors.length) errors.forEach(e => fail('console/page error: ' + e));
  await browser.close();
  console.log(failures ? `\n${failures} FAILURES` : '\nALL PAD TESTS PASSED');
  process.exit(failures ? 1 : 0);
})();
