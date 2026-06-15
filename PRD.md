# Referral Copilot PRD

## Overview

Referral Copilot helps doctors who are traveling, volunteering, relocating, or supporting medical missions find relevant clinics and schedule introductory appointments based on their specialty, availability, location, and outreach preferences.

The MVP focuses on outreach and scheduling. The doctor provides their contact details, professional profile, specialty, destination, and availability. The agent uses the Databricks facilities dataset as the primary clinic source, enriches missing contact information from clinic websites or social platform links when available, generates clinic-specific email or text message drafts, tracks responses, and helps schedule appointments or introductory calls. Every external step requires human approval: the doctor must approve outreach before it is sent, approve any follow-up response, and approve final scheduling before the appointment is confirmed.

## Problem

Doctors working in unfamiliar regions often need to quickly connect with clinics that match their specialty. This is especially important for medical volunteers, disaster response teams, rural health outreach, and doctors working with organizations such as Doctors Without Borders.

Today, this process is manual:

- Doctors search for clinics one by one.
- They write repeated outreach emails or phone messages.
- They manage back-and-forth scheduling across time zones.
- They may not know which clinics are relevant to their specialty.
- Clinics may respond slowly or through different channels.

Referral Copilot reduces this coordination burden so doctors can focus on care delivery.

## Goals

- Collect the doctor's contact, specialty, destination, credentials, and availability.
- Use the Databricks `facilities` table as the primary source for candidate clinics.
- Find clinics that are likely to match the doctor's specialty, destination, and mission goals.
- Enrich missing clinic contact information from public websites or social platform profiles stored in the dataset.
- Generate personalized outreach emails or text messages for clinics.
- Send or prepare outreach through email, SMS, text message, phone script, or manual approval workflow.
- Track clinic replies and scheduling status.
- Suggest appointment times based on doctor availability and clinic response.
- Require doctor approval before responding to clinics, proposing appointment times, or confirming appointments.
- Show confirmed appointment sessions on an in-app calendar.
- Confirm scheduled appointments and maintain a clear activity log.

## Non-Goals

- Referral Copilot does not diagnose patients.
- Referral Copilot does not provide clinical medical advice.
- Referral Copilot does not guarantee clinic credentialing or legal work authorization.
- Referral Copilot does not automatically share sensitive patient data.
- Referral Copilot does not book clinical procedures or patient appointments in the MVP.
- Referral Copilot does not scrape private, login-only, or restricted contact information.
- Referral Copilot does not send outreach without doctor approval in the MVP.
- Referral Copilot does not schedule, reschedule, or cancel appointments without doctor approval.

## Target Users

- Volunteer doctors seeking clinics in another city or country.
- Doctors relocating temporarily or permanently.
- Medical mission coordinators helping doctors connect with local clinics.
- NGO operations teams coordinating outreach.
- Clinics looking for specialists or volunteer support.

## Primary User Story

As a doctor traveling to another country, I want to provide my specialty, contact information, destination, and availability so Referral Copilot can contact matching clinics and schedule introductory appointments for me.

## MVP Scope

The MVP should support a single doctor creating one outreach campaign for one destination and specialty.

Core capabilities:

- Doctor profile intake
- Destination and specialty intake
- Clinic candidate list
- Contact enrichment from facility websites or social platform links
- Outreach message generation
- Human approval before sending outreach
- Human approval before sending follow-ups, proposed times, confirmations, reschedules, or cancellations
- Response tracking
- Scheduling coordination
- In-app calendar for confirmed appointment sessions
- Appointment confirmation
- Activity timeline

## Human Approval Principles

Referral Copilot should be an assistant, not an autonomous external actor. From outreach through scheduling, each step that communicates with a clinic or changes an appointment state must require explicit doctor approval.

The doctor must approve:

- Which clinics are included in outreach.
- Which contact method is used for each clinic.
- Each outreach email, text message, phone script, contact form message, or social platform draft.
- Each follow-up message after a clinic reply.
- Any proposed appointment times sent to a clinic.
- Any selected clinic-proposed appointment time.
- Final appointment confirmation.
- Reschedule or cancellation messages.

