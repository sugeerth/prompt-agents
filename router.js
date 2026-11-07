/* Prompt Studio — the learning router.

   profile.js remembers the last composition you endorsed in a domain and hands
   it back next time. That is a learner with a sample size of one: copy a Deep
   + Shaped tax prompt once and every future tax ask opens Deep + Shaped, even
   if the nine asks after it were Standard + Guided, because each endorsement
   overwrites the last. Last-write-wins is the noisiest estimator there is — it
   has no memory of disagreement, no notion of how sure it is, and no way to
   ever try the alternative it happened not to see first.

   This file replaces that with a contextual bandit over the compositions the
   app can actually offer — three Steer modes by three Depths, nine arms — and
   it is the only part of the engine that learns from OUTCOMES rather than from
   cues. intent.js reads what you typed. reason.js reads the shape of the ask.
   profile.js reads what you are interested in. None of them find out whether
   the prompt they produced was any good. This one does, from the only honest
   signal the app has: whether you took it, moved the axes first, or walked away.

   Three properties are load-bearing, and each is tested rather than asserted:

     It explores.        An arm that was never offered is never discovered.
                         UCB spends a bounded amount of traffic on alternatives
                         so a lucky first copy cannot lock the axes forever.
     It generalizes.     The same nine arms are scored against the ask's own
                         tokens, so "debug this stack trace" can inherit from
                         "fix my failing build" without sharing a domain label.
     It refuses.         Below MIN_EVIDENCE it returns null and the app keeps
                         its own default, and leader() reports no winner while
                         the intervals overlap. The engine's existing doctrine
                         is that personalization re-ranks and never decides;
                         a router that moves a slider has been handed more
                         authority than that, so it has to earn it first and
                         say out loud when it has not.

   The privacy architecture is profile.js's, for the same reason and with the
   same enforcement: no network access of any kind, one browser-local key named
   with its schema version, bounded size, and an erase that really erases.
   tests/router-eval.js reads this file as text and fails on any network call.

   Everything is O(arms x DIM) per decision — nine arms, 24 features, so a
   routing decision is a few hundred multiply-adds and costs well under a
   millisecond on the keystroke path. */

