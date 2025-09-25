import StreamingAvatar, { StreamingEvents, TaskType, AvatarQuality } from "@heygen/streaming-avatar";

const banner = document.getElementById("banner");
const unmuteBtn = document.getElementById("unmute");
const stageEl = document.getElementById("stage");
const avatarVideo = document.getElementById("avatarVideo");   // audio source (hidden)
const avatarCanvas = document.getElementById("avatarCanvas"); // visual with chroma key
const overlay = document.getElementById("stageOverlay");      // in-frame video area
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

/* -------------------- University backgrounds -------------------- */
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
  const q = (text||"").toLowerCase();
  return Object.keys(UNI_BG).find(k => q.includes(k)) || null;
}
function applyUniversityBg(key){
  if (!key) return;
  stageEl.style.backgroundImage = `url(${UNI_BG[key]})`;
}

/* -------------------- Modules + FUZZY matching -------------------- */
const SYNTHESIA_ID = "dd552b45-bf27-48c4-96a6-77a2d59e63e7";
const MODULES = {
  "module 1": { type: "embed", url: `https://share.synthesia.io/embeds/videos/${SYNTHESIA_ID}?autoplay=1&mute=1` },
  "module 2": { type: "youtube", youtubeId: "I2oQuBRNiHs" }
};
const MODULE_SYNONYMS = {
  "module 1": [
    "module 1","mod 1","m1","one","1",
    "finance","financial","accounting","accounts","ledger","bookkeeping",
    "finance & accounting","finance and accounting","financial accounting","f&a","fa"
  ],
  "module 2": [
    "module 2","mod 2","m2","two","2",
    "human resources","human resource","hr","people","talent","recruitment","onboarding","payroll"
  ]
};
function normalize(s){ return (s||"").toLowerCase().replace(/[^a-z0-9\s&]/g," ").replace(/\s+/g," ").trim(); }
function levenshtein(a, b){
  a = a || ""; b = b || "";
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({length: m+1}, (_,i)=>Array(n+1).fill(0));
  for (let i=0;i<=m;i++) dp[i][0]=i;
  for (let j=0;j<=n;j++) dp[0][j]=j;
  for (let i=1;i<=m;i++){
    for (let j=1;j<=n;j++){
      const cost = a[i-1]===b[j-1]?0:1;
      dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
    }
  }
  return dp[m][n];
}
function phraseScore(text, phrase){
  const t = normalize(text), p = normalize(phrase);
  if (!t || !p) return 0;
  if (t.includes(p)) return 1;
  const tks = t.split(" "), pks = p.split(" ");
  let hits = 0;
  for (const pk of pks){
    if (tks.includes(pk)) { hits++; continue; }
    const th = pk.length >= 6 ? 2 : (pk.length >= 4 ? 1 : 0);
    if (tks.some(w => levenshtein(w, pk) <= th)) hits++;
  }
  const overlap = hits / pks.length;
  const dist = levenshtein(t, p);
  const whole = p.length ? 1 - (dist / Math.max(p.length, 1)) : 0;
  return Math.max(overlap * 0.8 + whole * 0.2, whole * 0.7);
}
function resolveModuleKey(text){
  const t = normalize(text);
  if (/\b(1|one)\b/.test(t)) return "module 1";
  if (/\b(2|two)\b/.test(t)) return "module 2";
  let best = { key: null, score: 0 };
  for (const key of Object.keys(MODULE_SYNONYMS)){
    const s = MODULE_SYNONYMS[key].reduce((mx,ph)=>Math.max(mx, phraseScore(t, ph)), 0);
    if (s > best.score) best = { key, score: s };
  }
  return best.score >= 0.42 ? best.key : null;
}

/* -------------------- In-frame overlay video -------------------- */
function hideOverlay(){
  overlayFrame.src = "about:blank";
  overlay.style.display = "none";
  stageEl.classList.remove("min");
}
closeOverlayBtn.addEventListener("click", hideOverlay);

async function showModuleInFrame(modKey){
  const m = MODULES[modKey]; if (!m) return false;
  hideOverlay();
  await new Promise(r => setTimeout(r, 50));
  overlay.style.display = "block";
  stageEl.classList.add("min");
  if (m.type === "embed" && m.url) {
    overlayFrame.src = m.url; // Synthesia embed (muted autoplay)
    return true;
  }
  if (m.type === "youtube") {
    overlayFrame.src = `https://www.youtube-nocookie.com/embed/${m.youtubeId}?autoplay=1&mute=1&rel=0&modestbranding=1`;
    return true;
  }
  return false;
}

