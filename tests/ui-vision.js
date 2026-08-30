/* Asking a model about a picture you attached.

   The app already had a domain for WRITING image prompts; this covers the
   opposite — reading, identifying, transcribing or judging an image the user
   supplies. Two things here are not ordinary quality checks:

   The grounding line. A vision model's characteristic failure is not refusing,
   it is describing something plausible that is not in the picture. Every
   vision prompt has to push against that.

   The safety ceilings. "Is this mushroom safe to eat" and "is this mole
   cancerous" are among the most common things people photograph and ask about,
   and a confident wrong answer to either is genuinely dangerous. A photo
   cannot establish that food is safe or that a lesion is benign, and the
   prompt has to say so. These asserts exist so that stays true. */

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
  const page = await browser.newPage({ viewport: { width: 1150, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);

  const text = () => page.locator('#prompt').innerText();
  const set = async q => {
    await page.fill('#q', ''); await page.fill('#q', q);
    await page.keyboard.press('Escape'); await page.waitForTimeout(70);
    return (await text()).trim();
  };
  const slide = async (id, v) => {
    await page.locator('#' + id).fill(String(v));
    await page.locator('#' + id).dispatchEvent('input');
    await page.waitForTimeout(50);
  };

  // 1. an ask about a picture is recognized as one
  let recognized = true;
  for (const q of ['read this receipt', 'what is this plant', 'explain this chart',
                   'alt text for this image', 'critique this photo', 'translate this sign',
                   'what breed is this dog', 'what does this error say']) {
    const t = await set(q);
    if (!/image I've attached/.test(t)) { fail(`"${q}" was not read as an ask about a picture: ${t}`); recognized = false; }
  }
  if (recognized) ok('asks about a picture are recognized across reading, identifying, judging and explaining');

  // 2. ...and asking for a picture to be MADE still is not
  let generation = true;
  for (const q of ['logo for a coffee van', 'image of a cat in space', 'poster for a jazz night']) {
    const t = await set(q);
    if (/image I've attached/.test(t)) { fail(`"${q}" is a request to generate, not to look: ${t}`); generation = false; }
    if (!/image-generation prompt/.test(t)) fail(`"${q}" lost the generation framing: ${t}`);
  }
  if (generation) ok('asking for an image to be made is still generation, not vision');

  // 3. THE grounding line — the one instruction that most improves a vision answer
  const grounded = await set('what is in this photo');
  if (!/Work only from what's actually in the image/.test(grounded) || !/say so instead of guessing/.test(grounded))
    fail('no grounding against describing what is not there: ' + grounded);
  else ok('every vision prompt refuses to describe what is not visible');

  // and it is a precondition, so it survives the level that strips everything
  await slide('steer', 0);
  const native = await set('what is in this photo');
  if (!/Work only from what's actually in the image/.test(native))
    fail('grounding lost in Native, where it is content rather than form: ' + native);
  else ok('the grounding survives Native — it is content, not formatting');
  if (!/\[attach the image\]/.test(native))
    fail('no attach reminder in Native: ' + native);
  else ok('and the attach reminder is there too, in every mode');
  await slide('steer', 1);

  // 4. SAFETY: a photograph cannot establish that food is safe to eat
  const shroom = await set('is this mushroom safe to eat');
  if (!/Never confirm from a photo that something is safe to eat/.test(shroom))
    fail('DANGEROUS: no ceiling on edibility from a photo: ' + shroom);
  else ok('edibility: the prompt refuses to confirm anything is safe to eat from a photo');
  if (!/lookalikes/.test(shroom)) fail('edibility: dangerous lookalikes not named: ' + shroom);
  else ok('edibility: it names the dangerous lookalikes and defers to an expert in person');
  for (const q of ['is this berry edible', 'can i eat this mushroom i found']) {
    const t = await set(q);
    if (/safe to eat/.test(t) && !/Never confirm/.test(t))
      fail(`DANGEROUS: "${q}" has no edibility ceiling: ${t}`);
  }

  // 5. SAFETY: a photograph is not a diagnosis, and must not reassure
  const mole = await set('is this mole cancerous');
  if (!/photo cannot diagnose/i.test(mole)) fail('DANGEROUS: no medical ceiling: ' + mole);
  else ok('medical: the prompt states plainly that a photo cannot diagnose');
  if (!/do not reassure me/i.test(mole)) fail('medical: nothing prevents false reassurance: ' + mole);
  else ok('medical: and explicitly forbids false reassurance');
  if (!/clinician|doctor/i.test(mole)) fail('medical: no referral to a real clinician: ' + mole);

  // 6. each kind of vision ask names the proof that fits it
  let classes = true;
  for (const [q, snippet, kind] of [
    ['read this receipt', '[unclear]', 'transcription marks what it cannot read'],
    ['explain this chart', "isn't legible", 'chart reading refuses to estimate'],
    ['what is this bug', 'could plausibly be', 'identification lists the alternatives'],
    ['alt text for this image', 'not an inventory', 'alt text conveys purpose'],
    ['is this text a scam', 'specific visible signs', 'scam checks point at evidence'],
    ['critique this photo', 'actually visible in the image', 'critique stays tied to the image'],
  ]) {
    const t = await set(q);
    if (!t.includes(snippet)) { fail(`${kind}: missing on "${q}": ${t}`); classes = false; }
  }
  if (classes) ok('each kind of vision ask names the proof that fits it');

  // 7. the reminder to actually attach something
  await slide('steer', 2);
  const shaped = await set('read this receipt');
  if (!/\[attach the image\]/.test(shaped)) fail('no attach reminder: ' + shaped);
  else ok('the prompt ends by reminding you to attach the image');
  if (!/\[attach the image\]\s*$/.test(shaped)) fail('attach reminder is not last: ' + shaped);
  else ok('and the reminder is the last thing, where it belongs');

  // 7b. more than one picture is not "the image"
  const many = await set('compare these two photos');
  if (!/images I've attached/.test(many)) fail('a two-image ask says "the image": ' + many);
  else if (!/\[attach the images\]/.test(many)) fail('plural ask still asks for one image: ' + many);
  else ok('an ask about several pictures says images, and asks for all of them');

  // 8. depth still means something here
  const lens = [];
  for (const d of [0, 1, 2]) { await slide('depth', d); lens.push((await text()).trim().split(/\s+/).length); }
  if (!(lens[0] < lens[2])) fail('depth does nothing on a vision ask: ' + lens.join(','));
  else ok(`depth scales a vision ask: ${lens.join(' → ')} words`);
  await slide('depth', 1);
  await slide('steer', 1);

  // 9. it stays inside the app's word budget
  const long = [];
  for (const q of ['read this receipt', 'what is this plant', 'is this mushroom safe to eat',
                   'explain this chart', 'critique this photo']) {
    const n = (await set(q)).split(/\s+/).length;
    if (n > 80) long.push(`${q} (${n}w)`);
  }
  if (long.length) fail('vision prompts over budget: ' + long.join(', '));
  else ok('vision prompts stay inside the budget, safety lines included');

  // 10. and it composes with everything else the app does
  await set('what is this plant');
  await page.click('#chainadd');
  await page.waitForTimeout(80);
  const step2 = await set('how do i care for it');
  if (!/Step 1 asked/.test(step2)) fail('a vision ask cannot be chained: ' + step2);
  else ok('a vision ask chains like any other');

  if (errors.length) errors.forEach(e => fail('console/page error: ' + e));
  await browser.close();
  console.log(failures ? `\n${failures} FAILURES` : '\nALL VISION TESTS PASSED');
  process.exit(failures ? 1 : 0);
})();