The agent may perform internal analysis without approval, such as scoring clinics, drafting messages, summarizing replies, extracting proposed times, and checking availability. However, these actions should remain visible in the activity log.

## Doctor Intake

The doctor provides:

- Full name
- Email address
- Phone number
- Preferred contact method
- Medical specialty
- Subspecialties
- Languages spoken
- Current location
- Destination location
- Travel dates or service window
- Appointment availability
- Credentials summary
- License information, if relevant
- CV or profile link, optional
- Mission purpose, such as volunteering, relocation, partnership, or observation
- Preferred clinic type, such as hospital, community clinic, NGO clinic, rural clinic, specialty center, or teaching hospital

## Clinic Intake And Matching Signals

Referral Copilot uses the following Databricks table as the primary source of facility data:

- Catalog: `databricks_virtue_foundation_dataset_dais_2026`
- Schema: `virtue_foundation_dataset`
- Table: `facilities`

The application should query this table to build the clinic candidate list. When the table contains contact details, the agent should use those values directly and preserve the original data source. When email or phone information is missing, the agent should look for website or social platform fields in the same facility record and attempt public contact enrichment.

Referral Copilot uses facility information such as:

- Clinic name
- Location
- Website
- Public email
- Public phone number
- Social platform links
- Specialty departments
- Languages supported
- Clinic type
- Operating hours
- Known appointment process
- Contact person, if available
- Relevance score for the doctor's specialty
- Source URL or data provenance
- Contact enrichment status
- Last enrichment attempt timestamp

Matching should consider:

- Specialty overlap
- Geographic proximity to destination
- Language fit
- Clinic type preference
- Volunteer or international collaboration signals
- Publicly available contact method
- Scheduling feasibility

## Contact Enrichment Workflow

If the `facilities` table does not include a usable email address or phone number for a clinic, the agent should attempt contact enrichment from public sources already referenced by the facility record.

1. Check whether the facility record includes a website URL.
2. If a website exists, visit public pages likely to contain contact details, such as home, contact, about, appointments, locations, or footer content.
3. Extract public email addresses, phone numbers, contact forms, address details, and scheduling instructions.
4. If the website does not provide contact details, check social platform links from the facility record.
5. Extract only public business contact information shown on the social profile.
6. Store extracted contacts with source URL, extraction timestamp, and confidence level.
7. If no contact can be found, mark the clinic as `Contact missing` and ask the doctor whether to skip it or use a manual outreach path.

The agent should not:

- Bypass login walls.
- Extract personal staff contact details unless clearly published for clinic contact.
- Use patient-facing emergency lines for non-urgent outreach unless no other public channel exists and the doctor approves.
- Send repeated messages to clinics that do not respond or opt out.

## Outreach Channel Selection

The agent chooses the best outreach channel from available contact data:

- Email: preferred MVP channel when a public clinic email is available.
- Text message or SMS: allowed when a public clinic phone number supports texting and the doctor approves the message.
- Phone script: generated when only a phone number is available.
- Contact form: suggested when the clinic website only provides a form.
- Social platform message: optional future channel, only if the platform and clinic profile support appropriate professional outreach.

Every generated outreach item should include:

- Selected channel
- Contact destination, such as email address, phone number, form URL, or social profile URL
- Contact source
- Confidence level
- Message draft
- Reason the clinic is relevant
- Required doctor approval state
- Approval history

## Core Workflow

