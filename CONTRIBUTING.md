# Contributing

Thanks for helping keep the dataset honest. There is one rule and it matters
more than the rest:

> **No source, no merge.** Every price change must cite the provider's own
> published pricing page and the date you checked it.

## Add or update a model

1. Fork the repo and edit `data/pricing.json`.
2. Add or update the model's `usd_per_million_tokens`:
   - `input` — fresh (uncached) input, USD per 1,000,000 tokens.
   - `cached_input` — cache-read price. Use `null` if unpublished.
   - `cache_write` — cache-write price. Use `null` if the provider does not publish one.
   - `output` — generated tokens.
3. Point `pricing_url` at the provider's page for that model.
4. If the model is promotional, set `promotional: true` **and** `promotion_ends`.
5. If a provider switches to higher rates above a token threshold, add a
   `long_context_tier` rather than flattening the two rates together.
6. Bump `prices_verified`, `generated`, and `model_count`.

## Validate before you push

```bash
node scripts/validate.mjs
```

It must print `All checks passed.` The same command runs in CI, so a red badge
means the pull request will not merge.

The validator rejects, among other things:

- a rate with no `pricing_url`
- `cached_input` greater than `input` (a cache read cannot cost more than fresh input)
- a `long_context_tier` cheaper than the base tier (a tier is a surcharge)
- a `promotional` rate with no `promotion_ends`
- duplicate model `id`s
- a provider not listed in `providers[]`

## Notes on accuracy

- Several rates are **promotional** and will change. Record the end date.
- Do not invent a price for a model that has no public rate. Leave it out.
- If a provider bills cached *storage* separately (as Google does) rather than a
  per-token cache write, set `cache_write` to `null` and mention it in `note`.
- Prefer the provider's own page over a blog or an aggregator.

## Adding a field

If you need a new field, add it to `schema/pricing.schema.json` and to the row
check in `scripts/validate.mjs` in the same pull request, so the schema and the
gate stay in step.
