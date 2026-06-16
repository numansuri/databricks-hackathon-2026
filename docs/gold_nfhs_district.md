# gold_nfhs_district

**FQN:** `workspace.virtue_foundation_enriched.gold_nfhs_district` · **Grain:** 1 row per district · **Rows:** 706 · **Cols:** 117 (4 keys + 3 survey counts + 100 cleaned indicators + 4 derived* + 6 needs/persona) · **Format:** Delta

\* The "107 indicators" headline counts the 3 survey-size counts (`households_surveyed`, `women_15_49_interviewed`, `men_15_54_interviewed`) and the 4 NFHS context columns alongside the 100 percent/ratio/INR indicators; all 107 are cleaned NFHS-5 source fields.

## What it is

The denormalized district profile of cleaned NFHS-5 (National Family Health Survey, round 5, 2019-21) health indicators — one wide row for each of India's 706 surveyed districts. It carries 107 numeric NFHS indicators (demographics through NCDs and cancer screening) that were string-typed and suppression-marked in the read-only source, cleaned to proper numeric types here. Folded onto each row are 6 needs/persona columns that summarize which health gaps the district triggers. This is the **demand side** of the supply-need model: `gold_nfhs_district` describes what districts need; the `facilities_*` / `fct_facility_specialty` tables describe what supply exists, and `gold_demand_supply_gap` joins them.

## Keys & survey context

