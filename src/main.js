import StreamingAvatar, { StreamingEvents, TaskType, AvatarQuality } from "@heygen/streaming-avatar";

/* ---------- DOM ---------- */
const banner = document.getElementById("banner");
const startBtn = document.getElementById("startBtn");
const stageEl = document.getElementById("stage");
const avatarVideo = document.getElementById("avatarVideo");   // audio source (hidden)
const avatarCanvas = document.getElementById("avatarCanvas"); // visual with chroma key
const overlay = document.getElementById("stageOverlay");
const overlayFrame = document.getElementById("overlayFrame"); // Synthesia / web
const ytContainer = document.getElementById("ytContainer");   // YouTube API container
const closeOverlayBtn = document.getElementById("closeOverlay");

const confirmBar = document.getElementById("confirmBar");
const confirmYes = document.getElementById("confirmYes");
const confirmNo  = document.getElementById("confirmNo");

const menuERP = document.getElementById("menuERP");
const menuDS  = document.getElementById("menuDS");

const askForm = document.getElementById("ask");
const inputEl = document.getElementById("text");

/* ---------- helpers ---------- */
const log = (...a)=>console.log("[heygen]",...a);
const showError = (msg)=>{ banner.textContent = msg; banner.classList.remove("hidden"); console.error(msg); };
const hideError = ()=>banner.classList.add("hidden");

async function getToken(){
  const r = await fetch("/api/token");
  const j = await r.json().catch(()=>null);
  if (!r.ok || !j?.token) throw new Error("Token error: " + (j?.error || "no token"));
  return j.token;
}
const titleCase = (s)=>s.replace(/\b\w/g, ch => ch.toUpperCase());
const sleep = (ms)=>new Promise(r=>setTimeout(r, ms));

/* ---------- backgrounds (serve from /public/assets/*) ---------- */
const BG = {
  DEFAULT: "/assets/default-image.jpg",
  STANFORD: "/assets/stanford-university-title.jpg",
  HARVARD: "/assets/harvard-university-title.jpg",
  OXFORD: "/assets/oxford-university-title.jpg"
};
let currentBg = "DEFAULT";
function applyBg(key="DEFAULT"){ currentBg = key; stageEl.style.backgroundImage = `url(${BG[key]||BG.DEFAULT})`; }
function resetToDefault(){ applyBg("DEFAULT"); }

const UNI_MAP = [
  { keys: ["stanford","stanford university"], bg: "STANFORD" },
  { keys: ["harvard","harvard university"],   bg: "HARVARD"  },
  { keys: ["oxford","oxford university","university of oxford"], bg: "OXFORD" }
];
function detectUniversity(text){
  const q = (text||"").toLowerCase();
  for (const {keys,bg} of UNI_MAP) if (keys.some(k => q.includes(k))) return bg;
  return null;
}

/* ---------- ERP Modules (with fuzzy matching) ---------- */
const SYNTHESIA_ID = "dd552b45-bf27-48c4-96a6-77a2d59e63e7";
const MODULES = {
  "module 1": { type: "synthesia", url: `https://share.synthesia.io/embeds/videos/${SYNTHESIA_ID}?autoplay=1&mute=1` },
  "module 2": { type: "youtube",   youtubeId: "I2oQuBRNiHs" }
};
const MODULE_SYNONYMS = {
  "module 1": ["module 1","mod 1","m1","one","1","finance","financial","accounting","accounts","ledger","bookkeeping","finance & accounting","finance and accounting","financial accounting","f&a","fa"],
  "module 2": ["module 2","mod 2","m2","two","2","human resources","human resource","hr","people","talent","recruitment","onboarding","payroll"]
};
const normalize = (s)=> (s||"").toLowerCase().replace(/[^a-z0-9\s&]/g," ").replace(/\s+/g," ").trim();
function levenshtein(a,b){a=a||"";b=b||"";const m=a.length,n=b.length;if(!m)return n;if(!n)return m;const dp=Array.from({length:m+1},(_,i)=>Array(n+1).fill(0));for(let i=0;i<=m;i++)dp[i][0]=i;for(let j=0;j<=n;j++)dp[0][j]=j;for(let i=1;i<=m;i++){for(let j=1;j<=n;j++){const c=a[i-1]===b[j-1]?0:1;dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+c)}}return dp[m][n]}
function phraseScore(text,phrase){const t=normalize(text),p=normalize(phrase);if(!t||!p)return 0;if(t.includes(p))return 1;const tks=t.split(" "),pks=p.split(" ");let hits=0;for(const pk of pks){if(tks.includes(pk)){hits++;continue}const th=pk.length>=6?2:(pk.length>=4?1:0);if(tks.some(w=>levenshtein(w,pk)<=th))hits++}const overlap=hits/pks.length;const dist=levenshtein(t,p);const whole=p.length?1-(dist/Math.max(p.length,1)):0;return Math.max(overlap*.8+whole*.2,whole*.7)}
function resolveModuleKey(text){
  const t = normalize(text);
  if (/\b(1|one)\b/.test(t)) return "module 1";
  if (/\b(2|two)\b/.test(t)) return "module 2";
  let best={key:null,score:0};
  for(const key of Object.keys(MODULE_SYNONYMS)){
    const s = MODULE_SYNONYMS[key].reduce((mx,ph)=>Math.max(mx, phraseScore(t, ph)), 0);
    if(s>best.score) best={key,score:s};
  }
  return best.score>=0.42?best.key:null;
}

