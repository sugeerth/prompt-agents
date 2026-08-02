/* Prompt Studio — the intent graph and the classical algorithms over it.

   The previous version counted cue matches and called the total a "graph".
   This builds an actual typed, directed multigraph and runs real algorithms on
   it, because the structure is what tells us how to help:

     Tarjan SCC          mutually constraining quantities ("balance cost
                         against speed" is a genuine 2-cycle, not a keyword)
     topological sort    the order sub-answers must be resolved in
     + longest path      the critical path through those dependencies
     PageRank            which node the rest of the ask hangs off — the crux
     components          sub-problems that are independent and can be
                         answered without reference to each other
     articulation pts    the single node whose resolution unblocks the rest

   Algorithms are written against a plain adjacency structure, independent of
   any text parsing, so they can be unit-tested on known graphs.

   Every function here is O(V+E) or a bounded power iteration; the graphs are
   3-15 nodes, so the whole analysis is well under a millisecond. */

(function () {

  /* ===================== generic graph algorithms ===================== */

  /* Tarjan's strongly connected components. Returns an array of components,
     each an array of node indices, in reverse topological order.
     Iterative — recursion would blow the stack on pathological input and
     cannot be trusted with user-supplied text. */
  function tarjanSCC(n, adj) {
    const index = new Array(n).fill(-1), low = new Array(n).fill(0);
    const onStack = new Array(n).fill(false), stack = [];
    const out = [];
    let counter = 0;

    for (let root = 0; root < n; root++) {
      if (index[root] !== -1) continue;
      // frame: [node, next-neighbour-pointer]
      const work = [[root, 0]];
      while (work.length) {
        const frame = work[work.length - 1];
        const v = frame[0];
        if (frame[1] === 0) {
          index[v] = low[v] = counter++;
          stack.push(v); onStack[v] = true;
        }
        let recursed = false;
        const nbrs = adj[v] || [];
        while (frame[1] < nbrs.length) {
          const w = nbrs[frame[1]++];
          if (index[w] === -1) { work.push([w, 0]); recursed = true; break; }
          else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
        }
        if (recursed) continue;
        if (low[v] === index[v]) {
          const comp = [];
          for (;;) {
            const w = stack.pop(); onStack[w] = false; comp.push(w);
            if (w === v) break;
          }
          out.push(comp);
        }
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1][0];
          low[parent] = Math.min(low[parent], low[v]);
        }
      }
    }
    return out;
  }

  /* Longest path (in edges) through a DAG, plus one witnessing path.
     Cycles must be condensed away first — see analyze(). */
  function longestPath(n, adj) {
    if (!n) return { length: 0, path: [] };
    const indeg = new Array(n).fill(0);
    for (let v = 0; v < n; v++) for (const w of adj[v] || []) indeg[w]++;
    const queue = [];
    for (let v = 0; v < n; v++) if (!indeg[v]) queue.push(v);
    const order = [];
    while (queue.length) {
      const v = queue.shift();
      order.push(v);
      for (const w of adj[v] || []) if (--indeg[w] === 0) queue.push(w);
    }
    if (order.length < n) return { length: 0, path: [] };   // not a DAG
    const dist = new Array(n).fill(0), prev = new Array(n).fill(-1);
    for (const v of order) {
      for (const w of adj[v] || []) {
        if (dist[v] + 1 > dist[w]) { dist[w] = dist[v] + 1; prev[w] = v; }
      }
    }
    let end = 0;
    for (let v = 1; v < n; v++) if (dist[v] > dist[end]) end = v;
    const path = [];
    // prev[] is -1 at a source; guard undefined too so a malformed adjacency
    // can never spin here
    for (let v = end; v !== undefined && v !== -1; v = prev[v]) path.unshift(v);
    return { length: dist[end] || 0, path: dist[end] ? path : [] };
  }

  /* PageRank by power iteration. Dangling nodes redistribute uniformly, so
     the vector always sums to 1 regardless of graph shape. */
  function pageRank(n, adj, damping, iters) {
    if (!n) return [];
    damping = damping === undefined ? 0.85 : damping;
    iters = iters === undefined ? 40 : iters;
    let rank = new Array(n).fill(1 / n);
    const out = adj.map(a => (a || []).length);
    for (let it = 0; it < iters; it++) {
      const next = new Array(n).fill(0);
      let dangling = 0;
      for (let v = 0; v < n; v++) {
        if (!out[v]) { dangling += rank[v]; continue; }
        const share = rank[v] / out[v];
        for (const w of adj[v]) next[w] += share;
      }
      const base = (1 - damping) / n + damping * dangling / n;
      for (let v = 0; v < n; v++) next[v] = base + damping * next[v];
      rank = next;
    }
    return rank;
  }

  /* Connected components over the UNDIRECTED view — two parts of an ask with
     no edge between them are genuinely separate questions. */
  function components(n, adj) {
    const und = Array.from({ length: n }, () => []);
    for (let v = 0; v < n; v++) for (const w of adj[v] || []) { und[v].push(w); und[w].push(v); }
    const comp = new Array(n).fill(-1);
    let c = 0;
    for (let v = 0; v < n; v++) {
      if (comp[v] !== -1) continue;
      const stack = [v]; comp[v] = c;
      while (stack.length) {
        const x = stack.pop();
        for (const y of und[x]) if (comp[y] === -1) { comp[y] = c; stack.push(y); }
      }
      c++;
    }
    const groups = Array.from({ length: c }, () => []);
    comp.forEach((g, v) => groups[g].push(v));
    return groups;
  }

  /* Articulation points (Hopcroft-Tarjan) on the undirected view: nodes whose
     removal disconnects the ask. Iterative, for the same reason as above. */
  function articulationPoints(n, adj) {
    const und = Array.from({ length: n }, () => new Set());
    for (let v = 0; v < n; v++) for (const w of adj[v] || []) { und[v].add(w); und[w].add(v); }
    const g = und.map(s => [...s]);
    const disc = new Array(n).fill(-1), low = new Array(n).fill(0), parent = new Array(n).fill(-1);
    const isArt = new Array(n).fill(false);
    let timer = 0;

    for (let root = 0; root < n; root++) {
      if (disc[root] !== -1) continue;
      let rootChildren = 0;
      const work = [[root, 0]];
      disc[root] = low[root] = timer++;
      while (work.length) {
        const frame = work[work.length - 1];
        const v = frame[0];
        if (frame[1] < g[v].length) {
          const w = g[v][frame[1]++];
          if (disc[w] === -1) {
            parent[w] = v;
            if (v === root) rootChildren++;
            disc[w] = low[w] = timer++;
            work.push([w, 0]);
          } else if (w !== parent[v]) {
            low[v] = Math.min(low[v], disc[w]);
          }
        } else {
          work.pop();
          if (work.length) {
            const p = work[work.length - 1][0];
            low[p] = Math.min(low[p], low[v]);
            if (p !== root && low[v] >= disc[p]) isArt[p] = true;
          }
        }
      }
      if (rootChildren > 1) isArt[root] = true;
    }
    return isArt.map((a, i) => (a ? i : -1)).filter(i => i !== -1);
  }

  /* ===================== text → graph ===================== */

  const STOP = new Set(("a an the my our your his her its their this that these those i me we us you he she it they " +
    "is are was were be been being am do does did doing have has had having " +
    "of in on at to for from with by about into over under again further then once " +
    "and or but so as if than too very just also not no " +
    "how what why when where which who whom whose can could should would will shall may might must " +
    "me myself help give show tell make get need want please want wants " +
    // coupling cue words are the SIGNAL for an edge, never nodes themselves —
    // otherwise "balance cost against speed" names "balance" as a topic
    "balance balancing against versus vs weigh weighing weighs trade trading tradeoff tradeoffs off sacrificing " +
    "while both plan planning " +
    // structural function words and bare counts are never the subject of an ask
    "between among each other one two three four five six seven eight nine ten " +
    "pick choose decide deciding choosing option options thing things stuff").split(" "));

  const CONSTRAINT_RE = [
    /\bunder \$?\d+\w*/g, /\bover \$?\d+\w*/g, /\bless than \w+/g, /\bat least \w+/g, /\bat most \w+/g,
    /\bno more than \w+/g, /\bbudget\b/g, /\bcheap\b/g, /\bfree\b/g, /\btight\b/g, /\bsmall\b/g,
    /\bquick(ly)?\b/g, /\bfast\b/g, /\bwithin \w+/g, /\bin \d+ (day|week|month|hour|minute|year)s?\b/g,
    /\bwithout \w+/g, /\bavoid \w+/g, /\bonly \w+/g, /\bmust \w+/g,
    /\bkids?\b/g, /\bchildren\b/g, /\btoddlers?\b/g, /\bfamily\b/g,
    /\bvegan\b/g, /\bvegetarian\b/g, /\bgluten.?free\b/g, /\bnut allergy\b/g,
    /\bremote\b/g, /\bpart.?time\b/g, /\bfull.?time\b/g, /\blow.?carb\b/g,
  ];

  /* Pairs that pull against each other — the source of genuine cycles.
     Deliberately excludes "vs"/"versus"/"against": those mark a COMPARISON
     (pick one of these) which is a different structure from a mutual
     constraint (satisfy both at once, where improving one worsens the other). */
  const COUPLE_RE = [
    /\btrad(e|ing).?offs?\b/, /\bbalanc(e|ing)\b/, /\bwithout sacrificing\b/, /\bwhile (also |still )?\w+ing\b/,
    /\bat the same time\b/, /\bweigh(ing|s)?\b/, /\bboth\b.*\band\b/,
  ];

  const SEQ_RE = /\b(then|after|afterwards|before|next|finally|followed by|once)\b/;
  const COND_RE = /\b(if|unless|depending on|in case|whether|otherwise)\b/;

  const stem = w => w.replace(/(ies|ing|ed|s)$/, "").toLowerCase();

  function build(text) {
    const raw = text.trim().replace(/\s+/g, " ");
    const lower = raw.toLowerCase();

    const nodes = [];          // { id, type, label }
    const edges = [];          // { from, to, type }
    const byLabel = new Map();

    const addNode = (label, type) => {
      const key = type + ":" + stem(label);
      if (byLabel.has(key)) return byLabel.get(key);
      const id = nodes.length;
      nodes.push({ id, type, label });
      byLabel.set(key, id);
      return id;
    };
    const addEdge = (from, to, type) => {
      if (from === to || from == null || to == null) return;
      if (edges.some(e => e.from === from && e.to === to && e.type === type)) return;
      edges.push({ from, to, type });
    };

    /* Clauses give locality: a constraint binds the entities it sits beside,
       not every entity in the ask. The delimiter is CAPTURED, because the word
       that joins two clauses is exactly what says whether they are ordered
       ("then") or merely listed ("and") — splitting it away destroys the
       signal we most need. */
    const parts = lower.split(/\s*(,|;|\.|\band\b|\bbut\b|\bthen\b|\bafter\b|\bbefore\b|\bwith\b|\bfor\b|\bon\b)\s*/);
    const clauses = [], delims = [];
    for (let i = 0; i < parts.length; i++) {
      const piece = (parts[i] || "").trim();
      if (i % 2 === 0) { if (piece) { clauses.push(piece); delims.push(i ? parts[i - 1] : null); } }
    }

    // constraints first, so their words are not also counted as entities
    const constraintSpans = new Set();
    const clauseConstraints = clauses.map(() => []);
    clauses.forEach((clause, ci) => {
      for (const re of CONSTRAINT_RE) {
        const m = clause.match(re);
        if (!m) continue;
        for (const span of m) {
          constraintSpans.add(span.trim());
          clauseConstraints[ci].push(addNode(span.trim(), "constraint"));
        }
      }
    });

    const constraintWords = new Set();
    for (const s of constraintSpans) for (const w of s.split(/\s+/)) constraintWords.add(stem(w));

    const clauseEntities = clauses.map(clause => {
      const ids = [];
      for (const w of clause.replace(/[^a-z0-9$\s]/g, " ").split(/\s+/)) {
        if (w.length <= 2 || STOP.has(w) || constraintWords.has(stem(w)) || /^\d+$/.test(w)) continue;
        ids.push(addNode(w, "entity"));
      }
      return ids;
    });

    // CONSTRAIN: each constraint binds the entities beside it
    clauses.forEach((_, ci) => {
      for (const c of clauseConstraints[ci]) {
        const targets = clauseEntities[ci].length ? clauseEntities[ci] : clauseEntities.flat();
        for (const e of targets) addEdge(c, e, "constrain");
      }
    });

    // SEQ: an ordering delimiter makes the previous clause a prerequisite
    clauses.forEach((clause, ci) => {
      if (ci === 0) return;
      const joined = delims[ci] || "";
      if (!SEQ_RE.test(joined) && !SEQ_RE.test(clause)) return;
      const prev = clauseEntities[ci - 1], cur = clauseEntities[ci];
      if (prev.length && cur.length) addEdge(prev[prev.length - 1], cur[0], "seq");
    });

    // COND: a condition branches onto what follows it
    clauses.forEach((clause, ci) => {
      if (!COND_RE.test(clause) || ci + 1 >= clauses.length) return;
      const cur = clauseEntities[ci], nxt = clauseEntities[ci + 1];
      if (cur.length && nxt.length) addEdge(cur[0], nxt[0], "cond");
    });

    /* COUPLE: "balance X against Y" means X constrains Y AND Y constrains X.
       Encoding both directions is what makes Tarjan find a real 2-cycle — the
       mutual dependency is discovered by the algorithm, not asserted by a regex. */
    const coupled = COUPLE_RE.some(re => re.test(lower));
    if (coupled) {
      const ents = clauseEntities.flat();
      const cons = clauseConstraints.flat();
      const pool = (cons.length >= 2 ? cons : ents).slice(0, 4);
      for (let i = 0; i < pool.length; i++) {
        for (let j = i + 1; j < pool.length; j++) {
          addEdge(pool[i], pool[j], "couple");
          addEdge(pool[j], pool[i], "couple");
        }
      }
    }

    return { nodes, edges, clauses };
  }

  /* ===================== analysis ===================== */

  function adjacency(n, edges) {
    const adj = Array.from({ length: n }, () => []);
    for (const e of edges) if (!adj[e.from].includes(e.to)) adj[e.from].push(e.to);
    return adj;
  }

  function analyze(text) {
    const g = build(text);
    const n = g.nodes.length;
    const adj = adjacency(n, g.edges);

    const sccs = tarjanSCC(n, adj);
    const cyclic = sccs.filter(c => c.length > 1);

    /* Depth is measured over ORDERING edges only. A constraint binding an
       entity ("quick" → "recipe") is not a step that must happen before
       another step; counting it as depth would make every bounded ask look
       like a dependency chain. Only seq/cond edges order anything.
       Cycles are condensed away first — longest path is undefined on a
       cyclic graph. */
    const compOf = new Array(n).fill(0);
    sccs.forEach((c, i) => c.forEach(v => { compOf[v] = i; }));
    const ORDERING = new Set(["seq", "cond"]);
    const cAdj = Array.from({ length: sccs.length }, () => []);
    for (const e of g.edges) {
      if (!ORDERING.has(e.type)) continue;
      const a = compOf[e.from], b = compOf[e.to];
      if (a !== b && !cAdj[a].includes(b)) cAdj[a].push(b);
    }
    const critical = longestPath(sccs.length, cAdj);

    const rank = pageRank(n, adj);
    let crux = -1;
    for (let v = 0; v < n; v++) if (crux === -1 || rank[v] > rank[crux]) crux = v;
    // a crux only means something if it stands clear of the field
    const sorted = [...rank].sort((a, b) => b - a);
    const cruxMargin = sorted.length > 1 ? sorted[0] - sorted[1] : 0;

    const comps = components(n, adj).filter(c => c.length > 1);
    const arts = n >= 5 ? articulationPoints(n, adj) : [];

    const density = n > 1 ? +(g.edges.length / (n * (n - 1))).toFixed(3) : 0;
    const degree = new Array(n).fill(0);
    for (const e of g.edges) { degree[e.from]++; degree[e.to]++; }
    const maxDegree = degree.length ? Math.max(...degree) : 0;

    return {
      nodes: g.nodes, edges: g.edges,
      n, m: g.edges.length, density, maxDegree,
      sccs, cyclic,
      cycleGroups: cyclic.map(c => c.map(v => g.nodes[v].label)),
      depth: critical.length,
      criticalPath: critical.path.map(ci => sccs[ci].map(v => g.nodes[v].label).join("+")),
      independent: comps.length,
      independentGroups: comps.map(c => c.map(v => g.nodes[v].label)),
      crux: crux >= 0 ? g.nodes[crux].label : null,
      cruxMargin: +cruxMargin.toFixed(3),
      articulation: arts.map(v => g.nodes[v].label),
      constraints: g.nodes.filter(x => x.type === "constraint").length,
      entities: g.nodes.filter(x => x.type === "entity").map(x => x.label),
    };
  }

  const api = { build, analyze, tarjanSCC, longestPath, pageRank, components, articulationPoints, adjacency };
  if (typeof window !== "undefined") window.PS_GRAPH = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
