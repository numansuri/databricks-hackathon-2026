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
  LoaderCircle,
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

const APP_NAME = "Shiftlink";
const APP_MARK = "SL";
const APP_TAGLINE = "Hospital exchange";
const THEME_KEY = "shiftlinkTheme";
const USER_DATABASE_KEY = "referralCopilotUsers";
const SESSION_USER_KEY = "referralCopilotSessionUserId";
const SCHEDULE_REQUESTS_KEY = "referralCopilotScheduleRequests";
const SAMPLE_PROFILE_TEXT =
  "I am a general physician with eight years of experience in diabetes and hypertension care. I can volunteer monthly for rural screening camps and prefer facilities in Gujarat, Rajasthan, and Maharashtra.";
const DEMO_PROFILE_TRANSCRIPT =
  "I am a cardiologist with 10 years of ICU experience. I can support emergency cardiac referrals, hypertension care, and volunteer cardiac screening camps in Gujarat and Rajasthan.";

const facilities = [
  {
    id: "shaurya",
    name: "Shaurya Heart & Critical Care",
    type: "Multispecialty hospital",
    city: "Ahmedabad",
    state: "Gujarat",
    distanceKm: 4.2,
    tier: "strong",
    score: 4.6,
    lat: 23.0225,
    lng: 72.5714,
    phone: "+91 98251 47300",
    email: "referrals@shauryaheart.in",
    match: "Cardiology, ICU, emergency procedure support",
    evidence: [
      { field: "capability", text: "Critical care, cardiology, cardiac emergency stabilization" },
      { field: "procedure", text: "Angiography support, post-operative cardiac monitoring" },
      { field: "equipment", text: "ICU beds, ventilator support, cardiac monitors" }
    ],
    flags: ["Pincode-verified coordinates"],
    map: { x: 56, y: 42 }
  },
  {
    id: "city",
    name: "City Medical Institute",
    type: "Referral center",
    city: "Gandhinagar",
    state: "Gujarat",
    distanceKm: 18.7,
    tier: "partial",
    score: 2.8,
    lat: 23.2156,
    lng: 72.6369,
    phone: "+91 79401 88820",
    email: "care@citymedical.in",
    match: "Internal medicine, diagnostics, cardiology claims",
    evidence: [
      { field: "specialties", text: "Internal medicine, cardiology outpatient care" },
      { field: "description", text: "Handles cardiac symptoms and routine diagnostics" }
    ],
    flags: ["Capability appears in description only"],
    map: { x: 66, y: 28 }
  },
  {
    id: "metro",
    name: "Metro Community Clinic",
    type: "Clinic",
    city: "Sanand",
    state: "Gujarat",
    distanceKm: 31.4,
    tier: "weak",
    score: 1.4,
    lat: 22.9924,
    lng: 72.3817,
    phone: "+91 27172 22440",
    email: "",
    match: "Basic triage, low-volume cardiac evidence",
    evidence: [
      { field: "description", text: "Mentions heart and diabetes screening camps" }
    ],
    flags: ["Single source only", "Low physician count for hospital-level service"],
    map: { x: 36, y: 56 }
  }
];

const quickPrompts = [
  "Emergency cardiac care near Ahmedabad",
  "Volunteer cardiology camp in rural Rajasthan",
  "Facilities with ICU equipment and reliable phone contacts"
];

const weekDays = [
  "Mon, Jun 15",
  "Tue, Jun 16",
  "Wed, Jun 17",
  "Thu, Jun 18",
  "Fri, Jun 19"
];

const tierMeta = {
  strong: { label: "Strong", className: "tierStrong" },
  partial: { label: "Partial", className: "tierPartial" },
  weak: { label: "Weak", className: "tierWeak" }
};

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

function getFacilityName(facilityId) {
  return facilities.find((facility) => facility.id === facilityId)?.name || "Unknown facility";
}

function getRequestDirection(request) {
  return request.direction || "doctor_to_hospital";
}

