const { chromium } = require('playwright');

const path = require('path');
const REPO = path.resolve(__dirname, '..');
const URL = 'file://' + path.join(REPO, 'goodhart.html');
const LAUNCH = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};

let failures = 0;
const fail = m => { failures++; console.log('FAIL:', m); };
const ok = m => console.log('  ok:', m);

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);

  // 1. four tabs in plain language, each carrying its formal name
  const tabs = await page.locator('.tab').allInnerTexts();
  const plain = tabs.map(t => t.split('\n')[0]).join(',');
  if (plain !== 'The lucky win,Off the chart,Coached')
    fail('plain tab names wrong: ' + plain);
  else ok('tabs speak plain language');
  const acs = tabs.join(' ').toLowerCase();
  for (const term of ['regressional', 'extremal', 'causal']) {
    if (!acs.includes(term)) fail('tab missing formal name: ' + term);
  }
  ok("each tab still carries the paper's formal name");

  // 2. the simulation renders points on every variant
  for (let i = 0; i < 3; i++) {
    await page.locator('.tab').nth(i).click();
    await page.waitForTimeout(60);
    const dots = await page.locator('#chart circle').count();
    if (dots < 100) fail(`variant ${tabs[i]}: only ${dots} points rendered`);
  }
  ok('every variant renders its scatter');

  // 3. the core lesson is enacted: optimizing harder widens the proxy/true gap
  await page.locator('.tab').nth(2).click();          // coached, the starkest remaining
  const gapAt = async v => {
    await page.locator('#pressure').fill(String(v));
    await page.locator('#pressure').dispatchEvent('input');
    await page.waitForTimeout(60);
    const u = parseFloat(await page.locator('#proxynum').innerText());
    const t = parseFloat(await page.locator('#truenum').innerText());
    return u - t;
  };
  const gentle = await gapAt(5), hard = await gapAt(95);
  if (!(hard > gentle)) fail(`gap did not widen with pressure: gentle=${gentle} hard=${hard}`);
  else ok(`optimizing harder widens the gap (${gentle.toFixed(0)} → ${hard.toFixed(0)} points)`);
  if (!(hard >= 15)) fail('hard optimization did not produce a stark divergence: ' + hard);
  else ok('hard optimization diverges starkly');

  // 4. the verdict tracks the gap
  const verdict = await page.locator('#verdict').innerText();
  if (!/measure has become the target|starting to flatter/.test(verdict))
    fail('verdict did not flag the divergence: ' + verdict);
  else ok('verdict flags the divergence in plain words');

  // 5. the paper's full taxonomy stays documented even though only three are simulated
  const html = await page.content();
  if (!/Adversarial Goodhart/.test(html)) fail('adversarial variant no longer documented');
  else ok('all four variants of the paper remain documented');
  if (!html.includes('arxiv.org/abs/1803.04585')) fail('missing arXiv citation');
  else ok('cites Manheim & Garrabrant (arXiv 1803.04585)');
  if (!/Goodhart, C\. A\. E\. \(1975\)/.test(html)) fail('missing Goodhart 1975 citation');
  else ok('cites Goodhart 1975');

  // 6. the app links here and this page links back
  if (!html.includes('href="./"')) fail('no link back to the app');
  else ok('links back to Prompt Studio');
  const appPage = await browser.newPage();
  await appPage.goto('file://' + path.join(REPO, 'index.html'));
  const appHtml = await appPage.content();
  if (!appHtml.includes('goodhart.html')) fail('app footer does not link to the Goodhart page');
  else ok('app footer links to this page');

  if (errors.length) errors.forEach(e => fail('console/page error: ' + e));
  await browser.close();
  console.log(failures ? `\n${failures} FAILURES` : '\nALL GOODHART TESTS PASSED');
  process.exit(failures ? 1 : 0);
})();
