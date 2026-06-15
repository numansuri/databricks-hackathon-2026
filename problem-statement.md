# Problem Statement — Referral Copilot

**Hackathon:** Databricks Apps & Agents for Good Hackathon 2026 (Data + AI Summit, Moscone South)
**Selected track:** **Referral Copilot** (Track 3 of 4)
**Deadline:** June 16, 2026 @ 2:30pm PDT
**Team size:** 2–4 · **Prize pool:** $17,500 ($10k / $5k / $2.5k)

---

## The mission (whole hackathon)

We are given ~10,000 **messy, web-scraped Indian healthcare facility records** and asked to
*turn this messy data into decisions that non-technical users can trust.* Across every track,
three things are non-negotiable:

1. **Extract structure** from noisy free text.
2. **Show evidence** — cite the underlying facility text behind every claim, score, or ranking.
3. **Communicate uncertainty honestly** — never present weak evidence as fact.

This is a *trust-and-evidence* challenge, not a flashy-features challenge.

---

## The problem we're solving (Referral Copilot)

> **Where should a patient or care coordinator actually go?**

A user enters a **location** and a **care need** in plain language — e.g.
*"dialysis near Jaipur"* or *"emergency surgery near Patna"* — and receives an
**evidence-attached, trust-rated shortlist of candidate facilities.**

The hard part is not search. It's that the facility data is full of **unverified claims**:
a row may list "ICU" or "dialysis" in a structured field while its description text says nothing
to back it up. The organizers are explicit: *treat these fields as claims to verify, not ground truth.*
So a referral that simply filters on the `capability`/`procedure` columns is exactly the
naive solution the judges are warning against.

**Our job:** for each candidate facility, (a) find the evidence in its own text that supports
the requested care need, (b) rate how trustworthy that evidence is, and (c) present a ranked
shortlist that lets a non-technical coordinator decide with confidence — including being honest
when the evidence is weak.

### Who it's for
A **care coordinator / patient / family member** with no technical background, under time
pressure, who needs a trustworthy "go here" answer — and needs to *see why*.

---

## What success looks like

A live Databricks App where a non-technical user can:

- Enter a natural-language location + care need.
- Get a ranked shortlist of nearby facilities matching that need.
- See, for each facility, **the cited snippet of source text** that justifies the match.
- See an **honest trust/confidence rating** (strong evidence → weak/no evidence).
- **Act and have it persist** — save a shortlist, add notes, override a ranking.

---

## Hard requirements (non-negotiable)

- [ ] Runs as a **Databricks App on Free Edition** (a live, deployed app — not a notebook).
- [ ] Uses the **provided facility dataset**.
- [ ] **Cites underlying facility text** for any important claim, recommendation, score, or ranking.
- [ ] **Communicates uncertainty** instead of presenting weak evidence as fact.
- [ ] **Persists user actions** (notes, overrides, shortlists, decisions).
- [ ] Designed for a **non-technical user**.

## Deliverables

- [ ] **Git repository**
- [ ] **Live Databricks App**
- [ ] **3-minute demo** covering: the user, the workflow, the technical approach, key tradeoffs.

## Judging criteria (what we optimize for)

| Axis | What it rewards |
|------|-----------------|
| **Product judgment** | Clarity for the user, a thoughtful workflow |
| **Evidence & uncertainty** | Citation grounding + honest handling — *this is where Referral Copilot wins or loses* |
| **Technical execution** | Reliability, real use of Databricks capabilities |
| **Ambition** | Meaningful extensions beyond the minimum |

---

## Data we have (see [`findings/dataset-deep-dive.md`](findings/dataset-deep-dive.md))

The workspace contains **three joinable tables**, richer than the Devpost description:

- **`facilities` (10,088 × 51)** — the *supply* side. Clean lat/long (98.8%), city/state, pincode,
  specialties, and the free-text `description` that is our **evidence source for citations**.
- **`india_post_pincode_directory` (~165k)** — the **geo bridge**: turns "near Jaipur" into a
  real pincode/lat-long neighborhood for distance ranking.
- **`nfhs_5_district_health_indicators` (706)** — district-level health *need*; not core to a
  referral, but a candidate **ambition extension** (e.g. flag referrals in underserved districts).

Known data traps relevant to us: missing values are the literal string `"null"`; `specialties`/
`phone_numbers` are JSON-array strings; ~58–73 column-shifted rows to filter
(`WHERE organization_type = 'facility'`); the `description` prose is the trustworthy evidence,
the structured capability fields are *claims to verify*.

---

## Our specific idea

**Referral Copilot for Volunteer Specialists** — a specialist enters their expertise + availability
and gets an evidence-cited, trust-rated facility shortlist ranked by regional health need, plus
draft outreach (human-in-the-loop, no real sends) and an honest day-by-day visit schedule. Three
MVP levers — **recommendation**, **automated outreach (draft-only)**, **AI scheduling** — each with
evidence + uncertainty signaling wired in.

→ Full data-grounded spec: [`ideation.md`](ideation.md).
