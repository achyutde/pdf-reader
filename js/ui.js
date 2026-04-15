// ─────────────────────────────────────────────────────
// UI: focus mode, view toggle, toast, resume banner,
//     swipe gesture, edge page-nav buttons
// ─────────────────────────────────────────────────────

import { state } from './state.js';
import { renderPage, clearHL, drawHL, showTicker, savePosition } from './pdf.js';
import { hardStop, updateBtn, startFrom } from './speech.js';

// ─── Toast ────────────────────────────────────────────
let _toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// ─── Focus mode ───────────────────────────────────────
export function enterReading() {
  document.body.classList.add('reading');
  if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
  toast('Tap ⊟ to exit focus mode');
}

export function exitReading() {
  document.body.classList.remove('reading');
  if (document.exitFullscreen && document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}

// ─── View toggle (Fit Page ↔ Fit Width) ──────────────
export function toggleView() {
  state.fitWidth = !state.fitWidth;
  const btn = document.getElementById('view-btn');
  if (state.fitWidth) {
    document.body.classList.add('fit-width');
    btn.textContent = '⛶ Fit Page';
  } else {
    document.body.classList.remove('fit-width');
    btn.textContent = '↔ Fit Width';
  }
  if (state.curSent >= 0 && state.sentRects[state.curSent]) {
    requestAnimationFrame(() => drawHL(state.curSent));
  }
}

// ─── Return-to-reading button ─────────────────────────
export function updateReturnBtn() {
  const btn = document.getElementById('return-btn');
  if (!btn) return;
  const ttsPage = state.ttsPage;
  if (ttsPage && ttsPage !== state.curPage && state.mode !== 'stopped') {
    btn.textContent = `↩ p.${ttsPage}`;
    btn.classList.add('on');
  } else {
    btn.classList.remove('on');
  }
}

// ─── Resume banner ────────────────────────────────────
export async function doResume() {
  if (!state.pendingResume) return;
  const { page, sent } = state.pendingResume;
  state.pendingResume = null;
  dismissResume();

  // Reset TTS sync state before rendering
  state.ttsPage      = null;
  state.ttsSentences = [];

  await renderPage(page);
  state.curSent   = sent;
  state.pausePage = page;
  state.pauseSent = sent;
  state.mode      = 'paused';

  if (sent >= 0 && sent < state.sentences.length) {
    clearHL(); drawHL(sent); showTicker(state.sentences[sent].text);
  }
  updateBtn();
  updateReturnBtn();
  savePosition();
  toast(`Resumed at page ${page} ✓`);
}

export function dismissResume() {
  state.pendingResume = null;
  document.getElementById('resume-bar').classList.remove('on');
}

// ─── Swipe gesture (focus mode only) ─────────────────
export function setupSwipe(onPrev, onNext) {
  const content = document.getElementById('content');
  let startX = 0, startY = 0;

  content.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  content.addEventListener('touchend', e => {
    if (!document.body.classList.contains('reading')) return;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    // Require a clearly horizontal swipe (dx dominant, > 60px)
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.8) {
      if (dx < 0) onNext(); else onPrev();
    }
  }, { passive: true });
}
