# Dataset Deep Dive — Virtue Foundation (DAIS 2026)

**Date:** 2026-06-15
**Source:** `databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset` (workspace `dbc-aaaa2dac-8505`)

## Big picture
A healthcare-access dataset for **India**. Three tables meant to be joined:
facility **supply** + district health **need** + a geographic **bridge**.
Implicit use case: *match healthcare supply to health need across India's geography.*

```
facilities ──(pincode)──► pincode_directory ──(district)──► nfhs_5_indicators
  supply          geo bridge / centroid            health need
```

---

## 1. `facilities` — 10,088 rows × 51 cols
One row = one healthcare facility (hospital/clinic/dentist), web-scraped. **~99% India.**

- Hospitals 5,637 · clinics 3,782 · dentists 490. **~88% private**, 469 public.
- Top states: Maharashtra 1,575 · Gujarat 981 · UP 919 · Tamil Nadu 780.
- **Well-populated:** name (99.5%), lat/long (98.8%, clean), city/state (99%), pincode (97%), phone (96.5%).
- **Sparse:** numberDoctors (~36%), capacity (~25%), yearEstablished (~48%). `organization_type`, `countries`, `acceptsVolunteers` = no signal.

**Quality traps**
- Missing values are the literal string `"null"`, not SQL NULL.
- `phone_numbers`, `email`, `websites`, `specialties` are JSON-array strings — parse before use. `websites` is noisy (aggregators, not own domain).
- ~58–73 column-shift-corrupted rows → filter `WHERE organization_type = 'facility'`.
- `unique_id` not perfectly unique (11 collisions) — dedup before keying.

---

## 2. `nfhs_5_district_health_indicators` — 706 rows × 109 cols
One row = one Indian **district**, from **NFHS-5** survey (~2019–21). ~104 health indicators
(sanitation, water, vaccination, child nutrition, anaemia, maternal care, NCDs). Near-complete
national coverage: 698 districts, 36 states/UTs.

- Coverage is excellent (0 nulls in keys; double-typed %s all sane 0–100).

**Quality traps**
- **~60 `_pct` columns typed `string`** because they embed NFHS markers:
  - `*` = suppressed (<25 cases) → treat as NULL.
  - `(80.4)` = reliability-flagged (25–49 cases) → real number wrapped in parens; plain `TRY_CAST` **drops it**.
  - To use: trim whitespace, strip `()`, map `*`→NULL, then cast. (Discards 50–78% of data otherwise.)
- **Join key = composite `(district_name, state_ut)`** — names alone collide across 8 states.
- Watch trailing whitespace (`" Lakshadweep "`) and misspelling `"Maharastra"`.

---

## 3. `india_post_pincode_directory` — 165,627 rows × 11 cols
One row = one **post office** (~8.5 per PIN, 19,586 PINs, 750 districts, 37 states/UTs).
The **geo-bridge** table.

- Text fields 100% populated; PIN codes clean (all 6-digit, no nulls/zeros).

**Quality traps**
- Coordinates string-typed and ~9% dirty: 91% valid & India-bounded, but 12,000 literal `"NA"`
  plus degree-symbol/DMS junk. `TRY_CAST` + bounds-filter before use.

---

## The main joins (and the big trap)
- **facilities → pincode:** `address_zipOrPostcode` (string) ↔ `pincode` (bigint). Cast/zero-pad; aggregate PIN to a **centroid** (many offices per PIN).
- **pincode → NFHS:** the **risky join**. Pincode districts are UPPERCASE postal spellings
  (`24 PARAGANAS NORTH`, `AHMADABAD`); NFHS uses Title Case (`North 24 Parganas`, `Ahmedabad`).
  750 vs ~700 districts → needs a **fuzzy crosswalk / normalization step**. This is the single
  biggest data-engineering hurdle.

## Three recurring quality themes
1. Missingness hides as literal `"null"` / `"NA"` strings.
2. Numbers stored as messy strings (NFHS `()`/`*` markers, dirty coords).
3. District-name normalization across all three tables.
