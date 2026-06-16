-- gold_district_need_flags
-- One row per (district_name_norm, state_ut_norm, need_category, segment).
-- Pipeline:
--   1) long-unpivot gold_nfhs_district (107 indicator cols) via stack()
--   2) join dim_nfhs_indicator on indicator_key; keep need_category<>'none'
--      AND reliability_flag<>'high_suppression_unreliable' AND value IS NOT NULL
--   3) national quartiles p25/p50/p75 per indicator_key (over non-null values)
--   4) rel_sev / abs_sev / severity = max(abs_sev, rel_sev) [high>med>none];
--      low_confidence = reliability_flag='some_suppression'
--   5) keep severity in (high,med); roll up per (district, need_category, segment)
CREATE OR REPLACE TABLE workspace.virtue_foundation_enriched.gold_district_need_flags AS
WITH long AS (
  SELECT
    district_name_norm,
    state_ut_norm,
    indicator_key,
    value
  FROM workspace.virtue_foundation_enriched.gold_nfhs_district
  LATERAL VIEW stack(
    107,
    'households_surveyed', CAST(households_surveyed AS DOUBLE), 'women_15_49_interviewed', CAST(women_15_49_interviewed AS DOUBLE), 'men_15_54_interviewed', CAST(men_15_54_interviewed AS DOUBLE), 'female_ever_schooled_pct', CAST(female_ever_schooled_pct AS DOUBLE), 'population_under_15_pct', CAST(population_under_15_pct AS DOUBLE), 'sex_ratio_total_f_per_1000_m', CAST(sex_ratio_total_f_per_1000_m AS DOUBLE), 'sex_ratio_at_birth_f_per_1000_m', CAST(sex_ratio_at_birth_f_per_1000_m AS DOUBLE), 'child_u5_birth_registered_pct', CAST(child_u5_birth_registered_pct AS DOUBLE), 'deaths_3y_registered_pct', CAST(deaths_3y_registered_pct AS DOUBLE), 'hh_electricity_pct', CAST(hh_electricity_pct AS DOUBLE), 'hh_improved_water_pct', CAST(hh_improved_water_pct AS DOUBLE), 'hh_improved_sanitation_pct', CAST(hh_improved_sanitation_pct AS DOUBLE), 'hh_clean_cooking_fuel_pct', CAST(hh_clean_cooking_fuel_pct AS DOUBLE), 'hh_iodized_salt_pct', CAST(hh_iodized_salt_pct AS DOUBLE), 'hh_any_health_insurance_pct', CAST(hh_any_health_insurance_pct AS DOUBLE), 'child_u5_attended_pre_primary_pct', CAST(child_u5_attended_pre_primary_pct AS DOUBLE), 'women_15_49_literate_pct', CAST(women_15_49_literate_pct AS DOUBLE), 'women_15_49_schooling_10yr_plus_pct', CAST(women_15_49_schooling_10yr_plus_pct AS DOUBLE), 'women_20_24_married_before_18_pct', CAST(women_20_24_married_before_18_pct AS DOUBLE), 'births_birth_order_3plus_pct', CAST(births_birth_order_3plus_pct AS DOUBLE), 'women_15_19_mothers_or_pregnant_pct', CAST(women_15_19_mothers_or_pregnant_pct AS DOUBLE), 'women_15_24_use_menstrual_hygiene_pct', CAST(women_15_24_use_menstrual_hygiene_pct AS DOUBLE), 'fp_any_method_pct', CAST(fp_any_method_pct AS DOUBLE), 'fp_modern_method_pct', CAST(fp_modern_method_pct AS DOUBLE), 'fp_female_sterilization_pct', CAST(fp_female_sterilization_pct AS DOUBLE), 'fp_male_sterilization_pct', CAST(fp_male_sterilization_pct AS DOUBLE), 'fp_iud_pct', CAST(fp_iud_pct AS DOUBLE), 'fp_pill_pct', CAST(fp_pill_pct AS DOUBLE), 'fp_condom_pct', CAST(fp_condom_pct AS DOUBLE), 'fp_injectables_pct', CAST(fp_injectables_pct AS DOUBLE), 'fp_unmet_need_total_pct', CAST(fp_unmet_need_total_pct AS DOUBLE), 'fp_unmet_need_spacing_pct', CAST(fp_unmet_need_spacing_pct AS DOUBLE), 'fp_hw_counselled_nonusers_pct', CAST(fp_hw_counselled_nonusers_pct AS DOUBLE), 'fp_users_told_side_effects_pct', CAST(fp_users_told_side_effects_pct AS DOUBLE), 'anc_first_trimester_pct', CAST(anc_first_trimester_pct AS DOUBLE), 'anc_4plus_visits_pct', CAST(anc_4plus_visits_pct AS DOUBLE), 'neonatal_tetanus_protection_pct', CAST(neonatal_tetanus_protection_pct AS DOUBLE), 'ifa_100days_plus_pct', CAST(ifa_100days_plus_pct AS DOUBLE), 'ifa_180days_plus_pct', CAST(ifa_180days_plus_pct AS DOUBLE), 'mcp_card_received_pct', CAST(mcp_card_received_pct AS DOUBLE), 'pnc_skilled_provider_pct', CAST(pnc_skilled_provider_pct AS DOUBLE), 'oop_expenditure_per_delivery_public_inr', CAST(oop_expenditure_per_delivery_public_inr AS DOUBLE), 'home_birth_taken_to_facility_pct', CAST(home_birth_taken_to_facility_pct AS DOUBLE), 'newborn_pnc_skilled_provider_pct', CAST(newborn_pnc_skilled_provider_pct AS DOUBLE), 'institutional_birth_pct', CAST(institutional_birth_pct AS DOUBLE), 'institutional_birth_public_facility_pct', CAST(institutional_birth_public_facility_pct AS DOUBLE), 'home_birth_skilled_attendant_pct', CAST(home_birth_skilled_attendant_pct AS DOUBLE), 'births_skilled_attendant_pct', CAST(births_skilled_attendant_pct AS DOUBLE), 'csection_birth_pct', CAST(csection_birth_pct AS DOUBLE), 'csection_private_facility_pct', CAST(csection_private_facility_pct AS DOUBLE), 'csection_public_facility_pct', CAST(csection_public_facility_pct AS DOUBLE), 'child_12_23m_fully_vaccinated_card_or_recall_pct', CAST(child_12_23m_fully_vaccinated_card_or_recall_pct AS DOUBLE), 'child_12_23m_fully_vaccinated_vax_card_pct', CAST(child_12_23m_fully_vaccinated_vax_card_pct AS DOUBLE), 'child_12_23m_bcg_pct', CAST(child_12_23m_bcg_pct AS DOUBLE), 'child_12_23m_polio3_pct', CAST(child_12_23m_polio3_pct AS DOUBLE), 'child_12_23m_penta_or_dpt3_pct', CAST(child_12_23m_penta_or_dpt3_pct AS DOUBLE), 'child_12_23m_mcv1_pct', CAST(child_12_23m_mcv1_pct AS DOUBLE), 'child_24_35m_mcv2_pct', CAST(child_24_35m_mcv2_pct AS DOUBLE), 'child_12_23m_rotavirus3_pct', CAST(child_12_23m_rotavirus3_pct AS DOUBLE), 'child_12_23m_penta_or_hepb3_pct', CAST(child_12_23m_penta_or_hepb3_pct AS DOUBLE), 'child_9_35m_vitamin_a_last_6m_pct', CAST(child_9_35m_vitamin_a_last_6m_pct AS DOUBLE), 'child_12_23m_vax_mostly_public_facility_pct', CAST(child_12_23m_vax_mostly_public_facility_pct AS DOUBLE), 'child_12_23m_vax_mostly_private_facility_pct', CAST(child_12_23m_vax_mostly_private_facility_pct AS DOUBLE), 'diarrhoea_prev_u5_pct', CAST(diarrhoea_prev_u5_pct AS DOUBLE), 'diarrhoea_ors_received_pct', CAST(diarrhoea_ors_received_pct AS DOUBLE), 'diarrhoea_zinc_received_pct', CAST(diarrhoea_zinc_received_pct AS DOUBLE), 'diarrhoea_care_seeking_pct', CAST(diarrhoea_care_seeking_pct AS DOUBLE), 'ari_prev_u5_pct', CAST(ari_prev_u5_pct AS DOUBLE), 'fever_ari_care_seeking_pct', CAST(fever_ari_care_seeking_pct AS DOUBLE), 'early_breastfeeding_initiation_pct', CAST(early_breastfeeding_initiation_pct AS DOUBLE), 'exclusive_breastfeeding_u6m_pct', CAST(exclusive_breastfeeding_u6m_pct AS DOUBLE), 'complementary_feeding_intro_6_8m_pct', CAST(complementary_feeding_intro_6_8m_pct AS DOUBLE), 'breastfeeding_6_23m_adequate_diet_pct', CAST(breastfeeding_6_23m_adequate_diet_pct AS DOUBLE), 'non_breastfeeding_6_23m_adequate_diet_pct', CAST(non_breastfeeding_6_23m_adequate_diet_pct AS DOUBLE), 'total_6_23m_adequate_diet_pct', CAST(total_6_23m_adequate_diet_pct AS DOUBLE), 'child_u5_stunted_pct', CAST(child_u5_stunted_pct AS DOUBLE), 'child_u5_wasted_pct', CAST(child_u5_wasted_pct AS DOUBLE), 'child_u5_severe_wasted_pct', CAST(child_u5_severe_wasted_pct AS DOUBLE), 'child_u5_underweight_pct', CAST(child_u5_underweight_pct AS DOUBLE), 'child_u5_overweight_pct', CAST(child_u5_overweight_pct AS DOUBLE), 'women_underweight_bmi_lt185_pct', CAST(women_underweight_bmi_lt185_pct AS DOUBLE), 'women_overweight_obese_bmi_gte25_pct', CAST(women_overweight_obese_bmi_gte25_pct AS DOUBLE), 'women_high_risk_whr_gte085_pct', CAST(women_high_risk_whr_gte085_pct AS DOUBLE), 'child_6_59m_anaemic_pct', CAST(child_6_59m_anaemic_pct AS DOUBLE), 'nonpregnant_women_anaemic_pct', CAST(nonpregnant_women_anaemic_pct AS DOUBLE), 'pregnant_women_anaemic_pct', CAST(pregnant_women_anaemic_pct AS DOUBLE), 'all_women_15_49_anaemic_pct', CAST(all_women_15_49_anaemic_pct AS DOUBLE), 'adolescent_girls_15_19_anaemic_pct', CAST(adolescent_girls_15_19_anaemic_pct AS DOUBLE), 'women_15plus_high_blood_sugar_pct', CAST(women_15plus_high_blood_sugar_pct AS DOUBLE), 'women_15plus_very_high_blood_sugar_pct', CAST(women_15plus_very_high_blood_sugar_pct AS DOUBLE), 'women_15plus_high_blood_sugar_or_meds_pct', CAST(women_15plus_high_blood_sugar_or_meds_pct AS DOUBLE), 'men_15plus_high_blood_sugar_pct', CAST(men_15plus_high_blood_sugar_pct AS DOUBLE), 'men_15plus_very_high_blood_sugar_pct', CAST(men_15plus_very_high_blood_sugar_pct AS DOUBLE), 'men_15plus_high_blood_sugar_or_meds_pct', CAST(men_15plus_high_blood_sugar_or_meds_pct AS DOUBLE), 'women_15plus_mildly_high_bp_pct', CAST(women_15plus_mildly_high_bp_pct AS DOUBLE), 'women_15plus_moderate_severe_high_bp_pct', CAST(women_15plus_moderate_severe_high_bp_pct AS DOUBLE), 'women_15plus_high_bp_or_meds_pct', CAST(women_15plus_high_bp_or_meds_pct AS DOUBLE), 'men_15plus_mildly_high_bp_pct', CAST(men_15plus_mildly_high_bp_pct AS DOUBLE), 'men_15plus_moderate_severe_high_bp_pct', CAST(men_15plus_moderate_severe_high_bp_pct AS DOUBLE), 'men_15plus_high_bp_or_meds_pct', CAST(men_15plus_high_bp_or_meds_pct AS DOUBLE), 'women_30_49_cervical_screen_pct', CAST(women_30_49_cervical_screen_pct AS DOUBLE), 'women_30_49_breast_exam_pct', CAST(women_30_49_breast_exam_pct AS DOUBLE), 'women_30_49_oral_cancer_exam_pct', CAST(women_30_49_oral_cancer_exam_pct AS DOUBLE), 'women_15plus_tobacco_use_pct', CAST(women_15plus_tobacco_use_pct AS DOUBLE), 'men_15plus_tobacco_use_pct', CAST(men_15plus_tobacco_use_pct AS DOUBLE), 'women_15plus_alcohol_use_pct', CAST(women_15plus_alcohol_use_pct AS DOUBLE), 'men_15plus_alcohol_use_pct', CAST(men_15plus_alcohol_use_pct AS DOUBLE)
  ) AS indicator_key, value
),
joined AS (
  SELECT
    l.district_name_norm,
    l.state_ut_norm,
    l.indicator_key,
    l.value,
    d.direction,
    d.need_category,
    d.segment,
    d.reliability_flag,
    d.abs_comparator,
    CAST(d.abs_high_cutoff AS DOUBLE) AS abs_high_cutoff,
    CAST(d.abs_med_cutoff  AS DOUBLE) AS abs_med_cutoff,
    d.unit
  FROM long l
  JOIN workspace.virtue_foundation_enriched.dim_nfhs_indicator d
    ON l.indicator_key = d.indicator_key
  WHERE d.need_category <> 'none'
    AND d.reliability_flag <> 'high_suppression_unreliable'
    AND l.value IS NOT NULL
),
quart AS (
  SELECT
    j.*,
    percentile(value, 0.25) OVER (PARTITION BY indicator_key) AS p25,
    percentile(value, 0.50) OVER (PARTITION BY indicator_key) AS p50,
    percentile(value, 0.75) OVER (PARTITION BY indicator_key) AS p75
  FROM joined j
),
scored AS (
  SELECT
    district_name_norm,
    state_ut_norm,
    indicator_key,
    value,
    direction,
    need_category,
    segment,
    reliability_flag,
    unit,
    -- relative severity
    CASE
      WHEN direction = 'higher_is_worse' THEN
        CASE WHEN value >= p75 THEN 'high' WHEN value >= p50 THEN 'med' ELSE 'none' END
      WHEN direction = 'higher_is_better' THEN
        CASE WHEN value <= p25 THEN 'high' WHEN value <= p50 THEN 'med' ELSE 'none' END
      ELSE 'none'
    END AS rel_sev,
    -- absolute severity
    CASE
      WHEN abs_comparator = '>=' THEN
        CASE WHEN abs_high_cutoff IS NOT NULL AND value >= abs_high_cutoff THEN 'high'
             WHEN abs_med_cutoff  IS NOT NULL AND value >= abs_med_cutoff  THEN 'med'
             ELSE 'none' END
      WHEN abs_comparator = '<=' THEN
        CASE WHEN abs_high_cutoff IS NOT NULL AND value <= abs_high_cutoff THEN 'high'
             WHEN abs_med_cutoff  IS NOT NULL AND value <= abs_med_cutoff  THEN 'med'
             ELSE 'none' END
      ELSE 'none'
    END AS abs_sev,
    (reliability_flag = 'some_suppression') AS low_confidence
  FROM quart
),
sev AS (
  SELECT
    district_name_norm,
    state_ut_norm,
    indicator_key,
    value,
    direction,
    need_category,
    segment,
    unit,
    low_confidence,
    -- severity = max(abs_sev, rel_sev) with high>med>none
    CASE
      WHEN abs_sev = 'high' OR rel_sev = 'high' THEN 'high'
      WHEN abs_sev = 'med'  OR rel_sev = 'med'  THEN 'med'
      ELSE 'none'
    END AS severity
  FROM scored
),
drivers AS (
  SELECT * FROM sev WHERE severity IN ('high','med')
)
SELECT
  district_name_norm,
  state_ut_norm,
  need_category,
  segment,
  CASE WHEN max(CASE WHEN severity = 'high' THEN 2 ELSE 1 END) = 2 THEN 'high' ELSE 'med' END AS severity,
  2 * count(CASE WHEN severity = 'high' THEN 1 END)
    + 1 * count(CASE WHEN severity = 'med' THEN 1 END) AS score,
  count(*) AS n_drivers_hit,
  bool_and(low_confidence) AS low_confidence,
  max(CASE WHEN direction = 'higher_is_worse' AND unit = 'pct' THEN value END) AS affected_share_pct,
  collect_list(struct(indicator_key, round(value, 1) AS value, severity)) AS evidence
FROM drivers
GROUP BY district_name_norm, state_ut_norm, need_category, segment
