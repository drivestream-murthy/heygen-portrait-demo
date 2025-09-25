import StreamingAvatar, { StreamingEvents, TaskType, AvatarQuality } from "@heygen/streaming-avatar";

const banner = document.getElementById("banner");
const unmuteBtn = document.getElementById("unmute");
const stageEl = document.getElementById("stage");
const avatarVideo = document.getElementById("avatarVideo");   // audio source
const avatarCanvas = document.getElementById("avatarCanvas"); // visual (with chroma key)
const overlay = document.getElementById("stageOverlay");
const overlayFrame = document.getElementById("overlayFrame");
const closeOverlayBtn = document.getElementById("closeOverlay");
const menuEl = document.getElementById("menu");
const askForm = document.getElementById("ask");
const inputEl = document.getElementById("text");

const log = (...a)=>console.log("[heygen]",...a);
const showError = (msg)=>{ banner.textContent = msg; banner.classList.remove("hidden"); console.error(msg); };

async function getToken(){
  const r = await fetch("/api/token");
  const j = await r.json().catch(()=>null);
  if (!r.ok || !j?.token) throw new Error("Token error: " + (j?.error || "no token"));
  return j.token;
}

function titleCase(s){ return s.replace(/\b\w/g, ch => ch.toUpperCase()); }

// University backgrounds
const UNI_BG = {
  "oxford":"https://source.unsplash.com/1080x1920/?oxford,university",
  "oxford university":"https://source.unsplash.com/1080x1920/?oxford,university",
  "university of oxford":"https://source.unsplash.com/1080x1920/?oxford,university",
  "shawnee":"https://source.unsplash.com/1080x1920/?shawnee,university",
  "shawnee university":"https://source.unsplash.com/1080x1920/?shawnee,university",
  "shawnee state university":"https://source.unsplash.com/1080x1920/?shawnee,university",
  "stanford":"https://images.unsplash.com/photo-1508175554791-0da3b70a5a53?q=80&w=1080&auto=format&fit=crop",
  "stanford university":"https://images.unsplash.com/photo-1508175554791-0da3b70a5a53?q=80&w=1080&auto=format&fit=crop"
};
function detectUniversity(text){
  const q = text.toLowerCase();
  return Object.keys(UNI_BG).find(k => q.includes(k)) || null;
}
function applyUniversityBg(key){
  if (!key) return;
  stageEl.style.backgroundImage = `url(${UNI_BG[key]})`;
}

// Module config
const SYNTHESIA_ID = "dd552b45-bf27-48c4-96a6-77a2d59e63e7";
const MODULES = {
  "module 1": {
    type: "embed",
    // Embed inside portrait. Autoplay must be muted due to browser policy.
    url: `https://share.synthesia.io/embeds/videos/${SYNTHESIA_ID}?autoplay=1&mute=1`
  },
  "module 2": {
    type: "youtube",
    youtubeId: "I2oQuBRNiHs"
  },
  "finance & accounting": { aliasOf: "module 1" },
  "financial accounting": { aliasOf: "module 1" },
  "human resources": { aliasOf: "module 2" },
  "hr": { aliasOf: "module 2" }
};
function resolveModuleKey(text){
  const q = text.toLowerCase();
  for (const k of Object.keys(MODULES)) if (q.includes(k)) return MODULES[k].aliasOf || k;
  return null;
}

// In-frame overlay
function hideOverlay(){
  overlayFrame.src = "about:blank";
  overlay.style.display = "none";
}
closeOverlayBtn.addEventListener("click", hideOverlay);

async function showModuleInFrame(modKey){
  const m = MODULES[modKey]; if (!m) return false;
  hideOverlay(); // reset
  // Slight delay to ensure layout ready
  await new Promise(r => setTimeout(r, 50));
  overlay.style.display = "block";
  if (m.type === "embed" && m.url) {
    overlayFrame.src = m.url;
    return true;
  }
  if (m.type === "youtube") {
    // Use youtube embed url inside iframe (no API needed here)
    overlayFrame.src = `https://www.youtube.com/embed/${m.youtubeId}?autoplay=1&mute=1&rel=0&modestbranding=1`;
    return true;
  }
  return false;
}

// Web Speech API — always on after first gesture
let rec, listening = false, autoRestart = true;
function startMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { showError("Voice input not supported in this browser. Try Chrome."); return; }
  if (rec) return; // already set
  rec = new SR();
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.continuous = true;
  rec.maxAlternatives = 1;
  rec.onresult = (ev) => {
    const t = ev.results?.[ev.results.length - 1]?.[0]?.transcript;
    if (t) { inputEl.value = t; askForm.requestSubmit(); }
  };
  rec.onend = () => { listening = false; if (autoRestart) { try { rec.start(); listening = true; } catch{} } };
  rec.onerror = () => { listening = false; };
  try { rec.start(); listening = true; } catch {}
}

// Chroma key (remove green) — draws video onto canvas with transparency
// Based on HeyGen’s chroma key streaming guide. This makes the stage background visible through the avatar. 
// Doc: https://docs.heygen.com/docs/adding-chroma-key-to-streaming-demo
function startChromaKeyRendering() {
  const ctx = avatarCanvas.getContext("2d");
  let w = stageEl.clientWidth, h = stageEl.clientHeight;
  avatarCanvas.width = w; avatarCanvas.height = h;

  function draw() {
    // draw the video to canvas scaled to stage size
    try {
      ctx.drawImage(avatarVideo, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      const data = img.data;
      // simple green removal
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2];
        // green-dominant threshold
        if (g > 100 && g > r + 25 && g > b + 25 && r < 140 && b < 140) {
          data[i+3] = 0; // alpha = 0
        }
      }
      ctx.putImageData(img, 0, 0);
    } catch {}
    requestAnimationFrame(draw);
  }
  draw();

  // resize observer to keep canvas in sync with stage size
  new ResizeObserver(() => {
    w = stageEl.clientWidth;
    h = stageEl.clientHeight;
    avatarCanvas.width = w; avatarCanvas.height = h;
  }).observe(stageEl);
}

