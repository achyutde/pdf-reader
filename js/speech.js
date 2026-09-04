// ─────────────────────────────────────────────────────
// Text-to-speech engine: play, pause, resume, stop
// ─────────────────────────────────────────────────────

import { state } from './state.js?v=2.0.1';
import { renderPage, clearHL, drawHL, showTicker, getPageSentences } from './pdf.js?v=2.0.1';

const playb   = document.getElementById('playb');
const fabPlay = document.getElementById('fab-play');
const ticker  = document.getElementById('ticker');
let boundaryFallback = null;
let speechRunId = 0;

export function refreshVoices() {
  const vs = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
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

export function togglePlay() {
  if (state.mode === 'speaking') {
    state.pausePage = state.ttsPage ?? state.curPage;
    state.pauseSent = state.curSent;
    state.pauseWord = state.curWord;
    state.mode = 'paused';
    cancelTTS();
    updateBtn();
    savePos();
    toast('Paused — tap ▶ to resume');
  } else if (state.mode === 'paused') {
    startFrom(state.pausePage, state.pauseSent, state.pauseWord);
  } else {
    startFrom(state.curPage, Math.max(0, state.curSent), Math.max(0, state.curWord));
  }
}

export function startFrom(pg, si, wi = 0) {
  state.ttsPage = null;
  state.ttsSentences = [];
  updateReturn();

  if (pg !== state.curPage) {
    getPageSentences(pg).then(sentences => {
      state.ttsPage = pg;
      state.ttsSentences = sentences;
      state.pausePage = pg;
      state.pauseSent = si;
      state.pauseWord = wi;
      state.mode = 'speaking';
      updateBtn();
      ticker.style.display = 'block';
      updateReturn();
      speakAt(si, wi);
    });
  } else {
    state.mode = 'speaking';
    updateBtn();
    ticker.style.display = 'block';
    speakAt(si, wi);
  }
}

function ttsSents() {
  return (state.ttsPage && state.ttsPage !== state.curPage)
    ? state.ttsSentences
    : state.sentences;
}

function setCurrentWord(si, wi) {
  const sents = ttsSents();
  const max = Math.max(0, (sents[si]?.words?.length || 1) - 1);
  state.curWord = Math.max(0, Math.min(wi, max));
  state.pauseWord = state.curWord;
  if (!state.ttsPage || state.ttsPage === state.curPage) drawHL(si, state.curWord);
  savePos();
}

function wordAtCharacter(words, charIndex) {
  let found = 0;
  for (let i = 0; i < words.length; i++) {
    if (words[i].start <= charIndex) found = i;
    if (words[i].end > charIndex) break;
  }
  return found;
}

function startBoundaryFallback(si, startWord) {
  clearInterval(boundaryFallback);
  const wordsPerMinute = 180 * state.rate;
  const msPerWord = Math.max(140, 60000 / wordsPerMinute);
  let wi = startWord;
  boundaryFallback = setInterval(() => {
    if (state.mode !== 'speaking' || state.curSent !== si) {
      clearInterval(boundaryFallback);
      return;
    }
    wi += 1;
    const words = ttsSents()[si]?.words || [];
    if (wi < words.length) setCurrentWord(si, wi);
    else clearInterval(boundaryFallback);
  }, msPerWord);
}

export function speakAt(si, wi = 0) {
  if (state.mode !== 'speaking') return;
  const runId = ++speechRunId;
  const sents = ttsSents();
  const ttsPageNow = state.ttsPage ?? state.curPage;

  if (si >= sents.length) {
    const nextPage = ttsPageNow + 1;
    if (nextPage > state.numPages) {
      hardStop();
      toast('Finished reading 🎉');
      return;
    }
    if (!state.ttsPage) {
      renderPage(nextPage).then(() => {
        if (state.mode === 'speaking') speakAt(0, 0);
      });
      return;
    }
    if (nextPage === state.curPage) {
      state.ttsPage = null;
      state.ttsSentences = [];
      updateReturn();
      if (state.mode === 'speaking') speakAt(0, 0);
      return;
    }
    getPageSentences(nextPage).then(sentences => {
      if (state.mode !== 'speaking') return;
      state.ttsPage = nextPage;
      state.ttsSentences = sentences;
      updateReturn();
      speakAt(0, 0);
    });
    return;
  }

  const sentence = sents[si];
  const words = sentence.words || [];
  const startWord = Math.max(0, Math.min(wi, Math.max(0, words.length - 1)));
  const startChar = words[startWord]?.start || 0;
  const spokenText = sentence.text.slice(startChar);

  state.curSent = si;
  state.pausePage = ttsPageNow;
  state.pauseSent = si;
  setCurrentWord(si, startWord);
  showTicker(spokenText);

  const u = new SpeechSynthesisUtterance(spokenText);
  u.rate = state.rate;
  u.pitch = 1;
  if (state.voice) u.voice = state.voice;

  let gotBoundary = false;
  const fallbackDelay = setTimeout(() => {
    if (runId === speechRunId && !gotBoundary && state.mode === 'speaking' && state.curSent === si) {
      startBoundaryFallback(si, startWord);
    }
  }, 900);

  u.onboundary = event => {
    if (runId !== speechRunId) return;
    if (event.name && event.name !== 'word') return;
    gotBoundary = true;
    clearInterval(boundaryFallback);
    const fullCharIndex = startChar + event.charIndex;
    setCurrentWord(si, wordAtCharacter(words, fullCharIndex));
  };
  u.onend = () => {
    clearTimeout(fallbackDelay);
    clearInterval(boundaryFallback);
    if (runId === speechRunId && state.mode === 'speaking') speakAt(si + 1, 0);
  };
  u.onerror = err => {
    clearTimeout(fallbackDelay);
    clearInterval(boundaryFallback);
    if (runId === speechRunId && err.error !== 'interrupted' && state.mode === 'speaking') speakAt(si + 1, 0);
  };
  speechSynthesis.speak(u);
}

export function cancelTTS() {
  speechRunId += 1;
  clearInterval(boundaryFallback);
  boundaryFallback = null;
  speechSynthesis.cancel();
}

export function hardStop() {
  cancelTTS();
  state.mode = 'stopped';
  state.curSent = -1;
  state.curWord = 0;
  state.pauseWord = 0;
  state.ttsPage = null;
  state.ttsSentences = [];
  clearHL();
  ticker.style.display = 'none';
  updateBtn();
  updateReturn();
}

export function updateBtn() {
  if (state.mode === 'speaking') {
    playb.textContent = '⏸ Pause';
    playb.className = 'cb playing';
    fabPlay.textContent = '⏸';
    fabPlay.style.background = 'rgba(192,57,43,0.88)';
  } else if (state.mode === 'paused') {
    playb.textContent = '▶ Resume';
    playb.className = 'cb paused';
    fabPlay.textContent = '▶';
    fabPlay.style.background = 'rgba(83,52,131,0.88)';
  } else {
    playb.textContent = '▶ Read';
    playb.className = 'cb';
    fabPlay.textContent = '▶';
    fabPlay.style.background = 'rgba(233,69,96,0.88)';
  }
  playb.disabled = false;
}

export function setSpeed(v) {
  state.rate = parseFloat(v);
  document.getElementById('speed-val').textContent = state.rate.toFixed(1) + '×';
  if (state.mode === 'speaking') {
    const si = state.curSent;
    const wi = state.curWord;
    cancelTTS();
    state.mode = 'speaking';
    speakAt(si, wi);
  }
}

let _toast = () => {};
let _savePos = () => {};
let _updateReturn = () => {};
export function injectDeps(toastFn, savePosFn, updateReturnFn) {
  _toast = toastFn;
  _savePos = savePosFn;
  _updateReturn = updateReturnFn;
}
const toast = msg => _toast(msg);
const savePos = () => _savePos();
const updateReturn = () => _updateReturn();
