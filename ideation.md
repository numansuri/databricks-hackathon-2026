# Ideation — Referral Copilot for Volunteer Specialists

**Hackathon:** Databricks Apps & Agents for Good 2026 · **Track:** Referral Copilot
**Deadline:** June 16, 2026 @ 2:30pm PDT · **Deliverable:** live Databricks App + Git repo + 3-min demo

> **One-liner:** A specialist tells us their expertise and when they're free; we return an
> **evidence-cited, trust-rated** shortlist of Indian facilities ranked by where they'd have the
> most impact, draft the outreach for them (human-in-the-loop), and build an honest day-by-day
> visit schedule — with **every claim cited and every uncertainty named.**

---

## 1. Positioning (read this first)

We are building **"Referral Copilot, for the doctor who wants to *give* care, not receive it."**
Same mechanism the track asks for — *location + need → evidence-attached, trust-rated facility
shortlist* — but the user is a **volunteer specialist**, and the "need" is **regional health need**.

**Why this framing, and the one risk it manages:** this dataset is the **Virtue Foundation**
dataset, and Databricks-for-Good already publicized **"VF Match"** (matching medical volunteers to
facilities in 72 countries with Vector Search + Llama + RAG + Genie). Judges will know it. So we do
**not** win on "we match volunteers to clinics." We win on the two things VF Match doesn't
foreground and this hackathon scores hardest:

1. **Evidence discipline** — every recommendation/score/ranking cites the underlying facility text.
2. **India-specific impact targeting** — ranking by *cited NFHS-5 regional health need*, not just specialty keywords.

Everything below is grounded in queries actually run against the live tables.

---

## 2. The spine: Evidence & Uncertainty (wired into all three levers)

The heaviest judging axis is *"cite the source text behind every claim; communicate uncertainty
honestly; treat fields as claims to verify, not ground truth."* We implement this as **four reusable
signals** that every lever reuses:

| Signal | What it is | Where it shows up |
|---|---|---|
| **Evidence Shield (3 tiers)** | Tier 1 = claim quoted from the free-text `description` (prose) · Tier 2 = claim only in a structured field (`specialties`/`capability`/`procedure`/`equipment`) · Tier 3 = inferred from a related specialty | Every facility card (Lever 1); the "why we matched you" line (Lever 2) |
| **Confidence score (0–100)** | `tier_score + data-completeness`; never presented as ground truth | Facility cards (Lever 1), contact cards (Lever 2) |
| **Data-gap badges** | Explicit "limited data — verify" flags; we never silently drop a thin record | All levers; district supply counts; contact freshness |
| **Honest assumption flags** | When the answer relies on something *not in the data*, we say so | Outreach (contact freshness), Scheduling (hours/travel time/availability), NFHS (suppressed values, join gaps) |

This spine is the demo. The three levers are the surfaces it appears on.

---

## 3. Lever 1 — Recommendation (MVP) ✅ *the centerpiece*

**What it does:** specialist enters a **specialty/care-need + location** → ranked shortlist of
facilities, each with an evidence-tier badge, a quoted snippet, a confidence score, and (optionally)
the **regional-need / impact** context for the district.

### Data grounding (verified)
- `specialties` is clean camelCase with **99.7% coverage**. Real, queryable tokens & counts:
  `gynecologyAndObstetrics` 4,498 · `cardiology` 3,011 · `pediatrics` 3,438 · `nephrology` 2,156 ·
  `endocrinologyAndDiabetesAndMetabolism` 1,840 · `ophthalmology` 2,828. (Must `ARRAY_DISTINCT(from_json(specialties,'array<string>'))` — tokens repeat up to 50×.)
- Example result density: **nephrology + Mumbai = 74 facilities** on `specialties` alone — a healthy set to rank.

