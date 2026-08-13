/* Eval for prompt chaining.

   Chaining fails quietly, which is what makes it worth testing hard. If the
   link between two steps is missing, nothing crashes — the model simply
   answers the second question as though the first never happened, and the user
   blames the model. So the cases below are mostly about the link: when it must
   appear, what it must carry, and when it must stay out of the way.

   Runs in plain node, no browser. */

const fs = require('fs');
const path = require('path');

global.window = {};
// eslint-disable-next-line no-eval
eval(fs.readFileSync(path.join(__dirname, '..', 'chain.js'), 'utf8'));
const C = global.window.PS_CHAIN;
if (!C) { console.log('FAILED: chain.js did not load'); process.exit(1); }

let failures = 0;
const fail = m => { failures++; console.log('FAIL:', m); };
const ok = m => console.log('  ok:', m);
const textOf = segs => segs.map(s => s.text).join(' ');

/* ---- 1. an elliptical follow-up gets its subject spelled out ---- */
{
  const cases = [
    ['10 days in japan with kids on a tight budget', 'what should we pack'],
    ['best laptop for video editing', 'and the budget?'],
    ['explain transformers', 'now simpler'],
    ['plan my kitchen renovation', 'how long will it take'],
  ];
  let good = true;
  for (const [a, b] of cases) {
    const segs = C.linkSegs([{ topic: a }, { topic: b }], 1);
    if (!textOf(segs).includes('Step 1 asked:')) { fail(`no subject carried for follow-up "${b}"`); good = false; }
  }
  if (good) ok('elliptical follow-ups carry the previous subject');
}

/* ---- 2. a self-contained step does NOT restate the subject ---- */
{
  const segs = C.linkSegs(
    [{ topic: '10 days in japan with kids' }, { topic: 'what winter clothes should we pack for our japan trip' }], 1);
  if (textOf(segs).includes('Step 1 asked:'))
    fail('subject restated for a step that already names it: ' + textOf(segs));
  else ok('a self-contained step is left alone — no redundant restating');
}

/* ---- 3. every linked step is told to build, not repeat ---- */
{
  const segs = C.linkSegs([{ topic: 'plan a trip' }, { topic: 'what to pack' }], 1);
  if (!/build on it, don't repeat it/.test(textOf(segs)))
    fail('missing the do-not-repeat instruction: ' + textOf(segs));
  else ok("chained steps are told to build on the answer, not repeat it");
}

/* ---- 4. step 1 has no link at all ---- */
{
  if (C.linkSegs([{ topic: 'anything' }], 0).length) fail('step 1 should have no link');
  else if (C.linkSegs([], 0).length) fail('empty chain should have no link');
  else ok('the first step carries no link');
}

/* ---- 5. constraints survive into later steps ---- */
{
  const found = C.constraints('10 days in japan with kids on a tight budget');
  if (!found.includes('with kids') || !found.includes('on a tight budget'))
    fail('constraints not extracted: ' + JSON.stringify(found));
  else ok('money and company constraints are extracted');

  const segs = C.linkSegs(
    [{ topic: '10 days in japan with kids on a tight budget', constraints: found }, { topic: 'what to pack' }], 1);
  if (!/constraints still apply/.test(textOf(segs)))
    fail('constraints not carried forward: ' + textOf(segs));
  else ok('constraints carry into the next step');
}

/* ---- 6. a constraint the new step restates is not repeated ---- */
{
  const segs = C.linkSegs(
    [{ topic: 'dinner for 6 vegetarian', constraints: ['vegetarian'] },
     { topic: 'a vegetarian dessert to go with it' }], 1);
  if (/constraints still apply/.test(textOf(segs)))
    fail('restated constraint carried anyway: ' + textOf(segs));
  else ok('a constraint the new step restates is not repeated');
}

/* ---- 7. the extractor stays quiet on asks with no real constraint ---- */
{
  const noisy = ['explain machine learning', 'fix my resume', 'best places to see in rome',
                 'write an email to my landlord', 'why is my laptop slow'];
  const bad = noisy.filter(t => C.constraints(t).length);
  if (bad.length) fail('invented constraints for: ' + JSON.stringify(bad.map(t => [t, C.constraints(t)])));
  else ok('no constraints invented for asks that state none');
}

/* ---- 8. pipeline mode: ordered, numbered, and bounded in length ---- */
{
  const steps = [
    { topic: 'a', prompt: 'Plan this trip: 10 days in japan.' },
    { topic: 'b', prompt: 'What should we pack.' },
    { topic: 'c', prompt: 'What will it cost.' },
  ];
  const p = C.pipeline(steps);
  if (!/1\)/.test(p) || !/2\)/.test(p) || !/3\)/.test(p)) fail('pipeline not numbered: ' + p);
  else if (p.indexOf('1)') > p.indexOf('2)')) fail('pipeline out of order');
  else if (!/using each result in the next/.test(p)) fail('pipeline does not link the steps: ' + p);
  else if (!/one line each/.test(p)) fail('pipeline does not bound the reply length: ' + p);
  else ok('pipeline mode runs the steps in order and keeps the reply bounded');

  if (C.pipeline([steps[0]]) !== steps[0].prompt) fail('a one-step pipeline should be just the prompt');
  else ok('a one-step chain is just that prompt — no pipeline scaffolding');
  if (C.pipeline([]) !== '') fail('empty pipeline should be empty');
}

/* ---- 9. transcript mode keeps steps separate ---- */
{
  const t = C.transcript([{ prompt: 'one' }, { prompt: 'two' }]);
  if (!/— Step 1 —/.test(t) || !/— Step 2 —/.test(t)) fail('transcript not labelled: ' + t);
  else ok('transcript mode labels each step for pasting one at a time');
}

/* ---- 10. round-trips through a URL, and refuses to grow unbounded ---- */
{
  const steps = [{ topic: 'trip to japan' }, { topic: 'what to pack' }];
  const back = C.decode(C.encode(steps));
  if (back.length !== 2 || back[0].topic !== 'trip to japan' || back[1].topic !== 'what to pack')
    fail('chain did not survive encode/decode: ' + JSON.stringify(back));
  else ok('a chain survives a round trip through a URL');

  const many = Array.from({ length: 20 }, (_, i) => ({ topic: 'step ' + i }));
  if (C.decode(C.encode(many)).length > C.MAX) fail('chain length not capped');
  else ok('chains are capped at a length a human can still follow');
  if (C.decode('').length || C.decode(null).length) fail('decoding nothing should give nothing');
}

/* ---- 11. hostile and degenerate input does not throw ---- */
{
  try {
    C.linkSegs(null, 1); C.linkSegs([{ topic: null }, { topic: undefined }], 1);
    C.constraints(null); C.constraints(12345); C.condense(null);
    C.pipeline(null); C.transcript(null); C.encode(null);
    C.linkSegs([{ topic: 'a'.repeat(5000) }, { topic: 'b' }], 1);
    ok('degenerate input is handled without throwing');
  } catch (e) { fail('threw on degenerate input: ' + e.message); }

  const long = C.condense('x'.repeat(500));
  if (long.length > 95) fail('condense did not bound the carried subject: ' + long.length);
  else ok('a carried subject is condensed, not pasted whole');
}

console.log(failures ? `\n${failures} FAILURES` : `\nALL CHAIN TESTS PASSED`);
process.exit(failures ? 1 : 0);
