#!/usr/bin/env node
// crossover.mjs — the cached-prefix crossover.
//
// The question: for a given workload, at what cache-hit percentage does the
// model that is cheaper at zero cache become the more expensive one?
//
// Cache reads are billed far below fresh input, but not by the same factor for
// every model. So a model with a weak cached-read rate loses its advantage as
// the cache warms, and at some hit rate the two swap places. No calculator
// prints that number.
//
// Cost for N input tokens at cache-hit fraction f, plus M output tokens,
// with all rates in dollars per million tokens:
//
//   cost(f) = N * [ (1 - f)*in + f*cached ] + M*out
//           = N*in + M*out  -  f * N * (in - cached)
//             constant  k        linear in f, slope -s
//
// Two models, same workload (same N and M). Set costA(f) = costB(f):
//
//   f* = (kA - kB) / (sA - sB)      where k = N*in + M*out,  s = N*(in - cached)
//
//   f* < 0          the cheaper model is always cheaper; cache does not flip it
//   f* > 1          the cheaper model is always cheaper; the gap never closes
//   0 <= f* <= 1    a real crossover inside the operating range
//
// Reads data/pricing.json only. No network, no dependencies.
//
//   node scripts/crossover.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const dj = JSON.parse(readFileSync(join(HERE, "..", "data", "pricing.json"), "utf8"));
const models = dj.models;

function rate(m, f) {
  // Tiered models bill above a token threshold; this uses the base tier, which
  // is the right default for a crossover question (such workloads sit below any
  // 200k+ threshold).
  const r = m.usd_per_million_tokens;
  const perIn = (1 - f) * r.input + f * r.cached_input;
  return { perIn, perOut: r.output, saved: r.input - r.cached_input };
}

function cost(m, f, N, M) {
  const { perIn, perOut } = rate(m, f);
  return (N * perIn + M * perOut) / 1e6;
}

function crossover(a, b, N, M) {
  const ra = a.usd_per_million_tokens;
  const rb = b.usd_per_million_tokens;
  const ka = N * ra.input + M * ra.output;
  const kb = N * rb.input + M * rb.output;
  const sa = N * (ra.input - ra.cached_input);
  const sb = N * (rb.input - rb.cached_input);
  if (sa === sb) return null; // identical cache economics: no crossover exists
  return (ka - kb) / (sa - sb);
}

const pct = (x) => (x * 100).toFixed(1) + "%";
const money = (x) =>
  Math.abs(x) > 0 && Math.abs(x) < 0.01 ? "$" + x.toFixed(4) : "$" + x.toFixed(2);

// Workload shapes. The crossover moves a long way between them, so one number
// would be misleading.
const WORKLOADS = [
  { name: "chat  ·   2k in / 500 out", N: 2000, M: 500 },
  { name: "RAG   ·  50k in / 2k out", N: 50000, M: 2000 },
  { name: "batch · 500k in / 20k out", N: 500000, M: 20000 },
];

console.log("=".repeat(78));
console.log(`  CACHED-PREFIX CROSSOVER   (${models.length} models from data/pricing.json)`);
console.log("=".repeat(78));
console.log("\n  A crossover needs two models whose cache economics differ. Below: for");
console.log("  each workload, every pair whose cheaper-at-zero-cache model becomes the");
console.log("  pricier one at some real cache-hit rate.\n");

let found = 0;
const perWorkload = {};

for (const w of WORKLOADS) {
  perWorkload[w.name] = [];
  const rows = [];
  for (let i = 0; i < models.length; i++) {
    for (let j = i + 1; j < models.length; j++) {
      const a = models[i];
      const b = models[j];
      const [cheap, dear] =
        cost(a, 0, w.N, w.M) <= cost(b, 0, w.N, w.M) ? [a, b] : [b, a];
      const f = crossover(cheap, dear, w.N, w.M);
      if (f === null || f < 0 || f > 1) continue;
      // Only report flips that matter: cheap -> dear as the cache warms.
      if (cost(cheap, 1, w.N, w.M) >= cost(dear, 1, w.N, w.M)) rows.push({ cheap, dear, f });
    }
  }
  rows.sort((x, y) => x.f - y.f);
  perWorkload[w.name] = rows;

  console.log("  " + w.name);
  console.log("  " + "-".repeat(78));
  if (rows.length === 0) {
    console.log("    no pair crosses inside 0-100% cache hit");
  } else {
    for (const r of rows) {
      const at0 = cost(r.cheap, 0, w.N, w.M);
      const at1 = cost(r.cheap, 1, w.N, w.M);
      const d0 = cost(r.dear, 0, w.N, w.M) - at0;
      const d1 = cost(r.dear, 1, w.N, w.M) - at1;
      console.log(
        "    " + pct(r.f).padStart(6) + "   " +
          r.cheap.name.padEnd(24) + " <-> " + r.dear.name.padEnd(24) +
          "  saves " + money(Math.abs(d0)).padStart(9) + " at f=0,  " +
          money(Math.abs(d1)).padStart(9) + " at f=1"
      );
      found++;
    }
  }
  console.log("");
}

console.log("=".repeat(78));
console.log(`  ${found} crossover points across ${WORKLOADS.length} workloads`);
console.log("=".repeat(78));

// The headline: skip degenerate f≈0 and f≈1 pairs; lead with the crossover
// closest to the middle of the operating range, which a reader can act on.
const rag = perWorkload["RAG   ·  50k in / 2k out"] || [];
const mid = rag
  .filter((r) => r.f > 0.05 && r.f < 0.95)
  .sort((x, y) => Math.abs(x.f - 0.5) - Math.abs(y.f - 0.5))[0];
if (mid) {
  console.log("\n  HEADLINE");
  console.log("  --------");
  console.log(
    `  In a 50k-in / 2k-out workload, ${mid.cheap.name} is cheaper than\n` +
      `  ${mid.dear.name} at zero cache hit and more expensive once cache hit\n` +
      `  reaches ${pct(mid.f)}.`
  );
}

// The structural fact behind every crossover: how much a cache hit saves per model.
console.log("\n  CACHE READ DISCOUNT BY MODEL  (how much cheaper a cache hit is)");
console.log("  " + "-".repeat(78));
const disc = models
  .map((m) => ({
    name: m.name,
    provider: m.provider,
    ratio: m.usd_per_million_tokens.input / m.usd_per_million_tokens.cached_input,
  }))
  .sort((x, y) => y.ratio - x.ratio);
const maxRatio = Math.max(...disc.map((x) => x.ratio));
for (const d of disc) {
  const bar = "#".repeat(Math.round((d.ratio / maxRatio) * 40));
  console.log(
    "    " + d.ratio.toFixed(2).padStart(6) + "x  " +
      d.provider.padEnd(10) + d.name.padEnd(26) + " " + bar
  );
}
console.log("\n  A higher ratio means cache hits help that model more.");
console.log("  A model with a low ratio is the one that stops being worth it first.\n");