/* ---------- Drivestream topics (simple, safe summaries + links) ---------- */
const DS = {
  home:     { keys:["drivestream","website","home"], summary:"Drivestream delivers Oracle Cloud consulting and enterprise transformation.", url:"http://www.drivestream.com/" },
  about:    { keys:["about","company","the company"], summary:"Learn about Drivestream’s mission, leadership and story.", url:"https://www.drivestream.com/the-company/" },
  partners: { keys:["partners","partnerships"], summary:"Explore Drivestream’s partner ecosystem.", url:"https://www.drivestream.com/partners/" },
  team:     { keys:["team","meet the team","leadership"], summary:"Meet the Drivestream leadership and team.", url:"https://www.drivestream.com/meet-the-team/" },
  consulting:{ keys:["consulting","oracle cloud consulting"], summary:"Consulting services for Oracle Cloud across ERP and HCM.", url:"https://www.drivestream.com/oracle-cloud-consulting/" },
  subscription:{ keys:["subscription","services subscription"], summary:"Oracle Cloud Services Subscription options and bundles.", url:"https://www.drivestream.com/oracle-cloud-services-subscription/" },
  erp:      { keys:["erp","oracle cloud erp"], summary:"Oracle Cloud ERP implementations and best practices.", url:"https://www.drivestream.com/oracle-cloud-erp/" },
  hcm:      { keys:["hcm","human capital management","oracle cloud hcm"], summary:"Oracle Cloud HCM solutions for the full employee lifecycle.", url:"https://www.drivestream.com/oracle-cloud-hcm/" },
  payroll:  { keys:["payroll"], summary:"Payroll with Oracle Cloud HCM.", url:"https://www.drivestream.com/oracle-cloud-hcm-payroll/" },
  advisory: { keys:["strategy","advisory","strategy and advisory"], summary:"Strategy & Advisory for your cloud journey.", url:"https://www.drivestream.com/strategy-and-advisory/" },
  ams:      { keys:["ams","managed services","application management"], summary:"Application Managed Services (AMS) for Oracle Cloud.", url:"https://www.drivestream.com/ams/" },
  industries:{ keys:["industries","verticals"], summary:"Industries served: financial services, professional services, retail, high tech, utilities, healthcare, manufacturing.", url:"https://www.drivestream.com/industries/" },
  customers:{ keys:["customers","clients","case studies"], summary:"Customer stories and outcomes.", url:"https://www.drivestream.com/customers/" },
  finserv:  { keys:["financial services"], summary:"Oracle Cloud solutions for Financial Services.", url:"https://www.drivestream.com/financial-services/" },
  profserv: { keys:["professional services"], summary:"Oracle Cloud solutions for Professional Services.", url:"https://www.drivestream.com/professional-services/" },
  retail:   { keys:["retail"], summary:"Oracle Cloud for Retail.", url:"https://www.drivestream.com/retail/" },
  hightech: { keys:["high tech","high-tech"], summary:"Oracle Cloud for High Tech.", url:"https://www.drivestream.com/high-tech/" },
  utilities:{ keys:["utilities"], summary:"Oracle Cloud for Utilities.", url:"https://www.drivestream.com/utilities/" },
  healthcare:{ keys:["healthcare"], summary:"Oracle Cloud for Healthcare.", url:"https://www.drivestream.com/healthcare/" },
  manufacturing:{ keys:["manufacturing"], summary:"Oracle Cloud for Manufacturing.", url:"https://www.drivestream.com/manufacturing/" }
};
function resolveDSTopic(text){
  const q = normalize(text);
  for(const [k,{keys}] of Object.entries(DS)){
    if(keys.some(term=>q.includes(normalize(term)))) return k;
  }
  if (q.includes("drivestream")) return "home";
  return null;
}

/* ---------- YouTube API readiness ---------- */
let youTubeReady;
{
  let _resolve;
  youTubeReady = new Promise(res => { _resolve = res; });
  // If API already loaded
  const wait = () => {
    if (window.YT && window.YT.Player) return _resolve();
    setTimeout(wait, 50);
  };
  window.onYouTubeIframeAPIReady = () => _resolve();
  wait();
}

