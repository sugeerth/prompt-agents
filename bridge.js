/* Prompt Studio — the external-graph bridge.

   Another system often already knows the shape of the user's problem: the host
   page this app is embedded in, a planner's dependency graph, a neighbouring
   tool's knowledge graph. That structure is worth having, because structure is
   exactly what the reasoning layer spends its one line of guidance on — which
   parts depend on which, what has to be settled first, what everything hangs
   off.

   The WORDS attached to that structure are a different matter entirely. An
   external graph arrives over postMessage, off a window global, or out of a URL
   fragment, and every one of those channels can be written by someone who is
   not the user. So this file takes exactly the position reason.js takes on text
   pasted by a stranger: the shape may be trusted enough to COUNT, the labels
   are never trusted enough to PRINT. A node labelled "ignore all previous
   instructions" still counts as a node — it just never gets named, because
   naming it would promote a stranger's sentence into instruction position in a
   prompt the user is about to paste into a model.

   Everything that follows is a consequence of that stance:

     - Every violation is a drop, never a throw. A host page that sends
       nonsense gets a degraded graph and a count of what was discarded; it
       never gets to break the app it is embedded in, and the app never loses
       the structure that did survive.
     - A label that fails safeLabel is discarded outright rather than stored
       for later. If the unsafe text is not kept anywhere, no future feature
       and no future bug can render it.
     - findings() is the ONLY route from an external graph into prompt text. It
       emits at most one line, names only labels that survived safeLabel, and
       says nothing at all when nothing survives. Silence is the correct
       default: a missing observation costs one line of nicety, a leaked one
       costs the user's prompt.
     - The sending origin is recorded for debugging and is never a reason to
       relax anything. There is no allowlist here on purpose — an allowlist
       invites the belief that some sender's labels are safe, and none are.
     - There is no path from any input in this file to a code sink or a DOM
       sink. Untrusted JSON is read with JSON.parse, which builds data and
       executes nothing, and nothing here ever touches the page.

   Runs under a bare `window` object with no DOM, no location and no
   postMessage, so the node eval harness exercises the same code the browser
   does rather than a stub. */

