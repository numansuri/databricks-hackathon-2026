-- WS-3  ->  workspace.virtue_foundation_enriched.facilities_enrich_contact
-- Built by workflow facilities-enrichment-build (deterministic SQL, canonical grain, 9,989 rows).
-- Coverage: Validation PASSED: COUNT(*)=9989 and COUNT(DISTINCT facility_sk)=9989, both equal required 9989 (one row per canonical facility_sk). Verification status counts: verified=9631, unverified=358. Field coverage: email present (email_source='original')=8538; phone present (phone_sourc

CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.facilities_enrich_contact AS
SELECT
  facility_sk,
  email AS email_final,
  CASE WHEN email IS NOT NULL THEN 'original' ELSE 'none' END AS email_source,
  official_phone AS phone_final,
  CASE WHEN official_phone IS NOT NULL THEN 'original' ELSE 'none' END AS phone_source,
  CASE WHEN (email IS NOT NULL OR official_phone IS NOT NULL) THEN 'verified' ELSE 'unverified' END AS contact_verification_status,
  (email IS NOT NULL OR official_phone IS NOT NULL OR official_website IS NOT NULL OR facebook_link IS NOT NULL) AS is_contactable,
  coalesce(official_website, facebook_link) AS contact_followup_link
FROM workspace.virtue_foundation_enriched.facilities_silver
WHERE is_canonical;