/* ---------- Overlay (video inside portrait) ---------- */
let ytPlayer = null;
function hideOverlay({resetBg=true}={}) {
  overlayFrame.src = "about:blank";
  if (ytPlayer) { try { ytPlayer.destroy(); } catch {} ytPlayer = null; }
  ytContainer.innerHTML = "";
  overlay.style.display = "none";
  stageEl.classList.remove("min");
  if (resetBg) resetToDefault();
}
async function showModuleInFrame(modKey){
  const m = MODULES[modKey]; if (!m) return false;
  hideOverlay({resetBg:false});
  await sleep(50);
  overlay.style.display = "block";
  stageEl.classList.add("min");

  if (m.type === "synthesia") {
    overlayFrame.classList.add("show");
    overlayFrame.src = m.url; // autoplay muted per policy
    // No reliable 'ended' event from cross-origin Synthesia → optional 2m fallback
    setTimeout(()=>{ if (overlay.style.display!=="none") { hideOverlay(); speakNext("The video has finished. What would you like next?"); }}, 120000);
    return true;
  }
  if (m.type === "youtube") {
    await youTubeReady;
    overlayFrame.classList.remove("show");
    const div = document.createElement("div"); div.id = "ytInner";
    ytContainer.appendChild(div); ytContainer.classList.add("show");
    ytPlayer = new YT.Player("ytInner", {
      videoId: m.youtubeId,
      playerVars: { autoplay: 1, mute: 1, rel: 0, modestbranding: 1 },
      events: {
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.ENDED) {
            hideOverlay();
            speakNext("The video has finished. What would you like to do next?");
          }
        }
      }
    });
    return true;
  }
  return false;
}
closeOverlayBtn.addEventListener("click", ()=>{
  hideOverlay();
  speakNext("Closed the video. What would you like to do next?");
});

/* ---------- Voice: always-on after first gesture ---------- */
let rec, listening = false, autoRestart = true;
function startMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { showError("Voice input not supported in this browser. Try Chrome."); return; }
  if (rec) return;
  rec = new SR();
  rec.lang = "en-US"; rec.interimResults = false; rec.continuous = true; rec.maxAlternatives = 1;
  rec.onresult = (ev) => {
    const t = ev.results?.[ev.results.length - 1]?.[0]?.transcript;
    if (t) { inputEl.value = t; askForm.requestSubmit(); }
  };
  rec.onend = () => { listening = false; if (autoRestart) { try { rec.start(); listening = true; } catch{} } };
  rec.onerror = () => { listening = false; };
  try { rec.start(); listening = true; } catch {}
}

