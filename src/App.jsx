import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  CalendarCheck,
  Check,
  ChevronRight,
  ClipboardList,
  Clock3,
  Copy,
  ExternalLink,
  FileText,
  Hospital,
  LogOut,
  Mail,
  MapPin,
  MessageSquareText,
  Mic,
  Moon,
  Navigation,
  Phone,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Star,
  Sun,
  Trash2,
  UserPlus,
  UserRound,
  X
} from "lucide-react";
import seedFacilities from "../public/gold/facilities_seed.json";
import { buildSchedule, buildTemplateNarrative, ASSUMPTIONS, KILLER_LINE } from "./scheduler.js";
import { CANONICAL_SPECIALTIES, labelFor, resolveSpecialty } from "./specialties.js";
import {
  recommendationFor,
  applyStateFilter,
  enrichClinics,
  districtContext,
  signalFor,
  bundledStates
} from "./recommendation.js";

const APP_NAME = "Shiftlink";
const APP_MARK = "SL";
const APP_TAGLINE = "Place specialists where the need is highest.";
const THEME_KEY = "shiftlinkTheme";
const USER_DATABASE_KEY = "referralCopilotUsers";
const SESSION_USER_KEY = "referralCopilotSessionUserId";
const SCHEDULE_REQUESTS_KEY = "referralCopilotScheduleRequests";
const SAMPLE_PROFILE_TEXT =
  "I am a general physician with eight years of experience in diabetes and hypertension care. I can volunteer monthly for rural screening camps and prefer facilities in Gujarat, Rajasthan, and Maharashtra.";
const DEMO_PROFILE_TRANSCRIPT = "pediatrician";

// Facilities are NOT hardcoded (integration-spec §7.1, D25). They come from the
// bundled recommender slice: DoctorApp seeds a deduped-by-id `facilities` state
// array from facilities_seed.json and MERGES a district's host clinics into it as
// the doctor expands them in Recommend, so outreach/scheduler can find any shown
// facility by id. Every facility object is the canonical §4 shape.
function dedupeById(rows) {
  const byId = new Map();
  for (const row of rows || []) if (row && row.id) byId.set(row.id, row);
  return Array.from(byId.values());
}

const weekDays = [
  "Mon, Jun 15",
  "Tue, Jun 16",
  "Wed, Jun 17",
  "Thu, Jun 18",
  "Fri, Jun 19"
];

// The scheduler engine reasons in ISO dates (Mon-Fri 2026-06-15..06-19); the UI
// shows the human `weekDays` labels. These two arrays are positionally aligned so
// the prefs date inputs (clamped to the week) and the proposed-week strip can map
// between them without any Date parsing (engine stays the single source of truth).
const weekIso = [
  "2026-06-15",
  "2026-06-16",
  "2026-06-17",
  "2026-06-18",
  "2026-06-19"
];

function isoToWeekLabel(iso) {
  const idx = weekIso.indexOf(iso);
  return idx === -1 ? iso : weekDays[idx];
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function getProfileKey(userId) {
  return `referralCopilotDoctorProfile:${userId}`;
}

function getOutreachKey(userId) {
  return `referralCopilotOutreachRequests:${userId}`;
}

function getScheduleKey(userId) {
  return `referralCopilotDoctorSchedule:${userId}`;
}

function getScheduleRunKey(userId) {
  return `referralCopilotScheduleRun:${userId}`;
}

function getDisplayName(user) {
  if (!user) return "";
  return user.name || user.email?.split("@")[0] || "User";
}

// V2 doctor profile (onboarding §5): the canonical specialty is the only required
// field and the only gold join key. `tags` is kept mirrored for P0 back-compat
// (integration-spec §7.4) so existing readers keep working.
function createDoctorProfileV2(userId, resolution, extras = {}) {
  const canonical = resolution.canonical;
  const label = resolution.label || labelFor(canonical);
  const now = new Date().toISOString();
  const preferredStatesNorm = extras.preferredStatesNorm || [];
  return {
    schemaVersion: 2,
    doctorId: userId,
    createdAt: extras.createdAt || now,
    updatedAt: now,
    primarySpecialtyCanonical: canonical,
    primarySpecialtyLabel: label,
    specialtyResolution: {
      input: "",
      status: "matched",
      method: resolution.method || "select",
      source: resolution.source || "picker",
      confidence: resolution.confidence ?? 1,
      ...(resolution.matchedAlias ? { matchedAlias: resolution.matchedAlias } : {})
    },
    geography: { preferredStatesNorm, allowNationalFallback: true },
    preferences: {
      facilityComplexityTiers: [],
      ownershipSectorFinal: [],
      publicHealthOnly: false,
      requireSpecialistEvidence: false,
      teleconsultOnly: false,
      intent: "volunteer"
    },
    verification: { status: "unverified" },
    tags: { specialties: [canonical], regions: preferredStatesNorm, experience: "" }
  };
}

// Lift a stored V1 profile into V2 by re-resolving its first specialty tag through
// the shared alias map (onboarding §5). Best-effort for old demo data; an
// unresolvable tag falls back to internal_medicine (a demand-bearing specialty) so
// the migrated profile still carries a valid join key.
function migrateV1Profile(v1) {
  if (!v1 || v1.schemaVersion === 2) return v1;
  const raw = v1.tags?.specialties?.[0] || v1.rawText || "";
  const res = resolveSpecialty(raw);
  // Only auto-migrate a CONFIDENT resolution (matched/confirm). Ambiguous or
  // blocked legacy text is NEVER silently coerced to a canonical (Codex) — return
  // null so DoctorApp falls back to Onboarding and the doctor re-picks honestly.
  if ((res.status !== "matched" && res.status !== "confirm") || !res.candidates.length) {
    return null;
  }
  const canonical = res.candidates[0];
  const regions = Array.isArray(v1.tags?.regions) ? v1.tags.regions : [];
  return createDoctorProfileV2(
    v1.doctorId,
    { canonical, label: labelFor(canonical), method: "legacy_alias", source: "picker", confidence: 0.5 },
    { preferredStatesNorm: regions, createdAt: v1.createdAt }
  );
}

function useProfileRecorder(setText) {
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);

  async function startRecording() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await transcribe(blob);
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setStatus("listening");
    } catch {
      setError("Microphone access is unavailable in this browser session.");
      setStatus("idle");
    }
  }

  function stopRecording() {
    if (!recorderRef.current) return;
    recorderRef.current.stop();
    setRecording(false);
    setStatus("transcribing");
  }

  async function transcribe(blob) {
    try {
      const formData = new FormData();
      formData.append("audio", blob, "doctor-profile.webm");
      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData
      });
      if (!response.ok) throw new Error("Transcription failed");
      const data = await response.json();
      const transcript = data.transcript || data.text || "";
      if (!transcript) throw new Error("Empty transcript");
      setText((current) => mergeTranscript(current, transcript));
      setStatus("ready");
    } catch {
      setText((current) => mergeTranscript(current, DEMO_PROFILE_TRANSCRIPT));
      setStatus("demo");
    }
  }

  return { recording, status, error, startRecording, stopRecording };
}

function App() {
  const [users, setUsers] = useState(() => readJson(USER_DATABASE_KEY, []));
  const [sessionUserId, setSessionUserId] = useState(() => localStorage.getItem(SESSION_USER_KEY) || "");
  const activeUser = users.find((user) => user.id === sessionUserId) || null;
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || "light");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.title = APP_NAME;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }

  function persistUsers(nextUsers) {
    saveJson(USER_DATABASE_KEY, nextUsers);
    setUsers(nextUsers);
  }

  // Shiftlink is doctor-only (integration-spec D2: the hospital role + two-way
  // scheduling-request flow are cut). signUp always creates a volunteer specialist.
  function signUp({ name, email, password, specialty }) {
    const normalizedEmail = normalizeEmail(email);
    if (users.some((user) => user.email === normalizedEmail)) {
      return { ok: false, message: "An account already exists for that email." };
    }
    const userId = crypto.randomUUID();
    const user = {
      id: userId,
      name: name.trim(),
      email: normalizedEmail,
      password,
      role: "doctor",
      facilityId: "",
      createdAt: new Date().toISOString()
    };
    persistUsers([...users, user]);
    if (specialty?.canonical) {
      saveJson(getProfileKey(user.id), createDoctorProfileV2(user.id, specialty, {}));
    }
    localStorage.setItem(SESSION_USER_KEY, user.id);
    setSessionUserId(user.id);
    return { ok: true };
  }

  function login({ email, password }) {
    const normalizedEmail = normalizeEmail(email);
    const user = users.find((item) => item.email === normalizedEmail && item.password === password);
    if (!user) {
      return { ok: false, message: "Email or password did not match a local account." };
    }
    localStorage.setItem(SESSION_USER_KEY, user.id);
    setSessionUserId(user.id);
    return { ok: true };
  }

  function logout() {
    localStorage.removeItem(SESSION_USER_KEY);
    setSessionUserId("");
  }

  if (!activeUser) {
    return <AuthGate onLogin={login} onSignUp={signUp} theme={theme} onToggleTheme={toggleTheme} />;
  }

  return (
    <DoctorApp
      user={activeUser}
      onLogout={logout}
      theme={theme}
      onToggleTheme={toggleTheme}
    />
  );
}

