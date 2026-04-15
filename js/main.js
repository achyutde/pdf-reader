// ─────────────────────────────────────────────────────
// Entry point: app init and all event wiring
// ─────────────────────────────────────────────────────

import { state }                                          from './state.js';
import { renderPage, enableControls, savePosition,
         checkSavedPosition, clearHL, drawHL,
         showTicker }                                     from './pdf.js';
import { refreshVoices, setVoice, togglePlay, cancelTTS,
         hardStop, updateBtn, setSpeed, injectDeps,
         startFrom, speakAt }                             from './speech.js';
import { moveSent, changePage, jumpTo }                   from './navigation.js';
import { addBM, openBM, closeBM,
         exportBMs, importBMs }                           from './bookmarks.js';
import { enterReading, exitReading, toggleView, toast,
         doResume, dismissResume, setupSwipe,
         updateReturnBtn }                                from './ui.js';

// ─── PDF.js worker ────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Inject toast, savePosition, updateReturnBtn into speech.js (avoids circular import)
injectDeps(toast, savePosition, updateReturnBtn);

// ─── App init ─────────────────────────────────────────
async function initPDF(data) {
  hardStop();
  dismissResume();

  state.pdf          = await pdfjsLib.getDocument({ data }).promise;
  state.numPages     = state.pdf.numPages;
  state.curPage      = 1;
  state.curSent      = 0;
  state.pausePage    = 1;
  state.pauseSent    = 0;
  state.ttsPage      = null;
  state.ttsSentences = [];

  document.getElementById('drop-zone').style.display  = 'none';
  document.getElementById('canvas-wrap').classList.add('on');
  document.getElementById('page-jump').classList.add('on');
  document.getElementById('page-total').textContent   = `/ ${state.numPages}`;
  document.getElementById('bm-btn').disabled           = false;
  document.getElementById('focus-btn').disabled        = false;
  enableControls();

  await renderPage(1);
  checkSavedPosition();
}

// ─── Tap-to-position popup ────────────────────────────
let _tapSnap         = null;  // pre-tap snapshot for dismiss restoration
let _tapDismissTimer = null;

function onTap(e) {
  if (!state.sentences.length) return;
  const hlCanvas = document.getElementById('hl-canvas');
  const r  = hlCanvas.getBoundingClientRect();
  const sx = hlCanvas.width  / r.width;
  const sy = hlCanvas.height / r.height;
  const cx = (e.clientX - r.left) * sx;
  const cy = (e.clientY - r.top)  * sy;

  let found = -1;
  for (let i = 0; i < state.sentRects.length; i++) {
    const rc = state.sentRects[i];
    if (!rc) continue;
    if (cx >= rc.x - 8 && cx <= rc.x + rc.w + 8 &&
        cy >= rc.y - 8 && cy <= rc.y + rc.h + 8) { found = i; break; }
  }

  // Tap outside a sentence — just dismiss any open popup
  if (found < 0) { dismissTapMenu(); return; }

  // Dismiss any existing popup silently before showing a new one
  dismissTapMenuDOM();
  if (_tapSnap) { _tapSnap = null; clearTimeout(_tapDismissTimer); }

  // Snapshot state so we can restore on cancel
  _tapSnap = {
    curSent:      state.curSent,
    mode:         state.mode,
    pausePage:    state.pausePage,
    pauseSent:    state.pauseSent,
    ttsPage:      state.ttsPage,
    ttsSentences: state.ttsSentences,
    wasPlaying:   state.mode === 'speaking',
  };

  // Temporarily pause TTS (keep position, don't destroy state)
  if (_tapSnap.wasPlaying) cancelTTS();

  // Preview: highlight tapped sentence
  clearHL(); drawHL(found);
  showTicker(state.sentences[found].text);

  // Populate and position popup
  document.getElementById('tap-preview').textContent =
    state.sentences[found].text.slice(0, 120);
  showTapMenu(found, e.clientX, e.clientY);

  // Wire confirm button (re-wire each tap to capture current `found`)
  document.getElementById('tap-read').onclick = () => {
    clearTimeout(_tapDismissTimer);
    _tapSnap = null;
    dismissTapMenuDOM();

    state.curSent   = found;
    state.pausePage = state.curPage;
    state.pauseSent = found;
    state.mode      = 'paused';
    clearHL(); drawHL(found); showTicker(state.sentences[found].text);
    updateBtn(); savePosition();
    // Always start reading from tapped sentence
    startFrom(state.curPage, found);
  };

  // Auto-dismiss after 4 s
  _tapDismissTimer = setTimeout(() => dismissTapMenu(), 4000);
}

function showTapMenu(si, clientX, clientY) {
  const menu    = document.getElementById('tap-menu');
  const POPUP_W = 280;
  const POPUP_H = 96;
  const MARGIN  = 10;
  const ARROW_H = 6;

  let top  = clientY - POPUP_H - ARROW_H - MARGIN;
  let left = clientX - 20;

  // Clamp horizontally
  left = Math.max(MARGIN, Math.min(left, window.innerWidth - POPUP_W - MARGIN));

  // Flip below tap if too close to top
  const flipBelow = top < MARGIN;
  if (flipBelow) {
    top = clientY + ARROW_H + MARGIN;
    menu.classList.add('arrow-below');
  } else {
    menu.classList.remove('arrow-below');
  }

  top = Math.min(top, window.innerHeight - POPUP_H - MARGIN);

  // Move CSS arrow to point at tap x
  const arrowLeft = Math.max(10, Math.min(clientX - left - 5, POPUP_W - 20));
  menu.style.setProperty('--arrow-left', arrowLeft + 'px');
  menu.style.top  = top  + 'px';
  menu.style.left = left + 'px';
  menu.classList.add('on');
}