(function () {
  /* One key, versioned in its name. A schema change becomes a new key rather
     than a migration, so an old shape can never be half-read into a new one. */
  const KEY = "ps.router.v1";

  /* The arms. These are exactly the compositions app.js can open on, so the
     router can never recommend something the UI cannot express. Steer is the
     across-page axis, Depth the up-page one. */
  const STEERS = ["native", "guided", "shaped"];
  const DEPTHS = [0, 1, 2];

  /* Depth is locked in Native — the model owns the length there — so the three
     Native arms are one arm wearing three hats. Collapsing them keeps the
     bandit from spending exploration budget distinguishing identical outcomes,
     and keeps 7 real arms instead of a fictional 9. */
  const ARMS = (() => {
    const out = ["native:1"];
    for (const s of ["guided", "shaped"]) for (const d of DEPTHS) out.push(s + ":" + d);
    return out;
  })();

  function parseArm(id) {
    const [steer, d] = String(id).split(":");
    return { steer, depth: +d };
  }
  function armOf(steer, depth) {
    if (steer === "native") return "native:1";          // depth is not live in Native
    const s = STEERS.indexOf(steer) >= 0 ? steer : "guided";
    const d = DEPTHS.indexOf(+depth) >= 0 ? +depth : 1;
    return s + ":" + d;
  }

  /* Feature width for the contextual layer. The honest constraint here is
     storage, not statistics: a full LinUCB keeps a DIM x DIM covariance matrix
     per arm, which at DIM=24 is 576 floats x 7 arms — about 40 KB serialized,
     for a layer that is a nicety sitting next to a 240-token profile. So this
     runs DIAGONAL LinUCB: per-feature precision only, no cross-feature terms.
     It is a real approximation and it is a deliberate one — it cannot learn
     that two tokens only matter together, and in exchange it costs 2 x DIM
     floats per arm instead of DIM x DIM. Measured, that is about 2 KB after a
     week in one domain and under 8 KB at the twelve-domain cap, against the
     ~40 KB a full covariance would need; the eval fails above 12 KB. 24 buckets collide more than the 128
     a server-side version would use; the per-domain tally below is what carries
     the precision the hashing loses. */
  const DIM = 24;
  const RIDGE = 1.0;          // prior precision; also what an unseen feature is worth

  /* Exploration width on the contextual bonus, and the ONLY exploration in
     this file. Calibrated against what exploring actually costs here: a slider
     opening one notch away from the best-known setting, in plain sight, which
     the user can move with one drag. That is cheap, so this is a little more
     adventurous than a bandit over expensive actions would be — but only a
     little, because an axis that keeps drifting reads as the app being
     twitchy, and because the user's own corrections (the `changed` outcome
     below) are a richer source of alternatives than random probing. */
  const ALPHA = 0.35;

  /* How much evidence before the router is allowed to move a slider at all.
     Below this it returns null and app.js falls back to its own default, which
     is the behaviour a brand-new user should get: an app that starts guessing
     at your preferences after one interaction feels broken, not smart. Eight
     is roughly a day of real use for this tool, and it is also where the UCB
     bonus has shrunk enough that the arm being offered is a considered choice
     rather than an unexplored one. */
  const MIN_EVIDENCE = 8;

  /* EMA rate on an arm's weight. High enough that ten observations substantially
     move an arm, low enough that one bad copy does not undo a week. */
  const LEARN = 0.3;

  /* Taken from profile.js and for the same reason, so the two layers forget in
     step: every observation multiplies the stored evidence by DECAY, giving an
     unfed arm a half-life of about 240 observations — a month of daily use.
     Counting in observations rather than wall-clock means a user who vanishes
     for six months returns to an intact router rather than a blank one. */
  const DECAY = 0.9971;

  /* Per-domain tallies are the precise half of the model and the expensive half
     to store, so they are capped and evicted least-recently-used. Twelve covers
     the handful of areas a person actually lives in; the 21st domain they
     touched once is exactly the row worth losing. */
  const MAX_DOMAINS = 12;

  /* What each outcome reveals.

     The first version of this file treated the problem as a bandit: score the
     arm that was shown, and when the user dragged somewhere else, score that
     arm too. The eval caught what is wrong with that. An arm the user only
     ever drags TO is only ever recorded on the occasions it won — the arm on
     screen absorbs every failure, the dragged-to arm absorbs nothing but
     successes, so it converges to a perfect record and the router flips to
     it, whereupon the roles swap and the two oscillate forever. Scored that
     way the router lost to the baseline it exists to beat.

     The error was in the framing, not the constants. A bandit is for when you
     only learn the payoff of the arm you pulled. That is not this problem: the
     axes the user settles on before taking the prompt tell us exactly which
     arm was right for that ask — the full label, not one arm's payoff. This is
     a full-information problem wearing a bandit's clothes, so every arm is
     scored on every labelled ask: the one the user ended on was right, the
     other six were wrong. An arm's mean then means something a person can
     read off the transparency panel directly — "how often this was the setting
     you wanted" — rather than being an estimate conditioned on when it got
     shown.

     Only `abandoned` stays bandit-like, because no label was revealed: the
     user typed something new without settling on anything, so the single weak
     inference available is that whatever was on screen did not earn a copy. */
  const LOSER = 0.0;           // every arm that was not the one they settled on
  const WINNER = 1.0;

  /* An abandon is the weakest evidence in the set — people abandon asks for
     reasons that have nothing to do with the axes — so it is recorded at a
     fraction of a labelled observation's weight rather than as a confident
     zero against the arm that happened to be showing. */
  const ABANDON_WEIGHT = 0.35;

  /* Mirrors profile.js's tokenizer so a token means the same thing in both
     layers. The stoplist stays short on purpose: the short domain words
     ("tax", "css", "roi") are the ones carrying the signal. */
  const STOP = new Set(("the and for with that this from you your our are was were has have had " +
    "how why what when where which who can could should would will just about into over under " +
    "not but its it's they them their there here some any all one two out off via per than then " +
    "make made get got use used need want like also more most very much many").split(" "));

  function tokensOf(text) {
    if (typeof text !== "string" || !text) return [];
    const seen = new Set();
    for (const w of text.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/)) {
      if (w.length >= 3 && !STOP.has(w)) seen.add(w);
    }
    return [...seen];
  }

  /* FNV-1a. Not cryptographic and does not need to be — this picks a bucket,
     and the only property that matters is that the same token always lands in
     the same one. */
  function bucket(token) {
    let h = 0x811c9dc5;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h % DIM;
  }

  /* L2-normalized sparse hash of the ask, plus a constant bias feature so an
     empty or all-stopword ask still produces a usable vector and the arms can
     learn an unconditional preference. */
  function features(text) {
    const v = new Float64Array(DIM);
    for (const t of tokensOf(text)) v[bucket(t)] += 1;
    let norm = 0;
    for (let i = 0; i < DIM; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < DIM; i++) v[i] /= norm;
    v[0] += 1;                       // bias; shares bucket 0, which is fine — it is a constant offset
    return v;
  }

  /* ---------- storage ----------
     Every access wrapped, exactly as profile.js does it and for the same
     reasons: localStorage throws outright in some privacy modes, throws on
     quota, and returns another tab's garbage if something else has been in
     there. A router is a nicety and a nicety must never be able to break the
     thing it decorates. Unreachable storage demotes this to memory-only. */
  let store = null;
  try {
    if (typeof localStorage !== "undefined" && localStorage) store = localStorage;
  } catch (e) { store = null; }

  function readRaw() {
    if (!store) return null;
    try { return store.getItem(KEY); } catch (e) { return null; }
  }
  function writeRaw(s) {
    if (!store) return;
    try { store.setItem(KEY, s); } catch (e) { /* quota or blocked; memory-only from here */ }
  }
  function dropRaw() {
    if (!store) return;
    try { store.removeItem(KEY); } catch (e) { /* nothing to do and nothing to report */ }
  }

  /* ---------- state ---------- */
  function freshArm() {
    return {
      w: 0.5,                        // EMA of reward; 0.5 is "no opinion", same prior the graph layer uses
      n: 0,                          // decayed evidence count
      a: new Float64Array(DIM).fill(RIDGE),   // diagonal precision
      b: new Float64Array(DIM),               // feature-weighted reward
    };
  }

  function fresh() {
    const arms = {};
    for (const id of ARMS) arms[id] = freshArm();
    return {
      on: true,                      // opt-out, mirroring profile.js
      arms,
      dom: {},                       // domain -> { arm -> {w, n}, fp, seen }
      total: 0,                      // decayed total evidence, gates MIN_EVIDENCE
      seq: 0,                        // monotonic, for domain LRU
      offers: 0, accepted: 0,        // for explain(): how often a recommendation was taken as-is
    };
  }

  let S = fresh();

  function serialize() {
    const arms = {};
    for (const id of ARMS) {
      const A = S.arms[id];
      arms[id] = {
        w: +A.w.toFixed(4), n: +A.n.toFixed(3),
        a: Array.from(A.a, x => +x.toFixed(3)),
        b: Array.from(A.b, x => +x.toFixed(3)),
      };
    }
    return { v: 1, on: S.on, arms, dom: S.dom, total: +S.total.toFixed(3),
             seq: S.seq, offers: S.offers, accepted: S.accepted };
  }

  function save() {
    /* An opt-out must outlive the wipe that accompanies it, or the next load
       would silently start learning again. The only thing stored about a user
       who said no is that they said no. */
    if (!S.on) { writeRaw('{"v":1,"on":false}'); return; }
    try { writeRaw(JSON.stringify(serialize())); } catch (e) { /* must not block the UI */ }
  }

  function load() {
    S = fresh();
    const raw = readRaw();
    if (!raw) return;
    let o = null;
    try { o = JSON.parse(raw); } catch (e) { o = null; }
    /* Corrupt or foreign data is discarded, never repaired. Half-parsing
       someone else's JSON into a precision matrix produces a router that is
       wrong in ways nobody can debug. */
    if (!o || typeof o !== "object" || Array.isArray(o)) { dropRaw(); return; }

    S.on = o.on !== false;
    if (o.arms && typeof o.arms === "object") {
      for (const id of ARMS) {
        const src = o.arms[id];
        if (!src || typeof src !== "object") continue;
        const A = S.arms[id];
        if (isFinite(+src.w)) A.w = Math.max(0, Math.min(1, +src.w));
        if (isFinite(+src.n) && +src.n >= 0) A.n = +src.n;
        if (Array.isArray(src.a) && src.a.length === DIM) {
          for (let i = 0; i < DIM; i++) {
            const x = +src.a[i];
            /* Precision below the ridge prior is not a value this code can
               produce, so it is someone else's data or a truncation artefact;
               clamping beats trusting it, because a near-zero precision is a
               divide that blows the score up. */
            A.a[i] = isFinite(x) && x >= RIDGE ? x : RIDGE;
          }
        }
        if (Array.isArray(src.b) && src.b.length === DIM) {
          for (let i = 0; i < DIM; i++) { const x = +src.b[i]; A.b[i] = isFinite(x) ? x : 0; }
        }
      }
    }
    if (o.dom && typeof o.dom === "object" && !Array.isArray(o.dom)) {
      for (const k of Object.keys(o.dom)) {
        const d = o.dom[k];
        if (!d || typeof d !== "object") continue;
        const clean = { fp: typeof d.fp === "string" ? d.fp : "", seen: +d.seen || 0, arm: {} };
        if (d.arm && typeof d.arm === "object") {
          for (const id of ARMS) {
            const a = d.arm[id];
            if (!a || typeof a !== "object") continue;
            const w = +a.w, n = +a.n;
            if (isFinite(w) && isFinite(n) && n >= 0) clean.arm[id] = { w: Math.max(0, Math.min(1, w)), n };
          }
        }
        S.dom[k] = clean;
      }
    }
    S.total = isFinite(+o.total) && +o.total > 0 ? +o.total : 0;
    S.seq = isFinite(+o.seq) && +o.seq > 0 ? +o.seq : 0;
    S.offers = isFinite(+o.offers) ? +o.offers : 0;
    S.accepted = isFinite(+o.accepted) ? +o.accepted : 0;
    evict();
  }

  function evict() {
    const keys = Object.keys(S.dom);
    if (keys.length <= MAX_DOMAINS) return;
    keys.sort((a, b) => (S.dom[a].seen || 0) - (S.dom[b].seen || 0));
    for (let i = 0; i < keys.length - MAX_DOMAINS; i++) delete S.dom[keys[i]];
  }

  function age() {
    for (const id of ARMS) S.arms[id].n *= DECAY;
    for (const k of Object.keys(S.dom)) {
      const arm = S.dom[k].arm;
      for (const id of Object.keys(arm)) arm[id].n *= DECAY;
    }
    S.total *= DECAY;
  }

  /* ---------- scoring ---------- */

  /* Diagonal ridge regression: theta_i = b_i / A_i, score = theta . x, and the
     exploration bonus is the diagonal quadratic form, which is the same
     sqrt(x' A^-1 x) LinUCB uses with the off-diagonal terms dropped. */
  function contextualScore(A, x) {
    let mean = 0, varq = 0;
    for (let i = 0; i < DIM; i++) {
      if (!x[i]) continue;
      mean += (A.b[i] / A.a[i]) * x[i];
      varq += (x[i] * x[i]) / A.a[i];
    }
    return { mean, bonus: ALPHA * Math.sqrt(Math.max(0, varq)) };
  }

  function domArm(domain, id) {
    const d = domain && S.dom[domain];
    return (d && d.arm[id]) || null;
  }

  const clamp01 = x => (isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

  /* The score an arm gets for this ask. Three terms, in decreasing order of
     how much they are trusted:

       the domain tally   precise, and the thing a person would recognize as
                          "it learned how I like my tax prompts"
       the context model  generalizes across domains through the ask's words
       the global EMA     the fallback for an arm with no local evidence,
                          which is what keeps a cold domain from behaving
                          like a fresh install

     The domain term's share grows with how much domain evidence exists, so a
     domain seen twice leans on the global model and a domain seen fifty times
     mostly ignores it.

     Exploration is the LinUCB bonus and nothing else. The first version of
     this function added a UCB1 count term on top, and the eval caught what
     that does: two exploration schemes stacked on one decision, each unaware
     of the other, add to more optimism than any arm's evidence can overcome.
     It offered all seven arms in rotation forever and scored six points WORSE
     than the last-write-wins baseline it exists to beat. One mechanism, and
     it has to be the contextual one, because the bonus has to shrink in the
     direction the evidence actually arrived in. */
  function score(id, x, domain) {
    const A = S.arms[id];
    const ctx = contextualScore(A, x);
    const local = domArm(domain, id);
    const localN = local ? local.n : 0;
    const share = localN / (localN + 4);            // 4 observations to reach half weight

    const base = share * (local ? local.w : 0.5) + (1 - share) * (0.5 * A.w + 0.5 * clamp01(ctx.mean));
    return { value: base + ctx.bonus, base, explore: ctx.bonus };
  }

  /* ---------- the public decision ---------- */

  /* How often the router opens on something other than its current favourite.

     This is the one constant here that buys something other than accuracy, and
     it costs a little of it. A policy that always takes its own argmax
     generates logs from which NOTHING can be learned about the compositions it
     did not pick: under a deterministic policy every alternative was chosen
     with probability zero, so there is no honest way to ask "what would this
     other setting have scored?" — the question has no data behind it. Randomize
     a little and the question becomes answerable for every composition, which
     is what lab.js does with these propensities.

     What it costs is measured rather than assumed, and the first attempt at it
     was wrong in a way only measuring caught: plain epsilon-greedy spread over
     every composition took the router from 66.7% to 61.6%, surrendering almost
     exactly as much accuracy as the whole layer is worth. Confining the
     randomization to near-ties (see MARGIN) changes the trade completely. The
     measured frontier, 8 seeds, epsilon 0.25:

       MARGIN 0.05   cost 0.5pt   2.3% of decisions off-policy ... 0.7%
       MARGIN 0.20   cost 0.5pt   2.3% off-policy      <- here
       MARGIN 0.35   cost 1.1pt   4.5% off-policy
       MARGIN 0.60   cost 4.0pt   9.5% off-policy

     Past 0.20 the "near-tie" set starts admitting compositions the model can
     separate perfectly well, and the cost climbs with nothing to show for it. */
  const EPSILON = 0.25;

  /* How close to the leader a composition has to be before the router is
     willing to open on it instead.

     Randomizing only among compositions the model cannot actually separate
     buys propensity diversity for a fraction of the regret, because a swap
     between two arms it rates equally is close to free by definition. The
     measured cost is 0.5 of a point against a greedy policy, where spreading
     the same exploration uniformly cost 5.

     It also fails in the right direction. Where one composition dominates,
     the policy is deterministic there and lab.js simply cannot answer
     questions about the others in that context — which is the truth, rather
     than an answer built out of three stray observations. */
  const MARGIN = 0.20;

  /* The policy as a distribution, not a choice. Every composition within
     MARGIN of the leader gets a known, non-zero probability, so the propensity
     of whatever gets chosen is exact rather than estimated — the property
     off-policy evaluation actually needs. */
  function policy(ask, domain, eps) {
    const e = eps === undefined ? EPSILON : Math.max(0, Math.min(1, eps));
    const x = features(ask || "");
    const scores = {};
    let best = null;
    for (const id of ARMS) {
      const s = score(id, x, domain);
      scores[id] = s;
      if (!best || s.value > best.value) best = { id, ...s };
    }
    const near = ARMS.filter(id => scores[id].value >= best.value - MARGIN);
    const probs = {};
    const share = near.length ? e / near.length : 0;
    for (const id of ARMS) {
      probs[id] = (near.indexOf(id) >= 0 ? share : 0) + (id === best.id ? 1 - e : 0);
    }
    return { probs, best, scores, epsilon: e, candidates: near.length };
  }

  /* What the router would open the axes on for this ask, or null to leave the
     app's own default alone. Null is the correct answer far more often than a
     recommender is usually willing to admit: before MIN_EVIDENCE there is
     nothing to say, and saying something anyway is how a tool earns a
     reputation for moving things for no reason.

     `opts.epsilon` overrides the exploration rate; `opts.greedy` turns it off
     entirely, which is what best_for-style questions want — "what do you
     believe" rather than "what will you do". */
  function offer(ask, domain, opts) {
    if (!S.on) return null;
    if (S.total < MIN_EVIDENCE) return null;

    const o = opts || {};
    const eps = o.greedy ? 0 : o.epsilon;
    const pol = policy(ask, domain, eps);
    if (!pol.best) return null;

    let chosen = pol.best.id;
    if (pol.epsilon > 0) {
      let r = rand(), acc = 0;
      for (const id of ARMS) { acc += pol.probs[id]; if (r <= acc) { chosen = id; break; } }
    }

    const { steer, depth } = parseArm(chosen);
    return {
      steer, depth, arm: chosen,
      /* The probability this policy assigned to what it just did. Logging it is
         the whole reason a counterfactual is available later. */
      p: +pol.probs[chosen].toFixed(6),
      onPolicy: chosen === pol.best.id,
      /* Whether this is a settled preference or a probe. app.js does not change
         behaviour on it — the axes move either way — but the transparency panel
         says which, because a user who sees the slider move deserves to know
         whether the app is confident or curious. */
      exploring: pol.best.explore > 0.12 || chosen !== pol.best.id,
      score: +pol.scores[chosen].value.toFixed(4),
    };
  }

  /* Randomness, with a seam. The app wants a real random draw; the evals want
     a reproducible one, because a test that passes on some seeds and not others
     is a coin flip with extra steps. */
  let rand = Math.random;
  function _useRandom(fn) { rand = typeof fn === "function" ? fn : Math.random; }

  /* ---------- learning ---------- */

  /* One outcome.

       ask      the text the user was working on
       domain   the detected domain id, or null
       arm      the composition that was ON SCREEN when this happened
       outcome  "took" | "changed" | "abandoned"
       taken    for "changed": the composition they moved to and then took */
  function record(ev) {
    if (!S.on || !ev || typeof ev !== "object") return;
    const id = ARMS.indexOf(ev.arm) >= 0 ? ev.arm : null;
    if (!id) return;

    /* Which arm the user actually settled on, when they settled on one. This
       is the label, and having it is what makes the update below a
       classification rather than a bandit. */
    let label = null;
    if (ev.outcome === "took") label = id;
    else if (ev.outcome === "changed") label = ARMS.indexOf(ev.taken) >= 0 ? ev.taken : id;
    else if (ev.outcome !== "abandoned") return;   // unknown outcomes are ignored, never guessed at

    /* Decay first, so the newest observation is the only one at full weight —
       the invariant that lets a changed preference overtake an equally
       frequent older one. */
    age();

    const x = features(ev.ask || "");

    if (label) {
      /* Every arm is scored, because every arm's correctness on this ask is
         known. Without the losers this degenerates back into the biased
         version: an arm would only ever be updated on the asks it won. */
      for (const armId of ARMS) {
        apply(armId, armId === label ? WINNER : LOSER, 1, x, ev.domain);
      }
    } else {
      apply(id, LOSER, ABANDON_WEIGHT, x, ev.domain);
    }

    /* Evidence is counted per ASK, not per arm update, or seven arms would
       make MIN_EVIDENCE arrive seven times too early and the router would
       start moving sliders after a single interaction. */
    S.total += label ? 1 : ABANDON_WEIGHT;

    if (ev.offered) {
      S.offers++;
      if (ev.outcome === "took") S.accepted++;
    }
    save();
  }

  function apply(id, reward, weight, x, domain) {
    if (!weight) return;
    const A = S.arms[id];
    const rate = LEARN * weight;
    A.w = (1 - rate) * A.w + rate * reward;
    A.n += weight;
    for (let i = 0; i < DIM; i++) {
      if (!x[i]) continue;
      A.a[i] += weight * x[i] * x[i];
      A.b[i] += weight * reward * x[i];
    }

    if (domain) {
      let d = S.dom[domain];
      if (!d) { d = S.dom[domain] = { fp: "", seen: 0, arm: {} }; }
      d.seen = ++S.seq;
      const cur = d.arm[id] || (d.arm[id] = { w: 0.5, n: 0 });
      cur.w = (1 - rate) * cur.w + rate * reward;
      cur.n += weight;
      evict();
    }
  }

  /* A domain's prompt template changed under us. Everything learned about that
     domain was measured against text that no longer exists, so crediting the
     new template with it would report a preference the user never expressed.
     The global and contextual layers survive — they are about the person, not
     about one template — and only the domain's tally resets. */
  function setTemplateVersion(domain, fp) {
    if (!domain || typeof fp !== "string") return false;
    const d = S.dom[domain];
    if (!d) { S.dom[domain] = { fp, seen: ++S.seq, arm: {} }; return false; }
    if (d.fp === fp) return false;
    const had = Object.keys(d.arm).length > 0;
    d.fp = fp;
    d.arm = {};
    if (had) save();
    return had;
  }

  /* ---------- reporting ----------
     Everything below exists so the transparency panel can be truthful. A router
     that moves a control the user can see must be able to answer "why", and
     must be willing to answer "I don't know yet". */

  /* Wilson score interval on the arm's mean. Wilson rather than a bootstrap
     because this runs in a UI thread on every panel open, and rather than a
     normal approximation because the counts here are small enough that the
     normal interval runs off the end of [0,1] and reports impossible bounds. */
  function interval(mean, n) {
    if (n <= 0) return { low: 0, high: 1 };
    const z = 1.96, denom = 1 + (z * z) / n;
    const centre = (mean + (z * z) / (2 * n)) / denom;
    const half = (z / denom) * Math.sqrt((mean * (1 - mean)) / n + (z * z) / (4 * n * n));
    return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
  }

  function stats(domain) {
    return ARMS.map(id => {
      const A = S.arms[id];
      const local = domArm(domain, id);
      const n = (local ? local.n : 0) + A.n;
      const w = local && local.n > 0 ? local.w : A.w;
      const { steer, depth } = parseArm(id);
      return { arm: id, steer, depth, n: +n.toFixed(2), mean: +w.toFixed(4), ...interval(w, n) };
    }).sort((a, b) => b.mean - a.mean || (a.arm < b.arm ? -1 : 1));
  }

  /* The settled favourite, or null. Null while any arm is untried, because an
     arm nobody has seen could be the best one and a front-runner among the
     tried ones is not a winner; and null while the top two intervals overlap,
     because naming a winner there is reporting noise. The router still ROUTES
     in both cases — offer() always has an opinion once there is evidence — but
     it does not get to call the result decided. */
  function leader(domain) {
    const rows = stats(domain);
    if (rows.some(r => r.n <= 0)) return null;
    if (rows.length < 2) return rows[0] || null;
    return rows[0].low > rows[1].high ? rows[0] : null;
  }

  function explain(domain) {
    const rows = stats(domain);
    const lead = leader(domain);
    return {
      on: S.on,
      ready: S.total >= MIN_EVIDENCE,
      observations: +S.total.toFixed(1),
      needed: Math.max(0, +(MIN_EVIDENCE - S.total).toFixed(1)),
      arms: rows,
      leader: lead ? lead.arm : null,
      /* How often a composition the router opened on was taken without the user
         touching an axis. The one number that says whether this layer is
         earning its place; a value near the no-router baseline means it is not. */
      offers: S.offers,
      accepted: S.accepted,
      acceptance: S.offers ? +(S.accepted / S.offers).toFixed(3) : null,
      domains: Object.keys(S.dom).length,
    };
  }

  /* ---------- control ---------- */
  function forget() {
    const on = S.on;
    S = fresh();
    S.on = on;
    dropRaw();
  }
  function enabled() { return !!S.on; }
  function setEnabled(on) {
    const next = !!on;
    /* Off wipes as well as stops, or the user is left with a model in storage
       they believe they switched off. */
    if (!next) { S.on = false; forget(); S.on = false; save(); return; }
    S.on = true;
    save();
  }

  /* The one seam, same as profile.js: the eval drives persistence without a
     browser and the app has no other reason to swap its storage. */
  function _useStorage(s) { store = s || null; load(); }

  load();

  window.PS_ROUTER = {
    ARMS, armOf, parseArm,
    offer, policy, record, setTemplateVersion,
    stats, leader, explain,
    forget, enabled, setEnabled, _useStorage, _useRandom,
  };
})();

/* Requirable from node so the eval exercises the real module rather than a
   copy of its logic. */
if (typeof module !== "undefined" && module.exports) module.exports = window.PS_ROUTER;
