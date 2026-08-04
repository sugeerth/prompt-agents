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

const L2 = 'Reason as long as you need, then show only the integrated answer and one line of why.';
const L3 = 'Reason as long as you need: weigh 3 approaches against my constraints, then show only the winner, one line of why, and what would flip the call.';
const VERIFY = 'Check the answer once for the most likely error before replying.';

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);
  await page.evaluate(() => { const t = document.getElementById('tune'); if (t) t.classList.add('open'); });
  const text = () => page.locator('#prompt').innerText();
  const metrics = () => page.locator('#metrics').innerText();
  const set = async q => { await page.fill('#q', ''); await page.fill('#q', q); await page.keyboard.press('Escape'); await page.waitForTimeout(50); };

  // 1. adaptive spend: simple asks get NO scaffold (the anti-over-reasoning rule)
  await set('explain gravity');
  let t = await text();
  if (t.includes(L2) || t.includes(L3)) fail('scaffold wrongly added to atomic ask');
  else ok('L0 atomic ask gets no reasoning scaffold');
  if (!(await metrics()).includes('L0 Atomic')) fail('L0 badge missing: ' + await metrics());
  else ok('badge reads L0 Atomic');

  await set('explain machine learning to a beginner');
  t = await text();
  if (t.includes(L2) || t.includes(L3)) fail('scaffold wrongly added to L1 ask');
  else ok('L1 shaped ask gets no scaffold either');

  // 2. composite ask gets the L2 scaffold
  await set('7 day japan itinerary with kids');
  t = await text();
  if (!t.includes(L2)) fail('L2 scaffold missing: ' + t);
  else ok('L2 composite ask gets the decomposition line');
  if (t.includes(L3)) fail('L3 line wrongly present at L2');

  // 3. coupled ask gets the L3 scaffold
  await set('10 days in japan with kids on a tight budget');
  t = await text();
  if (!t.includes(L3)) fail('L3 scaffold missing: ' + t);
  else ok('L3 coupled ask gets the weigh-approaches line');
  if (!(await metrics()).includes('L3 Coupled')) fail('L3 badge missing');
  else ok('badge reads L3 Coupled with metrics: ' + (await metrics()).replace(/\n/g, ' '));

  // 4. every scaffold keeps the working internal (the core promise)
  for (const line of [L2, L3]) {
    if (!/Reason as long as you need/.test(line)) fail('scaffold suppresses reasoning (short-path risk): ' + line);
    if (!/show only/.test(line)) fail('scaffold lacks an output contract: ' + line);
    if (!/one line of why/.test(line)) fail('scaffold lacks a residual justification slot: ' + line);
  }
  ok('both scaffolds grant unlimited reasoning + constrain only the output + keep a why-slot');
  // L1 computational asks get the compressed-chain line; non-computational do not
  await set('what is 18% of 340 plus tax');
  let ct = await text();
  if (!ct.includes('five words each')) fail('computational L1 missing compressed-chain line: ' + ct);
  else ok('computational ask gets the compressed-chain line');
  await set('quick pasta recipe');
  if ((await text()).includes('five words each')) fail('compressed-chain line wrongly added to a recipe');
  else ok('non-computational L1 stays clean');

  // 5. high-stakes domain adds the verification line at L2+
  await set('should i put 20k into index funds or pay off my loan');
  t = await text();
  if (!t.includes(VERIFY)) fail('verify line missing on money domain: ' + t);
  else ok('high-stakes domain adds the verification line');

  // 6. low-stakes domain does NOT add verification
  await set('fun weekend activities with kids on a budget');
  t = await text();
  if (t.includes(VERIFY)) fail('verify line wrongly added to low-stakes ask');
  else ok('low-stakes domain skips verification');

  // 7. mode cycling: auto → always → off
  await set('explain gravity');
  const modes = [];
  for (let i = 0; i < 3; i++) { await page.click('#reason'); modes.push(await page.locator('#reason').innerText()); }
  if (modes.join(',') !== 'Always,Off,Auto') fail('mode cycle wrong: ' + modes.join(','));
  else ok('reasoning mode cycles Auto → Always → Off');

  // 8. "Always" forces a scaffold onto a simple ask
  await page.click('#reason'); // → Always
  await set('explain gravity');
  t = await text();
  if (!t.includes(L2)) fail('Always mode did not force a scaffold: ' + t);
  else ok('Always mode forces reasoning on a simple ask');

  // 9. "Off" removes it everywhere
  await page.click('#reason'); // → Off
  await set('10 days in japan with kids on a tight budget');
  t = await text();
  if (t.includes(L2) || t.includes(L3) || t.includes(VERIFY)) fail('Off mode still added reasoning');
  else ok('Off mode adds nothing');
  if (!(await metrics()).includes('no reasoning spent')) fail('metrics do not report off state');
  else ok('metrics report "no reasoning spent"');
  await page.click('#reason'); // → Auto

  // 10. clicking the scaffold in the prompt turns reasoning off
  await set('10 days in japan with kids on a tight budget');
  await page.locator('#prompt .seg', { hasText: 'Weigh 3 approaches' }).click();
  t = await text();
  if (t.includes(L3)) fail('clicking scaffold did not remove it');
  else ok('clicking the scaffold turns reasoning off');
  if ((await page.locator('#reason').innerText()) !== 'Off') fail('mode button not synced after click');
  else ok('mode button syncs to Off');
  await page.click('#reason'); // back to Auto

  // 11. intent graph opens from the badge
  await set('react vs vue vs svelte for a small team');
  await page.locator('#metrics .cx').click();
  await page.waitForTimeout(80);
  const nodes = await page.locator('#graph svg circle').count();
  if (nodes < 2) fail('intent graph did not render nodes: ' + nodes);
  else ok(`intent graph renders (${nodes} nodes)`);
  const svgOpen = await page.locator('#graph').evaluate(el => el.classList.contains('open'));
  if (!svgOpen) fail('graph container not open');

  // 12. graph escapes hostile input
  await set('<img src=x onerror=window.__x=1> budget kids');
  await page.waitForTimeout(80);
  const xss = await page.evaluate(() => !!window.__x || !!document.querySelector('#graph img'));
  if (xss) fail('XSS via intent graph');
  else ok('intent graph escapes hostile input');

  // 13. reasoning composes with gold prompts
  await page.fill('#q', ''); await page.fill('#q', 'business ideas');
  await page.waitForTimeout(80);
  const items = await page.locator('#sug .s-item').allInnerTexts();
  const gi = items.findIndex(s => s.includes('tuned'));
  if (gi >= 0) {
    await page.locator('#sug .s-item').nth(gi).click();
    t = await text();
    const gold = await page.evaluate(() => window.PS_GOLD.find(g => g.q === 'business ideas'));
    if (gold && !t.includes(gold.p)) fail('gold prompt lost when reasoning active');
    else ok('reasoning composes onto gold prompts without disturbing them');
  }

  // 14. word budget: reasoning spend stays proportional
  const budget = [];
  for (const q of ['explain gravity', '7 day japan itinerary with kids', '10 days in japan with kids on a tight budget']) {
    await set(q);
    budget.push(+(await page.locator('#count').innerText()).split(' ')[0]);
  }
  if (!(budget[0] < budget[1] && budget[1] < budget[2])) fail('spend not monotonic with complexity: ' + budget.join(','));
  else ok('prompt length scales with complexity: ' + budget.join(' → ') + ' words');
  if (budget[2] > 90) fail('L3 prompt too long: ' + budget[2]);

  if (errors.length) errors.forEach(e => fail('console/page error: ' + e));
  await browser.close();
  console.log(failures ? `\n${failures} FAILURES` : '\nALL REASONING TESTS PASSED');
  process.exit(failures ? 1 : 0);
})();