function normalizeOptionalUrl(url) {
  const trimmed = url.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function getHospitalProfile(user) {
  return (
    user.hospitalProfile || {
      name: getDisplayName(user),
      streetAddress: "",
      phone: "",
      facebookUrl: ""
    }
  );
}

function getHospitalFacility(user) {
  if (!user) return facilities[0];
  const legacyFacility = facilities.find((item) => item.id === user.facilityId);
  if (legacyFacility && !user.hospitalProfile) return legacyFacility;

  const profile = getHospitalProfile(user);
  const evidence = [
    { field: "Hospital-entered address", text: profile.streetAddress || "Not provided" },
    { field: "Hospital-entered phone", text: profile.phone || "Not provided" }
  ];
  if (profile.facebookUrl) {
    evidence.push({ field: "Facebook page", text: profile.facebookUrl });
  }

  return {
    id: user.facilityId || `hospital-${user.id}`,
    name: profile.name || getDisplayName(user),
    type: "Hospital profile",
    city: profile.streetAddress || "Local profile",
    state: "",
    distanceKm: 0,
    tier: "partial",
    score: 2,
    lat: 23.0225,
    lng: 72.5714,
    phone: profile.phone,
    email: user.email,
    facebookUrl: profile.facebookUrl,
    addressLine: profile.streetAddress,
    match: "Hospital-entered account profile",
    evidence,
    flags: ["Self-reported hospital profile"],
    map: { x: 50, y: 50 }
  };
}

function createDoctorProfile(userId, rawText) {
  return {
    doctorId: userId,
    rawText,
    tags: extractLocalTags(rawText),
    createdAt: new Date().toISOString()
  };
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
  const [requests, setRequests] = useState(() => readJson(SCHEDULE_REQUESTS_KEY, []));
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

  function persistRequests(nextRequests) {
    saveJson(SCHEDULE_REQUESTS_KEY, nextRequests);
    setRequests(nextRequests);
  }

  function signUp({ name, email, password, role, profileText, hospitalStreetAddress, hospitalPhone, hospitalFacebookUrl }) {
    const normalizedEmail = normalizeEmail(email);
    if (users.some((user) => user.email === normalizedEmail)) {
      return { ok: false, message: "An account already exists for that email." };
    }
    const userId = crypto.randomUUID();
    const trimmedProfileText = profileText?.trim() || "";
    const hospitalProfile =
      role === "hospital"
        ? {
            name: name.trim(),
            streetAddress: hospitalStreetAddress.trim(),
            phone: hospitalPhone.trim(),
            facebookUrl: normalizeOptionalUrl(hospitalFacebookUrl)
          }
        : null;
    const user = {
      id: userId,
      name: name.trim(),
      email: normalizedEmail,
      password,
      role,
      facilityId: role === "hospital" ? `hospital-${userId}` : "",
      ...(hospitalProfile ? { hospitalProfile } : {}),
      createdAt: new Date().toISOString()
    };
    persistUsers([...users, user]);
    if (role === "doctor" && trimmedProfileText) {
      saveJson(getProfileKey(user.id), createDoctorProfile(user.id, trimmedProfileText));
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

  function updateRequestStatus(requestId, status) {
    persistRequests(
      requests.map((request) =>
        request.id === requestId
          ? { ...request, status, reviewedAt: new Date().toISOString(), reviewedBy: activeUser?.id || "" }
          : request
      )
    );
  }

  function createScheduleRequest(entry) {
    const facility = facilities.find((item) => item.id === entry.facilityId);
    const request = {
      id: crypto.randomUUID(),
      direction: "doctor_to_hospital",
      doctorId: activeUser.id,
      doctorName: getDisplayName(activeUser),
      doctorEmail: activeUser.email,
      facilityId: entry.facilityId,
      facilityName: facility?.name || "Unknown facility",
      visitDate: entry.date,
      visitTime: entry.time,
      purpose: entry.purpose,
      status: "pending",
      createdAt: new Date().toISOString()
    };
    persistRequests([request, ...requests]);
    return request;
  }

  function createHospitalDoctorRequest({ doctorId, date, time, purpose }) {
    const doctor = users.find((item) => item.id === doctorId);
    const facility = getHospitalFacility(activeUser);
    if (!doctor || !facility) {
      return { ok: false, message: "Select a doctor before sending the request." };
    }
    const request = {
      id: crypto.randomUUID(),
      direction: "hospital_to_doctor",
      requestedBy: activeUser.id,
      requestedByName: getDisplayName(activeUser),
      doctorId: doctor.id,
      doctorName: getDisplayName(doctor),
      doctorEmail: doctor.email,
      facilityId: facility.id,
      facilityName: facility.name,
      visitDate: date,
      visitTime: time,
      purpose,
      status: "pending",
      createdAt: new Date().toISOString()
    };
    persistRequests([request, ...requests]);
    return { ok: true, request };
  }

  if (!activeUser) {
    return <AuthGate onLogin={login} onSignUp={signUp} theme={theme} onToggleTheme={toggleTheme} />;
  }

  if (activeUser.role === "hospital") {
    return (
      <HospitalDashboard
        user={activeUser}
        doctors={users.filter((user) => user.role === "doctor")}
        requests={requests}
        onCreateDoctorRequest={createHospitalDoctorRequest}
        onUpdateRequestStatus={updateRequestStatus}
        onLogout={logout}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    );
  }

  return (
    <DoctorApp
      user={activeUser}
      requests={requests}
      onCreateScheduleRequest={createScheduleRequest}
      onUpdateRequestStatus={updateRequestStatus}
      onLogout={logout}
      theme={theme}
      onToggleTheme={toggleTheme}
    />
  );
}

function DoctorApp({ user, requests, onCreateScheduleRequest, onUpdateRequestStatus, onLogout, theme, onToggleTheme }) {
  const profileKey = getProfileKey(user.id);
  const outreachKey = getOutreachKey(user.id);
  const scheduleKey = getScheduleKey(user.id);
  const [profile, setProfile] = useState(() => {
    const saved = localStorage.getItem(profileKey);
    return saved ? JSON.parse(saved) : null;
  });
  const [activeView, setActiveView] = useState("search");
  const [selectedFacilityId, setSelectedFacilityId] = useState(facilities[0].id);
  const [shortlist, setShortlist] = useState([facilities[0].id]);
  const [schedule, setSchedule] = useState(() => readJson(scheduleKey, [
    {
      id: "visit-1",
      facilityId: facilities[0].id,
      date: "2026-06-16",
      time: "10:30",
      purpose: "Cardiology referral discussion",
      status: "confirmed",
      approvalStatus: "doctor_approved",
      calendarStatus: "calendar_event_created",
      source: "demo"
    }
  ]));
  const [outreachRequests, setOutreachRequests] = useState(() => readJson(outreachKey, []));
  const [mapSearchRequest, setMapSearchRequest] = useState({ query: "", nonce: 0 });

  const selectedFacility = facilities.find((facility) => facility.id === selectedFacilityId) || facilities[0];
  const doctorRequests = requests.filter((request) => request.doctorId === user.id);
  const incomingHospitalRequests = doctorRequests.filter(
    (request) => getRequestDirection(request) === "hospital_to_doctor"
  );

  function persistOutreachRequests(nextRequests) {
    saveJson(outreachKey, nextRequests);
    setOutreachRequests(nextRequests);
  }

  function updateSchedule(updater) {
    setSchedule((current) => {
      const nextSchedule = updater(current);
      saveJson(scheduleKey, nextSchedule);
      return nextSchedule;
    });
  }

  function saveProfile(rawText) {
    const nextProfile = createDoctorProfile(user.id, rawText);
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

  function addSchedule(entry, options = {}) {
    const shouldCreateRequest = options.createRequest !== false;
    const request = shouldCreateRequest ? onCreateScheduleRequest(entry) : null;
    const nextEntry = {
      ...entry,
      id: crypto.randomUUID(),
      requestId: request?.id || options.requestId || entry.requestId || "",
      status: options.status || entry.status || (request ? "pending" : "planned"),
      approvalStatus:
        options.approvalStatus || entry.approvalStatus || (request ? "hospital_approval_required" : "doctor_approved"),
      calendarStatus:
        options.calendarStatus || entry.calendarStatus || (request ? "pending_hospital_approval" : "calendar_event_created"),
      source: options.source || entry.source || "manual"
    };
    updateSchedule((current) => [nextEntry, ...current]);
    setActiveView("schedule");
    return request || nextEntry;
  }

  function createOutreachDraft(facilityId) {
    const facility = facilities.find((item) => item.id === facilityId);
    if (!facility) return;

    const existing = outreachRequests.find(
      (request) => request.facilityId === facilityId && !["closed", "appointment_confirmed"].includes(request.status)
    );
    if (existing) {
      setActiveView("outreach");
      return;
    }

    persistOutreachRequests([
      {
        id: crypto.randomUUID(),
        facilityId,
        channel: facility.email ? "Email" : "Phone script",
        destination: facility.email || facility.phone,
        status: "draft",
        approvalStatus: "doctor_approval_required",
        message: buildOutreachMessage(facility, profile),
        proposedTimes: [
          { date: "2026-06-18", time: "11:00", label: "Thu, Jun 18 at 11:00" },
          { date: "2026-06-19", time: "14:30", label: "Fri, Jun 19 at 14:30" }
        ],
        createdAt: new Date().toISOString()
      },
      ...outreachRequests
    ]);
    setActiveView("outreach");
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

  function acceptHospitalRequest(request) {
    onUpdateRequestStatus(request.id, "approved");
    updateSchedule((current) => {
      if (current.some((entry) => entry.requestId === request.id)) return current;
      return [
        {
          id: crypto.randomUUID(),
          requestId: request.id,
          facilityId: request.facilityId,
          facilityName: request.facilityName,
          date: request.visitDate,
          time: request.visitTime,
          purpose: request.purpose,
          status: "approved",
          approvalStatus: "doctor_approved",
          calendarStatus: "calendar_event_created",
          source: "hospital_request"
        },
        ...current
      ];
    });
    setActiveView("schedule");
  }

  function denyHospitalRequest(request) {
    onUpdateRequestStatus(request.id, "denied");
    setActiveView("schedule");
  }

  function removeSchedule(id) {
    updateSchedule((current) => current.filter((entry) => entry.id !== id));
  }

  function requestMapSearch(query) {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;
    setMapSearchRequest((current) => ({ query: trimmedQuery, nonce: current.nonce + 1 }));
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
        approvalCount={getApprovalCount(outreachRequests, incomingHospitalRequests)}
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
          selectedFacility={selectedFacility}
          requests={doctorRequests}
          incomingHospitalRequests={incomingHospitalRequests}
          onAcceptHospitalRequest={acceptHospitalRequest}
          onDenyHospitalRequest={denyHospitalRequest}
          outreachRequests={outreachRequests}
          createOutreachDraft={createOutreachDraft}
          approveOutreach={approveOutreach}
          approveClinicTime={approveClinicTime}
          onMapSearch={requestMapSearch}
        />
        <MapWorkspace
          activeView={activeView}
          facilities={facilities}
          selectedFacility={selectedFacility}
          setSelectedFacilityId={setSelectedFacilityId}
          shortlist={shortlist}
          toggleShortlist={toggleShortlist}
          schedule={schedule}
          addSchedule={addSchedule}
          createOutreachDraft={createOutreachDraft}
          mapSearchRequest={mapSearchRequest}
        />
      </main>
    </div>
  );
}

function AuthGate({ onLogin, onSignUp, theme, onToggleTheme }) {
  const [mode, setMode] = useState("signup");
  const [role, setRole] = useState("doctor");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [profileText, setProfileText] = useState("");
  const [hospitalStreetAddress, setHospitalStreetAddress] = useState("");
  const [hospitalPhone, setHospitalPhone] = useState("");
  const [hospitalFacebookUrl, setHospitalFacebookUrl] = useState("");
  const [error, setError] = useState("");
  const {
    recording: profileRecording,
    status: profileStatus,
    error: profileError,
    startRecording: startProfileRecording,
    stopRecording: stopProfileRecording
  } = useProfileRecorder(setProfileText);

  function submit(event) {
    event.preventDefault();
    setError("");
    const result =
      mode === "login"
        ? onLogin({ email, password })
        : onSignUp({
            name,
            email,
            password,
            role,
            profileText,
            hospitalStreetAddress,
            hospitalPhone,
            hospitalFacebookUrl
          });
    if (!result.ok) {
      setError(result.message);
    }
  }

  const doctorProfileReady = role !== "doctor" || profileText.trim().length > 20;
  const hospitalProfileReady =
    role !== "hospital" || (hospitalStreetAddress.trim().length > 5 && hospitalPhone.trim().length > 6);
  const canSubmit =
    mode === "login"
      ? email.trim() && password
      : name.trim().length > 1 &&
        email.trim() &&
        password.length >= 4 &&
        doctorProfileReady &&
        hospitalProfileReady;

  return (
    <main className="authShell">
      <section className="authPanel">
        <div className="authIntro">
          <div className="brandLockup">
            <span className="brandMark">
              {APP_MARK}
            </span>
            <div>
              <h1>{APP_NAME}</h1>
              <p>{APP_TAGLINE}</p>
            </div>
            <ThemeToggle theme={theme} onToggleTheme={onToggleTheme} />
          </div>
          <div>
            <p className="eyebrow">Sign in</p>
            <h2>One exchange for coverage, referrals, and hospital handoffs.</h2>
            <p>
              Doctors create their clinical context during sign-up, then search, shortlist, and request visits.
              Hospitals review inbound requests and invite doctors from the local user table.
            </p>
          </div>
          <div className="roleSummary">
            <div>
              <UserRound size={18} />
              <strong>Doctor</strong>
              <span>Referral chat, map, shortlist, schedule builder.</span>
            </div>
            <div>
              <Hospital size={18} />
              <strong>Hospital</strong>
              <span>Request queue with approve and deny actions.</span>
            </div>
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
            <>
              <label>
                Account type
                <div className="roleToggle">
                  <button
                    type="button"
                    className={role === "doctor" ? "active" : ""}
                    onClick={() => setRole("doctor")}
                  >
                    <UserRound size={16} />
                    Doctor
                  </button>
                  <button
                    type="button"
                    className={role === "hospital" ? "active" : ""}
                    onClick={() => setRole("hospital")}
                  >
                    <Hospital size={16} />
                    Hospital
                  </button>
                </div>
              </label>
              <label>
                {role === "hospital" ? "Hospital name" : "Name"}
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={role === "hospital" ? "Shaurya Heart & Critical Care" : "Dr. Anika Rao"}
                />
              </label>
            </>
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
          {mode === "signup" && role === "doctor" && (
            <div className="doctorContextInline">
              <div className="contextLabelRow">
                <span>Doctor context</span>
                <span>{doctorProfileReady ? "Ready" : "Required"}</span>
              </div>
              <div className="textareaFrame">
                <textarea
                  aria-label="Doctor context"
                  value={profileText}
                  onChange={(event) => setProfileText(event.target.value)}
                  placeholder="I am a cardiologist with ICU experience. I usually refer patients for cardiac emergencies, prefer Gujarat and Rajasthan, and can volunteer for rural screening camps..."
                />
                <div className="transcriptionDock">
                  <button
                    type="button"
                    className={`iconTextButton ${profileRecording ? "dangerButton" : ""}`}
                    onClick={profileRecording ? stopProfileRecording : startProfileRecording}
                  >
                    {profileRecording ? <Square size={17} /> : <Mic size={17} />}
                    {profileRecording ? "Stop" : "Speak"}
                  </button>
                  <StatusPill status={profileStatus} />
                </div>
              </div>
              {profileError && <p className="formError">{profileError}</p>}
              <button type="button" className="ghostButton sampleContextButton" onClick={() => setProfileText(SAMPLE_PROFILE_TEXT)}>
                <FileText size={16} />
                Use sample context
              </button>
            </div>
          )}
          {mode === "signup" && role === "hospital" && (
            <div className="hospitalProfileFields">
              <label>
                Street address
                <input
                  value={hospitalStreetAddress}
                  onChange={(event) => setHospitalStreetAddress(event.target.value)}
                  placeholder="15 Civil Hospital Road, Ahmedabad, Gujarat"
                />
              </label>
              <label>
                Phone number
                <input
                  type="tel"
                  value={hospitalPhone}
                  onChange={(event) => setHospitalPhone(event.target.value)}
                  placeholder="+91 98251 47300"
                />
              </label>
              <label>
                Facebook page
                <input
                  value={hospitalFacebookUrl}
                  onChange={(event) => setHospitalFacebookUrl(event.target.value)}
                  placeholder="facebook.com/your-hospital"
                />
              </label>
            </div>
          )}
          {error && <p className="formError">{error}</p>}
          <button type="submit" className="primaryButton" disabled={!canSubmit}>
            {mode === "login" ? "Log in" : "Create account"}
            <ChevronRight size={18} />
          </button>
          <p className="authFootnote">
            Prototype accounts are stored in this browser only. Backend user storage is the next step.
          </p>
        </form>
      </section>
    </main>
  );
}

function Onboarding({ onComplete, theme, onToggleTheme }) {
  const [text, setText] = useState("");
  const { recording, status, error, startRecording, stopRecording } = useProfileRecorder(setText);

  const canSubmit = text.trim().length > 20;

  return (
    <main className="onboarding">
      <section className="onboardingPanel">
        <div className="brandLockup setupBrand">
          <span className="brandMark">
            {APP_MARK}
          </span>
          <div>
            <h1>{APP_NAME}</h1>
            <p>Doctor context setup</p>
          </div>
          <ThemeToggle theme={theme} onToggleTheme={onToggleTheme} />
        </div>
        <div className="onboardingGrid">
          <div className="onboardingPrompt">
            <div className="eyebrow">
              <Sparkles size={16} />
              Profile setup
            </div>
            <h2>Start with the context that should shape every referral.</h2>
            <p>
              Add specialties, years of experience, languages, preferred regions, and volunteering interests.
              You can update, add, or remove this context later by telling the chatbot.
            </p>
            <div className="setupNotes">
              <div>
                <Check size={16} />
                Used to rank facilities and draft outreach.
              </div>
              <div>
                <Mic size={16} />
                Speak first, then edit the transcript before saving.
              </div>
              <div>
                <X size={16} />
                Remove stale preferences anytime in chat.
              </div>
            </div>
            <div className="profileExamples">
              <span>Cardiology</span>
              <span>Critical care</span>
              <span>Rural camps</span>
              <span>Gujarat</span>
            </div>
          </div>
          <form
            className="profileForm"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit) onComplete(text.trim());
            }}
          >
            <div className="textareaFrame">
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="I am a cardiologist with ICU experience. I usually refer patients for cardiac emergencies, prefer Gujarat and Rajasthan, and can volunteer for rural screening camps..."
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
              </div>
            </div>
            {error && <p className="formError">{error}</p>}
            <div className="formActions">
              <button
                type="button"
                className="ghostButton"
                onClick={() =>
                  setText(SAMPLE_PROFILE_TEXT)
                }
              >
                <FileText size={17} />
                Use sample
              </button>
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
          <span>{getDisplayName(user)} · {profile.tags.specialties[0] || "Doctor"}</span>
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

function SearchPanel({
  facilities,
  selectedFacilityId,
  setSelectedFacilityId,
  shortlist,
  toggleShortlist,
  addSchedule,
  profile,
  selectedFacility,
  schedule = [],
  requests = [],
  onMapSearch
}) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: `I’ll prioritize ${profile.tags.specialties.join(", ") || "your specialties"} and show which hospital requests are worth accepting, countering, or holding. You can also say “update my profile” or “forget my Rajasthan preference” and I’ll adjust your context.`
    }
  ]);

  async function submitSearch(query) {
    const nextQuery = query || input;
    const trimmedQuery = nextQuery.trim();
    if (!trimmedQuery || loading) return;

    const userMessage = { role: "user", text: trimmedQuery };
    const conversation = [...messages, userMessage];
    setMessages(conversation);
    setInput("");
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmedQuery,
          messages: conversation,
          profile,
          facilities,
          selectedFacility,
          schedule,
          requests
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Chat request failed");
      }

      const firstFacilityId = data.facilityIds?.find((id) => facilities.some((facility) => facility.id === id));
      if (firstFacilityId) {
        setSelectedFacilityId(firstFacilityId);
      }
      if (data.mapQuery) {
        onMapSearch?.(data.mapQuery);
      }

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: data.reply || "I found relevant facilities and updated the map search."
        }
      ]);
    } catch (chatError) {
      setError(chatError.message || "The assistant could not respond.");
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: "I could not reach the assistant just now. You can still search the map and schedule from the facility cards."
        }
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside className="sidePanel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Doctor exchange</p>
          <h2>Coverage assistant</h2>
        </div>
        <span className="countBadge">{facilities.length} matches</span>
      </div>
      <div className="quickPromptRow">
        {quickPrompts.map((prompt) => (
          <button key={prompt} onClick={() => submitSearch(prompt)} disabled={loading}>
            {prompt}
          </button>
        ))}
      </div>
      <div className="chatLog">
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={`message ${message.role}`}>
            {message.text}
          </div>
        ))}
        {loading && (
          <div className="message assistant thinking">
            <LoaderCircle size={15} />
            Thinking through the exchange
          </div>
        )}
      </div>
      {error && <p className="chatError">{error}</p>}
      <form
        className="chatInput"
        onSubmit={(event) => {
          event.preventDefault();
          submitSearch();
        }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask about facilities, profile context, or map search"
          disabled={loading}
        />
        <button title="Send search" type="submit" disabled={loading}>
          {loading ? <LoaderCircle size={18} /> : <Send size={18} />}
        </button>
      </form>
      <div className="resultStack">
        {facilities.map((facility) => (
          <FacilityCard
            key={facility.id}
            facility={facility}
            selected={facility.id === selectedFacilityId}
            shortlisted={shortlist.includes(facility.id)}
            onSelect={() => setSelectedFacilityId(facility.id)}
            onToggleShortlist={() => toggleShortlist(facility.id)}
            onSchedule={() =>
              addSchedule({
                facilityId: facility.id,
                date: "2026-06-17",
                time: "14:00",
                purpose: "Referral call"
              })
            }
          />
        ))}
      </div>
    </aside>
  );
}

