# User Database PRD

## Overview

Referral Copilot needs a persistent user database for the Databricks App. The current prototype stores users, sessions, and role-specific profile details in browser `localStorage`. This PRD defines the v1 Lakebase-backed user database that will replace browser-backed user/profile persistence for demo-ready doctor and hospital accounts.

The user database must use Databricks Lakebase Postgres as the transactional store for app users and role profiles. It must support one seeded doctor user and one seeded hospital user for the demo, while keeping the schema ready for normal sign-up and login flows.

## Goals

- Persist doctor and hospital users in Lakebase instead of `localStorage`.
- Persist doctor and hospital profile data in Lakebase.
- Support role-based login for `doctor` and `hospital` users.
- Seed one doctor test user and one hospital test user.
- Store passwords only as hashes.
- Preserve the current role-based app behavior from the frontend prototype.
- Keep existing Databricks facility tables unchanged.

## Non-Goals

- Do not store patient records or PHI.
- Do not implement production-grade identity provider integration in v1.
- Do not require the seeded hospital to match an existing Databricks facility record.
- Do not migrate scheduling requests, shortlists, outreach requests, or calendar data in this PRD.
- Do not modify `workspace.virtue_foundation_enriched.facilities_gold` or any source facility tables.

## Current Prototype State

The current app stores user and profile data locally in the browser:

- `referralCopilotUsers` stores local prototype user accounts.
- `referralCopilotSessionUserId` stores the active local session user ID.
- `referralCopilotDoctorProfile:{userId}` stores a doctor's profile context.
- Hospital profile fields are embedded in each local hospital user record.

This is acceptable for frontend prototyping, but not for a Databricks App with shared demo users. The Lakebase user database will become the source of truth for accounts and profile data.

## V1 User Scope

V1 must support two user roles:

- `doctor`
- `hospital`

V1 must persist:

- Account identity.
- Email login.
- Password hash.
- User role.
- Display name.
- Active/inactive status.
- Doctor profile context.
- Hospital profile details.

V1 must not persist scheduling requests, doctor shortlists, outreach requests, appointment records, or patient information.

## Seed Users

The initial Lakebase seed must create exactly two active users.

### Doctor Seed User

- Display name: `Dr. Anika Rao`
- Email: `doctor@example.com`
- Role: `doctor`
- Password: `ChangeMe123!`
- Password storage: hashed only
- Doctor profile raw text:

```text
I am a cardiologist with 10 years of ICU experience. I can support emergency cardiac referrals, hypertension care, and volunteer cardiac screening camps in Gujarat and Rajasthan.
```

Expected extracted tags may include:

- `cardiology`
- `ICU`
- `emergency cardiac referrals`
- `hypertension care`
- `volunteer cardiac screening camps`
- `Gujarat`
- `Rajasthan`

### Hospital Seed User

- Display name: `Shaurya Heart & Critical Care`
- Email: `hospital@example.com`
- Role: `hospital`
- Password: `ChangeMe123!`
- Password storage: hashed only
- Hospital name: `Shaurya Heart & Critical Care`
- Street address: `15 Civil Hospital Road, Ahmedabad, Gujarat`
- Phone: `+91 98251 47300`
- Facebook URL: blank
- Profile source: `self_reported`
- Facility link: none required for v1

## Lakebase Data Model

The Lakebase database must contain three v1 tables:

- `users`
- `doctor_profiles`
- `hospital_profiles`

### `users`

Stores shared account identity for all app users.

| Column | Type | Requirement |
|---|---|---|
| `id` | UUID | Primary key |
| `email` | Text | Required, unique, normalized lowercase |
| `password_hash` | Text | Required; plaintext passwords must never be stored |
| `role` | Text | Required; must be `doctor` or `hospital` |
| `display_name` | Text | Required |
| `is_active` | Boolean | Required; default `true` |
| `created_at` | Timestamp with time zone | Required |
| `updated_at` | Timestamp with time zone | Required |
| `last_login_at` | Timestamp with time zone | Nullable |

Constraints:

- `email` must be unique.
- `role` must be constrained to `doctor` or `hospital`.
- `email` must be stored lowercase and trimmed.
- `password_hash` must not equal the plaintext seed password.

### `doctor_profiles`

Stores doctor-specific profile context.