/* ---------- Chroma-key (green removal) + cover fit ---------- */
function startChromaKeyRendering() {
  const ctx = avatarCanvas.getContext("2d");
  let cw = stageEl.clientWidth, ch = stageEl.clientHeight;
  avatarCanvas.width = cw; avatarCanvas.height = ch;

  function draw() {
    try {
      const vw = avatarVideo.videoWidth || 640, vh = avatarVideo.videoHeight || 360;
      if (vw && vh) {
        // object-fit: cover (crop source to preserve aspect)
        const cr = cw / ch, vr = vw / vh;
        let sx=0, sy=0, sw=vw, sh=vh;
        if (vr > cr) { sw = Math.round(vh * cr); sx = Math.round((vw - sw) / 2); }
        else { sh = Math.round(vw / cr); sy = Math.round((vh - sh) / 2); }
        ctx.drawImage(avatarVideo, sx, sy, sw, sh, 0, 0, cw, ch);

        // chroma key
        const img = ctx.getImageData(0, 0, cw, ch), d = img.data;
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
    cw = stageEl.clientWidth; ch = stageEl.clientHeight;
    avatarCanvas.width = cw; avatarCanvas.height = ch;
  }).observe(stageEl);
}

/* ---------- HeyGen session ---------- */
let avatar, sid;
function speak(text, task=TaskType.REPEAT){ return avatar.speak({ sessionId: sid, text, task_type: task }); }
async function speakNext(text){ try { await speak(text, TaskType.REPEAT); } catch(e){ showError("Speak failed: "+(e?.message||e)); } }

(async () => {
  applyBg("DEFAULT"); // default background at start

  // Token + stream
  let token; try { token = await getToken(); } catch(e){ showError(e.message); return; }
  avatar = new StreamingAvatar({ token });

  avatar.on(StreamingEvents.STREAM_READY, (event) => {
    const stream = event?.detail?.stream || event?.detail || event?.stream;
    if (!stream) { showError("Stream ready, but no MediaStream provided."); return; }
    avatarVideo.srcObject = stream;
    avatarVideo.muted = true; // unmute after Start
    startBtn.classList.remove("hidden");
    avatarVideo.onloadedmetadata = () => startChromaKeyRendering();
  });
  avatar.on(StreamingEvents.STREAM_DISCONNECTED, () => showError("Stream disconnected. If /api/token works, check VPN/firewall."));

  // Start avatar
  try {
    const session = await avatar.createStartAvatar({
      avatarName: "default",
      quality: AvatarQuality.High,
      language: "en",
      activityIdleTimeout: 300,
      knowledgeBase: [
        "You are a friendly assistant for Drivestream and ERP training. Keep replies under 3 sentences.",
        "Greet only once at the beginning.",
        "If asked about Drivestream, answer briefly and include a helpful page link when possible.",
        "If the question is out of scope, say: 'There isn’t enough information for that. Try asking about Drivestream or ERP Module 1/2.'"
      ].join(" ")
    });
    sid = session?.session_id;
  } catch(e){ showError("Failed to start avatar session. "+(e?.message||e)); return; }

  // Greeting
  await speakNext("Hi there! How are you? I hope you're doing good.");
  await sleep(400);
  await speakNext("What is your name, and where are you studying?");

  // Start button: unmutes audio and starts always-on mic; acts as sound toggle afterwards
  startBtn.addEventListener("click", ()=>{
    if (avatarVideo.muted) {
      avatarVideo.muted = false;
      startBtn.textContent = "⏸ Sound";
      startMic();
    } else {
      avatarVideo.muted = true;
      startBtn.textContent = "▶ Sound";
    }
  });

  // ERP menu buttons
  document.getElementById("opt1").addEventListener("click", ()=> askToPlay("module 1"));
  document.getElementById("opt2").addEventListener("click", ()=> askToPlay("module 2"));

  // Drivestream menu buttons
  Array.from(menuDS.querySelectorAll("button[data-ds]")).forEach(btn=>{
    btn.addEventListener("click", ()=> handleDSTopic(btn.dataset.ds));
  });

  // Input (typed or speech-filled)
  askForm.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const txt = inputEl.value.trim(); inputEl.value = "";
    if (!txt) return;

    hideError(); confirmBar.classList.add("hidden");

    // University → change background silently, then show choices
    const uniBg = detectUniversity(txt);
    if (uniBg) {
      applyBg(uniBg);
      await speakNext(`Glad to hear from the great ${titleCase(uniBg.toLowerCase().replace(/_/g,' '))}.`);
      await speakNext("What would you like to know: Drivestream topics or ERP training?");
      showMenus(); return;
    }

    // ERP module fuzzy
    const modKey = resolveModuleKey(txt);
    if (modKey) { await askToPlay(modKey); return; }

    // Drivestream topic fuzzy
    const dsKey = resolveDSTopic(txt);
    if (dsKey) { await handleDSTopic(dsKey); return; }

    // General Q&A (fallback if model can’t find info)
    try { await speak(txt, TaskType.TALK); }
    catch { await speakNext("There isn’t enough information for that. Try asking about Drivestream or ERP Module 1/2."); }
  });
})();

/* ---------- Menus & flows ---------- */
function showMenus(){ menuERP.classList.remove("hidden"); menuDS.classList.remove("hidden"); }
function hideMenus(){ menuERP.classList.add("hidden"); menuDS.classList.add("hidden"); }

/* Module flow: summary → ask to play → (yes/no) → in-frame video */
async function askToPlay(modKey){
  hideMenus(); hideOverlay({resetBg:false});
  const notes = modKey==="module 1"
    ? "ERP Module 1 covers Finance and Accounting: recording transactions, summarizing them, and reporting via financial statements."
    : "ERP Module 2 covers Human Resources: hiring, onboarding, payroll, performance, and the overall employee lifecycle.";
  await speakNext(notes);

  // Ensure video only after the speaking finishes (roughly 2.2 w/s)
  const ms = Math.max(1200, Math.min(6000, notes.split(/\s+/).length/2.2*1000));
  await sleep(ms);

  // Ask consent to play
  confirmBar.classList.remove("hidden");
  confirmYes.onclick = async ()=>{
    confirmBar.classList.add("hidden");
    const ok = await showModuleInFrame(modKey);
    if (!ok) await speakNext("I couldn’t load the module video. Please try again.");
  };
  confirmNo.onclick  = async ()=>{
    confirmBar.classList.add("hidden");
    await speakNext("Okay, I’ll skip the video. What would you like next?");
  };
}

/* Drivestream flow */
async function handleDSTopic(dsKey){
  hideMenus(); hideOverlay();
  const t = DS[dsKey]; if (!t) { await speakNext("There isn’t enough information for that."); return; }
  await speakNext(`${t.summary} You can learn more here: ${t.url}`);
  await speakNext("Would you like to hear about ERP training as well, or explore another Drivestream topic?");
  showMenus();
}
