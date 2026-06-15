-- Integrator -> workspace.virtue_foundation_enriched.facilities_gold
-- Wide enriched table at the CANONICAL facility grain (9,989 rows = 9,989 distinct facility_sk).
-- Base = facilities_silver WHERE is_canonical, LEFT JOINed 1:1 on facility_sk to ALL enrichment tables:
--   beds, availability, contact, freshness, social, capability, geo, quality (the original 8),
--   plus clinical_facts (cf), profile (pr), trust (tr), staff (st), description (de).
-- Derived cross-workstream fields: emergency_readiness_score/tier, needs_outreach, is_digitally_active,
--   needs_verification, is_contactable_direct, year_established_final/_source, opd_hours_final, has_operating_hours.
-- The emergency-readiness numerator (reused in score + tier):
--   N = has_emergency + has_icu + has_blood_bank + has_ventilator + has_ot + is_24x7_emergency  (each 0/1)
--   score = round(N/6.0, 3); tier = high>=0.6 / medium>=0.3 / low.
--
-- CLINICAL-SIGNAL CANONICALIZATION (this build):
--   The 11 capability-derived clinical columns (has_transplant, has_robotic_surgery, has_chemotherapy,
--   has_radiotherapy, is_jci_accredited(cap), has_trauma_center, has_telemedicine, has_ambulance,
--   operating_theatre_count, doctor_count_text(cap), clinical_flags_source) were DROPPED from
--   facilities_enrich_capability. The clinical_facts (cf) equivalents are now the canonical clinical
--   signals. With the capability duplicates gone:
--     * cf.is_jci_accredited is selected as is_jci_accredited (no alias needed; the cap one is gone).
--     * pr.doctor_count_text is selected as doctor_count_text (no alias needed; the cap one is gone).

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
  -- WS-6 capability (extended specialty columns)
  cap.specialties_list, cap.equipment_list,
  cap.has_ophthalmology, cap.has_dentistry, cap.has_ent, cap.has_urology,
  cap.has_gastroenterology, cap.has_dermatology, cap.has_psychiatry, cap.has_pulmonology,
  cap.has_radiology, cap.has_gynecology, cap.has_general_surgery, cap.has_general_medicine,
  cap.has_plastic_surgery, cap.has_anesthesia, cap.has_pathology,
  -- WS-7 geo / ownership
  g.lat_clean, g.long_clean, g.geo_valid AS geo_valid_enrich, g.pincode_clean AS geo_pincode_clean,
  g.district_approx, g.ownership_clean, g.is_public_health_facility, g.is_cghs, g.is_esic, g.is_pmjay,
  -- WS-8 quality
  q.is_nabh_accredited, q.is_nabl_accredited, q.is_teaching_hospital, q.is_medical_college_attached,
  q.accreditation_signal_count, q.quality_tier,
  -- WS-10 clinical facts (CANONICAL free-text mined clinical signals;
  --   cf.is_jci_accredited now selected WITHOUT alias as is_jci_accredited since the cap duplicate was dropped)
  cf.clinical_facts_count, cf.is_jci_accredited AS is_jci_accredited,
  cf.offers_robotic_surgery, cf.offers_transplant, cf.offers_chemotherapy, cf.offers_radiotherapy,
  cf.is_trauma_center, cf.offers_telemedicine, cf.offers_ambulance, cf.ot_count_text, cf.clinical_signal_source,
  -- WS-11 profile (pr.doctor_count_text now selected WITHOUT alias as doctor_count_text since the cap duplicate was dropped)
  pr.year_established, pr.facility_age_years, pr.facility_age_tier,
  pr.doctor_count_structured, pr.doctor_count_text AS doctor_count_text, pr.doctor_count,
  pr.doctor_count_source, pr.doctor_count_confidence, pr.staffing_tier,
  pr.description, pr.area, pr.address_full,
  -- WS-12 trust / digital legitimacy
  tr.has_affiliated_staff, tr.has_custom_logo, tr.org_facts_count, tr.social_post_count,
  tr.social_presence_count, tr.source_url_count, tr.source_urls_list,
  tr.affiliation_type_ids, tr.has_affiliation, tr.data_completeness_score,
  -- WS-13 staff (clinical-staff presence mined from case-sensitive capability+procedure+description blob)
  st.named_doctor_count, st.has_named_doctors, st.has_department_lead,
  st.has_cardiologist, st.has_oncologist, st.has_neurologist, st.has_nephrologist,
  st.has_pediatrician, st.has_obgyn, st.has_orthopedic_surgeon, st.has_urologist,
  st.has_dermatologist, st.has_ophthalmologist, st.has_psychiatrist, st.has_pulmonologist,
  st.has_gastroenterologist, st.has_radiologist, st.has_pathologist, st.has_anesthesiologist,
  st.has_general_surgeon, st.has_physician,
  st.specialist_domain_count, st.has_specialist_evidence, st.staff_evidence_source,
  -- WS-14 description (free-text description metrics + mined signals)
  de.description_length, de.description_word_count, de.has_rich_description,
  de.ownership_sector, de.ownership_sector_source, de.desc_founding_year,
  de.desc_has_opening_hours, de.desc_opening_hours_raw, de.desc_accreditation_signal,
  de.desc_mentions_24x7, de.desc_bed_count,
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
    AS needs_verification,
  -- WS-3 fix: direct (phone/email) contactability, distinct from is_contactable (any channel incl. website/facebook)
  (c.email_final IS NOT NULL OR c.phone_final IS NOT NULL) AS is_contactable_direct,
  -- WS-11 fix: best founding year coalescing structured field with description-mined year + provenance
  coalesce(pr.year_established, de.desc_founding_year) AS year_established_final,
  CASE
    WHEN pr.year_established IS NOT NULL THEN 'yearEstablished_field'
    WHEN de.desc_founding_year IS NOT NULL THEN 'description_text'
    ELSE NULL
  END AS year_established_source,
  -- WS-2 fix: best operating-hours text (real WS-2 operating-hours answer)
  coalesce(av.opd_hours_raw, de.desc_opening_hours_raw) AS opd_hours_final,
  (coalesce(av.opd_hours_raw, de.desc_opening_hours_raw) IS NOT NULL) AS has_operating_hours