| Column | Type | Requirement |
|---|---|---|
| `user_id` | UUID | Primary key; foreign key to `users.id` |
| `raw_text` | Text | Required |
| `extracted_tags` | JSONB | Required; empty object allowed |
| `specialties` | JSONB | Required; empty array allowed |
| `regions_of_interest` | JSONB | Required; empty array allowed |
| `created_at` | Timestamp with time zone | Required |
| `updated_at` | Timestamp with time zone | Required |

Rules:

- A doctor user should have one doctor profile row.
- A non-doctor user must not have a doctor profile row.
- `raw_text` is the source of truth for the doctor's free-form practice context.

### `hospital_profiles`

Stores hospital-specific profile context.

| Column | Type | Requirement |
|---|---|---|
| `user_id` | UUID | Primary key; foreign key to `users.id` |
| `hospital_name` | Text | Required |
| `street_address` | Text | Required |
| `phone` | Text | Required |
| `facebook_url` | Text | Nullable |
| `facility_sk` | Text | Nullable |
| `profile_source` | Text | Required; default `self_reported` |
| `created_at` | Timestamp with time zone | Required |
| `updated_at` | Timestamp with time zone | Required |

Rules:

- A hospital user should have one hospital profile row.
- A non-hospital user must not have a hospital profile row.
- `facility_sk` must be nullable in v1.
- The seeded hospital must work without a `facility_sk`.
- `profile_source` for the seeded hospital must be `self_reported`.

## Fit With Existing Databricks Data

The app's existing Databricks facility layer is `workspace.virtue_foundation_enriched.facilities_gold`, keyed by `facility_sk`.

For v1, the user database must not require hospital users to match this facility table. The seeded hospital is self-reported and must have `facility_sk = NULL`.

Future work may link hospital users to `workspace.virtue_foundation_enriched.facilities_gold.facility_sk`, but that matching workflow is outside v1.

## App Integration Requirements

The app must move the following browser-backed persistence to backend API calls backed by Lakebase:

- `referralCopilotUsers`
- `referralCopilotDoctorProfile:{userId}`
- Hospital profile fields embedded in local user records

The app may temporarily keep a frontend session token or active session marker in browser storage, but account and profile data must come from Lakebase.

Required app behavior:

- Doctor login returns a doctor user and doctor profile.
- Hospital login returns a hospital user and hospital profile.
- Doctor signup requires profile context.
- Hospital signup requires hospital name, street address, and phone.
- Duplicate email signup is rejected.
- Hospital dashboard reads hospital identity from Lakebase.
- Doctor/hospital request flows may use Lakebase user IDs as stable foreign keys.

Scheduling request persistence is outside this PRD unless explicitly added later.

## API Expectations

The exact backend framework is outside this PRD, but the user database must support these app operations:

- Create user account.
- Login by email and password.
- Fetch current user.
- Fetch doctor profile for a doctor user.
- Fetch hospital profile for a hospital user.
- Create or update doctor profile.
- Create or update hospital profile.
- Reject duplicate emails.
- Update `last_login_at` after successful login.

Responses must not include `password_hash`.

## Security Requirements

- Store only password hashes, never plaintext passwords.
- Do not log plaintext passwords.
- Normalize emails before lookup and storage.
- Return only the current user's role-appropriate profile.
- Do not expose doctor profile data to hospital users through the user database API.
- Do not expose hospital profile data to doctor users except where an application workflow explicitly requires public hospital identity.
- Keep patient data and PHI out of the user database.

## Acceptance Criteria

- Fresh Lakebase seed contains exactly two active users: one doctor and one hospital.
- `doctor@example.com` with `ChangeMe123!` logs in as a `doctor`.
- `hospital@example.com` with `ChangeMe123!` logs in as a `hospital`.
- Doctor profile loads from Lakebase and matches the seeded sample context.
- Hospital profile loads from Lakebase and renders in the hospital portal.
- Duplicate email signup is rejected.
- Plaintext passwords are never stored in Lakebase.
- The seeded hospital works with `facility_sk = NULL`.
- Existing Databricks facility tables remain untouched.

## Open Questions

- Which backend route names will be used for auth and profile APIs?
- Which password hashing library will the backend use?
- Will production auth later move to Databricks identity, an external identity provider, or app-managed accounts?
- Should Lakebase user tables later be registered in Unity Catalog for analytics and audit reporting?