### Match score (transparent, SQL-only — no black box)
A 0–10 weighted sum the judge can read: `specialty-token matches (cap 9) + structured-field matches
(cap 4.5) + prose match (2) + field-completeness (≈2.25)`, then order by score, tie-break by haversine
distance from the user's pin. Pure `LOWER(col) LIKE '%term%'`; runs <2s over 10,000 rows.

### Evidence Shield extraction (the wiring)
Classify each facility (Tier 1/2/3) and, for Tier 1, pull a ~150-char window around the match with
`SUBSTR(description, GREATEST(1, INSTR(LOWER(description),'dialysis')-75), 150)`. That quoted text is
shown verbatim on the card. Tier 2 explicitly says "listed as a specialty but **not confirmed in the
description**" — that honesty is the point.

### Confidence (0–100)
`tier_score (40 prose / 25 structured / 10 inferred) + completeness (desc length, specialties, phone,
email, coords, capacity)`. Color: ≥70 green, 40–69 yellow, <40 red.

### Worked example — "nephrology / dialysis near Bandra, Mumbai" (real rows)

| Facility | Tier | Quoted / structured evidence | Match | Conf. |
|---|---|---|---|---|
| **Holy Family Hospital** (Bandra) | T2 — structured | `specialties`: nephrology, dialysis, kidneyTransplantation, chronicRenalFailure… (28 renal tokens) — **but prose doesn't name dialysis** | 23.7 | 85 |
| **Smt. Motiben B. Dalvi Hospital** | T1 — prose | *"…facilities including ICU, OPD, ventilators, 2D-Echo, OT, …, **Dialysis**, and Endoscopy…"* | 13.2 | 80 |
| **BYL Nair Hospital** | T1 — prose | *"…Department of **Nephrology**, Topiwala National Medical College and BYL Nair Hospital…"* | 13.2 | 75 |
| **I Care Diagnostic & Dialysis Center** | T1 — prose | *"I Care Diagnostic and **Dialysis** Center…"* | 13.2 | 65 |
| **Aaradhya Health Care** | T2 — structured | `specialties`: nephrology… ; description 21 chars (near-empty) → **data-gap badge** | 11.6 | 40 |

The Holy Family case *is* the pitch: strongest structured signal, but the shield flags that the
prose doesn't independently confirm it — exactly "treat fields as claims to verify."

### Impact / regional-need enrichment (folds NFHS into the ranking)
Optional ranking signal + a "Why this region needs you" panel, cited to NFHS-5. See Lever 1b below.

### MVP cut line
**MVP:** LIKE-based SQL match + INSTR/SUBSTR evidence shield + confidence formula (2–4 hrs, fully
works without ML). **Stretch:** Mosaic AI Vector Search over `description` for semantic recall
(e.g., "end-stage renal disease" → "chronic kidney failure") + a small synonym map ("kidney" →
nephrology tokens). **Ship MVP first.**

---

## 4. Lever 1b — Regional Need / Impact targeting (MVP) ✅ *the differentiator*

**What it does:** ranks **districts** by how badly they need the specialist's specialty, using
**cited NFHS-5 indicators**, and shows the supply–demand tension (need vs how many matching
facilities exist there).

### Data grounding (verified)
- NFHS-5: 706 districts × ~104 indicators. **Trap handled:** ~60 `_pct` columns are strings with
  `*` (suppressed) and `(80.4)` (paren-wrapped real numbers). Canonical parse:
  `CAST(NULLIF(REGEXP_REPLACE(TRIM(col),'^\\(|\\)$|\\*',''),'') AS DOUBLE)` (verified before/after:
  `(64.2)`→64.2, `*`→NULL).
- **Specialty → sentinel-indicator map** (exact columns verified). Strong proxies exist for
  ob-gyn, pediatrics, cardiology, diabetes/endocrine, pulmonology, oncology-screening. **Honesty
  flag:** nephrology, ophthalmology, psychiatry, general surgery have **weak/no NFHS proxy** — the
  UI must label these "estimated from related burden," not assert a need score.

  Example (ob-gyn): `fp_unmet_total_cm_w15_49_7_pct` ↑, `institutional_birth_5y_pct` ↓,
  `all_w15_49_who_are_anaemic_pct` ↑, `mothers_who_had_at_least_4_anc_visits_lb5y_pct` ↓.

