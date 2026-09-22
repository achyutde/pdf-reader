// ─────────────────────────────────────────────────────
// Text-to-speech engine: play, pause, resume, stop
// ─────────────────────────────────────────────────────

import { state } from './state.js?v=2.3.9';
import { renderPage, clearHL, drawHL, showTicker, getPageSentences } from './pdf.js?v=2.3.9';

const playb   = document.getElementById('playb');
const fabPlay = document.getElementById('fab-play');
const ticker  = document.getElementById('ticker');
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
    startFrom(state.pausePage || state.curPage,
      Math.max(0, state.pauseSent ?? state.curSent),
      Math.max(0, state.pauseWord ?? state.curWord));
  }
}

export function startFrom(pg, si, wi = 0) {
  state.readingFinished = false;
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

function setCurrentWord(si, wi, highlightCount = 3) {
  const sents = ttsSents();
  const max = Math.max(0, (sents[si]?.words?.length || 1) - 1);
  state.curWord = Math.max(0, Math.min(wi, max));
  state.pauseWord = state.curWord;
  if (!state.ttsPage || state.ttsPage === state.curPage) drawHL(si, state.curWord, highlightCount);
  savePos();
}

export function speakAt(si, wi = 0) {
  if (state.mode !== 'speaking') return;
  const runId = ++speechRunId;
  const sents = ttsSents();
  const ttsPageNow = state.ttsPage ?? state.curPage;

  if (si >= sents.length) {
    const nextPage = ttsPageNow + 1;
    if (nextPage > state.numPages) {
      state.readingFinished = true;
      hardStop();
      savePos();
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
  if (!words.length) {
    speakAt(si + 1, 0);
    return;
  }

  const startWord = Math.max(0, Math.min(wi, words.length - 1));
  const spokenText = sentence.text.slice(words[startWord].start);

  state.curSent = si;
  state.pausePage = ttsPageNow;
  state.pauseSent = si;
  setCurrentWord(si, startWord, words.length - startWord);
  showTicker(spokenText);

  // The highlighted clause is exactly the text in this utterance, so speech
  // and highlighting remain synchronized without word-boundary tracking.
  const u = new SpeechSynthesisUtterance(spokenText);
  u.rate = state.rate;
  u.pitch = 1;
  if (state.voice) u.voice = state.voice;
  u.onend = () => {
    if (runId !== speechRunId || state.mode !== 'speaking') return;
    speakAt(si + 1, 0);
  };
  u.onerror = err => {
    if (runId !== speechRunId || state.mode !== 'speaking' || err.error === 'interrupted') return;
    speakAt(si + 1, 0);
  };
  speechSynthesis.speak(u);
}

export function cancelTTS() {
  speechRunId += 1;
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

export function stopReading() {
  if (!state.pdf) return;
  state.pausePage = state.ttsPage ?? state.curPage;
  state.pauseSent = Math.max(0, state.curSent);
  state.pauseWord = Math.max(0, state.curWord);
  cancelTTS();
  state.mode = 'stopped';
  state.ttsPage = null;
  state.ttsSentences = [];
  clearHL();
  ticker.style.display = 'none';
  updateBtn();
  updateReturn();
  savePos();
  toast('Stopped — tap ▶ to continue');
}

export function updateBtn() {
  if (state.mode === 'speaking') {
    playb.textContent = '⏸';
    playb.className = 'cb play-toggle playing';
    playb.setAttribute('aria-label', 'Pause reading');
    playb.title = 'Pause reading';
    fabPlay.textContent = '⏸';
    fabPlay.style.background = 'rgba(192,57,43,0.88)';
  } else if (state.mode === 'paused') {
    playb.textContent = '▶';
    playb.className = 'cb play-toggle paused';
    playb.setAttribute('aria-label', 'Resume reading');
    playb.title = 'Resume reading';
    fabPlay.textContent = '▶';
    fabPlay.style.background = 'rgba(83,52,131,0.88)';
  } else {
    playb.textContent = '▶';
    playb.className = 'cb play-toggle';
    playb.setAttribute('aria-label', 'Start reading');
    playb.title = 'Start reading';
    fabPlay.textContent = '▶';
    fabPlay.style.background = 'rgba(233,69,96,0.88)';
  }
  playb.disabled = false;
}

export function setSpeed(v) {
  const rate = Number.parseFloat(v);
  if (!Number.isFinite(rate) || rate < 0.5 || rate > 4) return false;

  state.rate = rate;
  localStorage.setItem('reader:speed', String(rate));

  const speedSelect = document.getElementById('speed-select');
  if (speedSelect) speedSelect.value = String(rate);
  if (state.mode === 'speaking') {
    const si = state.curSent;
    const wi = state.curWord;
    cancelTTS();
    state.mode = 'speaking';
    speakAt(si, wi);
  } else {
    savePos();
  }
  return true;
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
