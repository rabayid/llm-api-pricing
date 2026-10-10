#!/usr/bin/env node
// validate.mjs — zero-dependency validator for data/pricing.json.
//
// This is the gate every contribution passes through. The point is not to be a
// generic JSON Schema runner; it is to catch the specific ways a hand-edited
// pricing row goes wrong:
//
//   * a rate with no source URL (unfalsifiable provenance)
//   * a cached rate that costs more than fresh input (impossible)
//   * a long-context tier cheaper than the base tier (a tier is a surcharge)
//   * a promotional rate with no end date (a pricing bug, not a data quirk)
//   * a model priced at zero to mean "no batch tier" (never: flag it instead)
//
// Exit code is 1 on any failure so CI fails the pull request.
//
//   node scripts/validate.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "..", "data", "pricing.json");

let failures = 0;
const check = (label, cond, note = "") => {
  if (!cond) failures++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${note ? "   [" + note + "]" : ""}`);
};

let doc;
try {
  doc = JSON.parse(readFileSync(DATA, "utf8"));
  console.log("  PASS  data/pricing.json parses as JSON");
} catch (e) {
  console.error("  FAIL  data/pricing.json does not parse: " + e.message);
  process.exit(1);
}

// --------------------------------------------------------------------------
console.log("\nDATASET");
check("has a dataset description", typeof doc.dataset === "string" && doc.dataset.length > 0);
check("has a publisher", typeof doc.publisher === "string" && doc.publisher.length > 0);
check("homepage is https", /^https:\/\//.test(doc.homepage || ""), doc.homepage || "missing");
check("currency is USD", doc.currency === "USD", doc.currency || "missing");
check("states its unit", typeof doc.unit === "string" && doc.unit.length > 0, doc.unit || "missing");
check("carries a verification date", typeof doc.prices_verified === "string" && doc.prices_verified.length > 0, doc.prices_verified || "missing");
check("carries an accuracy note", typeof doc.accuracy_note === "string" && doc.accuracy_note.length > 0);
check("providers is a non-empty array", Array.isArray(doc.providers) && doc.providers.length > 0);
check("models is a non-empty array", Array.isArray(doc.models) && doc.models.length > 0);
check("model_count matches models.length", doc.model_count === doc.models.length, `${doc.model_count} vs ${doc.models.length}`);
check("provider_pricing_urls is present", !!doc.provider_pricing_urls);

for (const p of doc.providers || []) {
  const u = doc.provider_pricing_urls?.[p];
  check(`provider "${p}" has an https pricing page`, /^https:\/\//.test(u || ""), u || "missing");
}

// --------------------------------------------------------------------------
// Row-level checks. Collected, not thrown, so one bad row does not hide the
// next one — a contributor should see everything wrong in a single run.
console.log("\nMODELS");
const ids = new Set();
const problems = [];
const push = (id, msg) => problems.push(`${id}: ${msg}`);

for (const m of doc.models) {
  const r = m.usd_per_million_tokens || {};
  const where = m.id || "(missing id)";

  if (typeof m.id !== "string" || !m.id) push(where, "missing string id");
  if (ids.has(m.id)) push(where, "duplicate id");
  ids.add(m.id);

  if (typeof m.name !== "string" || !m.name) push(where, "missing name");
  if (!doc.providers.includes(m.provider)) push(where, `provider "${m.provider}" is not in providers[]`);
  if (!(m.context_window_tokens > 0)) push(where, "context_window_tokens must be > 0");

  if (!(r.input > 0)) push(where, "input price must be > 0");
  if (!(r.output > 0)) push(where, "output price must be > 0");
  if (r.cached_input != null && !(r.cached_input >= 0)) push(where, "cached_input must be >= 0");
  if (r.cached_input != null && r.cached_input > r.input) push(where, `cached_input (${r.cached_input}) cannot exceed input (${r.input})`);
  if (r.cache_write != null && !(r.cache_write >= 0)) push(where, "cache_write must be >= 0");

  if (!/^https:\/\//.test(m.pricing_url || "")) push(where, "pricing_url must be an https URL");
  if (m.promotional && !m.promotion_ends) push(where, "promotional rate with no promotion_ends date");
  if (m.supports_batch_api === undefined) push(where, "supports_batch_api must be explicit true/false");

  if (m.long_context_tier) {
    const t = m.long_context_tier;
    const tr = t.usd_per_million_tokens || {};
    if (!(t.threshold_tokens > 0)) push(where, "long_context_tier.threshold_tokens must be > 0");
    if (!(tr.input >= r.input)) push(where, `long-context input (${tr.input}) should be >= base input (${r.input})`);
    if (!(tr.output >= r.output)) push(where, `long-context output (${tr.output}) should be >= base output (${r.output})`);
  }
}

check(
  `all ${doc.models.length} model rows pass field checks`,
  problems.length === 0,
  problems.length ? problems.slice(0, 8).join("; ") + (problems.length > 8 ? ` (+${problems.length - 8} more)` : "") : "clean"
);

// A paranoid guard: the dataset should never silently shrink to a couple of
// rows, which is what happens when an editor overwrites instead of merges.
check("dataset still has a plausible size (>= 10 models)", doc.models.length >= 10, doc.models.length + " models");

// --------------------------------------------------------------------------
const cheapest = [...doc.models].sort(
  (a, b) => a.usd_per_million_tokens.input - b.usd_per_million_tokens.input
)[0];
console.log("\nSTATS");
console.log(`  models            ${doc.models.length}`);
console.log(`  providers         ${doc.providers.join(", ")}`);
console.log(`  prices verified   ${doc.prices_verified}`);
console.log(`  cheapest input    ${cheapest.name} (${cheapest.provider}) at $${cheapest.usd_per_million_tokens.input}/M`);

console.log("\n" + (failures ? `PROBLEMS: ${failures}` : "All checks passed."));
process.exit(failures ? 1 : 0);
