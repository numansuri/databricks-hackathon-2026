// src/specialties.js
// ---------------------------------------------------------------------------
// Single source of truth for the onboarding SpecialtyPicker's specialty
// vocabulary + resolver. Pure ES module, no dependencies, synchronously
// available (inlined — does NOT import public/gold/specialty_aliases.json,
// which may not exist at build time; see onboarding spec §4).
//
// The alias map MERGES three sources so the picker and recommend.py resolve
// IDENTICALLY:
//   (a) recommend.py's SPECIALTY_ALIASES (the recommender's resolver)
//   (b) the onboarding spec's Step-1a alias table (2026-06-15 §Step 1a)
//   (c) obvious synonyms (peds, cardiologist, ob/gyn, …)
//
// resolveSpecialty() implements the onboarding spec §2/§4 status machine:
//   matched   — exact canonical, store immediately (method "select")
//   confirm   — a unique alias hit, ask "we read that as X — correct?" (method "alias")
//   ambiguous — an ambiguous head ("oncology", "maternity", "general physician") —
//               surface a disambiguation list; nothing stored until the doctor picks
//   blocked   — no confident match; raw input is NEVER defaulted to a canonical
//
// IMPORTANT divergence from recommend.py, intentional per onboarding spec:
//   recommend.py maps "physician"/"internal medicine" straight to
//   internal_medicine (it only ranks 17 demand-bearing specialties, so a
//   single best guess is fine there). The PICKER, per the onboarding spec
//   Step-1a table, treats the bare heads "general physician"/"physician"/
//   "general medicine" as AMBIGUOUS (internal_medicine vs family_medicine) and
//   forces the doctor to pick. The ambiguous-head check therefore runs BEFORE
//   the flat alias map, so those heads land on the disambiguation branch even
//   though they also appear in the merged alias map. Unambiguous keys like
//   "internal medicine"/"internist" still resolve directly.
// ---------------------------------------------------------------------------

export const CANONICAL_SPECIALTIES = [
  "addiction_medicine",
  "adolescent_medicine",
  "cardiology",
  "endocrinology_diabetes",
  "family_planning_contraception",
  "gynecologic_oncology",
  "internal_medicine",
  "maternal_child_health",
  "medical_oncology",
  "neonatology",
  "nutrition_dietetics",
  "obstetrics_gynecology",
  "pediatric_emergency_medicine",
  "pediatrics",
  "preventive_medicine",
  "psychiatry",
  "pulmonology",
  "allergy_immunology",
  "andrology_sexual_medicine",
  "anesthesiology",
  "bariatric_metabolic_surgery",
  "breast_surgery",
  "cardiothoracic_surgery",
  "cataract_anterior_segment",
  "child_adolescent_psychiatry",
  "colorectal_surgery",
  "complementary_alternative_medicine",
  "cornea",
  "cosmetic_dentistry",
  "critical_care_medicine",
  "dental_anesthesia_sedation",
  "dental_implantology",
  "dermatology",
  "emergency_medicine",
  "endocrine_surgery",
  "endodontics",
  "endoscopy",
  "eye_trauma_emergency",
  "family_medicine",
  "gastroenterology",
  "general_dentistry",
  "general_surgery",
  "geriatric_medicine",
  "gi_hpb_surgery",
  "glaucoma",
  "hand_surgery",
  "hematology",
  "infectious_diseases",
  "laboratory_medicine",
  "laser_dentistry",
  "maternal_fetal_medicine",
  "medical_genetics",
  "nephrology",
  "neuro_oncology",
  "neuro_ophthalmology",
  "neurology",
  "neurosurgery",
  "nuclear_medicine",
  "occupational_therapy",
  "ocular_oncology",
  "oculoplasty_orbit",
  "ophthalmology",
  "optometry_vision_therapy",
  "oral_maxillofacial_surgery",
  "oral_medicine_pathology",
  "orthodontics",
  "orthopedic_oncology",
  "orthopedic_surgery",
  "otolaryngology",
  "pain_medicine",
  "palliative_medicine",
  "pathology",
  "pediatric_cardiology",
  "pediatric_critical_care",
  "pediatric_dentistry",
  "pediatric_dermatology",
  "pediatric_hematology_oncology",
  "pediatric_neurology",
  "pediatric_neurosurgery",
  "pediatric_orthopedic_surgery",
  "pediatric_otolaryngology",
  "pediatric_strabismus_ophthalmology",
  "pediatric_surgery",
  "pediatric_urology",
  "periodontics",
  "pharmacy",
  "physical_medicine_rehab",
  "physiotherapy",
  "plastic_reconstructive_surgery",
  "podiatry",
  "prosthetics_orthotics_rehab",
  "prosthodontics",
  "psychology",
  "public_health_dentistry",
  "radiation_oncology",
  "radiology",
  "refractive_surgery",
  "reproductive_endocrinology_infertility",
  "retina_vitreoretinal",
  "rheumatology",
  "sleep_medicine",
  "speech_audiology",
  "spine_surgery",
  "sports_medicine",
  "surgical_oncology",
  "transplant_surgery",
  "urogynecology",
  "urology",
  "uveitis",
  "vascular_surgery",
];

