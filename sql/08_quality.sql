-- WS-8  ->  workspace.virtue_foundation_enriched.facilities_enrich_quality
-- Built by workflow facilities-enrichment-build (deterministic SQL, canonical grain, 9,989 rows).
-- 1 row per facility_sk, built FROM facilities_silver WHERE is_canonical.
--
-- Accreditation / academic-standing signals mined from a free-text blob
-- (name + description + capability_arr + specialties_clean), lower-cased.
-- Principle: "surface uncertainty, never fabricate" -- every flag must reflect an
-- EXPLICIT signal that the FACILITY ITSELF holds the credential / is the teaching
-- institution. Incidental staff-bio mentions ("MBBS from X Medical College",
-- "trained at Y Dental College", "DNB - Ophthalmology" as a doctor's degree,
-- "non-teaching staff", "resident of <city>") must NOT trigger a flag.
--
-- BUGFIX (is_teaching_hospital / is_medical_college_attached false positives):
--   The previous build matched on bare generic tokens ('teaching', 'institute',
--   'research', 'foundation', bare 'medical college'/'dental college' anywhere in
--   the blob, bare '\bdnb\b'). That flagged small clinics with NO teaching role --
--   e.g. 'Root Canal Point', 'HSR Neuro Clinic' ("neurologist trained at NIMHANS"),
--   'Mother And Child Care' ("university ... non-teaching staff"), 'WUS Health Centre'
--   ("DNB - Ophthalmology" doctor credential), 'Jaya Dental Clinic'/'Belle Vue Clinic'
--   ("BDS from <x> Dental College" staff bios).
--   FIX: require either (a) a name-anchored college/teaching token (the facility's
--   own name IS the college / teaching hospital), or (b) an explicit teaching/
--   residency/recognition phrase. DNB now only counts as a teaching signal when it
--   is a 'dnb program/training/seat/course' (a teaching seat), never the bare degree.
--
-- Coverage (canonical 9989): is_nabh_accredited=1316, is_nabl_accredited=501,
-- is_teaching_hospital=263 (was 213, now precise), is_medical_college_attached=236
-- (was 433; ~197 staff-bio false positives removed). Quality tiers:
-- high (signal_count>=2)=392, medium (=1)=1473, unknown (=0)=8124. Sums to 9989.

CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.facilities_enrich_quality AS
WITH base AS (
  SELECT
    facility_sk,
    -- name-only blob: a college/teaching token in the FACILITY NAME is a strong,
    -- self-referential signal that the facility IS the college / teaching hospital.
    lower(coalesce(name, '')) AS lname,
    -- full free-text blob across name + description + capability + specialties.
    lower(concat_ws(' | ',
      name,
      description,
      array_join(capability_arr, ' | '),
      array_join(specialties_clean, ' | ')
    )) AS blob
  FROM workspace.virtue_foundation_enriched.facilities_silver
  WHERE is_canonical
),
flags AS (
  SELECT
    facility_sk,
    -- ---- Accreditation flags (already precise; preserved EXACTLY) ----
    (blob RLIKE 'nabh') AS is_nabh_accredited,
    (blob RLIKE 'nabl') AS is_nabl_accredited,
    -- ---- is_teaching_hospital (TIGHTENED) ----
    -- (a) name-anchored: facility name itself is a medical/dental/nursing college
    --     or a "teaching hospital"; OR
    -- (b) explicit teaching/residency/recognition phrase anywhere in the blob.
    --     'dnb' only counts as a teaching SEAT ('dnb program/training/seat/course'),
    --     never the bare DNB physician degree. No generic
    --     institute/research/foundation/bare-'teaching' matches.
    (
      (lname RLIKE 'medical college|dental college|nursing college|teaching hospital')
      OR
      (blob RLIKE
        'teaching hospital'
        || '|residency program|residency training'
        || '|postgraduate (?:medical|training) (?:program|institute|college)'
        || '|mci recogni|nmc recogni|recognized by (?:mci|nmc|the national medical)'
        || '|dnb (?:program|training|seat|course)|accredited for dnb'
      )
    ) AS is_teaching_hospital,
    -- ---- is_medical_college_attached (TIGHTENED with same precision discipline) ----
    -- (a) the facility name itself is a "medical college"; OR
    -- (b) explicit attachment/affiliation phrasing tying the FACILITY to a medical
    --     college ("attached/affiliated to ... medical college",
    --     "<x> medical college and hospital", "part of ... medical college").
    --     NOT bare 'medical college' anywhere (that caught "MBBS from <x> medical
    --     college" staff bios).
    (
      (lname RLIKE 'medical college')
      OR
      (blob RLIKE
        'attached (?:to|with)[^|]{0,40}medical college'
        || '|affiliated (?:to|with)[^|]{0,40}medical college'
        || '|medical college (?:and|&) hospital'
        || '|teaching hospital of[^|]{0,40}medical college'
        || '|part of[^|]{0,40}medical college'
      )
    ) AS is_medical_college_attached
  FROM base
),
scored AS (
  SELECT
    *,
    (
      CAST(is_nabh_accredited AS int)
      + CAST(is_nabl_accredited AS int)
      + CAST(is_teaching_hospital AS int)
      + CAST(is_medical_college_attached AS int)
    ) AS accreditation_signal_count
  FROM flags
)
SELECT
  facility_sk,
  is_nabh_accredited,
  is_nabl_accredited,
  is_teaching_hospital,
  is_medical_college_attached,
  accreditation_signal_count,
  CASE
    WHEN accreditation_signal_count >= 2 THEN 'high'
    WHEN accreditation_signal_count = 1 THEN 'medium'
    ELSE 'unknown'
  END AS quality_tier
FROM scored;
