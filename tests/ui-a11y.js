/* Can someone actually use this without a mouse, or without seeing it?

   An audit found the mouse path fine and the other two broken at exactly the
   points the product is about: choosing a suggestion, and knowing a prompt
   exists. Accessibility regressions are silent — nothing throws, nothing looks
   wrong to the person who wrote it — so the fixes need a test or they will rot.

   Everything here is checked against the real rendered page: the accessibility
   tree, computed styles, and measured geometry. */

const { chromium } = require('playwright');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const URL = 'file://' + path.join(REPO, 'index.html');
const LAUNCH = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};

let failures = 0;
const fail = m => { failures++; console.log('FAIL:', m); };
const ok = m => console.log('  ok:', m);

/* WCAG relative luminance, so contrast claims are computed rather than eyeballed. */
const lum = ([r, g, b]) => {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const rgb = s => (s.match(/\d+/g) || [0, 0, 0]).slice(0, 3).map(Number);

async function contrastAudit(page, label) {
  /* The four that a previous audit measured as failing, plus the ones most
     load-bearing for reading the prompt itself. */
  const vals = await page.evaluate(() => {
    const v = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const probe = (css) => {
      const el = document.createElement('span');
      el.style.cssText = 'position:absolute;left:-9999px;' + css;
      document.body.appendChild(el);
      const c = getComputedStyle(el).color;
      el.remove();
      return c;
    };
    return {
      bg: probe('color:var(--bg)'), panel: probe('color:var(--panel)'),
      ink: probe('color:var(--ink)'), muted: probe('color:var(--muted)'),
      add: probe('color:var(--add)'), chip: probe('color:var(--chip)'),
      warn: probe('color:var(--warn)'), hot: probe('color:var(--hot)'),
      gold: probe('color:var(--gold)'), accent: probe('color:var(--accent)'),
      lineStrong: probe('color:var(--line-strong)'),
    };
  });
  const c = Object.fromEntries(Object.entries(vals).map(([k, x]) => [k, rgb(x)]));
  const text = [
    ['body text', c.ink, c.bg, 4.5],
    ['muted text on page', c.muted, c.bg, 4.5],
    ['muted text on card', c.muted, c.panel, 4.5],
    ['the green "adds" text in the prompt', c.add, c.panel, 4.5],
    ['the L2 complexity badge', c.warn, c.chip, 4.5],
    ['the L3 complexity badge', c.hot, c.chip, 4.5],
    ['the gold "tuned" marker', c.gold, c.panel, 4.5],
  ];
  const nonText = [
    ['control borders', c.lineStrong, c.bg, 3],
    ['the selected-suggestion marker', c.accent, c.panel, 3],
  ];
  let bad = 0;
  for (const [what, fg, bgc, need] of text.concat(nonText)) {
    const r = ratio(fg, bgc);
    if (r < need) { fail(`${label}: ${what} is ${r.toFixed(2)}:1, needs ${need}:1`); bad++; }
  }
  if (!bad) ok(`${label}: all ${text.length + nonText.length} measured contrasts pass`);
}

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 1150, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL);

  // 1. the box has a real label, not a placeholder standing in for one
  const nameOfQ = await page.evaluate(() => {
    const l = document.querySelector('label[for="q"]');
    return { label: l && l.textContent.trim(), aria: document.getElementById('q').getAttribute('aria-label') };
  });
  if (!nameOfQ.label && !nameOfQ.aria) fail('the main input has no programmatic label — only a placeholder');
  else ok(`the input is labelled ("${nameOfQ.label || nameOfQ.aria}"), not named by its placeholder`);

  // 2. THE BIG ONE: the suggestion list is a wired combobox
  const combo = await page.evaluate(() => {
    const q = document.getElementById('q');
    return { role: q.getAttribute('role'), controls: q.getAttribute('aria-controls'),
             auto: q.getAttribute('aria-autocomplete'), expanded: q.getAttribute('aria-expanded') };
  });
  if (combo.role !== 'combobox' || combo.controls !== 'sug' || !combo.auto)
    fail('the input is not wired as a combobox: ' + JSON.stringify(combo));
  else ok('the input declares itself a combobox controlling the suggestion list');
  if (combo.expanded !== 'false') fail('combobox does not start collapsed: ' + combo.expanded);

  await page.fill('#q', 'how');
  await page.waitForTimeout(120);
  const openState = await page.evaluate(() => {
    const q = document.getElementById('q');
    const opts = [...document.querySelectorAll('#sug .s-item')];
    return {
      expanded: q.getAttribute('aria-expanded'),
      active: q.getAttribute('aria-activedescendant'),
      ids: opts.map(o => o.id),
      selected: opts.map(o => o.getAttribute('aria-selected')),
    };
  });
  if (openState.expanded !== 'true') fail('list opened but aria-expanded stayed false');
  else ok('opening the list is announced');
  if (!openState.ids.every(Boolean)) fail('suggestion options have no ids to point at');
  else if (openState.active !== openState.ids[0])
    fail(`active option not pointed at: ${openState.active} vs ${openState.ids[0]}`);
  else ok('the active option is identified to the screen reader');
  if (openState.selected.filter(x => x === 'true').length !== 1)
    fail('exactly one option should be aria-selected: ' + openState.selected.join(','));
  else ok('exactly one option reports itself selected');

  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(80);
  const moved = await page.evaluate(() => document.getElementById('q').getAttribute('aria-activedescendant'));
  if (moved === openState.active) fail('arrowing did not move the announced active option');
  else ok('arrowing moves the announced selection, not just the highlight');

  // 3. Escape is not a dead end
  await page.keyboard.press('Escape');
  await page.waitForTimeout(60);
  if ((await page.evaluate(() => document.getElementById('q').getAttribute('aria-expanded'))) !== 'false')
    fail('Escape closed the list without announcing it');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(90);
  if (!(await page.locator('#sug').evaluate(el => el.classList.contains('open'))))
    fail('ArrowDown cannot reopen a list closed with Escape — keyboard dead end');
  else ok('ArrowDown reopens what Escape closed');
  await page.keyboard.press('Escape');

  // 4. every editable piece of the prompt is keyboard-reachable
  await page.fill('#q', '10 days in japan with kids on a tight budget');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  const segs = await page.evaluate(() => {
    const els = [...document.querySelectorAll('#prompt .seg')];
    return {
      count: els.length,
      /* Operability is what matters, not the tag: these are spans on purpose,
         because a button is an atomic inline box and would break the prompt's
         prose flow. They must still be a tab stop with a button role. */
      unfocusable: els.filter(e => e.tabIndex < 0).length,
      unroled: els.filter(e => e.getAttribute('role') !== 'button').length,
    };
  });
  if (!segs.count) fail('no editable prompt pieces found at all');
  else if (segs.unfocusable) fail(`${segs.unfocusable} prompt pieces are not reachable by keyboard`);
  else if (segs.unroled) fail(`${segs.unroled} prompt pieces do not announce themselves as controls`);
  else ok(`all ${segs.count} editable prompt pieces are keyboard-operable controls`);

  // and activating one with the keyboard actually works
  const before = await page.locator('#prompt').innerText();
  await page.locator('#prompt .seg').first().focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(90);
  if ((await page.locator('#prompt').innerText()) === before)
    fail('pressing Enter on a prompt piece did nothing');
  else ok('a prompt piece can be changed with the keyboard alone');

  // 5. toggles report their state, not just their colour
  await page.fill('#q', 'explain machine learning');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  const chip = page.locator('#chips .chip[data-id]').first();
  if ((await chip.getAttribute('aria-pressed')) !== 'false') fail('chips do not report an off state');
  await chip.click();
  await page.waitForTimeout(60);
  if ((await chip.getAttribute('aria-pressed')) !== 'true') fail('chips do not report an on state');
  else ok('modifier chips report pressed state, so it is not carried by colour alone');
  await chip.click();

  // 6. status messages are announced
  const live = await page.evaluate(() => {
    const t = document.getElementById('toast'), s = document.getElementById('promptStatus');
    return { toast: t && t.getAttribute('aria-live'), toastRole: t && t.getAttribute('role'),
             status: s && s.getAttribute('aria-live') };
  });
  if (live.toast !== 'polite' && live.toastRole !== 'status')
    fail('"Copied" is never announced — the toast is not a live region');
  else ok('the copy confirmation is announced, not just shown');
  if (live.status !== 'polite') fail('nothing announces that a prompt now exists');
  else ok('a status line announces the prompt once typing settles');

  await page.waitForTimeout(900);
  const said = await page.locator('#promptStatus').innerText();
  if (!/Prompt ready, \d+ words/.test(said)) fail('status line never filled in: ' + JSON.stringify(said));
  else ok(`and it says something useful: "${said}"`);

  // 7. sliders announce meaning, not an index
  const vt = await page.evaluate(() => ({
    steer: document.getElementById('steer').getAttribute('aria-valuetext'),
    depth: document.getElementById('depth').getAttribute('aria-valuetext'),
    tone: document.getElementById('tone').getAttribute('aria-valuetext'),
  }));
  if (vt.steer !== 'Guided' || vt.depth !== 'Standard' || vt.tone !== 'Anyone')
    fail('sliders announce a number instead of a value: ' + JSON.stringify(vt));
  else ok('the axes announce "Guided" and "Standard", not "1" and "1"');

  // 8. every interactive control has an accessible name
  const unnamed = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, input, a[href], [role="button"]')) {
      if (el.offsetParent === null && el.id !== 'depth') continue;   // skip hidden
      const name = (el.getAttribute('aria-label') || '').trim() ||
        (el.labels && el.labels[0] && el.labels[0].textContent.trim()) ||
        el.textContent.trim() || (el.getAttribute('title') || '').trim();
      if (!name) out.push(el.id || el.className || el.tagName);
    }
    return out;
  });
  if (unnamed.length) fail('controls with no accessible name: ' + unnamed.join(', '));
  else ok('every visible control has an accessible name');

  // 9. touch targets a thumb can actually hit
  await page.evaluate(() => { const t = document.getElementById('tune'); if (t) t.classList.add('open'); });
  await page.waitForTimeout(60);
  const small = await page.evaluate(() => {
    const out = [];
    for (const sel of ['#steer', '#tone', '.cx', '#copy', '#chainadd', '#chips .chip', '.step .x']) {
      for (const el of document.querySelectorAll(sel)) {
        // a control that is not on screen has no target size to judge
        if (el.offsetParent === null) continue;
        const r = el.getBoundingClientRect();
        if (r.height < 24 || r.width < 24) { out.push(`${sel} ${Math.round(r.width)}x${Math.round(r.height)}`); break; }
      }
    }
    return out;
  });
  if (small.length) fail('controls under the 24px minimum: ' + small.join(', '));
  else ok('interactive controls clear the 24px minimum target size');

  // 10. contrast, in both palettes
  await contrastAudit(page, 'light');
  const darkCtx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1150, height: 950 } });
  const darkPage = await darkCtx.newPage();
  await darkPage.goto(URL);
  await contrastAudit(darkPage, 'dark');
  const scheme = await darkPage.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
  if (!/dark/.test(scheme)) fail('color-scheme not declared, so native controls stay light: ' + scheme);
  else ok('color-scheme is declared, so carets and scrollbars follow the palette');
  await darkCtx.close();

  // 11. the page states its language, and honours reduced motion
  const lang = await page.evaluate(() => document.documentElement.lang);
  if (!lang) fail('<html> has no lang attribute');
  const reduced = await page.evaluate(() =>
    [...document.styleSheets[0].cssRules].some(r => /prefers-reduced-motion/.test(r.conditionText || '')));
  if (!reduced) fail('no prefers-reduced-motion support');
  else ok('language is declared and reduced motion is honoured');

  if (errors.length) errors.forEach(e => fail('page error: ' + e));
  await browser.close();
  console.log(failures ? `\n${failures} FAILURES` : '\nALL ACCESSIBILITY TESTS PASSED');
  process.exit(failures ? 1 : 0);
})();
