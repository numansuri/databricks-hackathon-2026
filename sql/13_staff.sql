-- 13_staff.sql
-- BUILD: CLINICAL STAFF ("who is available")
-- Tables:
--   workspace.virtue_foundation_enriched.facilities_enrich_staff (1 row / canonical facility_sk)
--   workspace.virtue_foundation_enriched.facilities_doctors (bridge: facility_sk, doctor_name)
-- Source: facilities_silver WHERE is_canonical
-- Principle: surface uncertainty, never fabricate. Signals are mined from scraped
-- free-text (capability + procedure + description) and are INFERRED, not authoritative.
-- staff_evidence_source companion documents provenance.

-- ============================================================================
-- ENRICH TABLE: per-facility staff-presence signals
-- ============================================================================
CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.facilities_enrich_staff AS
WITH base AS (
  SELECT
    facility_sk,
    -- case-sensitive blob preserves "Dr. Firstname Lastname" capitalization for name mining
    concat_ws(' || ',
      array_join(capability_arr, ' || '),
      array_join(procedure_arr, ' || '),
      coalesce(description, '')
    ) AS blob_cs
  FROM workspace.virtue_foundation_enriched.facilities_silver
  WHERE is_canonical
),
prepped AS (
  SELECT
    facility_sk,
    blob_cs,
    lower(blob_cs) AS blob
  FROM base
),
flags AS (
  SELECT
    facility_sk,
    -- named doctor mining (case-sensitive)
    size(array_distinct(regexp_extract_all(blob_cs, '(Dr\\.?\\s+[A-Z][a-zA-Z.]+(?:\\s+[A-Z][a-zA-Z.]+){0,2})', 1))) AS named_doctor_count,
    -- department leadership language
    (blob RLIKE 'led by|headed by|head of department|\\bhod\\b') AS has_department_lead,
    -- per-domain specialist TITLE presence (direct evidence of a doctor for that domain)
    (blob RLIKE 'cardiologist') AS has_cardiologist,
    (blob RLIKE 'oncologist') AS has_oncologist,
    (blob RLIKE 'neurologist|neurosurgeon|neuro surgeon') AS has_neurologist,
    (blob RLIKE 'nephrologist') AS has_nephrologist,
    (blob RLIKE 'paediatrician|pediatrician|neonatologist') AS has_pediatrician,
    (blob RLIKE 'gynaecologist|gynecologist|obstetrician') AS has_obgyn,
    (blob RLIKE 'orthopaedician|orthopedician|orthopaedic surgeon|orthopedic surgeon') AS has_orthopedic_surgeon,
    (blob RLIKE 'urologist') AS has_urologist,
    (blob RLIKE 'dermatologist') AS has_dermatologist,
    (blob RLIKE 'ophthalmologist|eye surgeon') AS has_ophthalmologist,
    (blob RLIKE 'psychiatrist') AS has_psychiatrist,
    (blob RLIKE 'pulmonologist|chest physician') AS has_pulmonologist,
    (blob RLIKE 'gastroenterologist') AS has_gastroenterologist,
    (blob RLIKE 'radiologist') AS has_radiologist,
    (blob RLIKE 'pathologist') AS has_pathologist,
    (blob RLIKE 'anaesthesiologist|anesthesiologist|anaesthetist') AS has_anesthesiologist,
    (blob RLIKE 'general surgeon') AS has_general_surgeon,
    (blob RLIKE 'general physician|\\bphysician\\b') AS has_physician
  FROM prepped
)
SELECT
  facility_sk,
  named_doctor_count,
  (named_doctor_count > 0) AS has_named_doctors,
  has_department_lead,
  has_cardiologist,
  has_oncologist,
  has_neurologist,
  has_nephrologist,
  has_pediatrician,
  has_obgyn,
  has_orthopedic_surgeon,
  has_urologist,
  has_dermatologist,
  has_ophthalmologist,
  has_psychiatrist,
  has_pulmonologist,
  has_gastroenterologist,
  has_radiologist,
  has_pathologist,
  has_anesthesiologist,
  has_general_surgeon,
  has_physician,
  (cast(has_cardiologist AS int) + cast(has_oncologist AS int) + cast(has_neurologist AS int)
   + cast(has_nephrologist AS int) + cast(has_pediatrician AS int) + cast(has_obgyn AS int)
   + cast(has_orthopedic_surgeon AS int) + cast(has_urologist AS int) + cast(has_dermatologist AS int)
   + cast(has_ophthalmologist AS int) + cast(has_psychiatrist AS int) + cast(has_pulmonologist AS int)
   + cast(has_gastroenterologist AS int) + cast(has_radiologist AS int) + cast(has_pathologist AS int)
   + cast(has_anesthesiologist AS int) + cast(has_general_surgeon AS int) + cast(has_physician AS int)
  ) AS specialist_domain_count,
  (
    (cast(has_cardiologist AS int) + cast(has_oncologist AS int) + cast(has_neurologist AS int)
     + cast(has_nephrologist AS int) + cast(has_pediatrician AS int) + cast(has_obgyn AS int)
     + cast(has_orthopedic_surgeon AS int) + cast(has_urologist AS int) + cast(has_dermatologist AS int)
     + cast(has_ophthalmologist AS int) + cast(has_psychiatrist AS int) + cast(has_pulmonologist AS int)
     + cast(has_gastroenterologist AS int) + cast(has_radiologist AS int) + cast(has_pathologist AS int)
     + cast(has_anesthesiologist AS int) + cast(has_general_surgeon AS int) + cast(has_physician AS int)
    ) > 0
  ) AS has_specialist_evidence,
  'capability_procedure_description_text' AS staff_evidence_source
FROM flags;

-- ============================================================================
-- BRIDGE TABLE: distinct named doctors per facility
-- ============================================================================
CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.facilities_doctors AS
WITH base AS (
  SELECT
    facility_sk,
    concat_ws(' || ',
      array_join(capability_arr, ' || '),
      array_join(procedure_arr, ' || '),
      coalesce(description, '')
    ) AS blob_cs
  FROM workspace.virtue_foundation_enriched.facilities_silver
  WHERE is_canonical
)
SELECT
  facility_sk,
  doctor_name
FROM base
LATERAL VIEW explode(
  array_distinct(regexp_extract_all(blob_cs, '(Dr\\.?\\s+[A-Z][a-zA-Z.]+(?:\\s+[A-Z][a-zA-Z.]+){0,2})', 1))
) t AS doctor_name
WHERE doctor_name IS NOT NULL AND doctor_name <> '';
