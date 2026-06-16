# How the recommender was evaluated

The Specialist Placement Recommender was built and hardened in a **feedback loop**:
design → diverse personas with oracles → run → adversarial critique → refine, with **Codex
as implementation partner + adversarial reviewer** (with live + snapshot data access) across a
3-round workflow plus a final adversarial pass. This file records the method, the findings, and
the fixes — so the result is auditable, not just asserted.

## The test suite: 8 personas, each with an oracle

[`personas.json`](personas.json) stresses every preference dimension. Each persona has an
**oracle** — concrete assertions a good top-k must satisfy:

| persona | specialty | mode / setting | what it tests |
|---|---|---|---|
| Dr. Asha Verma | pediatrician | open / any | max-impact baseline (should surface the worst child-health gaps) |
| Dr. Suresh Iyer | cardiologist | prefer / any | impact-vs-preference tension (prefers South India) |
| Dr. Meera Nair | OB-GYN | prefer / public | preferring a **well-served** region (Kerala) → must show best-feasible + flag bigger gaps |
| Dr. Ramesh Singh | pediatrician | fixed / public | hard location filter (Bihar & UP only) + public-only hosts |
| Dr. Priya Menon | nutritionist | open / public | **thin specialty** → must be labeled need-driven |
| Dr. Kavya Reddy | adolescent medicine | fixed / any | thin specialty under a hard filter (Bihar) |
| Dr. Arjun Khanna | internist | avoid / private | exclusion list (avoids NE & island states) + private hosts |
| Dr. Neha Gupta | dermatologist | prefer / any | **no NFHS need-gap signal** → graceful `no_gap_signal` |

## Metrics (per persona)

- **impact_capture** — mean impact index of the returned districts (higher = bigger gaps closed)
- **need_targeting** — % of recs that are `critical`/`high` tier or zero-supply
- **preference_adherence** — % of recs satisfying the hard constraints (`fixed`/`avoid` must = 100%)
- **host_credible** — no dental/lab/diagnostic/alt-medicine clinic shown as a host for a clinician
- **honesty** — thin specialties labeled; `no_gap_signal` handled; no garbage fields
- **oracle_passed** — the persona's specific assertions all hold

**Final result:** all 8 personas pass oracle ✓, host-credible ✓, honesty ✓, and 100%
preference adherence on every `fixed`/`avoid` persona. (Meera's deliberately-low impact_capture
is a *pass*: Kerala is well-served, so her in-state recs honestly carry impact ≈ 0 while the note
points her to the 100/100 gap elsewhere — exactly the intended behavior.)

## Adversarial findings → fixes (the loop's value)

The adversarial reviewer kept hunting after the evaluator was already green — that's the point.
Material issues found and fixed:

**During the 3-round workflow:**
1. **`prefer` mode ignored the stated preference** — a South-India cardiologist got an all-NE-states
   list (the old multiplicative soft-boost could never overcome a 100-vs-73 impact gap). → Replaced
   with a **two-section policy**: Section A = best in your preferred states (true impact), Section B
   = highest-impact nationally, with a note naming the trade-off. The doctor now always sees their
   preference represented *and* the bigger gap, stated explicitly.
2. **Non-credible clinic hosts** — dental clinics, pathology labs, diagnostic collection centres
   surfaced as hosts for pediatricians/OB-GYNs. → A **credible-clinical-host gate** (qualify
   hospitals/CHC/PHC/medical-college/public; hard-disqualify single-specialty/diagnostic/non-allopathic
   by name), no reliance on the miscalibrated tier or all-zero bed/doctor counts; honest `greenfield`
   when nothing qualifies.
3. **Transparency note misfired** — it was computed off a boosted value, so it never fired in
   `prefer` mode. → Recomputed from the raw preferred-only best so it fires and names the gap.
4. **Ownership mislabeling** — null ownership rendered as "private". → `unknown` is never guessed.

**Final adversarial pass (6 edge cases closed):**
5. Verbose `obstetrician_gynecologist` (and `obstetrics and gynecology`, `&`) now alias correctly.
6. "Nature Cure" (alternative-medicine) hospitals now disqualified as hosts.
7. `prefer` mode with **zero-gap preferred states** now emits an honest "none of your preferred
   states have a recorded gap" note instead of falsely claiming a populated Section A.
8. `fixed` mode with **empty `--states`** now returns `no_feasible_district` (was silently
   falling back to national results); CLI `--states`/`--avoid` switched to `nargs="*"` so bare/empty
   flags don't crash.
9. **Impact-order inversion removed** — a `setting=public` district tilt was making an
   already-served district (impact 89) outrank a higher-need one (impact 96), and perversely pushed
   the highest-impact *zero-supply* districts down (they have `n_public=0` by definition). District
   ranking is now **pure impact**; the public/private preference applies only at the clinic layer.

## Regression protection

`python3 recommend.py --selftest` runs **13 checks** (all green), including locks for the
pure-impact ordering and the empty-`fixed`-states guard. A monotonicity sweep across
6 specialties × {public, private, any} shows **0 impact inversions**.

## Final sign-off

**Codex adversarial reviewer — verdict: SHIP.** After the last 2 fixes: 13/13 self-test green,
demo clean, and an adversarial sweep across ~33,000 recommendations (17 specialties × 3 settings)
found **0 non-credible-host leaks, 0 avoid-mode exclusion leaks**, correct alias resolution,
honest zero-gap notes, and public-clinic filtering all clean. No regression.

## Known limits (honest, not bugs)

- Impact is **prevalence-scaled, not headcount** — tiny states can outrank big metros (v3:
  add Census population for per-capita impact).
- Only **17 NFHS-need-driven specialties** carry a signal; others return `no_gap_signal`.
- Sparse facility coverage in some states yields frequent `greenfield` results — the tool says
  so plainly rather than inventing a host.
