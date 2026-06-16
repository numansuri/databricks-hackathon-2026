import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardList,
  Clock3,
  Copy,
  FileText,
  HeartPulse,
  Hospital,
  Mail,
  MapPin,
  MessageSquareText,
  Mic,
  Navigation,
  Phone,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Star,
  Trash2,
  UserRound,
  X
} from "lucide-react";

const PROFILE_KEY = "referralCopilotDoctorProfile";
const DOCTOR_ID_KEY = "referralCopilotDoctorId";

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

function getDoctorId() {
  let id = localStorage.getItem(DOCTOR_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DOCTOR_ID_KEY, id);
  }
  return id;
}

function App() {
  const [doctorId] = useState(getDoctorId);
  const [profile, setProfile] = useState(() => {
    const saved = localStorage.getItem(PROFILE_KEY);
    return saved ? JSON.parse(saved) : null;
  });
  const [activeView, setActiveView] = useState("search");
  const [selectedFacilityId, setSelectedFacilityId] = useState(facilities[0].id);
  const [shortlist, setShortlist] = useState([facilities[0].id]);
  const [schedule, setSchedule] = useState([
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
  ]);
  const [outreachRequests, setOutreachRequests] = useState([]);

  const selectedFacility = facilities.find((facility) => facility.id === selectedFacilityId) || facilities[0];

  function saveProfile(rawText) {
    const nextProfile = {
      doctorId,
      rawText,
      tags: extractLocalTags(rawText),
      promptTuning: buildPromptTuningState(rawText),
      followUpAnswers: [],
      createdAt: new Date().toISOString()
    };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(nextProfile));
    setProfile(nextProfile);
  }

  function updateProfile(nextProfile) {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(nextProfile));
    setProfile(nextProfile);
  }

  function resetProfile() {
    localStorage.removeItem(PROFILE_KEY);
    setProfile(null);
  }

  function toggleShortlist(id) {
    setShortlist((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  function addSchedule(entry, options = {}) {
    const nextEntry = {
      id: crypto.randomUUID(),
      status: options.status || "pending_approval",
      approvalStatus: options.approvalStatus || "doctor_approval_required",
      calendarStatus: options.calendarStatus || "pending_hold",
      source: options.source || "manual",
      ...entry
    };
    setSchedule((current) => [nextEntry, ...current]);
    setActiveView("schedule");
  }

  function approveSchedule(id) {
    setSchedule((current) =>
      current.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              status: "confirmed",
              approvalStatus: "doctor_approved",
              calendarStatus: "calendar_event_created",
              approvedAt: new Date().toISOString()
            }
          : entry
      )
    );
  }

  function removeSchedule(id) {
    setSchedule((current) => current.filter((entry) => entry.id !== id));
  }

  function createOutreachDraft(facilityId) {
    const facility = facilities.find((item) => item.id === facilityId);
    if (!facility) return;

    const existing = outreachRequests.find(
      (request) => request.facilityId === facilityId && request.status !== "closed"
    );
    if (existing) {
      setActiveView("outreach");
      return;
    }

    setOutreachRequests((current) => [
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
      ...current
    ]);
    setActiveView("outreach");
  }

  function approveOutreach(id) {
    setOutreachRequests((current) =>
      current.map((request) =>
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
        status: "confirmed",
        approvalStatus: "doctor_approved",
        calendarStatus: "calendar_event_created",
        source: "clinic_reply"
      }
    );

    setOutreachRequests((current) =>
      current.map((item) =>
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

  if (!profile) {
    return <Onboarding onComplete={saveProfile} />;
  }

  return (
    <div className="appShell">
      <TopBar
        activeView={activeView}
        setActiveView={setActiveView}
        shortlistCount={shortlist.length}
        approvalCount={getApprovalCount(outreachRequests, schedule)}
        profile={profile}
        onResetProfile={resetProfile}
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
          approveSchedule={approveSchedule}
          removeSchedule={removeSchedule}
          outreachRequests={outreachRequests}
          createOutreachDraft={createOutreachDraft}
          approveOutreach={approveOutreach}
          approveClinicTime={approveClinicTime}
          profile={profile}
          onUpdateProfile={updateProfile}
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
        />
      </main>
    </div>
  );
}

function Onboarding({ onComplete }) {
  const [text, setText] = useState("");
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
      const demoTranscript =
        "I am a cardiologist with 10 years of ICU experience. I can support emergency cardiac referrals, hypertension care, and volunteer cardiac screening camps in Gujarat and Rajasthan.";
      setText((current) => mergeTranscript(current, demoTranscript));
      setStatus("demo");
    }
  }

  const canSubmit = text.trim().length > 20;

  return (
    <main className="onboarding">
      <section className="onboardingPanel">
        <div className="brandLockup setupBrand">
          <span className="brandMark">
            <HeartPulse size={25} />
          </span>
          <div>
            <h1>Referral Copilot</h1>
            <p>Doctor context setup</p>
          </div>
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
                  setText(
                    "I am a general physician with eight years of experience in diabetes and hypertension care. I can volunteer monthly for rural screening camps and prefer facilities in Gujarat, Rajasthan, and Maharashtra."
                  )
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

function TopBar({ activeView, setActiveView, shortlistCount, approvalCount, profile, onResetProfile }) {
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
          <HeartPulse size={22} />
        </span>
        <div>
          <h1>Referral Copilot</h1>
          <p>Evidence-first referrals</p>
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
      <div className="profileChip">
        <UserRound size={17} />
        <span>{profile.tags.specialties[0] || "Doctor"}</span>
        <button title="Reset profile" onClick={onResetProfile}>
          <X size={14} />
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
  onUpdateProfile
}) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState(() => buildInitialChatMessages(profile));

  function submitSearch(query, options = {}) {
    const nextQuery = query || input;
    if (!nextQuery.trim()) return;

    const currentPromptTuning = profile.promptTuning || buildPromptTuningState(profile.rawText);
    const pendingQuestions = currentPromptTuning.followUpQuestions || [];

    if (pendingQuestions.length && !options.forceSearch && !hasExplicitSearchIntent(nextQuery)) {
      if (isSkipIntent(nextQuery)) {
        const nextProfile = {
          ...profile,
          promptTuning: {
            ...currentPromptTuning,
            followUpQuestions: [],
            skippedSignals: currentPromptTuning.missingSignals,
            updatedAt: new Date().toISOString()
          },
          updatedAt: new Date().toISOString()
        };
        onUpdateProfile(nextProfile);
        setMessages((current) => [
          ...current,
          { role: "user", text: nextQuery.trim() },
          {
            role: "assistant",
            text:
              "No problem. I’ll keep matching clinics with the profile details I have and label weaker matches when important context is missing."
          }
        ]);
        setInput("");
        return;
      }

      const nextProfile = mergeFollowUpAnswer(profile, nextQuery.trim(), pendingQuestions);
      onUpdateProfile(nextProfile);
      setMessages((current) => [
        ...current,
        { role: "user", text: nextQuery.trim() },
        {
          role: "assistant",
          text: buildProfileUpdateMessage(nextProfile)
        }
      ]);
      setInput("");
      return;
    }

    setMessages((current) => [
      ...current,
      { role: "user", text: nextQuery.trim() },
      {
        role: "assistant",
        text: "I found three facilities with cardiac evidence near Ahmedabad. Strong matches include corroborated capability, procedure, and equipment fields."
      }
    ]);
    setInput("");
  }

  return (
    <aside className="sidePanel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Search</p>
          <h2>Referral chat</h2>
        </div>
        <span className="countBadge">{facilities.length} matches</span>
      </div>
      <div className="quickPromptRow">
        {quickPrompts.map((prompt) => (
          <button key={prompt} onClick={() => submitSearch(prompt, { forceSearch: true })}>
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
      </div>
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
          placeholder="Need emergency cardiac care near Ahmedabad"
        />
        <button title="Send search" type="submit">
          <Send size={18} />
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
  createOutreachDraft
}) {
  const visibleFacilities = useMemo(() => {
    if (activeView === "shortlist") {
      return facilities.filter((facility) => shortlist.includes(facility.id));
    }
    if (activeView === "schedule") {
      return facilities.filter((facility) => schedule.some((entry) => entry.facilityId === facility.id));
    }
    return facilities;
  }, [activeView, facilities, schedule, shortlist]);

  return (
    <section className="mapWorkspace">
      <GoogleMapShell
        facilities={visibleFacilities.length ? visibleFacilities : facilities}
        selectedFacility={selectedFacility}
        onSelect={setSelectedFacilityId}
      />
      <div className="mapToolbar">
        <div>
          <p className="eyebrow">{activeView === "schedule" ? "Route view" : "District context"}</p>
          <h2>
            {activeView === "schedule"
              ? "Ahmedabad visit plan"
              : "Ahmedabad district: hypertension 35%, anaemia 48%"}
          </h2>
        </div>
        <button>
          <Navigation size={17} />
          Optimize
        </button>
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

function GoogleMapShell({ facilities: visibleFacilities, selectedFacility, onSelect }) {
  const mapRef = useRef(null);
  const instanceRef = useRef(null);
  const markerRef = useRef([]);
  const infoWindowRef = useRef(null);
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
    });

    return () => {
      cancelled = true;
    };
  }, [apiKey, mapId, onSelect, selectedFacility.lat, selectedFacility.lng, visibleFacilities]);

  if (apiKey) {
    return (
      <>
        <div className="googleMap" ref={mapRef} />
        <div className="mapProviderBadge">Google Maps · pseudo facility data</div>
      </>
    );
  }

  return (
    <div className="fallbackMap" aria-label="Map preview">
      <div className="mapKeyHint">Add VITE_GOOGLE_MAPS_API_KEY to use Google Maps</div>
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
          Hold
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
          The agent can draft and summarize, but the doctor must approve outreach, replies, and scheduling
          confirmations before anything goes to a clinic.
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
                    <h3>{facility?.name}</h3>
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
            <p>Select a facility and draft an outreach message. Nothing is sent without doctor approval.</p>
          </div>
        )}
      </div>
    </aside>
  );
}

