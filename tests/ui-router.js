/* Eval for the learning router inside the real app.

   router-eval.js proves the module works. This proves the APP uses it, and —
   more importantly — that adding a second thing that remembers you did not
   quietly break the promise the first one makes.

   The app ships one switch and one Forget button, and the footer says "Off —
   nothing about you is stored". Before this suite existed that claim covered
   one storage key. It now covers two, and a claim covering two keys that is
   only enforced by one `setEnabled` call is a claim that is already false on
   somebody's machine. So the coupling is asserted here against the real DOM:
   the switch governs both, Forget erases both, and a returning user who
   switched learning off before the router existed does not get silently
   opted back in by the new key's default.

   Runs in a browser, in seconds. */

const { chromium } = require('playwright');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const URL = 'file://' + path.join(REPO, 'index.html');
const LAUNCH = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};

const PROFILE_KEY = 'ps.profile.v1';
const ROUTER_KEY = 'ps.router.v1';

let failures = 0;
const fail = msg => { failures++; console.log('FAIL:', msg); };
const ok = msg => console.log('  ok:', msg);
const check = (cond, msg) => { if (cond) ok(msg); else fail(msg); };

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);

  /* The axes and the learning switch are not rendered until there is a topic
     to act on — "the first screen is a box" — and the switch lives behind
     Fine-tune. Every interaction below needs the app in that state. */
  async function ready() {
    await page.fill('#q', 'fix my failing build');
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      const t = document.getElementById('tune');
      if (t) t.classList.add('open');
    });
    await page.waitForTimeout(60);
  }
  await ready();

  console.log('== the app loads it ==');
  check(await page.evaluate(() => !!window.PS_ROUTER), 'router.js is loaded by index.html');
  check(await page.evaluate(() => window.PS_ROUTER.ARMS.length === 7),
    'and exposes the seven compositions the UI can express');

  /* ---------------------------------------------------------------- */
  console.log('\n== one switch governs every layer that remembers ==');

  await page.evaluate(() => {
    localStorage.clear();
    window.PS_PROFILE.setEnabled(true);
    window.PS_ROUTER.setEnabled(true);
  });
  await page.reload();
  await ready();

  const bothOn = await page.evaluate(() =>
    window.PS_PROFILE.enabled() && window.PS_ROUTER.enabled());
  check(bothOn, 'both layers start enabled');

  await page.click('#learn');
  const bothOff = await page.evaluate(() => ({
    profile: window.PS_PROFILE.enabled(),
    router: window.PS_ROUTER.enabled(),
    label: document.getElementById('learnOut').textContent,
  }));
  check(!bothOff.profile && !bothOff.router,
    `the switch turns BOTH off, not just the profile (profile=${bothOff.profile}, router=${bothOff.router})`);
  check(bothOff.label === 'Off', 'and the label agrees');

  /* The claim in the UI is about bytes, so check the bytes. */
  const storedWhenOff = await page.evaluate(() => {
    const r = localStorage.getItem('ps.router.v1');
    return { raw: r, parsed: r ? JSON.parse(r) : null };
  });
  check(storedWhenOff.parsed && storedWhenOff.parsed.on === false,
    'the router stores only the fact that the user said no');
  check(!storedWhenOff.raw.includes('"arms"'),
    'and no model data survives alongside that marker');

  await page.click('#learn');
  check(await page.evaluate(() => window.PS_PROFILE.enabled() && window.PS_ROUTER.enabled()),
    'switching back on re-enables both');

  /* ---------------------------------------------------------------- */
  console.log('\n== learning off means the router learns nothing ==');

  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await ready();
  await page.click('#learn');                       // off
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) {
      window.PS_ROUTER.record({ ask: 'fix my failing build', domain: 'code',
                                arm: 'shaped:2', outcome: 'took' });
    }
  });
  check(await page.evaluate(() => window.PS_ROUTER.explain().observations === 0),
    'records are dropped while the switch is off, not buffered for later');

  /* ---------------------------------------------------------------- */
  console.log('\n== Forget everything erases everything ==');

  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await ready();
  await page.evaluate(() => {
    window.PS_PROFILE.observe({ type: 'copy', text: 'sourdough starter hydration', domain: 'cook' });
    for (let i = 0; i < 20; i++) {
      window.PS_ROUTER.record({ ask: 'sourdough starter hydration', domain: 'cook',
                                arm: 'guided:0', outcome: 'took' });
    }
  });
  const before = await page.evaluate(() => ({
    profile: window.PS_PROFILE.summary().tokens,
    router: window.PS_ROUTER.explain().observations,
  }));
  check(before.profile > 0 && before.router > 0, 'both layers have something to forget');

  /* Those records went in through the module API, so the panel has not
     re-rendered and the Forget button is not on screen yet. */
  await page.evaluate(() => { window.__syncLearn(); });
  /* Click the real button a user clicks, not the API behind it. */
  await page.evaluate(() => {
    const b = document.querySelector('#learnnote [data-forget]');
    if (b) b.click();
  });
  const after = await page.evaluate(() => ({
    profile: window.PS_PROFILE.summary().tokens,
    router: window.PS_ROUTER.explain().observations,
    keys: Object.keys(localStorage).filter(k => k.startsWith('ps.')),
  }));
  check(after.profile === 0, 'Forget clears the profile');
  check(after.router === 0, 'Forget clears the router too — one button, everything it knows');
  check(after.keys.length === 0,
    `and removes the keys rather than blanking them (left: ${after.keys.join(', ') || 'none'})`);

  /* ---------------------------------------------------------------- */
  console.log('\n== a user who opted out before this layer existed stays out ==');

  /* Exactly the state such a user is in: a profile marked off, and no router
     key at all, because the router did not exist when they chose. A fresh
     router defaults to ON, so without the reconcile at boot this is where
     they get silently opted back in. */
  await page.evaluate((pk) => {
    localStorage.clear();
    localStorage.setItem(pk, '{"v":1,"on":false}');
  }, PROFILE_KEY);
  await page.reload();
  await ready();

  const reconciled = await page.evaluate(() => ({
    profile: window.PS_PROFILE.enabled(),
    router: window.PS_ROUTER.enabled(),
    label: document.getElementById('learnOut').textContent,
  }));
  check(reconciled.profile === false, 'their profile is still off after the upgrade');
  check(reconciled.router === false,
    'and the new router is off too — the switch they set wins over the new key\'s default');
  check(reconciled.label === 'Off', 'the UI shows Off, and it is telling the truth');

  /* ---------------------------------------------------------------- */
  console.log('\n== it steers the axes, but only once it has evidence ==');

  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await ready();

  const silent = await page.evaluate(() =>
    window.PS_ROUTER.offer('fix my failing build', 'code') === null);
  check(silent, 'a fresh install offers nothing and the app keeps its own default');

  await page.evaluate(() => {
    for (let i = 0; i < 14; i++) {
      window.PS_ROUTER.record({ ask: 'fix my failing build', domain: 'code',
                                arm: 'shaped:2', outcome: 'took' });
    }
  });
  const offer = await page.evaluate(() => window.PS_ROUTER.offer('fix my failing build', 'code'));
  check(offer && offer.steer === 'shaped' && offer.depth === 2,
    `once there is evidence it offers a real composition (${offer ? offer.arm : 'null'})`);
  check(['native', 'guided', 'shaped'].includes(offer.steer) && offer.depth >= 0 && offer.depth <= 2,
    'and only ever one the UI can actually open on');

  /* The whole point of the layer: the axes move. */
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await ready();
  await page.evaluate(() => {
    for (let i = 0; i < 14; i++) {
      window.PS_ROUTER.record({ ask: 'fix my failing build', domain: 'code',
                                arm: 'shaped:2', outcome: 'took' });
    }
  });
  /* applyRemembered() only fires when the detected domain CHANGES, so the ask
     has to cross a domain boundary and come back — ready() already left the
     topic sitting in 'code'. */
  await page.fill('#q', 'sourdough starter hydration');
  await page.waitForTimeout(250);
  await page.fill('#q', 'fix my failing build');
  await page.waitForTimeout(350);
  const axes = await page.evaluate(() => ({
    depth: document.getElementById('depth').value,
    steer: document.getElementById('steerOut').textContent,
  }));
  check(axes.steer === 'Shaped' && axes.depth === '2',
    `typing a learned ask opens the axes where the user leaves them (steer=${axes.steer}, depth=${axes.depth})`);

  /* ---------------------------------------------------------------- */
  console.log('\n== no errors on any of that ==');
  check(errors.length === 0, `clean console${errors.length ? ' — ' + errors.slice(0, 3).join(' | ') : ''}`);

  await browser.close();
  console.log('─'.repeat(58));
  if (failures) { console.log(`\nFAILED: ${failures} check(s)`); process.exit(1); }
  console.log('\nPASSED: all checks');
  process.exit(0);
})();
