# LLM API Pricing

**An open, citable dataset of LLM API list prices — corrected for prompt caching,
batch tiers and long-context tiering.**

[![validate](https://github.com/rabayid/llm-api-pricing/actions/workflows/validate.yml/badge.svg)](https://github.com/rabayid/llm-api-pricing/actions/workflows/validate.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![models](https://img.shields.io/badge/models-28-informational.svg)](data/pricing.json)
[![verified](https://img.shields.io/badge/verified-October%202026-informational.svg)](data/pricing.json)

Most price tables collapse a model to a single number: **$X per million input
tokens**. That number is the price of a cache *miss*. It ignores three things
providers actually bill for, and each one can flip which model is cheapest:

- **Prompt caching.** A cache read is billed far below fresh input, but not by
  the same factor for every model. A model with a weak cached-read rate loses
  its advantage as the cache warms.
- **Batch tiers.** Some providers halve every rate for asynchronous jobs.
  Others publish no batch tier at all.
- **Long-context tiering.** Above a token threshold, several providers switch
  to higher rates. A single flat rate is misleading for large prompts.

This repository holds those rates as flat, documented JSON you can cite, diff
and build on — with a validator that runs on every change.

## Contents

| Path | What it is |
| :-- | :-- |
| `data/pricing.json` | The dataset. One file, one schema, every rate sourced. |
| `schema/pricing.schema.json` | JSON Schema (draft 2020-12) for consumers and editors. |
| `scripts/validate.mjs` | Zero-dependency validator. Runs in CI on every PR. |
| `scripts/crossover.mjs` | The cached-prefix crossover analysis (see below). |

No dependencies. Node 18+.

```bash
node scripts/validate.mjs    # check the dataset
node scripts/crossover.mjs   # where does a cache discount flip the ranking?
```

## The data

Every model carries its list rates in USD **per 1,000,000 tokens**, plus the
context window and a link to the provider's own pricing page.

```jsonc
{
  "id": "claude-sonnet-5",
  "name": "Claude Sonnet 5",
  "provider": "Anthropic",
  "context_window_tokens": 200000,
  "usd_per_million_tokens": {
    "input": 2.00,         // fresh (uncached) input
    "cached_input": 0.20,  // read from a warm prompt cache
    "cache_write": 2.50,   // writing tokens into the cache (Anthropic premium)
    "output": 10.00
  },
  "supports_batch_api": true,
  "promotional": false,
  "long_context_tier": {                    // optional
    "threshold_tokens": 200000,
    "usd_per_million_tokens": { "input": 4.00, "cached_input": 0.40, "cache_write": null, "output": 15.00 }
  },
  "pricing_url": "https://platform.claude.com/docs/en/about-claude/pricing"
}
```

| Field | Meaning |
| :-- | :-- |
| `input` | Price for input tokens **not** served from cache. |
| `cached_input` | Price for input tokens read from a warm prompt cache. |
| `cache_write` | Price for writing tokens into cache. `null` where the provider does not publish one. |
| `output` | Price for generated tokens, including reasoning tokens where billed as output. |
| `supports_batch_api` | Provider publishes a batch tier for this model. |
| `long_context_tier` | Rates that apply once input exceeds `threshold_tokens`. |
| `pricing_url` | The provider's own pricing page. Provenance, not decoration. |

## Using it

Cost for `N` input tokens at a cache-hit fraction `f`, plus `M` output tokens:

```js
// cost(f) = N * [ (1 - f) * input + f * cached_input ] + M * output
const cost = (m, { N, M, f = 0 }) => {
  const r = m.usd_per_million_tokens;
  return (N * ((1 - f) * r.input + f * r.cached_input) + M * r.output) / 1e6;
};
```

### The crossover

Because a cache read scales each model differently, two models can trade places
as the cache warms. Solving `costA(f) = costB(f)` gives the cache-hit rate where
the cheaper-at-zero-cache model becomes the more expensive one:

```
f* = (kA - kB) / (sA - sB)     where  k = N*in + M*out,  s = N*(in - cached)
```

`scripts/crossover.mjs` computes it for every pair in the dataset across three
workload shapes. That number — a single percentage — is what a team actually
needs and what single-rate tables omit.

## Live tool

The same rates power a free browser calculator (no account, no API call):
**<https://rabayid.com/>** — and the machine-readable copy is served at
<https://rabayid.com/data/pricing.json>.

## Accuracy and provenance

Rates are transcribed from each provider's own published pricing page; the link
is stored on every row so the claim is checkable. Prices change often and some
are promotional, so each release records a `prices_verified` date. **Verify a
rate against the provider before you commit to a contract.** Corrections are
welcome and expected — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Contributing

Open an issue or a pull request. Rule of the house: **no source, no merge.** A
price change must cite the provider's own page and a date. Run
`node scripts/validate.mjs` before you push. Details in
[CONTRIBUTING.md](CONTRIBUTING.md).

## Citing

If you use the dataset, cite the verification date, because it changes:

> LLM API pricing dataset, verified October 2026. https://github.com/rabayid/llm-api-pricing

## License

[MIT](LICENSE). The pricing data is provided as-is, without warranty of accuracy.
