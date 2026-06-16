# Shiftlink — Specialist Onboarding Flow: Implementation Spec

**Status:** Build-ready (P0 prototype + P1 backend). Supersedes the free-text `extractLocalTags` onboarding.
**Target file:** `src/App.jsx` (single-file React 19 / Vite 8 prototype). New helper modules introduced where noted.
**Schema authority:** `gold_demand_supply_gap_v2`, `gold_district_card`, `gold_facility_enriched` (the only three gold tables this flow may read). `specialty_canonical` is the single primary join key.

---

## 1. Summary & design thesis

Shiftlink's specialist onboarding has exactly **one job**: capture the one structured field that lets us produce a defensible first recommendation — the doctor's **canonical specialty** (`gold_demand_supply_gap_v2.specialty_canonical`, one of 110 controlled values). Everything else is progressive refinement that must earn its friction against a concrete gold-layer column or be deferred to chat. We replace the free-text-textarea-first onboarding (whose `extractLocalTags` regex resolves to only 4 invalid specialty labels with zero gold linkage) with a **picker-first** flow: a searchable combobox over all 110 canonical values is the required front door; free-text/voice is kept only as an optional same-screen resolver that must still land on a canonical value before it counts. The recommendation is "rank districts where this specialty has the highest unmet demand, then surface real facilities in those districts," computed in P0 against a client-bundled JSON slice of the gold tables and in P1 against live Databricks SQL with identical keys.

**Friction budget for the required path: ≤ 20 seconds — one required field (specialty) + one button.** Geography is not required (national ranking is a valid first answer). No textarea gate, no mic gate.

---

## 2. Current state and its gap vs the gold layer

- **Two identical free-text capture points.** `AuthGate` sign-up renders a "Doctor context" `<textarea>` + Speak/mic (`useProfileRecorder` → `POST /api/transcribe`, demo-transcript fallback), gated at `profileText.trim().length > 20`. The `Onboarding` fallback (rendered by `DoctorApp` when `!profile`) is the same textarea + mic gated the same way. Both call `createDoctorProfile(userId, rawText)`.
- **`extractLocalTags` produces non-joinable tags.** It regexes over only 4 specialty labels (`cardiology`, `critical care`, `diabetes`, `general medicine`) and 4 regions (`Gujarat`, `Rajasthan`, `Maharashtra`, `rural`), defaulting specialty to `"general medicine"`. **None of these four labels is a valid `specialty_canonical` value** (`critical care` → `critical_care_medicine`, `diabetes` → `endocrinology_diabetes`, `general medicine` → no canonical value at all). The stored `tags.specialties[0]` cannot join `gold_demand_supply_gap_v2`.
- **Zero connection to the gold layer.** `facilities` is a hardcoded 3-card cardiology array near Ahmedabad; `SearchPanel` chat is static canned text; `MapWorkspace` is decorative. Nothing the doctor enters drives a real district or facility result.
- **Profile shape is display-only.** `{ doctorId, rawText, tags: { specialties, regions, experience }, createdAt }` is read by `TopBar` (`profile.tags.specialties[0]`), `SearchPanel` (`profile.tags.specialties.join(", ")`), and `buildOutreachMessage` (`profile.tags.specialties[0]`, `profile.tags.regions[0]`) — all display, none joinable.

---

## 3. Data contract (captured field → gold column/join → tier → why)

`R` = required for the required path · `O` = optional in onboarding (after first result) · `D` = deferred to chat.

