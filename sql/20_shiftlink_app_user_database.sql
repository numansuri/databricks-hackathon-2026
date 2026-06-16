-- Shiftlink app user database for Databricks Lakebase Postgres.
--
-- Scope: app accounts plus role-specific doctor/hospital profiles.
-- Current runtime note: this schema is a future persistence target. The live
-- app still stores users, sessions, profiles, and scheduling state in browser
-- localStorage until backend auth/profile routes are implemented.
--
-- Naming contract:
--   - Facility analytics stay in Unity Catalog:
--       workspace.virtue_foundation_enriched.gold_facilities
--   - App-owned persistence uses the Shiftlink namespace:
--       workspace.shiftlink_app.* in Databricks docs/metadata
--       shiftlink_app.* inside Lakebase Postgres SQL
--
-- Reserved future app-persistence names:
--   shiftlink_app.schedule_requests
--   shiftlink_app.referral_shortlist
--   shiftlink_app.chat_events
--   shiftlink_app.map_searches
--
-- Non-scope for this file: patient records, PHI, facility gold-table changes,
-- scheduling request persistence, and production identity-provider integration.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS shiftlink_app;

CREATE TABLE IF NOT EXISTS shiftlink_app.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  display_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  CONSTRAINT users_email_normalized CHECK (email = lower(btrim(email))),
  CONSTRAINT users_email_unique UNIQUE (email),
  CONSTRAINT users_role_valid CHECK (role IN ('doctor', 'hospital')),
  CONSTRAINT users_password_not_plaintext CHECK (password_hash <> 'ChangeMe123!')
);