// Fail loudly at module load if the canonical list drifts from the contract.
if (CANONICAL_SPECIALTIES.length !== 110) {
  throw new Error(
    `specialties.js: expected exactly 110 canonical specialties, got ${CANONICAL_SPECIALTIES.length}`
  );
}
{
  const dupes = CANONICAL_SPECIALTIES.filter(
    (v, i) => CANONICAL_SPECIALTIES.indexOf(v) !== i
  );
  if (dupes.length) {
    throw new Error(
      `specialties.js: duplicate canonical specialties: ${[...new Set(dupes)].join(", ")}`
    );
  }
}

const CANONICAL_SET = new Set(CANONICAL_SPECIALTIES);

// ---------------------------------------------------------------------------
// Display labels
// ---------------------------------------------------------------------------
// Derive snake_case -> Title Case programmatically; override the handful that
// need ampersands, slashes, parentheticals, or domain casing.
const LABEL_OVERRIDES = {
  obstetrics_gynecology: "Obstetrics & Gynecology",
  endocrinology_diabetes: "Endocrinology & Diabetes",
  otolaryngology: "ENT (Otolaryngology)",
  gi_hpb_surgery: "GI / HPB Surgery",
  oral_medicine_pathology: "Oral Medicine & Pathology",
  family_planning_contraception: "Family Planning & Contraception",
  nutrition_dietetics: "Nutrition & Dietetics",
  physical_medicine_rehab: "Physical Medicine & Rehab",
  prosthetics_orthotics_rehab: "Prosthetics, Orthotics & Rehab",
  speech_audiology: "Speech & Audiology",
  optometry_vision_therapy: "Optometry & Vision Therapy",
  retina_vitreoretinal: "Retina (Vitreoretinal)",
  cataract_anterior_segment: "Cataract & Anterior Segment",
  oculoplasty_orbit: "Oculoplasty & Orbit",
  neuro_ophthalmology: "Neuro-Ophthalmology",
  neuro_oncology: "Neuro-Oncology",
  ocular_oncology: "Ocular Oncology",
  orthopedic_oncology: "Orthopedic Oncology",
  reproductive_endocrinology_infertility:
    "Reproductive Endocrinology & Infertility",
  maternal_fetal_medicine: "Maternal-Fetal Medicine",
  maternal_child_health: "Maternal & Child Health",
  child_adolescent_psychiatry: "Child & Adolescent Psychiatry",
  andrology_sexual_medicine: "Andrology & Sexual Medicine",
  bariatric_metabolic_surgery: "Bariatric & Metabolic Surgery",
  pediatric_strabismus_ophthalmology: "Pediatric & Strabismus Ophthalmology",
  pediatric_hematology_oncology: "Pediatric Hematology-Oncology",
  dental_anesthesia_sedation: "Dental Anesthesia & Sedation",
  complementary_alternative_medicine: "Complementary & Alternative Medicine",
  plastic_reconstructive_surgery: "Plastic & Reconstructive Surgery",
};

