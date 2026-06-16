# Shiftlink — Specialist Onboarding + Recommend (FINAL, build-ready)

**Status:** Build-ready P0. **Supersedes** `2026-06-15-specialist-onboarding-flow.md` (which is now reference only).
**Target:** `src/App.jsx` (single-file React 19 / Vite prototype) + new modules `src/specialties.js`, `src/recommendation.js`, and bundled `public/gold/*.json`.
**Read first:** `2026-06-16-shiftlink-integration-spec.md` (the backbone) and `2026-06-16-recommender-changes.md` (which produces the JSON this consumes).
**Merge order:** lands **after** outreach-implementation (integration-spec §6.4). All `App.jsx` line numbers in the old spec are stale — **re-grep symbols**.

> **The two changes vs the 2026-06-15 spec, both per Codex/integration-spec:**
> 1. **List 110, rank 17.** The old §9.1 "all 110 return a non-empty ranking" is **reversed** — it is data-impossible (15,599 null ranking rows). 93 specialties honestly return `no_gap_signal`.
> 2. **No app-side ranking.** The old `rankDistricts`/`facilitiesForDistrict` JS ranker is **deleted**. `src/recommendation.js` becomes a thin reader/filter over the pre-ranked `public/gold/*.json` that `recommend.py --emit-slice` produces.

---

## 1. One job

Onboarding captures exactly **one** structured field: the doctor's **canonical specialty** (`specialty_canonical`, one of 110). That is the only join key into the gold layer and the only required input for a defensible first recommendation. **Friction budget: ≤20s — one required field + one button.** Geography is optional (national ranking is a valid first answer). No textarea gate, no mic gate.

The free-text `extractLocalTags` onboarding is retired from the live path (it produced 4 non-canonical labels with zero gold linkage). It survives only inside `migrateV1Profile` (§5).

---

## 2. The flow

### Step 0 — Where it renders (two entry points, same control)
- **`AuthGate` sign-up:** replace the doctor-context `<textarea>` block with `<SpecialtyPicker>`. The doctor-ready gate becomes `doctorProfileReady = role !== "doctor" || !!primarySpecialtyCanonical`.
- **`Onboarding` fallback** (rendered when a doctor has no profile): replace the textarea form body with `<SpecialtyPicker>` + the inline first-recommendation panel. `canSubmit = !!primarySpecialtyCanonical`.

`signUp` and `DoctorApp.saveProfile` stop calling `createDoctorProfile(userId, rawText)` and instead call `createDoctorProfileV2(userId, resolution, extras)` (§5).

### Step 1 — `<SpecialtyPicker>` (REQUIRED)
A searchable combobox over **all 110** canonical values (loaded from `specialty_aliases.json` + the canonical list in `src/specialties.js`). Each option shows an honest **signal badge** computed from the bundled slice:
- **"High-need districts"** — specialty is one of the 17 demand-bearing AND has ≥1 critical/high district (all 17 except `pulmonology`/`neonatology`).
- **"Need signal (best-available)"** — demand-bearing but top tier is moderate/low (`pulmonology`, `neonatology`).
- **"No need-gap signal"** — one of the 93; selecting it is allowed but leads to the honest refusal screen (§3, cold-start). *This badge is the honest replacement for the old "every specialty ranks" claim.*

Resolution rules (typed/aliased input → canonical), unchanged from the 2026-06-15 spec §4:
1. Exact canonical match → `method:"select"`.
2. Unique alias → confirm chip ("We read that as **Internal Medicine** — correct?").
3. Ambiguous head ("oncology", "maternity", "general physician") → disambiguation list; nothing stored until the doctor picks.
4. No confident match → **block**; raw input held in component state only (never persisted), never defaulted to a canonical value.

**Direct selection of any of the 110 always works**, independent of alias coverage.

**"Type or speak instead"** expander (collapsed by default) keeps the textarea + `useProfileRecorder` mic. P0: `/api/transcribe` is **unimplemented**; the mic falls back to `DEMO_PROFILE_TRANSCRIPT` (already works), labeled "demo transcript". Transcribed/typed text is fed to the **same** alias resolver; only the confirmed canonical value is stored. No `voice` resolution method in P0 (`source:"voice"` is noted on the resolution; `method` is still `select`/`alias`).

### Step 1c — Continue
Enabled iff `primarySpecialtyCanonical` is a valid canonical value. On continue: write the V2 profile (§5), then render the first recommendation (Step 2).

### Step 2 — First recommendation (automatic) — see §3.

### Step 3 — Refine (optional, one tap)
Below the result, show only: an **"Add my state"** chip (multiselect over the bundled states) and a **`Teleconsult only`** toggle (copy-only reframe). Everything else is deferred to chat/P1. *(Codex notes "Add my state" is optional demo sugar — keep it, but label it honestly as narrowing the national top-need list, not a state re-rank; cut it if it confuses. See §3 state-filter edge.)*

