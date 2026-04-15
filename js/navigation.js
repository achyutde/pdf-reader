// ─────────────────────────────────────────────────────
// Page and sentence navigation
// ─────────────────────────────────────────────────────

import { state } from './state.js';
import { renderPage, clearHL, drawHL, showTicker,
         savePosition, getPageSentences }           from './pdf.js';
import { cancelTTS, speakAt, hardStop,
         updateBtn, startFrom }                     from './speech.js';
import { updateReturnBtn }                           from './ui.js';

// ─── Sentence navigation ──────────────────────────────
// moveSent always navigates the TTS position (not the display page).
export function moveSent(delta) {
  const wasPlaying  = state.mode === 'speaking';
  const ttsPageNow  = state.ttsPage ?? state.curPage;
  const sents       = (state.ttsPage && state.ttsPage !== state.curPage)
                        ? state.ttsSentences
                        : state.sentences;
  cancelTTS();

  let si = (state.curSent >= 0 ? state.curSent : 0) + delta;

  // ── Cross-page backward ──
  if (si < 0) {
    if (ttsPageNow > 1) {
      state.mode = wasPlaying ? 'speaking' : 'paused';
      updateBtn();
      getPageSentences(ttsPageNow - 1).then(sentences => {
        si = sentences.length - 1;
        state.ttsPage      = ttsPageNow - 1;
        state.ttsSentences = sentences;
        state.curSent      = si;
        state.pausePage    = state.ttsPage;
        state.pauseSent    = si;
        updateReturnBtn();
        const text = sentences[si]?.text || '';
        if (state.ttsPage === state.curPage) {
          state.ttsPage = null; state.ttsSentences = [];
          clearHL(); drawHL(si); showTicker(state.sentences[si]?.text || text);
          updateReturnBtn();
        } else {
          showTicker(text);
        }
        savePosition();
        if (wasPlaying) speakAt(si); else updateBtn();
      });
      return;
    }
    si = 0;
  }

  // ── Cross-page forward ──
  else if (si >= sents.length) {
    const nextTTSPage = ttsPageNow + 1;
    if (nextTTSPage <= state.numPages) {
      state.mode = wasPlaying ? 'speaking' : 'paused';
      updateBtn();
      getPageSentences(nextTTSPage).then(sentences => {
        state.ttsPage      = nextTTSPage;
        state.ttsSentences = sentences;
        state.curSent      = 0;
        state.pausePage    = state.ttsPage;
        state.pauseSent    = 0;
        updateReturnBtn();
        const text = sentences[0]?.text || '';
        if (state.ttsPage === state.curPage) {
          state.ttsPage = null; state.ttsSentences = [];
          clearHL(); drawHL(0); showTicker(state.sentences[0]?.text || text);
          updateReturnBtn();
        } else {
          showTicker(text);
        }
        savePosition();
        if (wasPlaying) speakAt(0); else updateBtn();
      });
      return;
    }
    si = sents.length - 1;
  }

  // ── Same page ──
  state.curSent   = si;
  state.pausePage = ttsPageNow;
  state.pauseSent = si;
  state.mode      = wasPlaying ? 'speaking' : 'paused';

  if (!state.ttsPage || state.ttsPage === state.curPage) {
    clearHL(); drawHL(si); showTicker(state.sentences[si].text);
  } else {
    showTicker(sents[si].text);
  }

  savePosition(); updateBtn();
  if (wasPlaying) speakAt(si);
}

// ─── Page navigation ──────────────────────────────────
export async function changePage(delta) {
  const next = state.curPage + delta;
  if (next < 1 || next > state.numPages) return;

  if (state.mode !== 'stopped') {
    // TTS is playing or paused — keep it running, only change the display.

    // If TTS is currently on the display page, snapshot its sentences
    // before renderPage() overwrites state.sentences.
    if (!state.ttsPage || state.ttsPage === state.curPage) {
      state.ttsPage      = state.curPage;       // pin TTS to current page
      state.ttsSentences = [...state.sentences]; // shallow copy
    }

    await renderPage(next); // renders new display page, updates state.curPage

    // If display just caught up to where TTS is, re-sync.
    if (next === state.ttsPage) {
      state.ttsPage      = null;
      state.ttsSentences = [];
      // Re-draw highlight for current TTS sentence.
      if (state.curSent >= 0) { clearHL(); drawHL(state.curSent); }
    }

    updateReturnBtn();

  } else {
    // Stopped — old behavior: navigate display and position cursor.
    await renderPage(next);
    state.ttsPage      = null;
    state.ttsSentences = [];
    state.curSent      = 0;
    state.pausePage    = next;
    state.pauseSent    = 0;
    state.mode         = 'paused';
    clearHL(); drawHL(0); showTicker(state.sentences[0]?.text || '');
    savePosition(); updateBtn(); updateReturnBtn();
  }
}

export function jumpTo() {
  let n = parseInt(document.getElementById('pg-input').value);
  if (isNaN(n)) return;
  n = Math.max(1, Math.min(n, state.numPages));
  if (n === state.curPage) return;
  changePage(n - state.curPage);
}