| column | type | notes |
|---|---|---|
| `state_ut_norm` | string | Normalized state/UT name; part of the composite key. 35 distinct. Normalizations applied: source `Maharastra` → **Maharashtra**; `Lakshadweep` standardized. |
| `district_name_norm` | string | Normalized district name; **composite key is `(district_name_norm, state_ut_norm)`** (690 distinct district names, deduped within state). |
| `state_ut_raw` | string | Original state/UT string as it appeared in the source survey table. |
| `district_name_raw` | string | Original district string (may carry trailing whitespace / spelling variants, e.g. `Bahraich `). Keep for traceability and join-back to source. |
| `households_surveyed` | bigint | Households interviewed in the district (sample size; min 213, max 990, avg ~900). |
| `women_15_49_interviewed` | bigint | Women 15-49 interviewed (avg ~1024). |
| `men_15_54_interviewed` | bigint | Men 15-54 interviewed (avg ~144; thinner sample → men's indicators are noisier per district). |

The three counts are sample sizes, not population — NFHS has no absolute district population, so all demand is prevalence-scaled, not headcount.

## Health indicators (107)

Direction key: **B** = higher is better, **W** = higher is worse, **N** = neutral/context. All `_pct` are percentages (0-100), `_inr` is rupees, ratios are females per 1000 males. Six columns are flagged `high_suppression_unreliable` (low parseable coverage) — listed at the end of this section and **excluded from need triggering by design**.

### Demographics & registration (9)
| clean_name | dir | description |
|---|:--:|---|
| `households_surveyed` | N | Households interviewed (sample size). |
| `women_15_49_interviewed` | N | Women 15-49 interviewed (sample size). |
| `men_15_54_interviewed` | N | Men 15-54 interviewed (sample size). |
| `female_ever_schooled_pct` | B | Women who ever attended school. |
| `population_under_15_pct` | N | Share of population under age 15 (age structure). |
| `sex_ratio_total_f_per_1000_m` | N | Total sex ratio (females per 1000 males). |
| `sex_ratio_at_birth_f_per_1000_m` | B | Sex ratio at birth (last 5 years). |
| `child_u5_birth_registered_pct` | B | Children under 5 whose birth was registered. |
| `deaths_3y_registered_pct` | B | Deaths in last 3 years registered (civil registration completeness). |

### Household & WASH / environment (6)
| clean_name | dir | description |
|---|:--:|---|
| `hh_electricity_pct` | B | Households with electricity. |
| `hh_improved_water_pct` | B | Households with an improved drinking-water source. |
| `hh_improved_sanitation_pct` | B | Households using improved (not shared) sanitation. |
| `hh_clean_cooking_fuel_pct` | B | Households using clean cooking fuel (household air pollution proxy). |
| `hh_iodized_salt_pct` | B | Households with iodized salt (≥15 ppm). |
| `hh_any_health_insurance_pct` | B | Households with any member covered by health insurance/financing scheme. |

### Education, marriage & adolescent (7)
| clean_name | dir | description |
|---|:--:|---|
| `child_u5_attended_pre_primary_pct` | B | Children under 5 who attended pre-primary school. |
| `women_15_49_literate_pct` | B | Literate women 15-49. |
| `women_15_49_schooling_10yr_plus_pct` | B | Women 15-49 with 10+ years of schooling. |
| `women_20_24_married_before_18_pct` | W | Women 20-24 married before age 18 (child marriage). |
| `births_birth_order_3plus_pct` | N | Births of order 3+ (parity context). |
| `women_15_19_mothers_or_pregnant_pct` | W | Women 15-19 already mothers or pregnant (adolescent childbearing). |
| `women_15_24_use_menstrual_hygiene_pct` | B | Women 15-24 using hygienic menstrual protection. |

### Family planning (12)
| clean_name | dir | description |
|---|:--:|---|
| `fp_any_method_pct` | B | Current use of any contraceptive method. |
| `fp_modern_method_pct` | B | Current use of any modern method (mCPR). |
| `fp_female_sterilization_pct` | N | Female sterilization share. |
| `fp_male_sterilization_pct` | N | Male sterilization share. |
| `fp_iud_pct` | N | IUD/PPIUD use. |
| `fp_pill_pct` | N | Oral pill use. |
| `fp_condom_pct` | N | Condom use. |
| `fp_injectables_pct` | N | Injectable use. |
| `fp_unmet_need_total_pct` | W | Total unmet need for family planning. |
| `fp_unmet_need_spacing_pct` | W | Unmet need for spacing. |
| `fp_hw_counselled_nonusers_pct` | B | Non-users counselled on FP by a health worker (demand generation). |
| `fp_users_told_side_effects_pct` | B | Users told about method side effects (quality of care). |

### Maternal & antenatal (8)
| clean_name | dir | description |
|---|:--:|---|
| `anc_first_trimester_pct` | B | ANC in the first trimester (<12 weeks). |
| `anc_4plus_visits_pct` | B | Mothers with 4+ antenatal visits. |
| `neonatal_tetanus_protection_pct` | B | Mothers with neonatal-tetanus protection (TT/Td). |
| `ifa_100days_plus_pct` | B | Pregnant women who took IFA 100+ days. |
| `ifa_180days_plus_pct` | B | Pregnant women who took IFA 180+ days. |
| `mcp_card_received_pct` | B | Pregnant women who received a Mother & Child Protection card. |
| `pnc_skilled_provider_pct` | B | Mothers with postnatal check by a skilled provider within 2 days. |
| `oop_expenditure_per_delivery_public_inr` | W | Mean out-of-pocket expenditure per delivery in a public facility (₹). |

### Delivery care (9)
| clean_name | dir | description |
|---|:--:|---|
| `home_birth_taken_to_facility_pct` | B | Home-born newborns taken to a facility (post-birth linkage). **Unreliable.** |
| `newborn_pnc_skilled_provider_pct` | B | Newborn postnatal check by a skilled provider within 2 days. |
| `institutional_birth_pct` | B | Births in an institution. |
| `institutional_birth_public_facility_pct` | N | Births in a public-sector institution. |
| `home_birth_skilled_attendant_pct` | N | Home births with a skilled attendant (interpret with institutional share). |
| `births_skilled_attendant_pct` | B | Births assisted by a skilled provider (SBA). |
| `csection_birth_pct` | N | C-section deliveries (two-tailed: under-access vs over-use). |
| `csection_private_facility_pct` | N | C-section share in private facilities (some suppression). |
| `csection_public_facility_pct` | N | C-section share in public facilities. |

### Child immunization (12)
| clean_name | dir | description |
|---|:--:|---|
| `child_12_23m_fully_vaccinated_card_or_recall_pct` | B | Fully vaccinated 12-23m (card or recall). |
| `child_12_23m_fully_vaccinated_vax_card_pct` | B | Fully vaccinated 12-23m (card-documented). |
| `child_12_23m_bcg_pct` | B | BCG coverage 12-23m. |
| `child_12_23m_polio3_pct` | B | Polio-3/OPV3 coverage 12-23m. |
| `child_12_23m_penta_or_dpt3_pct` | B | Penta-3/DPT-3 coverage 12-23m (system tracer). |
| `child_12_23m_mcv1_pct` | B | MCV-1 (measles dose 1) coverage 12-23m. |
| `child_24_35m_mcv2_pct` | B | MCV-2 (measles dose 2) coverage 24-35m. |
| `child_12_23m_rotavirus3_pct` | B | Rotavirus-3 coverage 12-23m (phased rollout). |
| `child_12_23m_penta_or_hepb3_pct` | B | HepB-3 coverage 12-23m. |
| `child_9_35m_vitamin_a_last_6m_pct` | B | Vitamin A dose in last 6 months, 9-35m. |
| `child_12_23m_vax_mostly_public_facility_pct` | N | Vaccinations mostly at a public facility. |
| `child_12_23m_vax_mostly_private_facility_pct` | N | Vaccinations mostly at a private facility. |

### Child illness care (6)
| clean_name | dir | description |
|---|:--:|---|
| `diarrhoea_prev_u5_pct` | W | 2-week diarrhoea prevalence under 5 (morbidity burden). |
| `diarrhoea_ors_received_pct` | B | Diarrhoea cases given ORS. **Unreliable.** |
| `diarrhoea_zinc_received_pct` | B | Diarrhoea cases given zinc. **Unreliable.** |
| `diarrhoea_care_seeking_pct` | B | Care sought for diarrhoea. **Unreliable.** |
| `ari_prev_u5_pct` | W | 2-week ARI/fever prevalence under 5 (morbidity burden). |
| `fever_ari_care_seeking_pct` | B | Care sought for fever/ARI (some suppression). |

### Infant & young child feeding (6)
| clean_name | dir | description |
|---|:--:|---|
| `early_breastfeeding_initiation_pct` | B | Breastfeeding initiated within 1 hour of birth. |
| `exclusive_breastfeeding_u6m_pct` | B | Exclusive breastfeeding under 6 months (some suppression). |
| `complementary_feeding_intro_6_8m_pct` | B | Timely complementary feeding at 6-8m. **Unreliable.** |
| `breastfeeding_6_23m_adequate_diet_pct` | B | Breastfed 6-23m with a minimum adequate diet. |
| `non_breastfeeding_6_23m_adequate_diet_pct` | B | Non-breastfed 6-23m with a minimum adequate diet. **Unreliable.** |
| `total_6_23m_adequate_diet_pct` | B | All 6-23m with a minimum adequate diet. |

### Child nutrition / anthropometry (5)
| clean_name | dir | description |
|---|:--:|---|
| `child_u5_stunted_pct` | W | Under-5 stunted (height-for-age). |
| `child_u5_wasted_pct` | W | Under-5 wasted (weight-for-height). |
| `child_u5_severe_wasted_pct` | W | Under-5 severely wasted. |
| `child_u5_underweight_pct` | W | Under-5 underweight (weight-for-age). |
| `child_u5_overweight_pct` | W | Under-5 overweight (emerging double burden). |

### Adult nutrition & anaemia (8)
| clean_name | dir | description |
|---|:--:|---|
| `women_underweight_bmi_lt185_pct` | W | Women 15-49 underweight (BMI <18.5). |
| `women_overweight_obese_bmi_gte25_pct` | W | Women 15-49 overweight/obese (BMI ≥25). |
| `women_high_risk_whr_gte085_pct` | W | Women 15-49 with high-risk waist-hip ratio (≥0.85). |
| `child_6_59m_anaemic_pct` | W | Children 6-59m anaemic. |
| `nonpregnant_women_anaemic_pct` | W | Non-pregnant women 15-49 anaemic. |
| `pregnant_women_anaemic_pct` | W | Pregnant women anaemic (some suppression). |
| `all_women_15_49_anaemic_pct` | W | All women 15-49 anaemic. |
| `adolescent_girls_15_19_anaemic_pct` | W | Adolescent girls 15-19 anaemic. |

### NCDs — diabetes & hypertension (12)
| clean_name | dir | description |
|---|:--:|---|
| `women_15plus_high_blood_sugar_pct` | W | Women 15+ with high blood sugar (141-160 mg/dL). |
| `women_15plus_very_high_blood_sugar_pct` | W | Women 15+ with very high blood sugar (>160 mg/dL). |
| `women_15plus_high_blood_sugar_or_meds_pct` | W | Women 15+ high blood sugar or on diabetes medication. |
| `men_15plus_high_blood_sugar_pct` | W | Men 15+ with high blood sugar. |
| `men_15plus_very_high_blood_sugar_pct` | W | Men 15+ with very high blood sugar. |
| `men_15plus_high_blood_sugar_or_meds_pct` | W | Men 15+ high blood sugar or on diabetes medication. |
| `women_15plus_mildly_high_bp_pct` | W | Women 15+ mildly high BP (stage-1). |
| `women_15plus_moderate_severe_high_bp_pct` | W | Women 15+ moderate/severe high BP (stage 2-3). |
| `women_15plus_high_bp_or_meds_pct` | W | Women 15+ high BP or on BP medication. |
| `men_15plus_mildly_high_bp_pct` | W | Men 15+ mildly high BP (stage-1). |
| `men_15plus_moderate_severe_high_bp_pct` | W | Men 15+ moderate/severe high BP (stage 2-3). |
| `men_15plus_high_bp_or_meds_pct` | W | Men 15+ high BP or on BP medication. |

### Cancer screening & risk behaviours (7)
| clean_name | dir | description |
|---|:--:|---|
| `women_30_49_cervical_screen_pct` | B | Women 30-49 ever screened for cervical cancer (nationally ~1.6%). |
| `women_30_49_breast_exam_pct` | B | Women 30-49 ever had a breast exam. |
| `women_30_49_oral_cancer_exam_pct` | B | Women 30-49 ever had an oral cancer exam. |
| `women_15plus_tobacco_use_pct` | W | Women 15+ who use any tobacco. |
| `men_15plus_tobacco_use_pct` | W | Men 15+ who use any tobacco (nationally ~41%). |
| `women_15plus_alcohol_use_pct` | W | Women 15+ who use alcohol. |
| `men_15plus_alcohol_use_pct` | W | Men 15+ who use alcohol. |

### The 6 unreliable indicators (excluded from needs)
`home_birth_taken_to_facility_pct` (~40% usable), `diarrhoea_ors_received_pct`, `diarrhoea_zinc_received_pct`, `diarrhoea_care_seeking_pct` (each ~30% usable), `complementary_feeding_intro_6_8m_pct`, `non_breastfeeding_6_23m_adequate_diet_pct` (each ~9% usable). These carry the `high_suppression_unreliable` flag in `dim_nfhs_indicator`; they remain in the table for completeness but never drive a need.

## Needs & persona columns (6)

These fold the district's need profile (computed in `gold_district_need_flags` / `gold_district_needs`) onto this wide row. Needs fire from a **hybrid trigger**: an absolute clinical/policy threshold (where a recognized WHO/India standard exists) OR a direction-aware worst-national-quartile fallback across the 706 districts. See `spec/need-taxonomy.md` for the 28 categories and their thresholds.

| column | type | how it's derived |
|---|---|---|
| `needs` | `ARRAY<STRUCT<segment, category, severity, score, affected_share_pct>>` | One element per triggered (need_category × segment). `category` is one of the 28 need taxonomy categories; `segment` is the affected population (e.g. `infants_u2`, `women_15_49`); `severity` ∈ {high, med}; `score` is the severity weight; `affected_share_pct` is the worst prevalence among percent-unit higher-is-worse drivers of that need (null for needs with no such driver, e.g. coverage-gap immunization). |
| `persona_label` | string | District archetype from its dominant need mix — one of 5 values: `child_health_nutrition_hotspot`, `ncd_rising`, `mixed_need_profile`, and the two ordered composites `child_health_nutrition_hotspot+ncd_rising` / `ncd_rising+child_health_nutrition_hotspot` (the `+` denotes a blended profile, leading term dominant). |
| `n_needs` | int | Count of distinct triggered needs (min 17, max 38, avg ~29). |
| `n_high_needs` | int | Count of needs at `severity = high` (min 7, max 33, avg ~18). |
| `total_need_score` | int | Sum of `score` over all triggered needs (min 42, max 131, avg ~85) — a single demand-intensity ranking number. |
| `top_need_categories` | `ARRAY<STRING>` | Highest-scoring need categories for the district, ordered, for quick scanning. |

## How it's built

Built from the read-only source `nfhs_5_district_health_indicators` (a Delta Share). Every indicator column is cleaned with one universal recipe — `CAST(NULLIF(regexp_replace(trim(CAST(c AS STRING)), '[()]', ''), '*') AS DOUBLE)` — which strips whitespace, removes the `( )` wrappers NFHS puts around small-base estimates, maps the `*` suppression marker to NULL, and casts to numeric. Keys are normalized (`Maharastra`→`Maharashtra`, etc.) and deduped to the composite `(district_name_norm, state_ut_norm)`. The 6 needs/persona columns are then joined on in a denormalize pass from `gold_district_needs`. Build SQL: `docs/sql/gold_nfhs_district.sql` (clean recipe) and `docs/sql/gold_nfhs_district_denormalize.sql` (needs fold-in).

## Caveats

- **Suppression markers.** Source cells of `*` (suppressed small base) and `(x)` / parenthesized values (small-base estimate) are handled by the clean recipe: `*` → NULL, parentheses stripped. NULL counts vary by column (e.g. `home_birth_taken_to_facility_pct` is 422/706 NULL).
- **6 unreliable indicators** (above) are excluded from need triggering by design — use them descriptively only.
- **Prevalence, not headcount.** NFHS has no absolute district population, so `affected_share_pct` and all downstream demand are prevalence-scaled shares, not counts.
- **Key normalization.** Always join on the composite `(district_name_norm, state_ut_norm)`; use `*_raw` only for traceback to source. District-name drift vs facility/postal data is handled separately by `dim_district_crosswalk`.
- **Thin male sample.** `men_15_54_interviewed` averages ~144 per district, so men's NCD/tobacco/alcohol indicators are noisier at the district level than women's.

## Sample

One real high-need district row (key fields + persona + top needs):

| field | value |
|---|---|
| `state_ut_norm` / `district_name_norm` | Uttar Pradesh / Bahraich |
| `district_name_raw` | `Bahraich ` (trailing space) |
| `households_surveyed` / `women_15_49_interviewed` / `men_15_54_interviewed` | 956 / 1128 / 129 |
| `persona_label` | `child_health_nutrition_hotspot` |
| `n_needs` / `n_high_needs` / `total_need_score` | 35 / 31 / 124 |
| `top_need_categories` | `["child_immunization","child_malnutrition","family_planning_unmet","antenatal_care","cancer_screening"]` |
| top `needs[]` element | `{segment: infants_u2, category: child_immunization, severity: high, score: 16, affected_share_pct: null}` |
| next `needs[]` element | `{segment: children_u5, category: child_malnutrition, severity: high, score: 9, affected_share_pct: 52.1}` |