1. Doctor creates an outreach request.
2. Agent asks for missing required details.
3. Agent queries the Databricks `facilities` table for clinics in or near the destination.
4. Agent scores clinics by specialty fit, location fit, contact availability, and outreach feasibility.
5. Agent enriches missing contact information from public websites or social platform links in the facility record.
6. Doctor reviews the suggested clinic list, relevance reasons, and contact confidence.
7. Agent drafts personalized email, text message, phone script, or contact form messages.
8. Doctor approves, edits, or rejects each outreach draft.
9. Agent sends only doctor-approved outreach through supported channels or prepares messages for manual sending.
10. Agent monitors replies and updates each clinic status.
11. Agent summarizes clinic replies and asks the doctor to approve any response or follow-up.
12. Agent extracts proposed appointment times from clinic replies.
13. Agent compares proposed times against the doctor's availability.
14. Doctor approves which appointment time should be accepted or which alternate times should be proposed.
15. Agent sends only doctor-approved scheduling messages to the clinic.
16. Doctor approves the final appointment confirmation.
17. Agent confirms the appointment with the clinic.
18. Agent adds confirmed appointment sessions to the in-app calendar.
19. Agent summarizes next steps, required documents, and contact details.

## Outreach Statuses

Each clinic should move through a clear status pipeline:

- Candidate
- Contact available
- Contact enrichment needed
- Contact enrichment complete
- Contact missing
- Approved for outreach
- Outreach drafted
- Outreach approval pending
- Outreach approved
- Outreach sent
- Reply received
- Follow-up needed
- Follow-up approval pending
- Scheduling proposed
- Scheduling approval pending
- Confirmation approval pending
- Appointment confirmed
- Calendar event created
- Not interested
- No response
- Opted out
- Closed

## Scheduling Workflow

The scheduling flow should be conservative and approval-based. The agent can summarize replies, identify available times, and draft scheduling messages, but the doctor must approve before any scheduling message is sent or appointment is confirmed.

1. Doctor provides available dates, times, time zone, and preferred meeting format.
2. Agent includes availability in the initial outreach message.
3. Clinic replies with interest, questions, or proposed times.
4. Agent identifies scheduling intent and extracts proposed times.
5. Agent checks conflicts against the doctor's availability.
6. If there is a match, agent asks the doctor to approve accepting that appointment time.
7. If there is no match, agent drafts alternate times and asks the doctor to approve before sending.
8. Agent sends only doctor-approved scheduling replies.
9. Once the clinic confirms, the agent asks the doctor to approve final confirmation.
10. Agent sends the doctor-approved confirmation message.
11. Agent stores appointment details, creates an in-app calendar event, and sends the doctor a summary.

Appointment details should include:

- Clinic name
- Contact person
- Clinic address or video link
- Date and time
- Time zone
- Purpose of meeting
- Required documents
- Notes from clinic
- Confirmation status
- Calendar event status

## In-App Calendar

Referral Copilot should include a calendar view where confirmed appointment sessions appear automatically after doctor approval and clinic confirmation.

Calendar events should be created only after:

1. The clinic has agreed to a meeting time.
2. The doctor has approved the final appointment confirmation.
3. The agent has sent or prepared the approved confirmation message.

The calendar should show:

- Confirmed clinic appointments.
- Pending scheduling holds, clearly marked as not confirmed.
- Appointment date, time, duration, and time zone.
- Clinic name and location or video link.
- Contact person and contact method.
- Purpose of the appointment.
- Required documents or preparation notes.
- Current status, such as pending approval, confirmed, reschedule requested, canceled, or completed.

The doctor should be able to review appointment details from the calendar and approve, reschedule, or cancel through the same human-approval workflow.

## Agent Behavior

The agent should:

- Be transparent about what it is doing.
- Ask for approval before sending any external message.
- Ask for approval before proposing, accepting, confirming, rescheduling, or canceling appointments.
- Explain why clinics were selected.
- Keep outreach professional, concise, and culturally respectful.
- Avoid making medical claims on behalf of the doctor.
- Avoid promising availability, services, licensing, or affiliation unless explicitly provided.
- Escalate ambiguous clinic responses to the doctor.
- Maintain an audit trail of messages and decisions.

## Example Outreach Message

### Email Draft

Subject: Specialist Doctor Visiting [City] - Introductory Clinic Meeting

