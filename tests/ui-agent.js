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
  await page.evaluate(() => { const t = document.getElementById('tune'); if (t) t.classList.add('open'); });

  const text = () => page.locator('#prompt').innerText();
  const metrics = () => page.locator('#metrics').innerText();
  const set = async q => { await page.fill('#q', ''); await page.fill('#q', q); await page.keyboard.press('Escape'); await page.waitForTimeout(60); };
  const steer = async mode => { while ((await page.locator('#steer').innerText()) !== mode) await page.click('#steer'); await page.waitForTimeout(40); };

  // 1. a delegated task is recognized as hand-off, not instructions
  await set('set up ci for my repo');
  if (!(await metrics()).includes('wants: hand it off')) fail('delegate not recognized: ' + await metrics());
  else ok('a delegated task reads as "hand it off"');

  // 2. ...and the same topic asked as a how-to stays do-it-myself
  await set('how to set up a home network');
  if ((await metrics()).includes('hand it off')) fail('how-to wrongly read as delegation');
  else ok('a how-to still reads as do-it-myself');

  // 3. Guided carries the delegation intent line
  await set('automate my weekly report');
  if (!(await text()).includes('I want the result, not instructions'))
    fail('delegation intent line missing: ' + await text());
  else ok('Guided states the delegation goal');

  // 4. Shaped builds the full agent harness: plan, verify, safety, report
  await steer('Shaped');
  await set('migrate my database end to end');
  const t = await text();
  for (const [what, re] of [
    ['mission framing', /^Mission:/],
    ['a verifiable end state', /Done when:/],
    ['plan-first', /Plan first:/],
    ['ground rules with a destructive guard', /Ground rules:.*destructive|irreversible/i],
    ['explicit verification', /Verify:/],
    ['a completion report', /Report:/],
  ]) {
    if (!re.test(t)) fail(`brief missing ${what}: ${t}`);
  }
  ok('delegated asks build a mission brief: Mission → Done when → Plan → Rules → Verify → Report');

  // 5. depth scales the harness: TL;DR stays terse, Deep adds stop rules + checkpoints
  await page.locator('#depth').fill('0');
  await page.locator('#depth').dispatchEvent('input');
  const d0 = await text();
  if (/blocked twice|checkpoint/i.test(d0)) fail('TL;DR harness over-specified: ' + d0);
  else ok('TL;DR harness stays terse');
  await page.locator('#depth').fill('2');
  await page.locator('#depth').dispatchEvent('input');
  const d2 = await text();
  if (!/blocked twice/i.test(d2) || !/checkpoint/i.test(d2)) fail('Deep harness missing stop rules/checkpoints: ' + d2);
  else ok('Deep harness adds checkpoints and stop rules');
  await page.locator('#depth').fill('1');
  await page.locator('#depth').dispatchEvent('input');

  // 6. agent chips exist and compose
  await steer('Guided');
  await set('set up ci for my repo');
  await page.locator('#chips .chip', { hasText: '+ more' }).click().catch(() => {});
  for (const [id, snippet] of [['planfirst', 'wait for my OK'], ['showproof', 'proves success'], ['scopeguard', "only what's asked"]]) {
    const chip = page.locator(`#chips .chip[data-id="${id}"]`);
    if (await chip.count() !== 1) { fail(`agent chip ${id} missing`); continue; }
    await chip.click();
    if (!(await text()).includes(snippet)) fail(`chip ${id} did not append`);
    await chip.click();
  }
  ok('agent chips (Plan first, Show proof, Scope guard) compose onto the prompt');

  // 6b. the harness specializes by task class: each class names its own proof
  let classesOK = true;
  for (const [q, snippet, cls] of [
    ['migrate my database schema', 'count or checksum', 'data'],
    ['keep my prs green', "what you'll check, how often", 'ongoing/ops'],
    ['clean up my downloads folder', 'dry run first', 'files'],
    ['refactor my codebase', 'paste the output that proves it passes', 'code'],
  ]) {
    await set(q);
    if (!(await text()).includes(snippet)) { fail(`class ${cls} line missing on "${q}": ` + await text()); classesOK = false; }
  }
  if (classesOK) ok('harness specializes: data backs up, ops sets cadence, files dry-run, code proves tests');

  // 6c. the class line survives Native — it is a safety precondition, not formatting
  await steer('Native');
  await set('migrate my database schema');
  if (!(await text()).includes('Back up first')) fail('class precondition lost in Native: ' + await text());
  else ok('class preconditions survive Native');
  await steer('Guided');

  // 7. the brief's explicit Verify line replaces the generic one — no duplication
  await set('migrate my database then update the api then notify the team');
  if ((await text()).includes('Check the answer once')) fail('generic verify line duplicates the brief');
  else ok('no duplicate generic verify line on agent asks');
  if (!(await text()).includes('Verify:')) fail('brief Verify line missing on complex agent ask');
  else ok('the brief carries its own Verify line');

  // 6d. the harness is generic: everyday hand-offs get class-appropriate briefs
  let genOK = true;
  for (const [q, snippet, cls] of [
    ['book a plumber to fix my sink', 'never spend or cancel without my explicit OK', 'purchase/booking'],
    ['research the best health insurance for me', 'source', 'research'],
    ['reach out to vendors and schedule tastings for my wedding', 'never send on my behalf', 'outreach'],
    ['renew my car registration for me', 'price and terms before committing', 'purchase/renewal'],
  ]) {
    await set(q);
    const bt2 = await text();
    if (!bt2.startsWith('Mission:')) { fail(`generic hand-off "${q}" did not build a brief: ` + bt2); genOK = false; }
    if (!bt2.includes(snippet)) { fail(`class ${cls} guard missing on "${q}": ` + bt2); genOK = false; }
  }
  if (genOK) ok('everyday hand-offs (plumber, insurance, vendors, renewals) get class-appropriate briefs');

  // 7b. the brief consumes the reasoning layer: milestones, auto-rigor, watch-out
  await set('set up the database then deploy the api then configure monitoring for my repo');
  if (!(await text()).includes('Plan first:') || !(await text()).includes('→'))
    fail('graph milestones missing from plan: ' + await text());
  else ok("the graph's critical path becomes the brief's plan");
  await set('migrate my database balancing speed against safety on a tight budget');
  let bt = await text();
  if (!bt.includes('blocked twice')) fail('L3 coupled ask did not auto-escalate rigor: ' + bt);
  else ok('a coupled hand-off earns stop rules at Standard depth on its own');
  if (!bt.includes('Watch out:')) fail('cycle not surfaced as Watch out: ' + bt);
  else ok("Tarjan's cycle becomes a Watch-out line");
  if (bt.includes('Reason as long as you need')) fail('generic scaffold duplicates the brief');
  else ok('the brief absorbs the reasoning — no generic scaffold appended');

  // 8. gold cache serves agent tasks as ★ suggestions
  await page.fill('#q', ''); await page.fill('#q', 'set up ci');
  await page.waitForTimeout(80);
  const items = await page.locator('#sug .s-item').allInnerTexts();
  if (!items.some(s => s.includes('★ tuned'))) fail('no gold agent suggestion for "set up ci": ' + items.join(' | '));
  else ok('agent gold prompts surface as ★ tuned suggestions');

  if (errors.length) errors.forEach(e => fail('console/page error: ' + e));
  await browser.close();
  console.log(failures ? `\n${failures} FAILURES` : '\nALL AGENT TESTS PASSED');
  process.exit(failures ? 1 : 0);
})();
