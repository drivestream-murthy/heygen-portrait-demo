import StreamingAvatar, { StreamingEvents, TaskType, AvatarQuality } from "@heygen/streaming-avatar";

const banner = document.getElementById("banner");
const unmuteBtn = document.getElementById("unmute");
const log = (...a)=>console.log("[heygen]",...a);
function showError(msg){ banner.textContent = msg; banner.classList.remove("hidden"); console.error(msg); }

async function getToken(){
  const r = await fetch("/api/token");
  const j = await r.json().catch(()=>null);
  if (!r.ok || !j?.token) throw new Error("Token error: " + (j?.error || "no token"));
  return j.token;
}

(async () => {
  let token;
  try { token = await getToken(); log("Got session token"); }
  catch(e){ showError(e.message); return; }

  const avatar = new StreamingAvatar({ token });
  let session = null;

  avatar.on(StreamingEvents.STREAM_READY, (event) => {
    log("STREAM_READY", event);
    const stream = event?.detail?.stream || event?.detail || event?.stream;
    if (!stream) { showError("Stream ready, but no MediaStream provided."); return; }
    const v = document.createElement("video");
    v.autoplay = true; v.playsInline = true; v.muted = true;
    v.srcObject = stream;
    window._avatarVideo = v;
    document.getElementById("avatar").appendChild(v);
    unmuteBtn.style.display = "inline-block";
  });

  avatar.on(StreamingEvents.STREAM_DISCONNECTED, () => {
    showError("Stream disconnected. Likely firewall/VPN blocking WebRTC or idle timeout.");
  });

  try {
    session = await avatar.createStartAvatar({
      avatarName: "default",
      quality: AvatarQuality.High,
      language: "en",
      activityIdleTimeout: 300,
      knowledgeBase: [
        "You are a friendly ERP training assistant. Keep replies under 3 sentences.",
        "Always begin with: 'Hi there! How are you? I hope you're doing good.' Then ask: 'What is your name, and where are you studying?'",
        "If the user mentions a university, acknowledge it briefly and continue.",
        "ERP Modules: 1) Finance & Accounting - records, summarizes, and reports transactions via financial statements. 2) Human Resources (HR) - manages the employee lifecycle."
      ].join(" ")
    });
    log("Session started", session);
  } catch (e) {
    showError("Failed to start avatar session. " + (e?.message || e));
    return;
  }

  function tryUnmute(){
    const v = window._avatarVideo;
    if (v && v.muted) { v.muted = false; unmuteBtn.style.display = "none"; }
  }
  unmuteBtn.addEventListener("click", tryUnmute);
  ["click","touchstart","keydown","submit"].forEach(ev => window.addEventListener(ev, tryUnmute, { passive:true }));

  const sid = session?.session_id;
  const say = (text, task=TaskType.REPEAT) => avatar.speak({ sessionId: sid, text, task_type: task });

  try {
    await say("Hi there! How are you? I hope you're doing good.", TaskType.REPEAT);
    await new Promise(r => setTimeout(r, 400));
    await say("What is your name, and where are you studying?", TaskType.REPEAT);
  } catch (e) { showError("Speak failed (greeting). " + (e?.message || e)); }

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
  function tryApplyUniversityBg(text){
    const q = text.toLowerCase();
    const key = Object.keys(UNI_BG).find(k => q.includes(k));
    if (key) { document.getElementById("stage").style.backgroundImage = `url(${UNI_BG[key]})`; return key; }
    return null;
  }

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

  const vidWrap  = document.getElementById("vidWrap");
  const vidEl    = document.getElementById("vid");
  const ytWrap   = document.getElementById("ytWrap");
  const embedWrap= document.getElementById("embedWrap");
  const embedEl  = document.getElementById("embed");

  document.getElementById("closeEmbed").addEventListener("click", () => {
    embedEl.src = "about:blank";
    embedWrap.classList.add("hidden");
    document.getElementById("avatar").classList.remove("min");
    say("Closed the embedded module. What next?", TaskType.REPEAT).catch(()=>{});
  });

  let ytPlayer, ytReady = false;
  window.onYouTubeIframeAPIReady = () => {
    ytReady = true;
    ytPlayer = new YT.Player("ytPlayer", {
      events: { onStateChange: (e) => {
        if (e.data === YT.PlayerState.ENDED) {
          ytWrap.classList.add("hidden");
          document.getElementById("avatar").classList.remove("min");
          say("Module video finished. What would you like to do next?", TaskType.REPEAT).catch(()=>{});
        }
      }}
    });
  };

  function showModuleVideo(modKey){
    const m = MODULES[modKey]; if (!m) return false;
    document.getElementById("avatar").classList.add("min");

    ytWrap.classList.add("hidden"); vidWrap.classList.add("hidden"); embedWrap.classList.add("hidden");
    vidEl.pause(); vidEl.removeAttribute("src"); vidEl.load();
    if (ytPlayer && ytReady) { try { ytPlayer.stopVideo(); } catch {} }
    embedEl.src = "about:blank";

    if (m.type === "youtube" && ytReady && ytPlayer) {
      ytWrap.classList.remove("hidden"); ytPlayer.loadVideoById(m.youtubeId); return true;
    }
    if (m.type === "mp4" && m.url) {
      vidWrap.classList.remove("hidden"); vidEl.src = m.url; vidEl.play().catch(()=>{});
      vidEl.onended = () => {
        vidWrap.classList.add("hidden");
        document.getElementById("avatar").classList.remove("min");
        say("Module video finished. What would you like to do next?", TaskType.REPEAT).catch(()=>{});
      };
      return true;
    }
    if (m.type === "embed" && m.url) { embedWrap.classList.remove("hidden"); embedEl.src = m.url; return true; }
    return false;
  }

  document.getElementById("ask").addEventListener("submit", async (e) => {
    e.preventDefault();
    const el = document.getElementById("text");
    const txt = el.value.trim(); el.value = "";
    if (!txt) return;

    const uni = tryApplyUniversityBg(txt);
    if (uni) await say(`Great! Updating your background to ${uni}.`, TaskType.REPEAT).catch(()=>{});

    const modKey = resolveModuleKey(txt);
    if (modKey) {
      const m = MODULES[modKey];
      await say(m.prompt || `Starting ${modKey}. The video is playing above.`, TaskType.REPEAT).catch(()=>{});
      const ok = showModuleVideo(modKey);
      if (!ok) await say("I couldn't load the module video. Please check the module config.", TaskType.REPEAT).catch(()=>{});
      return;
    }

    await say(txt, TaskType.TALK).catch((e)=>showError("Speak failed (general). " + (e?.message || e)));
  });

  setTimeout(() => {
    if (!window._avatarVideo) {
      showError("No stream after 10s. If /api/token works, your network/VPN may block WebRTC. Try a hotspot or allow UDP 3478 / TCP 443.");
    }
  }, 10000);
})();
