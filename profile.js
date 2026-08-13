/* Prompt Studio — the local user vector.

   Two people typing the same three letters want different things. Someone who
   has copied a dozen sourdough prompts this month means something different by
   "star" than someone who has been debugging Kubernetes all week. This layer is
   the only part of the app that knows which person is at the keyboard, so that
   suggestions rank in their favour and the controls they actually use come back
   next visit instead of resetting to the defaults every time.

   The privacy promise is not a footer claim, it is the architecture. This file
   performs no network access whatsoever: no request APIs, no beacons, no
   remote scripts, no cookies, no third-party anything. The single artefact it
   produces is one browser-local key, and the user can read it, rank it, and
   destroy it through the API below. tests/profile-eval.js reads this file as
   text and fails the build if any of those forbidden calls ever appear, because
   a promise that only lives in a comment is a promise waiting to be broken by a
   well-meaning future edit.

   Personalization here is deliberately timid. It re-ranks; it never decides.
   The ceiling on boost() exists so that a person's habits can break a tie
   between two comparable suggestions and can never bury an obviously better
   literal match — a search box that stops finding what you literally typed is
   worse than one that never learned anything. */

(function () {
  /* Exactly one key, named with its schema version. A version bump means a new
     key rather than a migration, so an old shape can never be half-read into a
     new one; the stale key is dropped on the next forget(). */
  const KEY = "ps.profile.v1";

  /* Storage stays bounded so this can never become the reason a browser starts
     evicting the origin's data. 240 tokens is a few kilobytes serialized, and
     it is well past the point where a person's actual interests stop growing —
     beyond it we are only accumulating one-off vocabulary. */
  const MAX_TOKENS = 240;
  const MAX_RECENT = 30;

  /* The hard ceiling on personalization. Similarity scores in app.js land
     roughly in 0..1 and meaningful gaps between adjacent matches are typically
     larger than this, so a boost can reorder near-ties and effectively nothing
     else. Raising it would let a stale interest outrank an exact-word match,
     which reads as the search being broken rather than as it being smart. */
  const BOOST_MAX = 0.12;

  /* Interests must fade, or the vector becomes a permanent record of whatever
     the user happened to care about in their first week. Every observation
     multiplies the whole vector by DECAY, so recency is a property of the data
     rather than something a cleanup pass has to go find.

     Calibration: a daily user of a tool like this records on the order of eight
     meaningful interactions per day, so thirty days is roughly 240 recorded
     observations. Solving 0.5 = DECAY^240 gives 0.9971 — an interest that stops
     being fed is worth half as much a month later, and is effectively gone by
     the quarter. Counting in observations rather than wall-clock time also
     means a user who disappears for six months comes back to their profile
     intact instead of to a blank one, which is the behaviour people expect. */
  const DECAY = 0.9971;

  /* Below this a token is noise from a single stray ask months ago. Dropping it
     keeps top() honest — a transparency panel listing tokens the user cannot
     remember typing undermines the very trust the panel is there to build. */
  const FLOOR = 0.005;

  /* How much evidence before the vector is allowed to speak with confidence.
     Affinity is scaled by mass/(mass + PATIENCE), so one copied prompt caps
     affinity around 0.14 no matter how perfectly the text matches. Without this
     the very first interaction would pin affinity to 1 and the app would start
     confidently personalizing for a user it has met once. */
  const PATIENCE = 6;

  /* How much intent each interaction actually reveals. Copying or launching a
     prompt is the user voting with their clipboard — they took the thing.
     Accepting a suggestion is real but cheaper; people click to see what
     happens. Raw typing is nearly worthless as evidence: half of it is
     abandoned mid-thought, and at keystroke rates it would swamp every
     deliberate signal within a single session. It is kept at a token weight
     rather than zero only so a long session on an unfamiliar topic leaves a
     faint trace. */
  const WEIGHT = { copy: 1, launch: 1, accept: 0.5, type: 0.03 };

  /* Events where the user demonstrably wanted the prompt. Only these reach
     recent(), because a list of "things you were part-way through typing" is
     not a useful memory of what someone asked for. */
  const STRONG = { copy: true, launch: true, accept: true };

  /* Mirrors the app's own tokenizer so a token learned here matches a token
     scored there. The stoplist stays small on purpose: aggressive stopping
     strips exactly the short domain words ("tax", "css", "roi") that carry the
     most personal signal. */
  const STOP = new Set(("the and for with that this from you your our are was were has have had " +
    "how why what when where which who can could should would will just about into over under " +
    "not but its it's they them their there here some any all one two out off via per than then " +
    "make made get got use used need want like also more most very much many").split(" "));

  function tokensOf(text) {
    if (typeof text !== "string" || !text) return [];
    const seen = new Set();
    for (const w of text.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/)) {
      /* Deduplicated per observation: repeating a word inside one ask is a
         quirk of phrasing, not three times the interest in the topic. */
      if (w.length >= 3 && !STOP.has(w)) seen.add(w);
    }
    return [...seen];
  }

  /* ---------- storage ----------
     Every single access is wrapped. Touching localStorage throws outright in
     some privacy modes, writes throw on quota, and reads return garbage if
     another tab or an extension has been in there. None of that is allowed to
     take the app down: a profile is a nicety, and a nicety must never be able
     to break the thing it decorates. Failing to reach storage simply demotes
     this layer to memory-only for the session. */
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
  function fresh() {
    return {
      on: true,          // opt-out, not opt-in: the feature is invisible and locally scoped
      w: new Map(),      // token -> decayed weight
      dom: new Map(),    // domain id -> decayed weight, for the domain half of boost()
      prefs: {},         // domain id -> { steer, depth } last endorsed by a copy or launch
      recent: [],        // newest first, deduped
      asks: 0,           // count of strong interactions, for the "what I remember" line
      mass: 0,           // decayed total evidence, drives how confidently affinity speaks
      since: null,       // epoch ms of the first recorded interaction
    };
  }

  let S = fresh();
  let refCache = null;   // invalidated on every mutation; see refWeight()
  let sinceFlush = 0;    // observations since the last write, for the type-event throttle

  function serialize() {
    const w = {};
    for (const [k, v] of S.w) w[k] = +v.toFixed(4);
    const dom = {};
    for (const [k, v] of S.dom) dom[k] = +v.toFixed(4);
    return { v: 1, on: S.on, w, dom, prefs: S.prefs, recent: S.recent,
             asks: S.asks, mass: +S.mass.toFixed(4), since: S.since };
  }

  function save() {
    /* An opt-out has to outlive the wipe that accompanies it, or the next page
       load would silently start learning again. So the disabled state writes a
       marker carrying no interaction data at all — the only thing stored about
       a user who said no is that they said no. */
    if (!S.on) { writeRaw('{"v":1,"on":false}'); sinceFlush = 0; return; }
    try { writeRaw(JSON.stringify(serialize())); } catch (e) { /* unserializable state cannot block the UI */ }
    sinceFlush = 0;
  }

  function load() {
    S = fresh();
    refCache = null;
    sinceFlush = 0;
    const raw = readRaw();
    if (!raw) return;

    let o = null;
    try { o = JSON.parse(raw); } catch (e) { o = null; }
    /* Corrupt or foreign data is discarded rather than repaired. Half-parsing
       someone else's JSON into a weight map produces a profile that is wrong in
       ways nobody can debug; starting over costs the user a few days of
       learning and costs us nothing. */
    if (!o || typeof o !== "object" || Array.isArray(o)) { dropRaw(); return; }

    S.on = o.on !== false;
    if (o.w && typeof o.w === "object") {
      for (const k of Object.keys(o.w)) {
        const v = +o.w[k];
        if (typeof k === "string" && k && isFinite(v) && v > 0) S.w.set(k, v);
      }
    }
    if (o.dom && typeof o.dom === "object") {
      for (const k of Object.keys(o.dom)) {
        const v = +o.dom[k];
        if (isFinite(v) && v > 0) S.dom.set(k, v);
      }
    }
    if (o.prefs && typeof o.prefs === "object" && !Array.isArray(o.prefs)) S.prefs = o.prefs;
    if (Array.isArray(o.recent)) S.recent = o.recent.filter(x => typeof x === "string").slice(0, MAX_RECENT);
    S.asks = isFinite(+o.asks) ? +o.asks : 0;
    S.mass = isFinite(+o.mass) && +o.mass > 0 ? +o.mass : 0;
    S.since = isFinite(+o.since) && +o.since > 0 ? +o.since : null;
    prune();
  }

  function prune() {
    for (const [k, v] of S.w) if (v < FLOOR) S.w.delete(k);
    if (S.w.size <= MAX_TOKENS) return;
    /* Weakest first: the tokens closest to being forgotten are the ones the
       decay curve was already on its way to removing. */
    const byWeight = [...S.w.entries()].sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < byWeight.length && S.w.size > MAX_TOKENS; i++) S.w.delete(byWeight[i][0]);
  }

  function age() {
    for (const [k, v] of S.w) S.w.set(k, v * DECAY);
    for (const [k, v] of S.dom) S.dom.set(k, v * DECAY);
    S.mass *= DECAY;
  }

  /* ---------- observing ---------- */
  function observe(ev) {
    if (!S.on || !ev || typeof ev !== "object") return;
    const w = WEIGHT[ev.type];
    if (!w) return;                              // unknown event types are ignored, never guessed at

    const toks = tokensOf(ev.text);
    const strong = !!STRONG[ev.type];
    const endorsed = ev.type === "copy" || ev.type === "launch";

    /* Decay runs before the addition so the newest observation is the only one
       at full weight — the invariant that makes a later theme outrank an
       equally-frequent earlier one in top(). */
    age();

    if (toks.length) {
      for (const t of toks) S.w.set(t, (S.w.get(t) || 0) + w);
      /* Mass only grows on evidence that carried text. A copy of an empty box
         is a real endorsement of the settings but says nothing about topics, so
         it must not inflate the confidence that affinity() speaks with. */
      S.mass += w;
    }
    if (strong && ev.domain) S.dom.set(ev.domain, (S.dom.get(ev.domain) || 0) + w);

    /* The settings are only endorsed at the moment the prompt leaves the app.
       Recording them from an accept would remember whatever the sliders
       happened to be on while the user was still browsing suggestions. */
    if (endorsed && ev.domain && (ev.steer !== undefined || ev.depth !== undefined)) {
      S.prefs[ev.domain] = {
        steer: typeof ev.steer === "string" ? ev.steer : null,
        depth: typeof ev.depth === "number" ? ev.depth : null,
      };
    }

    if (strong) {
      S.asks++;
      const label = typeof ev.text === "string" ? ev.text.trim() : "";
      if (label) {
        const i = S.recent.findIndex(x => x.toLowerCase() === label.toLowerCase());
        if (i >= 0) S.recent.splice(i, 1);
        S.recent.unshift(label);
        if (S.recent.length > MAX_RECENT) S.recent.length = MAX_RECENT;
      }
    }

    if (S.since === null) S.since = Date.now();
    prune();
    refCache = null;

    /* Writing is synchronous and this runs on the keystroke path, so weak
       typing signals are batched. Losing the last few type events to a closed
       tab costs almost nothing — they are the weakest evidence in the model by
       two orders of magnitude — whereas a JSON write per keystroke is felt. */
    sinceFlush++;
    if (strong || sinceFlush >= 8) save();
  }

  /* ---------- reading ----------
     The reference weight is the mean of the strongest few tokens rather than
     the single maximum, so one runaway token cannot make every other genuine
     interest look weak by comparison. */
  function refWeight() {
    if (refCache !== null) return refCache;
    const top5 = [...S.w.values()].sort((a, b) => b - a).slice(0, 5);
    refCache = top5.length ? top5.reduce((a, b) => a + b, 0) / top5.length : 0;
    return refCache;
  }

  function affinity(text) {
    if (!S.on || !S.w.size) return 0;
    const q = tokensOf(text);
    if (!q.length) return 0;
    const ref = refWeight();
    if (!ref) return 0;

    /* Weighted coverage: what fraction of this ask is made of things the user
       is known to care about, each token capped at "as familiar as their
       strongest interests". Coverage alone is far too eager after one
       interaction, so it is scaled by how much evidence exists at all. */
    let cover = 0;
    for (const t of q) cover += Math.min(1, (S.w.get(t) || 0) / ref);
    cover /= q.length;

    const confidence = S.mass / (S.mass + PATIENCE);
    return +Math.max(0, Math.min(1, cover * confidence)).toFixed(4);
  }

  function boost(doc) {
    if (!S.on || !doc || typeof doc !== "object") return 0;
    const a = affinity(doc.t || "");

    /* The domain half catches the case where a suggestion shares no vocabulary
       with anything the user has asked but sits squarely in the area they live
       in. It is the minority of the score because a domain is a very coarse
       statement about a person. */
    let share = 0;
    if (doc.d && S.dom.size) {
      let total = 0;
      for (const v of S.dom.values()) total += v;
      if (total > 0) share = (S.dom.get(doc.d) || 0) / total;
    }

    const fit = 0.75 * a + 0.25 * share;
    /* Clamped at the source rather than by the caller. A re-ranking bonus that
       a future edit could accidentally let past its ceiling is a bug that
       manifests as the search quietly getting worse, which is exactly the class
       of bug nobody files. */
    return +Math.max(0, Math.min(BOOST_MAX, BOOST_MAX * fit)).toFixed(4);
  }

  function prefs(domain) {
    if (!S.on || !domain) return null;
    const p = S.prefs[domain];
    return p ? { steer: p.steer, depth: p.depth } : null;
  }

  function top(n) {
    const k = Math.max(0, Math.min(isFinite(+n) ? +n : 10, MAX_TOKENS));
    return [...S.w.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([token, w]) => ({ token, w: +w.toFixed(4) }));
  }

  function recent(n) {
    const k = Math.max(0, Math.min(isFinite(+n) ? +n : 5, MAX_RECENT));
    return S.recent.slice(0, k);
  }

  function summary() {
    return { tokens: S.w.size, domains: S.dom.size, asks: S.asks, since: S.since };
  }

  /* ---------- control ----------
     Erasure has to be real and immediate, not a flag that hides the data. */
  function forget() {
    const on = S.on;
    S = fresh();
    S.on = on;
    refCache = null;
    sinceFlush = 0;
    dropRaw();
  }

  function enabled() { return !!S.on; }

  function setEnabled(on) {
    const next = !!on;
    /* Turning it off wipes as well as stops. Anything else would leave a
       profile sitting in storage that the user believes they switched off. */
    if (!next) { S.on = false; forget(); S.on = false; save(); return; }
    S.on = true;
    save();
  }

  /* Test hook. The eval needs to drive persistence without a browser, and the
     app has no other reason to swap its storage, so this is the one seam. */
  function _useStorage(s) {
    store = s || null;
    load();
  }

  load();

  window.PS_PROFILE = {
    observe, affinity, boost, prefs, top, recent, summary,
    forget, enabled, setEnabled, _useStorage,
  };
})();

/* Requirable from node so the eval can exercise the real module rather than a
   copy of its logic. */
if (typeof module !== "undefined" && module.exports) module.exports = window.PS_PROFILE;