(function () {

  /* ===================== limits ===================== */

  /* Caps exist to keep a hostile or careless payload from hanging the tab. The
     app's own graphs are 3-15 nodes; 200/600 is far past anything a real host
     would send and still small enough that every algorithm below stays
     instant. Overflow is dropped rather than rejected, because a truncated
     graph is still useful and an outright rejection loses structure the user
     could have had. */
  const MAX_NODES = 200;
  const MAX_EDGES = 600;

  /* Caps alone are not enough: an array of ten million entries costs real time
     to walk even when only the first 200 are kept. Scanning stops at these
     windows and everything past them is counted as dropped from the declared
     length, which stays accurate without touching a single further entry. */
  const SCAN_NODES = 5000;
  const SCAN_EDGES = 20000;

  /* A megabyte label is a denial-of-service dressed up as a name. Only 24
     characters can ever survive sanitizing, so nothing is lost by refusing to
     look further than this. */
  const MAX_LABEL_READ = 200;

  /* A URL fragment is user-visible and user-editable; past this size it is not
     a graph someone meant to share, and parsing it would block the first
     paint. */
  const MAX_FRAGMENT = 128 * 1024;

  /* One emitted line, hard-capped. The cap is a backstop, not the mechanism —
     sanitized labels are 24 characters each, so a legitimate line lands near
     70. Anything longer means something upstream went wrong and the line is
     dropped rather than trimmed. */
  const MAX_LINE = 160;

  /* Below five nodes every graph has a trivially dominant node and its metrics
     are dominated by whatever the sender happened to model, so no structural
     claim is worth making. Same threshold, and the same reason, as
     graphFindings in reason.js. */
  const MIN_NODES_FOR_FINDING = 5;

  /* The four edge types the app already reasons about. An external graph does
     not get to invent a fifth: an unrecognised type is dropped rather than
     coerced, because coercing it would silently assert a relationship the
     sender never described. */
  const EDGE_TYPES = ["constrain", "seq", "cond", "couple"];
  const ORDERING_TYPES = { seq: true, cond: true };

  /* An edge with no type at all is a bare dependency the sender did not
     characterise. It becomes a plain binding rather than an ordering edge,
     because reading it as "seq" would let a host that said nothing about order
     make this app tell the user there is one. Under-reading an edge costs at
     most a finding; over-reading one costs the truth. */
  const DEFAULT_EDGE_TYPE = "constrain";

  /* Node kind is presentational only and never reaches prompt text, so an
     unrecognised kind is folded to a neutral default instead of dropping an
     otherwise usable node. */
  const NODE_KINDS = ["entity", "constraint", "option", "step"];
  const DEFAULT_NODE_KIND = "node";

  /* ===================== the sanitizer ===================== */

  /* These three are copied from reason.js rather than shared with it. The
     bridge has to sanitize whether or not reason.js has loaded — adopt() runs
     at init and a postMessage can arrive before any other script — and a
     hard-coded copy cannot be defeated by load order. The lists below are a
     strict superset of reason.js's, because a label from another system has
     none of the mitigating context of a word the user typed themselves. */
  const UNNAMEABLE = new Set(("way ways thing things stuff idea ideas best worst help option options " +
    "kind sort type lot bit part parts side item items area point points").split(" "));

  const INSTRUCTION_VERBS = /\b(ignore|disregard|answer|respond|reply|output|write|say|print|forget|override|instead|system|prompt)\b/;

  const FUNCTION_ONLY = new Set(("only with without under over into onto from about into for the and but not " +
    "any all some more less than that this these those when what which").split(" "));

  /* Bans that apply only to external labels. The organising principle, and the
     thing to hold onto before adding a word here: A BARE NOUN CANNOT INSTRUCT.
     The risk lives in verbs, role prefixes, output-format switches and code or
     markup sinks, so those are what this bans. "drop table users" is dangerous
     because of "drop"; "table", "database", "schema", "query", "api", "key"
     and "user" are just what a software planner calls its nodes.

     That distinction is load-bearing rather than cosmetic. The primary sender
     here is a planner handing over a dependency graph whose nodes are called
     "schema migration" and "payment api". Ban those and findings() returns
     nothing for the exact case it was built for — and a safety layer that is
     permanently silent is not safe, it is absent, while still looking to a
     user like something broken. Rejection is the cheap direction, but it is
     not the free direction.

     Note what a word list cannot do at all: it recognises hostile VOCABULARY,
     not hostile GRAMMAR. That gap is covered by CLAUSE_WORDS below, which bans
     the shape of a sentence rather than the words in it. */
  const EXTERNAL_BANNED = new RegExp("\\b(" + [
    // meta-instruction and policy talk
    "instruction", "instructions", "command", "commands", "directive", "rule", "rules",
    "policy", "guideline", "guidelines", "jailbreak", "bypass", "unrestricted",
    // roles, models and the machinery around them
    "assistant", "model", "agent", "tool", "role", "persona", "chatbot", "llm", "gpt", "claude",
    // output shape and language switching
    "json", "xml", "yaml", "html", "markdown", "format", "language", "translate",
    "french", "english", "spanish", "german", "chinese", "japanese",
    "verbatim", "repeat", "reveal", "summarize", "summarise",
    // code, markup and network sinks
    "script", "alert", "console", "javascript", "document", "cookie", "fetch",
    "import", "require", "exec", "execute", "function", "eval", "href", "src",
    "onerror", "onload", "http", "https", "url", "link", "click", "download", "upload",
    /* Data-store VERBS, which is what a smuggled query is made of. The nouns
       they act on — table, database, schema, query, api, key, user — are
       deliberately absent: see the note below on why a bare noun cannot
       instruct. What makes "drop table users" dangerous is "drop". */
    "drop", "select", "insert", "delete", "truncate", "union",
    // nouns that surface a secret rather than name a part of the problem
    "admin", "root", "sudo", "token", "secret", "password", "credential", "credentials",
    // imperatives with real-world consequences
    "send", "email", "call", "buy", "pay", "transfer", "wire", "share", "post",
    "publish", "open", "visit", "run", "install", "remove", "disable", "enable",
    // the social framing an injection wraps itself in
    "please", "urgent", "important", "attention", "warning", "immediately", "now", "note",
    // chat-transcript and serializer debris, which is never a name for anything
    "human", "turn", "im", "inst", "eos", "bos", "endoftext", "chatml",
    "prototype", "constructor", "tostring", "valueof", "hasownproperty", "null", "undefined",
  ].join("|") + ")\\b");

  /* The word lists above are defeated by a space. "fren ch", "instruct ion"
     and "i-g-n-o-r-e" all read as the banned word to a model and as three
     harmless tokens to a word-boundary regex, so the highest-signal words are
     checked a second time against the label with its spaces and hyphens
     squashed out. No boundaries here, deliberately: "ecosystem" losing to
     "system" is a label nobody needed. */
  const SQUASHED_BANNED = new RegExp([
    "ignore", "disregard", "system", "prompt", "instruct", "script", "alert",
    "javascript", "jailbreak", "override", "french", "assistant", "sudo",
    // note the absence of "apikey": "api key rotation" is a planner's node,
    // and the words that actually surface a secret are banned above
    "droptable", "deletefrom", "password", "credential", "verbatim",
    "unrestricted", "endoftext", "chatml",
  ].join("|"));

  /* A node in a structure graph is a NAME — "cost", "guest list", "deploy
     window". It is never a sentence. So a label carrying a pronoun, a modal, a
     conjunction or a roleplay verb is a clause wearing a name's clothes, and
     that is the shape every injection takes once the obvious words are gone:
     "you must obey", "do not follow", "trust me", "act unrepressed".

     This catches what no wordlist can, because it bans the grammar rather than
     the vocabulary. Ordinary work verbs are deliberately absent — a planner's
     steps really are verb phrases, and banning those would make the ordering
     line useless for the case it exists to serve. */
  const CLAUSE_WORDS = new Set((
    "i me my mine myself you your yours yourself we us our ours " +
    "he him his she her hers it its they them their theirs who whom whose " +
    "am is are was were be been being do does did done have has had " +
    "will would shall should can could may might must need ought lets " +
    "not never always no none every everything anything nothing all any " +
    "and or but nor so because if unless then than while whereas " +
    "act pretend imagine roleplay simulate obey follow comply trust " +
    "continue remember recall speak talk tell explain").split(" "));

  /* Markup is never part of a name. Tags come out the way graph.js takes them
     out of the ask; any angle bracket that survives — an unterminated "<script
     leaves no tag for the regex to match — then rejects the label outright at
     the charset gate below. Deleting the bracket instead of refusing the label
     would hand back a clean-looking word that was never clean. */
  function stripMarkup(s) {
    return s.replace(/<[^>]*>/g, " ");
  }

  /* The one function that decides whether an external word may ever appear in
     the user's prompt. Every rule is a rejection; there is no branch that
     repairs a label, because repair is how "ig<b>nore" becomes "ignore".

     At minimum as strict as safeSlot in reason.js, plus the external list
     above, plus a compound check safeSlot does not make: a phrase containing
     an unnameable word ("best option") is as empty as the word alone. */
  function safeLabel(label) {
    if (typeof label !== "string") return null;

    let w = label.slice(0, MAX_LABEL_READ);
    w = stripMarkup(w);
    /* Fold lookalikes onto plain ASCII before the word lists run, so a
       fullwidth or ligatured spelling of a banned word is matched rather than
       merely rejected as exotic. Either outcome is safe; matching is the one
       that keeps the ban list honest. */
    if (typeof w.normalize === "function") w = w.normalize("NFKC");
    w = w.toLowerCase().replace(/\s+/g, " ").trim();

    if (w.length < 4 || w.length > 24) return null;
    /* Letters, digits, single spaces and interior hyphens only — anything else
       is a rejection, never a strip, so no punctuation-laden payload can be
       laundered clean. Requiring both ends to be alphanumeric also keeps a
       trailing dash out of the middle of a sentence, where it would read as
       punctuation the line never had. */
    if (!/^[a-z0-9][a-z0-9 -]*[a-z0-9]$/.test(w)) return null;
    if (w.indexOf("--") !== -1) return null;
    // no real word runs the same character four times; a wall of one letter is
    // padding, and padding in a name is someone testing the limits
    if (/(.)\1{3,}/.test(w)) return null;

    const words = w.split(" ");
    if (words.length > 3) return null;
    if (INSTRUCTION_VERBS.test(w)) return null;
    if (EXTERNAL_BANNED.test(w)) return null;
    if (SQUASHED_BANNED.test(w.replace(/[ -]/g, ""))) return null;
    if (words.some(x => CLAUSE_WORDS.has(x))) return null;
    if (UNNAMEABLE.has(w)) return null;
    if (words.some(x => UNNAMEABLE.has(x))) return null;
    // must carry at least one real content word, not just function words
    if (!words.some(x => x.length >= 4 && !FUNCTION_ONLY.has(x))) return null;
    // a bare number names nothing and reads as a quantity the ask never had
    if (/^[0-9 -]+$/.test(w)) return null;

    return w;
  }

  /* The source is a provenance label for the UI and the console. It is never
     prompt text and findings() never names it, so the slug only has to be
     inert wherever a UI might render it — hence the reduction to letters,
     digits and hyphens, capped short.

     The one extra gate is instruction verbs: a provenance label is allowed to
     be an arbitrary name, but "ignore-the-above" on screen is a phishing
     surface rather than a name, and falling back to a generic word costs a
     careless sender nothing. */
  function safeSource(s) {
    if (typeof s !== "string") return "external";
    const slug = s.slice(0, 64).toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24)
      .replace(/-+$/g, "");
    if (!slug) return "external";
    if (INSTRUCTION_VERBS.test(slug.replace(/-/g, " "))) return "external";
    return slug;
  }

  /* Origin is recorded so a developer can see where a graph came from. It is
     deliberately NOT consulted anywhere in the sanitizing path: treating a
     familiar origin as safer is how a single compromised embed turns into a
     prompt-injection channel. */
  function safeOrigin(o) {
    if (typeof o !== "string") return null;
    const v = o.slice(0, 128).trim();
    if (!v) return null;
    return /^[a-z0-9.:/_-]+$/i.test(v) ? v : "unknown";
  }

  function safeKind(k) {
    if (typeof k !== "string") return DEFAULT_NODE_KIND;
    const v = k.toLowerCase().trim();
    return NODE_KINDS.indexOf(v) !== -1 ? v : DEFAULT_NODE_KIND;
  }

  /* Ids never reach text; they exist only to resolve edges during ingest. A
     number and its decimal spelling are treated as the same id, because a host
     that types its nodes numerically and its edges as strings is being sloppy
     rather than hostile, and there is nothing to exploit either way. */
  function idOf(v) {
    if (typeof v === "string") {
      const s = v.slice(0, 128).trim();
      return s ? s : null;
    }
    if (typeof v === "number" && isFinite(v)) return String(v);
    return null;
  }

  /* ===================== drop accounting ===================== */

  /* Failure reasons are fixed strings chosen from this table and never built
     from the payload. Echoing "unexpected token X" back into the UI would put
     attacker-chosen text on screen through the one channel that is supposed to
     report that attacker-chosen text was refused. */
  const REASON = {
    notObject: "payload must be an object",
    isArray: "payload must be an object, not an array",
    noNodes: "payload.nodes must be an array",
    empty: "no usable nodes",
    unreadable: "payload could not be read",
    tooLarge: "payload too large",
    badJson: "fragment is not valid JSON",
  };

  /* Which bucket each drop reason rolls up into. `labels` is the odd one: the
     node survives and still counts structurally, only its text is discarded —
     which is precisely the behaviour this whole file exists to provide, so it
     is reported separately rather than hidden inside the node count. */
  const BUCKET = {
    nodeCap: "nodes", badNode: "nodes", dupNode: "nodes", unsafeLabel: "labels",
    edgeCap: "edges", badEdge: "edges", badType: "edges",
    unknownEndpoint: "edges", selfEdge: "edges", dupEdge: "edges",
  };

  function emptyDrops() {
    return {
      total: 0, nodes: 0, edges: 0, labels: 0,
      reasons: {
        nodeCap: 0, badNode: 0, dupNode: 0, unsafeLabel: 0,
        edgeCap: 0, badType: 0, badEdge: 0, unknownEndpoint: 0, selfEdge: 0, dupEdge: 0,
      },
    };
  }

  function drop(d, key, n) {
    const count = n === undefined ? 1 : n;
    if (!(count > 0)) return;
    d.reasons[key] += count;
    d[BUCKET[key]] += count;
    d.total += count;
  }

  /* A refusal still reports what it managed to count. A payload rejected for
     having no usable nodes is much easier to diagnose when the caller can see
     that all 500 of them were malformed. */
  function failure(reason, dropped) {
    return { ok: false, nodes: 0, edges: 0, dropped: dropped || emptyDrops(), reason };
  }

  /* ===================== structure ===================== */

  /* Longest chain of ordering edges, plus the path that witnesses it. Written
     here rather than borrowed from graph.js so the bridge has no load-order
     dependency on it — a postMessage can land before the rest of the app is
     parsed, and a bridge that throws in that window is worse than one that
     duplicates twenty lines.

     Kahn first: an ordering cycle is not an order, and graph.js takes the same
     position, because claiming a sequence that does not exist is worse than
     claiming none. */
  function orderingPath(n, edges) {
    const adj = [];
    for (let i = 0; i < n; i++) adj.push([]);
    const indeg = new Array(n).fill(0);
    for (const e of edges) {
      if (!ORDERING_TYPES[e.type]) continue;
      if (adj[e.from].indexOf(e.to) !== -1) continue;
      adj[e.from].push(e.to);
      indeg[e.to]++;
    }

    const queue = [];
    for (let v = 0; v < n; v++) if (!indeg[v]) queue.push(v);
    const order = [];
    // index cursor rather than shift(), which is quadratic at 200 nodes
    for (let head = 0; head < queue.length; head++) {
      const v = queue[head];
      order.push(v);
      for (const w of adj[v]) if (--indeg[w] === 0) queue.push(w);
    }
    if (order.length < n) return { length: 0, path: [] };

    const dist = new Array(n).fill(0), prev = new Array(n).fill(-1);
    for (const v of order) {
      for (const w of adj[v]) if (dist[v] + 1 > dist[w]) { dist[w] = dist[v] + 1; prev[w] = v; }
    }
    let end = 0;
    for (let v = 1; v < n; v++) if (dist[v] > dist[end]) end = v;
    if (!dist[end]) return { length: 0, path: [] };
    const path = [];
    for (let v = end; v !== -1 && v !== undefined; v = prev[v]) path.unshift(v);
    return { length: dist[end], path };
  }

  /* Mutually dependent pairs: either the sender said "couple" outright, or it
     drew edges in both directions, which is the same claim spelled
     structurally. This is the 2-cycle Tarjan finds in the app's own graph,
     computed directly because two nodes is the only cycle size that matters
     for the one line this file is allowed to emit. */
  function couplePairs(edges) {
    const directed = new Set();
    for (const e of edges) directed.add(e.from + ">" + e.to);
    const seen = new Set(), pairs = [];
    for (const e of edges) {
      if (e.type !== "couple" && !directed.has(e.to + ">" + e.from)) continue;
      const a = Math.min(e.from, e.to), b = Math.max(e.from, e.to);
      const key = a + "-" + b;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([a, b]);
    }
    return pairs;
  }

  function summarize(nodes, edges) {
    const n = nodes.length;
    const order = orderingPath(n, edges);
    const pairs = couplePairs(edges);

    const degree = new Array(n).fill(0);
    for (const e of edges) { degree[e.from]++; degree[e.to]++; }
    let hub = 0;
    for (let v = 1; v < n; v++) if (degree[v] > degree[hub]) hub = v;
    const sorted = degree.slice().sort((a, b) => a - b);

    return {
      depth: order.length,
      path: order.path,
      coupled: pairs.length,
      pairs,
      hub: n ? hub : -1,
      maxDegree: n ? degree[hub] : 0,
      medianDegree: n ? sorted[Math.floor(n / 2)] : 0,
    };
  }

  /* ===================== ingest ===================== */

  let GRAPH = null;

  function ingestFrom(payload, source, origin) {
    const dropped = emptyDrops();

    if (payload === null || typeof payload !== "object") return failure(REASON.notObject);
    if (Array.isArray(payload)) return failure(REASON.isArray);

    /* The whole read is wrapped, because "read a property off an object the
       host page built" is not a safe operation: a getter can throw, an
       array-like can lie about its length, a proxy can do either on demand. A
       throw here would take out whatever called us — the UI at init, or the
       host's own message dispatcher — so it is converted into an ordinary
       drop like every other malformed input. */
    try {
      const rawNodes = payload.nodes;
      if (!Array.isArray(rawNodes)) return failure(REASON.noNodes);

      const nodes = [];
      const index = new Map();   // external id -> internal index; a Map so that
                                 // an id like "__proto__" is just a key
      let i = 0;
      const scanN = Math.min(rawNodes.length, SCAN_NODES);
      for (; i < scanN && nodes.length < MAX_NODES; i++) {
        const raw = rawNodes[i];
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) { drop(dropped, "badNode"); continue; }
        const id = idOf(raw.id);
        // a node with no usable id cannot be an edge endpoint, and a graph of
        // unreachable nodes is noise rather than structure
        if (id === null) { drop(dropped, "badNode"); continue; }
        if (index.has(id)) { drop(dropped, "dupNode"); continue; }

        const label = safeLabel(raw.label);
        if (label === null && raw.label !== undefined && raw.label !== null) drop(dropped, "unsafeLabel");

        index.set(id, nodes.length);
        /* The rejected text is not kept. An anonymous node still carries its
           full structural weight; keeping the original string "just in case"
           would leave a copy of hostile text inside the app's state, where any
           later feature could render it by accident. */
        nodes.push({ id: nodes.length, label, kind: safeKind(raw.kind), named: label !== null });
      }
      // whatever the scan never reached — over the cap, or past the scan
      // window — is a drop, counted from the declared length
      drop(dropped, "nodeCap", rawNodes.length - i);

      if (!nodes.length) return failure(REASON.empty, dropped);

      const edges = [];
      const rawEdges = Array.isArray(payload.edges) ? payload.edges : [];
      const seenEdge = new Set();
      let j = 0;
      const scanE = Math.min(rawEdges.length, SCAN_EDGES);
      for (; j < scanE && edges.length < MAX_EDGES; j++) {
        const raw = rawEdges[j];
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) { drop(dropped, "badEdge"); continue; }

        const fromId = idOf(raw.from), toId = idOf(raw.to);
        // an edge missing an endpoint entirely is malformed; an edge naming a
        // node that was dropped, capped or never declared asserts a
        // relationship between things this graph does not contain. Both are
        // drops, counted apart because they say different things about the
        // sender — one is a bug in their serializer, the other a graph that
        // did not survive the caps.
        if (fromId === null || toId === null) { drop(dropped, "badEdge"); continue; }
        const from = index.get(fromId), to = index.get(toId);
        if (from === undefined || to === undefined) { drop(dropped, "unknownEndpoint"); continue; }
        if (from === to) { drop(dropped, "selfEdge"); continue; }

        let type = raw.type;
        if (type === undefined || type === null) type = DEFAULT_EDGE_TYPE;
        else if (typeof type !== "string" || EDGE_TYPES.indexOf(type) === -1) { drop(dropped, "badType"); continue; }

        const key = from + ">" + to + ":" + type;
        if (seenEdge.has(key)) { drop(dropped, "dupEdge"); continue; }
        seenEdge.add(key);
        edges.push({ from, to, type });
      }
      drop(dropped, "edgeCap", rawEdges.length - j);

      GRAPH = {
        nodes, edges,
        source: safeSource(source === undefined || source === null ? payload.source : source),
        at: Date.now(),
        origin: safeOrigin(origin),
        stats: summarize(nodes, edges),
      };

      return { ok: true, nodes: nodes.length, edges: edges.length, dropped, reason: null };
    } catch (err) {
      /* A failed ingest deliberately leaves any previously stored graph alone.
         Half-reading a hostile payload must not be a way to wipe a good one. */
      return failure(REASON.unreadable);
    }
  }

  function ingest(payload, source) {
    return ingestFrom(payload, source, null);
  }

  /* Callers get a copy. The stored graph is the input to every safety decision
       below, so a caller holding a live reference to it — including a host page
       that can reach into this app's globals — must not be able to edit a label
       back in after it was sanitized out. */
  function current() {
    if (!GRAPH) return null;
    return {
      nodes: GRAPH.nodes.map(x => ({ id: x.id, label: x.label, kind: x.kind, named: x.named })),
      edges: GRAPH.edges.map(e => ({ from: e.from, to: e.to, type: e.type })),
      source: GRAPH.source,
      origin: GRAPH.origin,
      at: GRAPH.at,
    };
  }

  function clear() {
    GRAPH = null;
  }

  /* Structure only, no text of any kind. This is what the UI may show freely
     and what the reasoning layer may consult without going near a label. */
  function metrics() {
    if (!GRAPH) return null;
    const s = GRAPH.stats;
    return {
      nodes: GRAPH.nodes.length,
      edges: GRAPH.edges.length,
      depth: s.depth,
      coupled: s.coupled,
      /* An array even though ingest replaces rather than merges, so today it
         holds at most one slug. Merging several senders is the obvious next
         feature and the shape should not change under the UI when it lands. */
      sources: [GRAPH.source],
    };
  }

  /* ===================== the one line ===================== */

  /* Last gate before anything reaches a prompt. Every line below is built from
     sanitized parts already, so this can only fire if something upstream broke
     — which is exactly when a check like this earns its place. It fails closed:
     a suspect line is dropped, never trimmed into shape. */
  function line(text) {
    if (typeof text !== "string") return [];
    if (text.length > MAX_LINE) return [];
    if (/[\r\n]/.test(text)) return [];
    if (/[<>{}[\]|\\`$]/.test(text)) return [];
    return [{ text, kind: "graph" }];
  }

  /* At most one observation about the shape of the external graph, in the
     voice graphFindings uses: a statement about what the problem IS, never an
     instruction about how to answer it.

     Ordered by how much the finding changes the approach — a mutual dependency
     changes how the whole thing must be solved, a forced order changes what
     can be attempted first, a hub is the weakest hint and comes last.

     Unlike reason.js's version there is no slotless fallback. A generic line
     about a graph the user cannot see is a claim they have no way to check, so
     when no label survives sanitizing this layer says nothing at all. */
  function findings() {
    if (!GRAPH) return [];
    const nodes = GRAPH.nodes, s = GRAPH.stats;
    if (nodes.length < MIN_NODES_FOR_FINDING) return [];
    const name = i => (nodes[i] ? nodes[i].label : null);

    // quantities that constrain each other and cannot be settled in turn
    for (const pair of s.pairs) {
      const x = name(pair[0]), y = name(pair[1]);
      if (x && y && x !== y)
        return line(`${x} and ${y} depend on each other — fixing one changes what the other can be.`);
    }

    /* A real dependency chain. Every named step in the reported prefix must
       have survived sanitizing: reason.js filters unsafe slots out of its
       path, which is defensible for the user's own words, but silently
       deleting a step from an ORDER supplied by someone else would misreport
       the very thing the line claims to describe. */
    if (s.depth >= 2 && s.path.length >= 3) {
      const seg = s.path.slice(0, 4).map(name);
      if (seg.length >= 3 && seg.every(Boolean) && new Set(seg).size === seg.length)
        return line("Resolve in order: " + seg.join(" → ") + ".");
    }

    /* One node both halves connect through. Gated hardest, because "most
       connected" is an artefact of how the sender chose to model things far
       more often than it is a fact about the problem. */
    if (nodes.length >= 6 &&
        s.maxDegree >= 0.5 * (nodes.length - 1) &&
        s.maxDegree >= 2 * Math.max(1, s.medianDegree)) {
      const hub = name(s.hub);
      if (hub) return line(`Everything here connects through ${hub} — change it and both sides change.`);
    }

    return [];
  }

  /* ===================== entry points ===================== */

  /* Every message shape other than the documented one is ignored in silence.
     A listener attached to a host page's window sees every message that page
     and its other embeds exchange, so "unrecognised" is the overwhelmingly
     common case and must be the cheapest one. */
  function listen(win) {
    const target = win || (typeof window !== "undefined" ? window : null);
    const detached = function () {};
    if (!target || typeof target.addEventListener !== "function") return detached;

    const handler = function (ev) {
      try {
        if (!ev || typeof ev !== "object") return;
        const data = ev.data;
        if (!data || typeof data !== "object" || Array.isArray(data)) return;
        if (data.type !== "ps:graph") return;
        const payload = data.payload;
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
        /* ev.origin is recorded, not checked. Any origin can host a page that
           sends this, so sanitizing is the whole defence and it does not vary
           by sender. */
        ingestFrom(payload, payload.source, ev.origin);
      } catch (err) {
        /* This handler runs inside the host page's event dispatch. Throwing
           here surfaces as an error in THEIR page for a message that was not
           even addressed to us. */
      }
    };

    target.addEventListener("message", handler, false);
    return function detach() {
      if (typeof target.removeEventListener === "function") target.removeEventListener("message", handler, false);
    };
  }

  /* JSON.parse builds data and runs nothing, which is the only reason a graph
     may be accepted from a URL fragment at all. */
  function parseJson(text) {
    try { return JSON.parse(text); } catch (err) { return undefined; }
  }

  /* A fragment is not a query string, so this parses it by hand rather than
     reaching for a URL API that may not exist in the eval harness. */
  function paramFromHash(hash, key) {
    if (typeof hash !== "string" || !hash) return null;
    const h = hash.charAt(0) === "#" ? hash.slice(1) : hash;
    for (const part of h.split("&")) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      if (part.slice(0, eq) !== key) continue;
      // a malformed percent-escape throws; that is a drop, not a crash
      try { return decodeURIComponent(part.slice(eq + 1)); } catch (err) { return null; }
    }
    return null;
  }

  /* The two non-postMessage entry points, both funnelled through the same
     ingest so there is exactly one sanitizing path in this file. A second
     path is how the first one gets bypassed.

     Returns the ingest result, or null when neither channel offered anything —
     a caller can then tell "no external graph" apart from "an external graph
     that was refused". */
  function adopt(win, loc) {
    const w = win || (typeof window !== "undefined" ? window : null);
    const l = loc || (w && w.location) || null;
    let last = null;

    try {
      if (w && w.PS_EXTERNAL_GRAPH && typeof w.PS_EXTERNAL_GRAPH === "object" && !Array.isArray(w.PS_EXTERNAL_GRAPH)) {
        last = ingestFrom(w.PS_EXTERNAL_GRAPH, w.PS_EXTERNAL_GRAPH.source, "window");
        if (last.ok) return last;
      }
    } catch (err) {
      // reading a property off the host's window can throw as easily as
      // reading one off its payload
      last = failure(REASON.unreadable);
    }

    let raw = null;
    try { raw = l ? paramFromHash(l.hash, "g") : null; } catch (err) { raw = null; }
    if (raw !== null) {
      if (raw.length > MAX_FRAGMENT) return failure(REASON.tooLarge);
      const parsed = parseJson(raw);
      if (parsed === undefined) return failure(REASON.badJson);
      last = ingestFrom(parsed, parsed && parsed.source, "fragment");
    }

    return last;
  }

  /* ===================== documented shape ===================== */

  /* Frozen so the UI and the docs read the same object and neither can edit it
     by accident. This is hygiene, not defence — a host page that wants to
     replace this whole module can simply do so, which is why nothing in this
     file trusts anything outside it. */
  function deepFreeze(o) {
    if (o && typeof o === "object") {
      for (const k of Object.keys(o)) deepFreeze(o[k]);
      Object.freeze(o);
    }
    return o;
  }

  const SCHEMA = deepFreeze({
    message: { type: "ps:graph", payload: "<payload>" },
    payload: {
      nodes: [{
        id: "string or number, required, unique within the payload",
        label: "string, optional — counted always, named only if it survives safeLabel",
        kind: "one of entity | constraint | option | step; anything else becomes 'node'",
      }],
      edges: [{
        from: "node id",
        to: "node id",
        type: "one of constrain | seq | cond | couple; anything else is dropped, absent means constrain",
      }],
      source: "string, optional — reduced to a short slug, never rendered raw and never named in a prompt",
    },
    limits: {
      nodes: MAX_NODES,
      edges: MAX_EDGES,
      labelChars: 24,
      labelWords: 3,
      fragmentBytes: MAX_FRAGMENT,
    },
    entryPoints: [
      "window.postMessage({type:'ps:graph', payload}) — see listen()",
      "window.PS_EXTERNAL_GRAPH = payload, set before load — see adopt()",
      "#g=<encodeURIComponent(JSON.stringify(payload))> — see adopt()",
    ],
    guarantees: [
      "every violation is a drop, reported in result.dropped; nothing throws",
      "a label that fails sanitizing is discarded, and its node still counts",
      "findings() emits at most one line and only names sanitized labels",
      "the sending origin is recorded and never relaxes any check",
    ],
  });

  const api = { ingest, current, clear, metrics, findings, listen, adopt, safeLabel, SCHEMA };

  if (typeof window !== "undefined") window.PS_BRIDGE = api;
  /* Same object either way — exporting `api` rather than reaching back through
     window keeps a bare require() from throwing when no window has been set
     up at all. */
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
