/* Unit tests for the graph algorithms, against graphs with known answers.

   The reasoning layer's conclusions are only as trustworthy as these. Each
   algorithm is checked on textbook cases first, then on real asks. */

const path = require('path');
const G = require(path.join(__dirname, '..', 'graph.js'));

let failures = 0;
const fail = m => { failures++; console.log('FAIL:', m); };
const ok = m => console.log('  ok:', m);
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : fail(`${m}\n     got ${JSON.stringify(a)}\n     want ${JSON.stringify(b)}`));

/* ---------- Tarjan SCC ---------- */
console.log('Tarjan SCC');
{
  // classic 3-SCC example: {0,1,2} {3,4} {5}
  const adj = [[1], [2], [0, 3], [4], [3], []];
  const sccs = G.tarjanSCC(6, adj).map(c => c.slice().sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
  eq(sccs, [[0, 1, 2], [3, 4], [5]], 'finds the three components');
}
{
  const adj = [[1], [2], [3], []];              // pure chain
  const big = G.tarjanSCC(4, adj).filter(c => c.length > 1);
  eq(big, [], 'a chain has no multi-node component');
}
{
  const adj = [[1], [0]];                        // mutual dependency
  const big = G.tarjanSCC(2, adj).filter(c => c.length > 1);
  eq(big.length, 1, 'a 2-cycle is one component');
}
{
  // self-loops and isolated nodes must not crash or merge
  const sccs = G.tarjanSCC(3, [[0], [], []]);
  eq(sccs.length, 3, 'self-loop and isolated nodes stay separate');
}

/* ---------- longest path ---------- */
console.log('Longest path');
{
  const adj = [[1, 2], [3], [3], [4], []];       // 0→1→3→4 = 3 edges
  const r = G.longestPath(5, adj);
  eq(r.length, 3, 'critical path length is 3 edges');
  eq(r.path[0], 0, 'path starts at the source');
  eq(r.path[r.path.length - 1], 4, 'path ends at the sink');
}
{
  const r = G.longestPath(3, [[1], [2], [0]]);   // cyclic
  eq(r.length, 0, 'a cyclic graph yields no path');
}
{
  const r = G.longestPath(3, [[], [], []]);
  eq(r.length, 0, 'an edgeless graph has depth 0');
}

/* ---------- PageRank ---------- */
console.log('PageRank');
{
  const rank = G.pageRank(3, [[2], [2], []]);    // everything points at 2
  const sum = rank.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-6) fail('rank does not sum to 1: ' + sum);
  else ok('rank sums to 1');
  if (!(rank[2] > rank[0] && rank[2] > rank[1])) fail('hub did not win: ' + JSON.stringify(rank));
  else ok('the node everything points at ranks highest');
}
{
  const rank = G.pageRank(4, [[1], [0], [3], [2]]);   // two symmetric pairs
  if (Math.abs(rank[0] - rank[1]) > 1e-6 || Math.abs(rank[2] - rank[3]) > 1e-6)
    fail('symmetric nodes got different rank');
  else ok('symmetric nodes rank equally');
}
{
  const rank = G.pageRank(3, [[], [], []]);      // all dangling
  const sum = rank.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-6) fail('dangling-only graph lost mass: ' + sum);
  else ok('dangling nodes preserve total mass');
}

/* ---------- components ---------- */
console.log('Components');
{
  const groups = G.components(5, [[1], [], [3], [], []]);   // {0,1} {2,3} {4}
  eq(groups.map(g => g.length).sort(), [1, 2, 2], 'splits into 2+2+1');
}
{
  const groups = G.components(3, [[1], [2], []]);
  eq(groups.length, 1, 'a connected chain is one component');
}

/* ---------- articulation points ---------- */
console.log('Articulation points');
{
  // path 0-1-2: node 1 is the cut vertex
  eq(G.articulationPoints(3, [[1], [2], []]), [1], 'middle of a path is an articulation point');
}
{
  // triangle: no cut vertex
  eq(G.articulationPoints(3, [[1], [2], [0]]), [], 'a cycle has no articulation point');
}