function DoctorApp({ user, onLogout, theme, onToggleTheme }) {
  const profileKey = getProfileKey(user.id);
  const outreachKey = getOutreachKey(user.id);
  const scheduleKey = getScheduleKey(user.id);
  const [profile, setProfile] = useState(() => {
    const saved = localStorage.getItem(profileKey);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (parsed && parsed.schemaVersion !== 2) {
      const migrated = migrateV1Profile(parsed);
      if (migrated) {
        saveJson(profileKey, migrated);
        return migrated;
      }
      return null; // unmigratable legacy profile -> Onboarding re-pick (no fabrication)
    }
    return parsed;
  });
  const [activeView, setActiveView] = useState("search");
  // ONE deduped-by-id facilities state, seeded from the bundled recommender slice
  // (never the old fake clinics). Recommend MERGES district hosts into this; every
  // facilities[0] read is guarded so an empty array can never crash init (§7.1).
  const [facilities, setFacilities] = useState(() => dedupeById(seedFacilities));
  const [selectedFacilityId, setSelectedFacilityId] = useState(facilities[0]?.id ?? "");
  const [shortlist, setShortlist] = useState(facilities[0] ? [facilities[0].id] : []);
  const [schedule, setSchedule] = useState(() => readJson(scheduleKey, []));
  const [outreachRequests, setOutreachRequests] = useState(() => readJson(outreachKey, []));
  // Latest deterministic scheduler run (scheduler-final §4/§6): the engine output
  // plus the narrative and the prefs that produced it. Read on mount, re-persisted
  // on every build and on every approval (which flips `approved` on proposals).
  const [scheduleRun, setScheduleRun] = useState(() => readJson(getScheduleRunKey(user.id), null));
  // Bumped by the MapWorkspace "Build my week" button so the SchedulerPanel runs
  // with its current prefs form state (the panel owns the form; this just pokes it).
  const [buildTrigger, setBuildTrigger] = useState(0);
  const draftingFacilitiesRef = useRef(new Set());
  // Synchronous in-flight guard for confirmProposals: blocks a second click landing
  // in the SAME render frame (before React re-renders) from double-writing a visit.
  const confirmingRequestIdsRef = useRef(new Set());

  // MERGE (never replace) canonical facility objects, deduped by id, so a clinic
  // shown in Recommend is always resolvable by outreach/scheduler (§7.1).
  function mergeFacilities(incoming) {
    setFacilities((current) => dedupeById([...current, ...(incoming || [])]));
  }

  const selectedFacility = facilities.find((facility) => facility.id === selectedFacilityId) || facilities[0] || null;

  // Accepts either the next array or an updater (current => next). All callers go
  // through the functional form so concurrent async writes/edits always merge
  // against the freshest list instead of a stale render snapshot.
  function persistOutreachRequests(next) {
    setOutreachRequests((current) => {
      const nextRequests = typeof next === "function" ? next(current) : next;
      saveJson(outreachKey, nextRequests);
      return nextRequests;
    });
  }

  function updateSchedule(updater) {
    setSchedule((current) => {
      const nextSchedule = updater(current);
      saveJson(scheduleKey, nextSchedule);
      return nextSchedule;
    });
  }

  function saveProfile(resolution) {
    const nextProfile = createDoctorProfileV2(user.id, resolution, {});
    saveJson(profileKey, nextProfile);
    setProfile(nextProfile);
  }

  function resetProfile() {
    localStorage.removeItem(profileKey);
    setProfile(null);
  }

  function toggleShortlist(id) {
    setShortlist((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  async function createOutreachDraft(facilityId) {
    const facility = facilities.find((item) => item.id === facilityId);
    if (!facility) return;

    // Synchronous in-flight guard: blocks rapid double-clicks before React re-renders.
    if (draftingFacilitiesRef.current.has(facilityId)) {
      setActiveView("outreach");
      return;
    }

    const draftId = crypto.randomUUID();
    const proposedTimes = [
      { date: "2026-06-18", time: "11:00", label: "Thu, Jun 18 at 11:00" },
      { date: "2026-06-19", time: "14:30", label: "Fri, Jun 19 at 14:30" }
    ];

    // Atomically check for an existing open draft and (if none) insert the
    // placeholder, both against the freshest list — no stale-snapshot races.
    let inserted = false;
    persistOutreachRequests((current) => {
      const existing = current.find(
        (request) =>
          request.facilityId === facilityId && !["closed", "appointment_confirmed"].includes(request.status)
      );
      if (existing) return current;
      inserted = true;
      return [
        { id: draftId, facilityId, status: "drafting", createdAt: new Date().toISOString(), proposedTimes },
        ...current
      ];
    });
    setActiveView("outreach");
    if (!inserted) return;

    draftingFacilitiesRef.current.add(facilityId);
    const doctor = buildDoctorForApi(user, profile);

    const applyDraft = (draft) => {
      persistOutreachRequests((current) =>
        current.map((request) =>
          request.id === draftId
            ? {
                ...request,
                facilityId,
                proposedTimes,
                status: "draft",
                approvalStatus: "doctor_approval_required",
                recommendedChannel: draft.recommendedChannel,
                selectedChannel: draft.recommendedChannel,
                availableChannels: draft.availableChannels,
                channelValues: draft.channelValues,
                subject: draft.subject,
                body: draft.body,
                phoneScript: draft.phoneScript,
                message: draft.body,
                source: draft.source,
                channel: prettyChannelLabel(draft.recommendedChannel),
                destination: draft.channelValues[draft.recommendedChannel] || ""
              }
            : request
        )
      );
    };

    try {
      const response = await fetch("/api/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facility: mapFacilityForApi(facility),
          doctor,
          district_need: null,
          preferred_channel: null
        })
      });
      if (!response.ok) throw new Error("Outreach drafting failed");
      const data = await response.json();
      applyDraft({
        recommendedChannel: data.recommended_channel,
        availableChannels: data.available_channels,
        channelValues: data.channel_values,
        subject: data.subject,
        body: data.body,
        phoneScript: data.phone_sms_script,
        source: data.source
      });
    } catch {
      applyDraft(localOutreachDraft(facility, doctor));
    } finally {
      draftingFacilitiesRef.current.delete(facilityId);
    }
  }

  function updateOutreachDraft(id, fields) {
    persistOutreachRequests((current) =>
      current.map((request) => (request.id === id ? { ...request, ...fields } : request))
    );
  }

  function approveOutreach(id) {
    persistOutreachRequests(
      outreachRequests.map((request) =>
        request.id === id
          ? {
              ...request,
              status: "reply_received",
              approvalStatus: "outreach_approved",
              sentAt: new Date().toISOString(),
              replySummary:
                "Clinic replied with interest and asked the doctor to choose one of the proposed introductory meeting slots.",
              schedulingApprovalStatus: "doctor_approval_required"
            }
          : request
      )
    );
  }

  // ── Scheduler: build-my-week (scheduler-final §4) ─────────────────────────
  // Assemble the engine's three inputs from live app state and run the pure,
  // deterministic engine. clinicReplies join `facilities` for lat/lng/name (null
  // coords pass straight through to the engine's `unknown_location` band); confirmed
  // schedule entries are injected as immovable anchors alongside the prefs form's
  // manual commitments. The output + narrative + prefs persist as the latest run.
  function runScheduler(prefs, manualAnchors = []) {
    const clinicReplies = outreachRequests
      .filter((request) => request.status === "reply_received")
      .map((request) => {
        const facility = facilities.find((item) => item.id === request.facilityId);
        return {
          requestId: request.id,
          facilityId: request.facilityId,
          facilityName: facility?.name || "Clinic",
          lat: typeof facility?.lat === "number" ? facility.lat : null,
          lng: typeof facility?.lng === "number" ? facility.lng : null,
          proposedTimes: request.proposedTimes || []
        };
      });

    // Confirmed visits already on the calendar become immovable anchors so the
    // engine plans around them; enrich each with its facility's coords.
    const scheduleAnchors = schedule
      .filter((entry) => entry.status === "confirmed")
      .map((entry) => {
        const facility = facilities.find((item) => item.id === entry.facilityId);
        return {
          id: entry.id,
          facilityName: facility?.name || entry.facilityName || entry.purpose || "Confirmed visit",
          date: entry.date,
          time: entry.time,
          lat: typeof facility?.lat === "number" ? facility.lat : null,
          lng: typeof facility?.lng === "number" ? facility.lng : null,
          source: "existing_schedule"
        };
      });

    const fixedAnchors = [...scheduleAnchors, ...(manualAnchors || [])];
    const result = buildSchedule({ clinicReplies, fixedAnchors, prefs });
    const narrative = buildTemplateNarrative(result);
    const run = {
      ranAt: new Date().toISOString(),
      prefs,
      manualAnchors: manualAnchors || [],
      proposals: result.proposals,
      assumptions: result.assumptions,
      narrative
    };
    saveJson(getScheduleRunKey(user.id), run);
    setScheduleRun(run);
    return run;
  }

  // THE app's single confirmation writer (scheduler-final §4, integration-spec
  // §7.3/D23/D24). Idempotent + one batched transaction: resolves ids to not-yet-
  // approved ACCEPTED proposals, drops any whose request is already confirmed or
  // already has a schedule entry, then writes ONCE to schedule, ONCE to outreach,
  // and ONCE to the run. Never loops a per-slot writer.
  //
  // Idempotency is enforced at THREE layers so re-clicks and double Approve-All are
  // always safe: (1) a synchronous in-flight ref guard blocks a second click in the
  // SAME render frame; (2) the closed-over status/schedule guards skip already-done
  // work across renders; (3) the schedule write itself de-dupes by requestId inside
  // the functional updater against the freshest list — so even a guard slip can't
  // append a duplicate clinic_reply entry.
  function confirmProposals(ids) {
    if (!scheduleRun || !Array.isArray(scheduleRun.proposals)) return;
    const idSet = new Set(ids || []);
    const confirmedRequestIds = new Set(
      outreachRequests
        .filter((request) => request.status === "appointment_confirmed")
        .map((request) => request.id)
    );
    const scheduledRequestIds = new Set(
      schedule.map((entry) => entry.requestId).filter(Boolean)
    );

    const toConfirm = scheduleRun.proposals.filter(
      (proposal) =>
        idSet.has(proposal.id) &&
        proposal.verdict === "accepted" &&
        proposal.approved !== true &&
        proposal.slot &&
        proposal.requestId != null &&
        !confirmedRequestIds.has(proposal.requestId) &&
        !scheduledRequestIds.has(proposal.requestId) &&
        !confirmingRequestIdsRef.current.has(proposal.requestId)
    );
    if (toConfirm.length === 0) return; // fully idempotent: nothing new to write

    // Claim these requestIds synchronously so a same-frame re-click sees them taken.
    for (const proposal of toConfirm) confirmingRequestIdsRef.current.add(proposal.requestId);

    // One schedule write — the §7.2 clinic-reply entry shape; every entry carries
    // requestId + slotLabel. The updater de-dupes against the freshest list so a
    // requestId already present (any earlier confirm) is never written twice.
    const slotByRequestId = new Map(
      toConfirm.map((proposal) => [proposal.requestId, proposal.slot])
    );
    updateSchedule((current) => {
      const present = new Set(current.map((entry) => entry.requestId).filter(Boolean));
      const newEntries = toConfirm
        .filter((proposal) => !present.has(proposal.requestId))
        .map((proposal) => ({
          id: crypto.randomUUID(),
          facilityId: proposal.facilityId,
          requestId: proposal.requestId,
          date: proposal.slot.date,
          time: proposal.slot.time,
          purpose: proposal.purpose,
          status: "confirmed",
          approvalStatus: "doctor_approved",
          calendarStatus: "calendar_event_created",
          source: "clinic_reply",
          slotLabel: proposal.slot.label
        }));
      return [...newEntries, ...current];
    });

    // One outreach write — flip every confirmed request in a single pass.
    persistOutreachRequests((current) =>
      current.map((request) =>
        slotByRequestId.has(request.id) && request.status !== "appointment_confirmed"
          ? {
              ...request,
              status: "appointment_confirmed",
              schedulingApprovalStatus: "doctor_approved",
              approvedTime: slotByRequestId.get(request.id),
              confirmedAt: new Date().toISOString()
            }
          : request
      )
    );

    // One run write — mark the confirmed proposals approved and re-persist.
    const approvedIds = new Set(toConfirm.map((proposal) => proposal.id));
    setScheduleRun((current) => {
      if (!current) return current;
      const next = {
        ...current,
        proposals: current.proposals.map((proposal) =>
          approvedIds.has(proposal.id) ? { ...proposal, approved: true } : proposal
        )
      };
      saveJson(getScheduleRunKey(user.id), next);
      return next;
    });

    // Release the in-flight claim once the state writes have been queued.
    for (const proposal of toConfirm) confirmingRequestIdsRef.current.delete(proposal.requestId);
  }

  function approveProposedVisit(id) {
    confirmProposals([id]);
  }

  function approveAllProposedVisits() {
    if (!scheduleRun || !Array.isArray(scheduleRun.proposals)) return;
    const ids = scheduleRun.proposals
      .filter((proposal) => proposal.verdict === "accepted" && proposal.approved !== true)
      .map((proposal) => proposal.id);
    confirmProposals(ids);
  }

  function removeSchedule(id) {
    updateSchedule((current) => current.filter((entry) => entry.id !== id));
  }

  if (!profile) {
    return <Onboarding onComplete={saveProfile} theme={theme} onToggleTheme={onToggleTheme} />;
  }

  return (
    <div className="appShell exchangeShell">
      <TopBar
        activeView={activeView}
        setActiveView={setActiveView}
        shortlistCount={shortlist.length}
        approvalCount={getApprovalCount(outreachRequests)}
        profile={profile}
        onResetProfile={resetProfile}
        user={user}
        onLogout={onLogout}
        theme={theme}
        onToggleTheme={onToggleTheme}
      />
      <main className="workspace">
        <LeftPanel
          activeView={activeView}
          setActiveView={setActiveView}
          facilities={facilities}
          selectedFacilityId={selectedFacilityId}
          setSelectedFacilityId={setSelectedFacilityId}
          shortlist={shortlist}
          toggleShortlist={toggleShortlist}
          schedule={schedule}
          removeSchedule={removeSchedule}
          profile={profile}
          mergeFacilities={mergeFacilities}
          outreachRequests={outreachRequests}
          createOutreachDraft={createOutreachDraft}
          updateOutreachDraft={updateOutreachDraft}
          approveOutreach={approveOutreach}
          scheduleRun={scheduleRun}
          runScheduler={runScheduler}
          approveProposedVisit={approveProposedVisit}
          approveAllProposedVisits={approveAllProposedVisits}
          buildTrigger={buildTrigger}
        />
        <MapWorkspace
          activeView={activeView}
          facilities={facilities}
          selectedFacility={selectedFacility}
          shortlist={shortlist}
          toggleShortlist={toggleShortlist}
          schedule={schedule}
          createOutreachDraft={createOutreachDraft}
          onBuildWeek={() => {
            setActiveView("schedule");
            setBuildTrigger((n) => n + 1);
          }}
        />
      </main>
    </div>
  );
}

