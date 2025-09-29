export function createIdleTimer({onIdle,onPromptTimeout,IDLE_TIMEOUT_MS=30000,PROMPT_TIMEOUT_MS=10000}={}){
  let idleTimer=null,promptTimer=null;
  const reset=()=>{ clearTimeout(idleTimer); idleTimer=setTimeout(()=>{ onIdle&&onIdle(); clearTimeout(promptTimer); promptTimer=setTimeout(()=>onPromptTimeout&&onPromptTimeout(),PROMPT_TIMEOUT_MS); }, IDLE_TIMEOUT_MS); };
  const events=["mousemove","keydown","touchstart","click"]; const handler=()=>reset();
  events.forEach(e=>window.addEventListener(e,handler,{passive:true})); reset();
  return { reset, stop(){ events.forEach(e=>window.removeEventListener(e,handler)); clearTimeout(idleTimer); clearTimeout(promptTimer);} };
}
