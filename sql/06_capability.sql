-- WS-6  ->  workspace.virtue_foundation_enriched.facilities_enrich_capability
-- Built by workflow facilities-enrichment-build (deterministic SQL, canonical grain, 9,989 rows).
-- Coverage: Validation: COUNT(*)=9989 and COUNT(DISTINCT facility_sk)=9989 (both equal canonical count). Exactly one row per facility_sk.
--
-- Clinical CATEGORICAL enrichment: specialty flags (sblob = lowercased pipe-joined specialties)
-- and equipment flags (eblob = equipment + description + capability).
-- NOTE: free-text clinical signals (transplant/robotic/chemo/radiotherapy/JCI/trauma/telemedicine/
-- ambulance + operating_theatre_count/doctor_count_text) were REMOVED from this table because they
-- exactly duplicated the canonical facilities_enrich_clinical_facts table (the single home for
-- free-text clinical signals mined from capability+procedure+description).
--
-- Multispecialty (specialty_count>=3): ~9087 facilities (91.0%). Avg specialty_count=11.84, max=50.
-- Complexity tiers: tertiary~6024, secondary~3066, primary remainder.

CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.facilities_enrich_capability AS
WITH base AS (
  SELECT
    facility_sk,
    specialties_clean,
    equipment_arr,
    lower(array_join(specialties_clean, ' | ')) AS sblob,
    lower(concat_ws(' | ', array_join(equipment_arr, ' | '), description, array_join(capability_arr, ' | '))) AS eblob
    -- NOTE: cblob (description + capability + procedure) was removed along with the free-text
    -- clinical flags. Those signals live in the canonical facilities_enrich_clinical_facts table.
  FROM workspace.virtue_foundation_enriched.facilities_silver
  WHERE is_canonical
),
flags AS (
  SELECT
    facility_sk,
    specialties_clean,
    equipment_arr,
    CAST(size(specialties_clean) AS int) AS specialty_count,
    -- ---- existing specialty flags (EXACT logic + names preserved) ----
    (sblob RLIKE 'cardio') AS has_cardiology,
    (sblob RLIKE 'obstet|gyneco|maternity|reproductive') AS has_maternity,
    (sblob RLIKE 'oncolog|cancer') AS has_oncology,
    (sblob RLIKE 'nephrolog|dialysis') AS has_dialysis,
    (sblob RLIKE 'paediatr|pediatr') AS has_pediatrics,
    (sblob RLIKE 'emergenc|critical care|trauma') AS has_emergency,
    (sblob RLIKE 'orthoped|orthopaed') AS has_orthopedics,
    (sblob RLIKE 'neurolog|neurosurg') AS has_neurology,
    -- ---- existing equipment flags (EXACT logic + names preserved) ----
    (eblob RLIKE '\\bct scan|ct scanner|cect|\\bct\\b') AS has_ct,
    (eblob RLIKE '\\bmri\\b|magnetic resonance') AS has_mri,
    (eblob RLIKE 'x-?ray') AS has_xray,
    (eblob RLIKE 'ultrasound|sonograph|doppler') AS has_ultrasound,
    (eblob RLIKE '\\bicu\\b|intensive care|\\bnicu\\b|\\bccu\\b') AS has_icu,
    (eblob RLIKE 'operation theat|operating theat|\\bot complex') AS has_ot,
    (eblob RLIKE 'blood bank') AS has_blood_bank,
    (eblob RLIKE 'ventilator') AS has_ventilator,
    -- ---- NEW specialty flags (sblob substring approach) ----
    (sblob RLIKE 'ophthalmolog|strabismus|cataract|retina|glaucoma') AS has_ophthalmology,
    (sblob RLIKE 'dentis|dental|endodont|orthodont|prosthodont') AS has_dentistry,
    (sblob RLIKE 'otolaryngolog|otorhino|\\bent\\b') AS has_ent,
    (sblob RLIKE 'urolog') AS has_urology,
    (sblob RLIKE 'gastroenterolog|hepatolog') AS has_gastroenterology,
    (sblob RLIKE 'dermatolog|venereolog') AS has_dermatology,
    (sblob RLIKE 'psychiatr|mental health') AS has_psychiatry,
    (sblob RLIKE 'pulmonolog|respiratory|chest medicine') AS has_pulmonology,
    (sblob RLIKE 'radiolog|imaging') AS has_radiology,
    (sblob RLIKE 'gyneco|obstetric') AS has_gynecology,
    (sblob RLIKE 'general surgery') AS has_general_surgery,
    (sblob RLIKE 'internal medicine|family medicine|general medicine') AS has_general_medicine,
    (sblob RLIKE 'plastic surgery|cosmetic|aesthetic') AS has_plastic_surgery,
    (sblob RLIKE 'anesthe|anaesth') AS has_anesthesia,
    (sblob RLIKE 'patholog|laborator') AS has_pathology
    -- NOTE: free-text clinical flags (has_transplant, has_robotic_surgery, has_chemotherapy,
    -- has_radiotherapy, is_jci_accredited, has_trauma_center, has_telemedicine, has_ambulance,
    -- operating_theatre_count, doctor_count_text, clinical_flags_source) were REMOVED here.
    -- They are exact duplicates of the canonical facilities_enrich_clinical_facts table, which is
    -- the single home for free-text clinical signals mined from capability+procedure+description.
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
  -- existing flags
  has_cardiology, has_maternity, has_oncology, has_dialysis,
  has_pediatrics, has_emergency, has_orthopedics, has_neurology,
  has_ct, has_mri, has_xray, has_ultrasound,
  has_icu, has_ot, has_blood_bank, has_ventilator,
  equipment_richness_score,
  -- NEW: full array passthroughs (per-facility list visible in gold)
  specialties_clean AS specialties_list,
  equipment_arr AS equipment_list,
  -- NEW: specialty flags
  has_ophthalmology, has_dentistry, has_ent, has_urology,
  has_gastroenterology, has_dermatology, has_psychiatry, has_pulmonology,
  has_radiology, has_gynecology, has_general_surgery, has_general_medicine,
  has_plastic_surgery, has_anesthesia, has_pathology
  -- NOTE: free-text clinical flags + mined counts (has_transplant, has_robotic_surgery,
  -- has_chemotherapy, has_radiotherapy, is_jci_accredited, has_trauma_center, has_telemedicine,
  -- has_ambulance, operating_theatre_count, doctor_count_text, clinical_flags_source) were REMOVED.
  -- They duplicated facilities_enrich_clinical_facts, the canonical home for these signals.
FROM scored;

-- ---------------------------------------------------------------------------
-- BRIDGE TABLES (canonical only, many rows per facility_sk)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.facilities_specialties AS
SELECT
  facility_sk,
  specialty
FROM workspace.virtue_foundation_enriched.facilities_silver
LATERAL VIEW explode(specialties_clean) t AS specialty
WHERE is_canonical;

CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.facilities_equipment AS
SELECT
  facility_sk,
  equipment_item
FROM workspace.virtue_foundation_enriched.facilities_silver
LATERAL VIEW explode(equipment_arr) t AS equipment_item
WHERE is_canonical;