const SIGNAL_BADGE = {
  high: { label: "High-need districts", className: "signalHigh" },
  best_available: { label: "Need signal (best-available)", className: "signalMid" },
  none: { label: "No need-gap signal", className: "signalNone" }
};

// Onboarding front door (onboarding §2/§4): a searchable combobox over all 110
// canonical specialties, each with an honest signal badge. Direct selection always
// works; typed/spoken text routes through the SAME alias resolver (confirm chip /
// disambiguation / honest block) and is NEVER silently coerced to a canonical.
// Calls onResolved({canonical,label,method,matchedAlias,source,confidence}).
function SpecialtyPicker({ onResolved, selectedCanonical }) {
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(null);
  const [showText, setShowText] = useState(false);
  const [freeText, setFreeText] = useState("");
  const { recording, status, error, startRecording, stopRecording } = useProfileRecorder(setFreeText);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qUnderscore = q.replace(/[\s/&-]+/g, "_");
    const rank = { high: 0, best_available: 1, none: 2 };
    return CANONICAL_SPECIALTIES.map((c) => ({ canonical: c, label: labelFor(c), signal: signalFor(c) }))
      .filter((o) => !q || o.label.toLowerCase().includes(q) || o.canonical.includes(qUnderscore))
      .sort((a, b) => rank[a.signal] - rank[b.signal] || a.label.localeCompare(b.label))
      .slice(0, 40);
  }, [query]);

  function choose(canonical, method = "select", matchedAlias) {
    setPending(null);
    setQuery(labelFor(canonical));
    onResolved({
      canonical,
      label: labelFor(canonical),
      method,
      matchedAlias,
      source: "picker",
      confidence: method === "select" ? 1 : 0.9
    });
  }

  function resolveText(text) {
    const res = resolveSpecialty(text);
    if (res.status === "matched") choose(res.candidates[0], "select");
    else if (res.status === "confirm") setPending({ status: "confirm", candidates: res.candidates, matchedAlias: res.matchedAlias });
    else if (res.status === "ambiguous") setPending({ status: "ambiguous", candidates: res.candidates });
    else setPending({ status: "blocked" });
  }

  return (
    <div className="specialtyPicker">
      <label className="pickerLabel">
        Your specialty
        <input
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPending(null);
          }}
          placeholder="Search 110 specialties (e.g. Pediatrics)"
          aria-label="Search specialties"
        />
      </label>
      {selectedCanonical ? (
        <p className="pickerSelected">
          <Check size={14} /> {labelFor(selectedCanonical)}
        </p>
      ) : null}
      <div className="pickerOptions" role="listbox">
        {options.map((option) => (
          <button
            type="button"
            key={option.canonical}
            className={`pickerOption ${selectedCanonical === option.canonical ? "active" : ""}`}
            onClick={() => choose(option.canonical, "select")}
          >
            <span>{option.label}</span>
            <span className={`signalBadge ${SIGNAL_BADGE[option.signal].className}`}>
              {SIGNAL_BADGE[option.signal].label}
            </span>
          </button>
        ))}
        {!options.length ? <p className="pickerEmpty">No match — try a different term or browse the list.</p> : null}
      </div>

      {pending?.status === "confirm" ? (
        <div className="pickerConfirm">
          <span>
            We read that as <strong>{labelFor(pending.candidates[0])}</strong> — correct?
          </span>
          <button type="button" className="primaryButton" onClick={() => choose(pending.candidates[0], "alias", pending.matchedAlias)}>
            Yes
          </button>
          <button type="button" className="ghostButton" onClick={() => setPending(null)}>
            No
          </button>
        </div>
      ) : null}
      {pending?.status === "ambiguous" ? (
        <div className="pickerConfirm">
          <span>Which one?</span>
          <div className="pickerOptions">
            {pending.candidates.map((candidate) => (
              <button type="button" key={candidate} className="pickerOption" onClick={() => choose(candidate, "alias")}>
                {labelFor(candidate)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {pending?.status === "blocked" ? (
        <p className="pickerEmpty">Couldn't read a specialty — pick one from the list above.</p>
      ) : null}

      <button type="button" className="ghostButton pickerExpand" onClick={() => setShowText((value) => !value)}>
        <Mic size={15} /> Type or speak instead
      </button>
      {showText ? (
        <div className="textareaFrame">
          <textarea
            value={freeText}
            onChange={(event) => setFreeText(event.target.value)}
            placeholder="Describe your specialty in your words. Do not enter patient-identifying information."
            aria-label="Describe your specialty"
          />
          <div className="transcriptionDock">
            <button
              type="button"
              className={`iconTextButton ${recording ? "dangerButton" : ""}`}
              onClick={recording ? stopRecording : startRecording}
            >
              {recording ? <Square size={17} /> : <Mic size={17} />}
              {recording ? "Stop" : "Speak"}
            </button>
            <StatusPill status={status} />
            <button type="button" className="iconTextButton" onClick={() => resolveText(freeText)}>
              <Check size={16} /> Resolve
            </button>
          </div>
          {error ? <p className="formError">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function AuthGate({ onLogin, onSignUp, theme, onToggleTheme }) {
  const [mode, setMode] = useState("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [specialty, setSpecialty] = useState(null);
  const [error, setError] = useState("");

  function submit(event) {
    event.preventDefault();
    setError("");
    const result =
      mode === "login"
        ? onLogin({ email, password })
        : onSignUp({ name, email, password, specialty });
    if (!result.ok) {
      setError(result.message);
    }
  }

  // Doctor-ready gate (onboarding §2): the canonical specialty is the only required field.
  const doctorProfileReady = !!specialty?.canonical;
  const canSubmit =
    mode === "login"
      ? email.trim() && password
      : name.trim().length > 1 && email.trim() && password.length >= 4 && doctorProfileReady;

  return (
    <main className="authShell">
      <section className="authPanel">
        <div className="authIntro">
          <div className="brandLockup">
            <span className="brandMark">{APP_MARK}</span>
            <div>
              <h1>{APP_NAME}</h1>
              <p>{APP_TAGLINE}</p>
            </div>
            <ThemeToggle theme={theme} onToggleTheme={onToggleTheme} />
          </div>
          <div>
            <p className="eyebrow">Sign in</p>
            <h2>Place specialists where the need is highest.</h2>
            <p>
              Tell us your specialty. Shiftlink ranks the districts with the highest unmet need,
              names real candidate host clinics, drafts your outreach, and builds your visit week
              from the clinics that reply.
            </p>
          </div>
        </div>
        <form className="authForm" onSubmit={submit}>
          <div className="modeSwitch" aria-label="Authentication mode">
            <button
              type="button"
              className={mode === "signup" ? "active" : ""}
              onClick={() => setMode("signup")}
            >
              <UserPlus size={16} />
              Sign up
            </button>
            <button
              type="button"
              className={mode === "login" ? "active" : ""}
              onClick={() => setMode("login")}
            >
              <UserRound size={16} />
              Log in
            </button>
          </div>
          {mode === "signup" && (
            <label>
              Name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Dr. Anika Rao"
              />
            </label>
          )}
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="doctor@example.com"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Prototype password"
            />
          </label>
          {mode === "signup" && (
            <div className="doctorContextInline">
              <div className="contextLabelRow">
                <span>Your specialty</span>
                <span>{doctorProfileReady ? "Ready" : "Required"}</span>
              </div>
              <SpecialtyPicker onResolved={setSpecialty} selectedCanonical={specialty?.canonical} />
            </div>
          )}
          {error && <p className="formError">{error}</p>}
          <button type="submit" className="primaryButton" disabled={!canSubmit}>
            {mode === "login" ? "Log in" : "Create account"}
            <ChevronRight size={18} />
          </button>
          <p className="authFootnote">
            Prototype accounts are stored in this browser only. You are self-reported and unverified.
          </p>
        </form>
      </section>
    </main>
  );
}

function Onboarding({ onComplete, theme, onToggleTheme }) {
  const [specialty, setSpecialty] = useState(null);
  const canSubmit = !!specialty?.canonical;

  return (
    <main className="onboarding">
      <section className="onboardingPanel">
        <div className="brandLockup setupBrand">
          <span className="brandMark">{APP_MARK}</span>
          <div>
            <h1>{APP_NAME}</h1>
            <p>Pick your specialty</p>
          </div>
          <ThemeToggle theme={theme} onToggleTheme={onToggleTheme} />
        </div>
        <div className="onboardingGrid">
          <div className="onboardingPrompt">
            <div className="eyebrow">
              <Sparkles size={16} />
              One field
            </div>
            <h2>Where can your specialty do the most good?</h2>
            <p>
              Pick your specialty from the list. Shiftlink ranks the districts with the highest
              unmet need for it and names real candidate host clinics. Geography is optional —
              national ranking is a valid first answer.
            </p>
            <div className="setupNotes">
              <div>
                <Check size={16} />
                One required field, about twenty seconds.
              </div>
              <div>
                <ShieldCheck size={16} />
                You are self-reported and unverified.
              </div>
              <div>
                <X size={16} />
                Do not enter patient-identifying information.
              </div>
            </div>
          </div>
          <form
            className="profileForm"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit) onComplete(specialty);
            }}
          >
            <SpecialtyPicker onResolved={setSpecialty} selectedCanonical={specialty?.canonical} />
            <div className="formActions">
              <button type="submit" className="primaryButton" disabled={!canSubmit}>
                Continue
                <ChevronRight size={18} />
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}

function StatusPill({ status }) {
  const copy = {
    idle: "Ready",
    listening: "Listening",
    transcribing: "Transcribing",
    ready: "Transcript added",
    demo: "Demo transcript"
  }[status];

  return <span className={`statusPill status-${status}`}>{copy}</span>;
}

function ThemeToggle({ theme, onToggleTheme }) {
  const isDark = theme === "dark";
  return (
    <button className="themeToggle" type="button" onClick={onToggleTheme} aria-label="Toggle color theme">
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
      <span>{isDark ? "Light" : "Dark"}</span>
    </button>
  );
}

function TopBar({
  activeView,
  setActiveView,
  shortlistCount,
  approvalCount,
  profile,
  onResetProfile,
  user,
  onLogout,
  theme,
  onToggleTheme
}) {
  const tabs = [
    { id: "search", label: "Recommend", icon: Search },
    { id: "outreach", label: `Outreach (${approvalCount})`, icon: MessageSquareText },
    { id: "schedule", label: "Schedule", icon: CalendarDays },
    { id: "shortlist", label: `Shortlist (${shortlistCount})`, icon: Star }
  ];

  return (
    <header className="topBar">
      <div className="brandLockup compact">
        <span className="brandMark">
          {APP_MARK}
        </span>
        <div>
          <h1>{APP_NAME}</h1>
          <p>{APP_TAGLINE}</p>
        </div>
      </div>
      <nav className="tabNav" aria-label="Primary">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              className={activeView === tab.id ? "active" : ""}
              onClick={() => setActiveView(tab.id)}
            >
              <Icon size={17} />
              {tab.label}
            </button>
          );
        })}
      </nav>
      <div className="accountCluster">
        <ThemeToggle theme={theme} onToggleTheme={onToggleTheme} />
        <div className="profileChip">
          <UserRound size={17} />
          <span>{getDisplayName(user)} · {profile?.primarySpecialtyLabel || profile?.tags?.specialties?.[0] || "Doctor"}</span>
          <button title="Reset profile" onClick={onResetProfile}>
            <X size={14} />
          </button>
        </div>
        <button className="logoutButton" onClick={onLogout}>
          <LogOut size={16} />
          Log out
        </button>
      </div>
    </header>
  );
}

function LeftPanel(props) {
  if (props.activeView === "outreach") {
    return <OutreachPanel {...props} />;
  }
  if (props.activeView === "schedule") {
    return <SchedulerPanel {...props} />;
  }
  if (props.activeView === "shortlist") {
    return <ShortlistPanel {...props} />;
  }
  return <SearchPanel {...props} />;
}

// Recommend tab (interim list; the Recommend-tab feature work layers the impact-
// ranked district cards on top). The faked "coverage assistant" chat is cut
// (integration-spec §2) — the deterministic recommender list IS the answer.
// One impact-ranked district from the pre-ranked slice. Expanding reveals real
// host clinics (and merges them into facilities state). Greenfield districts show
// an honest "no credible host yet" line and are never an outreach/schedule target.
function DistrictCard({
  district,
  expanded,
  onToggle,
  selectedFacilityId,
  setSelectedFacilityId,
  shortlist,
  toggleShortlist,
  createOutreachDraft
}) {
  const tier = district.priority_tier;
  const ctx = districtContext(district.districtKey);
  // Only the recommender's NAMED candidate hosts may become outreach targets — a
  // greenfield district (empty candidate_clinics) shows the honest "no host yet"
  // line and never surfaces arbitrary facilities (Codex). enrichClinics resolves
  // each candidate_clinic facility_id to the full canonical object.
  const hosts = expanded ? enrichClinics(district.candidate_clinics) : [];
  return (
    <article className={`districtCard ${expanded ? "expanded" : ""}`}>
      <button type="button" className="districtHead" onClick={onToggle}>
        <div>
          <h3>
            {district.district_name_norm}, {district.state_ut_norm}
          </h3>
          <div className="districtBadges">
            <span className={`tierBadge tier-${tier}`}>{tier}</span>
            {district.specialty_absent ? (
              <span className="absentBadge">No specialist of your kind here today</span>
            ) : null}
            {district.is_thin_specialty ? (
              <span className="thinBadge">candidate district (limited data)</span>
            ) : null}
          </div>
        </div>
        <div className="impactScore">
          <strong>{district.impact_index}</strong>
          <span>/100</span>
        </div>
      </button>
      {district.driving_needs?.length ? (
        <p className="drivingNeeds">
          <strong>Why:</strong> {district.driving_needs.map(humanizeTag).join(", ")}
        </p>
      ) : null}
      {ctx ? (
        <div className="districtContext">
          {ctx.personaLabel ? <span className="personaTag">{humanizeTag(ctx.personaLabel)}</span> : null}
          {ctx.topPrioritySpecialties?.length ? (
            <p className="otherPriority">
              Other priority specialties here: {ctx.topPrioritySpecialties.slice(0, 4).map(labelFor).join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}
      {expanded ? (
        <div className="hostList">
          {hosts.length ? (
            hosts.map((facility) => (
              <FacilityCard
                key={facility.id}
                facility={facility}
                selected={facility.id === selectedFacilityId}
                shortlisted={shortlist.includes(facility.id)}
                onSelect={() => setSelectedFacilityId(facility.id)}
                onToggleShortlist={() => toggleShortlist(facility.id)}
                onSchedule={() => createOutreachDraft(facility.id)}
              />
            ))
          ) : (
            <p className="greenfield">
              No credible host clinic in the data here yet — not an outreach or schedule target.
            </p>
          )}
        </div>
      ) : null}
    </article>
  );
}

// Recommend tab (onboarding §3): impact-ranked districts for the doctor's specialty,
// read straight from the pre-ranked slice (ZERO app-side ranking). Expanding a
// district reveals real host clinics and MERGES them into the facilities state so
// outreach/scheduler can resolve them by id.
function SearchPanel({
  facilities,
  selectedFacilityId,
  setSelectedFacilityId,
  shortlist,
  toggleShortlist,
  createOutreachDraft,
  mergeFacilities,
  profile
}) {
  const canonical = profile?.primarySpecialtyCanonical || "";
  const label = profile?.primarySpecialtyLabel || (canonical ? labelFor(canonical) : "your specialty");
  const result = useMemo(() => recommendationFor(canonical), [canonical]);
  const signal = signalFor(canonical);
  const [stateFilter, setStateFilter] = useState([]);
  const [expanded, setExpanded] = useState(null);

  const districts = useMemo(
    () => applyStateFilter(result.districts, stateFilter).slice(0, 10),
    [result, stateFilter]
  );
  const stateNarrowedToNational =
    stateFilter.length > 0 &&
    result.districts.length > 0 &&
    !result.districts.some((d) => stateFilter.includes(d.state_ut_norm));

  function toggleExpand(districtKey) {
    setExpanded((current) => (current === districtKey ? null : districtKey));
    // Merge only the recommender's named candidate hosts for this district so
    // outreach/scheduler can resolve them by id (greenfield -> nothing merged).
    const district = result.districts.find((d) => d.districtKey === districtKey);
    const hosts = enrichClinics(district?.candidate_clinics);
    if (hosts.length) mergeFacilities(hosts);
  }

  if (result.status === "no_gap_signal") {
    return (
      <aside className="sidePanel">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">Recommend</p>
            <h2>{label}</h2>
          </div>
        </div>
        <div className="emptyState">
          <AlertCircle size={18} />
          <h3>No NFHS need-gap signal for {label}</h3>
          <p>
            This specialty has no measured health-need gap, so no district ranking can be made from
            health-need gaps. You can still browse host clinics below.
          </p>
        </div>
        <div className="resultStack">
          {facilities.map((facility) => (
            <FacilityCard
              key={facility.id}
              facility={facility}
              selected={facility.id === selectedFacilityId}
              shortlisted={shortlist.includes(facility.id)}
              onSelect={() => setSelectedFacilityId(facility.id)}
              onToggleShortlist={() => toggleShortlist(facility.id)}
              onSchedule={() => createOutreachDraft(facility.id)}
            />
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidePanel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Recommend</p>
          <h2>Highest-need districts for {label}</h2>
        </div>
        <span className="countBadge">{districts.length}</span>
      </div>
      {signal === "best_available" ? (
        <p className="panelHint">
          No high-need districts are measured for this specialty today — here are the best-available
          districts by population-weighted need.
        </p>
      ) : null}
      <div className="stateChips">
        <span className="chipLabel">Add my state:</span>
        {bundledStates.map((state) => (
          <button
            type="button"
            key={state}
            className={`chip ${stateFilter.includes(state) ? "active" : ""}`}
            onClick={() =>
              setStateFilter((current) =>
                current.includes(state) ? current.filter((s) => s !== state) : [...current, state]
              )
            }
          >
            {state}
          </button>
        ))}
      </div>
      {stateNarrowedToNational ? (
        <p className="panelHint">
          Your state isn't among the top-need districts for this specialty in the offline preview —
          showing national high-need districts. Precise state-level ranking arrives with live data.
        </p>
      ) : null}
      <div className="resultStack">
        {districts.map((district) => (
          <DistrictCard
            key={district.districtKey}
            district={district}
            expanded={expanded === district.districtKey}
            onToggle={() => toggleExpand(district.districtKey)}
            selectedFacilityId={selectedFacilityId}
            setSelectedFacilityId={setSelectedFacilityId}
            shortlist={shortlist}
            toggleShortlist={toggleShortlist}
            createOutreachDraft={createOutreachDraft}
          />
        ))}
      </div>
    </aside>
  );
}

// Host-clinic card on the canonical facility object (integration-spec §7.5): no
// trust-tier, no score, no distance. Shows complexity, ownership, and the
// specialist-evidence line; "Draft outreach" is the primary action.
function FacilityCard({ facility, selected, shortlisted, onSelect, onToggleShortlist, onSchedule }) {
  const ownershipLabel =
    facility.ownership === "public" ? "Public" : facility.ownership === "private" ? "Private" : "Ownership unknown";
  const domains = facility.specialistDomainCount || 0;
  const evidenceLine = facility.hasSpecialistEvidence
    ? `${domains} specialist domain${domains === 1 ? "" : "s"} on record`
    : "No specialist evidence on record yet";
  return (
    <article className={`facilityCard ${selected ? "selected" : ""}`} onClick={onSelect}>
      <div className="facilityTopline">
        <div>
          <h3>{facility.name}</h3>
          <p>{[facility.type, facility.city, facility.state].filter(Boolean).join(" · ")}</p>
        </div>
        {facility.complexityTier ? <span className="tierBadge">{facility.complexityTier}</span> : null}
      </div>
      <div className="facilityMeta">
        <span>
          <Hospital size={14} />
          {ownershipLabel}
          {facility.isPublic ? " · public health" : ""}
        </span>
        <span>
          <ShieldCheck size={14} />
          {evidenceLine}
        </span>
      </div>
      {facility.specialtiesList?.length ? (
        <p className="facilityMatch">{facility.specialtiesList.slice(0, 5).map(humanizeSpecialtyLabel).join(" · ")}</p>
      ) : null}
      <div className="cardActions">
        <button type="button" onClick={(event) => runButtonAction(event, onToggleShortlist)}>
          {shortlisted ? <Check size={15} /> : <Plus size={15} />}
          {shortlisted ? "Saved" : "Save"}
        </button>
        <button type="button" onClick={(event) => runButtonAction(event, onSchedule)}>
          <Send size={15} />
          Draft outreach
        </button>
      </div>
    </article>
  );
}

// The right-pane workspace (Google Maps cut, D3). The "Build my week" button (was
// the dead "Optimize" map control) opens the scheduler. The Recommend/Schedule
// feature work fills in the per-view detail; this is the lean container.
function MapWorkspace({
  activeView,
  facilities,
  selectedFacility,
  shortlist,
  toggleShortlist,
  schedule,
  createOutreachDraft,
  onBuildWeek
}) {
  return (
    <section className="mapWorkspace">
      <div className="mapToolbar">
        <div>
          <p className="eyebrow">{activeView === "schedule" ? "Your week" : "District context"}</p>
          <h2>
            {activeView === "schedule"
              ? "Confirmed visits and proposed slots"
              : "Where your specialty closes the biggest gap"}
          </h2>
        </div>
        <button type="button" onClick={onBuildWeek}>
          <Sparkles size={17} />
          Build my week
        </button>
      </div>
      {activeView === "schedule" ? (
        <ScheduleRibbon schedule={schedule} facilities={facilities} />
      ) : selectedFacility ? (
        <div className="contextCard">
          <p className="eyebrow">{selectedFacility.type || "Host clinic"}</p>
          <h3>{selectedFacility.name}</h3>
          <p>{[selectedFacility.city, selectedFacility.state].filter(Boolean).join(", ")}</p>
          {selectedFacility.specialtiesList?.length ? (
            <p className="facilityMatch">{selectedFacility.specialtiesList.slice(0, 6).map(humanizeSpecialtyLabel).join(" · ")}</p>
          ) : null}
          <div className="cardActions">
            <button type="button" onClick={() => createOutreachDraft(selectedFacility.id)}>
              <Send size={15} /> Draft outreach
            </button>
            <button type="button" onClick={() => toggleShortlist(selectedFacility.id)}>
              {shortlist.includes(selectedFacility.id) ? <Check size={15} /> : <Plus size={15} />}
              {shortlist.includes(selectedFacility.id) ? "Saved" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <div className="contextCard">
          <p>Pick a district and a host clinic in Recommend to see its details here.</p>
        </div>
      )}
    </section>
  );
}


function OutreachPanel({
  facilities,
  selectedFacilityId,
  setSelectedFacilityId,
  outreachRequests,
  createOutreachDraft,
  updateOutreachDraft,
  approveOutreach,
  setActiveView
}) {
  const selectedFacility = facilities.find((facility) => facility.id === selectedFacilityId) || facilities[0] || null;

  return (
    <aside className="sidePanel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Human approval</p>
          <h2>Outreach queue</h2>
        </div>
        <span className="countBadge">{outreachRequests.length} drafts</span>
      </div>
      <div className="approvalIntro">
        <AlertCircle size={17} />
        <p>
          The agent can draft and summarize, but the doctor approves outreach, replies, and scheduling
          confirmations before anything becomes a calendar item.
        </p>
      </div>
      <div className="builderForm">
        <label>
          Facility
          <select value={selectedFacilityId} onChange={(event) => setSelectedFacilityId(event.target.value)}>
            {facilities.map((facility) => (
              <option key={facility.id} value={facility.id}>
                {facility.name}
              </option>
            ))}
          </select>
        </label>
        <button className="primaryButton" type="button" onClick={() => createOutreachDraft(selectedFacility.id)}>
          <Mail size={17} />
          Draft outreach for approval
        </button>
      </div>
      <div className="approvalStack">
        {outreachRequests.length ? (
          outreachRequests.map((request) => {
            const facility = facilities.find((item) => item.id === request.facilityId);

            if (request.status === "drafting") {
              return (
                <article className="approvalCard" key={request.id}>
                  <div className="approvalTopline">
                    <div>
                      <span className="statusLabel status-drafting">Drafting</span>
                      <h3>{facility?.name || "Selected facility"}</h3>
                    </div>
                    <Sparkles size={18} />
                  </div>
                  <div className="draftingState">
                    <span className="draftingSpinner" aria-hidden="true" />
                    <span>Drafting with AI…</span>
                  </div>
                </article>
              );
            }

            const availableChannels = request.availableChannels || [];
            const channelValues = request.channelValues || {};
            const selectedChannel = request.selectedChannel || request.recommendedChannel || "none";
            const hasChannel = selectedChannel !== "none" && availableChannels.length > 0;
            const draftBody = request.body || request.message || "";
            const links = buildSendLinks({
              channelValues,
              subject: request.subject,
              body: draftBody
            });

            return (
              <article className="approvalCard" key={request.id}>
                <div className="approvalTopline">
                  <div>
                    <span className={`statusLabel status-${request.status}`}>{formatStatus(request.status)}</span>
                    <h3>{facility?.name || "Selected facility"}</h3>
                    <p>
                      <span className={`sourceBadge ${request.source === "ai" ? "ai" : "template"}`}>
                        {request.source === "ai" ? "AI-drafted" : "Template"}
                      </span>
                      {" · "}
                      {prettyChannelLabel(request.recommendedChannel)}
                    </p>
                  </div>
                  <ShieldCheck size={18} />
                </div>

                {availableChannels.length > 0 && (
                  <div className="channelSelector">
                    {availableChannels.map((channel) => (
                      <button
                        key={`${request.id}-${channel}`}
                        type="button"
                        className={selectedChannel === channel ? "active" : ""}
                        onClick={() =>
                          updateOutreachDraft(request.id, {
                            selectedChannel: channel,
                            destination: request.channelValues?.[channel] || ""
                          })
                        }
                      >
                        {prettyChannelLabel(channel)}
                      </button>
                    ))}
                  </div>
                )}

                {selectedChannel === "email" && (
                  <label className="draftField">
                    Subject
                    <input
                      type="text"
                      value={request.subject || ""}
                      onChange={(event) => updateOutreachDraft(request.id, { subject: event.target.value })}
                    />
                  </label>
                )}

                <label className="draftField">
                  Message
                  <textarea
                    className="draftTextarea"
                    rows={8}
                    value={draftBody}
                    onChange={(event) =>
                      updateOutreachDraft(request.id, { body: event.target.value, message: event.target.value })
                    }
                  />
                </label>

                <div className="sendRow">
                  {selectedChannel === "email" && links.email && (
                    <a className="primaryButton" href={links.email}>
                      <Mail size={16} />
                      Open email draft
                    </a>
                  )}
                  {selectedChannel === "phone" && links.phone && (
                    <a className="primaryButton" href={links.phone}>
                      <Phone size={16} />
                      Call
                    </a>
                  )}
                  {selectedChannel === "whatsapp" && links.whatsapp && (
                    <a className="primaryButton" href={links.whatsapp} target="_blank" rel="noreferrer">
                      <MessageSquareText size={16} />
                      Open WhatsApp
                    </a>
                  )}
                  {(selectedChannel === "website" || selectedChannel === "facebook") && links[selectedChannel] && (
                    <a
                      className="primaryButton"
                      href={links[selectedChannel]}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={16} />
                      Open page
                    </a>
                  )}
                  <button type="button" className="ghostButton" onClick={() => copyText(draftBody)}>
                    <Copy size={16} />
                    Copy message
                  </button>
                </div>

                {selectedChannel === "phone" && request.phoneScript && (
                  <div className="phoneScriptBox">
                    <div className="draftMessage">{request.phoneScript}</div>
                    <button type="button" className="ghostButton" onClick={() => copyText(request.phoneScript)}>
                      <Copy size={16} />
                      Copy script
                    </button>
                  </div>
                )}

                {request.status === "draft" && (
                  <button
                    className="primaryButton"
                    type="button"
                    onClick={() => approveOutreach(request.id)}
                    disabled={!hasChannel}
                    title={hasChannel ? undefined : "No contact channel found for this facility — copy the message and reach out manually."}
                  >
                    <Check size={17} />
                    {hasChannel ? "Approve and mark sent" : "No contact channel"}
                  </button>
                )}
                {request.status === "reply_received" && (
                  <div className="replyBox">
                    <strong>Clinic reply summary</strong>
                    <p>{request.replySummary}</p>
                    <ul className="proposedTimesList">
                      {request.proposedTimes.map((time) => (
                        <li key={`${request.id}-${time.label}`}>
                          <CalendarCheck size={15} />
                          {time.label}
                        </li>
                      ))}
                    </ul>
                    <p className="replyHandoff">
                      Clinic replied — build your week in Schedule to fit these slots around your other visits.
                    </p>
                    <button
                      type="button"
                      className="primaryButton"
                      onClick={() => setActiveView("schedule")}
                    >
                      <CalendarDays size={16} />
                      Build your week in Schedule
                    </button>
                  </div>
                )}
                {request.status === "appointment_confirmed" && (
                  <div className="confirmedNote">
                    <CalendarCheck size={16} />
                    Confirmed on the calendar for {request.approvedTime.label}
                  </div>
                )}
              </article>
            );
          })
        ) : (
          <div className="emptyState">
            <MessageSquareText size={28} />
            <h3>No outreach drafts yet</h3>
            <p>Select a facility and draft an outreach message. Nothing becomes a calendar event without approval.</p>
          </div>
        )}
      </div>
    </aside>
  );
}


// Scheduler tab primary surface (scheduler-final §4, S4). Owns the prefs form +
// fixed-commitments local state, runs the deterministic engine via `runScheduler`,
// and renders the assumptions banner, the proposed-week strip, the Constraint
// Ledger over EVERY replied clinic, and the per-clinic ProposalCards. It NEVER
// confirms a visit itself — approval goes through confirmProposals (the single
// writer), exposed here as approveProposedVisit / approveAllProposedVisits.
function SchedulerPanel({
  facilities,
  schedule,
  outreachRequests,
  scheduleRun,
  runScheduler,
  approveProposedVisit,
  approveAllProposedVisits,
  createOutreachDraft,
  buildTrigger
}) {
  const repliedCount = outreachRequests.filter((r) => r.status === "reply_received").length;

  // Default homeBase: the doctor's first confirmed-visit facility, else facilities[0].
  const firstConfirmedFacilityId = useMemo(() => {
    const confirmed = schedule.find((entry) => entry.status === "confirmed" && entry.facilityId);
    return confirmed?.facilityId || facilities[0]?.id || "";
  }, [schedule, facilities]);

  const seeded = scheduleRun?.prefs || null;
  const [homeBaseId, setHomeBaseId] = useState(
    () => seeded?.homeBase?.id || firstConfirmedFacilityId
  );
  const [windowStart, setWindowStart] = useState(() => seeded?.dateWindow?.start || weekIso[0]);
  const [windowEnd, setWindowEnd] = useState(
    () => seeded?.dateWindow?.end || weekIso[weekIso.length - 1]
  );
  const [maxVisitsPerDay, setMaxVisitsPerDay] = useState(() => seeded?.maxVisitsPerDay ?? 2);
  const [timeOfDayPref, setTimeOfDayPref] = useState(() => seeded?.timeOfDayPref || "any");
  const [mustBeBackBy, setMustBeBackBy] = useState(() => seeded?.mustBeBackBy || "18:00");
  const [defaultVisitMinutes, setDefaultVisitMinutes] = useState(
    () => seeded?.defaultVisitMinutes ?? 120
  );
  const [notes, setNotes] = useState(() => seeded?.notes || "");

  // Manual fixed commitments (ward round, etc.). "No location" -> pure time block.
  const [commitments, setCommitments] = useState(() => scheduleRun?.manualAnchors || []);
  const [draftCommitment, setDraftCommitment] = useState({
    facilityId: "",
    date: weekIso[0],
    time: "09:00",
    label: "Ward round"
  });

  // If the homeBase facility is dropped from state, fall back to a valid id.
  useEffect(() => {
    if (homeBaseId && !facilities.some((f) => f.id === homeBaseId)) {
      setHomeBaseId(firstConfirmedFacilityId);
    } else if (!homeBaseId && firstConfirmedFacilityId) {
      setHomeBaseId(firstConfirmedFacilityId);
    }
  }, [facilities, homeBaseId, firstConfirmedFacilityId]);

  function assemblePrefs() {
    const home = facilities.find((f) => f.id === homeBaseId) || null;
    return {
      homeBase: home
        ? { id: home.id, lat: home.lat ?? null, lng: home.lng ?? null, city: home.city }
        : { id: "", lat: null, lng: null },
      dateWindow: { start: windowStart, end: windowEnd },
      maxVisitsPerDay: Number(maxVisitsPerDay) || 2,
      timeOfDayPref,
      mustBeBackBy,
      defaultVisitMinutes: Number(defaultVisitMinutes) || 120,
      notes
    };
  }

  function assembleManualAnchors() {
    return commitments.map((c, i) => {
      const facility = c.facilityId ? facilities.find((f) => f.id === c.facilityId) : null;
      return {
        id: c.id || `commitment-${i}`,
        facilityName: facility?.name || c.label || "Commitment",
        date: c.date,
        time: c.time,
        durationMinutes: Number(defaultVisitMinutes) || 120,
        lat: facility && typeof facility.lat === "number" ? facility.lat : null,
        lng: facility && typeof facility.lng === "number" ? facility.lng : null,
        source: "manual"
      };
    });
  }

  function handleBuild() {
    runScheduler(assemblePrefs(), assembleManualAnchors());
  }

  // The MapWorkspace "Build my week" button bumps buildTrigger; run on each bump
  // (skip the initial mount so we don't auto-run before the doctor sets prefs).
  const lastTriggerRef = useRef(buildTrigger);
  useEffect(() => {
    if (buildTrigger !== lastTriggerRef.current) {
      lastTriggerRef.current = buildTrigger;
      handleBuild();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildTrigger]);

  function addCommitment() {
    if (!draftCommitment.date || !draftCommitment.time) return;
    setCommitments((current) => [
      ...current,
      { ...draftCommitment, id: crypto.randomUUID() }
    ]);
  }

  function removeCommitment(id) {
    setCommitments((current) => current.filter((c) => c.id !== id));
  }

  const proposals = scheduleRun?.proposals || [];
  const accepted = proposals.filter((p) => p.verdict === "accepted");
  const needsNew = proposals.filter((p) => p.verdict === "needs_new_times");
  const acceptedUnapproved = accepted.filter((p) => p.approved !== true);
  // Ledger order: accepted first, then needs_new_times (scheduler-final §4).
  const ledgerOrder = [...accepted, ...needsNew];

  return (
    <aside className="sidePanel schedulePanel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Schedule</p>
          <h2>Build my week</h2>
        </div>
        <span className="countBadge">{repliedCount} clinic{repliedCount === 1 ? "" : "s"} replied</span>
      </div>

      <div className="approvalIntro">
        <AlertCircle size={17} />
        <p>
          The engine plans only over slots clinics already proposed — it never invents a time or
          assumes a clinic is free. Every visit still needs your approval.
        </p>
      </div>

      <div className="builderForm">
        <label>
          Home base
          <select value={homeBaseId} onChange={(event) => setHomeBaseId(event.target.value)}>
            {facilities.length === 0 ? <option value="">No facilities yet</option> : null}
            {facilities.map((facility) => (
              <option key={facility.id} value={facility.id}>
                {facility.name}
              </option>
            ))}
          </select>
        </label>
        <div className="formSplit">
          <label>
            Window start
            <select value={windowStart} onChange={(event) => setWindowStart(event.target.value)}>
              {weekIso.map((iso) => (
                <option key={iso} value={iso}>
                  {isoToWeekLabel(iso)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Window end
            <select value={windowEnd} onChange={(event) => setWindowEnd(event.target.value)}>
              {weekIso.map((iso) => (
                <option key={iso} value={iso}>
                  {isoToWeekLabel(iso)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="formSplit">
          <label>
            Max visits / day
            <input
              type="number"
              min={1}
              max={5}
              value={maxVisitsPerDay}
              onChange={(event) => setMaxVisitsPerDay(event.target.value)}
            />
          </label>
          <label>
            Time of day
            <select value={timeOfDayPref} onChange={(event) => setTimeOfDayPref(event.target.value)}>
              <option value="any">Any time</option>
              <option value="morning">Mornings</option>
              <option value="afternoon">Afternoons</option>
            </select>
          </label>
        </div>
        <div className="formSplit">
          <label>
            Back home by
            <input
              type="time"
              value={mustBeBackBy}
              onChange={(event) => setMustBeBackBy(event.target.value)}
            />
          </label>
          <label>
            Visit length (min)
            <input
              type="number"
              min={30}
              step={15}
              value={defaultVisitMinutes}
              onChange={(event) => setDefaultVisitMinutes(event.target.value)}
            />
          </label>
        </div>
        <label>
          Notes
          <textarea
            className="draftTextarea"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Optional. Shown to you as-is; it does not change the schedule."
          />
        </label>

        <div className="commitmentsSection">
          <h3>Fixed commitments</h3>
          <p className="commitmentsHint">
            Ward rounds, existing meetings — the engine plans around these and never moves them.
          </p>
          <div className="formSplit">
            <label>
              Where
              <select
                value={draftCommitment.facilityId}
                onChange={(event) =>
                  setDraftCommitment((c) => ({ ...c, facilityId: event.target.value }))
                }
              >
                <option value="">No location — time block only</option>
                {facilities.map((facility) => (
                  <option key={facility.id} value={facility.id}>
                    {facility.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Day
              <select
                value={draftCommitment.date}
                onChange={(event) => setDraftCommitment((c) => ({ ...c, date: event.target.value }))}
              >
                {weekIso.map((iso) => (
                  <option key={iso} value={iso}>
                    {isoToWeekLabel(iso)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="formSplit">
            <label>
              Time
              <input
                type="time"
                value={draftCommitment.time}
                onChange={(event) => setDraftCommitment((c) => ({ ...c, time: event.target.value }))}
              />
            </label>
            <label>
              Label
              <input
                value={draftCommitment.label}
                onChange={(event) => setDraftCommitment((c) => ({ ...c, label: event.target.value }))}
              />
            </label>
          </div>
          <button type="button" className="ghostButton" onClick={addCommitment}>
            <Plus size={15} /> Add commitment
          </button>
          {commitments.length ? (
            <ul className="commitmentsList">
              {commitments.map((c) => {
                const facility = c.facilityId
                  ? facilities.find((f) => f.id === c.facilityId)
                  : null;
                return (
                  <li key={c.id}>
                    <span>
                      {isoToWeekLabel(c.date)} · {c.time} ·{" "}
                      {facility?.name || c.label || "Time block"}
                    </span>
                    <button title="Remove commitment" onClick={() => removeCommitment(c.id)}>
                      <Trash2 size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        <button className="primaryButton" type="button" onClick={handleBuild}>
          <Sparkles size={17} />
          Build my week
        </button>
      </div>

      {scheduleRun ? (
        <>
          {scheduleRun.narrative?.tradeoffSummary ? (
            <div className="tradeoffSummary">
              <p>{scheduleRun.narrative.tradeoffSummary}</p>
            </div>
          ) : null}

          <div className="assumptionsBanner">
            <p className="assumptionsTitle">
              <ShieldCheck size={15} /> Assumptions this week is built on
            </p>
            <ul>
              {(scheduleRun.assumptions || ASSUMPTIONS).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="killerLine">{KILLER_LINE}</p>
          </div>

          {acceptedUnapproved.length > 0 ? (
            <div className="approvalStack">
              <div className="approvalIntro">
                <CalendarCheck size={17} />
                <p>
                  {accepted.length} visit{accepted.length === 1 ? "" : "s"} fit this week. Approve to
                  add them to your calendar.
                </p>
              </div>
              <button
                type="button"
                className="primaryButton"
                onClick={approveAllProposedVisits}
              >
                <Check size={16} /> Approve all {acceptedUnapproved.length}
              </button>
              {accepted.map((proposal) => (
                <ProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  onApprove={() => approveProposedVisit(proposal.id)}
                />
              ))}
            </div>
          ) : null}

          <div className="ledgerSection">
            <div className="requestSectionHeader">
              <h3>Constraint Ledger</h3>
              <span>{ledgerOrder.length} clinic{ledgerOrder.length === 1 ? "" : "s"}</span>
            </div>
            {ledgerOrder.length ? (
              ledgerOrder.map((proposal) => (
                <LedgerCard
                  key={proposal.id}
                  proposal={proposal}
                  onAskNewTimes={() => createOutreachDraft(proposal.facilityId)}
                />
              ))
            ) : (
              <div className="emptyState compactEmpty">
                <ClipboardList size={24} />
                <h3>No clinics replied yet</h3>
                <p>When a clinic replies with proposed times, build your week to see the ledger.</p>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="emptyState">
          <CalendarDays size={28} />
          <h3>Build your visit week</h3>
          <p>
            Set your preferences and any fixed commitments, then build my week to fit the clinics that
            have replied around them.
          </p>
        </div>
      )}
    </aside>
  );
}

// One accepted-clinic card with an Approve button (scheduler-final §4/§6). Approval
// routes through confirmProposals (the single writer); already-approved proposals
// show a confirmed note instead of a button.
function ProposalCard({ proposal, onApprove }) {
  const slot = proposal.slot;
  return (
    <article className="approvalCard proposalCard">
      <div className="approvalTopline">
        <div>
          <span className="statusLabel status-accepted">Fits</span>
          <h3>{proposal.facilityName}</h3>
          <p>
            {slot ? `${isoToWeekLabel(slot.date)} · ${slot.time}–${proposal.endTime}` : ""}
          </p>
        </div>
        <CalendarCheck size={18} />
      </div>
      <p className="proposalSlotLabel">{slot?.label}</p>
      {proposal.approved ? (
        <div className="confirmedNote">
          <CalendarCheck size={16} />
          Confirmed on the calendar
        </div>
      ) : (
        <button type="button" className="primaryButton" onClick={onApprove}>
          <Check size={16} /> Approve visit
        </button>
      )}
    </article>
  );
}

// One Constraint Ledger card per replied clinic (scheduler-final §3.1/§4). Renders
// for accepted AND needs_new_times clinics: the conflict status, the chosen slot,
// every considered slot with its outcome, the per-leg travel buffers with bands,
// the assumptions that applied, and the engine's reason. needs_new_times clinics
// offer an "Ask for new times" link -> createOutreachDraft (its dedup guard routes
// to the existing open thread).
function LedgerCard({ proposal, onAskNewTimes }) {
  const ledger = proposal.ledger || {};
  const accepted = proposal.verdict === "accepted";
  return (
    <article className={`ledgerCard ${accepted ? "accepted" : "needsNew"}`}>
      <div className="ledgerHead">
        <div>
          <span className={`ledgerVerdict verdict-${proposal.verdict}`}>
            {accepted ? "Scheduled" : "Needs new times"}
          </span>
          <h3>{proposal.facilityName}</h3>
        </div>
        <span className={`conflictStatus status-${ledger.conflictStatus}`}>
          {humanizeTag(ledger.conflictStatus || "")}
        </span>
      </div>

      {ledger.reason ? <p className="ledgerReason">{ledger.reason}</p> : null}

      {ledger.chosenSlot ? (
        <p className="ledgerChosen">
          <CalendarCheck size={14} /> Chose {ledger.chosenSlot.label} ({ledger.chosenSlot.time}–
          {ledger.chosenSlot.endTime})
        </p>
      ) : null}

      {ledger.consideredSlots?.length ? (
        <div className="ledgerSlots">
          <p className="ledgerSubhead">Slots considered</p>
          <ul>
            {ledger.consideredSlots.map((slot, i) => (
              <li key={`${slot.label}-${i}`} className={`slot-${slot.outcome}`}>
                <strong>{slot.label}</strong>
                {slot.note ? <span> — {slot.note}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {ledger.legBuffers?.length ? (
        <div className="ledgerLegs">
          <p className="ledgerSubhead">Travel buffers</p>
          <ul>
            {ledger.legBuffers.map((leg, i) => (
              <li key={`${leg.from}-${leg.to}-${i}`}>
                {leg.from} → {leg.to}:{" "}
                {leg.band === "unknown_location"
                  ? "travel not checked"
                  : `${leg.km != null ? `${leg.km} km · ` : ""}${leg.minutes} min (${leg.band})`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {ledger.anchorImpact?.note ? (
        <p className="ledgerAnchor">
          <Clock3 size={13} /> {ledger.anchorImpact.note}
        </p>
      ) : null}

      {!accepted ? (
        <button type="button" className="ghostButton" onClick={onAskNewTimes}>
          <Send size={14} /> Ask for new times
        </button>
      ) : null}
    </article>
  );
}

function ScheduleRibbon({ schedule, facilities }) {
  return (
    <div className="scheduleRibbon">
      {weekDays.map((day) => {
        const dayNumber = day.match(/Jun (\d+)/)?.[1];
        const entries = schedule.filter((entry) => entry.date.endsWith(`-${dayNumber?.padStart(2, "0")}`));
        return (
          <div className="dayColumn" key={day}>
            <h3>{day}</h3>
            {entries.length ? (
              entries.map((entry) => {
                const facility = facilities.find((item) => item.id === entry.facilityId);
                const facilityName = facility?.name || entry.facilityName || "Hospital visit";
                return (
                  <div className={`visitBlock ${entry.status || "planned"}`} key={entry.id}>
                    <span>
                      <Clock3 size={13} />
                      {entry.time}
                    </span>
                    <strong>{facilityName}</strong>
                    <p>{entry.purpose}</p>
                    <em>{formatStatus(entry.status || "planned")}</em>
                  </div>
                );
              })
            ) : (
              <p className="emptyDay">Open</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ShortlistPanel({
  facilities,
  shortlist,
  selectedFacilityId,
  setSelectedFacilityId,
  toggleShortlist,
  createOutreachDraft
}) {
  const savedFacilities = facilities.filter((facility) => shortlist.includes(facility.id));

  return (
    <aside className="sidePanel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Shortlist</p>
          <h2>Saved facilities</h2>
        </div>
        <span className="countBadge">{savedFacilities.length} saved</span>
      </div>
      <div className="shortlistStack">
        {savedFacilities.length ? (
          savedFacilities.map((facility) => (
            <FacilityCard
              key={facility.id}
              facility={facility}
              selected={facility.id === selectedFacilityId}
              shortlisted
              onSelect={() => setSelectedFacilityId(facility.id)}
              onToggleShortlist={() => toggleShortlist(facility.id)}
              onSchedule={() => createOutreachDraft(facility.id)}
            />
          ))
        ) : (
          <div className="emptyState">
            <ClipboardList size={28} />
            <h3>No saved facilities</h3>
            <p>Save facilities from search to compare evidence and plan outreach.</p>
          </div>
        )}
      </div>
    </aside>
  );
}

function mapFacilityForApi(facility) {
  return {
    id: facility.id,
    name: facility.name,
    type: facility.type,
    city: facility.city,
    state: facility.state,
    email: facility.email || null,
    phone: facility.phone || null,
    website: facility.website || null,
    facebook: facility.facebook || null,
    capabilities: facility.specialtiesList || []
  };
}

function buildDoctorForApi(user, profile) {
  return {
    name: getDisplayName(user),
    specialties: profile?.primarySpecialtyCanonical
      ? [profile.primarySpecialtyCanonical]
      : profile?.tags?.specialties || [],
    regions: profile?.geography?.preferredStatesNorm?.length
      ? profile.geography.preferredStatesNorm
      : profile?.tags?.regions || [],
    experienceYears: profile?.tags?.experience || null
  };
}

function copyText(text) {
  try {
    navigator.clipboard?.writeText(text || "");
  } catch {
    // Clipboard may be unavailable (insecure context / permissions); ignore.
  }
}

const CHANNEL_LABELS = {
  email: "Email",
  phone: "Phone / SMS",
  whatsapp: "WhatsApp",
  website: "Website",
  facebook: "Facebook",
  none: "No contact channel"
};

function prettyChannelLabel(channel) {
  return CHANNEL_LABELS[channel] || "Contact";
}

// mailto recipients must not carry header-injection characters (a facility email
// like "x@y.com?bcc=evil" would otherwise smuggle a bcc header into the draft).
// Keep only the leading address-looking token, dropping anything from the first
// disallowed char onward.
function sanitizeEmailRecipient(raw) {
  const s = String(raw || "").trim();
  const cut = s.search(/[\s?&,;<>"'()]/);
  const addr = cut === -1 ? s : s.slice(0, cut);
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr) ? addr : "";
}

// tel: links should be digits and an optional leading "+" only.
function sanitizeTel(raw) {
  const s = String(raw || "").trim();
  const plus = s.startsWith("+") ? "+" : "";
  const digits = s.replace(/[^\d]/g, "");
  return digits ? plus + digits : "";
}

function buildSendLinks(draft) {
  const values = draft.channelValues || {};
  const subject = draft.subject || "";
  const body = draft.body || "";
  const links = {};
  if (values.email) {
    const to = sanitizeEmailRecipient(values.email);
    if (to) {
      links.email = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    }
  }
  if (values.phone) {
    const tel = sanitizeTel(values.phone);
    if (tel) links.phone = `tel:${tel}`;
  }
  if (values.whatsapp) {
    links.whatsapp = `${values.whatsapp}?text=${encodeURIComponent(body)}`;
  }
  if (values.website) {
    links.website = values.website;
  }
  if (values.facebook) {
    links.facebook = values.facebook;
  }
  return links;
}

function humanizeSpecialtyLabel(token) {
  return String(token)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\bAnd\b/g, "and")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// snake_case gold tag (driving_needs / top_need_categories / persona_label) -> Title Case.
function humanizeTag(token) {
  return String(token || "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function ensureUrlClient(url) {
  if (!url) return null;
  const trimmed = String(url).trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// Local fallback that mirrors the server's deterministic channel + template logic
// so the UI still works if /api/outreach is unreachable.
function localOutreachDraft(facility, doctor) {
  const email = (facility.email || "").trim() || null;
  const phone = (facility.phone || "").trim() || null;
  const website = ensureUrlClient(facility.website);
  const facebook = ensureUrlClient(facility.facebook);

  const phoneRaw = phone ? phone.replace(/[^\d]/g, "") : "";
  const local = phoneRaw.startsWith("91") && phoneRaw.length === 12 ? phoneRaw.slice(2) : phoneRaw;
  const isMobile = local.length === 10 && /^[6-9]/.test(local);
  const whatsapp = isMobile ? `https://wa.me/${phoneRaw}` : null;

  const channelValues = { email, phone, website, facebook, whatsapp };
  const order = ["email", "phone", "whatsapp", "website", "facebook"];
  const availableChannels = order.filter((channel) => channelValues[channel]);
  const recommendedChannel = availableChannels[0] || "none";

  const specialty = humanizeSpecialtyLabel(doctor?.specialties?.[0] || "medical");
  const name = (doctor?.name || "").trim() || "Dr.";
  const facName = (facility.name || "").trim() || "your facility";
  const place = (facility.city || "").trim() || (facility.state || "").trim() || "your area";
  const capabilities = Array.isArray(facility.specialtiesList) ? facility.specialtiesList.slice(0, 3).map(humanizeSpecialtyLabel) : [];
  const needLine = capabilities.length
    ? ` I see your team already offers ${capabilities.join(", ")}, and I would be glad to add capacity alongside them.`
    : "";

  const body = `Dear team at ${facName},

My name is ${name} and I am a ${specialty} doctor interested in volunteering my time to support clinics and hospitals near ${place}.${needLine} I would welcome a short introductory conversation to explore whether my background could be useful to your patients.

Thank you for your time, and I look forward to hearing from you.

Warm regards,
${name}`;
  const phoneScript = `Hello, this is ${name}, a ${specialty} doctor. I'd love a brief chat about volunteering to support ${facName} with clinical visits. Is there a good time to talk?`;

  return {
    recommendedChannel,
    availableChannels,
    channelValues,
    subject: recommendedChannel === "email" ? `Introduction from ${name}, ${specialty} doctor` : null,
    body,
    phoneScript,
    source: "template"
  };
}

function getApprovalCount(outreachRequests, incomingHospitalRequests = []) {
  const outreachApprovals = outreachRequests.filter((request) =>
    ["draft", "reply_received"].includes(request.status)
  ).length;
  const doctorApprovals = incomingHospitalRequests.filter((request) => request.status === "pending").length;
  return outreachApprovals + doctorApprovals;
}

function formatStatus(status) {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function mergeTranscript(current, transcript) {
  return current.trim() ? `${current.trim()}\n\n${transcript}` : transcript;
}

function runButtonAction(event, action) {
  event.stopPropagation();
  action();
}


export default App;
