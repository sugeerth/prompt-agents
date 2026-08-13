/* Prompt Studio — prompt chaining.

   One prompt is rarely the whole job. You ask for a trip plan, then what to
   pack, then what it will cost. Today people retype the context every time, or
   worse, they don't — and the model answers the second question as if the first
   never happened.

   A chain makes the steps aware of each other. Step 2 knows what step 1 asked,
   knows the constraints step 1 set, and knows it is building on an answer that
   already exists rather than starting over. That is the whole idea: the user
   types only the NEW part, and the link between steps is written for them.

   Two ways to spend a chain, because people work both ways:
     - step by step, pasting each prompt as the conversation progresses
     - as one pipeline prompt, handed to an agent that runs the whole sequence

   Everything here is pure text logic — no DOM, no storage, no network — so the
   same functions serve the UI, the tests, and anyone embedding the engine. */

(function () {
  /* Chains get unwieldy fast, and a chain nobody can hold in their head is
     worse than two separate asks. Six is past what anyone builds by hand. */
  const MAX = 6;

  /* A follow-up is usually written in shorthand: "what should we pack", "and
     the budget?", "now make it shorter". Those are meaningless on their own —
     they lean on the previous step for their subject. When a step leans, the
     chain has to spell out what it is leaning on, or the model fills the gap
     with a guess.

     Two independent tells, because either alone is wrong too often: an explicit
     continuation opener, or a short ask that shares no content word with what
     came before. */
  const OPENERS = /^(and|then|now|next|also|what about|how about|ok|okay|but|so)\b/i;
  const ANAPHORA = /\b(it|its|that|this|these|those|them|they|the same|the above|instead)\b/i;

  const STOP = new Set(("a an the of to for in on at by with and or is are be my our me i we you " +
    "how what why when where which who do does did should would could can will").split(" "));

  const words = s => String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));

  /* Does this step depend on the previous one for its subject? */
  function leansOnPrevious(topic, prevTopic) {
    const t = String(topic || "").trim();
    if (!t) return false;
    if (OPENERS.test(t)) return true;
    if (ANAPHORA.test(t)) return true;
    const now = words(t), before = new Set(words(prevTopic));
    if (!now.length) return true;
    const shared = now.filter(w => before.has(w)).length;
    /* A short ask with nothing in common with the previous one is either a new
       subject entirely or an elliptical follow-up. Treating it as a follow-up
       is the safe error: naming the context costs one line, while losing it
       costs the answer. Anything long enough to stand alone is left alone. */
    return shared === 0 && now.length <= 5;
  }

  /* What the previous step asked, short enough to sit at the top of a prompt
     without becoming the prompt. Cut at a word boundary — a sentence sliced
     mid-word reads like a bug. */
  function condense(topic, max) {
    const t = String(topic || "").trim().replace(/\s+/g, " ").replace(/[.?!]+$/, "");
    const cap = max || 90;
    if (t.length <= cap) return t;
    const cut = t.slice(0, cap);
    const at = cut.lastIndexOf(" ");
    return (at > 30 ? cut.slice(0, at) : cut) + "…";
  }

  /* The link itself. Kept to the fewest lines that carry real information:
     which step this follows, what that step asked (only when the new step
     can't stand on its own), and the instruction not to repeat work already
     done — which is what actually keeps chained answers short. */
  function linkSegs(steps, i) {
    if (!steps || i <= 0 || !steps[i - 1]) return [];
    const prev = steps[i - 1];
    const me = steps[i];
    const n = i; // steps are 0-based, humans count from 1
    const out = [];

    if (leansOnPrevious(me && me.topic, prev.topic))
      out.push({ text: `Step ${n} asked: ${condense(prev.topic)}.`, kind: "chain" });

    out.push({
      text: `This continues from your answer to step ${n} — build on it, don't repeat it.`,
      kind: "chain",
    });

    /* Constraints are the thing people most expect to survive a follow-up and
       are most surprised to lose. "On a tight budget" was said once, in step 1,
       and it still governs step 3. Carried only when the new step doesn't
       restate them itself, so the prompt never says the same thing twice. */
    if (prev.constraints && prev.constraints.length) {
      const restated = words(me && me.topic);
      const live = prev.constraints.filter(c => !restated.some(w => c.includes(w)));
      if (live.length)
        out.push({ text: `The constraints still apply: ${live.slice(0, 3).join(", ")}.`, kind: "chain" });
    }
    return out;
  }

  /* Which constraints a step set that a later step should still respect.

     Deliberately narrow. A loose extractor that guesses at constraints will
     carry junk into every following prompt, and a wrong constraint is worse
     than a missing one — it silently changes the answer. So this matches only
     the phrasings that are unambiguously a limit on the ask: money, time,
     company, and dietary or skill floors. Everything else is left behind, and
     the user can always retype it. */
  const CONSTRAINT_PATTERNS = [
    /\bon a (?:tight|small|shoestring|low|modest) budget\b/,
    /\bunder \$?\d[\d,.]*k?\b/,
    /\b(?:less|fewer) than \$?\d[\d,.]*\b/,
    /\bfor free\b/,
    /\bwith (?:kids|children|a toddler|a baby|my family|my dog|a group)\b/,
    /\bfor (?:beginners?|complete beginners?)\b/,
    /\b(?:vegetarian|vegan|gluten[- ]free|dairy[- ]free|halal|kosher|nut[- ]free)\b/,
    /\bin (?:under )?\d+ (?:minutes?|mins?|hours?|days?|weeks?|months?)\b/,
    /\bno (?:meat|car|oven|code|jargon|experience)\b/,
    /\bwithout (?:a car|an oven|code|coding|spending)\b/,
  ];

  function constraints(topic) {
    const t = String(topic || "").toLowerCase();
    const out = [];
    for (const re of CONSTRAINT_PATTERNS) {
      const m = t.match(re);
      if (m && !out.includes(m[0])) out.push(m[0]);
      if (out.length === 3) break;
    }
    return out;
  }

  /* The whole chain as a single prompt, for handing to something that can run
     the sequence itself. Numbered so each step can be referred to, and closed
     with an instruction that keeps the reply the size of the ANSWER rather than
     the size of the pipeline — a five-step chain that echoes every intermediate
     result is five times too long. */
  function pipeline(steps) {
    const live = (steps || []).filter(s => s && s.prompt);
    if (!live.length) return "";
    if (live.length === 1) return live[0].prompt;
    const body = live.map((s, i) => `${i + 1}) ${s.prompt}`).join("\n\n");
    return "Do these in order, using each result in the next.\n\n" + body +
      "\n\nGive me the final result. Summarize the intermediate steps in one line each, " +
      "and stop to ask if any step's result would change the ones after it.";
  }

  /* The chain as separate prompts to paste one at a time. Same steps, same
     links — this is only how they're delivered. */
  function transcript(steps) {
    const live = (steps || []).filter(s => s && s.prompt);
    return live.map((s, i) => `— Step ${i + 1} —\n${s.prompt}`).join("\n\n");
  }

  /* A chain is worth keeping and worth sharing, so it has to survive a reload
     and fit in a URL. Only the typed topics are stored: prompts are rebuilt
     from them by the engine, so a stored chain can never go stale against a
     newer version of the builder. */
  function encode(steps) {
    const topics = (steps || []).map(s => (s && s.topic) || "").filter(Boolean).slice(0, MAX);
    return topics.length ? topics.join("|") : "";
  }
  function decode(s) {
    if (!s) return [];
    return String(s).split("|").map(t => t.trim()).filter(Boolean).slice(0, MAX)
      .map(topic => ({ topic }));
  }

  window.PS_CHAIN = { MAX, linkSegs, pipeline, transcript, encode, decode, condense,
                      leansOnPrevious, constraints };
  if (typeof module !== "undefined" && module.exports) module.exports = window.PS_CHAIN;
})();