function FacilityCard({ facility, selected, shortlisted, onSelect, onToggleShortlist, onSchedule }) {
  const meta = tierMeta[facility.tier];
  return (
    <article className={`facilityCard ${selected ? "selected" : ""}`} onClick={onSelect}>
      <div className="facilityTopline">
        <span className={`tierDot ${meta.className}`} />
        <div>
          <h3>{facility.name}</h3>
          <p>{facility.type}</p>
        </div>
        <span className={`tierBadge ${meta.className}`}>{meta.label}</span>
      </div>
      <div className="facilityMeta">
        <span>
          <MapPin size={14} />
          {facility.distanceKm} km
        </span>
        <span>
          <ShieldCheck size={14} />
          {facility.score.toFixed(1)}
        </span>
      </div>
      <p className="facilityMatch">{facility.match}</p>
      <div className="cardActions">
        <button type="button" onClick={(event) => runButtonAction(event, onToggleShortlist)}>
          {shortlisted ? <Check size={15} /> : <Plus size={15} />}
          {shortlisted ? "Saved" : "Save"}
        </button>
        <button type="button" onClick={(event) => runButtonAction(event, onSchedule)}>
          <CalendarDays size={15} />
          Plan
        </button>
      </div>
    </article>
  );
}

function MapWorkspace({
  activeView,
  facilities,
  selectedFacility,
  setSelectedFacilityId,
  shortlist,
  toggleShortlist,
  schedule,
  addSchedule,
  createOutreachDraft,
  mapSearchRequest
}) {
  const [mapSearchInput, setMapSearchInput] = useState("Ahmedabad hospitals");
  const [mapSearchQuery, setMapSearchQuery] = useState("");
  const visibleFacilities = useMemo(() => {
    if (activeView === "shortlist") {
      return facilities.filter((facility) => shortlist.includes(facility.id));
    }
    if (activeView === "schedule") {
      return facilities.filter((facility) => schedule.some((entry) => entry.facilityId === facility.id));
    }
    return facilities;
  }, [activeView, facilities, schedule, shortlist]);

  useEffect(() => {
    if (!mapSearchRequest?.query) return;
    setMapSearchInput(mapSearchRequest.query);
    setMapSearchQuery(mapSearchRequest.query);
  }, [mapSearchRequest]);

  function submitMapSearch(event) {
    event.preventDefault();
    const trimmedQuery = mapSearchInput.trim();
    if (!trimmedQuery) return;
    setMapSearchQuery(trimmedQuery);
  }

  return (
    <section className="mapWorkspace">
      <GoogleMapShell
        facilities={visibleFacilities.length ? visibleFacilities : facilities}
        selectedFacility={selectedFacility}
        onSelect={setSelectedFacilityId}
        searchQuery={mapSearchQuery}
      />
      <div className="mapToolbar">
        <div>
          <p className="eyebrow">{activeView === "schedule" ? "Route view" : "District context"}</p>
          <h2>
            {activeView === "schedule"
              ? "Confirmed visits and proposed counters"
              : "Hospital demand near Ahmedabad"}
          </h2>
        </div>
        <form className="mapSearchForm" onSubmit={submitMapSearch}>
          <Search size={17} />
          <input
            aria-label="Search hospital locations on map"
            value={mapSearchInput}
            onChange={(event) => setMapSearchInput(event.target.value)}
            placeholder="Search a city, district, or hospital"
          />
          <button type="submit">
            <Navigation size={17} />
            Search
          </button>
        </form>
      </div>
      {activeView === "schedule" ? (
        <ScheduleRibbon schedule={schedule} facilities={facilities} />
      ) : (
        <EvidenceDrawer
          facility={selectedFacility}
          shortlisted={shortlist.includes(selectedFacility.id)}
          onToggleShortlist={() => toggleShortlist(selectedFacility.id)}
          onSchedule={() =>
            addSchedule({
              facilityId: selectedFacility.id,
              date: "2026-06-18",
              time: "11:00",
              purpose: "Facility outreach"
            })
          }
          onDraftOutreach={() => createOutreachDraft(selectedFacility.id)}
        />
      )}
    </section>
  );
}

