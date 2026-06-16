# Referral Copilot — Design Spec
**Hackathon:** Databricks Apps & Agents Hackathon for Good (DAIS 2026)
**Track:** Track 3 — Referral Copilot
**Date:** 2026-06-15

---

## 1. Problem & User

A referring physician needs to find facilities where they can send a patient — or volunteer their own skills. The dataset has 10,000 Indian healthcare facilities with rich but messy evidence fields. The doctor cannot trust a facility's claims without seeing the underlying evidence.

**Primary user:** A doctor looking for medical matching — either to refer a patient or to volunteer at an underserved facility.

**Core questions the app answers:**
- Where should this patient go for this care need?
- Does this facility actually have the capability it claims?
- Where can I volunteer given my specialties and interests?

---

## 2. Architecture

Three runtime layers:

### Frontend — React SPA
- Role-based entry: doctor view and hospital view
- Doctor sign-up includes the practice context textarea and voice transcription control
- Hospital sign-up collects hospital name, street address, phone number, and optional Facebook page
- Doctor split-pane layout: chat panel (left) + Google Maps panel (right)
- Doctor tabs: **Search**, **Schedule**, **Shortlist**
- Hospital portal: facility-specific two-way scheduling queue with approve/deny decisions and doctor requests
- Communicates with backend via REST API
- Audio recording via browser `MediaRecorder` API

### Backend — FastAPI on Databricks Apps
- Handles all data access, LLM calls, and evidence scoring
- Runs as a Databricks App (Python process)
- Serves the built React bundle as static files

### Data Layer — Databricks SQL (Delta tables)
Three source tables (read-only):
- `databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities`
- `databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.india_post_pincode_directory`
- `databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.nfhs_5_district_health_indicators`

App-owned tables (read/write, planned under `workspace.shiftlink_app`):
- `workspace.shiftlink_app.users` — user_id, email, role, display_name, password_hash, created_at
- `workspace.shiftlink_app.doctor_profiles` — doctor_id, raw_text, extracted_tags (JSON), created_at
- `workspace.shiftlink_app.hospital_profiles` — hospital_id, hospital_name, hospital_street_address, hospital_phone, hospital_facebook_url, facility_sk, created_at
- `workspace.shiftlink_app.referral_shortlist` — doctor_id, facility_id, added_at
- `workspace.shiftlink_app.schedule_requests` — request_id, direction, requested_by, doctor_id, facility_id, visit_date, notes, status, reviewed_by, reviewed_at

**Identity:** The app has two user roles: `doctor` and `hospital`. Doctors use the referral workspace. Hospital users create a hospital profile during sign-up, review incoming doctor-to-hospital scheduling requests for their hospital profile, and can send hospital-to-doctor requests from the user table. The current frontend prototype stores local accounts and request state in `localStorage`; the backend version should replace that with a real user database, password hashing, session management, and role authorization.

---

## 3. Onboarding Flow

Shown during doctor sign-up, with the same screen available as a fallback when a local doctor account has no stored profile. Doctor describes their specialties, experience, and interests.

**Input options:**
1. **Text** — free-form textarea, no length limit
2. **Voice** — mic button triggers browser `MediaRecorder` → audio blob POSTed to `POST /transcribe` → OpenAI Whisper API returns transcript → populates textarea for review/edit

After submission, `POST /onboard` calls an LLM to extract structured tags:
```json
{
  "specialties": ["cardiology", "critical_care"],
  "regions_of_interest": ["Rajasthan", "rural"],
  "experience_years": 10,
  "raw_text": "I'm a cardiologist with 10 years of ICU experience..."
}
```

The raw text and tags are stored in `workspace.shiftlink_app.doctor_profiles` once backend persistence is implemented. The current prototype stores this profile locally and injects it as context into subsequent LLM calls.

---

## 4. Search Flow

### 4.1 Query Parsing
Doctor types (or will type) a natural language query into the chat box, e.g.:
> "Need to refer a patient for emergency cardiac surgery near Ahmedabad"

Backend calls LLM with doctor profile as context:
```json
{
  "care_need": "cardiac surgery",
  "location": "Ahmedabad",
  "intent": "patient_referral"  // or "volunteering"
}
```

LLM also generates a synonym set for the care need:
```json
["cardiac surgery", "cardiology", "heart surgery", "CABG", "bypass", "cardiovascular"]
```

### 4.2 Geocoding
Location resolved via `india_post_pincode_directory`:
- If location is a 6-digit pincode: direct lookup
- If location is a city/district name: match on `officename`, `district`, or `statename` → average lat/lng of matching rows

### 4.3 Facility Query
SQL filters facilities within radius using haversine distance. Coordinate fallback chain per facility:
1. Use `latitude`/`longitude` if within India bounds (lat 8–37, lng 68–97)
2. Else join on `address_zipOrPostcode` → pincode directory lat/lng
3. Else match `address_city` + `address_stateOrRegion` → pincode directory average

### 4.4 Evidence Scoring
Python-side scoring against the synonym set. All array fields (`capability`, `procedure`, `equipment`, `specialties`) are parsed from JSON strings before matching.

| Field | Points | Notes |
|---|---|---|
| `capability` | +2 | Primary claims field |
| `procedure` | +1 | Specific procedures |
| `equipment` | +1 | Physical equipment |
| `specialties` | +1 | Coded specialty match |
| `description` | +0.5 | Often vague |

**Trust tiers:**
- **Strong** (4+): green pin / green badge
- **Partial** (2–3): yellow pin / yellow badge
- **Weak** (1): red pin / red badge + warning flag
- **None** (0): excluded from results