function SchedulePanel({ facilities, schedule, addSchedule, approveSchedule, removeSchedule }) {
  const [facilityId, setFacilityId] = useState(facilities[0].id);
  const [date, setDate] = useState("2026-06-17");
  const [time, setTime] = useState("09:30");
  const [purpose, setPurpose] = useState("Volunteer screening camp");

  return (
    <aside className="sidePanel schedulePanel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Schedule</p>
          <h2>Calendar</h2>
        </div>
        <span className="countBadge">{schedule.length} sessions</span>
      </div>
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
          Create pending hold
        </button>
      </form>
      <div className="plannedList">
        {schedule.map((entry) => {
          const facility = facilities.find((item) => item.id === entry.facilityId);
          return (
            <div className="plannedItem" key={entry.id}>
              <div>
                <h3>{facility?.name}</h3>
                <p>
                  {entry.date} · {entry.time}
                </p>
                <span>{entry.purpose}</span>
                <small className={`calendarStatus status-${entry.status}`}>{formatStatus(entry.status)}</small>
              </div>
              <div className="plannedActions">
                {entry.status !== "confirmed" && (
                  <button title="Approve calendar session" onClick={() => approveSchedule(entry.id)}>
                    <Check size={16} />
                  </button>
                )}
                <button title="Remove visit" onClick={() => removeSchedule(entry.id)}>
                  <Trash2 size={16} />
                </button>
              </div>
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
                return (
                  <div className={`visitBlock ${entry.status}`} key={entry.id}>
                    <span>
                      <Clock3 size={13} />
                      {entry.time}
                    </span>
                    <strong>{facility?.name}</strong>
                    <p>{entry.purpose}</p>
                    <em>{entry.status === "confirmed" ? "Confirmed calendar session" : "Pending doctor approval"}</em>
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
  const specialties = detectLocalSpecialties(rawText);

  const regions = ["Gujarat", "Rajasthan", "Maharashtra", "rural"].filter((region) =>
    new RegExp(region, "i").test(rawText)
  );

  return {
    specialties: specialties.length ? specialties : ["general medicine"],
    regions,
    experience: rawText.match(/(\d+)\s*(years|yrs)/i)?.[1] || ""
  };
}

function detectLocalSpecialties(rawText) {
  return [
    ["cardiology", /cardio|heart|hypertension/i],
    ["critical care", /icu|critical|emergency/i],
    ["diabetes", /diabetes|endocr/i],
    ["general medicine", /general|physician|medicine/i]
  ]
    .filter(([, pattern]) => pattern.test(rawText))
    .map(([label]) => label);
}

function buildPromptTuningState(rawText) {
  const signals = extractPromptSignals(rawText);
  const missingSignals = getMissingPromptSignals(signals);
  const lowConfidenceSignals = getLowConfidencePromptSignals(rawText, signals);
  const followUpQuestions = getFollowUpQuestions(missingSignals).slice(0, 3);
  const qualityLevel = getProfileQualityLevel(signals, missingSignals, rawText);

  return {
    qualityLevel,
    missingSignals,
    lowConfidenceSignals,
    extractedSignals: signals,
    followUpQuestions,
    updatedAt: new Date().toISOString()
  };
}

function extractPromptSignals(rawText) {
  const tags = extractLocalTags(rawText);
  return {
    specialties: detectLocalSpecialties(rawText),
    regions: tags.regions,
    experienceYears: tags.experience,
    languages: extractMatches(rawText, [
      ["English", /english/i],
      ["Hindi", /hindi/i],
      ["Gujarati", /gujarati/i],
      ["Spanish", /spanish/i],
      ["French", /french/i]
    ]),
    missionPurposes: extractMatches(rawText, [
      ["volunteering", /volunteer|mission|camp|screening/i],
      ["relocation", /relocat|moving|move to/i],
      ["referral partnership", /referral|partnership|collaborat/i],
      ["observation", /observership|observe|shadow/i]
    ]),
    availability: extractMatches(rawText, [
      ["dated service window", /\b(january|february|march|april|may|june|july|august|september|october|november|december|mon|tue|wed|thu|fri|sat|sun|\d{4}-\d{2}-\d{2})\b/i],
      ["recurring availability", /available|monthly|weekly|weekend|morning|afternoon|evening/i]
    ]),
    clinicTypes: extractMatches(rawText, [
      ["hospital", /hospital/i],
      ["community clinic", /community clinic/i],
      ["NGO clinic", /ngo/i],
      ["rural clinic", /rural/i],
      ["specialty center", /specialty center|specialist center/i],
      ["teaching hospital", /teaching/i]
    ]),
    credentials: extractMatches(rawText, [
      ["credential context", /license|licensed|board|credential|fellowship|md|do|mbbs/i]
    ])
  };
}

function getMissingPromptSignals(signals) {
  return [
    !signals.specialties.length && "specialty",
    !signals.missionPurposes.length && "mission_purpose",
    !signals.availability.length && "availability",
    !signals.languages.length && "languages",
    !signals.clinicTypes.length && "clinic_type",
    !signals.experienceYears && !signals.credentials.length && "experience_or_credentials"
  ].filter(Boolean);
}

function getLowConfidencePromptSignals(rawText, signals) {
  const lowConfidence = [];
  if (rawText.trim().split(/\s+/).length < 18) lowConfidence.push("profile_detail");
  if (!signals.regions.length) lowConfidence.push("destination_optional");
  return lowConfidence;
}

function getProfileQualityLevel(signals, missingSignals, rawText) {
  const hasSpecialty = signals.specialties.length > 0;
  const hasMission = signals.missionPurposes.length > 0;
  const practicalSignals = [
    signals.languages.length,
    signals.clinicTypes.length,
    signals.availability.length,
    signals.experienceYears,
    signals.credentials.length
  ].filter(Boolean).length;

  if (hasSpecialty && hasMission && practicalSignals >= 1) return "high";
  if (hasSpecialty && rawText.trim().split(/\s+/).length >= 8) return "medium";
  if (missingSignals.length <= 2 && rawText.trim().split(/\s+/).length >= 16) return "medium";
  return "low";
}

function getFollowUpQuestions(missingSignals) {
  const questionBySignal = {
    specialty: "What is your medical specialty or main clinical focus?",
    mission_purpose:
      "Are you looking for volunteering, relocation, referral partnerships, observation, or another type of clinic connection?",
    availability: "When are you available for introductory clinic meetings, and what time zone should I use?",
    languages: "What languages can you use comfortably in clinical or professional settings?",
    clinic_type: "Do you prefer hospitals, community clinics, NGO clinics, rural clinics, specialty centers, or teaching hospitals?",
    experience_or_credentials: "What experience, credentials, or license context should clinics know about?"
  };

  return missingSignals.map((signal) => questionBySignal[signal]).filter(Boolean);
}

function buildInitialChatMessages(profile) {
  const promptTuning = profile.promptTuning || buildPromptTuningState(profile.rawText);
  const specialtyText = profile.tags.specialties.join(", ") || "your specialties";
  const messages = [
    {
      role: "assistant",
      text: `I’ll prioritize ${specialtyText} and show the evidence behind each match. You can also say “update my profile” or “forget my Rajasthan preference” and I’ll adjust your context.`
    }
  ];

  if (promptTuning.followUpQuestions?.length) {
    messages.push({
      role: "assistant",
      text: `To tune clinic matching, I need a little more context. ${promptTuning.followUpQuestions.join(" ")}`
    });
  } else {
    messages.push({
      role: "assistant",
      text: "Your profile has enough matching context to start. Destination can stay open until you want to narrow the search."
    });
  }

  return messages;
}

function mergeFollowUpAnswer(profile, answer, questions) {
  const nextRawText = mergeTranscript(profile.rawText, `Follow-up answer: ${answer}`);
  const nextTags = mergeTags(profile.tags, extractLocalTags(nextRawText));
  const nextPromptTuning = buildPromptTuningState(nextRawText);
  const followUpAnswers = [
    ...(profile.followUpAnswers || []),
    {
      id: crypto.randomUUID(),
      questions,
      answer,
      createdAt: new Date().toISOString()
    }
  ];

  return {
    ...profile,
    rawText: nextRawText,
    tags: nextTags,
    promptTuning: nextPromptTuning,
    followUpAnswers,
    updatedAt: new Date().toISOString()
  };
}

function mergeTags(existingTags, nextTags) {
  return {
    specialties: uniqueValues([...(existingTags.specialties || []), ...(nextTags.specialties || [])]),
    regions: uniqueValues([...(existingTags.regions || []), ...(nextTags.regions || [])]),
    experience: nextTags.experience || existingTags.experience || ""
  };
}

function buildProfileUpdateMessage(profile) {
  const promptTuning = profile.promptTuning || buildPromptTuningState(profile.rawText);
  const learned = [
    profile.tags.specialties.length && `specialty: ${profile.tags.specialties.join(", ")}`,
    profile.tags.regions.length && `region: ${profile.tags.regions.join(", ")}`,
    profile.tags.experience && `experience: ${profile.tags.experience} years`
  ].filter(Boolean);
  const learnedText = learned.length ? `I updated ${learned.join("; ")}.` : "I updated your profile context.";

  if (promptTuning.followUpQuestions.length) {
    return `${learnedText} One more useful detail for stronger matches: ${promptTuning.followUpQuestions[0]}`;
  }

  return `${learnedText} Your profile now has enough context for stronger clinic matching. Destination is still optional until you want to narrow results.`;
}

function extractMatches(rawText, definitions) {
  return definitions.filter(([, pattern]) => pattern.test(rawText)).map(([label]) => label);
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function isSkipIntent(text) {
  return /\b(skip|later|not now|continue|no thanks)\b/i.test(text);
}

function hasExplicitSearchIntent(text) {
  return /\b(find|search|show|recommend|rank|match)\b/i.test(text);
}

function buildOutreachMessage(facility, profile) {
  const specialty = profile.tags.specialties[0] || "medical";
  const region = profile.tags.regions[0] || facility.state;
  const contactLine = facility.email
    ? `I found a public email for ${facility.name}: ${facility.email}.`
    : `I found a public phone number for ${facility.name}: ${facility.phone}.`;

  return `Hello ${facility.name}, I am a ${specialty} doctor planning referral and volunteer outreach near ${region}. I would like to schedule a short introductory meeting to learn whether my background may be useful to your clinic. ${contactLine}`;
}

function getApprovalCount(outreachRequests, schedule) {
  const outreachApprovals = outreachRequests.filter((request) =>
    ["draft", "reply_received"].includes(request.status)
  ).length;
  const calendarApprovals = schedule.filter((entry) => entry.status !== "confirmed").length;
  return outreachApprovals + calendarApprovals;
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
  if (window.google?.maps?.Map && window.google?.maps?.marker?.AdvancedMarkerElement) {
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
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=weekly&loading=async&libraries=marker&callback=__initReferralGoogleMaps`;
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

function renderMapInfo(facility) {
  const tierLabel = tierMeta[facility.tier].label;
  return `
    <div class="gmInfo">
      <strong>${facility.name}</strong>
      <span>${facility.city}, ${facility.state} · ${facility.distanceKm} km</span>
      <em>${tierLabel} evidence</em>
    </div>
  `;
}

export default App;