| Field | Stored as | Gold table.column it feeds | How it joins / filters | Tier | Why this tier |
|---|---|---|---|---|---|
| Primary specialty | `primarySpecialtyCanonical` | `gold_demand_supply_gap_v2.specialty_canonical` | equality on the join key; the ranking row source | **R** | Only field that creates a defensible recommendation. No fallback value is ever invented. |
| Specialty display label | `primarySpecialtyLabel` | (display only — humanized from canonical) | none | R (derived) | UI readability; never a join key. |
| Specialty resolution audit | `specialtyResolution` | none | none | R (derived) | Records how the canonical value was reached (select/alias/legacy) so ambiguity can be re-confirmed. |
| Preferred states | `geography.preferredStatesNorm[]` | `gold_demand_supply_gap_v2.state_ut_norm`, `gold_district_card.state_ut_norm` | `state_ut_norm IN (…)`; values come from a **bundled controlled state list** derived from the gold keys (Section 7) | **O** | National ranking is valid without it; narrows after first result. |
| Preferred district | `geography.preferredDistricts[]` (`{state_ut_norm, district_name_norm, source, rawInput, normalizationStatus}`) | `(state_ut_norm, district_name_norm)` on demand/card tables; `(nfhs_state_ut_norm, nfhs_district_name_norm)` on facilities | tuple filter via deterministic client key `${state_ut_norm}::${district_name_norm}`; only stored when it matches a **bundled controlled district list** | **D** | Pincode→district can fail; it is a refinement, not a join prerequisite. Failed resolutions are never fabricated. |
| Facility complexity | `preferences.facilityComplexityTiers[]` | `gold_facility_enriched.facility_complexity_tier` | `IN (…)` on the **facility step only** | **D** | Affects facility choice, not district demand ranking. One-tap in chat. |
| Ownership sector | `preferences.ownershipSectorFinal[]` | `gold_facility_enriched.ownership_sector_final` | `IN (…)` on facility step | **D** | Can over-constrain thin districts; cheap to add later. |
| Public-health only | `preferences.publicHealthOnly` | `gold_facility_enriched.is_public_health_facility` | `= TRUE` on facility step | **D** | Facility-level, not demand-level. |
| Require specialist evidence | `preferences.requireSpecialistEvidence` | `gold_facility_enriched.has_specialist_evidence` (+ rank by `specialist_domain_count`) | `= TRUE` on facility step | **D** | Requiring early erases underserved districts; better as a toggle on results. |
| Teleconsult-only mode | `preferences.teleconsultOnly` | **no gold column** | suppresses facility/location claims (Section 6) | **O** | No remote-care column exists; we must branch the UI, not invent data. |
| Intent (volunteer/referral) | `preferences.intent` | **no gold column** | UI copy + outreach tone only | **D** | No column in any of the three tables; cannot affect ranking. Used only in `buildOutreachMessage`. |
| Raw / voice input | `specialtyResolution.input` (transient) | **never a join key** | none | D | §9.8: held only until the specialty resolves, then discarded; **no** durable `rawText` field. Outreach uses structured fields. |
| Years experience / languages | (not stored in onboarding) | none | none | **D** | No gold column; outreach metadata only — collected in chat if ever. |

Every field that touches `gold_facility_enriched` (complexity, ownership, public-only, evidence) is deferred because the **first** recommendation ranks districts; those filters only apply once we actually read facility rows (Section 5, query B). No onboarding field is required unless it joins to `specialty_canonical`.

---

## 4. The flow, step by step

### Step 0 — Where this renders
Both existing entry points change identically:
- `AuthGate` sign-up: replace the `doctorContextInline` `<textarea>` block (App.jsx ~889–920) with `<SpecialtyPicker>`. The doctor-ready gate `doctorProfileReady = profileText.trim().length > 20` becomes `doctorProfileReady = role !== "doctor" || !!primarySpecialtyCanonical`.
- `Onboarding` fallback (App.jsx ~964–1062): replace the textarea form body with the same `<SpecialtyPicker>` + the first-recommendation panel. `canSubmit = !!primarySpecialtyCanonical`.

`signUp` (App.jsx ~336) and `DoctorApp.saveProfile` (~520) stop calling `createDoctorProfile(userId, rawText)` and instead call `createDoctorProfileV2(userId, resolution, extras)` (Section 7).

### Step 1 — Pick specialty (REQUIRED, ≤20s)

**Control: `<SpecialtyPicker>` combobox.**
- A single text input with a filtered dropdown listing **all 110** canonical values. Under §9.1 every specialty is bundled (top ~20 districts), so each option shows a **demand-quality badge** computed from its bundled rows — not a presence flag:
  - `High-need districts` — the specialty has ≥1 `critical`/`high` `priority_tier` district in the bundle (the ~15 highest-unmet specialties).
  - `Moderate need` — bundled rows exist but the top tier is `moderate`/`low`/`empty`; the list still ranks, with the "best-available" framing of Section 6.
  - (There is no "no data" badge: all 110 in-vocab specialties return a non-empty national ranking. The only no-ranking path is out-of-vocab input, handled by the resolver block below.)
- Typing filters by canonical value **and** by the alias map (Section 4a). Aliases are a typing convenience only — they never bypass selection; the doctor must click/confirm a canonical option.
- **Direct selection of any of the 110 values always works**, independent of alias coverage. This resolves the review blocker: the combobox honestly exposes all 110, and unmatched aliases simply produce no typeahead hit — they do not block selecting the real value by name.
- "Type or speak instead" expander reveals the legacy textarea + mic (see 4b). Collapsed by default.

