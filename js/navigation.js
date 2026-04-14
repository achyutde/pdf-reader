// ─────────────────────────────────────────────────────
// Page and sentence navigation
// ─────────────────────────────────────────────────────

import { state } from './state.js';
import { renderPage, clearHL, drawHL, showTicker, savePosition } from './pdf.js';
import { cancelTTS, speakAt, hardStop, updateBtn, startFrom } from './speech.js';

// ─── Sentence navigation ──────────────────────────────
export function moveSent(delta) {
  const wasPlaying = state.mode === 'speaking';
  cancelTTS();

  let si = (state.curSent >= 0 ? state.curSent : 0) + delta;

  if (si < 0) {
    if (state.curPage > 1) {
      state.mode = wasPlaying ? 'speaking' : 'paused';
      updateBtn();
      renderPage(state.curPage - 1).then(() => {
        si = state.sentences.length - 1;
        state.curSent = si;
        state.pausePage = state.curPage; state.pauseSent = si;
        clearHL(); drawHL(si); showTicker(state.sentences[si].text);
        savePosition();
        if (wasPlaying) speakAt(si); else updateBtn();
      });
      return;
    }
    si = 0;
  } else if (si >= state.sentences.length) {
    if (state.curPage < state.numPages) {
      state.mode = wasPlaying ? 'speaking' : 'paused';
      updateBtn();
      renderPage(state.curPage + 1).then(() => {
        state.curSent = 0;
        state.pausePage = state.curPage; state.pauseSent = 0;
        clearHL(); drawHL(0); showTicker(state.sentences[0].text);
        savePosition();
        if (wasPlaying) speakAt(0); else updateBtn();
      });
      return;
    }
    si = state.sentences.length - 1;
  }

  state.curSent   = si;
  state.pausePage = state.curPage;
  state.pauseSent = si;
  state.mode      = wasPlaying ? 'speaking' : 'paused';

  clearHL(); drawHL(si); showTicker(state.sentences[si].text);
  savePosition(); updateBtn();

  if (wasPlaying) speakAt(si);
}

// ─── Page navigation ──────────────────────────────────
export async function changePage(delta) {
  const next = state.curPage + delta;
  if (next < 1 || next > state.numPages) return;
  const wasPlaying = state.mode === 'speaking';
  hardStop();
  await renderPage(next);
  state.curSent   = 0;
  state.pausePage = next;
  state.pauseSent = 0;
  state.mode      = 'paused';
  clearHL(); drawHL(0); showTicker(state.sentences[0]?.text || '');
  savePosition(); updateBtn();
  if (wasPlaying) startFrom(next, 0);
}

export function jumpTo() {
  let n = parseInt(document.getElementById('pg-input').value);
  if (isNaN(n)) return;
  n = Math.max(1, Math.min(n, state.numPages));
  if (n === state.curPage) return;
  changePage(n - state.curPage);
}
