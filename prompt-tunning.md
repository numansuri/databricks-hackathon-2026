# Prompt Tunning Requirements

## Overview

Referral Copilot starts by asking the doctor to describe themselves in a free-form profile field. This description is the first major signal used to match the doctor with relevant clinics. The prompt tunning feature improves this intake step by evaluating whether the doctor's description contains enough useful matching information and, when it does not, asking targeted follow-up questions in the chatbox.

The goal is to help doctors provide high-value context without forcing them through a long form at the beginning of the app.

## Problem

Doctors may enter a description that is too short, vague, or missing important matching signals. For example:

- "I am a doctor looking for volunteer opportunities."
- "I work in cardiology."
- "I want to help clinics in India."

These descriptions do not give the agent enough information to confidently match clinics by specialty, region, availability, language, mission purpose, or clinic type. If the app accepts weak input without follow-up, clinic recommendations may be noisy and outreach messages may be generic.

## Goals

- Detect whether the doctor's opening description contains enough useful information for clinic matching, even when destination is not yet known.
- Identify which important matching fields are missing or low-confidence.
- Ask concise follow-up questions in the chatbox when the description is incomplete.
- Convert the doctor's answers into structured profile signals for clinic matching.
- Keep the onboarding experience conversational and lightweight.
- Allow the doctor to skip, edit, or revise follow-up answers.
- Improve clinic match quality and relevance explanations.

## Non-Goals

- Do not block the doctor from using the app if they provide incomplete information.
- Do not require every profile field before showing any clinic results.
- Do not collect patient health information.
- Do not make clinical claims or credentialing claims on behalf of the doctor.
- Do not send outreach or contact clinics as part of this feature.
- Do not replace the human approval workflow for outreach or scheduling.

## User Story

As a doctor, I want to describe my background naturally so the agent can understand what kinds of clinics are relevant to me. If I leave out important information, I want the agent to ask helpful follow-up questions instead of making poor assumptions.

## Matching Signals To Extract

The agent should evaluate the doctor's description for the following signals:

- Medical specialty
- Subspecialties or clinical focus areas
- Years or type of experience
- Relevant procedures, care settings, or patient populations
- Languages spoken
- Current location
- Destination location or preferred region, optional at intake
- Travel dates or service window
- Availability for introductory meetings
- Mission purpose, such as volunteering, relocation, partnership, observation, or referral coordination
- Preferred clinic type, such as hospital, community clinic, NGO clinic, rural clinic, specialty center, or teaching hospital
- Credentials summary
- License or eligibility constraints, if relevant
- Preferred outreach or collaboration style

## Profile Quality Levels

The system should classify the doctor's description into one of three quality levels.

### High Quality

The description includes enough information to start clinic matching with confidence.

Minimum expected signals:

- Specialty or clinical focus
- Mission purpose
- At least one practical matching detail, such as language, clinic type, availability, experience, or patient population
- Destination or target region, if the doctor already knows it

Example:

```text
I am a cardiologist with 10 years of ICU experience. I will be in Gujarat in August and want to volunteer with hospitals or community clinics that need support for emergency cardiac referrals and hypertension screening. I speak English and Hindi.
```

### Medium Quality

The description contains some useful information but is missing one or more important matching signals.

Example:

```text
I am a cardiologist interested in volunteering in India.
```

The agent should ask one to three follow-up questions before ranking clinics when critical signals are missing. Missing destination alone should not require a follow-up before matching.

### Low Quality

The description is too vague to support useful matching.

Example:

```text
I am a doctor looking for clinics.
```

The agent should ask a short guided set of follow-up questions before showing recommendations, while still allowing the doctor to continue. If destination is the only missing detail, the profile should not be classified as low quality for that reason alone.

## Follow-Up Question Behavior

When required information is missing, the agent should ask follow-up questions in the chatbox immediately after the doctor submits the opening description.

The questions should be:

- Specific to the missing signals.
- Short and easy to answer.
- Asked in a conversational tone.
- Limited to one to three questions at a time.
- Ordered by importance for clinic matching.
- Reused to update the doctor's profile context after each answer.

The agent should avoid asking for information that was already clearly provided.

## Follow-Up Question Priority

The agent should prioritize missing fields in this order:

1. Specialty or clinical focus
2. Mission purpose
3. Travel dates or service window
4. Availability for clinic meetings
5. Languages spoken
6. Preferred clinic type
7. Experience, credentials, or license context
8. Destination location or preferred region, when needed to narrow results

## Example Follow-Up Prompts

If specialty is missing:

```text
What is your medical specialty or main clinical focus?
```

If destination is missing:

