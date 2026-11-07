/* Prompt Studio — the counterfactual lab.

   Every other learning layer in this app can only tell you about settings it
   actually used. That is a real ceiling. The questions people actually have
   about a default are counterfactual ones:

     Should the cold-start default be Guided / Standard or Shaped / Standard?
     Is the router earning its place, or would always-take-the-favourite do?
     If I turned exploration off, what would it have cost me?

   Shipping an experiment to answer each of those takes weeks and spends real
   traffic on a setting you suspect is worse. Off-policy evaluation answers them
   from traffic you already have, because the router logs the probability it
   assigned to what it did. Re-weight each logged outcome by how likely the
   policy you are ASKING about would have been to do the same thing, and you
   get an unbiased estimate of a policy that was never run.

   This is the part people get wrong, so it is worth stating plainly: the
   estimate is only honest because the logging policy randomizes. Under a
   deterministic policy every alternative was taken with probability zero, the
   importance weight is a division by zero, and no amount of data fixes it —
   the question has no evidence behind it at all. router.js spends 8% of its
   decisions on exploration and that 8% is what buys every number below.

   Three estimators, because they fail differently:

     IPS    unbiased, and high-variance exactly when the two policies disagree
            most, which is when you most wanted the answer
     SNIPS  self-normalized; slightly biased, far steadier, and it cannot return
            a value outside the range of rewards you actually saw
     DR     doubly robust: a reward model carries the signal, importance
            weights correct the model's error. Right if EITHER is right

   And one number that decides whether to believe any of them: the effective
   sample size. 400 logged decisions under a policy that barely overlaps the one
   you are asking about can carry less information than 20 that do. ESS says so
   in a unit people already understand, and `credible` is false below a floor,
   because an estimate nobody should act on should not be rendered as if they
   should.

   Everything here is pure: no DOM, no storage, no network, and no third
   localStorage key — a counterfactual is a diagnostic you run, not state that
   accumulates about you. Same stance as chain.js. */