### Need score
`need_score = mean of PERCENT_RANK across present sentinel indicators` (direction inverted for
coverage-type indicators). Districts with <2 present indicators are flagged "insufficient data."

### Worked example — gynecologyAndObstetrics, highest-need districts (real NFHS-5 values)

| District | State | Need | Unmet FP % | Inst. birth % | Anaemia % | 4+ ANC % | Matching facilities |
|---|---|---|---|---|---|---|---|
| Katihar | Bihar | 0.945 | 22.4 | 66.9 | 68.4 | 15.3 | 1 |
| Kishanganj | Bihar | 0.933 | 21.7 | 54.6 | 65.1 | 17.1 | 0 |
| Purnia | Bihar | 0.930 | 20.2 | 68.9 | 66.0 | 11.1 | 2 |
| Araria | Bihar | 0.913 | 15.9 | 66.2 | 67.9 | 25.8 | 0 |
| Pakur | Jharkhand | 0.904 | 12.0 | 64.6 | 79.7 | 26.6 | 0 |

National medians for context (shown in UI): unmet FP 8.5%, inst. birth 92.2%, anaemia 57.2%.
**9 of the top 12 districts have ~0 matching facilities in our data** → the supply–demand story.

### Uncertainty wiring
- **Join coverage = 63.5%** (9,915 facilities w/ pincode → 6,292 resolve to an NFHS district; name
  mismatch UPPERCASE vs Title-Case is the gap). UI must say *"facility count may underestimate
  supply — 36% couldn't be geo-matched"* and never render 0 as "none exist" (→ "none found in our data").
- Per-district **data-completeness badge** (N/4 indicators present).

### MVP cut line
**MVP:** precompute need scores for ~8 strong-proxy specialties into a small table; show the
need panel + supply count on the district view. **Stretch:** choropleth map (Plotly/Folium) of
high-need × low-supply districts. The map is the demo hero — build it if time allows.

---

## 5. Lever 2 — Automated Outreach (MVP, **draft-only / human-in-the-loop**) ✅

**What it does:** for shortlisted facilities, an agent **composes** an outreach email + phone
script, **cites where the contact came from**, scores how complete/trustworthy that contact is, and
presents it for the specialist to review. **It never actually sends.** This is a deliberate
responsible-AI choice (and Free Edition blocks outbound calls to Twilio/SendGrid anyway).

> **Hard constraint:** no real phone calls or emails to real Indian hospitals. The Send action is
> disabled / "production only"; status changes to "sent" only if the specialist self-reports.

### Data grounding (verified)
- **Use:** `officialPhone` (95.0%, 99.9% well-formed +91), `email` (85.5% — **but 55% are gmail**,
  flag as lower-trust), `officialWebsite` (83.9%).
- **Do NOT use** `websites` — proven to be **scrape-source URLs** (PubMed, Wikipedia, Practo,
  MakeMyTrip, govt portals), not the facility's own site. Cite `source_urls` only as provenance.

### Contact "Data-Completeness Score" (0–100) — *labeled honestly*
`officialPhone present (+35) + valid format (+10) + email present (+30) + institutional domain (+10)
+ officialWebsite (+15)`. Distribution: **72.6% High (80–100)**, 17.3% Medium, 10% Low/Very-low.
UI tooltip: *"reflects how complete the contact data is — it does NOT verify the number/email is
currently active."* (No liveness check in MVP.)

### Worked example (real row)
**Fortis Hospital Anandapur (Kolkata)** — phone `+918697708133`, email `appointment@tmckolkata.com`,
site `tmckolkata.com` → score **100**. Caveat surfaced: *"email domain is Tata Medical Center, not
Fortis — possible data conflation; verify before sending."* That caveat is the evidence/uncertainty
wiring made visible.

