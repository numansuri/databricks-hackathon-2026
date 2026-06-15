-- WS-6  ->  workspace.virtue_foundation_enriched.facilities_enrich_capability
-- Built by workflow facilities-enrichment-build (deterministic SQL, canonical grain, 9,989 rows).
-- Coverage: Validation: COUNT(*)=9989 and COUNT(DISTINCT facility_sk)=9989 (both equal canonical count). Exactly one row per facility_sk.

Multispecialty (specialty_count>=3): 9087 facilities (91.0%). Avg specialty_count=11.84, max=50.

Complexity tiers: tertiary=6024, secondary=3066, primar

CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.facilities_enrich_capability AS
WITH base AS (
  SELECT
    facility_sk,
    specialties_clean,
    lower(array_join(specialties_clean, ' | ')) AS sblob,
    lower(concat_ws(' | ', array_join(equipment_arr, ' | '), description, array_join(capability_arr, ' | '))) AS eblob
  FROM workspace.virtue_foundation_enriched.facilities_silver
  WHERE is_canonical
),
flags AS (
  SELECT
    facility_sk,
    CAST(size(specialties_clean) AS int) AS specialty_count,
    (sblob RLIKE 'cardio') AS has_cardiology,
    (sblob RLIKE 'obstet|gyneco|maternity|reproductive') AS has_maternity,
    (sblob RLIKE 'oncolog|cancer') AS has_oncology,
    (sblob RLIKE 'nephrolog|dialysis') AS has_dialysis,
    (sblob RLIKE 'paediatr|pediatr') AS has_pediatrics,
    (sblob RLIKE 'emergenc|critical care|trauma') AS has_emergency,
    (sblob RLIKE 'orthoped|orthopaed') AS has_orthopedics,
    (sblob RLIKE 'neurolog|neurosurg') AS has_neurology,
    (eblob RLIKE '\\bct scan|ct scanner|cect|\\bct\\b') AS has_ct,
    (eblob RLIKE '\\bmri\\b|magnetic resonance') AS has_mri,
    (eblob RLIKE 'x-?ray') AS has_xray,
    (eblob RLIKE 'ultrasound|sonograph|doppler') AS has_ultrasound,
    (eblob RLIKE '\\bicu\\b|intensive care|\\bnicu\\b|\\bccu\\b') AS has_icu,
    (eblob RLIKE 'operation theat|operating theat|\\bot complex') AS has_ot,
    (eblob RLIKE 'blood bank') AS has_blood_bank,
    (eblob RLIKE 'ventilator') AS has_ventilator
  FROM base
),
scored AS (
  SELECT
    *,
    (specialty_count >= 3) AS is_multispecialty,
    (CAST(has_ct AS int) + CAST(has_mri AS int) + CAST(has_xray AS int) + CAST(has_ultrasound AS int)
     + CAST(has_icu AS int) + CAST(has_ot AS int) + CAST(has_blood_bank AS int) + CAST(has_ventilator AS int)) AS equipment_richness_score
  FROM flags
)
SELECT
  facility_sk,
  specialty_count,
  is_multispecialty,
  CASE
    WHEN specialty_count >= 8 OR equipment_richness_score >= 5 THEN 'tertiary'
    WHEN specialty_count >= 3 THEN 'secondary'
    ELSE 'primary'
  END AS facility_complexity_tier,
  has_cardiology, has_maternity, has_oncology, has_dialysis,
  has_pediatrics, has_emergency, has_orthopedics, has_neurology,
  has_ct, has_mri, has_xray, has_ultrasound,
  has_icu, has_ot, has_blood_bank, has_ventilator,
  equipment_richness_score
FROM scored;
