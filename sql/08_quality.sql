-- WS-8  ->  workspace.virtue_foundation_enriched.facilities_enrich_quality
-- Built by workflow facilities-enrichment-build (deterministic SQL, canonical grain, 9,989 rows).
-- Coverage: Per-signal counts (of 9989 canonical rows): is_nabh_accredited=1316, is_nabl_accredited=501, is_teaching_hospital=213, is_medical_college_attached=433. Quality tiers: high=387 (signal_count 4=9, 3=42, 2=336), medium=1629 (signal_count=1), unknown=7973 (signal_count=0). Signals ar

CREATE TABLE workspace.virtue_foundation_enriched.facilities_enrich_quality (
  facility_sk STRING,
  is_nabh_accredited BOOLEAN,
  is_nabl_accredited BOOLEAN,
  is_teaching_hospital BOOLEAN,
  is_medical_college_attached BOOLEAN,
  accreditation_signal_count INT,
  quality_tier STRING) USING delta;
