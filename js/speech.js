// ─────────────────────────────────────────────────────
// Text-to-speech engine: play, pause, resume, stop
// ─────────────────────────────────────────────────────

import { state } from './state.js';
import { renderPage, clearHL, drawHL, showTicker, getPageSentences } from './pdf.js';

const playb    = document.getElementById('playb');
const fabPlay  = document.getElementById('fab-play');
const ticker   = document.getElementById('ticker');

// ─── Voices ───────────────────────────────────────────
export function refreshVoices() {
  const vs  = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
  const sel = document.getElementById('voice-sel');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Default Voice</option>';
  vs.forEach((v, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = v.name;
    sel.appendChild(o);
  });
  if (cur) sel.value = cur;
}

export function setVoice(i) {
  const vs = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
  state.voice = i !== '' ? vs[parseInt(i)] : null;
}

// ─── Playback control ─────────────────────────────────
export function togglePlay() {
  if (state.mode === 'speaking') {
    state.pausePage = state.ttsPage ?? state.curPage;  // save TTS page, not display page
    state.pauseSent = state.curSent;
    state.mode      = 'paused';
    cancelTTS();
    updateBtn();
    savePos();
    toast('Paused — tap ▶ to resume');

  } else if (state.mode === 'paused') {
    startFrom(state.pausePage, state.pauseSent);

  } else {
    startFrom(state.curPage, Math.max(0, state.curSent));
  }
}

export function startFrom(pg, si) {
  // Reset dual-page tracking: TTS will start on pg.
  state.ttsPage      = null;
  state.ttsSentences = [];
  updateReturn();

  if (pg !== state.curPage) {
    // TTS will read a page different from what's displayed.
    // Fetch sentences in background without rendering canvas.
    getPageSentences(pg).then(sentences => {
      state.ttsPage      = pg;
      state.ttsSentences = sentences;
      state.pausePage    = pg;
      state.mode         = 'speaking';
      updateBtn();
      ticker.style.display = 'block';
      updateReturn();
      speakAt(si);
    });
  } else {
    state.mode = 'speaking';
    updateBtn();
    ticker.style.display = 'block';
    speakAt(si);
  }
}

// Returns the active sentence array for TTS (may differ from display sentences).
function ttsSents() {
  return (state.ttsPage && state.ttsPage !== state.curPage)
    ? state.ttsSentences
    : state.sentences;
}

export function speakAt(si) {
  if (state.mode !== 'speaking') return;
  const sents    = ttsSents();
  const ttsPageNow = state.ttsPage ?? state.curPage;

  if (si >= sents.length) {
    const nextPage = ttsPageNow + 1;

    if (nextPage > state.numPages) {
      hardStop();
      toast('Finished reading 🎉');
      return;
    }

    // If the next TTS page is what the user is already viewing, re-sync.
    if (nextPage === state.curPage) {
      state.ttsPage      = null;
      state.ttsSentences = [];
      updateReturn();
      if (state.mode === 'speaking') speakAt(0);
      return;
    }

    // Background page advance: fetch text only, no canvas render.
    getPageSentences(nextPage).then(sentences => {
      if (state.mode !== 'speaking') return;
      state.ttsPage      = nextPage;
      state.ttsSentences = sentences;
      updateReturn();
      speakAt(0);
    });
    return;
  }

  state.curSent    = si;
  state.pausePage  = ttsPageNow;
  state.pauseSent  = si;

  // Only highlight when TTS is on the displayed page.
  if (!state.ttsPage || state.ttsPage === state.curPage) {
    clearHL(); drawHL(si);
  }
  showTicker(sents[si].text);
  savePos();

  const u  = new SpeechSynthesisUtterance(sents[si].text);
  u.rate   = state.rate;
  u.pitch  = 1;
  if (state.voice) u.voice = state.voice;
  u.onend  = () => { if (state.mode === 'speaking') speakAt(si + 1); };
  u.onerror = err => {
    if (err.error !== 'interrupted' && state.mode === 'speaking') speakAt(si + 1);
  };
  speechSynthesis.speak(u);
}

export function cancelTTS() { speechSynthesis.cancel(); }

export function hardStop() {
  cancelTTS();
  state.mode         = 'stopped';
  state.curSent      = -1;
  state.ttsPage      = null;   // re-sync: TTS = display page
  state.ttsSentences = [];
  clearHL();
  ticker.style.display = 'none';
  updateBtn();
  updateReturn();
}

export function updateBtn() {
  if (state.mode === 'speaking') {
    playb.textContent           = '⏸ Pause';
    playb.className             = 'cb playing';
    fabPlay.textContent         = '⏸';
    fabPlay.style.background    = 'rgba(192,57,43,0.88)';
  } else if (state.mode === 'paused') {
    playb.textContent           = '▶ Resume';
    playb.className             = 'cb paused';
    fabPlay.textContent         = '▶';
    fabPlay.style.background    = 'rgba(83,52,131,0.88)';
  } else {
    playb.textContent           = '▶ Read';
    playb.className             = 'cb';
    fabPlay.textContent         = '▶';
    fabPlay.style.background    = 'rgba(233,69,96,0.88)';
  }
  playb.disabled = false;
}

export function setSpeed(v) {
  state.rate = parseFloat(v);
  document.getElementById('speed-val').textContent = state.rate.toFixed(1) + '×';
  if (state.mode === 'speaking') {
    const si = state.curSent;
    cancelTTS();
    state.mode = 'speaking';
    speakAt(si);
  }
}

// ─── Injected deps (avoids circular import with ui.js) ────────────────────────
let _toast        = () => {};
let _savePos      = () => {};
let _updateReturn = () => {};
export function injectDeps(toastFn, savePosFn, updateReturnFn) {
  _toast        = toastFn;
  _savePos      = savePosFn;
  _updateReturn = updateReturnFn;
}
const toast        = msg => _toast(msg);
const savePos      = ()  => _savePos();
const updateReturn = ()  => _updateReturn();