### Draft generation
One LLM call (**Claude Sonnet 4.6** via Databricks Foundation Model APIs) → structured JSON
`{subject, email_body (≤250 w), call_script (≤120 w), contact_source_line}`. System prompt forbids
asserting the visit as confirmed, requires citing the contact source, and appends
`[DRAFT ONLY — Not sent. Reviewed by: ____]`. A guardrail re-prompts if that marker is missing.

### Persistence (hard hackathon requirement — "persist user actions")
**Verified:** the dataset catalog is a **read-only Delta Sharing catalog** (`CREATE TABLE` denied);
`workspace.default` is **writable** (CREATE/INSERT/DROP confirmed). So persist to
`workspace.shiftlink_app`:
- `saved_shortlist` (user, facility, status: shortlisted→contacted→finalized→removed, notes, soft-delete)
- `outreach_log` (draft text, the contact + its completeness score, specialist overrides, status,
  model used, timestamps)

Lakebase is unavailable on Free Edition → Delta tables are the correct fallback. (If the provisioned
workspace has Lakebase, swap it in; confirm with organizers.)

### MVP cut line
**MVP:** generate + persist the draft, show it with the contact-source + completeness caveat,
Send disabled. **Stretch:** real outbound via Twilio/SendGrid in a *sandbox* with a test number/inbox
you own (only if Free-Edition egress allows — likely not). **Never** contact real facilities.

---

## 6. Lever 3 — AI Scheduling (MVP) ✅

**What it does:** from the **finalized** facilities, build a day-by-day India itinerary that
clusters nearby stops and orders them to cut travel — **honest that it only has straight-line
distance and no hours/availability data.**

### Data grounding (verified)
- Coords usable for **99.64%** (9,964/10,000 valid India-bounded, native DOUBLE). Rajasthan alone
  has 407 geocoded facilities.
- Only primitive available is **haversine** (great-circle) distance — no road network, no travel
  time, no operating hours, no appointment slots anywhere in the data.

### Approach
SQL computes pairwise haversine; cluster facilities <30 km apart into a "city-day"; greedy
nearest-neighbor order from home base; one **Claude Sonnet 4.6** call turns clusters + distances +
prefs into a day-by-day plan. **The LLM never computes distances — they're passed in as facts.**

### Worked example — nephrology specialist, 6 real facilities, central Rajasthan, 5 days, base Jaipur

Clusters from real computed distances: **Ajmer** (Deepmala Pagarani / Sharma / Dr. Ashok Mittal —
all within 7 km; F1↔F3 = 3.3 km), **Bhilwara** (Krishna / Brijesh Banger — 2.8 km apart, ~120 km
from Ajmer), **Bharatpur** (Jindal Super Speciality — isolated, ~294 km).

| Day | Route | Stops |
|---|---|---|
| 1 | Jaipur → Bharatpur | Jindal Super Speciality |
| 2 | Bharatpur → Ajmer (transit) | — |
| 3 | Ajmer (full day) | Deepmala → Sharma → Dr. Ashok Mittal (3–4 km apart) |
| 4 | Ajmer → Bhilwara | Krishna → Brijesh Banger |
| 5 | Bhilwara → Jaipur (return) | — |

### Uncertainty wiring (first-class output, not a footnote)
Every itinerary ships an **Assumptions** block: operating hours assumed 9–5; visit ~2–3 h;
**road travel ~40–60% longer than straight-line**; facility availability/consent **not verified**;
appointment slots unknown. Confidence labeled "low — no road-time/hours/availability data."

### MVP cut line
**MVP:** city-cluster + LLM narrative + assumptions block (~1 day, no extra deps). **Stretch:**
OR-Tools TSP — overkill for <20 stops; defer until real road-time data exists.

---

## 7. Data foundation & stack

