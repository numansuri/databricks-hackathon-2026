# Pincode Directory — Deep Dive

**Table:** `databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory`
**Date:** 2026-06-15 · **Verified against live data** (warehouse `3d472a8f72349193`, all numbers exact unless noted)

Builds on [`dataset-deep-dive.md`](dataset-deep-dive.md) §3. This is the **geo-bridge**: it turns
"near Jaipur" into pincodes + coordinates, and it is the *only* path from a facility to its
district health profile (NFHS-5).

```
facilities ──address_zipOrPostcode──► india_post_pincode_directory ──district──► nfhs_5_indicators
   supply (10k)          THIS TABLE (geo bridge, 165k offices)              health need (706)
```

---

## What one row is

One row = **one post office** (not one pincode). 165,627 offices across **19,586 pincodes**
(avg **8.46 offices/PIN**, median 7, p90 17, max 153). So you almost always aggregate offices →
a per-PIN **centroid** before using it.

### Schema (11 cols, all `string` except `pincode BIGINT`)

| col | meaning | notes |
|---|---|---|
| `circlename` | India Post **Circle** (≈ state) | 24 distinct |
| `regionname` | Region (sub-circle) | 53 distinct |
| `divisionname` | Division (sub-region) | 482 distinct |
| `officename` | Post office name | 145,086 distinct — **not unique per row**; suffix encodes type (`B.O`/`S.O`/`H.O`/`G.P.O`) |
| `pincode` | 6-digit PIN | **clean**: 0 nulls, all 6-digit, 19,586 distinct |
| `officetype` | `BO` / `PO` / `HO` | see decode below |
| `delivery` | `Delivery` / `Non Delivery` | 95.3% deliver mail |
| `district` | district (**UPPERCASE postal spelling**) | 750 distinct — the join landmine |
| `statename` | state/UT (**UPPERCASE**) | 36 real + literal `"NA"` |
| `latitude` | string | ~91% clean, rest `"NA"`/out-of-bounds |
| `longitude` | string | same |

### Administrative hierarchy
`Circle (24) → Region (53) → Division (482) → Office (165,627)`. This is India Post's *internal
org chart*, **orthogonal to geography** — `district`/`statename`/`pincode` are the geographic keys.
Circle names roughly track states but aren't identical (e.g. `North Eastern Circle` covers several
NE states; `APS CIRCLE` = Army Postal Service, only 2 offices).

---

## `officetype` decoded (this is NOT BO/SO/HO as you'd guess)

| code | count | % | what it is | proof |
|---|---|---|---|---|
| `BO` | 140,270 | 84.7% | **Branch Office** (village-level) | 70,282 carry `B.O` suffix, 0 carry `S.O`/`H.O` |
| `PO` | 24,546 | 14.8% | **Sub Office** (the standard "S.O") | 10,926 carry `S.O` suffix, 0 carry `B.O` |
| `HO` | 811 | 0.5% | **Head Office** (incl. 11 `G.P.O`) | 407 `H.O` + 11 `G.P.O` suffix |

⚠️ The Sub-Office code is `PO`, **not `SO`** (corrects the parent doc). Hierarchy is
**HO > PO(=Sub) > BO**. The remaining offices carry no dotted suffix (just a place name). For
geocoding a city you usually want the **HO / PO** rows (town centres), not far-flung BO villages.

---

## Coordinate quality (latitude/longitude are strings)

Of 165,627 offices:
- **153,612 (92.7%)** parse to a number for both lat & long.
- **151,001 (91.2%)** are numeric **and inside India bounds** (lat 6–37.5, long 68–97.5) → usable.
- **12,009 (7.25%)** have the literal `"NA"` in lat or long → treat as missing.
- **2,611 (1.6%)** parse but fall **outside India** (bad/zero/swapped) → drop with a bounds filter.
- **Only 6** rows have non-`NA` unparseable junk → the feared DMS/degree-symbol mess is **negligible**;
  in practice the *only* coordinate trap is the `"NA"` literal + a handful of out-of-bounds points.

**Recipe:** `TRY_CAST` lat/long → keep rows in India bounds → aggregate to per-PIN centroid
(`AVG`). Facilities have their *own* clean lat/long (98.8%), so this table's coordinates are mainly
a **fallback geocoder** for the ~4% of facilities missing coordinates, plus the resolver for
free-text "near &lt;place&gt;".

---

## Postal zones (PIN first digit) — fast geographic prefilter

