# Shiftlink User Database Plan

Status: planned Lakebase persistence. The current live app still uses browser `localStorage` for prototype accounts, sessions, doctor profiles, hospital profiles, and scheduling requests.

## Naming Contract

Shiftlink uses two separate data namespaces:

| Purpose | Namespace | Current status |
|---|---|---|
| Facility analytics and runtime facility cards | `workspace.virtue_foundation_enriched` | Live |
| App-owned user/profile/scheduling persistence | `workspace.shiftlink_app` in Databricks docs and metadata; `shiftlink_app` inside Lakebase Postgres SQL | Planned |

The live facility serving table remains:

```text
workspace.virtue_foundation_enriched.gold_facilities
```

Reserved app-owned table names are:

```text
workspace.shiftlink_app.users
workspace.shiftlink_app.doctor_profiles
workspace.shiftlink_app.hospital_profiles
workspace.shiftlink_app.referral_shortlist
workspace.shiftlink_app.schedule_requests
workspace.shiftlink_app.chat_events
workspace.shiftlink_app.map_searches
```

The Lakebase Postgres schema file creates the v1 user/profile subset as `shiftlink_app.users`, `shiftlink_app.doctor_profiles`, and `shiftlink_app.hospital_profiles`.

## V1 Scope

The first Lakebase-backed user database should persist:

- doctor and hospital accounts
- normalized email login identity
- password hashes only
- user role: `doctor` or `hospital`
- active/inactive status
- doctor profile context
- hospital profile details

V1 does not persist patient data, PHI, scheduling requests, shortlists, chat history, or map searches.

## Seed Users

The seed SQL creates exactly two active demo users:

| Role | Email | Display name |
|---|---|---|
| Doctor | `doctor@example.com` | `Dr. Anika Rao` |
| Hospital | `hospital@example.com` | `Shaurya Heart & Critical Care` |

The seed password is `ChangeMe123!`, stored only as a hash with Postgres `crypt(...)`.

## Table Summary

### `shiftlink_app.users`

Shared account identity for all app users.

Key fields:

- `id`
- `email`
- `password_hash`
- `role`
- `display_name`
- `is_active`
- `created_at`
- `updated_at`
- `last_login_at`

### `shiftlink_app.doctor_profiles`

Doctor-specific profile context keyed by `user_id`.

Key fields:

- `user_id`
- `raw_text`
- `extracted_tags`
- `specialties`
- `regions_of_interest`
- `created_at`
- `updated_at`

### `shiftlink_app.hospital_profiles`

Hospital-specific profile context keyed by `user_id`.

Key fields:

- `user_id`
- `hospital_name`
- `street_address`
- `phone`
- `facebook_url`
- `facility_sk`
- `profile_source`
- `created_at`
- `updated_at`

`facility_sk` is nullable in v1. Hospital users do not have to match `workspace.virtue_foundation_enriched.gold_facilities` during initial account creation.

## Integration Notes

The app should keep the current UI behavior while replacing these browser-backed stores with backend API calls:

- `referralCopilotUsers`
- `referralCopilotSessionUserId`
- `referralCopilotDoctorProfile:{userId}`
- hospital profile fields embedded in local user records

Scheduling persistence should use the reserved table name `workspace.shiftlink_app.schedule_requests` when that backend work is implemented. Shortlist persistence should use `workspace.shiftlink_app.referral_shortlist`.

## Source Artifact

Schema and seed SQL:

```text
sql/20_shiftlink_app_user_database.sql
```
