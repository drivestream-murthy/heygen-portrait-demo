import StreamingAvatar, { StreamingEvents, TaskType, AvatarQuality } from "@heygen/streaming-avatar";

const banner = document.getElementById("banner");
const unmuteBtn = document.getElementById("unmute");
const ytWrap = document.getElementById("ytWrap");
const vidWrap = document.getElementById("vidWrap");
const embedWrap = document.getElementById("embedWrap");
const vidEl = document.getElementById("vid");
const embedEl = document.getElementById("embed");
const menuEl = document.getElementById("menu");
const avatarContainer = document.getElementById("avatar");
const stageEl = document.getElementById("stage");
const inputEl = document.getElementById("text");
const askForm = document.getElementById("ask");
const micBtn = document.getElementById("mic");

const log = (...a)=>console.log("[heygen]",...a);
const showError = (msg)=>{ banner.textContent = msg; banner.classList.remove("hidden"); console.error(msg); };

// --- Helpers --------------------------------------------------------------

async function getToken(){
  const r = await fetch("/api/token");
  const j = await r.json().catch(()=>null);
  if (!r.ok || !j?.token) throw new Error("Token error: " + (j?.error || "no token"));
  return j.token;
}

function titleCase(s){ return s.replace(/\b\w/g, ch => ch.toUpperCase()); }

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
  const key = Object.keys(UNI_BG).find(k => q.includes(k));
  return key || null;
}
function applyUniversityBg(key){
  if (!key) return;
  stageEl.style.backgroundImage = `url(${UNI_BG[key]})`;
}

// Load YouTube API and resolve when ready (avoids race)
function ensureYouTubeReady(){
  return new Promise((resolve)=>{
    if (window.YT?.Player) return resolve();
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    window.onYouTubeIframeAPIReady = () => resolve();
    document.head.appendChild(tag);
  });
}

// --- App logic -----------------------------------------------------------