```text
Do you already have a target city, state, or country, or should I start with broader clinic matches?
```

If mission purpose is missing:

```text
Are you looking for volunteering, relocation, referral partnerships, observation, or another type of clinic connection?
```

If availability is missing:

```text
When are you available for introductory clinic meetings, and what time zone should I use?
```

If clinic type is missing:

```text
Do you prefer hospitals, community clinics, NGO clinics, rural clinics, specialty centers, or teaching hospitals?
```

If language is missing:

```text
What languages can you use comfortably in clinical or professional settings?
```

## Functional Requirements

### Intake Evaluation

- The system must evaluate the doctor's free-form description after submission.
- The system must extract structured matching signals from the description.
- The system must assign a quality level of `high`, `medium`, or `low`.
- The system must identify missing or low-confidence signals.
- The system must store the original doctor description as the source text.
- The system must not overwrite doctor-provided text without user action.

### Follow-Up Generation

- The system must generate follow-up questions when required matching signals are missing.
- The system must treat destination as optional during initial intake.
- The system must ask follow-up questions in the chatbox.
- The system must ask no more than three follow-up questions in a single turn.
- The system must prioritize follow-up questions by matching importance.
- The system must allow the doctor to answer in natural language.
- The system must allow the doctor to skip a follow-up question.
- The system must avoid repeating questions that have already been answered.

### Profile Update

- The system must merge follow-up answers into the doctor's profile context.
- The system must preserve the original description and the follow-up answer history.
- The system must update structured profile fields used for matching.
- The system must show a short confirmation of what was learned from the doctor's answer.
- The system should allow the doctor to correct extracted profile details from the chatbox.

### Clinic Matching Integration

- The clinic matching workflow must use the improved profile signals.
- The system should explain when a clinic is recommended because of information gathered through follow-up questions.
- If the profile remains incomplete, the system should still show clinics but label low-confidence matches.
- The system should prefer asking for critical missing details before ranking clinics when the original description is low quality.
- The system must not block or downgrade the profile solely because destination is missing.

## Data Requirements

The feature should support these profile fields:

- `raw_description`
- `profile_quality_level`
- `missing_signals`
- `low_confidence_signals`
- `extracted_specialties`
- `extracted_subspecialties`
- `extracted_languages`
- `current_location`
- `destination_location`, optional
- `service_window`
- `availability_summary`
- `mission_purpose`
- `preferred_clinic_types`
- `credentials_summary`
- `license_summary`
- `follow_up_questions`
- `follow_up_answers`
- `updated_at`

## Agent Behavior Requirements

- The agent must be helpful, direct, and professional.
- The agent must not shame or criticize the doctor for vague input.
- The agent must explain why it is asking follow-up questions.
- The agent must distinguish known details from assumptions.
- The agent must ask for clarification before using uncertain details for clinic matching.
- The agent must not invent credentials, availability, languages, or licensing status.
- The agent must avoid collecting patient data.

## UX Requirements

- The first onboarding page should keep the free-form doctor description field.
- After the doctor submits the description, the chatbox should show either a confirmation or follow-up questions.
- Follow-up questions should appear as normal chat messages from the agent.
- The doctor should be able to answer all follow-up questions in one message or respond one by one.
- The UI should show that the profile was updated after useful answers are received.
- The doctor should be able to continue to clinic search even if some fields remain incomplete.

## Acceptance Criteria

- A high-quality description proceeds to clinic matching without required follow-up questions.
- A medium-quality description triggers one to three targeted follow-up questions.
- A low-quality description triggers the highest-priority follow-up questions before recommendations are shown.
- Missing destination alone does not make a description low quality and does not block clinic matching.
- The agent does not ask for fields already provided in the original description.
- Follow-up answers update the doctor profile signals used for matching.
- Clinic recommendations can reference profile details collected through follow-up.
- The doctor can skip follow-up and still continue with lower-confidence matching.
- No external outreach is sent by this feature.
- No patient health information is requested.

## Success Metrics

- Percentage of doctor profiles classified as high quality after follow-up.
- Reduction in low-confidence clinic matches.
- Increase in doctor acceptance rate of recommended clinics.
- Number of follow-up questions asked per onboarding session.
- Percentage of follow-up questions answered.
- Percentage of profile details corrected by doctors.
- Doctor satisfaction with the relevance of clinic matches.

## Open Questions

- Should the profile quality check run in the frontend, backend, or agent service?
- What model or rule-based fallback should be used for signal extraction?
- Should follow-up questions be saved before the doctor creates an account?
- How should skipped questions affect clinic ranking confidence?
- Should the app show a visible profile completeness score?
- Which profile fields are required for the hackathon demo path?