Hello [Clinic Contact or Clinic Team],

My name is [Doctor Name], and I am a [Specialty] doctor planning to be in [Destination] from [Start Date] to [End Date]. I am exploring opportunities to connect with clinics that support [Relevant Specialty or Patient Population].

I would appreciate the chance to schedule a short introductory meeting to learn more about your clinic's needs and whether my background may be useful during my visit.

I am available at the following times:

- [Option 1]
- [Option 2]
- [Option 3]

Please let me know if one of these works, or if there is another contact person I should reach out to.

Best regards,

[Doctor Name]
[Email]
[Phone]
[Credentials Summary]

### Text Message Draft

Hello [Clinic Name], this is [Doctor Name], a [Specialty] doctor visiting [Destination] from [Start Date] to [End Date]. I would like to schedule a short introductory meeting to learn whether my background may be useful to your clinic. I am available [Option 1] or [Option 2]. Please let me know if there is a better contact person. Thank you.

## Functional Requirements

### Doctor Profile

- The system must collect required doctor contact information.
- The system must support specialty and subspecialty fields.
- The system must support destination and service window fields.
- The system must support availability blocks with time zone.

### Clinic List

- The system must query facilities from `databricks_virtue_foundation_dataset_dais_2026.virtue_foundation_dataset.facilities`.
- The system must support filtering facilities by destination, specialty signals, clinic type, and available contact method.
- The system must allow clinics to be added manually when a relevant clinic is not present in the Databricks table.
- The system should support importing additional clinics from CSV or search result if needed.
- The system must show why a clinic appears relevant.
- The system must show the original facility source and any enriched contact source.
- The system must let the doctor approve clinics before outreach.

### Contact Enrichment

- The system must detect missing email and phone fields for candidate clinics.
- The system must inspect website and social platform fields from the facility record when contact data is missing.
- The system must extract only public business contact information.
- The system must store extracted contact data with source URL and confidence.
- The system must flag low-confidence or conflicting contacts for doctor review.
- The system must avoid restricted, private, or login-only sources.

### Outreach

- The system must generate a draft message for each approved clinic.
- The system must personalize each message using doctor and clinic context.
- The system must require doctor approval before sending.
- The system must require doctor approval before sending follow-up messages.
- The system must store sent message history.
- The system should support email first for the MVP.
- The system should generate text message drafts when a phone number is available.
- The system should generate phone scripts or contact form messages when direct email or text outreach is unavailable.

### Response Tracking

- The system must track the latest response status for each clinic.
- The system must summarize clinic replies.
- The system must detect scheduling intent.
- The system must flag replies that need doctor input.

### Scheduling

- The system must compare clinic proposed times against doctor availability.
- The system must request doctor approval before proposing alternate times to a clinic.
- The system must request doctor approval before accepting a clinic-proposed time.
- The system must request doctor approval before confirming, rescheduling, or canceling a meeting.
- The system must store confirmed appointment details.
- The system must create appointment sessions on the in-app calendar after confirmation.
- The system should generate calendar invite details.

### Calendar

- The system must provide an in-app calendar view.
- The system must show confirmed appointment sessions on the calendar.
- The system must distinguish confirmed sessions from pending scheduling holds.
- The system must allow the doctor to open appointment details from the calendar.
- The system must route reschedule and cancellation actions through doctor approval.

## Data Model

### Doctor

- id
- full_name
- email
- phone
- preferred_contact_method
- specialty
- subspecialties
- languages
- current_location
- destination_location
- service_start_date
- service_end_date
- credentials_summary
- license_summary

### AvailabilityBlock

- id
- doctor_id
- start_time
- end_time
- time_zone
- meeting_format

### Clinic

- id
- databricks_facility_id
- databricks_catalog
- databricks_schema
- databricks_table
- name
- location
- website
- social_links
- email
- phone
- clinic_type
- specialties
- languages
- source
- relevance_score
- relevance_reason
- contact_status
- contact_confidence
- contact_source_url
- last_enriched_at