(async () => {
  // Get token
  let token;
  try { token = await getToken(); log("Got session token"); }
  catch(e){ showError(e.message); return; }

  // Init avatar SDK
  const avatar = new StreamingAvatar({ token });
  let session = null;

  // Attach media events BEFORE start
  avatar.on(StreamingEvents.STREAM_READY, (event) => {
    const stream = event?.detail?.stream || event?.detail || event?.stream;
    if (!stream) { showError("Stream ready, but no MediaStream provided."); return; }
    const v = document.createElement("video");
    v.autoplay = true; v.playsInline = true; v.muted = true;
    v.srcObject = stream;
    window._avatarVideo = v;
    avatarContainer.appendChild(v);
    unmuteBtn.style.display = "inline-block";
  });
  avatar.on(StreamingEvents.STREAM_DISCONNECTED, () => {
    showError("Stream disconnected. Likely firewall/VPN blocking WebRTC or idle timeout.");
  });

  // Start session (greet only ONCE)
  try {
    session = await avatar.createStartAvatar({
      avatarName: "default",
      quality: AvatarQuality.High,
      language: "en",
      activityIdleTimeout: 300,
      knowledgeBase: [
        "You are a friendly ERP training assistant. Keep replies under 3 sentences.",
        "Greet the user only at the beginning of the session. Do NOT repeat greetings on later turns.",
        "When a university is mentioned, change the background silently (no announcement).",
        "After learning name + university, offer a short menu of ERP modules: 1) Finance & Accounting, 2) Human Resources (HR).",
        "If the user picks a module, briefly introduce it and say that the video is shown above."
      ].join(" ")
    });
  } catch (e) {
    showError("Failed to start avatar session. " + (e?.message || e));
    return;
  }

  const sid = session?.session_id;
  const say = (text, task=TaskType.REPEAT) => avatar.speak({ sessionId: sid, text, task_type: task });

  // One-time greeting sequence
  try {
    await say("Hi there! How are you? I hope you're doing good.", TaskType.REPEAT);
    await new Promise(r => setTimeout(r, 400));
    await say("What is your name, and where are you studying?", TaskType.REPEAT);
  } catch (e) { showError("Speak failed (greeting). " + (e?.message || e)); }

  // --- Module / video handling ------------------------------------------

  const MODULES = {
    "module 1": { type:"youtube", youtubeId:"rWET1Jb0408", prompt:"Starting Module 1: Finance & Accounting. The video is playing above." },
    "module 2": { type:"youtube", youtubeId:"I2oQuBRNiHs", prompt:"Starting Module 2: Human Resources (HR). The video is playing above." },
    "finance & accounting": { aliasOf:"module 1" },
    "financial accounting": { aliasOf:"module 1" },
    "human resources": { aliasOf:"module 2" },
    "hr": { aliasOf:"module 2" }
  };
  function resolveModuleKey(text){
    const q = text.toLowerCase();
    for (const k of Object.keys(MODULES)) {
      if (q.includes(k)) return MODULES[k].aliasOf || k;
    }
    return null;
  }

  let ytPlayer, ytReady = false;
  async function initYT(){
    if (ytReady && ytPlayer) return;
    await ensureYouTubeReady();
    ytReady = true;
    ytPlayer = new YT.Player("ytPlayer", {
      events: { onStateChange: (e) => {
        if (e.data === YT.PlayerState.ENDED) {
          ytWrap.classList.add("hidden");
          avatarContainer.classList.remove("min");
          say("Module video finished. What would you like to do next?", TaskType.REPEAT).catch(()=>{});
        }
      }}
    });
  }

  async function showModuleVideo(modKey){
    const m = MODULES[modKey]; if (!m) return false;

    // Always clear any old media
    ytWrap.classList.add("hidden"); vidWrap.classList.add("hidden"); embedWrap.classList.add("hidden");
    vidEl.pause(); vidEl.removeAttribute("src"); vidEl.load();
    embedEl.src = "about:blank";

    avatarContainer.classList.add("min");

    if (m.type === "youtube") {
      await initYT();
      ytWrap.classList.remove("hidden");
      ytPlayer.loadVideoById(m.youtubeId);
      return true;
    }
    if (m.type === "mp4" && m.url) {
      vidWrap.classList.remove("hidden");
      vidEl.src = m.url; vidEl.play().catch(()=>{});
      vidEl.onended = () => {
        vidWrap.classList.add("hidden");
        avatarContainer.classList.remove("min");
        say("Module video finished. What would you like to do next?", TaskType.REPEAT).catch(()=>{});
      };
      return true;
    }
    if (m.type === "embed" && m.url) {
      embedWrap.classList.remove("hidden"); embedEl.src = m.url; return true;
    }
    return false;
  }

  document.getElementById("closeEmbed").addEventListener("click", () => {
    embedEl.src = "about:blank";
    embedWrap.classList.add("hidden");
    avatarContainer.classList.remove("min");
    say("Closed the embedded module. What next?", TaskType.REPEAT).catch(()=>{});
  });

  function showMenu(){
    menuEl.classList.remove("hidden");
  }
  function hideMenu(){ menuEl.classList.add("hidden"); }

  document.getElementById("opt1").addEventListener("click", async ()=>{
    hideMenu();
    await say(MODULES["module 1"].prompt, TaskType.REPEAT).catch(()=>{});
    await showModuleVideo("module 1");
  });
  document.getElementById("opt2").addEventListener("click", async ()=>{
    hideMenu();
    await say(MODULES["module 2"].prompt, TaskType.REPEAT).catch(()=>{});
    await showModuleVideo("module 2");
  });

  // --- Input routing (text + voice) -------------------------------------

  function resetTopMedia(){
    // Requirement: when user moves on, minimize goes away and video hides
    ytWrap.classList.add("hidden"); vidWrap.classList.add("hidden"); embedWrap.classList.add("hidden");
    embedEl.src = "about:blank";
    vidEl.pause(); vidEl.removeAttribute("src"); vidEl.load();
    avatarContainer.classList.remove("min");
  }

  askForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const txt = inputEl.value.trim(); inputEl.value = "";
    if (!txt) return;

    // If not a module request, reset top media per requirement
    if (!resolveModuleKey(txt)) resetTopMedia();

    // University background (silent; no "I'm changing it" announcement)
    const uniKey = detectUniversity(txt);
    if (uniKey) {
      applyUniversityBg(uniKey);
      const uniNice = titleCase(uniKey);
      await say(`Glad to hear from the great ${uniNice}.`, TaskType.REPEAT).catch(()=>{});
      await say("There are two ERP modules available: 1) Finance & Accounting, 2) Human Resources. Which one would you like me to explain?", TaskType.REPEAT).catch(()=>{});
      showMenu();
      return;
    }

    // Module routing
    const modKey = resolveModuleKey(txt);
    if (modKey) {
      hideMenu();
      const m = MODULES[modKey];
      await say(m.prompt || `Starting ${modKey}. The video is playing above.`, TaskType.REPEAT).catch(()=>{});
      const ok = await showModuleVideo(modKey);
      if (!ok) await say("I couldn't load the module video. Please check the module config.", TaskType.REPEAT).catch(()=>{});
      return;
    }

    // General Q&A
    await say(txt, TaskType.TALK).catch((e)=>showError("Speak failed (general). " + (e?.message || e)));
  });

  // Unmute (autoplay policy)
  function tryUnmute(){
    const v = window._avatarVideo;
    if (v && v.muted) { v.muted = false; unmuteBtn.style.display = "none"; }
  }
  unmuteBtn.addEventListener("click", tryUnmute);
  ["click","touchstart","keydown","submit"].forEach(ev => window.addEventListener(ev, tryUnmute, { passive:true }));

  // Voice input (Web Speech API; best in Chrome)
  let rec, listening = false;
  function setupSpeech(){
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const r = new SR();
    r.lang = "en-US";
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (ev) => {
      const t = ev.results?.[0]?.[0]?.transcript;
      if (t) {
        inputEl.value = t;
        askForm.requestSubmit(); // submit the form programmatically
      }
    };
    r.onend = () => { listening = false; micBtn.textContent = "🎙️"; };
    r.onerror = () => { listening = false; micBtn.textContent = "🎙️"; };
    return r;
  }
  rec = setupSpeech();
  micBtn.addEventListener("click", ()=>{
    if (!rec) { showError("Voice input not supported in this browser. Try Chrome."); return; }
    if (!listening) { rec.start(); listening = true; micBtn.textContent = "◼"; } else { rec.stop(); }
  });

  // Fallback hint if stream never appears
  setTimeout(() => {
    if (!window._avatarVideo) {
      showError("No stream after 10s. If /api/token works, your network/VPN may block WebRTC. Try a hotspot or allow UDP 3478 / TCP 443.");
    }
  }, 10000);
})();
