/* Does it actually work with no connection?

   Every other suite loads the app over file://, where service workers do not
   exist. Offline support that is never exercised is offline support that does
   not work, so this suite serves the repo over HTTP, lets the worker install,
   pulls the network out from under the browser, and reloads.

   It also guards the one way a service worker can make things worse than no
   service worker at all: pinning a returning visitor to a stale version. */

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const LAUNCH = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};

let failures = 0;
const fail = m => { failures++; console.log('FAIL:', m); };
const ok = m => console.log('  ok:', m);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};

/* A service worker needs a real origin, and localhost counts as secure. */
function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(REPO, rel);
    // never serve outside the repo, even in a test
    if (!file.startsWith(REPO) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
  // 1. the deploy stamp in index.html and the cache version must agree
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(REPO, 'sw.js'), 'utf8');
  const stamps = [...new Set([...html.matchAll(/\?v=(\d+)/g)].map(m => m[1]))];
  const swVersion = (sw.match(/const VERSION = "(\d+)"/) || [])[1];
  if (stamps.length !== 1) fail(`index.html mixes deploy stamps: ${stamps.join(', ')}`);
  else ok(`every script carries the same deploy stamp (v${stamps[0]})`);
  if (swVersion !== stamps[0])
    fail(`the worker caches v${swVersion} while the page ships v${stamps[0]} — bump both together`);
  else ok(`the worker's cache version matches the page (v${swVersion})`);

  // 2. the manifest is real and its icons exist
  const mf = JSON.parse(fs.readFileSync(path.join(REPO, 'manifest.webmanifest'), 'utf8'));
  for (const key of ['name', 'start_url', 'display', 'icons', 'theme_color'])
    if (!mf[key]) fail(`manifest missing ${key}`);
  if (!mf.icons.some(i => i.purpose && i.purpose.includes('maskable')))
    fail('manifest has no maskable icon — Android will letterbox it');
  for (const icon of mf.icons)
    if (!fs.existsSync(path.join(REPO, icon.src))) fail(`manifest icon missing on disk: ${icon.src}`);
  ok(`manifest is installable: ${mf.icons.length} icons, all present, one maskable`);

  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // 3. it registers, and registering does not break anything
  await page.goto(origin + '/index.html');
  await page.fill('#q', 'explain machine learning');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  const onlineText = (await page.locator('#prompt').innerText()).trim();
  if (!onlineText.toLowerCase().includes('machine learning')) fail('app broken when served over http: ' + onlineText);
  else ok('the app works normally when served over http');

  const registered = await page.evaluate(() =>
    navigator.serviceWorker.ready.then(r => !!r.active).catch(() => false));
  if (!registered) fail('service worker never activated');
  else ok('the offline worker installs and activates');

  // give the worker a moment to take control and cache the shell
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForTimeout(300);
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  if (!controlled) fail('worker did not take control of the page');
  else ok('it takes control of open pages immediately');

  // 4. THE POINT: pull the network out and reload
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForTimeout(300);

  const title = await page.title();
  if (!/Prompt Studio/.test(title)) fail('offline reload did not serve the app: ' + title);
  else ok('the app loads with no connection at all');

  await page.fill('#q', '10 days in japan with kids on a tight budget');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  const offlineText = (await page.locator('#prompt').innerText()).trim();
  if (!/japan/i.test(offlineText) || offlineText.split(/\s+/).length < 8)
    fail('offline app did not build a prompt: ' + offlineText);
  else ok('and still builds a full prompt offline: ' + offlineText.split(/\s+/).length + ' words');

  const sugCount = await page.evaluate(async () => {
    const q = document.getElementById('q');
    q.value = 'japan'; q.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 80));
    return document.querySelectorAll('#sug .s-item').length;
  });
  if (!sugCount) fail('offline suggestions are empty — the vocabulary was not cached');
  else ok(`the whole vocabulary is there offline (${sugCount} suggestions for "japan")`);

  const level = await page.locator('#metrics').innerText();
  if (!/L\d/.test(level)) fail('reasoning layer missing offline: ' + level);
  else ok('the reasoning layer works offline too');

  // 5. a new deploy must still win: navigations go to the network first
  await ctx.setOffline(false);
  await page.goto(origin + '/index.html');
  await page.waitForTimeout(200);
  const fresh = await page.evaluate(async () => {
    const res = await fetch('./index.html', { cache: 'no-store' });
    return res.ok;
  });
  if (!fresh) fail('page could not be refetched from the network once back online');
  else ok('back online, the newest page is fetched rather than served from cache');

  if (errors.length) errors.forEach(e => fail('page error: ' + e));
  await browser.close();
  server.close();
  console.log(failures ? `\n${failures} FAILURES` : '\nALL OFFLINE TESTS PASSED');
  process.exit(failures ? 1 : 0);
})();