---

## 3. The first recommendation (the Recommend tab)

`src/recommendation.js` is a **thin reader** over `public/gold/demand_supply_slice.json` (no ranking — it is pre-ranked by `recommend.py`). The "Search" tab is **renamed "Recommend"** (label only; `activeView` stays `"search"`).

```js
// src/recommendation.js — NO sorting by demand columns. Filter pre-ranked data only.
import slice from "../public/gold/demand_supply_slice.json";

export function recommendationFor(specialtyCanonical) {
  if (slice.noSignal.includes(specialtyCanonical))
    return { status: "no_gap_signal", districts: [] };
  const districts = slice.demandBearing[specialtyCanonical] || [];
  return { status: districts.length ? "ok" : "no_gap_signal", districts };
}

export function applyStateFilter(districts, preferredStatesNorm = []) {
  // Narrows the national top-N to chosen states — NOT a re-rank (the slice is national-top-N).
  if (!preferredStatesNorm.length) return districts;
  const inState = districts.filter(d => preferredStatesNorm.includes(d.state_ut_norm));
  return inState.length ? inState : districts; // keep national list if state absent; show honest note
}
```

**District card** (top 10), each reading the pre-ranked row:
- District + state (humanized from `district_name_norm`/`state_ut_norm`).
- **Headline `impact_index` (0–100)** + `priority_tier` **badge** (critical/high/moderate/low). *(Integration-spec D12: impact_index is the sort + headline; tier is a badge.)*
- `specialty_absent` → "no specialists of your kind here today" badge (call-to-help cue, not a sort key).
- `is_thin_specialty:true` → "candidate district (limited data)" caveat; never a hard "top-need" claim.
- `driving_needs[]` rendered as the specialty-specific "why" (it's an array — list it).
- A separated **district-context** block from `gold_district_card` (bundled): `persona_label`, `top_need_categories[]`, and `top_priority_specialties[]` labeled **"Other priority specialties in this district"** so it's never confused with "this district needs *your* specialty."

Selecting a district expands its **host clinics** from `facilities_slice.json` (filtered by `districtKey`), each a canonical facility object (integration-spec §4) rendered by the **rewritten `FacilityCard`** (integration-spec §7.5): name, type, `complexityTier`, `ownership`/`isPublic`, and an evidence line from `hasSpecialistEvidence` + `specialistDomainCount`. **Expanding a district MERGES those facilities into the `facilities` state array** (integration-spec §7.1) so outreach/scheduler can find them by id. **No "nearest"/distance language** (districts have no centroid).

`facilitiesForDistrict` is also a **thin filter** (no ranking beyond the pre-baked order; optional client-side facility filters by complexity/ownership/public/evidence are allowed *after* the district is chosen — they never change the district need score):
```js
export function facilitiesForDistrict(facSlice, districtKey, prefs = {}) {
  return facSlice
    .filter(f => f.districtKey === districtKey)
    .filter(f => !prefs.facilityComplexityTiers?.length || prefs.facilityComplexityTiers.includes(f.complexityTier))
    .filter(f => !prefs.ownershipSectorFinal?.length || prefs.ownershipSectorFinal.includes(f.ownership))
    .filter(f => !prefs.publicHealthOnly || f.isPublic === true)
    .filter(f => !prefs.requireSpecialistEvidence || f.hasSpecialistEvidence === true);
}
```

### Cold-start & edge cases (honest, all P0)
| Case | Handling |
|---|---|
| **93 no-signal specialties** | `status:"no_gap_signal"` → honest screen: "This specialty has no NFHS need-gap signal — no district ranking can be made from health-need gaps." Offer the **browse fallback** (let them open any district's context/facilities) so they're never dead-ended. |
| **`pulmonology`/`neonatology` (0 critical/high)** | Show the ranked list with copy: "No high-need districts are measured for this specialty today — here are the best-available districts by population-weighted need." Never the word "nearest." |
| **State filter narrows to 0** | Keep the national list; note: "Your state isn't among the top-need districts for this specialty in the offline preview — showing national high-need districts. Precise state-level ranking arrives with live data." |
| **Thin specialty** | "limited data," "candidate" not "top," basis stated. |
| **Greenfield district (no host clinic)** | Card shows the district + a "no credible host clinic in the data here yet" line; **not** an outreach/scheduler target. *(Demo: pick a row with real hosts — integration-spec §9.)* |
| **Unverified doctor (all P0)** | `verification:{status:"unverified"}`; may browse + draft outreach; UI never implies licensed/verified status; human-approval gates retained, labeled "self-reported, unverified." |
| **Privacy/PHI** | No PHI in P0; free text discarded once a canonical specialty resolves (no persisted `rawText`); onboarding copy: "Do not enter patient-identifying information." `resetProfile` is the deletion path. |

---

## 4. Picker data & alias map
- `src/specialties.js`: the 110 canonical values, humanized labels, and `resolveSpecialty(input) → { status, candidates[] }` over the alias map.
- The alias map is loaded from `public/gold/specialty_aliases.json` (emitted by `recommend.py --emit-slice`, integration-spec §5.5) so the picker and the recommender resolve identically. `src/specialties.js` may inline a copy for synchronous availability.

---

## 5. Data model — `DoctorProfileV2`

Keyed by `localStorage["referralCopilotDoctorProfile:{userId}"]` (unchanged key via `getProfileKey`). **`tags` is kept mirrored** for P0 back-compat (integration-spec §7.4).

```ts
interface DoctorProfileV2 {
  schemaVersion: 2;
  doctorId: string; createdAt: string; updatedAt: string;

  primarySpecialtyCanonical: string;        // one of 110; the only join key
  primarySpecialtyLabel: string;            // humanized, display only
  specialtyResolution: {
    input: string;                          // typed/spoken text (transient; cleared after resolution)
    status: "matched";
    method: "select" | "alias" | "legacy_alias";   // NO "voice" in P0
    source: "picker" | "voice";             // voice = demo transcript in P0
    confidence: number; matchedAlias?: string;
  };

  geography: {
    preferredStatesNorm: string[];          // controlled state_ut_norm values ("Add my state")
    allowNationalFallback: boolean;         // default true
  };
  preferences: {
    facilityComplexityTiers: string[];      // [] = any
    ownershipSectorFinal: string[];         // [] = any
    publicHealthOnly: boolean;              // default false
    requireSpecialistEvidence: boolean;     // default false
    teleconsultOnly: boolean;               // default false
    intent: "volunteer";                    // HARDCODED (integration-spec D26; no gold column, no toggle)
  };
  verification: { status: "unverified" };

  // Back-compat mirror — keep populated (integration-spec §7.4)
  tags: { specialties: string[]; regions: string[]; experience: string };
  //       [primarySpecialtyCanonical]   humanized states   ""
}
```

Helper changes in `src/App.jsx`:
- **Replace** `createDoctorProfile(userId, rawText)` → `createDoctorProfileV2(userId, resolution, extras)`; set `tags.specialties=[resolution.canonical]`, `tags.regions=[…humanized preferredStates]`.
- **`migrateV1Profile(v1)`**: lift an old `{rawText, tags}` into V2 by re-resolving `tags.specialties[0]` through the alias map (with the `general medicine → internal_medicine | family_medicine` confirmation); preserve `regions` as humanized states. Run on load if `schemaVersion !== 2`, before first render.
- **Retire `extractLocalTags`** from the live path (keep only inside `migrateV1Profile`).
- **Compat reads** (prefer V2, keep working): `TopBar` (`primarySpecialtyLabel ?? tags.specialties[0]`), `SearchPanel` greeting, `buildOutreachMessage`, and the outreach worktree's `buildDoctorForApi` (integration-spec §7.4).

---

## 6. Build plan (P0, client-only — no backend)

1. `recommend.py --emit-slice` → `public/gold/{demand_supply_slice,facilities_slice,facilities_seed,specialty_aliases}.json` (recommender spec).
2. `src/specialties.js` (110 values + labels + `resolveSpecialty`).
3. `<SpecialtyPicker>` (combobox, signal badges from the slice, alias confirm/disambiguation, collapsed "type or speak" expander reusing `useProfileRecorder`).
4. Wire into `AuthGate` + `Onboarding` (§2); `signUp`/`saveProfile` build V2; add `migrateV1Profile`; retire `extractLocalTags`; update the 4 compat reads.
5. `src/recommendation.js` thin reader/filter (§3); rename the "Search" tab label → **"Recommend"**.
6. **Rewrite `FacilityCard`** + **remove `EvidenceDrawer`** and the map fallback (integration-spec §7.5); render the district list + host-clinic cards; implement all §3 edge states.
7. `facilities` becomes MERGE-by-id state seeded from `facilities_seed.json`; expanding a district merges its host clinics (integration-spec §7.1).
8. Hardcode `intent:"volunteer"`; keep human-approval gates; label doctors "unverified."

**P0 acceptance:** a doctor selects one of 110 specialties in ≤20s; a demand-bearing one lands on an impact-ranked district list (headline 0–100 + tier badge) driven by the bundled slice; expanding a district shows real host-clinic cards merged into `facilities`; a no-signal specialty shows the honest refusal + browse fallback; **no blank screen and no fabricated ranking for any of the 110**; the rewritten FacilityCard renders with zero reads of `tier/score/distanceKm/evidence/flags/map`.

---

## 7. P1 (post-demo stretch)
Express `/api/recommendations` (the recommender as a service) + `/api/facilities` backed by live Databricks SQL (same `districtKey` keys → zero UX change); real `/api/transcribe` + a true `voice` method; backend identity → `verification.status:"verified"` gating outreach to real facilities; durable backend profile (localStorage becomes a cache). Integration-spec §6.5.
