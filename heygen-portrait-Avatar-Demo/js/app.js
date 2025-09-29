import { createIdleTimer } from './idleTimer.js';

async function loadJSON(path){
  const res = await fetch(path, {cache:'no-store'});
  if (!res.ok) throw new Error('Failed to load ' + path);
  return res.json();
}

// ---- AvatarBridge: TTS fallback (no credits) ----
window.AvatarBridge = (function(){
  let _active=false, utterance=null;
  function speak(text, onEnd){
    if(!('speechSynthesis' in window)) { console.warn('SpeechSynthesis not available'); onEnd && onEnd(); return Promise.resolve(); }
    try{ speechSynthesis.cancel(); }catch(e){}
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1; u.pitch = 1; u.volume = 1;
    u.onend = ()=> onEnd && onEnd();
    speechSynthesis.speak(u);
    return Promise.resolve();
  }
  return {
    get active(){ return _active; },
    async start(text, onEnd){ _active=true; return speak(text, onEnd); },
    async pause(){ if(!_active) return; try{ speechSynthesis.pause(); }catch(e){} },
    async resume(){ if(!_active) return; try{ speechSynthesis.resume(); }catch(e){} },
    async stop(){ _active=false; try{ speechSynthesis.cancel(); }catch(e){} }
  };
})();

const state = { config:null, links:null, currentModuleIdx:-1, ytPlayer:null, idle:null };
const stage = document.querySelector('#stage');
const statusEl = document.querySelector('#status');

function setStatus(t){ if(statusEl) statusEl.textContent = t; }
function setButtons(running){
  const s = document.getElementById('btn-start');
  const p = document.getElementById('btn-pause');
  const st = document.getElementById('btn-stop');
  if (!s||!p||!st) return;
  s.disabled = running; p.disabled = !running; st.disabled = !running;
}

function speakText(m){
  const t = (m.script || m.prompt || m.text || m.content || m.title || '').toString().trim();
  return t;
}

function renderWelcome(){
  const ui = state.config?.ui || {};
  const bg = ui.backgroundImage || "./assets/sample-campus.jpg";
  const title = ui.title || "Avatar Gen Kiosk";
  const sub = ui.subtitle || "";

  const list = state.config.modules.map((m,i)=>`
    <div class="module">
      <h3>${i+1}. ${m.title} <span class="badge">${m.type}</span></h3>
      <p>${m.summary||""}</p>
    </div>
  `).join('');

  stage.innerHTML = `
    <div class="card">
      <div class="bg-img" style="background-image:url('${bg}')"></div>
      <h2 style="margin:0 0 8px 0; font-size:18px;">${title}</h2>
      <p class="small">${sub}</p>
      <hr/>
      <div class="module-list">${list}</div>
    </div>
  `;
  setButtons(false);
  setStatus('Ready');
}

function renderModule(idx){
  const m = state.config.modules[idx];
  state.currentModuleIdx = idx;
  const hasYT = !!m.youtubeId;
  const hasSynthesia = !!m.synthesiaUrl;
  const text = speakText(m);

  stage.innerHTML = `
    <div class="card">
      <div class="avatar-box">
        <div>
          <div style="text-align:center; font-size:12px; color:#9ca3af; margin-bottom:6px;">Avatar</div>
          <div style="width:120px;height:120px;border-radius:14px;background:#101826;border:1px dashed #2a3a55;margin:0 auto 8px auto;display:flex;align-items:center;justify-content:center">🎭</div>
          <div class="notice">Now speaking:</div>
          <div class="preview">${text || '<i>(empty)</i>'}</div>
        </div>
      </div>
      ${hasYT ? `<div class="video-box"><div id="yt"></div></div>`:""}
      ${hasSynthesia ? `<div class="video-box"><iframe id="synthesia" src="${m.synthesiaUrl}" allow="autoplay; fullscreen" title="Synthesia" loading="lazy"></iframe></div>`:""}
      <p class="notice">${m.note || ""}</p>
    </div>
  `;

  setButtons(true);
  setStatus('Speaking…');

  function afterSpeak(){
    setStatus('Idle');
    if (!hasYT && !hasSynthesia){ gotoNextModule(); }
  }

  AvatarBridge.start(text, afterSpeak);

  if (hasYT){
    ensureYouTubeAPI().then(()=>{
      state.ytPlayer = new YT.Player('yt', {
        videoId: m.youtubeId,
        playerVars:{playsinline:1, rel:0, modestbranding:1},
        events:{
          onStateChange: async (e)=>{
            if (e.data === 1){ await AvatarBridge.pause(); setStatus('Video playing…'); }
            if (e.data === 0){ await AvatarBridge.resume(); setStatus('Resumed'); gotoNextModule(); }
          }
        }
      });
    });
  }
  if (hasSynthesia){
    AvatarBridge.pause();
    setStatus('Synthesia playing…');
    const onEnd = ()=>{ document.removeEventListener('keydown', onEnd); AvatarBridge.resume().then(gotoNextModule); setStatus('Resumed'); };
    document.addEventListener('keydown', onEnd, { once:true });
  }
}

