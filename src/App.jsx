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
import { CANONICAL_SPECIALTIES, labelFor, resolveSpecialty } from "./specialties.js";
import {
  recommendationFor,
  applyStateFilter,
  facilitiesForDistrict,
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

const requestStatusMeta = {
  planned: { label: "Planned", className: "statusPlanned" },
  pending: { label: "Pending", className: "statusPending" },
  approved: { label: "Approved", className: "statusApproved" },
  denied: { label: "Denied", className: "statusDenied" },
  confirmed: { label: "Confirmed", className: "statusApproved" },
  pending_approval: { label: "Needs approval", className: "statusPending" }
};

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
  let canonical = null;
  if ((res.status === "matched" || res.status === "confirm" || res.status === "ambiguous") && res.candidates.length) {
    canonical = res.candidates[0];
  }
  if (!canonical) canonical = "internal_medicine";
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
      saveJson(profileKey, migrated);
      return migrated;
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
  const draftingFacilitiesRef = useRef(new Set());

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

  // Local schedule add (no two-way request — the hospital flow is cut). The
  // scheduler's confirmProposals is the primary clinic-reply -> confirmed path.
  function addSchedule(entry, options = {}) {
    const nextEntry = {
      ...entry,
      id: crypto.randomUUID(),
      requestId: options.requestId || entry.requestId || "",
      status: options.status || entry.status || "planned",
      approvalStatus: options.approvalStatus || entry.approvalStatus || "doctor_approved",
      calendarStatus: options.calendarStatus || entry.calendarStatus || "calendar_event_created",
      source: options.source || entry.source || "manual"
    };
    updateSchedule((current) => [nextEntry, ...current]);
    setActiveView("schedule");
    return nextEntry;
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
          district_need: facility.match || null,
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

  function approveClinicTime(requestId, proposedTime) {
    const request = outreachRequests.find((item) => item.id === requestId);
    if (!request) return;
    const facility = facilities.find((item) => item.id === request.facilityId);
    if (!facility) return;

    addSchedule(
      {
        facilityId: request.facilityId,
        date: proposedTime.date,
        time: proposedTime.time,
        purpose: `${request.channel} follow-up with ${facility.name}`
      },
      {
        createRequest: false,
        status: "confirmed",
        approvalStatus: "doctor_approved",
        calendarStatus: "calendar_event_created",
        source: "clinic_reply"
      }
    );

    persistOutreachRequests(
      outreachRequests.map((item) =>
        item.id === requestId
          ? {
              ...item,
              status: "appointment_confirmed",
              schedulingApprovalStatus: "doctor_approved",
              approvedTime: proposedTime,
              confirmedAt: new Date().toISOString()
            }
          : item
      )
    );
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
          addSchedule={addSchedule}
          removeSchedule={removeSchedule}
          profile={profile}
          mergeFacilities={mergeFacilities}
          outreachRequests={outreachRequests}
          createOutreachDraft={createOutreachDraft}
          updateOutreachDraft={updateOutreachDraft}
          approveOutreach={approveOutreach}
          approveClinicTime={approveClinicTime}
        />
        <MapWorkspace
          activeView={activeView}
          facilities={facilities}
          selectedFacility={selectedFacility}
          shortlist={shortlist}
          toggleShortlist={toggleShortlist}
          schedule={schedule}
          createOutreachDraft={createOutreachDraft}
          onBuildWeek={() => setActiveView("schedule")}
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
    { id: "search", label: "Search", icon: Search },
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
    return <SchedulePanel {...props} />;
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
  const hosts = expanded ? facilitiesForDistrict(district.districtKey) : [];
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
    const hosts = facilitiesForDistrict(districtKey);
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
  approveClinicTime
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
                    <div className="slotGrid">
                      {request.proposedTimes.map((time) => (
                        <button key={`${request.id}-${time.label}`} onClick={() => approveClinicTime(request.id, time)}>
                          <CalendarCheck size={15} />
                          Approve {time.label}
                        </button>
                      ))}
                    </div>
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


function ScheduleRequestCard({
  request,
  onApprove,
  onDeny,
  title = request.doctorName,
  subtitle = request.doctorEmail,
  approveLabel = "Approve",
  denyLabel = "Deny"
}) {
  const meta = requestStatusMeta[request.status] || requestStatusMeta.pending;

  return (
    <article className="requestCard">
      <div className="requestHeader">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <span className={`requestStatus ${meta.className}`}>{meta.label}</span>
      </div>
      <div className="requestDetails">
        <span>
          <CalendarDays size={15} />
          {request.visitDate}
        </span>
        <span>
          <Clock3 size={15} />
          {request.visitTime}
        </span>
      </div>
      <p className="requestPurpose">{request.purpose}</p>
      {request.status === "pending" && onApprove && onDeny && (
        <div className="requestActions">
          <button className="approveButton" onClick={onApprove}>
            <Check size={16} />
            {approveLabel}
          </button>
          <button className="denyButton" onClick={onDeny}>
            <X size={16} />
            {denyLabel}
          </button>
        </div>
      )}
    </article>
  );
}

function SchedulePanel({
  facilities,
  schedule,
  addSchedule,
  removeSchedule,
  requests = [],
  incomingHospitalRequests = [],
  onAcceptHospitalRequest,
  onDenyHospitalRequest
}) {
  const [facilityId, setFacilityId] = useState(facilities[0]?.id ?? "");
  const [date, setDate] = useState("2026-06-17");
  const [time, setTime] = useState("09:30");
  const [purpose, setPurpose] = useState("Volunteer screening camp");
  const pendingHospitalRequests = incomingHospitalRequests.filter((request) => request.status === "pending");

  return (
    <aside className="sidePanel schedulePanel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Schedule</p>
          <h2>Visit builder</h2>
        </div>
        <span className="countBadge">{schedule.length} planned</span>
      </div>
      <section className="incomingRequestList">
        <div className="requestSectionHeader">
          <h3>Hospital requests</h3>
          <span>{pendingHospitalRequests.length} pending</span>
        </div>
        {incomingHospitalRequests.length ? (
          incomingHospitalRequests.map((request) => (
            <ScheduleRequestCard
              key={request.id}
              request={request}
              title={request.facilityName}
              subtitle={`Requested by ${request.requestedByName || request.facilityName}`}
              approveLabel="Accept"
              denyLabel="Decline"
              onApprove={() => onAcceptHospitalRequest(request)}
              onDeny={() => onDenyHospitalRequest(request)}
            />
          ))
        ) : (
          <div className="emptyState compactEmpty">
            <Hospital size={24} />
            <h3>No hospital requests</h3>
            <p>When a hospital requests your time, you can accept it into this schedule.</p>
          </div>
        )}
      </section>
      <form
        className="builderForm"
        onSubmit={(event) => {
          event.preventDefault();
          addSchedule({ facilityId, date, time, purpose });
        }}
      >
        <label>
          Facility
          <select value={facilityId} onChange={(event) => setFacilityId(event.target.value)}>
            {facilities.map((facility) => (
              <option key={facility.id} value={facility.id}>
                {facility.name}
              </option>
            ))}
          </select>
        </label>
        <div className="formSplit">
          <label>
            Date
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label>
            Time
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
          </label>
        </div>
        <label>
          Purpose
          <input value={purpose} onChange={(event) => setPurpose(event.target.value)} />
        </label>
        <button className="primaryButton" type="submit">
          <Plus size={17} />
          Add visit
        </button>
      </form>
      <div className="plannedList">
        {schedule.map((entry) => {
          const facility = facilities.find((item) => item.id === entry.facilityId);
          const request = requests.find((item) => item.id === entry.requestId);
          const meta = requestStatusMeta[request?.status || entry.status || "planned"] || requestStatusMeta.planned;
          const facilityName = facility?.name || request?.facilityName || entry.facilityName || "Hospital visit";
          return (
            <div className="plannedItem" key={entry.id}>
              <div>
                <h3>{facilityName}</h3>
                <p>
                  {entry.date} · {entry.time}
                </p>
                <span className={`requestStatus ${meta.className}`}>{meta.label}</span>
                <span>{entry.purpose}</span>
              </div>
              <button title="Remove visit" onClick={() => removeSchedule(entry.id)}>
                <Trash2 size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
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
  const need = (facility.match || "").trim();
  const needLine = need ? ` I am especially interested in supporting local needs such as ${need}.` : "";

  const body = `Dear team at ${facName},

My name is ${name} and I am a ${specialty} doctor interested in supporting clinics and hospitals near ${place} through referrals and volunteer work.${needLine} I would welcome a short introductory conversation to explore whether my background could be useful to your patients.

Thank you for your time, and I look forward to hearing from you.

Warm regards,
${name}`;
  const phoneScript = `Hello, this is ${name}, a ${specialty} doctor. I'd love a brief chat about supporting ${facName} with referrals or volunteer visits. Is there a good time to talk?`;

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