/* ---------- transitive reduction ---------- */
console.log('Transitive reduction');
{
  // 0→1→2 plus the shortcut 0→2: the shortcut is implied and must go
  const r = G.transitiveReduction(3, [[1, 2], [2], []]);
  eq(r[0], [1], 'drops the implied shortcut edge');
  eq(r[1], [2], 'keeps the edges that carry the path');
}
{
  const r = G.transitiveReduction(3, [[1], [2], [0]]);   // a cycle implies everything
  const kept = r.reduce((s, a) => s + a.length, 0);
  if (kept > 3) fail('reduction added edges to a cycle');
  else ok('a cycle survives reduction without gaining edges');
}

/* ---------- treewidth ---------- */
console.log('Treewidth (min-degree elimination)');
{
  // a path/tree has treewidth 1 — a chain of constraints is easy
  eq(G.treewidth(4, [[1], [2], [3], []]), 1, 'a chain has treewidth 1');
}
{
  // K4: every node touches every other — genuinely coupled
  const k4 = [[1, 2, 3], [2, 3], [3], []];
  if (G.treewidth(4, k4) < 3) fail('K4 treewidth under-reported: ' + G.treewidth(4, k4));
  else ok('a clique of 4 has treewidth 3');
}
{
  // this is the distinction density cannot make
  const chain = G.treewidth(5, [[1], [2], [3], [4], []]);
  const clique = G.treewidth(5, [[1, 2, 3, 4], [2, 3, 4], [3, 4], [4], []]);
  if (!(clique > chain)) fail(`treewidth failed to separate chain (${chain}) from clique (${clique})`);
  else ok(`separates 5 constraints in a chain (tw=${chain}) from 5 all touching (tw=${clique})`);
}
{
  eq(G.treewidth(1, [[]]), 0, 'a single node has treewidth 0');
}

/* ---------- graph built from real asks ---------- */
console.log('Graphs from real asks');
{
  const a = G.analyze('balance cost against speed');
  if (!a.cyclic.length) fail('mutual constraint produced no cycle: ' + JSON.stringify(a.cycleGroups));
  else ok('"balance X against Y" produces a genuine cycle: ' + JSON.stringify(a.cycleGroups[0]));
}
{
  const a = G.analyze('explain gravity');
  if (a.cyclic.length) fail('simple ask produced a spurious cycle');
  else ok('a simple ask has no cycle');
  if (a.depth > 1) fail('simple ask claimed dependency depth ' + a.depth);
  else ok('a simple ask has no dependency depth');
}
{
  const a = G.analyze('10 days in japan with kids on a tight budget');
  if (a.constraints < 2) fail('expected multiple constraints, got ' + a.constraints);
  else ok(`constrained ask yields ${a.constraints} constraint nodes over ${a.n} nodes`);
  if (!a.crux) fail('no crux identified');
  else ok('crux node: ' + a.crux);
}
{
  // an empty and a one-word ask must not throw or invent structure
  for (const q of ['', ' ', 'x', 'sourdough']) {
    const a = G.analyze(q);
    if (a.n > 2) fail(`"${q}" invented ${a.n} nodes`);
    if (a.cyclic.length) fail(`"${q}" invented a cycle`);
  }
  ok('degenerate input invents no structure');
}
{
  // hostile input must be handled as text, not executed or crash the parser
  const a = G.analyze('<script>alert(1)</script> budget kids '.repeat(8));
  if (!Number.isFinite(a.density)) fail('density went non-finite');
  else ok('hostile/repeated input parses safely (n=' + a.n + ')');
}

console.log(failures ? `\n${failures} FAILURES` : '\nALL GRAPH TESTS PASSED');
process.exit(failures ? 1 : 0);
