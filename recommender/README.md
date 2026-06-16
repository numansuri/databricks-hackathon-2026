# Specialist Placement Recommender (SPR)

> *"A specialist just signed up. Where should they go to do the most good — within the places and settings they're willing to work?"*

Given a specialist's **specialty** and the **preferences they reveal at onboarding**, SPR
recommends the top 3–5 **districts** where they close the biggest health-need gap, and names
candidate **host clinics** in each. It is a transparent, rules-only system (no ML) built on the
gold table `gold_demand_supply_gap_v2` (in `workspace.virtue_foundation_enriched`).

For the plain-English version, see **[RECOMMENDER_EXPLAINED.md](RECOMMENDER_EXPLAINED.md)**.

## Run it (zero setup — pure stdlib Python 3)

```bash
cd recommender

# 1) Run the 8 demo personas
python3 recommend.py --demo

# 2) One specialist, ad hoc
python3 recommend.py --specialty pediatrician --mode open --top-k 5
python3 recommend.py --specialty ob-gyn --states "Bihar,Uttar Pradesh" --mode fixed --setting public
python3 recommend.py --specialty cardiologist --states "Karnataka,Tamil Nadu" --mode prefer --json

# 3) Regression self-test (13 checks)
python3 recommend.py --selftest
```

No `pip install` needed. Data is read from local CSV snapshots in [`data/`](data/).

## The idea in one line

`gold_demand_supply_gap_v2.unmet_demand` already scores, per (district, specialty), how much
health need is **not** covered by current specialist supply (max when supply is zero). A
specialist's **impact** in a district = that `unmet_demand`. We normalize it to a **0–100 impact
index within the specialty** (scales differ across specialties), then:

> **Preferences carve the feasible set → rank by impact inside it → always name the best feasible
> option, and transparently flag bigger gaps the doctor is passing up.**

## Preferences (revealed at onboarding)

| input | values | effect |
|---|---|---|
| `--specialty` | any clinical specialty | mapped to one of 17 NFHS-need-driven canonical specialties; others return `no_gap_signal` honestly |
| `--mode` | `open` / `prefer` / `fixed` / `avoid` | `open`=anywhere; `prefer`=two-section (best-in-your-states **+** best nationally with a trade-off note); `fixed`=only your states; `avoid`=exclude states |
| `--states` | comma-separated | preferred / fixed / avoided states (multi-word names ok; `up`,`tn`… aliases supported) |
| `--setting` | `any` / `public` / `private` | shapes **which host clinics** are named — never the district impact ranking |
| `--top-k` | int (default 5) | how many districts to return |

**`prefer` mode** is the heart of "honor preferences without hiding impact": it guarantees the
doctor sees their preferred-state options (Section A, true impact shown) *and* the highest-impact
national gaps (Section B), with an explicit note naming the bigger gap and both scores.

## Outputs

Each recommendation carries: `district`, `state`, `impact_index` (0–100), `priority_tier`
(global severity badge), `current_supply` (facilities offering the specialty there today;
0 = none), `specialty_absent`, `driving_needs` (the *why*), `score_basis` (flags thin
specialties as need-driven), `in_preferred_state`, and `candidate_clinics` (credible host
facilities — hospitals/CHCs/PHCs, never dental/lab/diagnostic; `greenfield` if none exist).

## Files

| file | what |
|---|---|
| `recommend.py` | the recommender (engine + CLI + `--selftest`) |
| `personas.json` | 8 diverse onboarding personas (the eval suite) |
| `data/*.csv` | local snapshots of `gold_demand_supply_gap_v2`, `gold_facility_enriched`, `fct_facility_specialty` |
| `RECOMMENDER_EXPLAINED.md` | non-technical explainer |
| `EVAL.md` | how it was evaluated + the Codex adversarial findings and fixes |

## Production note

`load_gap()` / `load_facilities()` / `load_supply_map()` read CSV snapshots so the demo runs
anywhere. In production, swap them for live `SELECT`s against
`workspace.virtue_foundation_enriched.*` (the source catalog is a read-only Delta Share — never
write to it). The recommendation logic is unchanged.
