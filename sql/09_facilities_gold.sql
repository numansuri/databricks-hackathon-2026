-- Integrator -> workspace.virtue_foundation_enriched.facilities_gold
-- Wide enriched table at the CANONICAL facility grain (9,989 rows = 9,989 distinct facility_sk; 86 columns).
-- Base = facilities_silver WHERE is_canonical, LEFT JOINed 1:1 on facility_sk to all 8 enrichment tables.
-- Derived cross-workstream fields: emergency_readiness_score/tier, needs_outreach, is_digitally_active, needs_verification.
-- The emergency-readiness numerator (reused in score + tier):
--   N = has_emergency + has_icu + has_blood_bank + has_ventilator + has_ot + is_24x7_emergency  (each 0/1)
--   score = round(N/6.0, 3); tier = high>=0.6 / medium>=0.3 / low.

CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.facilities_gold AS
SELECT
  s.facility_sk, s.unique_id, s.name, s.address_city, s.address_state, s.pincode_clean,
  s.latitude, s.longitude, s.facility_type, s.operator_type,
  s.official_phone, s.email, s.official_website, s.facebook_link, s.is_probable_duplicate,
  -- WS-1 beds
  b.capacity_structured, b.bed_count_text, b.bed_count, b.bed_count_source, b.bed_count_confidence, b.capacity_is_imputed,
  -- WS-2 availability
  av.has_24x7_service, av.is_24x7_emergency, av.hours_signal_present, av.opd_hours_raw,
  -- WS-3 contact
  c.email_final, c.email_source, c.phone_final, c.phone_source, c.contact_verification_status, c.is_contactable, c.contact_followup_link,
  -- WS-4 freshness
  f.page_update_date, f.social_post_date, f.days_since_page_update, f.freshness_tier, f.data_freshness_score,
  -- WS-5 social
  so.followers_clean, so.likes_clean, so.engagements_clean, so.has_website, so.has_facebook,
  so.digital_presence_score, so.social_activity_tier, so.is_digitally_invisible,
  -- WS-6 capability
  cap.specialty_count, cap.is_multispecialty, cap.facility_complexity_tier,
  cap.has_cardiology, cap.has_maternity, cap.has_oncology, cap.has_dialysis, cap.has_pediatrics, cap.has_emergency,
  cap.has_orthopedics, cap.has_neurology, cap.has_ct, cap.has_mri, cap.has_xray, cap.has_ultrasound,
  cap.has_icu, cap.has_ot, cap.has_blood_bank, cap.has_ventilator, cap.equipment_richness_score,
  -- WS-7 geo / ownership
  g.lat_clean, g.long_clean, g.geo_valid AS geo_valid_enrich, g.pincode_clean AS geo_pincode_clean,
  g.district_approx, g.ownership_clean, g.is_public_health_facility, g.is_cghs, g.is_esic, g.is_pmjay,
  -- WS-8 quality
  q.is_nabh_accredited, q.is_nabl_accredited, q.is_teaching_hospital, q.is_medical_college_attached,
  q.accreditation_signal_count, q.quality_tier,
  -- WS-9 derived: emergency readiness
  round((cast(coalesce(cap.has_emergency,false) as int) + cast(coalesce(cap.has_icu,false) as int)
       + cast(coalesce(cap.has_blood_bank,false) as int) + cast(coalesce(cap.has_ventilator,false) as int)
       + cast(coalesce(cap.has_ot,false) as int) + cast(coalesce(av.is_24x7_emergency,false) as int)) / 6.0, 3)
    AS emergency_readiness_score,
  CASE
    WHEN (cast(coalesce(cap.has_emergency,false) as int) + cast(coalesce(cap.has_icu,false) as int)
        + cast(coalesce(cap.has_blood_bank,false) as int) + cast(coalesce(cap.has_ventilator,false) as int)
        + cast(coalesce(cap.has_ot,false) as int) + cast(coalesce(av.is_24x7_emergency,false) as int)) / 6.0 >= 0.6 THEN 'high'
    WHEN (cast(coalesce(cap.has_emergency,false) as int) + cast(coalesce(cap.has_icu,false) as int)
        + cast(coalesce(cap.has_blood_bank,false) as int) + cast(coalesce(cap.has_ventilator,false) as int)
        + cast(coalesce(cap.has_ot,false) as int) + cast(coalesce(av.is_24x7_emergency,false) as int)) / 6.0 >= 0.3 THEN 'medium'
    ELSE 'low'
  END AS emergency_readiness_tier,
  -- cross-workstream flags (guarded with coalesce)
  (coalesce(f.freshness_tier,'unknown')='stale' OR coalesce(c.contact_verification_status,'unverified')='unverified')
    AS needs_outreach,
  (coalesce(so.digital_presence_score,0) >= 0.5 AND f.social_post_date >= date_sub(DATE'2025-12-21',365))
    AS is_digitally_active,
  (coalesce(b.bed_count_confidence,'low') <> 'high'
     OR coalesce(c.contact_verification_status,'unverified')='unverified'
     OR coalesce(f.freshness_tier,'unknown') IN ('stale','unknown'))
    AS needs_verification
FROM (SELECT * FROM workspace.virtue_foundation_enriched.facilities_silver WHERE is_canonical) s
LEFT JOIN workspace.virtue_foundation_enriched.facilities_enrich_beds         b   USING (facility_sk)
LEFT JOIN workspace.virtue_foundation_enriched.facilities_enrich_availability av  USING (facility_sk)
LEFT JOIN workspace.virtue_foundation_enriched.facilities_enrich_contact      c   USING (facility_sk)
LEFT JOIN workspace.virtue_foundation_enriched.facilities_enrich_freshness    f   USING (facility_sk)
LEFT JOIN workspace.virtue_foundation_enriched.facilities_enrich_social       so  USING (facility_sk)
LEFT JOIN workspace.virtue_foundation_enriched.facilities_enrich_capability   cap USING (facility_sk)
LEFT JOIN workspace.virtue_foundation_enriched.facilities_enrich_geo          g   USING (facility_sk)
LEFT JOIN workspace.virtue_foundation_enriched.facilities_enrich_quality      q   USING (facility_sk);

-- Validation (expect 9989 / 9989):
-- SELECT COUNT(*), COUNT(DISTINCT facility_sk) FROM workspace.virtue_foundation_enriched.facilities_gold;
