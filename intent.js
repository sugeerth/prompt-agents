/* Prompt Studio — user-intent recognition.

   Domain answers "what is this about". Intent answers the harder and more
   useful question: "what does this person actually want to happen?"

   The same topic carries completely different goals. "sourdough starter" from
   someone who wants to understand fermentation needs a different answer than
   from someone whose starter died this morning. Detecting that lets the prompt
   state the GOAL and leave the FORM to the model — which is the point. A prompt
   that dictates shape gets a shaped answer; a prompt that conveys intent gets
   a good one.

   Every line below is a statement of what the user wants, never an instruction
   about format. No word caps, no "3 bullets", no structure. */

(function () {
  /* Each intent scores over weighted cues. Position matters: a cue at the head
     of the ask is far more telling than the same word buried mid-sentence. */
  const INTENTS = [
    {
      id: "fix", label: "fix it",
      line: "I want this working — lead with the most likely cause.",
      cues: [
        [/^(fix|debug|troubleshoot|repair)\b/, 3],
        [/\b(not working|doesn'?t work|won'?t (start|load|open|run|connect|turn on)|stopped working)\b/, 3],
        [/\b(error|exception|traceback|stack ?trace|crash(ing|es|ed)?|broken|bug)\b/, 2.5],
        // "not draining", "keeps dropping" — a thing misbehaving, stated plainly
        [/\bnot \w+ing\b/, 2.5],
        [/\bkeeps? \w+ing\b/, 2.5],
        // "why is MY x…" is a malfunction; "why is THE sky blue" is curiosity
        [/\bwhy (is|are|does|do|isn'?t|doesn'?t|won'?t) my\b/, 3.5],
        [/\b(fix|troubleshoot)\b/, 1.5],
      ],
    },
    {
      id: "decide", label: "decide",
      line: "I have to make a call here — tell me what you'd actually pick.",
      cues: [
        [/^(should i|should we|is it worth|which)\b/, 3],
        [/\b(vs\.?|versus)\b/, 2.5],
        [/\b(choose|decide|pick) between\b/, 3],
        [/\b(worth it|worth buying|better (option|choice)|which (one|is better))\b/, 2.5],
        [/\b(or)\b.*\?/, 1],
        // "mac or windows for video editing" — a choice stated without a question mark
        [/^\w+ or \w+\b/, 2.5],
        [/\b\w+ or \w+ for\b/, 2],
        [/\b(recommend|best .* for (me|us)|pros and cons)\b/, 1.5],
        [/\b(should i|or should)\b/, 2],
      ],
    },
    {
      id: "make", label: "make something",
      line: "I want something I can use as-is, not advice about how to write it.",
      cues: [
        [/^(write|draft|compose|create|generate|design|make me|build me)\b/, 3],
        [/\b(email|letter|essay|post|caption|bio|speech|resume|cover letter|message|script|template)\b/, 2],
        [/\b(draft|rewrite|reword|edit) (this|my|a|an)\b/, 2.5],
        [/\b(write|draft)\b/, 1.5],
      ],
    },
    {
      id: "do", label: "do it myself",
      line: "I want to be able to do this myself.",
      cues: [
        [/^(how (do|can) i|how to)\b/, 3],
        [/\b(step by step|walk me through|guide me)\b/, 2.5],
        [/^(set ?up|install|configure|build|cook|bake|clean|repair|plan)\b/, 2],
        [/\b(recipe|instructions|tutorial|process)\b/, 1.5],
      ],
    },
    {
      id: "understand", label: "understand",
      line: "I want to genuinely understand this, not just collect facts.",
      cues: [
        [/^(explain|how does|eli5)\b/, 3],
        // "what is X" is curiosity; "what is wrong with X" is a complaint
        [/^what (is|are|does) (?!wrong\b)/, 3],
        // "why does the sky…" is curiosity; "why is my laptop…" is a malfunction
        [/^why (do|does|is|are) (?!my\b)/, 3],
        [/\b(explain|understand|intuition|meaning of|difference between)\b/, 2],
        [/\b(what is|what are)\b(?! wrong)/, 1.5],
        [/\bwhy\b/, 1.5],
        [/\b(concept|theory|works?)\b/, 0.8],
      ],
    },
    {
      id: "explore", label: "explore options",
      line: "Show me options worth considering, including ones I wouldn't think of.",
      cues: [
        [/^(ideas|brainstorm|suggest|what could|give me .* ideas)\b/, 3],
        [/\b(ideas|options|alternatives|possibilities|suggestions)\b/, 2],
        [/\b(brainstorm|inspiration)\b/, 2.5],
      ],
    },
    {
      id: "check", label: "check my work",
      line: "Tell me plainly what's wrong with this and what you'd change.",
      cues: [
        [/^(review|check|proofread|critique|audit)\b/, 3],
        [/\bis (this|my)\b.{0,30}\b(correct|right|good|ok|fine|safe|valid)\b/, 3],
        [/\bdoes (this|my) (look|seem|make sense)\b/, 3],
        [/\b(review|feedback on|critique|proofread)\b/, 2],
        [/\b(am i (doing|missing)|what('?s| is) wrong with)\b/, 3],
      ],
    },
    {
      id: "plan", label: "plan it",
      line: "I want a plan I can actually follow, and to know what I'm forgetting.",
      cues: [
        [/^(plan|organi[sz]e|schedule|itinerary)\b/, 3],
        [/\b(itinerary|plan for|checklist|prepare for|roadmap)\b/, 2],
        [/\b\d+ (day|days|week|weeks|month|months) (in|of|trip)\b/, 2],
        [/\b(plan|planning)\b/, 1.2],
      ],
    },
    {
      id: "find", label: "find something",
      line: "I want specific, real suggestions — not categories to go research.",
      cues: [
        [/\b(near me|nearby|nearest|closest|around here|in my area)\b/, 3],
        [/^(find|where (can|do|should) i|recommend)\b/, 2.5],
        [/\b(best|top) .*(places?|spots?|restaurants?|shops?|trails?)\b/, 2],
        [/\b(where to)\b/, 2],
      ],
    },
  ];

  const OPEN = { id: "open", label: "open-ended", line: null };

  /* When we can't tell what someone wants, guessing is worse than asking.
     One question costs a round trip; a confidently wrong frame costs the answer. */
  const CLARIFY = "If my goal here is ambiguous, ask me one question before answering.";

  function recognize(text) {
    const t = " " + text.toLowerCase().trim().replace(/\s+/g, " ") + " ";
    if (!text.trim()) return { ...OPEN, confidence: 0, scores: {} };

    const scores = {};
    for (const intent of INTENTS) {
      let s = 0;
      for (const [re, w] of intent.cues) if (re.test(t.trim())) s += w;
      if (s) scores[intent.id] = +s.toFixed(2);
    }

    const ranked = INTENTS
      .map(i => ({ intent: i, score: scores[i.id] || 0 }))
      .sort((a, b) => b.score - a.score);

    const top = ranked[0], second = ranked[1];
    if (!top.score) return { ...OPEN, confidence: 0, scores };

    /* Confidence blends how strong the winner is with how far clear of the
       runner-up it sits. A tie between "decide" and "understand" is exactly
       the case where the prompt should ask rather than assume. */
    const strength = Math.min(1, top.score / 4);
    const margin = second.score ? Math.min(1, (top.score - second.score) / top.score) : 1;
    const confidence = +(0.55 * strength + 0.45 * margin).toFixed(2);

    return {
      id: top.intent.id,
      label: top.intent.label,
      line: top.intent.line,
      confidence,
      runnerUp: second.score ? second.intent.id : null,
      scores,
    };
  }

  window.PS_INTENT = { recognize, CLARIFY, INTENTS };
})();