FROM (SELECT * FROM workspace.virtue_foundation_enriched.facilities_silver WHERE is_canonical) s
LEFT JOIN workspace.virtue_foundation_enriched.facilities_enrich_beds          b   USING (facility_sk)
LEFT JOIN workspace.virtue_foundation_enriched.facilities_enrich_availability  av  USING (facility_sk)
LEFT JOIN workspace.virtue_foundation_enriched.facilities_enrich_contact       c   USING (facility_sk)
LEFT JOIN workspace.virtue_foundation_enriched.facilities_enrich_freshness     f   USING (facility_sk)
LEFT JOIN workspace.virtue_foundation_enriched.facilities_enrich_social        so  USING (facility_sk)
LEFT JOIN workspace.virtue_foundation_enriched.facilities_enrich_capability    cap USING (facility_sk)
LEFT JOIN workspace.virtue_foundation_enriched.facilities_enrich_geo           g   USING (facility_sk)
LEFT JOIN workspace.virtue_foundation_enriched.facilities_enrich_quality       q   USING (facility_sk)
LEFT JOIN workspace.virtue_foundation_enriched.facilities_enrich_clinical_facts cf  USING (facility_sk)
LEFT JOIN workspace.virtue_foundation_enriched.facilities_enrich_profile       pr  USING (facility_sk)
LEFT JOIN workspace.virtue_foundation_enriched.facilities_enrich_trust         tr  USING (facility_sk)
LEFT JOIN workspace.virtue_foundation_enriched.facilities_enrich_staff         st  USING (facility_sk)
LEFT JOIN workspace.virtue_foundation_enriched.facilities_enrich_description   de  USING (facility_sk);

-- Validation (expect 9989 / 9989):
-- SELECT COUNT(*), COUNT(DISTINCT facility_sk) FROM workspace.virtue_foundation_enriched.facilities_gold;