function dismissTapMenuDOM() {
  document.getElementById('tap-menu').classList.remove('on');
}

function dismissTapMenu() {
  clearTimeout(_tapDismissTimer);
  dismissTapMenuDOM();
  if (!_tapSnap) return;

  const snap = _tapSnap;
  _tapSnap = null;

  // Restore visual state
  if (snap.curSent >= 0 && state.sentRects[snap.curSent]) {
    clearHL(); drawHL(snap.curSent);
    showTicker(state.sentences[snap.curSent]?.text || '');
  } else {
    clearHL();
  }

  // Restore TTS if it was playing before the tap
  if (snap.wasPlaying) {
    state.mode         = 'speaking';
    state.ttsPage      = snap.ttsPage;
    state.ttsSentences = snap.ttsSentences;
    state.curSent      = snap.curSent;
    state.pausePage    = snap.pausePage;
    state.pauseSent    = snap.pauseSent;
    const resumeSent   = snap.curSent >= 0 ? snap.curSent : snap.pauseSent;
    if (snap.ttsPage && snap.ttsPage !== state.curPage) {
      startFrom(snap.ttsPage, resumeSent);
    } else {
      speakAt(resumeSent);
    }
    updateBtn();
  } else {
    state.curSent   = snap.curSent;
    state.pausePage = snap.pausePage;
    state.pauseSent = snap.pauseSent;
    state.mode      = snap.mode;
    updateBtn();
  }
}

// ─── Event wiring ─────────────────────────────────────
// File input
const fileInput = document.getElementById('file-input');
document.querySelector('.top-btn:not(.sec)').addEventListener('click',
  () => fileInput.click());
fileInput.addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  state.fileName = f.name;
  const reader = new FileReader();
  reader.onload = ev => initPDF(ev.target.result);
  reader.readAsArrayBuffer(f);
  e.target.value = '';
});

// Top bar
document.getElementById('bm-btn').addEventListener('click', openBM);
document.getElementById('saveb').addEventListener('click', addBM);
document.getElementById('view-btn').addEventListener('click', toggleView);
document.getElementById('focus-btn').addEventListener('click', enterReading);

// Page jump
document.getElementById('pg-input').addEventListener('keydown',
  e => { if (e.key === 'Enter') jumpTo(); });
document.getElementById('pg-input').addEventListener('input',
  function() { this.value = this.value.replace(/[^0-9]/g, ''); });
document.querySelector('#page-jump .top-btn').addEventListener('click', jumpTo);

// Resume banner
document.getElementById('rb-yes').addEventListener('click', doResume);
document.getElementById('rb-no').addEventListener('click', dismissResume);

// FABs
document.getElementById('fab').addEventListener('click', exitReading);
document.getElementById('fab-play').addEventListener('click', togglePlay);

// Return-to-reading button
document.getElementById('return-btn').addEventListener('click', async () => {
  if (!state.ttsPage) return;
  const ttsPage = state.ttsPage;
  await renderPage(ttsPage);
  state.ttsPage      = null;
  state.ttsSentences = [];
  if (state.mode !== 'stopped' && state.curSent >= 0) {
    clearHL(); drawHL(state.curSent);
  }
  updateReturnBtn();
});

// Edge page nav
document.getElementById('edge-prev').addEventListener('click', () => changePage(-1));
document.getElementById('edge-next').addEventListener('click', () => changePage(1));

// Controls
document.getElementById('prev-pg').addEventListener('click',   () => changePage(-1));
document.getElementById('prev-sent').addEventListener('click', () => moveSent(-1));
document.getElementById('playb').addEventListener('click',     togglePlay);
document.getElementById('next-sent').addEventListener('click', () => moveSent(1));
document.getElementById('next-pg').addEventListener('click',   () => changePage(1));
document.getElementById('speed-range').addEventListener('input',
  function() { setSpeed(this.value); });
document.getElementById('voice-sel').addEventListener('change',
  function() { setVoice(this.value); });

// Bookmarks sheet
document.getElementById('bm-bg').addEventListener('click',
  e => { if (e.target === e.currentTarget) closeBM(); });
document.getElementById('bm-x').addEventListener('click', closeBM);
document.getElementById('bm-import-input').addEventListener('change',
  function() { importBMs(this); });
document.querySelector('.bm-io-btn[title="Import bookmarks"]').addEventListener('click',
  () => document.getElementById('bm-import-input').click());
document.querySelector('.bm-io-btn[title="Export bookmarks"]').addEventListener('click',
  exportBMs);

// Tap popup buttons
document.getElementById('tap-cancel').addEventListener('click', dismissTapMenu);

// Dismiss tap popup on outside click
document.addEventListener('click', e => {
  const menu = document.getElementById('tap-menu');
  if (menu.classList.contains('on') &&
      !menu.contains(e.target) &&
      e.target.id !== 'hl-canvas') {
    dismissTapMenu();
  }
}, { capture: true });

// Canvas tap
const hlCanvas = document.getElementById('hl-canvas');
hlCanvas.addEventListener('click', onTap);
hlCanvas.addEventListener('touchend', e => {
  e.preventDefault();
  const t = e.changedTouches[0];
  onTap({ clientX: t.clientX, clientY: t.clientY });
}, { passive: false });

// Voices
speechSynthesis.onvoiceschanged = refreshVoices;
refreshVoices();

// Fullscreen / keyboard
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) document.body.classList.remove('reading');
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') exitReading();
});

// Auto-save position on page hide / close
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') savePosition();
});
window.addEventListener('beforeunload', savePosition);

// Swipe for focus-mode page navigation
setupSwipe(() => changePage(-1), () => changePage(1));
