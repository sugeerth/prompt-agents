/* Agents — client-side agents deployed on GitHub Pages at $0.
   Each agent is a declarative spec of steps. The runner executes steps
   sequentially and emits a live trace. Steps run heuristically (instant,
   works everywhere); when a WebLLM model is loaded, `llm`-capable steps
   route through it instead (Hermes-3 recommended). */

import { detectIntent, scorePrompt, recommend, recommendText, LIBRARY } from "./engine.js";

/* llmCall: set by the app when a WebLLM engine is ready. null → heuristic mode. */
export const backend = { llmCall: null, modelLabel: null };

async function maybeLLM(systemPrompt, userPrompt, fallback) {
  if (!backend.llmCall) return { text: fallback, via: "heuristic" };
  try {
    const text = await backend.llmCall(systemPrompt, userPrompt);
    return { text: text.trim(), via: backend.modelLabel };
  } catch {
    return { text: fallback, via: "heuristic (model call failed)" };
  }
}

export const AGENTS = [
  {
    id: "smith",
    name: "Hermes Prompt Smith",
    role: "optimizer",
    blurb: "Takes your rough draft through a critique → rewrite → verify loop and hands back a measurably stronger prompt.",
    steps: ["classify", "critique", "rewrite", "verify", "deliver"],
    async run(draft, emit) {
      const intent = detectIntent(draft);
      await emit("classify", `intent: ${intent.label}`);

      const scored = scorePrompt(draft);
      const weak = scored.dims.filter(d => d.score < 50);
      const heuristicCritique = weak.length
        ? weak.map(d => `${d.name}: ${d.advice}`).join("\n")
        : "Draft already covers the core dimensions — polishing only.";
      const critique = await maybeLLM(
        "You are a prompt engineering critic. Be terse and concrete. List the 3 biggest weaknesses of the user's prompt as bullet points. No preamble.",
        draft, heuristicCritique);
      await emit("critique", `score ${scored.overall}/100 (${scored.grade}) — ${weak.length} weak dimension${weak.length === 1 ? "" : "s"}\n${critique.text}`, critique.via);

      const lines = recommend(draft, intent, scored);
      const heuristicRewrite = recommendText(lines);
      const rewrite = await maybeLLM(
        "You are a prompt engineer. Rewrite the user's prompt to be maximally effective: clear task, role, context slots in <angle brackets> where information is missing, explicit output format, constraints, success criteria. Return ONLY the rewritten prompt.",
        draft, heuristicRewrite);
      await emit("rewrite", rewrite.text, rewrite.via);

      const after = scorePrompt(rewrite.text);
      await emit("verify", `re-scored: ${scored.overall} → ${after.overall}/100 (${scored.grade} → ${after.grade})`);

      await emit("deliver", "done — copy the rewrite above, fill any <slots>, and ship it.");
      return { intent, before: scored, after, rewrite: rewrite.text };
    },
  },
  {
    id: "critic",
    name: "Prompt Critic",
    role: "evaluator",
    blurb: "Scores your prompt on 7 research-grounded dimensions and explains exactly where it loses points.",
    steps: ["classify", "score", "report"],
    async run(draft, emit) {
      const intent = detectIntent(draft);
      await emit("classify", `intent: ${intent.label}`);

      const scored = scorePrompt(draft);
      await emit("score", scored.dims.map(d => `${String(d.score).padStart(3)}  ${d.name}`).join("\n"));

      const worst = [...scored.dims].sort((a, b) => a.score - b.score).slice(0, 3);
      const heuristicReport = `Overall ${scored.overall}/100 (${scored.grade}). Fix first:\n` +
        worst.map((d, i) => `${i + 1}. ${d.name} — ${d.advice}`).join("\n");
      const report = await maybeLLM(
        "You are a prompt evaluation expert. Given the user's prompt, write a 4-line assessment: one line on overall quality, three lines on the most impactful improvements, most impactful first. Be specific to THIS prompt, not generic.",
        draft, heuristicReport);
      await emit("report", report.text, report.via);
      return { intent, scored };
    },
  },
  {
    id: "librarian",
    name: "Prompt Librarian",
    role: "recommender",
    blurb: "Matches your goal against a curated library of gold prompts and adapts the closest ones to your task.",
    steps: ["classify", "retrieve", "adapt"],
    async run(draft, emit) {
      const intent = detectIntent(draft);
      await emit("classify", `intent: ${intent.label}`);

      const draftWords = new Set(draft.toLowerCase().split(/\W+/).filter(w => w.length > 3));
      const ranked = LIBRARY
        .map(item => {
          const overlap = item.prompt.toLowerCase().split(/\W+/).filter(w => draftWords.has(w)).length;
          return { item, score: (item.intent === intent.id ? 10 : 0) + overlap };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      await emit("retrieve", ranked.map((r, i) => `${i + 1}. ${r.item.title} (${r.item.intent})`).join("\n"));

      const top = ranked[0].item;
      const heuristicAdapt = top.prompt.replace(/<task>|<topic>|<what>|<problem>|<goal[^>]*>/i, draft.trim());
      const adapt = await maybeLLM(
        `You adapt template prompts to a user's specific goal. Template:\n${top.prompt}\n\nFill the template's <slots> using the user's goal where possible; keep remaining slots as <angle brackets>. Return ONLY the adapted prompt.`,
        draft, heuristicAdapt);
      await emit("adapt", adapt.text, adapt.via);
      return { intent, matches: ranked.map(r => r.item), adapted: adapt.text };
    },
  },
];

/* Runner: executes an agent, emitting trace events {step, status, output, ms, via}. */
export async function runAgent(agent, draft, onEvent) {
  const trace = [];
  const emit = async (step, output, via) => {
    const started = performance.now();
    onEvent({ step, status: "run" });
    // Yield a frame so the "running" state is visible even for instant heuristic steps.
    await new Promise(r => setTimeout(r, 180 + Math.random() * 240));
    const ms = Math.round(performance.now() - started);
    const ev = { step, status: "ok", output, ms, via };
    trace.push(ev);
    onEvent(ev);
  };
  const result = await agent.run(draft, emit);
  return { trace, result };
}