function GoogleMapShell({ facilities: visibleFacilities, selectedFacility, onSelect, searchQuery }) {
  const mapRef = useRef(null);
  const instanceRef = useRef(null);
  const markerRef = useRef([]);
  const placeMarkerRef = useRef([]);
  const infoWindowRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [placeResults, setPlaceResults] = useState([]);
  const [searchStatus, setSearchStatus] = useState("idle");
  const [searchError, setSearchError] = useState("");
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const mapId = import.meta.env.VITE_GOOGLE_MAP_ID || "DEMO_MAP_ID";

  useEffect(() => {
    if (!apiKey || !mapRef.current) return;
    let cancelled = false;

    loadGoogleMaps(apiKey).then(() => {
      if (cancelled || !mapRef.current) return;
      if (!instanceRef.current) {
        instanceRef.current = new window.google.maps.Map(mapRef.current, {
          center: { lat: selectedFacility.lat, lng: selectedFacility.lng },
          zoom: 10,
          disableDefaultUI: true,
          zoomControl: true,
          mapTypeControl: false,
          fullscreenControl: false,
          streetViewControl: false,
          mapId
        });
      }
      if (!infoWindowRef.current) {
        infoWindowRef.current = new window.google.maps.InfoWindow();
      }
      const map = instanceRef.current;
      const bounds = new window.google.maps.LatLngBounds();
      visibleFacilities.forEach((facility) => bounds.extend({ lat: facility.lat, lng: facility.lng }));
      if (visibleFacilities.length > 1) {
        map.fitBounds(bounds, 88);
      } else {
        map.setCenter({ lat: selectedFacility.lat, lng: selectedFacility.lng });
        map.setZoom(11);
      }
      markerRef.current.forEach((marker) => {
        marker.map = null;
      });
      markerRef.current = visibleFacilities.map((facility) => {
        const isSelected = facility.id === selectedFacility.id;
        const marker = new window.google.maps.marker.AdvancedMarkerElement({
          position: { lat: facility.lat, lng: facility.lng },
          map,
          title: facility.name,
          content: makeGoogleMarkerContent(facility.tier, isSelected),
          zIndex: isSelected ? 20 : 10
        });
        marker.addEventListener("gmp-click", () => {
          onSelect(facility.id);
          infoWindowRef.current.setContent(renderMapInfo(facility));
          infoWindowRef.current.open({ anchor: marker, map });
        });
        return marker;
      });
      map.panTo({ lat: selectedFacility.lat, lng: selectedFacility.lng });
      setMapReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [apiKey, mapId, onSelect, selectedFacility.lat, selectedFacility.lng, visibleFacilities]);

  useEffect(() => {
    const trimmedQuery = searchQuery?.trim();
    if (!apiKey || !trimmedQuery || !mapReady || !instanceRef.current) return;
    let cancelled = false;

    async function runPlaceSearch() {
      setSearchStatus("searching");
      setSearchError("");

      try {
        await loadGoogleMaps(apiKey);
        const map = instanceRef.current;
        const { Place, SearchNearbyRankPreference } = await window.google.maps.importLibrary("places");
        const baseCenter = { lat: selectedFacility.lat, lng: selectedFacility.lng };
        const placeFields = [
          "id",
          "displayName",
          "formattedAddress",
          "location",
          "googleMapsURI",
          "rating",
          "businessStatus",
          "types"
        ];
        const locationResponse = await Place.searchByText({
          textQuery: trimmedQuery,
          fields: ["displayName", "formattedAddress", "location"],
          maxResultCount: 1,
          locationBias: { center: baseCenter, radius: 50000 }
        });
        const searchCenter = getPlaceLocationLiteral(locationResponse.places?.[0]?.location) || baseCenter;
        let places = [];

        try {
          const nearbyResponse = await Place.searchNearby({
            fields: placeFields,
            locationRestriction: { center: searchCenter, radius: 50000 },
            includedPrimaryTypes: ["hospital"],
            maxResultCount: 12,
            rankPreference: SearchNearbyRankPreference?.POPULARITY || "POPULARITY"
          });
          places = nearbyResponse.places || [];
        } catch (nearbyError) {
          console.warn("Nearby hospital search fell back to text search", nearbyError);
        }

        if (!places.length) {
          const textResponse = await Place.searchByText({
            textQuery: /hospital|clinic|medical/i.test(trimmedQuery)
              ? trimmedQuery
              : `hospitals near ${trimmedQuery}`,
            fields: placeFields,
            includedType: "hospital",
            maxResultCount: 12,
            locationBias: { center: searchCenter, radius: 50000 }
          });
          places = textResponse.places || [];
        }

        if (cancelled) return;

        const normalizedPlaces = places
          .map((place, index) => {
            const location = getPlaceLocationLiteral(place.location);
            if (!location) return null;
            return {
              id: place.id || `${trimmedQuery}-${index}`,
              name: getPlaceDisplayName(place.displayName) || "Google hospital result",
              address: place.formattedAddress || "",
              location,
              rating: place.rating || "",
              businessStatus: place.businessStatus || "",
              googleMapsURI: place.googleMapsURI || "",
              types: place.types || []
            };
          })
          .filter(Boolean);

        placeMarkerRef.current.forEach(({ marker }) => {
          marker.map = null;
        });
        placeMarkerRef.current = [];

        if (!normalizedPlaces.length) {
          setPlaceResults([]);
          setSearchStatus("empty");
          setSearchError(`No Google hospital locations found for "${trimmedQuery}".`);
          map.panTo(searchCenter);
          map.setZoom(11);
          return;
        }

        const bounds = new window.google.maps.LatLngBounds();
        normalizedPlaces.forEach((place) => bounds.extend(place.location));
        visibleFacilities.forEach((facility) => bounds.extend({ lat: facility.lat, lng: facility.lng }));

        placeMarkerRef.current = normalizedPlaces.map((place) => {
          const marker = new window.google.maps.marker.AdvancedMarkerElement({
            position: place.location,
            map,
            title: place.name,
            content: makePlaceMarkerContent(),
            zIndex: 30
          });
          marker.addEventListener("gmp-click", () => {
            infoWindowRef.current.setContent(renderPlaceInfo(place));
            infoWindowRef.current.open({ anchor: marker, map });
          });
          return { id: place.id, marker };
        });

        map.fitBounds(bounds, 82);
        setPlaceResults(normalizedPlaces);
        setSearchStatus("ready");
      } catch (searchErrorValue) {
        if (cancelled) return;
        console.error("Google Places search failed", searchErrorValue);
        setPlaceResults([]);
        setSearchStatus("error");
        setSearchError("Google Places search is unavailable. Check that Places API is enabled for this key.");
      }
    }

    runPlaceSearch();

    return () => {
      cancelled = true;
    };
  }, [apiKey, mapReady, searchQuery, selectedFacility.lat, selectedFacility.lng, visibleFacilities]);

  function focusPlace(place) {
    if (!instanceRef.current || !infoWindowRef.current) return;
    const marker = placeMarkerRef.current.find((item) => item.id === place.id)?.marker;
    instanceRef.current.panTo(place.location);
    instanceRef.current.setZoom(14);
    if (marker) {
      infoWindowRef.current.setContent(renderPlaceInfo(place));
      infoWindowRef.current.open({ anchor: marker, map: instanceRef.current });
    }
  }

  if (apiKey) {
    return (
      <>
        <div className="googleMap" ref={mapRef} />
        <div className="mapProviderBadge">Google Maps · dataset layer + Places</div>
        {(searchStatus !== "idle" || placeResults.length > 0) && (
          <div className="placeResultsTray">
            <div className="placeResultsHeader">
              <span>{searchStatus === "searching" ? "Searching Google Places" : "Google hospital locations"}</span>
              <strong>
                {searchStatus === "searching"
                  ? "..."
                  : placeResults.length
                    ? `${placeResults.length} found`
                    : "No results"}
              </strong>
            </div>
            {searchError && <p>{searchError}</p>}
            {placeResults.slice(0, 4).map((place) => (
              <button key={place.id} type="button" onClick={() => focusPlace(place)}>
                <Hospital size={15} />
                <span>{place.name}</span>
              </button>
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="fallbackMap" aria-label="Map preview">
      <div className="mapKeyHint">Add VITE_GOOGLE_MAPS_API_KEY to use Google Maps</div>
      {searchQuery && (
        <div className="placeResultsTray fallbackTray">
          <div className="placeResultsHeader">
            <span>Map search queued</span>
            <strong>Needs key</strong>
          </div>
          <p>Google Places results will appear here after the Maps key is available.</p>
        </div>
      )}
      <div className="arterial roadA" />
      <div className="arterial roadB" />
      <div className="arterial roadC" />
      <div className="riverLine" />
      {visibleFacilities.map((facility) => (
        <button
          key={facility.id}
          className={`mapMarker ${facility.tier} ${facility.id === selectedFacility.id ? "selected" : ""}`}
          style={{ left: `${facility.map.x}%`, top: `${facility.map.y}%` }}
          onClick={() => onSelect(facility.id)}
          title={facility.name}
        >
          <Hospital size={18} />
        </button>
      ))}
    </div>
  );
}

function EvidenceDrawer({ facility, shortlisted, onToggleShortlist, onSchedule, onDraftOutreach }) {
  const meta = tierMeta[facility.tier];

  return (
    <aside className="evidenceDrawer">
      <div className="drawerHeader">
        <div>
          <span className={`tierBadge ${meta.className}`}>{meta.label} evidence</span>
          <h2>{facility.name}</h2>
          <p>
            {facility.city}, {facility.state} · {facility.distanceKm} km
          </p>
        </div>
        <button title="Copy details">
          <Copy size={16} />
        </button>
      </div>
      <div className="contactGrid">
        <a href={`tel:${facility.phone}`}>
          <Phone size={15} />
          {facility.phone}
        </a>
        {facility.email ? (
          <a href={`mailto:${facility.email}`}>
            <Mail size={15} />
            {facility.email}
          </a>
        ) : (
          <span>
            <Mail size={15} />
            No email listed
          </span>
        )}
      </div>
      <div className="evidenceList">
        {facility.evidence.map((item) => (
          <div key={`${facility.id}-${item.field}`}>
            <span>{item.field}</span>
            <p>{item.text}</p>
          </div>
        ))}
      </div>
      <div className="flagList">
        {facility.flags.map((flag) => (
          <span key={flag}>{flag}</span>
        ))}
      </div>
      <div className="drawerActions">
        <button onClick={onToggleShortlist}>
          {shortlisted ? <Check size={17} /> : <Plus size={17} />}
          {shortlisted ? "Saved" : "Shortlist"}
        </button>
        <button onClick={onSchedule}>
          <CalendarDays size={17} />
          Request
        </button>
        <button onClick={onDraftOutreach}>
          <Mail size={17} />
          Draft
        </button>
      </div>
    </aside>
  );
}

function OutreachPanel({
  facilities,
  selectedFacilityId,
  setSelectedFacilityId,
  outreachRequests,
  createOutreachDraft,
  approveOutreach,
  approveClinicTime
}) {
  const selectedFacility = facilities.find((facility) => facility.id === selectedFacilityId) || facilities[0];

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
            return (
              <article className="approvalCard" key={request.id}>
                <div className="approvalTopline">
                  <div>
                    <span className={`statusLabel status-${request.status}`}>{formatStatus(request.status)}</span>
                    <h3>{facility?.name || "Selected facility"}</h3>
                    <p>
                      {request.channel} · {request.destination || "Contact enrichment needed"}
                    </p>
                  </div>
                  <ShieldCheck size={18} />
                </div>
                <div className="draftMessage">{request.message}</div>
                {request.status === "draft" && (
                  <button className="primaryButton" type="button" onClick={() => approveOutreach(request.id)}>
                    <Check size={17} />
                    Approve and mark sent
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

function HospitalDashboard({
  user,
  doctors,
  requests,
  onCreateDoctorRequest,
  onUpdateRequestStatus,
  onLogout,
  theme,
  onToggleTheme
}) {
  const facility = getHospitalFacility(user);
  const facilityRequests = requests.filter((request) => request.facilityId === facility.id);
  const incomingRequests = facilityRequests.filter((request) => getRequestDirection(request) === "doctor_to_hospital");
  const outgoingRequests = facilityRequests.filter((request) => getRequestDirection(request) === "hospital_to_doctor");
  const pendingRequests = incomingRequests.filter((request) => request.status === "pending");
  const approvedRequests = incomingRequests.filter((request) => request.status === "approved");
  const deniedRequests = incomingRequests.filter((request) => request.status === "denied");
  const openNegotiations = pendingRequests.length + outgoingRequests.filter((request) => request.status === "pending").length;
  const meta = tierMeta[facility.tier];

  return (
    <div className="hospitalShell exchangeShell">
      <header className="topBar hospitalTopBar">
        <div className="brandLockup compact">
          <span className="brandMark">
            {APP_MARK}
          </span>
          <div>
            <h1>{APP_NAME}</h1>
            <p>{facility.name}</p>
          </div>
        </div>
        <div className="hospitalIdentity">
          <span className={`tierBadge ${meta.className}`}>{meta.label} evidence</span>
          <span>{openNegotiations} open negotiations</span>
        </div>
        <div className="accountCluster">
          <ThemeToggle theme={theme} onToggleTheme={onToggleTheme} />
          <button className="logoutButton" onClick={onLogout}>
            <LogOut size={16} />
            Log out
          </button>
        </div>
      </header>
      <main className="hospitalWorkspace">
        <section className="requestPanel">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Hospital exchange</p>
              <h2>Request queue</h2>
            </div>
            <span className="countBadge">{pendingRequests.length} pending</span>
          </div>
          <div className="requestStats">
            <div>
              <span>Needs decision</span>
              <strong>{pendingRequests.length}</strong>
            </div>
            <div>
              <span>Approved visits</span>
              <strong>{approvedRequests.length}</strong>
            </div>
            <div>
              <span>Doctor invites</span>
              <strong>{outgoingRequests.filter((request) => request.status === "pending").length}</strong>
            </div>
          </div>
          <div className="exchangeTicker" aria-label="Exchange status">
            <div>
              <strong>Likely to confirm</strong>
              <span>{Math.max(approvedRequests.length, 1)} visits with clean contact data</span>
            </div>
            <div>
              <strong>Needs follow-up</strong>
              <span>{deniedRequests.length + pendingRequests.length} requests awaiting human decision</span>
            </div>
          </div>
          <HospitalDoctorRequestForm doctors={doctors} onCreateDoctorRequest={onCreateDoctorRequest} />
          <div className="requestSectionHeader">
            <h3>Incoming from doctors</h3>
            <span>{incomingRequests.length} total</span>
          </div>
          <div className="requestQueue">
            {incomingRequests.length ? (
              incomingRequests.map((request) => (
                <ScheduleRequestCard
                  key={request.id}
                  request={request}
                  title={request.doctorName}
                  subtitle={request.doctorEmail}
                  onApprove={() => onUpdateRequestStatus(request.id, "approved")}
                  onDeny={() => onUpdateRequestStatus(request.id, "denied")}
                />
              ))
            ) : (
              <div className="emptyState">
                <ClipboardList size={28} />
                <h3>No scheduling requests</h3>
                <p>Incoming doctor requests for {facility.name} will appear here.</p>
              </div>
            )}
          </div>
          <div className="requestSectionHeader">
            <h3>Requests sent to doctors</h3>
            <span>{outgoingRequests.length} total</span>
          </div>
          <div className="requestQueue">
            {outgoingRequests.length ? (
              outgoingRequests.map((request) => (
                <ScheduleRequestCard
                  key={request.id}
                  request={request}
                  title={request.doctorName}
                  subtitle={`${request.doctorEmail} · doctor decision`}
                />
              ))
            ) : (
              <div className="emptyState compactEmpty">
                <UserRound size={24} />
                <h3>No doctor invites sent</h3>
                <p>Use the request form above to ask a doctor to visit {facility.name}.</p>
              </div>
            )}
          </div>
        </section>
        <aside className="hospitalFacilityPane">
          <div className="facilityHero">
            <span className={`tierDot ${meta.className}`} />
            <div>
              <h2>{facility.name}</h2>
              <p>
                {facility.type}
                {facility.addressLine ? ` · ${facility.addressLine}` : ` · ${facility.city}, ${facility.state}`}
              </p>
            </div>
          </div>
          <div className="contactGrid">
            {facility.phone ? (
              <a href={`tel:${facility.phone}`}>
                <Phone size={15} />
                {facility.phone}
              </a>
            ) : (
              <span>
                <Phone size={15} />
                No phone listed
              </span>
            )}
            {facility.email ? (
              <a href={`mailto:${facility.email}`}>
                <Mail size={15} />
                {facility.email}
              </a>
            ) : (
              <span>
                <Mail size={15} />
                No email listed
              </span>
            )}
            {facility.facebookUrl && (
              <a href={facility.facebookUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={15} />
                Facebook page
              </a>
            )}
          </div>
          <div className="evidenceList">
            {facility.evidence.map((item) => (
              <div key={`${facility.id}-${item.field}`}>
                <span>{item.field}</span>
                <p>{item.text}</p>
              </div>
            ))}
          </div>
          <div className="flagList">
            {facility.flags.map((flag) => (
              <span key={flag}>{flag}</span>
            ))}
          </div>
        </aside>
      </main>
    </div>
  );
}

function HospitalDoctorRequestForm({ doctors, onCreateDoctorRequest }) {
  const [doctorId, setDoctorId] = useState(doctors[0]?.id || "");
  const [date, setDate] = useState("2026-06-18");
  const [time, setTime] = useState("11:00");
  const [purpose, setPurpose] = useState("Volunteer specialist visit");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!doctorId && doctors[0]?.id) {
      setDoctorId(doctors[0].id);
    }
  }, [doctorId, doctors]);

  return (
    <form
      className="doctorRequestForm"
      onSubmit={(event) => {
        event.preventDefault();
        const result = onCreateDoctorRequest({ doctorId, date, time, purpose });
        setNotice(result.ok ? "Request sent to doctor." : result.message);
      }}
    >
      <div className="requestSectionHeader inlineHeader">
        <h3>Request a doctor</h3>
        <span>{doctors.length} available</span>
      </div>
      <label>
        Doctor
        <select value={doctorId} onChange={(event) => setDoctorId(event.target.value)} disabled={!doctors.length}>
          {doctors.length ? (
            doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {getDisplayName(doctor)}
              </option>
            ))
          ) : (
            <option>No doctor accounts yet</option>
          )}
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
      <button className="primaryButton" type="submit" disabled={!doctors.length || !doctorId}>
        <Send size={16} />
        Send request
      </button>
      {notice && <p className="requestNotice">{notice}</p>}
    </form>
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
  const [facilityId, setFacilityId] = useState(facilities[0].id);
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
  addSchedule
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
              onSchedule={() =>
                addSchedule({
                  facilityId: facility.id,
                  date: "2026-06-19",
                  time: "12:00",
                  purpose: "Shortlist follow-up"
                })
              }
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

function extractLocalTags(rawText) {
  const specialties = [
    ["cardiology", /cardio|heart|hypertension/i],
    ["critical care", /icu|critical|emergency/i],
    ["diabetes", /diabetes|endocr/i],
    ["general medicine", /general|physician|medicine/i]
  ]
    .filter(([, pattern]) => pattern.test(rawText))
    .map(([label]) => label);

  const regions = ["Gujarat", "Rajasthan", "Maharashtra", "rural"].filter((region) =>
    new RegExp(region, "i").test(rawText)
  );

  return {
    specialties: specialties.length ? specialties : ["general medicine"],
    regions,
    experience: rawText.match(/(\d+)\s*(years|yrs)/i)?.[1] || ""
  };
}

function buildOutreachMessage(facility, profile) {
  const specialty = profile.tags.specialties[0] || "medical";
  const region = profile.tags.regions[0] || facility.state;
  const contactLine = facility.email
    ? `I found a public email for ${facility.name}: ${facility.email}.`
    : `I found a public phone number for ${facility.name}: ${facility.phone}.`;

  return `Hello ${facility.name}, I am a ${specialty} doctor planning referral and volunteer outreach near ${region}. I would like to schedule a short introductory meeting to learn whether my background may be useful to your clinic. ${contactLine}`;
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

function loadGoogleMaps(apiKey) {
  if (
    window.google?.maps?.Map &&
    window.google?.maps?.marker?.AdvancedMarkerElement &&
    window.google?.maps?.places?.Place
  ) {
    return Promise.resolve();
  }
  if (window.__referralGoogleMapsPromise) {
    return window.__referralGoogleMapsPromise;
  }
  const existing = document.querySelector("script[data-google-maps]");
  if (existing && !window.google?.maps?.Map) {
    existing.remove();
  }
  window.__referralGoogleMapsPromise = new Promise((resolve, reject) => {
    window.__initReferralGoogleMaps = () => {
      resolve();
    };
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=weekly&loading=async&libraries=marker,places&callback=__initReferralGoogleMaps`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMaps = "true";
    script.onerror = () => {
      window.__referralGoogleMapsPromise = null;
      reject(new Error("Unable to load Google Maps"));
    };
    document.head.appendChild(script);
  });
  return window.__referralGoogleMapsPromise;
}

function makeGoogleMarkerContent(tier, selected) {
  const marker = document.createElement("div");
  marker.className = `googleMarkerPin ${tier} ${selected ? "selected" : ""}`;
  marker.innerHTML = `<span></span>`;
  return marker;
}

function makePlaceMarkerContent() {
  const marker = document.createElement("div");
  marker.className = "googlePlacePin";
  marker.innerHTML = `<span></span>`;
  return marker;
}

function renderMapInfo(facility) {
  const tierLabel = tierMeta[facility.tier].label;
  return `
    <div class="gmInfo">
      <strong>${escapeHtml(facility.name)}</strong>
      <span>${escapeHtml(facility.city)}, ${escapeHtml(facility.state)} · ${escapeHtml(facility.distanceKm)} km</span>
      <em>${escapeHtml(tierLabel)} evidence</em>
    </div>
  `;
}

function renderPlaceInfo(place) {
  const rating = place.rating ? ` · ${place.rating} stars` : "";
  const status = place.businessStatus ? ` · ${formatStatus(place.businessStatus.toLowerCase())}` : "";
  const mapLink = place.googleMapsURI
    ? `<a href="${escapeHtml(place.googleMapsURI)}" target="_blank" rel="noreferrer">Open in Google Maps</a>`
    : "";

  return `
    <div class="gmInfo gmPlaceInfo">
      <strong>${escapeHtml(place.name)}</strong>
      <span>${escapeHtml(place.address || "Address unavailable")}</span>
      <em>Google Places${escapeHtml(rating)}${escapeHtml(status)}</em>
      ${mapLink}
    </div>
  `;
}

function getPlaceDisplayName(displayName) {
  if (!displayName) return "";
  if (typeof displayName === "string") return displayName;
  return displayName.text || displayName.name || "";
}

function getPlaceLocationLiteral(location) {
  if (!location) return null;
  if (typeof location.lat === "function" && typeof location.lng === "function") {
    return { lat: location.lat(), lng: location.lng() };
  }
  if (typeof location.lat === "number" && typeof location.lng === "number") {
    return { lat: location.lat, lng: location.lng };
  }
  return null;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[character];
  });
}

export default App;