(function () {
  /* Below this, an estimate is reported but marked not credible. 30 is where
     the normal approximation behind the standard error starts being worth
     printing; under it the interval is a guess about a guess. */
  const MIN_ESS = 30;

  /* The same floor, applied per context rather than to the pool.

     This exists because the pooled number lied. A demo of this module asked
     what "always Shaped / Deep" would have scored, from 200 logged decisions
     across two domains. Pooled ESS came back 96 — comfortably credible — and
     the estimate was 0.917 against a true 0.555. The router picks Shaped/Deep
     constantly for code asks and almost never for cooking ones, so virtually
     all the evidence about it came from the half of the world where it is
     good. The estimator did exactly what it was told and silently answered a
     different question: not "what would this policy score", but "what would it
     score on code asks".

     Deficient support in a subpopulation is invisible to a pooled diagnostic,
     because the mass is real, it is just all in one place. So overlap is
     measured per context and credibility is gated on the WORST one. An
     estimate that cannot see half the world should not be rendered as though
     it can. */
  const MIN_CONTEXT_ESS = 15;

  /* No importance weight may exceed this. Clipping trades a little bias for a
     lot of variance, and the alternative is worse than biased: one logged
     decision the target policy loves and the logger almost never took can
     carry a weight of 80 and swing the whole estimate on its own. The clip is
     reported, because an estimate that silently discarded the tail of its own
     weight distribution is not one you should act on without knowing. */
  const MAX_WEIGHT = 20;

  const isNum = x => typeof x === "number" && isFinite(x);

  /* One logged decision. `p` is the probability the LOGGING policy gave the
     action it took — not a confidence, not a score. Records without a usable
     propensity are dropped rather than defaulted: a made-up propensity
     produces a confident wrong answer, which is worse than no answer. */
  function clean(log) {
    if (!Array.isArray(log)) return [];
    const out = [];
    for (const r of log) {
      if (!r || typeof r !== "object") continue;
      if (typeof r.arm !== "string" || !r.arm) continue;
      if (!isNum(r.p) || r.p <= 0 || r.p > 1) continue;
      if (!isNum(r.reward)) continue;
      out.push({ arm: r.arm, p: r.p, reward: r.reward,
                 ask: typeof r.ask === "string" ? r.ask : "",
                 domain: typeof r.domain === "string" ? r.domain : null });
    }
    return out;
  }

  /* The target policy, as a function from a logged decision to the probability
     IT would have given that decision's action. A deterministic policy is just
     one that returns 1 or 0 — which is allowed as a target (it is only the
     LOGGING policy that must randomize). */
  function weightsFor(log, target) {
    const rows = [];
    let clipped = 0;
    for (const r of log) {
      let q = 0;
      try { q = target(r); } catch (e) { q = 0; }
      if (!isNum(q) || q < 0) q = 0;
      let w = q / r.p;
      if (w > MAX_WEIGHT) { w = MAX_WEIGHT; clipped++; }
      rows.push({ ...r, q, w });
    }
    return { rows, clipped };
  }

  /* Kish's effective sample size. With equal weights it is just n; the more
     the weight mass concentrates on a few records, the smaller it gets. It is
     the honest answer to "how much evidence is behind this really?" */
  function effectiveSampleSize(weights) {
    let sum = 0, sumSq = 0;
    for (const w of weights) { sum += w; sumSq += w * w; }
    if (sumSq <= 0) return 0;
    return (sum * sum) / sumSq;
  }

  /* Inverse propensity scoring. Unbiased, and the variance is the problem. */
  function ips(rows) {
    if (!rows.length) return 0;
    let s = 0;
    for (const r of rows) s += r.w * r.reward;
    return s / rows.length;
  }

  /* Self-normalized IPS. Dividing by the sum of weights instead of n trades a
     small bias for much less variance, and bounds the estimate inside the
     range of rewards actually observed — so it can never claim a policy scores
     1.4 on a 0..1 reward, which plain IPS can and does. */
  function snips(rows) {
    let num = 0, den = 0;
    for (const r of rows) { num += r.w * r.reward; den += r.w; }
    return den > 0 ? num / den : 0;
  }

  /* Doubly robust. The reward model predicts what each action would have
     scored; the importance-weighted residual corrects wherever the model is
     wrong. Unbiased if EITHER the model or the propensities are right, which
     in practice is the difference between an estimate you can act on and one
     that moves 10 points depending on which arm got explored that week. */
  function doublyRobust(rows, model, arms) {
    if (!rows.length || typeof model !== "function") return snips(rows);
    /* DR's first term is the model's expected reward under the TARGET policy,
       which needs that policy's probability for EVERY action — not just the one
       the log happened to take. A target expressed as a bare number cannot
       supply that, and the first version of this function quietly treated the
       missing actions as probability zero. The baseline then collapsed toward
       nothing and DR returned 0.004 against a true 0.225, while SNIPS on the
       same data returned 0.213. A broken estimator that still returns a number
       is precisely what this file exists to prevent, so it now falls back to
       the estimator that is still valid instead. */
    if (!rows.some(r => r.targetProbs)) return snips(rows);
    let total = 0;
    for (const r of rows) {
      /* The model's expectation under the TARGET policy: what it thinks that
         policy would earn on this ask, across every action it might take. */
      let baseline = 0;
      for (const a of arms) {
        let pa = 0;
        try { pa = r.targetProbs ? (r.targetProbs[a] || 0) : (a === r.arm ? r.q : 0); } catch (e) { pa = 0; }
        if (!isNum(pa) || pa <= 0) continue;
        let m = 0;
        try { m = model(r, a); } catch (e) { m = 0; }
        baseline += pa * (isNum(m) ? m : 0);
      }
      let direct = 0;
      try { direct = model(r, r.arm); } catch (e) { direct = 0; }
      total += baseline + r.w * (r.reward - (isNum(direct) ? direct : 0));
    }
    return total / rows.length;
  }

  /* A reward model fitted on the log itself: the mean reward each action
     earned, shrunk toward the overall mean by how little evidence it has.
     Deliberately humble — a model that overfits the log would make DR agree
     with the log, which is exactly the failure DR exists to avoid. */
  function fitModel(log, strength) {
    const k = isNum(strength) ? strength : 4;
    const byArm = new Map();
    let total = 0, n = 0;
    for (const r of log) {
      const a = byArm.get(r.arm) || { s: 0, n: 0 };
      a.s += r.reward; a.n++;
      byArm.set(r.arm, a);
      total += r.reward; n++;
    }
    const grand = n ? total / n : 0;
    return (row, arm) => {
      const a = byArm.get(arm);
      if (!a || !a.n) return grand;
      return (a.s + k * grand) / (a.n + k);
    };
  }

  /* Evaluate a policy that was never run.

       log     [{ arm, p, reward, ask?, domain? }]  — p from the LOGGING policy
       target  (record) -> probability that policy gives record.arm, OR
               (record) -> { arm: probability, ... } for the full distribution,
               which DR uses to form a proper baseline

     Returns every estimator, the ESS, a standard error, and whether the whole
     thing is worth believing. */
  function evaluate(log, target, options) {
    const opts = options || {};
    const rows0 = clean(log);
    if (!rows0.length) {
      return { n: 0, ess: 0, credible: false, reason: "no usable logged decisions",
               contexts: [], weakestContext: null,
               ips: 0, snips: 0, dr: 0, logged: 0, clipped: 0, maxWeight: 0, se: 0, overlap: 0 };
    }

    /* Accept either shape of target: a probability, or a whole distribution. */
    const asProb = (r) => {
      const t = target(r);
      if (isNum(t)) return t;
      if (t && typeof t === "object") { r.targetProbs = t; return t[r.arm] || 0; }
      return 0;
    };
    const { rows, clipped } = weightsFor(rows0, asProb);

    const weights = rows.map(r => r.w);
    const ess = effectiveSampleSize(weights);
    const arms = opts.arms || [...new Set(rows.map(r => r.arm))];
    const model = opts.model || fitModel(rows0, opts.shrink);

    const estSnips = snips(rows);
    /* Standard error of the self-normalized estimate. Reported with the number
       rather than separately, because a point estimate with no spread beside it
       invites exactly the over-reading this whole file exists to prevent. */
    let varNum = 0, den = 0;
    for (const r of rows) { varNum += r.w * r.w * Math.pow(r.reward - estSnips, 2); den += r.w; }
    const se = den > 0 ? Math.sqrt(varNum) / den : 0;

    let loggedMean = 0;
    for (const r of rows0) loggedMean += r.reward;
    loggedMean /= rows0.length;

    const maxWeight = weights.reduce((a, b) => Math.max(a, b), 0);
    const overlap = rows.filter(r => r.q > 0).length / rows.length;

    /* Per-context support. The context key defaults to the domain, which is the
       partition that matters for this app; callers with a different one pass
       `contextOf`. A context the target policy would act in, but which the log
       barely covers, makes the whole estimate an answer about somewhere else. */
    const contextOf = opts.contextOf || (r => (r.domain == null ? "" : String(r.domain)));
    const byContext = new Map();
    for (const r of rows) {
      const k = contextOf(r);
      const c = byContext.get(k) || { w: [], n: 0, covered: 0 };
      c.w.push(r.w); c.n++; if (r.q > 0) c.covered++;
      byContext.set(k, c);
    }
    const contexts = [...byContext.entries()].map(([key, c]) => ({
      key,
      n: c.n,
      ess: +effectiveSampleSize(c.w).toFixed(1),
      overlap: +(c.covered / c.n).toFixed(3),
    })).sort((a, b) => a.ess - b.ess);
    const weakest = contexts[0] || null;
    const contextOk = byContext.size <= 1 || !weakest || weakest.ess >= MIN_CONTEXT_ESS;

    const credible = ess >= MIN_ESS && contextOk;
    let reason = null;
    if (ess < MIN_ESS) {
      reason = `effective sample size ${ess.toFixed(1)} is below ${MIN_ESS}: these two policies `
        + `barely overlap, so the log has little to say about this one`;
    } else if (!contextOk) {
      reason = `the pooled evidence looks sufficient, but context "${weakest.key}" has an `
        + `effective sample size of only ${weakest.ess} — almost everything known about this `
        + `policy comes from somewhere else, so the estimate is answering a narrower question `
        + `than the one asked`;
    }

    return {
      n: rows.length,
      ess: +ess.toFixed(1),
      credible,
      reason,
      contexts,
      weakestContext: weakest,
      ips: +ips(rows).toFixed(4),
      snips: +estSnips.toFixed(4),
      dr: +doublyRobust(rows, model, arms).toFixed(4),
      se: +se.toFixed(4),
      /* What the logs themselves averaged. Not an estimate of anything except
         the policy that produced them — shown because the gap between it and
         the estimates is the entire point of the exercise. */
      logged: +loggedMean.toFixed(4),
      clipped,
      maxWeight: +maxWeight.toFixed(2),
      overlap: +overlap.toFixed(3),
    };
  }

  /* Convenience targets, since the useful questions are nearly always one of
     these three shapes. */
  const always = (arm, arms) => (() => {
    /* A distribution rather than a bare probability, so doublyRobust can form
       a real baseline. Without `arms` it still works for IPS and SNIPS, which
       only ever ask about the action that was logged. */
    const d = {};
    for (const a of (arms || [arm])) d[a] = a === arm ? 1 : 0;
    return d;
  });
  const uniform = arms => (() => {
    const p = 1 / arms.length;
    const d = {};
    for (const a of arms) d[a] = p;
    return d;
  });
  const epsilonGreedy = (pick, arms, eps) => (r => {
    const best = pick(r);
    const share = eps / arms.length;
    const d = {};
    for (const a of arms) d[a] = share + (a === best ? 1 - eps : 0);
    return d;
  });

  window.PS_LAB = {
    evaluate, ips, snips, doublyRobust, effectiveSampleSize, fitModel,
    always, uniform, epsilonGreedy,
    MIN_ESS, MIN_CONTEXT_ESS, MAX_WEIGHT,
  };
})();

/* Requirable from node so the eval exercises the real module. */
if (typeof module !== "undefined" && module.exports) module.exports = window.PS_LAB;
