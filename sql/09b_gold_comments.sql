-- Column comments for workspace.virtue_foundation_enriched.facilities_gold (176 columns).
-- One ALTER ... COMMENT per column. Each comment states WHAT the column is and HOW it was derived
-- (raw source column + transform/regex/clamp). Single quotes inside comments are doubled to escape.
-- Run after 09_facilities_gold.sql. Idempotent. Execute each ALTER individually.

-- ============================ identity / location (silver passthrough) ============================
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN facility_sk COMMENT 'Primary key, one row per canonical facility. Deterministic sha2-256 of concat_ws(name|address_line1|pincode_clean|round(lat,4)|round(long,4)) computed in silver; base is facilities_silver WHERE is_canonical (9,989 facilities).';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN unique_id COMMENT 'Source row id (silver unique_id passthrough); the original per-scrape identifier from the source facilities table.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN name COMMENT 'Facility name. Silver trim(name) with literal-missing strings (''null''/''na''/'''') normalized to NULL.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN address_city COMMENT 'City/town. Silver trim(address_city) with literal-missing strings normalized to NULL.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN address_state COMMENT 'State/region. Silver trim(address_stateOrRegion) with literal-missing strings normalized to NULL.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN pincode_clean COMMENT '6-digit Indian PIN code. Silver regexp_extract of the first 6-digit run from address_zipOrPostcode after stripping spaces; NULL when none found.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN latitude COMMENT 'Raw latitude (double) from source, silver passthrough; not range-validated here (see lat_clean / geo_valid_enrich for the validated copy).';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN longitude COMMENT 'Raw longitude (double) from source, silver passthrough; not range-validated here (see long_clean / geo_valid_enrich for the validated copy).';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN facility_type COMMENT 'Facility type id. Silver trim(facilityTypeId) with literal-missing strings normalized to NULL.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN operator_type COMMENT 'Operator type id (e.g. private/public/government). Silver trim(operatorTypeId) with literal-missing strings normalized to NULL.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN official_phone COMMENT 'Official phone (raw). Silver trim(officialPhone) with literal-missing strings normalized to NULL.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN email COMMENT 'Official email (raw). Silver trim(email) with literal-missing strings normalized to NULL.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN official_website COMMENT 'Official website (raw). Silver trim(officialWebsite) with literal-missing strings normalized to NULL.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN facebook_link COMMENT 'Facebook page link (raw). Silver trim(facebookLink) with literal-missing strings normalized to NULL.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN is_probable_duplicate COMMENT 'TRUE when more than one source row shares this facility_sk (COUNT(*) OVER PARTITION BY facility_sk > 1 in silver); 22 rows / 11 pairs. Canonical row is kept per facility.';

-- ============================ WS-1 beds (facilities_enrich_beds) ============================
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN capacity_structured COMMENT 'Structured bed count. TRY_CAST(capacity_raw AS int) kept only when in 1..5000, else NULL. High-confidence source.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN bed_count_text COMMENT 'Text-mined bed count. array_max of regexp_extract_all ''([0-9]{1,4})\s*-?\s*bed(s|ded)?'' over lower(description|procedure_arr|capability_arr), kept only when value in 1..5000.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN bed_count COMMENT 'Best bed count = coalesce(capacity_structured, bed_count_text). NULL when neither available (~73% of facilities).';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN bed_count_source COMMENT 'Provenance of bed_count: ''structured'' (from capacity_raw), ''text'' (mined from free text), or ''none''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN bed_count_confidence COMMENT 'Confidence of bed_count: ''high'' when structured, ''medium'' when text-mined, ''low'' when none.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN capacity_is_imputed COMMENT 'TRUE when capacity_structured IS NULL but bed_count_text IS NOT NULL (bed_count came from mined free text, not the structured field).';

-- ============================ WS-2 availability (facilities_enrich_availability) ============================
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_24x7_service COMMENT '24x7 service signal. blob (lower description|procedure_arr|capability_arr) RLIKE ''(24x7|24/7|24 hours|round[ -]the[ -]clock)''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN is_24x7_emergency COMMENT '24x7 EMERGENCY signal: blob has emergency/casualty/trauma within ~40 chars of a 24x7/round-the-clock token (RLIKE in either order). Strict subset of has_24x7_service.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN hours_signal_present COMMENT 'Any operating-hours signal present. blob RLIKE ''([0-9]{1,2}\s*(am|pm)|[0-9]{1,2}:[0-9]{2}|timings?|opd timing|working hours|hours of operation)''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN opd_hours_raw COMMENT 'Raw OPD-hours snippet mined from blob via regexp_extract ''(opd[^.|]{0,60}(am|pm|noon))''; NULL when no match (~1% populated). See opd_hours_final for the cross-source best operating-hours text.';

-- ============================ WS-3 contact (facilities_enrich_contact) ============================
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN email_final COMMENT 'Resolved email = silver email passthrough (no external enrichment fetched in this build).';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN email_source COMMENT 'Provenance of email_final: ''original'' when email IS NOT NULL, else ''none''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN phone_final COMMENT 'Resolved phone = silver official_phone passthrough (no external enrichment fetched in this build).';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN phone_source COMMENT 'Provenance of phone_final: ''original'' when official_phone IS NOT NULL, else ''none''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN contact_verification_status COMMENT '''verified'' when email OR official_phone present, else ''unverified''. Used by needs_outreach / needs_verification.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN is_contactable COMMENT 'Means "has ANY contact channel" = TRUE when any of email, official_phone, official_website, facebook_link is non-NULL. NOTE: website/facebook count, so this overstates direct reachability; for phone/email reachability use is_contactable_direct instead.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN contact_followup_link COMMENT 'Best follow-up URL = coalesce(official_website, facebook_link).';

-- ============================ WS-4 freshness (facilities_enrich_freshness) ============================
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN page_update_date COMMENT 'Parsed page-update date from recency_of_page_update_raw: ISO ''YYYY-MM-DD'' parsed directly, or ''N day/week/month/year ago'' subtracted from 2025-12-21 (week=7,month=30,year=365 days); else NULL.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN social_post_date COMMENT 'Most-recent social-post date: to_date(social_post_date_raw) when it matches ''YYYY-MM-DD'', else NULL.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN days_since_page_update COMMENT 'datediff(2025-12-21, page_update_date) in days; NULL when page_update_date NULL.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN freshness_tier COMMENT 'Freshness bucket on d = min days-since over page_update_date and social_post_date (missing=99999): fresh (<182), aging (<548), stale (<99999), else unknown.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN data_freshness_score COMMENT '0..1 freshness score = round(greatest(0, 1 - d/730), 3) on d = min days-since of page/social date; NULL when both dates missing (d=99999).';

-- ============================ WS-5 social (facilities_enrich_social) ============================
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN followers_clean COMMENT 'Social follower count = silver n_followers, with values >5,000,000 clamped to NULL (drops 2 ~15M outliers).';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN likes_clean COMMENT 'Social like count = silver n_likes, with values >5,000,000 clamped to NULL.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN engagements_clean COMMENT 'Social engagement count = silver n_engagements, with values >5,000,000 clamped to NULL.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_website COMMENT 'TRUE when official_website IS NOT NULL.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_facebook COMMENT 'TRUE when facebook_link IS NOT NULL.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN digital_presence_score COMMENT '0..1 digital-presence score = round(0.25*has_website + 0.25*has_facebook + 0.25*min(social_presence_count,4)/4 + 0.10*(custom_logo_presence=''true'') + 0.15*(affiliated_staff_presence=''true''), 3).';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN social_activity_tier COMMENT 'Follower bucket on coalesce(followers_clean,0): high (>=5000), medium (>=500), low (>=1), else none.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN is_digitally_invisible COMMENT 'TRUE when digital_presence_score < 0.25 (note: ~99% have a Facebook link, so few qualify; threshold is a follow-up tuning item).';

-- ============================ WS-6 capability (facilities_enrich_capability) ============================
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN specialty_count COMMENT 'Number of distinct specialties = size(specialties_clean) from silver. Avg ~11.84, max 50.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN is_multispecialty COMMENT 'TRUE when specialty_count >= 3 (~91% of facilities).';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN facility_complexity_tier COMMENT 'Complexity tier: ''tertiary'' if specialty_count>=8 OR equipment_richness_score>=5; ''secondary'' if specialty_count>=3; else ''primary''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_cardiology COMMENT 'sblob (lowercased pipe-joined specialties_clean) RLIKE ''cardio''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_maternity COMMENT 'sblob RLIKE ''obstet|gyneco|maternity|reproductive''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_oncology COMMENT 'sblob RLIKE ''oncolog|cancer''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_dialysis COMMENT 'sblob RLIKE ''nephrolog|dialysis''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_pediatrics COMMENT 'sblob RLIKE ''paediatr|pediatr''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_emergency COMMENT 'sblob RLIKE ''emergenc|critical care|trauma''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_orthopedics COMMENT 'sblob RLIKE ''orthoped|orthopaed''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_neurology COMMENT 'sblob RLIKE ''neurolog|neurosurg''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_ct COMMENT 'eblob (lowercased equipment_arr + description + capability_arr) RLIKE ''\bct scan|ct scanner|cect|\bct\b''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_mri COMMENT 'eblob RLIKE ''\bmri\b|magnetic resonance''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_xray COMMENT 'eblob RLIKE ''x-?ray''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_ultrasound COMMENT 'eblob RLIKE ''ultrasound|sonograph|doppler''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_icu COMMENT 'eblob RLIKE ''\bicu\b|intensive care|\bnicu\b|\bccu\b''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_ot COMMENT 'eblob RLIKE ''operation theat|operating theat|\bot complex''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_blood_bank COMMENT 'eblob RLIKE ''blood bank''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_ventilator COMMENT 'eblob RLIKE ''ventilator''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN equipment_richness_score COMMENT 'Sum of the 8 equipment booleans (has_ct, has_mri, has_xray, has_ultrasound, has_icu, has_ot, has_blood_bank, has_ventilator). Range 0-8.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN specialties_list COMMENT 'Full per-facility normalized specialties array (silver specialties_clean passthrough). 2,701 distinct values preserved.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN equipment_list COMMENT 'Full per-facility equipment array (silver equipment_arr passthrough).';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_ophthalmology COMMENT 'sblob RLIKE ''ophthalmolog|strabismus|cataract|retina|glaucoma''. ~2,880 facilities.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_dentistry COMMENT 'sblob RLIKE ''dentis|dental|endodont|orthodont|prosthodont''. ~4,282 facilities.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_ent COMMENT 'sblob RLIKE ''otolaryngolog|otorhino|\bent\b''. ~2,798 facilities.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_urology COMMENT 'sblob RLIKE ''urolog''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_gastroenterology COMMENT 'sblob RLIKE ''gastroenterolog|hepatolog''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_dermatology COMMENT 'sblob RLIKE ''dermatolog|venereolog''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_psychiatry COMMENT 'sblob RLIKE ''psychiatr|mental health''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_pulmonology COMMENT 'sblob RLIKE ''pulmonolog|respiratory|chest medicine''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_radiology COMMENT 'sblob RLIKE ''radiolog|imaging''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_gynecology COMMENT 'sblob RLIKE ''gyneco|obstetric''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_general_surgery COMMENT 'sblob RLIKE ''general surgery''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_general_medicine COMMENT 'sblob RLIKE ''internal medicine|family medicine|general medicine''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_plastic_surgery COMMENT 'sblob RLIKE ''plastic surgery|cosmetic|aesthetic''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_anesthesia COMMENT 'sblob RLIKE ''anesthe|anaesth''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_pathology COMMENT 'sblob RLIKE ''patholog|laborator''.';

-- ============================ WS-7 geo / ownership (facilities_enrich_geo) ============================
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN lat_clean COMMENT 'Range-validated latitude: silver latitude when geo_valid (India bbox lat 6..37, long 68..98), else NULL.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN long_clean COMMENT 'Range-validated longitude: silver longitude when geo_valid (India bbox), else NULL.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN geo_valid_enrich COMMENT 'Geo validity flag (aliased from geo enrich geo_valid): latitude in 6..37 AND longitude in 68..98 (India bounding box). TRUE for ~9,953 rows.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN geo_pincode_clean COMMENT 'PIN code passthrough from the geo enrichment (aliased from geo.pincode_clean); same value as pincode_clean.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN district_approx COMMENT 'Approximate district = upper(trim(address_city)). City used as district proxy (true pincode->NFHS district crosswalk is a follow-up).';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN ownership_clean COMMENT 'Normalized ownership: operator_type mapped to private/public/government; else keyword scan of description -> ''trust'' (trust|charitable|charity|mission) / ''public'' (government|govt|district hospital|civil hospital|municipal) / ''unknown''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN is_public_health_facility COMMENT 'TRUE when ownership_clean IN (''public'',''government''). ~474 facilities.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN is_cghs COMMENT 'CGHS empanelment signal: lower(name + description) RLIKE ''cghs''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN is_esic COMMENT 'ESIC signal: lower(name + description) RLIKE ''\besic\b|employees state insurance''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN is_pmjay COMMENT 'PM-JAY / Ayushman signal: lower(name + description) RLIKE ''pmjay|ayushman|jan arogya''.';

-- ============================ WS-8 quality (facilities_enrich_quality) ============================
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN is_nabh_accredited COMMENT 'NABH accreditation signal mined from facility free text (capability/procedure/description). ~1,316 facilities.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN is_nabl_accredited COMMENT 'NABL lab-accreditation signal mined from facility free text. ~501 facilities.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN is_teaching_hospital COMMENT 'Teaching-hospital flag (WS-8, tightened for precision): TRUE when the NAME is a medical/dental/nursing college or teaching hospital, OR the name+description+capability text contains an explicit teaching/residency/DNB-seat phrase (e.g. ''teaching hospital'', ''residency program'', ''DNB program/seat'', ''MCI/NMC recognised''). Generic institute/research/foundation tokens and the bare physician degree ''DNB'' no longer match.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN is_medical_college_attached COMMENT 'Medical-college-attached flag (WS-8, tightened): TRUE when the NAME is itself a medical college, or text shows explicit attachment/affiliation to a medical college (''attached/affiliated to ... medical college'', ''... medical college and hospital'', ''part of ... medical college''). Staff-bio mentions of a degree FROM a medical college no longer match.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN accreditation_signal_count COMMENT 'Count of the 4 quality signals set (is_nabh_accredited + is_nabl_accredited + is_teaching_hospital + is_medical_college_attached). Range 0-4.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN quality_tier COMMENT 'Quality bucket on accreditation_signal_count: high (>=2 signals), medium (=1), unknown (=0).';

-- ============================ WS-10 clinical facts (facilities_enrich_clinical_facts) — CANONICAL clinical signals ============================
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN clinical_facts_count COMMENT 'size(capability_arr)+size(procedure_arr): total mined clinical facts (sum across table = 399,572, matching bridge facilities_clinical_facts row count).';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN is_jci_accredited COMMENT 'CANONICAL JCI-accreditation signal (from facilities_enrich_clinical_facts; the duplicate capability column was dropped this build). blob (lower capability_arr||procedure_arr||description) RLIKE ''jci accredit|joint commission''. Rare, high differentiating value.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN offers_robotic_surgery COMMENT 'clinical_facts blob RLIKE ''robotic|da vinci''. CANONICAL robotic-surgery clinical signal.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN offers_transplant COMMENT 'clinical_facts blob RLIKE ''transplant''. CANONICAL transplant clinical signal.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN offers_chemotherapy COMMENT 'clinical_facts blob RLIKE ''chemotherap''. CANONICAL chemotherapy clinical signal.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN offers_radiotherapy COMMENT 'clinical_facts blob RLIKE ''radiotherap|radiation oncolog|linac|linear accelerator|cyberknife|gamma knife''. CANONICAL radiotherapy clinical signal.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN is_trauma_center COMMENT 'clinical_facts blob RLIKE ''trauma cent|trauma care''. CANONICAL trauma-center clinical signal.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN offers_telemedicine COMMENT 'clinical_facts blob RLIKE ''telemedicine|teleconsult|tele-?health''. CANONICAL telemedicine clinical signal.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN offers_ambulance COMMENT 'clinical_facts blob RLIKE ''ambulance''. CANONICAL ambulance clinical signal.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN ot_count_text COMMENT 'Operating-theatre count from clinical_facts: array_max of regexp_extract_all ''([0-9]{1,3})\s*(?:operating|operation)\s*theat'' over blob, clamped to 1..200 else NULL (observed 1..69). CANONICAL OT-count text signal.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN clinical_signal_source COMMENT 'Constant ''capability_procedure_description_text''; flags here are scraped free-text signals (mined from capability + procedure + description), not authoritative (surfaces provenance/uncertainty).';

-- ============================ WS-11 profile (facilities_enrich_profile) ============================
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN year_established COMMENT 'TRY_CAST(year_established_raw AS int) kept only when in 1800..2026, else NULL. See year_established_final for the description-backfilled best value.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN facility_age_years COMMENT '2026 - year_established; NULL when year_established NULL.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN facility_age_tier COMMENT 'Age bucket on facility_age_years: legacy_50plus (>=50), established_20_49 (>=20), growing_5_19 (>=5), new_under_5 (>=0), else NULL.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN doctor_count_structured COMMENT 'TRY_CAST(number_doctors_raw AS int) clamped to 1..5000, else NULL. High-confidence doctor count.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN doctor_count_text COMMENT 'CANONICAL text-mined doctor count (from facilities_enrich_profile; the duplicate capability column was dropped this build): largest ''<n> doctors'' (optional +) mention from lower(capability_arr||procedure_arr), clamped 1..5000.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN doctor_count COMMENT 'Best doctor count = coalesce(doctor_count_structured, profile-text-mined doctor_count_text).';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN doctor_count_source COMMENT 'Provenance of doctor_count: ''structured'' when from number_doctors_raw, else ''text'' when text-mined, else NULL.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN doctor_count_confidence COMMENT 'Confidence of doctor_count: ''high'' for structured, ''low'' for text-mined, else NULL.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN staffing_tier COMMENT 'Staffing bucket on doctor_count: large (>=100), medium (>=25), small (>=1), else NULL.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN description COMMENT 'Passthrough of silver description (facility free-text blurb) for frontend display/search.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN area COMMENT 'Passthrough of silver area (locality/area; mostly NULL, kept for completeness).';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN address_full COMMENT 'Null-safe concat_ws('', '', address_line1, address_line2, address_line3); NULL only when all three are empty.';

-- ============================ WS-12 trust / digital legitimacy (facilities_enrich_trust) ============================
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_affiliated_staff COMMENT 'Derived from silver affiliated_staff_presence: lower(trim(x))=''true'' -> TRUE, else FALSE.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_custom_logo COMMENT 'Derived from silver custom_logo_presence: lower(trim(x))=''true'' -> TRUE, else FALSE.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN org_facts_count COMMENT 'Passthrough of silver number_of_facts (count of structured org facts about the organization).';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN social_post_count COMMENT 'Passthrough of silver post_count (number of social posts).';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN social_presence_count COMMENT 'Passthrough of silver social_presence_count (number of distinct social platforms present).';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN source_url_count COMMENT 'Passthrough of silver source_url_count (number of distinct source URLs scraped for the facility).';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN source_urls_list COMMENT 'slice(source_urls_arr, 1, 5): first up to 5 source URLs for human verifiability.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN affiliation_type_ids COMMENT 'Passthrough of silver affiliation_type_ids_arr (affiliation/accreditation type ids; JSON array parsed and de-duped in silver).';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_affiliation COMMENT 'size(affiliation_type_ids_arr) > 0.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN data_completeness_score COMMENT '0..1 score = round(mean of 10 presence indicators, 3). Indicators (1 if present): email, official_phone, official_website, size(specialties_clean)>0, description, year_established_raw, capacity_raw, has_affiliated_staff, has_custom_logo, social_presence_count NOT NULL.';

-- ============================ WS-13 staff (facilities_enrich_staff; INFERRED from scraped free text) ============================
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN named_doctor_count COMMENT 'Count of DISTINCT ''Dr. Firstname [Lastname...]'' name mentions mined (case-sensitive) from the capability+procedure+description blob via regexp_extract_all, with a negative-lookahead filter dropping institution names (''Dr X Hospital/College/University/Institute/Clinic''). INFERRED from scraped text; see the facilities_doctors bridge for the names.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_named_doctors COMMENT 'named_doctor_count > 0. TRUE for 5,649 facilities.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_department_lead COMMENT 'Blob (lowercased capability+procedure+description) RLIKE ''led by|headed by|head of department|\bhod\b''. TRUE for 1,226 facilities.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_cardiologist COMMENT 'Blob (lowercased capability+procedure+description) RLIKE ''cardiologist''. TRUE for 363 facilities. Direct specialist-title evidence.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_oncologist COMMENT 'Blob RLIKE ''oncologist''. TRUE for 157 facilities. Direct specialist-title evidence.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_neurologist COMMENT 'Blob RLIKE ''neurologist|neurosurgeon|neuro surgeon''. TRUE for 292 facilities. Direct specialist-title evidence.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_nephrologist COMMENT 'Blob RLIKE ''nephrologist''. TRUE for 104 facilities. Direct specialist-title evidence.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_pediatrician COMMENT 'Blob RLIKE ''paediatrician|pediatrician|neonatologist''. TRUE for 486 facilities. Direct specialist-title evidence.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_obgyn COMMENT 'Blob RLIKE ''gynaecologist|gynecologist|obstetrician''. TRUE for 750 facilities. Direct specialist-title evidence.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_orthopedic_surgeon COMMENT 'Blob RLIKE ''orthopaedician|orthopedician|orthopaedic surgeon|orthopedic surgeon''. TRUE for 337 facilities. Direct specialist-title evidence.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_urologist COMMENT 'Blob RLIKE ''urologist''. TRUE for 330 facilities. Direct specialist-title evidence.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_dermatologist COMMENT 'Blob RLIKE ''dermatologist''. TRUE for 241 facilities. Direct specialist-title evidence.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_ophthalmologist COMMENT 'Blob RLIKE ''ophthalmologist|eye surgeon''. TRUE for 373 facilities. Direct specialist-title evidence.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_psychiatrist COMMENT 'Blob RLIKE ''psychiatrist''. TRUE for 123 facilities. Direct specialist-title evidence.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_pulmonologist COMMENT 'Blob RLIKE ''pulmonologist|chest physician''. TRUE for 107 facilities. Direct specialist-title evidence.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_gastroenterologist COMMENT 'Blob RLIKE ''gastroenterologist''. TRUE for 146 facilities. Direct specialist-title evidence.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_radiologist COMMENT 'Blob RLIKE ''radiologist''. TRUE for 159 facilities. Direct specialist-title evidence.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_pathologist COMMENT 'Blob RLIKE ''pathologist''. TRUE for 170 facilities. Direct specialist-title evidence.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_anesthesiologist COMMENT 'Blob RLIKE ''anaesthesiologist|anesthesiologist|anaesthetist''. TRUE for 93 facilities. Direct specialist-title evidence.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_general_surgeon COMMENT 'Blob RLIKE ''general surgeon''. TRUE for 232 facilities. Direct specialist-title evidence.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_physician COMMENT 'Blob RLIKE ''general physician|\bphysician\b''. Generic physician mention; EXCLUDED from specialist_domain_count / has_specialist_evidence as too broad to be specialist evidence.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN specialist_domain_count COMMENT 'Sum of the 17 SPECIALIST-presence boolean flags cast to int (range 0-17). has_physician is excluded as too generic. Counts distinct specialist domains with named-title evidence in the capability/procedure/description text.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_specialist_evidence COMMENT 'specialist_domain_count > 0: at least one specialist domain has named-title evidence in the free text (has_physician excluded).';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN staff_evidence_source COMMENT 'Constant ''capability_procedure_description_text''. Documents that all staff signals are mined from scraped free-text and are INFERRED, not authoritative.';

-- ============================ WS-14 description (facilities_enrich_description; mined from description text) ============================
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN description_length COMMENT 'Character length of silver description (length(description)). 100% filled.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN description_word_count COMMENT 'Whitespace-split word count of trimmed description: size(split(trim(description), ''\s+'')).';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_rich_description COMMENT 'description_length >= 300 (flags facilities with a substantive free-text blurb).';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN ownership_sector COMMENT 'Ownership sector inferred from lower(description)+name text (WS-14, tightened to require institutional context): ''government'' (govt/municipal/district/civil/public-sector/railway/ESIC hospital terms), ''trust_charitable'' (charitable/mission-hospital/trust-hospital/NGO/non-profit/seva terms), ''private'' (Pvt Ltd/private hospital/LLP/corporate terms), else NULL = unknown (never guessed). Supplementary text signal; see ownership_sector_final for the governed field.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN ownership_sector_source COMMENT 'Provenance for ownership_sector: ''description_name_text'' when a sector was inferred; NULL when ownership_sector is NULL (no provenance for a non-classification).';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN desc_founding_year COMMENT 'Founding year mined from description, requiring an explicit founding phrase (established/founded/incorporated/inception/set up/commissioned/serving since/operating since) immediately before a 4-digit year; clamped 1800..2026 else NULL. Bare ''since YYYY'' is excluded (often experience/service years).';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN desc_has_opening_hours COMMENT 'TRUE if description RLIKE ''opening hours|working hours|timings|open 24'', OR mentions a Mon-* day range together with an HH:MM time. TRUE for 330 rows.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN desc_opening_hours_raw COMMENT 'Best-effort raw substring of the hours text from description via case-insensitive regexp (opening-hours block or Mon..HH:MM window); NULL when no match. Filled for 1,548 rows. Feeds opd_hours_final.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN desc_accreditation_signal COMMENT 'TRUE if lower(description) RLIKE ''nabh|nabl|jci|iso 9001|accredit''. TRUE for 407 rows.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN desc_mentions_24x7 COMMENT 'TRUE if lower(description) RLIKE ''24x7|24/7|round-the-clock|round the clock''. TRUE for 274 rows.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN ownership_sector_final COMMENT 'Governed ownership sector (WS-7+14): reconciles operator_type (structured, ~93% filled) with description/name text evidence. ''government_public'' when operator_type IN (public,government) or text=government; ''trust_charitable'' when text=trust_charitable; ''private'' when operator_type=private or text=private; else NULL. Primary ownership field (ownership_clean and ownership_sector are the underlying components).';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN ownership_sector_final_source COMMENT 'Provenance for ownership_sector_final: ''operator_type'', ''description_text'', ''operator_type+description'', or NULL when unclassified.';

-- ============================ WS-9 derived cross-workstream fields ============================
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN emergency_readiness_score COMMENT '0..1 = round(N/6, 3) where N = has_emergency + has_icu + has_blood_bank + has_ventilator + has_ot + is_24x7_emergency (each coalesced to 0/1).';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN emergency_readiness_tier COMMENT 'Tier on N/6 (same numerator as emergency_readiness_score): high (>=0.6), medium (>=0.3), else low.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN needs_outreach COMMENT 'TRUE when coalesce(freshness_tier,''unknown'')=''stale'' OR coalesce(contact_verification_status,''unverified'')=''unverified''.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN is_digitally_active COMMENT 'TRUE when digital_presence_score >= 0.5 AND social_post_date is within 365 days before the 2025-12-21 scrape anchor (active social presence in the last year). Returns FALSE (not NULL) when social_post_date is missing.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN needs_verification COMMENT 'TRUE when coalesce(bed_count_confidence,''low'') <> ''high'' OR coalesce(contact_verification_status,''unverified'')=''unverified'' OR coalesce(freshness_tier,''unknown'') IN (''stale'',''unknown''). Flags facts the frontend should badge as inferred/unverified.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN is_contactable_direct COMMENT 'TRUE when email_final IS NOT NULL OR phone_final IS NOT NULL. Direct (phone/email) reachability; distinct from is_contactable which also counts website/Facebook channels.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN year_established_final COMMENT 'Best founding year = coalesce(year_established (from yearEstablished field, clamped 1800..2026), desc_founding_year (mined from description text)). NULL when neither available.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN year_established_source COMMENT 'Provenance of year_established_final: ''yearEstablished_field'' when year_established present, else ''description_text'' when desc_founding_year present, else NULL.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN opd_hours_final COMMENT 'Best operating-hours text = coalesce(opd_hours_raw (OPD snippet from blob), desc_opening_hours_raw (hours substring mined from description)). The WS-2 operating-hours answer; NULL when neither source matched.';
ALTER TABLE workspace.virtue_foundation_enriched.facilities_gold ALTER COLUMN has_operating_hours COMMENT 'TRUE when an operating-hours signal exists: opd_hours_final IS NOT NULL, OR description has an opening-hours mention (desc_has_opening_hours, e.g. ''open 24'' with no extractable snippet), OR the availability WS-2 hours_signal_present flag is set.';
