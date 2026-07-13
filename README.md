# Prompt Studio ✦ — zero-cost prompt agents in your browser

**Live:** https://sugeerth.github.io/prompt-agents/

A prompt recommendation framework and three AI agents that run **entirely client-side** — no server, no API keys, no cost, ever.

## What it does

- **Studio** — type a few words; the engine detects intent, scores your draft against a 7-dimension rubric (task clarity, role, context, output format, constraints, examples, success criteria), predicts useful continuations, and composes a stronger rewrite with added lines highlighted.
- **Agents** — three deployed agents with live step traces:
  - **Hermes Prompt Smith** — critique → rewrite → verify loop; re-scores its own output to prove improvement.
  - **Prompt Critic** — dimension-by-dimension evaluation.
  - **Prompt Librarian** — retrieves and adapts the closest gold prompts from a curated library.
- **Library** — 12 gold prompts across intents; click to open in Studio.

## The zero-cost architecture

| Layer | How | Cost |
|---|---|---|
| Hosting | GitHub Pages (static files) | $0 |
| Prompt engine | Pure JS heuristics (~15 KB), runs anywhere | $0 |
| LLM inference (opt-in) | [WebLLM](https://github.com/mlc-ai/web-llm) 0.2.84 on WebGPU — Hermes-3-3B / Hermes-3-8B (Nous Research) or Qwen2.5-0.5B, weights cached from the HF CDN, inference on the visitor's GPU | $0 |

No analytics, no cookies; prompts never leave the browser.

## Run locally

```bash
python3 -m http.server 8073   # then open http://localhost:8073
```

No build step. `engine.js` and `agents.js` are plain ES modules; `node --input-type=module` can import them for testing.

---

Built by [Sugeerth Murugesan](https://sugeerth.github.io) — agentic systems & LLM evaluation.
