// ─────────────────────────────────────────────────────
// Text-to-speech engine: play, pause, resume, stop
// ─────────────────────────────────────────────────────

import { state } from './state.js';
import { renderPage, clearHL, drawHL, showTicker } from './pdf.js';

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
    state.pausePage = state.curPage;
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
  if (pg !== state.curPage) {
    renderPage(pg).then(() => {
      state.mode = 'speaking';
      updateBtn();
      ticker.style.display = 'block';
      speakAt(si);
    });
  } else {
    state.mode = 'speaking';
    updateBtn();
    ticker.style.display = 'block';
    speakAt(si);
  }
}

export function speakAt(si) {
  if (state.mode !== 'speaking') return;

  if (si >= state.sentences.length) {
    if (state.curPage < state.numPages) {
      renderPage(state.curPage + 1).then(() => {
        if (state.mode === 'speaking') speakAt(0);
      });
    } else {
      hardStop();
      toast('Finished reading 🎉');
    }
    return;
  }

  state.curSent = si;
  clearHL();
  drawHL(si);
  showTicker(state.sentences[si].text);
  savePos();

  const u  = new SpeechSynthesisUtterance(state.sentences[si].text);
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
  state.mode    = 'stopped';
  state.curSent = -1;
  clearHL();
  ticker.style.display = 'none';
  updateBtn();
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

// ─── Internal helpers ─────────────────────────────────
// Thin wrappers to avoid importing ui.js (which would create a cycle).
// toast and savePosition are injected by main.js at startup.
let _toast   = () => {};
let _savePos = () => {};
export function injectDeps(toastFn, savePosFn) { _toast = toastFn; _savePos = savePosFn; }
const toast   = msg => _toast(msg);
const savePos = ()  => _savePos();