**Tables** (`databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset`, read-only):
- `facilities` 10,088 (filter `organization_type='facility'` → **10,000** clean)
- `nfhs_5_district_health_indicators` 706 (district health need)
- `india_post_pincode_directory` 165,627 (pincode ↔ district ↔ lat/long bridge)

**Universal traps:** missing = literal `"null"`; `specialties`/`phone_numbers`/`websites` are
JSON-array strings; NFHS `_pct` cols are strings with `*`/`(…)`; district names need normalization
(UPPERCASE postal vs Title-Case NFHS).

**Persistence:** `workspace.shiftlink_app.{saved_shortlist, outreach_log}` (writable; dataset
catalog is read-only).

**App:** Databricks App on Free Edition — **Streamlit** (fastest path; Dash/Gradio/Flask also
supported). Free-Edition caps to respect: 3 apps, 2X-Small warehouse, 1 vector-search endpoint, no
GPU, restricted outbound internet.

**Models** (latest Claude on Databricks Foundation Model APIs — verify exact endpoint aliases in the
provisioned workspace): **Sonnet 4.6** for drafting + scheduling + synthesis, **Haiku 4.5** for cheap
classification/slot-filling, **Opus 4.8** if an orchestrating agent is used; `gte-large-en`
embeddings for the optional vector-search stretch.

**Voice onboarding:** browser **Web Speech API** (client-side, free, HTTPS — which Apps provide);
Whisper-on-Databricks as the stated production path.

---

## 8. The 3-minute demo arc

1. **Onboard (voice/text):** "I'm a nephrologist, free the last week of June, I want to go where I'm
   needed most." →
2. **Impact map / need ranking:** high-need districts with **cited NFHS-5** indicators + supply gap. →
3. **Shortlist:** facilities with **evidence-shield badges + quoted snippets + confidence** (show a
   Tier-2 "listed but not confirmed" and a data-gap badge — the honesty moment). →
4. **Outreach draft:** agent-composed email + script, **contact source cited + completeness score +
   freshness caveat**, Send disabled ("production only"). →
5. **Schedule:** day-by-day Rajasthan plan with the **Assumptions block** shown on screen.

Every step: a citation; every uncertainty: named.

---

## 9. Scope & priorities for the ~1 day left

| Priority | Build | Est. |
|---|---|---|
| **P0** | Lever 1 recommendation + evidence shield + confidence (SQL only) | 2–4 h |
| **P0** | Data-gap badges + uncertainty styling (the spine) | ~2 h |
| **P0** | Persistence tables + save/notes/status | ~2 h |
| **P1** | Lever 1b NFHS need ranking (8 strong-proxy specialties) + supply count | 2–3 h |
| **P1** | Lever 2 outreach draft (Sonnet 4.6) + contact score + caveats, Send disabled | 2–3 h |
| **P1** | Voice/text onboarding | 1–2 h |
| **P2** | Lever 3 scheduling (city-cluster + LLM + assumptions block) | ~2 h |
| **P3 / stretch** | Choropleth need map · vector search · synonym map | if time |

**Deliberately NOT doing:** real outbound calls/emails; the "find a named point-of-contact person"
lever (**zero data support** — no contact-name columns; `acceptsVolunteers` populated for only 21 of
10,000 rows). If asked, we reframe contacts as LLM-inferred-from-description, clearly labeled.

---

## 10. Honesty ledger (what we're explicit about)

- Structured capability fields are **claims**, shown as Tier-2 until prose confirms them.
- NFHS need scores are **weak proxies** for some specialties (nephrology/ophthalmology/psychiatry) — labeled, not asserted.
- Facility→district join resolves **63.5%** — counts are floors, never "none exist."
- Contact score = **data completeness, not verified reachability** (no liveness check).
- Schedule uses **straight-line distance**; hours/travel-time/availability are **assumptions**, surfaced every time.

_Grounded in live queries against the three tables, June 15 2026. See
[`findings/dataset-deep-dive.md`](findings/dataset-deep-dive.md) and
[`problem-statement.md`](problem-statement.md)._