async function gotoNextModule(){
  const next = state.currentModuleIdx + 1;
  if (next < state.config.modules.length){ renderModule(next); }
  else { await AvatarBridge.stop(); renderWelcome(); }
}

function attachIdle(){
  state.idle?.stop?.();
  state.idle = createIdleTimer({
    onIdle(){ document.querySelector('#idle-modal').classList.add('show'); },
    onPromptTimeout: async ()=>{
      document.querySelector('#idle-modal').classList.remove('show');
      await AvatarBridge.stop(); renderWelcome();
    },
    IDLE_TIMEOUT_MS: 30_000,
    PROMPT_TIMEOUT_MS: 10_000
  });
  document.addEventListener('click', (e)=>{
    if (e.target && e.target.id==='idle-stay'){ document.querySelector('#idle-modal').classList.remove('show'); state.idle?.reset?.(); }
    if (e.target && e.target.id==='idle-end'){ document.querySelector('#idle-modal').classList.remove('show'); AvatarBridge.stop().then(renderWelcome); }
  });
}

// Hotkeys
document.addEventListener('keydown', (e)=>{
  const k = (e.key||'').toLowerCase();
  if(k==='t'){
    const text = prompt('Type a topic for the avatar to speak:');
    if(text){ AvatarBridge.stop().then(()=>{ setButtons(true); setStatus('Speaking…'); AvatarBridge.start(text); }); }
  }
  if(k==='s'){ AvatarBridge.stop().then(()=>{ setButtons(false); setStatus('Stopped'); }); }
});

let YT_READY = false;
function ensureYouTubeAPI(){
  return new Promise(resolve => {
    if (YT_READY || window.YT) return resolve();
    const s = document.createElement('script');
    s.src = "https://www.youtube.com/iframe_api";
    window.onYouTubeIframeAPIReady = () => { YT_READY = true; resolve(); };
    document.head.appendChild(s);
  });
}

(async function init(){
  try{
    const [config, links] = await Promise.all([
      loadJSON('./config/content.json'),
      loadJSON('./config/links.json')
    ]);
    state.config = config; state.links = links;
    document.querySelector('#links').innerHTML = state.links.items.map(l => `<a href="${l.href}" target="_blank" rel="noopener">${l.label}</a>`).join('');
    renderWelcome(); attachIdle();
    document.getElementById('btn-start').addEventListener('click', ()=>{ if (state.config?.modules?.length) renderModule(0); });
    document.getElementById('btn-pause').addEventListener('click', ()=>{ if (AvatarBridge.active) AvatarBridge.pause(); setStatus('Paused'); });
    document.getElementById('btn-stop').addEventListener('click', ()=>{ AvatarBridge.stop().then(()=>{ renderWelcome(); }); });
  }catch(err){
    document.querySelector('#stage').innerHTML = `<div class="card"><h3>Failed to load config</h3><p class="small">${err.message}</p></div>`;
    console.error(err);
  }
})();