| zone | pins | offices | region (states it covers) |
|---|---|---|---|
| 1 | 1,646 | 11,671 | North — Delhi, Haryana, Punjab, HP, J&K, Chandigarh |
| 2 | 1,972 | 20,738 | UP, Uttarakhand |
| 3 | 2,041 | 19,958 | Rajasthan, Gujarat, DD&DNH |
| 4 | 2,784 | 29,135 | Maharashtra, MP, Chhattisgarh, Goa |
| 5 | 3,313 | 26,660 | South — AP, Telangana, Karnataka |
| 6 | 3,512 | 16,919 | Kerala, Tamil Nadu |
| 7 | 3,042 | 26,576 | East — WB, Odisha, NE, A&N (most state-diverse: 13) |
| 8 | 1,274 | 13,968 | Bihar, Jharkhand |
| 9 | 2 | 2 | **APS (Army Postal Service)** — 90xxxx, junk state, ignore |

First digit = zone, first two = sub-region, first three = sorting district. Useful as a cheap
coarse filter before distance math.

---

## The joins — and exactly how lossy they are

### facilities → directory (by PIN) — **strong**
`facilities.address_zipOrPostcode` (string) ↔ `pincode` (bigint). Of the 10,000 clean facility
rows (`WHERE organization_type='facility'`):
- 174 (1.7%) have an unparseable PIN.
- **9,568 / 10,000 (95.7%)** land on a PIN that exists in the directory. ✅

### directory → NFHS (by district) — **the real leak**
Postal districts are **UPPERCASE postal spellings**; NFHS uses **Title Case, older spellings**.
- 750 postal districts vs 698 NFHS districts.
- Exact uppercase name match: **597 / 698 NFHS districts (85.5%)**.
- **101 NFHS districts (14.5%) have NO exact postal match.**

The 101 misses are **not missing geography — they're renames/transliterations.** Every sampled
miss exists in postal under its modern name:

| NFHS (old) | postal (modern) | | NFHS (old) | postal (modern) |
|---|---|---|---|---|
| ALLAHABAD | PRAYAGRAJ | | GURGAON | GURUGRAM |
| FAIZABAD | AYODHYA | | BELGAUM | BELAGAVI |
| BANGALORE | BENGALURU URBAN | | GULBARGA | KALABURAGI |
| AHMADNAGAR | AHMEDNAGAR | | HUGLI | HOOGHLY |
| HAORA | HOWRAH | | DARJILING | DARJEELING |

Cause: NFHS-5 (2019–21) predates several post-2014 district renames that India Post adopted.
Other miss types: punctuation (`JANJGIR - CHAMPA` vs `JANJGIR-CHAMPA`), `&` vs `AND`
(`DADRA & NAGAR HAVELI`), transliteration (`GONDIYA`/`GONDIA`, `BID`/`BEED`, `JALOR`/`JALORE`).
→ A **~101-row crosswalk table** (old→new district names) fully closes this. This is the single
highest-leverage data-engineering task for the project.

### End-to-end yield (the number that matters)
facility → PIN → (majority) district → NFHS profile:

| stage | facilities reached | % |
|---|---|---|
| start | 10,000 | 100% |
| → reach a directory PIN | 9,568 | 95.7% |
| → reach an NFHS district (exact name) | **8,011** | **80.1%** |

So **~20% of facilities can't be linked to district health data** with naive exact matching, and
**virtually all of that loss (≈15.6 pts) is the district-rename gap**, not PIN coverage. Building
the crosswalk recovers most of it → ~95%+ end-to-end.

---

## Data traps specific to this table (checklist)
1. **Missing-as-string:** coords use literal `"NA"` (12,009 rows); **`statename` also has literal `"NA"`** (715 offices / 338 PINs) — filter it.
2. **Coordinates are strings** → `TRY_CAST` + India-bounds filter (drops 8.8%); the DMS/junk fear is overblown (6 rows).
3. **One PIN ≠ one place:** 1,478 PINs (7.5%) span >1 district, **290 (1.5%) span >1 state** → assign a PIN's district by **majority vote of its offices**, don't pick arbitrarily.
4. **District names need normalization** (UPPERCASE + 101 renames) before any NFHS join — see crosswalk above.
5. **`officename` is not unique** and **`officetype` Sub-Office = `PO` not `SO`**.
6. **Aggregate before geocoding:** 8.46 offices/PIN — collapse to a per-PIN centroid; prefer HO/PO rows for town centres.

## How to use it (Referral Copilot)
- **"near &lt;place&gt;" → coordinates:** match the place against `officename`/`district` (or city→PIN), take the per-PIN centroid, then distance-rank facilities (which carry their own lat/long).
- **Underserved-area flag (ambition extension):** facility → PIN → district → NFHS indicators, via the crosswalk, to tag referrals landing in low-coverage districts. ~80% of facilities link today; ~95%+ with the crosswalk — and **be honest in the UI about the ~5–20% that can't be linked** (matches the "communicate uncertainty" judging axis).