// Main
(async () => {
  // Get token
  let token;
  try { token = await getToken(); log("Got session token"); }
  catch(e){ showError(e.message); return; }

  const avatar = new StreamingAvatar({ token });
  let session = null;

  // Attach media before start
  avatar.on(StreamingEvents.STREAM_READY, (event) => {
    const stream = event?.detail?.stream || event?.detail || event?.stream;
    if (!stream) { showError("Stream ready, but no MediaStream provided."); return; }
    avatarVideo.srcObject = stream;
    avatarVideo.muted = true; // unmuted after user gesture
    unmuteBtn.style.display = "inline-block";
    // When video can play, begin chroma key render
    avatarVideo.onloadedmetadata = () => startChromaKeyRendering();
  });
  avatar.on(StreamingEvents.STREAM_DISCONNECTED, () => {
    showError("Stream disconnected. Likely firewall/VPN blocking WebRTC or idle timeout.");
  });

  // Start session (greet once)
  try {
    session = await avatar.createStartAvatar({
      avatarName: "default",
      quality: AvatarQuality.High,
      language: "en",
      activityIdleTimeout: 300,
      knowledgeBase: [
        "You are a friendly ERP training assistant. Keep replies under 3 sentences.",
        "Greet the user only at the beginning of the session. Do NOT repeat greetings later.",
        "When a university is mentioned, change the background silently (no announcement).",
        "After learning name + university, offer a short menu of ERP modules: 1) Finance & Accounting, 2) Human Resources (HR).",
        "On module selection, give a brief summary FIRST, THEN show the video inside the portrait frame."
      ].join(" ")
    });
  } catch (e) {
    showError("Failed to start avatar session. " + (e?.message || e));
    return;
  }

  const sid = session?.session_id;
  const say = (text, task=TaskType.REPEAT) => avatar.speak({ sessionId: sid, text, task_type: task });

  // Greeting once
  try {
    await say("Hi there! How are you? I hope you're doing good.", TaskType.REPEAT);
    await new Promise(r => setTimeout(r, 400));
    await say("What is your name, and where are you studying?", TaskType.REPEAT);
  } catch (e) { showError("Speak failed (greeting). " + (e?.message || e)); }

  // Autoplay policy: unmute avatar audio and start voice recognition on first gesture
  function firstGesture() {
    if (avatarVideo.muted) { avatarVideo.muted = false; unmuteBtn.style.display = "none"; }
    startMic();
    window.removeEventListener("click", firstGesture, true);
    window.removeEventListener("keydown", firstGesture, true);
  }
  unmuteBtn.addEventListener("click", firstGesture, { once: true });
  window.addEventListener("click", firstGesture, true);
  window.addEventListener("keydown", firstGesture, true);

  function showMenu(){ menuEl.classList.remove("hidden"); }
  function hideMenu(){ menuEl.classList.add("hidden"); }

  // Module button clicks
  document.getElementById("opt1").addEventListener("click", () => handleModule("module 1"));
  document.getElementById("opt2").addEventListener("click", () => handleModule("module 2"));

  async function handleModule(modKey){
    hideOverlay();
    hideMenu();

    // Short notes (summary) per module
    const notes = modKey === "module 1"
      ? "Module 1 covers Finance and Accounting: recording transactions, summarizing them, and reporting through financial statements."
      : "Module 2 covers Human Resources: hiring, onboarding, payroll coordination, performance, and the overall employee lifecycle.";

    // Speak short notes first
    await say(notes, TaskType.REPEAT).catch(()=>{});

    // Rough timing so video appears AFTER summary (estimate ~2.2 words/sec)
    const ms = Math.max(1200, Math.min(6000, notes.split(/\s+/).length / 2.2 * 1000));
    await new Promise(r => setTimeout(r, ms));

    // Then show video INSIDE portrait
    const ok = await showModuleInFrame(modKey);
    if (!ok) await say("I couldn't load the module video. Please check the module config.", TaskType.REPEAT).catch(()=>{});
  }

  // Text input routing
  askForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const txt = inputEl.value.trim(); inputEl.value = "";
    if (!txt) return;

    const uniKey = detectUniversity(txt);
    if (uniKey) {
      applyUniversityBg(uniKey); // silent background change
      const uniNice = titleCase(uniKey);
      await say(`Glad to hear from the great ${uniNice}.`, TaskType.REPEAT).catch(()=>{});
      await say("There are two ERP modules available: 1) Finance & Accounting, 2) Human Resources. Which one would you like me to explain?", TaskType.REPEAT).catch(()=>{});
      showMenu();
      return;
    }

    const modKey = resolveModuleKey(txt);
    if (modKey) { await handleModule(modKey); return; }

    // General Q&A
    await say(txt, TaskType.TALK).catch((e)=>showError("Speak failed (general). " + (e?.message || e)));
  });

  // Fallback hint if stream never appears
  setTimeout(() => {
    if (!avatarVideo.srcObject) {
      showError("No stream after 10s. If /api/token works, your network/VPN may block WebRTC. Try a hotspot or allow UDP 3478 / TCP 443.");
    }
  }, 10000);
})();
