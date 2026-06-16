-- 16_validate_grain.sql
-- Executable grain assertions. Run AFTER building the enrichment tables and around
-- materializing gold_facilities. Each assert_true FAILS the run (throws) if an
-- enrichment table is not EXACTLY 1 row per facility_sk -- which would silently
-- fan out the wide gold table on its LEFT JOINs.
--
-- Bridge tables (facilities_specialties / facilities_equipment / facilities_clinical_facts /
-- facilities_doctors) are INTENTIONALLY many-rows-per-facility, are NOT asserted here,
-- and are NOT joined into gold_facilities.

SELECT assert_true((SELECT COUNT(*) = COUNT(DISTINCT facility_sk) FROM workspace.virtue_foundation_enriched.facilities_enrich_beds),           'facilities_enrich_beds not 1:1 on facility_sk');
SELECT assert_true((SELECT COUNT(*) = COUNT(DISTINCT facility_sk) FROM workspace.virtue_foundation_enriched.facilities_enrich_availability),   'facilities_enrich_availability not 1:1 on facility_sk');
SELECT assert_true((SELECT COUNT(*) = COUNT(DISTINCT facility_sk) FROM workspace.virtue_foundation_enriched.facilities_enrich_contact),        'facilities_enrich_contact not 1:1 on facility_sk');
SELECT assert_true((SELECT COUNT(*) = COUNT(DISTINCT facility_sk) FROM workspace.virtue_foundation_enriched.facilities_enrich_freshness),      'facilities_enrich_freshness not 1:1 on facility_sk');
SELECT assert_true((SELECT COUNT(*) = COUNT(DISTINCT facility_sk) FROM workspace.virtue_foundation_enriched.facilities_enrich_social),         'facilities_enrich_social not 1:1 on facility_sk');
SELECT assert_true((SELECT COUNT(*) = COUNT(DISTINCT facility_sk) FROM workspace.virtue_foundation_enriched.facilities_enrich_capability),     'facilities_enrich_capability not 1:1 on facility_sk');
SELECT assert_true((SELECT COUNT(*) = COUNT(DISTINCT facility_sk) FROM workspace.virtue_foundation_enriched.facilities_enrich_geo),            'facilities_enrich_geo not 1:1 on facility_sk');
SELECT assert_true((SELECT COUNT(*) = COUNT(DISTINCT facility_sk) FROM workspace.virtue_foundation_enriched.facilities_enrich_quality),        'facilities_enrich_quality not 1:1 on facility_sk');
SELECT assert_true((SELECT COUNT(*) = COUNT(DISTINCT facility_sk) FROM workspace.virtue_foundation_enriched.facilities_enrich_clinical_facts), 'facilities_enrich_clinical_facts not 1:1 on facility_sk');
SELECT assert_true((SELECT COUNT(*) = COUNT(DISTINCT facility_sk) FROM workspace.virtue_foundation_enriched.facilities_enrich_profile),        'facilities_enrich_profile not 1:1 on facility_sk');
SELECT assert_true((SELECT COUNT(*) = COUNT(DISTINCT facility_sk) FROM workspace.virtue_foundation_enriched.facilities_enrich_trust),          'facilities_enrich_trust not 1:1 on facility_sk');
SELECT assert_true((SELECT COUNT(*) = COUNT(DISTINCT facility_sk) FROM workspace.virtue_foundation_enriched.facilities_enrich_staff),          'facilities_enrich_staff not 1:1 on facility_sk');
SELECT assert_true((SELECT COUNT(*) = COUNT(DISTINCT facility_sk) FROM workspace.virtue_foundation_enriched.facilities_enrich_description),    'facilities_enrich_description not 1:1 on facility_sk');
SELECT assert_true((SELECT COUNT(*) = COUNT(DISTINCT facility_sk) FROM workspace.virtue_foundation_enriched.gold_facilities),                  'gold_facilities not 1:1 on facility_sk');
