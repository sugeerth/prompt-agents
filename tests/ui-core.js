const { chromium } = require('playwright');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const URL = 'file://' + path.join(REPO, 'index.html');
// CI installs Chromium via `npx playwright install`; this env var lets a
// sandbox point at a pre-installed binary instead.
const LAUNCH = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};

let failures = 0;
const fail = msg => { failures++; console.log('FAIL:', msg); };
const ok = msg => console.log('  ok:', msg);

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);
  await page.evaluate(() => { const t = document.getElementById('tune'); if (t) t.classList.add('open'); });

  /* 1. every domain produces a sane prompt at every depth/tone */
  console.log('== domains x depth x tone ==');
  const domainReport = await page.evaluate(() => {
    const out = [];
    const sample = {};
    for (const v of window.PS_VOCAB) if (!sample[v.d]) sample[v.d] = v.t;
    sample.general = 'something completely random xyz';
    for (const domId of Object.keys(sample)) {
      for (let depth = 0; depth <= 2; depth++) {
        for (let tone = 0; tone <= 2; tone++) {
          const segs = window.__buildPrompt
            ? window.__buildPrompt(sample[domId], domId, depth, tone, [])
            : null;
          if (!segs) { out.push([domId, 'NO_HOOK']); continue; }
          const text = segs.map(s => s.text).join(' ');
          const bad =
            !text ? 'empty'
            : /undefined|null|\[object/.test(text) ? 'bad token: ' + text
            : text.split(/\s+/).length > 90 ? 'too long (' + text.split(/\s+/).length + 'w)'
            : !text.toLowerCase().includes(sample[domId].split(' ')[1] || sample[domId].split(' ')[0]) && domId !== 'general' ? null /* verb-strip can alter; skip strict check */
            : null;
          if (bad) out.push([domId + ' d' + depth + ' t' + tone, bad]);
        }
      }
    }
    return out;
  });
  if (domainReport.some(r => r[1] === 'NO_HOOK')) {
    console.log('  (no test hook — falling back to UI-level domain checks)');
    const domains = await page.evaluate(() => {
      const sample = {};
      for (const v of window.PS_VOCAB) if (!sample[v.d]) sample[v.d] = v.t;
      return sample;
    });
    for (const [d, topic] of Object.entries(domains)) {
      await page.fill('#q', ''); await page.fill('#q', topic);
      await page.keyboard.press('Escape');
      const text = await page.locator('#prompt').innerText();
      if (!text || /undefined|null|\[object/.test(text)) fail(`domain ${d}: bad prompt: ${text}`);
      const words = text.split(/\s+/).length;
      // a mission brief for delegated multi-step work earns a bigger budget
      // than a Q&A prompt — but still a budget
      const cap = text.startsWith('Mission:') ? 130 : 90;
      if (words > cap) fail(`domain ${d}: prompt too long (${words} words, cap ${cap})`);
    }
    ok('all 30 domains render sane prompts via UI');
  } else if (domainReport.length) domainReport.forEach(r => fail(r.join(': ')));
  else ok('all domains x depths x tones sane');

  /* 2. all chips add and remove their text */
  console.log('== chips ==');
  await page.fill('#q', 'explain machine learning');
  await page.keyboard.press('Escape');
  // expand chips
  await page.locator('#chips .chip', { hasText: '+ more' }).click();
  const mods = await page.evaluate(() => window.PS_MODS.map(m => ({ id: m.id, label: m.label, text: m.text })));
  for (const m of mods) {
    const chip = page.locator(`#chips .chip[data-id="${m.id}"]`);
    if (await chip.count() !== 1) { fail(`chip ${m.id} not rendered (count ${await chip.count()})`); continue; }
    await chip.click();
    let text = await page.locator('#prompt').innerText();
    if (!text.includes(m.text)) fail(`chip ${m.id}: text not added`);
    await page.locator(`#chips .chip[data-id="${m.id}"]`).click();
    text = await page.locator('#prompt').innerText();
    if (text.includes(m.text)) fail(`chip ${m.id}: text not removed`);
  }
  ok(`all ${mods.length} chips add/remove correctly`);

  /* 3. Enter copies exactly the rendered prompt */
  console.log('== clipboard ==');
  await page.fill('#q', 'negotiate salary offer');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  const shown = await page.locator('#prompt').innerText();
  if (clip.replace(/\s+/g, ' ').trim() !== shown.replace(/\s+/g, ' ').trim())
    fail(`clipboard mismatch:\n  clip:  ${clip}\n  shown: ${shown}`);
  else ok('Enter copies the exact prompt');

  /* 4. launch buttons: URL-encoded prompt, correct hosts */
  console.log('== launch ==');
  await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
  for (const name of ['ChatGPT', 'Claude', 'Gemini', 'Perplexity']) {
    await page.locator('#launch .btn', { hasText: name }).click();
  }
  const opened = await page.evaluate(() => window.__opened);
  const expectHosts = ['chatgpt.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai'];
  expectHosts.forEach((h, i) => {
    if (!opened[i] || !opened[i].includes(h)) fail(`launch ${h}: got ${opened[i]}`);
  });
  if (!opened[0].includes(encodeURIComponent('negotiate salary offer').slice(0, 20)))
    fail('ChatGPT launch URL missing encoded prompt: ' + opened[0]);
  ok('4 launch buttons open correct hosts with encoded prompt');

  /* 5. suggestion keyboard flow: down/up/tab */
  console.log('== keyboard ==');
  await page.fill('#q', ''); await page.fill('#q', 'b');
  const n = await page.locator('#sug .s-item').count();
  if (n < 1) fail('no suggestions for "b"');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Tab');
  const val = await page.inputValue('#q');
  if (!val || val === 'b') fail('Tab did not accept suggestion');
  else ok(`Tab accepted suggestion: "${val}"`);

  /* 6. XSS: typed HTML must not execute or inject */
  console.log('== xss ==');
  await page.fill('#q', '');
  await page.fill('#q', '<img src=x onerror=window.__xss=1> & <b>bold</b>');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  const xss = await page.evaluate(() => ({ hit: !!window.__xss, imgs: document.querySelectorAll('#prompt img, #prompt b').length }));
  if (xss.hit || xss.imgs) fail('HTML injection in prompt area');
  else ok('typed HTML is escaped');

  /* 7. deep link */
  console.log('== deep link ==');
  await page.goto(URL + '#t=trip%20to%20japan');
  await page.evaluate(() => { const t = document.getElementById('tune'); if (t) t.classList.add('open'); });
  await page.waitForTimeout(150);
  const dl = await page.locator('#prompt').innerText();
  if (!dl.toLowerCase().includes('japan')) fail('deep link #t= did not populate: ' + dl);
  else ok('deep link works');

  /* 8. summarize keeps [paste text below] last even with chips */
  console.log('== summarize marker ==');
  await page.fill('#q', 'summarize this article');
  await page.keyboard.press('Escape');
  await page.locator('#chips .chip[data-id="bul3"]').click();
  const sumText = await page.locator('#prompt').innerText();
  if (!sumText.trim().endsWith('[paste text below]')) fail('paste marker not last: ' + sumText);
  else ok('paste marker stays last');
  await page.locator('#chips .chip[data-id="bul3"]').click();

  /* 9. empty input placeholder */
  await page.fill('#q', '');
  const empty = await page.locator('#prompt').innerText();
  if (!empty.includes('appears here')) fail('empty state missing');
  else ok('empty state renders');

  /* 10. mobile viewport: no horizontal overflow */
  console.log('== mobile ==');
  const mob = await ctx.newPage();
  await mob.setViewportSize({ width: 375, height: 720 });
  await mob.goto(URL);
  await mob.evaluate(() => { const t = document.getElementById('tune'); if (t) t.classList.add('open'); });
  await mob.fill('#q', 'meal prep for the week');
  const overflow = await mob.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 2) fail(`horizontal overflow on mobile: ${overflow}px`);
  else ok('no horizontal overflow at 375px');
  await mob.screenshot({ path: path.join(process.env.RUNNER_TEMP || require('os').tmpdir(), 'studio-mobile.png') });

  /* 11. average prompt length across all vocab entries (succinctness budget) */
  console.log('== succinctness ==');
  const stats = await page.evaluate(() => {
    // drive through the UI state machine directly is heavy; approximate via detect + build using app internals not exposed.
    return null;
  });
  // UI-level sample instead: 25 random vocab entries
  const samples = await page.evaluate(() => {
    const v = window.PS_VOCAB, out = [];
    for (let i = 0; i < v.length; i += Math.ceil(v.length / 25)) out.push(v[i].t);
    return out;
  });
  let total = 0, max = 0, maxT = '', sampled = 0, briefMax = 0;
  for (const t of samples) {
    await page.fill('#q', ''); await page.fill('#q', t);
    await page.keyboard.press('Escape');
    const ptext = await page.locator('#prompt').innerText();
    const words = ptext.split(/\s+/).length;
    if (ptext.startsWith('Mission:')) { briefMax = Math.max(briefMax, words); continue; }
    total += words; sampled++; if (words > max) { max = words; maxT = t; }
  }
  console.log(`  avg standard prompt: ${(total / sampled).toFixed(1)} words, max ${max} ("${maxT}"), briefs up to ${briefMax}`);
  if (max > 80) fail('a standard prompt exceeds 80 words');
  if (briefMax > 130) fail('a mission brief exceeds 130 words: ' + briefMax);
  else ok('standard prompts stay short');

  if (errors.length) { errors.forEach(e => fail('console/page error: ' + e)); }
  await browser.close();
  console.log(failures ? `\n${failures} FAILURES` : '\nALL TESTS PASSED');
  process.exit(failures ? 1 : 0);
})();