function titleCase(canonical) {
  return canonical
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export const SPECIALTY_LABELS = Object.freeze(
  CANONICAL_SPECIALTIES.reduce((acc, c) => {
    acc[c] = LABEL_OVERRIDES[c] || titleCase(c);
    return acc;
  }, {})
);

export function labelFor(canonical) {
  return SPECIALTY_LABELS[canonical] || titleCase(String(canonical || ""));
}

// ---------------------------------------------------------------------------
// Ambiguous heads (onboarding spec §Step 1a) — checked BEFORE the flat alias
// map. Each head maps to an explicit, ordered candidate list; resolveSpecialty
// returns status:"ambiguous" and stores nothing until the doctor picks.
// Keys are lowercased/trimmed; values are validated against CANONICAL_SET below.
// ---------------------------------------------------------------------------
const AMBIGUOUS_HEADS = {
  oncology: [
    "medical_oncology",
    "surgical_oncology",
    "radiation_oncology",
    "gynecologic_oncology",
    "pediatric_hematology_oncology",
    "neuro_oncology",
    "ocular_oncology",
    "orthopedic_oncology",
  ],
  cancer: [
    "medical_oncology",
    "surgical_oncology",
    "radiation_oncology",
    "gynecologic_oncology",
    "pediatric_hematology_oncology",
    "neuro_oncology",
    "ocular_oncology",
    "orthopedic_oncology",
  ],
  maternity: [
    "obstetrics_gynecology",
    "maternal_child_health",
    "maternal_fetal_medicine",
    "family_planning_contraception",
    "urogynecology",
  ],
  "women's health": [
    "obstetrics_gynecology",
    "maternal_child_health",
    "maternal_fetal_medicine",
    "family_planning_contraception",
    "urogynecology",
  ],
  "womens health": [
    "obstetrics_gynecology",
    "maternal_child_health",
    "maternal_fetal_medicine",
    "family_planning_contraception",
    "urogynecology",
  ],
  // The bare "general/physician" heads are ambiguous in the PICKER (must pick
  // internal vs family medicine), even though recommend.py maps "physician" to
  // internal_medicine. Specific keys ("internal medicine", "internist") stay
  // unambiguous in SPECIALTY_ALIASES below.
  "general physician": ["internal_medicine", "family_medicine"],
  physician: ["internal_medicine", "family_medicine"],
  "general medicine": ["internal_medicine", "family_medicine"],
  "general practitioner": ["internal_medicine", "family_medicine"],
  gp: ["internal_medicine", "family_medicine"],
};

// ---------------------------------------------------------------------------
// Unambiguous alias -> canonical. Merge of recommend.py SPECIALTY_ALIASES,
// the onboarding Step-1a unambiguous columns, and obvious synonyms.
// Keys lowercased/trimmed. Identity (canonical -> canonical) entries from
// recommend.py are intentionally omitted here: exact canonical hits are
// handled by CANONICAL_SET in resolveSpecialty, not by the alias map.
// ---------------------------------------------------------------------------
const RAW_ALIASES = {
  // --- pediatrics ---
  pediatrician: "pediatrics",
  paediatrician: "pediatrics",
  paediatrics: "pediatrics",
  peds: "pediatrics",
  "child specialist": "pediatrics",
  "child health": "pediatrics",
  "children's doctor": "pediatrics",

  // --- obstetrics_gynecology ---
  "ob-gyn": "obstetrics_gynecology",
  "ob gyn": "obstetrics_gynecology",
  "ob/gyn": "obstetrics_gynecology",
  obgyn: "obstetrics_gynecology",
  "ob/gyne": "obstetrics_gynecology",
  obgyne: "obstetrics_gynecology",
  obstetrician: "obstetrics_gynecology",
  gynecologist: "obstetrics_gynecology",
  gynaecologist: "obstetrics_gynecology",
  gynecology: "obstetrics_gynecology",
  gynaecology: "obstetrics_gynecology",
  obstetrics: "obstetrics_gynecology",
  "obstetrician gynecologist": "obstetrics_gynecology",
  obstetrician_gynecologist: "obstetrics_gynecology",
  "obstetrics gynecology": "obstetrics_gynecology",
  "obstetrics gynaecology": "obstetrics_gynecology",
  "obstetrics and gynecology": "obstetrics_gynecology",
  "obstetrics & gynecology": "obstetrics_gynecology",

  // --- cardiology ---
  cardiologist: "cardiology",
  cardiac: "cardiology",
  heart: "cardiology",
  "heart specialist": "cardiology",
  cardiovascular: "cardiology",
  hypertension: "cardiology",
  "blood pressure": "cardiology",

  // --- psychiatry ---
  psychiatrist: "psychiatry",
  "mental health": "psychiatry",

  // --- nutrition_dietetics ---
  nutritionist: "nutrition_dietetics",
  nutrition: "nutrition_dietetics",
  dietitian: "nutrition_dietetics",
  dietician: "nutrition_dietetics",
  dietetics: "nutrition_dietetics",
  malnutrition: "nutrition_dietetics",

  // --- internal_medicine (unambiguous keys only; bare "physician" is ambiguous) ---
  internist: "internal_medicine",
  "internal medicine": "internal_medicine",
  "adult medicine": "internal_medicine",

  // --- family_medicine ---
  "family medicine": "family_medicine",
  "family practice": "family_medicine",
  "family doctor": "family_medicine",

  // --- preventive_medicine ---
  "preventive medicine": "preventive_medicine",
  "public health": "preventive_medicine",
  "community medicine": "preventive_medicine",
  preventive: "preventive_medicine",
  screening: "preventive_medicine",
  vaccination: "preventive_medicine",

  // --- endocrinology_diabetes ---
  endocrinologist: "endocrinology_diabetes",
  endocrinology: "endocrinology_diabetes",
  diabetologist: "endocrinology_diabetes",
  diabetology: "endocrinology_diabetes",
  diabetes: "endocrinology_diabetes",
  sugar: "endocrinology_diabetes",
  metabolic: "endocrinology_diabetes",

  // --- medical_oncology (bare "oncology"/"cancer" are ambiguous heads) ---
  oncologist: "medical_oncology",
  "medical oncology": "medical_oncology",
  chemotherapy: "medical_oncology",

  // --- neonatology ---
  neonatologist: "neonatology",
  newborn: "neonatology",
  neonatal: "neonatology",
  nicu: "neonatology",

  // --- pulmonology ---
  pulmonologist: "pulmonology",
  "chest medicine": "pulmonology",
  respiratory: "pulmonology",
  lung: "pulmonology",
  asthma: "pulmonology",
  copd: "pulmonology",

  // --- addiction_medicine ---
  "addiction medicine": "addiction_medicine",

  // --- adolescent_medicine ---
  "adolescent medicine": "adolescent_medicine",
  "adolescent health": "adolescent_medicine",
  "teenage health": "adolescent_medicine",

  // --- family_planning_contraception ---
  "family planning": "family_planning_contraception",
  contraception: "family_planning_contraception",
  "reproductive planning": "family_planning_contraception",

  // --- maternal_child_health ---
  "maternal child health": "maternal_child_health",
  mch: "maternal_child_health",
  "mother and child health": "maternal_child_health",

  // --- pediatric_emergency_medicine ---
  "pediatric emergency": "pediatric_emergency_medicine",
  "paediatric emergency": "pediatric_emergency_medicine",

  // --- emergency_medicine ---
  casualty: "emergency_medicine",
  trauma: "emergency_medicine",
  "acute care": "emergency_medicine",
  er: "emergency_medicine",
  "emergency room": "emergency_medicine",

  // --- critical_care_medicine ---
  icu: "critical_care_medicine",
  "intensive care": "critical_care_medicine",
  "critical care": "critical_care_medicine",

  // --- other common synonyms across the non-demand-bearing 93 ---
  ent: "otolaryngology",
  otorhinolaryngology: "otolaryngology",
  "ear nose throat": "otolaryngology",
  "ear nose and throat": "otolaryngology",
  skin: "dermatology",
  dermatologist: "dermatology",
  "skin specialist": "dermatology",
  neurologist: "neurology",
  neurosurgeon: "neurosurgery",
  "brain surgeon": "neurosurgery",
  nephrologist: "nephrology",
  kidney: "nephrology",
  gastroenterologist: "gastroenterology",
  "gi specialist": "gastroenterology",
  rheumatologist: "rheumatology",
  hematologist: "hematology",
  haematology: "hematology",
  haematologist: "hematology",
  urologist: "urology",
  "orthopedic surgeon": "orthopedic_surgery",
  orthopaedic: "orthopedic_surgery",
  orthopedics: "orthopedic_surgery",
  ortho: "orthopedic_surgery",
  "bone surgeon": "orthopedic_surgery",
  "general surgeon": "general_surgery",
  surgeon: "general_surgery",
  anesthesiologist: "anesthesiology",
  anaesthesiology: "anesthesiology",
  anaesthetist: "anesthesiology",
  anesthetist: "anesthesiology",
  radiologist: "radiology",
  pathologist: "pathology",
  ophthalmologist: "ophthalmology",
  "eye doctor": "ophthalmology",
  "eye specialist": "ophthalmology",
  optometrist: "optometry_vision_therapy",
  dentist: "general_dentistry",
  dental: "general_dentistry",
  orthodontist: "orthodontics",
  endodontist: "endodontics",
  periodontist: "periodontics",
  prosthodontist: "prosthodontics",
  psychologist: "psychology",
  physiotherapist: "physiotherapy",
  "physical therapy": "physiotherapy",
  "physical therapist": "physiotherapy",
  geriatrician: "geriatric_medicine",
  "elderly care": "geriatric_medicine",
  "infectious disease": "infectious_diseases",
  "id specialist": "infectious_diseases",
  immunologist: "allergy_immunology",
  allergist: "allergy_immunology",
  allergy: "allergy_immunology",
  "sports medicine": "sports_medicine",
  "pain management": "pain_medicine",
  "palliative care": "palliative_medicine",
  hospice: "palliative_medicine",
  "sleep specialist": "sleep_medicine",
  geneticist: "medical_genetics",
  podiatrist: "podiatry",
  pharmacist: "pharmacy",
  "speech therapy": "speech_audiology",
  "speech therapist": "speech_audiology",
  audiologist: "speech_audiology",
  "occupational therapist": "occupational_therapy",
  "vascular surgeon": "vascular_surgery",
  "plastic surgeon": "plastic_reconstructive_surgery",
  "cosmetic surgeon": "plastic_reconstructive_surgery",
  "cardiothoracic surgeon": "cardiothoracic_surgery",
  "heart surgeon": "cardiothoracic_surgery",
  "spine surgeon": "spine_surgery",
  "hand surgeon": "hand_surgery",
  "colorectal surgeon": "colorectal_surgery",
  "breast surgeon": "breast_surgery",
  "transplant surgeon": "transplant_surgery",
  "bariatric surgeon": "bariatric_metabolic_surgery",
  "weight loss surgery": "bariatric_metabolic_surgery",
};

// Build the exported alias map: normalize keys, drop any alias whose target is
// not canonical (defensive), and forbid an alias key that collides with an
// ambiguous head (the head must win — caught at load so it can't silently
// shadow). Identity canonical->canonical entries are skipped (exact hits are
// handled separately).
function normKey(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export const SPECIALTY_ALIASES = (() => {
  const out = {};
  for (const [k, v] of Object.entries(RAW_ALIASES)) {
    const key = normKey(k);
    if (!CANONICAL_SET.has(v)) {
      throw new Error(
        `specialties.js: alias "${k}" maps to non-canonical value "${v}"`
      );
    }
    if (CANONICAL_SET.has(key)) {
      // Pointless (and risky) to alias an exact canonical string; exact-match
      // path owns those. Skip so the map stays alias-only.
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(AMBIGUOUS_HEADS, key)) {
      throw new Error(
        `specialties.js: alias "${k}" collides with ambiguous head "${key}"`
      );
    }
    out[key] = v;
  }
  return Object.freeze(out);
})();

// Validate ambiguous-head targets are canonical too.
for (const [head, cands] of Object.entries(AMBIGUOUS_HEADS)) {
  for (const c of cands) {
    if (!CANONICAL_SET.has(c)) {
      throw new Error(
        `specialties.js: ambiguous head "${head}" lists non-canonical candidate "${c}"`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------
// Normalize, then try in order:
//   1. exact canonical (input already in canonical snake_case)   -> matched
//   2. ambiguous head                                            -> ambiguous
//   3. unique alias                                              -> confirm
//   4. nothing                                                   -> blocked
//
// The exact-match path ONLY fires when the input is already a canonical id in
// snake_case — i.e. the picker's direct-selection path passing the value
// verbatim ("Direct selection of any of the 110 always works", spec §2/§4).
// We deliberately do NOT fold humanized free text ("internal medicine",
// "gi / hpb surgery") into a canonical via space->underscore: doing so would
// (a) silently bypass the alias-confirm step the spec wants for typed text
// (the "We read that as Internal Medicine — correct?" chip), and (b) coerce
// raw input that has no alias entry (e.g. "gi / hpb surgery") into a canonical,
// violating "raw input never defaulted to a canonical value." Humanized forms
// that ARE meaningful are listed in SPECIALTY_ALIASES and route to `confirm`;
// anything else falls through to `blocked`.
// ---------------------------------------------------------------------------

/**
 * @param {string} input  typed or spoken specialty text, or a canonical id
 * @returns {{status:"matched"|"confirm"|"ambiguous"|"blocked",
 *            candidates:string[], method?:"select"|"alias",
 *            matchedAlias?:string, confidence?:number}}
 */
export function resolveSpecialty(input) {
  const norm = normKey(input);
  if (!norm) {
    return { status: "blocked", candidates: [] };
  }

  // 1. Exact canonical match — input is already a canonical snake_case id.
  if (CANONICAL_SET.has(norm)) {
    return {
      status: "matched",
      method: "select",
      candidates: [norm],
      confidence: 1,
    };
  }

  // 2. Ambiguous head — must pick; store nothing yet.
  if (Object.prototype.hasOwnProperty.call(AMBIGUOUS_HEADS, norm)) {
    return {
      status: "ambiguous",
      candidates: [...AMBIGUOUS_HEADS[norm]],
    };
  }

  // 3. Unique alias — confirm chip ("we read that as X — correct?").
  const aliasHit = SPECIALTY_ALIASES[norm];
  if (aliasHit) {
    return {
      status: "confirm",
      method: "alias",
      candidates: [aliasHit],
      matchedAlias: norm,
      confidence: 0.9,
    };
  }

  // 4. No confident match — block. Raw input is never defaulted to a canonical.
  return { status: "blocked", candidates: [] };
}