### ContactMethod

- id
- clinic_id
- type
- value
- source
- source_url
- confidence
- is_primary
- is_doctor_approved
- discovered_at

### OutreachCampaign

- id
- doctor_id
- destination
- specialty_focus
- status
- created_at

### OutreachMessage

- id
- campaign_id
- clinic_id
- contact_method_id
- channel
- destination
- subject
- body
- status
- approved_by_doctor
- approved_at
- approved_by
- generated_reasoning
- sent_at

### ClinicResponse

- id
- outreach_message_id
- received_at
- raw_body
- summary
- detected_intent
- proposed_times
- needs_doctor_review

### Appointment

- id
- doctor_id
- clinic_id
- campaign_id
- start_time
- end_time
- time_zone
- location_or_link
- contact_person
- status
- approval_status
- doctor_approved_at
- calendar_event_id
- notes

### CalendarEvent

- id
- appointment_id
- doctor_id
- clinic_id
- title
- start_time
- end_time
- time_zone
- location_or_link
- status
- is_confirmed
- created_at
- updated_at

### ApprovalRecord

- id
- actor_id
- actor_type
- target_type
- target_id
- action_type
- status
- approved_at
- notes

## Suggested MVP Screens

- Doctor intake form
- Campaign dashboard
- Databricks facility search and clinic candidate review
- Contact enrichment review
- Outreach message approval for email and text drafts
- Inbox and response tracker
- Scheduling approval view
- In-app calendar
- Confirmed appointments view

## Safety, Privacy, And Compliance

- Do not collect patient health information in the MVP.
- Store doctor contact and credential data securely.
- Make all external messages doctor-approved.
- Require doctor approval before appointment scheduling, rescheduling, or cancellation.
- Log all agent-generated messages.
- Log all approval decisions.
- Clearly label AI-generated drafts.
- Avoid claiming legal eligibility to practice medicine in a destination country.
- Include disclaimers that licensing, credentialing, and local regulations must be verified separately.
- Allow the doctor to pause or cancel outreach at any time.
- Respect clinic opt-outs and stop further outreach to opted-out contacts.
- Keep contact enrichment limited to public business contact details.
- Store source URLs for all enriched contact details so the doctor can verify them.
- Use conservative rate limits for outreach to avoid spam-like behavior.

## Success Metrics

- Number of clinics approved for outreach.
- Percentage of candidate clinics with direct contact information in Databricks.
- Percentage of missing-contact clinics successfully enriched from website or social links.
- Number of outreach messages sent.
- Percentage of outreach and scheduling actions approved by the doctor.
- Clinic response rate.
- Number of meetings scheduled.
- Number of confirmed calendar events created.
- Average time from campaign creation to first clinic reply.
- Average time from first reply to confirmed appointment.
- Doctor satisfaction with clinic match quality.
- Percentage of messages edited before approval.
- Contact enrichment precision, measured by doctor acceptance or rejection of extracted contacts.

## Open Questions

- Should the MVP actually send email, or only generate approved drafts?
- Which email provider should be used first?
- Should the agent support SMS or WhatsApp later?
- Which columns in the Databricks `facilities` table contain website, social platform, specialty, location, phone, and email data?
- Should contact enrichment run automatically for all candidates, or only after doctor approval?
- Should clinic search be limited to the Databricks table for the hackathon MVP, or should manual upload/search be allowed as backup?
- Should appointment confirmations create calendar events automatically?
- What level of credential verification should be required before outreach?
- Should medical organizations have an admin dashboard for multiple doctors?

## Future Enhancements

- Multi-doctor campaign management for NGOs.
- Calendar integration.
- Email inbox integration.
- WhatsApp or SMS outreach.
- Clinic CRM integration.
- Multilingual outreach generation.
- Automatic follow-up sequences.
- Automated contact enrichment quality scoring.
- Credential document checklist by country.
- Clinic feedback after appointment.
- Analytics for medical mission coordinators.