CREATE TABLE IF NOT EXISTS shiftlink_app.doctor_profiles (
  user_id UUID PRIMARY KEY REFERENCES shiftlink_app.users(id) ON DELETE CASCADE,
  raw_text TEXT NOT NULL,
  extracted_tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  specialties JSONB NOT NULL DEFAULT '[]'::jsonb,
  regions_of_interest JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shiftlink_app.hospital_profiles (
  user_id UUID PRIMARY KEY REFERENCES shiftlink_app.users(id) ON DELETE CASCADE,
  hospital_name TEXT NOT NULL,
  street_address TEXT NOT NULL,
  phone TEXT NOT NULL,
  facebook_url TEXT,
  facility_sk TEXT,
  profile_source TEXT NOT NULL DEFAULT 'self_reported',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hospital_profiles_profile_source_valid CHECK (profile_source IN ('self_reported', 'gold_facilities_linked'))
);

CREATE OR REPLACE FUNCTION shiftlink_app.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION shiftlink_app.assert_profile_role()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  actual_role TEXT;
BEGIN
  SELECT role INTO actual_role
  FROM shiftlink_app.users
  WHERE id = NEW.user_id;

  IF actual_role IS NULL THEN
    RAISE EXCEPTION 'User % does not exist', NEW.user_id;
  END IF;

  IF actual_role <> TG_ARGV[0] THEN
    RAISE EXCEPTION 'User % has role %, expected %', NEW.user_id, actual_role, TG_ARGV[0];
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_set_updated_at ON shiftlink_app.users;
CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON shiftlink_app.users
FOR EACH ROW
EXECUTE FUNCTION shiftlink_app.set_updated_at();

DROP TRIGGER IF EXISTS doctor_profiles_set_updated_at ON shiftlink_app.doctor_profiles;
CREATE TRIGGER doctor_profiles_set_updated_at
BEFORE UPDATE ON shiftlink_app.doctor_profiles
FOR EACH ROW
EXECUTE FUNCTION shiftlink_app.set_updated_at();

DROP TRIGGER IF EXISTS hospital_profiles_set_updated_at ON shiftlink_app.hospital_profiles;
CREATE TRIGGER hospital_profiles_set_updated_at
BEFORE UPDATE ON shiftlink_app.hospital_profiles
FOR EACH ROW
EXECUTE FUNCTION shiftlink_app.set_updated_at();

DROP TRIGGER IF EXISTS doctor_profiles_assert_role ON shiftlink_app.doctor_profiles;
CREATE TRIGGER doctor_profiles_assert_role
BEFORE INSERT OR UPDATE ON shiftlink_app.doctor_profiles
FOR EACH ROW
EXECUTE FUNCTION shiftlink_app.assert_profile_role('doctor');

DROP TRIGGER IF EXISTS hospital_profiles_assert_role ON shiftlink_app.hospital_profiles;
CREATE TRIGGER hospital_profiles_assert_role
BEFORE INSERT OR UPDATE ON shiftlink_app.hospital_profiles
FOR EACH ROW
EXECUTE FUNCTION shiftlink_app.assert_profile_role('hospital');

INSERT INTO shiftlink_app.users (id, email, password_hash, role, display_name, is_active)
VALUES
  (
    '00000000-0000-4000-8000-000000000001',
    'doctor@example.com',
    crypt('ChangeMe123!', gen_salt('bf')),
    'doctor',
    'Dr. Anika Rao',
    TRUE
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    'hospital@example.com',
    crypt('ChangeMe123!', gen_salt('bf')),
    'hospital',
    'Shaurya Heart & Critical Care',
    TRUE
  )
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  role = EXCLUDED.role,
  display_name = EXCLUDED.display_name,
  is_active = EXCLUDED.is_active,
  updated_at = now();

INSERT INTO shiftlink_app.doctor_profiles (
  user_id,
  raw_text,
  extracted_tags,
  specialties,
  regions_of_interest
)
SELECT
  id,
  'I am a cardiologist with 10 years of ICU experience. I can support emergency cardiac referrals, hypertension care, and volunteer cardiac screening camps in Gujarat and Rajasthan.',
  jsonb_build_object(
    'specialties', jsonb_build_array('cardiology', 'ICU', 'emergency cardiac referrals', 'hypertension care'),
    'regions_of_interest', jsonb_build_array('Gujarat', 'Rajasthan'),
    'interests', jsonb_build_array('volunteer cardiac screening camps')
  ),
  jsonb_build_array('cardiology', 'ICU', 'emergency cardiac referrals', 'hypertension care'),
  jsonb_build_array('Gujarat', 'Rajasthan')
FROM shiftlink_app.users
WHERE email = 'doctor@example.com'
ON CONFLICT (user_id) DO UPDATE SET
  raw_text = EXCLUDED.raw_text,
  extracted_tags = EXCLUDED.extracted_tags,
  specialties = EXCLUDED.specialties,
  regions_of_interest = EXCLUDED.regions_of_interest,
  updated_at = now();

INSERT INTO shiftlink_app.hospital_profiles (
  user_id,
  hospital_name,
  street_address,
  phone,
  facebook_url,
  facility_sk,
  profile_source
)
SELECT
  id,
  'Shaurya Heart & Critical Care',
  '15 Civil Hospital Road, Ahmedabad, Gujarat',
  '+91 98251 47300',
  NULL,
  NULL,
  'self_reported'
FROM shiftlink_app.users
WHERE email = 'hospital@example.com'
ON CONFLICT (user_id) DO UPDATE SET
  hospital_name = EXCLUDED.hospital_name,
  street_address = EXCLUDED.street_address,
  phone = EXCLUDED.phone,
  facebook_url = EXCLUDED.facebook_url,
  facility_sk = EXCLUDED.facility_sk,
  profile_source = EXCLUDED.profile_source,
  updated_at = now();

COMMIT;

-- Smoke checks for a fresh Lakebase database:
-- SELECT role, count(*) FROM shiftlink_app.users WHERE is_active GROUP BY role ORDER BY role;
-- SELECT email, password_hash <> 'ChangeMe123!' AS password_is_hashed FROM shiftlink_app.users ORDER BY email;
-- SELECT u.email, p.raw_text FROM shiftlink_app.users u JOIN shiftlink_app.doctor_profiles p ON p.user_id = u.id;
-- SELECT u.email, p.hospital_name, p.facility_sk FROM shiftlink_app.users u JOIN shiftlink_app.hospital_profiles p ON p.user_id = u.id;
