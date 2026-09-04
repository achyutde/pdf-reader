// ─────────────────────────────────────────────────────
// Entry point: app init and all event wiring
// ─────────────────────────────────────────────────────

import { state }                                          from './state.js?v=2.1.0';
import { startProgressScan }                              from './progress.js?v=2.1.0';
import { renderPage, enableControls, savePosition,
         checkSavedPosition, clearHL, drawHL,
         showTicker, findWordAtPoint }                                     from './pdf.js?v=2.1.0';
import { refreshVoices, setVoice, togglePlay, cancelTTS,
         hardStop, updateBtn, setSpeed, injectDeps,
         startFrom, speakAt }                             from './speech.js?v=2.1.0';
import { moveSent, changePage, jumpTo }                   from './navigation.js?v=2.1.0';
import { addBM, openBM, closeBM,
         exportBMs, importBMs }                           from './bookmarks.js?v=2.1.0';
import { enterReading, exitReading, toggleView, toast,
         doResume, dismissResume,
         updateReturnBtn }                                from './ui.js?v=2.1.0';

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
  state.curWord      = 0;
  state.pausePage    = 1;
  state.pauseSent    = 0;
  state.pauseWord    = 0;
  state.ttsPage      = null;
  state.ttsSentences = [];

  document.getElementById('drop-zone').style.display  = 'none';
  document.getElementById('canvas-wrap').classList.add('on');
  document.getElementById('page-jump').classList.add('on');
  document.getElementById('page-total').textContent   = `of ${state.numPages}`;
  const pageSelect = document.getElementById('pg-select');
  pageSelect.innerHTML = '';
  const pageOptions = document.createDocumentFragment();
  for (let page = 1; page <= state.numPages; page++) {
    const option = document.createElement('option');
    option.value = page;
    option.textContent = page;
    pageOptions.appendChild(option);
  }
  pageSelect.appendChild(pageOptions);
  pageSelect.disabled = false;
  document.getElementById('bm-btn').disabled           = false;
  document.getElementById('focus-btn').disabled        = false;
  enableControls();

  await renderPage(1);
  checkSavedPosition();
  startProgressScan();
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

  const found = findWordAtPoint(cx, cy);

  // Tap outside a word — just dismiss any open popup
  if (!found) { dismissTapMenu(); return; }
  const { si: foundSent, wi: foundWord } = found;

  // Dismiss any existing popup silently before showing a new one
  dismissTapMenuDOM();
  if (_tapSnap) { _tapSnap = null; clearTimeout(_tapDismissTimer); }

  // Snapshot state so we can restore on cancel
  _tapSnap = {
    curSent:      state.curSent,
    curWord:      state.curWord,
    mode:         state.mode,
    pausePage:    state.pausePage,
    pauseSent:    state.pauseSent,
    pauseWord:    state.pauseWord,
    ttsPage:      state.ttsPage,
    ttsSentences: state.ttsSentences,
    wasPlaying:   state.mode === 'speaking',
  };

  // Temporarily pause TTS (keep position, don't destroy state)
  if (_tapSnap.wasPlaying) cancelTTS();

  // Preview the tapped word and the next two words.
  clearHL(); drawHL(foundSent, foundWord);
  const sentence = state.sentences[foundSent];
  showTicker(sentence.text.slice(sentence.words[foundWord].start));

  // Populate and position popup
  document.getElementById('tap-preview').textContent =
    sentence.text.slice(sentence.words[foundWord].start, sentence.words[foundWord].start + 120);
  showTapMenu(foundSent, e.clientX, e.clientY);

  // Wire confirm button (re-wire each tap to capture current `found`)
  document.getElementById('tap-read').onclick = () => {
    clearTimeout(_tapDismissTimer);
    _tapSnap = null;
    dismissTapMenuDOM();

    state.curSent   = foundSent;
    state.curWord   = foundWord;
    state.pausePage = state.curPage;
    state.pauseSent = foundSent;
    state.pauseWord = foundWord;
    state.mode      = 'paused';
    clearHL(); drawHL(foundSent, foundWord);
    showTicker(sentence.text.slice(sentence.words[foundWord].start));
    updateBtn(); savePosition();
    // Start from the exact word the user tapped.
    startFrom(state.curPage, foundSent, foundWord);
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
    clearHL(); drawHL(snap.curSent, snap.curWord);
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
    state.curWord      = snap.curWord;
    state.pausePage    = snap.pausePage;
    state.pauseSent    = snap.pauseSent;
    state.pauseWord    = snap.pauseWord;
    const resumeSent   = snap.curSent >= 0 ? snap.curSent : snap.pauseSent;
    if (snap.ttsPage && snap.ttsPage !== state.curPage) {
      startFrom(snap.ttsPage, resumeSent, snap.curWord);
    } else {
      speakAt(resumeSent, snap.curWord);
    }
    updateBtn();
  } else {
    state.curSent   = snap.curSent;
    state.curWord   = snap.curWord;
    state.pausePage = snap.pausePage;
    state.pauseSent = snap.pauseSent;
    state.pauseWord = snap.pauseWord;
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

// Page dropdown remains available alongside swipe navigation.
document.getElementById('pg-select').addEventListener('change', function() {
  jumpTo(parseInt(this.value, 10));
});

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
    clearHL(); drawHL(state.curSent, state.curWord);
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

// Canvas tap/swipe. Pointer Events handle mouse, pen, and touch with one
// gesture path; a gesture can select a word or change a page, never both.
const hlCanvas = document.getElementById('hl-canvas');
let pointerStart = null;

hlCanvas.addEventListener('pointerdown', e => {
  if (!e.isPrimary) return;
  pointerStart = { id: e.pointerId, x: e.clientX, y: e.clientY };
});

hlCanvas.addEventListener('pointerup', e => {
  if (!pointerStart || pointerStart.id !== e.pointerId) return;
  const dx = e.clientX - pointerStart.x;
  const dy = e.clientY - pointerStart.y;
  pointerStart = null;

  if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    changePage(dx < 0 ? 1 : -1);
    return;
  }
  if (Math.abs(dx) <= 10 && Math.abs(dy) <= 10) {
    onTap({ clientX: e.clientX, clientY: e.clientY });
  }
});

hlCanvas.addEventListener('pointercancel', () => { pointerStart = null; });

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