**Resolution rules (typed/aliased input → canonical):**
1. Exact canonical match → `method: "select"`, `confidence: 1`.
2. Unique alias match → `method: "alias"`, surface a confirm chip: *"We read that as **Internal Medicine** — correct?"* The doctor must accept or pick another option before continuing.
3. **Ambiguous alias** (maps to >1 canonical, e.g. *oncology*, *maternity/women's health*, *general physician*) → render a **disambiguation list** of the candidate canonical values; the doctor picks one. Nothing is stored until they pick. `method: "alias"`, `matchedAlias` recorded.
4. No confident match → **block**: input stays in component state, dropdown shows "No supported specialty matches that — pick from the list." Continue stays disabled. The raw input is **not** persisted (§9.8) and is **never** defaulted to a canonical value.

### Step 1a — Alias map (P0, client-side)

The alias map is a **typing aid**, not a coverage claim. Ambiguous heads expand to explicit choices (review fix: no silent collapse of distinct canonical values).

| Canonical value | Unambiguous aliases | Ambiguous head → disambiguation set |
|---|---|---|
| `pediatrics` | pediatrician, paediatrics, child health, child specialist | — |
| `obstetrics_gynecology` | obgyn, ob-gyn, obstetrics, gynecology | **"maternity" / "women's health"** → `obstetrics_gynecology`, `maternal_child_health`, `maternal_fetal_medicine`, `family_planning_contraception`, `urogynecology` |
| `internal_medicine` | internal medicine, adult medicine | **"general physician" / "physician" / "general medicine"** → `internal_medicine`, `family_medicine` (must pick) |
| `family_medicine` | family medicine, family practice | (also a candidate for the "general physician" set above) |
| `endocrinology_diabetes` | endocrinology, diabetes, diabetology, sugar, metabolic | — |
| `cardiology` | cardiac, heart, cardiovascular, hypertension, blood pressure | — |
| `pulmonology` | chest medicine, respiratory, lung, asthma, copd | — |
| `preventive_medicine` | public health, community medicine, preventive, screening, vaccination | — |
| `nutrition_dietetics` | nutrition, dietetics, dietitian, malnutrition | — |
| `neonatology` | newborn, neonatal, nicu | — |
| `maternal_child_health` | mch, mother and child health | — |
| `family_planning_contraception` | family planning, contraception, reproductive planning | — |
| `adolescent_medicine` | adolescent health, teenage health | — |
| `psychiatry` | mental health, psychiatrist | — |
| `medical_oncology` | medical oncology, chemotherapy | **"oncology" / "cancer"** → `medical_oncology`, `surgical_oncology`, `radiation_oncology`, `gynecologic_oncology`, `pediatric_hematology_oncology`, `neuro_oncology`, `ocular_oncology`, `orthopedic_oncology` |
| `emergency_medicine` | casualty, trauma, acute care | — |
| `critical_care_medicine` | icu, intensive care, critical care | — |

**`general medicine` legacy remap (review fix):** the old `extractLocalTags` default `"general medicine"` is invalid. On reading any legacy V1 profile, surface the ambiguous set `internal_medicine` vs `family_medicine` for explicit confirmation (`method: "legacy_alias"`); do **not** auto-pick `internal_medicine`.

### Step 1b — Free-text / voice path (optional, gated)

- The textarea + `useProfileRecorder` mic are retained inside the "Type or speak instead" expander, reusing the existing `useProfileRecorder` hook unchanged.
- On submit of typed/transcribed text, run the **same** alias resolver over the text and surface the top candidate(s) as confirm/disambiguation chips. The text is never stored as a specialty; only the confirmed canonical value is.
- **Voice in P0 (review blocker fix):** `/api/transcribe` is not implemented; `useProfileRecorder` already falls back to `DEMO_PROFILE_TRANSCRIPT`. In P0 the mic button is shown with a **"demo transcript"** label (matching the existing `StatusPill status="demo"`), and the transcript is treated as ordinary typed text fed to the resolver. **There is no `voice_alias` resolution method.** Voice-derived text that resolves via alias is recorded as `method: "alias"` with `source: "voice"` noted in `specialtyResolution`. A true `"voice"` method is introduced only in P1 when transcription is real.

### Step 1c — Continue
Enabled iff `primarySpecialtyCanonical` is a valid canonical value. On continue, write the V2 profile (Section 7) and render Step 2 inline (Onboarding) or proceed into `DoctorApp` (AuthGate path, which then lands on the first recommendation in the Search view).

### Step 2 — First recommendation (automatic; see Section 5).

### Step 3 — Refine (optional, mostly chat)
Below the first result, show **one-tap chips only**: `Add my state` (opens a multiselect of bundled states), and a `Teleconsult only` toggle. All other refinements (district/pincode, facility complexity, ownership, public-only, evidence strictness, intent) live in chat (Section 8 deferral table). Each refinement re-runs the client-side ranking (P0) or re-queries (P1) with no layout change.

---

## 5. The first recommendation

### What the doctor sees immediately after Step 1
A **district recommendation list** (top 10) for their specialty, each card showing:
- District + state (humanized from `district_name_norm` / `state_ut_norm`).
- `priority_tier` badge (critical/high/moderate/low/empty) and a precision caveat when `is_thin_specialty = true` or `score_basis` indicates a modeled/sparse basis (Section 6).
- `unmet_demand` and `pop_weighted_demand` shown as two distinct figures, labeled "unmet need" and "population-weighted need," with the dominant sort reason stated on the card ("ranked higher by population impact" vs "by unmet-need intensity").
- `driving_needs` (from the gap row) rendered as the **specialty-specific** rationale ("This district's measured need for your specialty is driven by: …").
- A clearly separated **district context** block from `gold_district_card`: `persona_label`, `top_need_categories`, and `top_priority_specialties` labeled *"Other priority specialties in this district"* so it is never confused with "this district needs **your** specialty" (review fix).

Selecting a district expands to **facilities** in it (query B), each card reading real `gold_facility_enriched` fields: name, type, `facility_complexity_tier`, `ownership_sector_final`, `is_public_health_facility`, and an evidence line from `has_specialist_evidence` + `specialist_domain_count`. No facility-suitability claim is made unless these columns are actually read (review fix).

### Recommendation logic — ranking semantics (review fixes incorporated)
District ordering is **tier-then-demand** (decision §9.3 — `specialty_absent` is NOT a ranking lever):
1. `priority_tier` ordered explicitly across **all five** values: `critical=0, high=1, moderate=2, low=3, empty=4`.
2. Within tier, **demand magnitude**: primary key `pop_weighted_demand DESC` (population impact is the mission's tie-breaker, decision §9.2), then `unmet_demand DESC`.
3. `specialty_absent` is **not used in ranking**. Grounding query (2026-06-15): in `gold_demand_supply_gap_v2`, `specialty_absent = true` ⟺ `n_facilities = 0` for **100% of rows** (7,492/7,492, avg coverage 0), so any "absent AND `n_facilities > 0`" tiebreak is an **empty set**; and `priority_tier` already surfaces these districts (60% of absent rows are critical/high vs 5% of non-absent). `specialty_absent` is instead rendered on the card as a **"no specialists of your kind here today"** context badge — a stronger call-to-help cue, not a sort key.
4. Rows where `is_thin_specialty = true` carry a suppressed-precision flag and are never presented with a hard rank claim ("a top-need district") — they read "a candidate district (limited data)".

### P0 — concrete client-side contract (no SQL runs in the prototype)
The bundled slice is `public/gold/demand_supply_slice.json`, `district_cards.json`, `facilities_slice.json`. Client functions implement the ranking; **no SQL** executes in P0 (review blocker fix). Deterministic district key: `districtKey = \`${state_ut_norm}::${district_name_norm}\``.

```js
// src/recommendation.js  (P0 client-side)
export function rankDistricts(slice, { specialty, preferredStatesNorm = [] }) {
  const TIER = { critical: 0, high: 1, moderate: 2, low: 3, empty: 4 };
  return slice
    .filter(r => r.specialty_canonical === specialty)
    .filter(r => preferredStatesNorm.length === 0 || preferredStatesNorm.includes(r.state_ut_norm))
    .sort((a, b) =>
      (TIER[a.priority_tier] ?? 5) - (TIER[b.priority_tier] ?? 5) ||
      (b.pop_weighted_demand - a.pop_weighted_demand) ||  // §9.2 population impact first
      (b.unmet_demand - a.unmet_demand)
      // §9.3: specialty_absent is NOT a sort key (absent ⟺ zero facilities in the data); it is a display badge only.
    )
    .slice(0, 10);  // slice bundles top ~20/specialty (§9.1); display top 10
}

export function facilitiesForDistrict(facSlice, districtKey, prefs = {}) {
  const TIER = { tertiary: 0, secondary: 1, primary: 2 };
  return facSlice
    .filter(f => `${f.nfhs_state_ut_norm}::${f.nfhs_district_name_norm}` === districtKey)
    .filter(f => !prefs.facilityComplexityTiers?.length || prefs.facilityComplexityTiers.includes(f.facility_complexity_tier))
    .filter(f => !prefs.ownershipSectorFinal?.length || prefs.ownershipSectorFinal.includes(f.ownership_sector_final))
    .filter(f => !prefs.publicHealthOnly || f.is_public_health_facility === true)
    .filter(f => !prefs.requireSpecialistEvidence || f.has_specialist_evidence === true)
    .sort((a, b) =>
      (b.has_specialist_evidence === true) - (a.has_specialist_evidence === true) ||
      (b.specialist_domain_count - a.specialist_domain_count) ||
      (TIER[a.facility_complexity_tier] ?? 3) - (TIER[b.facility_complexity_tier] ?? 3) ||
      (b.is_public_health_facility === true) - (a.is_public_health_facility === true)
    )
    .slice(0, 20);
}
```

### P1 — equivalent SQL (live Databricks, same keys, illustrative only)

Query A — district ranking:
```sql
SELECT g.state_ut_norm, g.district_name_norm, g.specialty_canonical,
       g.priority_tier, g.specialty_absent, g.unmet_demand, g.pop_weighted_demand,
       g.n_facilities, g.coverage, g.is_thin_specialty, g.score_basis, g.driving_needs,
       d.persona_label, d.top_need_categories, d.top_priority_specialties
FROM gold_demand_supply_gap_v2 g
LEFT JOIN gold_district_card d
  ON d.state_ut_norm = g.state_ut_norm AND d.district_name_norm = g.district_name_norm
WHERE g.specialty_canonical = :specialty
  AND (:statesEmpty OR g.state_ut_norm IN (:preferredStates))
ORDER BY
  CASE g.priority_tier
    WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'moderate' THEN 2
    WHEN 'low' THEN 3 ELSE 4 END,
  g.pop_weighted_demand DESC,   -- §9.2 population impact first
  g.unmet_demand DESC
  -- §9.3: specialty_absent intentionally NOT in ORDER BY (absent ⟺ zero facilities); surfaced as a display badge
LIMIT 10;
```

Query B — facilities for the selected districts:
```sql
SELECT f.*
FROM gold_facility_enriched f
JOIN selected_districts d
  ON f.nfhs_state_ut_norm = d.state_ut_norm
 AND f.nfhs_district_name_norm = d.district_name_norm
WHERE (:complexityEmpty OR f.facility_complexity_tier IN (:facilityComplexityTiers))
  AND (:ownershipEmpty   OR f.ownership_sector_final  IN (:ownershipSectorFinal))
  AND (:publicOnly = FALSE OR f.is_public_health_facility = TRUE)
  AND (:requireEvidence = FALSE OR f.has_specialist_evidence = TRUE)
ORDER BY
  CASE WHEN f.has_specialist_evidence THEN 0 ELSE 1 END,
  f.specialist_domain_count DESC,
  CASE f.facility_complexity_tier WHEN 'tertiary' THEN 0 WHEN 'secondary' THEN 1 ELSE 2 END,
  CASE WHEN f.is_public_health_facility THEN 0 ELSE 1 END
LIMIT 20;
```
All enum literals are quoted; tuple district filtering is expressed as the deterministic `state::district` key client-side and as a join in SQL. Optional facility filters never alter the district need score.

---

## 6. Cold-start & edge cases

| Case | Detection | Handling |
|---|---|---|
| **Specialty has rows but no critical/high districts** | ranked list top tier is `moderate`/`low`/`empty` | Show the list ordered by the Section 5 rule with honest copy: *"No high-need districts are measured for this specialty today — here are the best-available districts by population-weighted need."* Never the word "nearest" (no centroid/lat-long in gap or card tables; doctor location is deferred — review fix). |
| **All 110 specialties bundled (per-specialty empty state eliminated)** | n/a | Decision §9.1: P0 bundles the **top ~20 districts per specialty for all 110** canonical values (~2,000 rows, <1 MB). Every in-vocab specialty returns a non-empty national ranking — the earlier "~95 specialties with no offline data" empty state no longer exists. The only true-empty floor is out-of-vocab input (next-but-one row). |
| **State filter narrows to few/zero districts** | doctor adds a state not represented in that specialty's national top-~20 | The bundled slice is national-top-N, so a state filter is a **narrowing** of the national list, not a re-rank within the state. If the chosen state has 0 bundled rows for that specialty, keep the national list and note: *"Your state isn't among the top-need districts for this specialty in the offline preview — showing national high-need districts. Precise state-level ranking arrives with live data."* Dense per-state ranking is a P1 live-query capability. |
| **Unmatched / out-of-vocab specialty** (subspecialty not in the 110) | resolver finds no confident canonical match | Continue stays blocked; the typed/spoken input is held in **component state** to power disambiguation/fallback but is **not** persisted as a durable profile field (§9.8); no canonical is invented. Offer the local district/facility browse fallback so the doctor is never dead-ended, and a chat note for P1 ("ask about facilities once live data is connected"). |
| **Doctor skips geography** | `preferredStatesNorm = []`, `preferredDistricts = []` | National ranking across all states; `allowNationalFallback: true`. A single `Add my state` chip on results makes refinement one tap, not a re-do. |
| **District normalization fails (pincode→district bridge)** | input not in bundled controlled district list | Ignore the filter; store `{rawInput, normalizationStatus: "failed"}`; fall back to state-level then national. Visible warning: *"We couldn't resolve your district — showing state-level results."* Never fabricate a `district_name_norm`. |
| **Teleconsult-only doctor** | `preferences.teleconsultOnly = true` | Branch the result UI: still rank districts by `unmet_demand` / `pop_weighted_demand`, but **suppress physical-facility CTAs and "km/contact-to-visit" framing** (no gold column supports remote suitability). Cards read *"High remote-need districts for your specialty"* and link to district context, not "go visit this facility." |
| **Thin / modeled specialty rows** | `is_thin_specialty = true` or `score_basis` flags a sparse/modeled basis | Suppress precision: badge reads "limited data," ranking shown as "candidate" not "top," and the list explicitly states the basis. No top-10 precision claim for thin specialties (review fix). |
| **Unverified doctor (all P0 doctors)** | no credential field exists in any gold schema or in localStorage | Every doctor is **unverified** in P0. The profile carries `verification: { status: "unverified" }`. Unverified doctors may **browse** district need data and facility evidence and **draft** outreach, but the UI must not imply verified/licensed status or auto-send anything to a facility — existing human-approval gates in `OutreachPanel` (draft → approve → send) are retained and labeled "self-reported, unverified." A `verified` status and gated actions are introduced only with P1 backend identity. |
| **Privacy / PHI** | free text in resolver input | Decision §9.8: **no PHI in P0**, and free text is **discarded once a canonical specialty resolves** — the durable profile keeps only `primarySpecialtyCanonical` + the `specialtyResolution` audit (whose `input` is retained solely through resolution); there is **no persisted `rawText` field**. Outreach drafting uses structured fields, not free text. Onboarding copy states "Do not enter patient-identifying information." `resetProfile` (already in `DoctorApp`) deletes the localStorage key — the documented deletion path. localStorage is labeled local-only preference capture, not a durable medical record. |

---

## 7. Data model changes

### New profile shape (`DoctorProfileV2`), keyed by `localStorage["referralCopilotDoctorProfile:{userId}"]` (unchanged key via `getProfileKey`).

```ts
type CanonicalSpecialty = string; // exactly one of the 110 controlled specialty_canonical values

interface DoctorProfileV2 {
  schemaVersion: 2;
  doctorId: string;
  createdAt: string;
  updatedAt: string;

  // Specialty — the only join key
  primarySpecialtyCanonical: CanonicalSpecialty;
  primarySpecialtyLabel: string;            // humanized, display only
  specialtyResolution: {
    input: string;                          // what the doctor typed/spoke (may be "")
    status: "matched";
    method: "select" | "alias" | "legacy_alias"; // NO "voice_alias" in P0
    source: "picker" | "voice";             // voice = demo transcript in P0
    confidence: number;
    matchedAlias?: string;
  };

  geography: {
    preferredStatesNorm: string[];          // controlled state_ut_norm values
    preferredDistricts: Array<{
      state_ut_norm: string;
      district_name_norm: string;
      source: "select" | "pincode" | "chat";
      rawInput?: string;
      normalizationStatus: "matched" | "failed";
    }>;
    allowNationalFallback: boolean;
  };

  preferences: {
    facilityComplexityTiers: string[];      // [] = any (default)
    ownershipSectorFinal: string[];         // [] = any (default)
    publicHealthOnly: boolean;              // default false
    requireSpecialistEvidence: boolean;     // default false
    teleconsultOnly: boolean;               // default false
    intent: "volunteer" | "referral" | "either"; // default "either"; copy/outreach only
  };

  verification: { status: "unverified" };   // P0 always unverified

  // §9.8: NO persisted rawText field. The typed/voice input lives only in
  // specialtyResolution.input (kept through resolution, then safe to clear) —
  // never a join key, never a durable free-text blob.

  // Backward-compat read surface for existing components
  tags: {
    specialties: string[];                  // [primarySpecialtyCanonical] — always populated
    regions: string[];                      // humanized states, for legacy reads
    experience: string;                     // "" unless captured later
  };
}
```

### Helper changes in `src/App.jsx`
- **Replace** `createDoctorProfile(userId, rawText)` with `createDoctorProfileV2(userId, resolution, extras)` building the shape above; `tags.specialties = [resolution.canonical]`.
- **Retire** `extractLocalTags` from the onboarding path. Keep it only inside a `migrateV1Profile(v1)` helper that lifts an old `{rawText, tags}` profile into V2 by re-resolving `tags.specialties[0]` through the alias map (with the `general medicine → internal_medicine | family_medicine` confirmation), preserving `regions` as humanized states.
- **New module** `src/specialties.js`: the 110 canonical values, humanized labels, the alias map, and `resolveSpecialty(input)` → `{ status, candidates[] }`.
- **New module** `src/geography.js`: bundled controlled `state_ut_norm` + `district_name_norm` lists (derived from the gold keys), `normalizeState`, `normalizeDistrict` → `{matched, value}`.
- **New module** `src/recommendation.js`: `rankDistricts`, `facilitiesForDistrict` (Section 5).
- **Compat reads (must keep working):** `TopBar` (`profile.tags.specialties[0]`), `SearchPanel` greeting (`profile.tags.specialties.join(", ")`), `buildOutreachMessage` (`profile.tags.specialties[0]`, `profile.tags.regions[0]`). Migrate each to prefer `primarySpecialtyLabel ?? tags.specialties[0]` for display while `tags.specialties[0]` stays equal to `primarySpecialtyCanonical` so no existing read breaks. On load, if a stored profile lacks `schemaVersion === 2`, run `migrateV1Profile` before first render.

---

## 8. Build plan (phased, mapped to existing components)

### P0 — localStorage prototype, static canonical list + bundled gold slice (no backend)
1. Add `src/specialties.js` (110 values + labels + alias map + `resolveSpecialty`).
2. Add `<SpecialtyPicker>` component (combobox, coverage badges, alias confirm/disambiguation, collapsed "type or speak" expander reusing `useProfileRecorder`).
3. Wire into **`AuthGate`**: replace the `doctorContextInline` block; change `doctorProfileReady` to require `primarySpecialtyCanonical`; pass the resolution up through the existing `onSignUp`/`signUp` props (add `specialtyResolution` to the `signUp` argument object alongside the existing fields).
4. Wire into **`Onboarding`**: replace the textarea form with `<SpecialtyPicker>` + the inline first-recommendation panel; `canSubmit = !!primarySpecialtyCanonical`; `onComplete` now receives a resolution object, and `DoctorApp.saveProfile` builds V2.
5. Replace `createDoctorProfile` → `createDoctorProfileV2`; add `migrateV1Profile`; retire `extractLocalTags` from the live path; update the three compat reads.
6. Add `public/gold/*.json` bundled slices (top ~20 districts/specialty for all 110, §9.1) + `src/recommendation.js`; render the district list and (on expand) facility cards. Implement all edge-case states (Section 6): out-of-vocab browse fallback, state-filter narrowing note, thin-specialty caveats, the `specialty_absent` badge, national-skip chip, and the teleconsult copy-only branch.
7. Add `src/geography.js` controlled state/district lists for the `Add my state` chip and any district refinement.
8. Keep all human-approval gates in `OutreachPanel`; label doctors "unverified, self-reported."

**P0 acceptance:** a doctor selects (or types→confirms) one of the 110 canonical specialties in ≤20s, lands on a district recommendation driven by the bundled gap slice, expands to real facility rows, and never hits a blank screen for any of the 110 values.

### P1 — backend + live gold queries
1. FastAPI + Databricks SQL behind `/api/recommendations` (Query A) and `/api/facilities` (Query B); the client swaps `rankDistricts`/`facilitiesForDistrict` data source from bundled JSON to API responses with **no UX change** (identical keys).
2. Implement `/api/transcribe`; introduce real `specialtyResolution.method: "voice"`.
3. Backend identity/credential verification → `verification.status: "verified"`, and gate trust-sensitive actions (sending outreach to real facilities) behind it.
4. Replace localStorage profile with backend-stored profile (durable, cross-device); localStorage becomes a cache only.

### Files touched
`src/App.jsx` (AuthGate, Onboarding, DoctorApp.saveProfile/resetProfile, signUp, TopBar, SearchPanel, buildOutreachMessage, remove createDoctorProfile/extractLocalTags from live path) · new `src/specialties.js`, `src/geography.js`, `src/recommendation.js` · new `public/gold/*.json`.

---

## 9. Resolved decisions (locked 2026-06-15)

All eight open questions are resolved. P0 builds against these; they are referenced as §9.N throughout the spec.

| # | Decision | Locked choice | Build implication |
|---|---|---|---|
| 9.1 | **Bundled slice scope** | **Top ~20 districts per specialty, all 110.** | `public/gold/demand_supply_slice.json` ≈ 2,000 rows (<1 MB). Every in-vocab specialty returns a non-empty national ranking; the per-specialty empty state is removed (Section 6). The slice is national-top-N, so a state filter narrows it (see §9.5 + the state-filter edge in Section 6). |
| 9.2 | **Sort dominance** | **Population-weighted first.** `pop_weighted_demand DESC`, then `unmet_demand DESC`, within `priority_tier`. | Maximizes people reached. Encoded in `rankDistricts` and Query A (Section 5). Cards state the dominant sort reason. |
| 9.3 | **`specialty_absent` rule** | **Not a ranking lever; display badge only.** | Grounding query: `specialty_absent = true` ⟺ `n_facilities = 0` for 100% of rows, so the prior "absent AND `n_facilities > 0`" tiebreak was an empty set and is removed from `rankDistricts` and Query A. Rendered as a "no specialists of your kind here today" badge. |
| 9.4 | **Specialties at onboarding** | **Exactly one required canonical specialty.** | Single join key; onboarding stays ≤20 s. Secondary specialties are a chat refinement (Section 8). No OR-across-specialties ranking in P0. |
| 9.5 | **Geography granularity (P0)** | **State-level only.** | P0 captures `preferredStatesNorm` from the bundled controlled state list; district/pincode normalization is deferred to chat/P1 (the pincode→district bridge is the known weak link). |
| 9.6 | **Teleconsult mode** | **Minimal P0 copy-only toggle.** | `preferences.teleconsultOnly` reframes result cards as "high remote-need districts" and suppresses physical-facility/visit CTAs (Section 6). No data path; no gold column invented. |
| 9.7 | **`intent` field** | **Keep as outreach metadata.** | `preferences.intent` (`volunteer`/`referral`/`either`) is retained but used only for outreach-draft tone in `buildOutreachMessage`; never affects ranking. Captured in chat, not the required path. |
| 9.8 | **Privacy posture** | **No PHI in P0; drop free text after resolution.** | No persisted `rawText` field. The typed/voice input lives only in `specialtyResolution.input` through resolution, then is safe to clear. Onboarding copy prohibits patient-identifying info; `resetProfile` is the deletion path. |

**Files (this repo):** spec lives at `docs/superpowers/specs/2026-06-15-specialist-onboarding-flow.md`. Implementation entry point: `src/App.jsx` (`AuthGate`, `Onboarding`, `DoctorApp.saveProfile/resetProfile`, `signUp`, `TopBar`, `SearchPanel`, `buildOutreachMessage`; remove `createDoctorProfile`/`extractLocalTags` from the live path) plus new modules `src/specialties.js`, `src/geography.js`, `src/recommendation.js`, and `public/gold/*.json`.

**Next gate:** these decisions are locked, but P0 implementation has not started. Implementing P0 is a separate go-ahead.