**Weak evidence flags** (shown explicitly in evidence panel):
- Claim appears only in `description` (not corroborated by capability/procedure/equipment)
- Corrupted coordinates — location is approximate (pincode fallback used)
- `numberDoctors` ≤ 2 for a claimed hospital-level service
- Single social media source only

### 4.5 NFHS Enrichment
District resolution: facility `address_zipOrPostcode` → pincode directory `district` field → NFHS `district_name`. Direct city-to-district name matching is unreliable; always route through the pincode directory. A district context badge is shown on the map and in result cards:
> "Ahmedabad district: 35% hypertension rate, 12 facilities claim cardiology"

---

## 5. UI Layout

### Search Tab
```
┌──────────────────────────────────────────────────────────────────┐
│  🏥 Referral Copilot         [Search] [Schedule] [Shortlist (3)] │
├──────────────────────────┬───────────────────────────────────────┤
│  CHAT PANEL              │  GOOGLE MAPS                          │
│                          │                                       │
│  Result cards (ranked):  │  Color-coded pins (🟢 🟡 🔴)          │
│  🟢 Shaurya Hosp. 4.2km  │                                       │
│  🟡 City Clinic   7.1km  │  Pin click → info window:             │
│  🔴 Metro Med ⚠  9.8km  │  ┌────────────────────┐               │
│                          │  │ Shaurya Hospital   │               │
│  NFHS district badge     │  │ 📍 4.2km · 🟢 Strong│               │
│                          │  │ 📞 +91 982 514 7300 │               │
│  [Chat input]  [Send]    │  │ ✉ cashless@...      │               │
│                          │  │ [View Evidence]     │               │
│                          │  │ [+ Shortlist]       │               │
│                          │  │ [Generate Email ✉]  │               │
│                          │  └────────────────────┘               │
└──────────────────────────┴───────────────────────────────────────┘
```

**Evidence drawer** (slides in over map on "View Evidence"):
- Facility name, type, address, contact info
- Trust tier badge
- Per-field evidence: exact matching text from capability, procedure, equipment, specialties, description — each shown as a cited snippet
- Weak evidence flags called out explicitly with warning text
- NFHS district health indicators

### Schedule Tab
List of facilities with planned visit dates. Add from shortlist or from the schedule builder. Each entry shows facility name, requested date, time, purpose, and request status when tied to a scheduling request. Hospital-originated requests appear above the builder with accept/decline actions; accepted requests are inserted into the doctor's schedule.

### Shortlist Tab
Saved facilities. Each shows distance, trust tier, contact info, and a "Generate Email" button.

---

## 6. Email Generation

If a facility has an email address in the `email` field, a "Generate Email" button appears.

`POST /generate-email` sends doctor profile + facility details to LLM → returns a draft:
- Subject line
- Personalized body (references doctor's specialties and the facility's relevant capabilities)
- Professional tone

Response shown in a modal with **Copy**, **Edit**, and **Open in Mail** (`mailto:`) actions. Email is never sent automatically — doctor reviews and sends manually.

---

## 7. API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/signup` | Create a doctor or hospital user, including doctor context or hospital profile fields when applicable |
| `POST` | `/auth/login` | Authenticate user and create session |
| `POST` | `/auth/logout` | End session |
| `POST` | `/transcribe` | Audio blob → OpenAI Whisper → transcript string |
| `POST` | `/onboard` | Save doctor profile, extract tags via LLM |
| `GET` | `/profile` | Return stored doctor profile |
| `POST` | `/search` | Main search: parse query, geocode, fetch+score facilities, NFHS join |
| `GET` | `/facility/{id}` | Full evidence detail for one facility |
| `POST` | `/shortlist` | Save facility to shortlist |
| `GET` | `/shortlist` | Return doctor's shortlisted facilities |
| `DELETE` | `/shortlist/{id}` | Remove from shortlist |
| `POST` | `/schedule` | Save a visit entry |
| `GET` | `/schedule` | Return doctor's schedule |
| `DELETE` | `/schedule/{id}` | Remove a schedule entry |
| `GET` | `/hospital/requests` | Return scheduling requests for the logged-in hospital's facility |
| `PATCH` | `/hospital/requests/{id}` | Approve or deny a scheduling request |
| `GET` | `/hospital/doctors` | Return doctors available for hospital-originated requests |
| `POST` | `/hospital/doctor-requests` | Create a hospital-to-doctor scheduling request |
| `GET` | `/doctor/requests` | Return scheduling requests for the logged-in doctor |
| `PATCH` | `/doctor/requests/{id}` | Accept or decline a hospital-originated request |
| `POST` | `/generate-email` | Draft intro email from profile + facility |

---

## 8. Key Data Quality Handling

- **`'null'` strings**: treated as `None` throughout — not empty strings
- **JSON array fields**: parsed with `json.loads()` before any matching or scoring
- **Duplicate specialty entries**: deduplicated before scoring (e.g. `internalMedicine` repeated 9× counts as 1)
- **Corrupted coordinates**: validated against India bounds; fallback to pincode directory
- **Missing fields**: evidence scoring gracefully handles `None` — missing field contributes 0 points and is noted in the evidence panel as "not reported"

---

## 9. External Dependencies

| Service | Usage | Notes |
|---|---|---|
| Databricks Foundation Models API | Query parsing, tag extraction, email generation | DBRX or Llama 3.3 70B instruct |
| OpenAI Whisper API | Speech-to-text on onboarding | `whisper-1` model |
| Google Maps JavaScript API | Map rendering, marker clustering | Requires billing-enabled key |
| Databricks SQL Warehouse | All data queries | Serverless Starter Warehouse (260da0aaab951fdb) |

---

## 10. Out of Scope (MVP)

- Multi-turn conversation (follow-up questions in chat)
- Patient-specific records or PHI
- Real-time facility availability
- Direct email sending (doctor sends manually from their own client)
- Mobile layout