/* -------------------- Voice: always-on after first gesture -------------------- */
let rec, listening = false, autoRestart = true;
function startMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { showError("Voice input not supported in this browser. Try Chrome."); return; }
  if (rec) return;
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

/* -------------------- Chroma key (green removal) + cover fit -------------------- */
function startChromaKeyRendering() {
  const ctx = avatarCanvas.getContext("2d");
  let cw = stageEl.clientWidth, ch = stageEl.clientHeight;
  avatarCanvas.width = cw; avatarCanvas.height = ch;

  function draw() {
    try {
      const vw = avatarVideo.videoWidth || 640;
      const vh = avatarVideo.videoHeight || 360;
      if (vw && vh) {
        // object-fit: cover (crop source to preserve aspect)
        const cr = cw / ch, vr = vw / vh;
        let sx=0, sy=0, sw=vw, sh=vh;
        if (vr > cr) { sw = Math.round(vh * cr); sx = Math.round((vw - sw) / 2); }
        else { sh = Math.round(vw / cr); sy = Math.round((vh - sh) / 2); }
        ctx.drawImage(avatarVideo, sx, sy, sw, sh, 0, 0, cw, ch);

        // chroma-key remove green
        const img = ctx.getImageData(0, 0, cw, ch);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i+1], b = d[i+2];
          if (g > 80 && g > r + 20 && g > b + 20 && r < 160 && b < 160) d[i+3] = 0;
        }
        ctx.putImageData(img, 0, 0);
      }
    } catch {}
    requestAnimationFrame(draw);
  }
  draw();

  new ResizeObserver(() => {
    cw = stageEl.clientWidth;
    ch = stageEl.clientHeight;
    avatarCanvas.width = cw; avatarCanvas.height = ch;
  }).observe(stageEl);
}

/* -------------------- Main flow -------------------- */
(async () => {
  // Token
  let token;
  try { token = await getToken(); log("Got session token"); }
  catch(e){ showError(e.message); return; }

  const avatar = new StreamingAvatar({ token });
  let session = null;

  // Media events
  avatar.on(StreamingEvents.STREAM_READY, (event) => {
    const stream = event?.detail?.stream || event?.detail || event?.stream;
    if (!stream) { showError("Stream ready, but no MediaStream provided."); return; }
    avatarVideo.srcObject = stream;
    avatarVideo.muted = true; // unmute on first gesture
    unmuteBtn.style.display = "inline-block";
    avatarVideo.onloadedmetadata = () => startChromaKeyRendering();
  });
  avatar.on(StreamingEvents.STREAM_DISCONNECTED, () => {
    showError("Stream disconnected. Likely firewall/VPN blocking WebRTC or idle timeout.");
  });

  // Start session
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

  // Greet once
  try {
    await say("Hi there! How are you? I hope you're doing good.", TaskType.REPEAT);
    await new Promise(r => setTimeout(r, 400));
    await say("What is your name, and where are you studying?", TaskType.REPEAT);
  } catch (e) { showError("Speak failed (greeting). " + (e?.message || e)); }

  // First gesture: unmute avatar audio + start always-on mic
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

  document.getElementById("opt1").addEventListener("click", () => handleModule("module 1"));
  document.getElementById("opt2").addEventListener("click", () => handleModule("module 2"));

  async function handleModule(modKey){
    hideOverlay(); hideMenu();

    const notes = modKey === "module 1"
      ? "Module 1 covers Finance and Accounting: recording transactions, summarizing them, and reporting via financial statements."
      : "Module 2 covers Human Resources: hiring, onboarding, payroll coordination, performance, and the overall employee lifecycle.";

    await say(notes, TaskType.REPEAT).catch(()=>{});

    // Wait so the summary finishes before the video appears
    const ms = Math.max(1200, Math.min(6000, notes.split(/\s+/).length / 2.2 * 1000));
    await new Promise(r => setTimeout(r, ms));

    const ok = await showModuleInFrame(modKey);
    if (!ok) await say("I couldn't load the module video. Please check the module configuration.", TaskType.REPEAT).catch(()=>{});
  }

  // Text (and voice-filled) input routing
  askForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const txt = inputEl.value.trim(); inputEl.value = "";
    if (!txt) return;

    const uniKey = detectUniversity(txt);
    if (uniKey) {
      applyUniversityBg(uniKey); // silent
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

  // Fallback hint
  setTimeout(() => {
    if (!avatarVideo.srcObject) {
      showError("No stream after 10s. If /api/token works, your network/VPN may block WebRTC. Try a hotspot or allow UDP 3478 / TCP 443.");
    }
  }, 10000);
})();
