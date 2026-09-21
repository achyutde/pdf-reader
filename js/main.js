// ─────────────────────────────────────────────────────
// Entry point: app init and all event wiring
// ─────────────────────────────────────────────────────

import { state }                                          from './state.js?v=2.3.8';
import { startProgressScan }                              from './progress.js?v=2.3.8';
import { renderPage, enableControls, savePosition,
         checkSavedPosition, clearHL, drawHL,
         showTicker, findWordAtPoint }                                     from './pdf.js?v=2.3.8';
import { refreshVoices, setVoice, togglePlay, cancelTTS,
         hardStop, updateBtn, setSpeed, injectDeps,
         startFrom, speakAt }                             from './speech.js?v=2.3.8';
import { changePage, jumpTo }                   from './navigation.js?v=2.3.8';
import { addBM, openBM, closeBM,
         exportBMs, importBMs }                           from './bookmarks.js?v=2.3.8';
import { enterReading, exitReading, toggleView, toast,
         doResume, dismissResume,
         updateReturnBtn }                                from './ui.js?v=2.3.8';
import { initAnnotations, toggleAnnotationPanel,
         resetAnnotationUI }                              from './annotations.js?v=2.3.8';

// ─── PDF.js worker ────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Inject toast, savePosition, updateReturnBtn into speech.js (avoids circular import)
injectDeps(toast, savePosition, updateReturnBtn);
initAnnotations(toast);

// Restore the reader-wide speed preference before a PDF is opened.
const storedRate = localStorage.getItem('reader:speed');
if (storedRate !== null) setSpeed(storedRate);

const headersFootersToggle = document.getElementById('read-headers-footers');
const tableModeSelect = document.getElementById('table-mode');

function loadReadingOrderSettings() {
  state.readHeadersFooters = localStorage.getItem('reader:readHeadersFooters') === 'true';
  const storedTableMode = localStorage.getItem('reader:tableMode');
  state.tableMode = ['columns', 'rows', 'skip'].includes(storedTableMode)
    ? storedTableMode
    : 'columns';
  headersFootersToggle.checked = state.readHeadersFooters;
  tableModeSelect.value = state.tableMode;
}
loadReadingOrderSettings();

async function reprocessReadingOrder(message) {
  if (!state.pdf) {
    toast(message);
    return;
  }
  const page = state.curPage;
  hardStop();
  await renderPage(page);
  startProgressScan();

  if (state.sentences.length) {
    state.curSent = 0;
    state.curWord = 0;
    state.pausePage = page;
    state.pauseSent = 0;
    state.pauseWord = 0;
    state.mode = 'paused';
    drawHL(0, 0);
    showTicker(state.sentences[0].text);
    updateBtn();
  }
  toast(message + ' — page reprocessed');
}

// ─── App init ─────────────────────────────────────────
async function initPDF(data) {
  hardStop();
  dismissResume();
  resetAnnotationUI();

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
  state.readingFinished = false;
  state.progressScanId += 1;
  state.pageWordCounts = [];
  state.totalWords = 0;
  state.scannedPages = 0;

  document.getElementById('drop-zone').style.display  = 'none';
  document.getElementById('canvas-wrap').classList.add('on');
  document.getElementById('page-scrubber').classList.add('on');
  const pageSlider = document.getElementById('page-slider');
  pageSlider.min = '1';
  pageSlider.max = String(state.numPages);
  pageSlider.value = '1';
  pageSlider.disabled = false;
  document.getElementById('page-slider-label').textContent =
    `Page 1 of ${state.numPages}`;
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
const menuToggle = document.getElementById('menu-toggle');
const appMenu = document.getElementById('app-menu');

function setAppMenu(open) {
  appMenu.classList.toggle('on', open);
  appMenu.setAttribute('aria-hidden', open ? 'false' : 'true');
  menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  menuToggle.setAttribute('aria-label', open ? 'Close reader menu' : 'Open reader menu');
}

menuToggle.addEventListener('click', event => {
  event.stopPropagation();
  setAppMenu(!appMenu.classList.contains('on'));
});
document.getElementById('open-pdf-btn').addEventListener('click', () => {
  setAppMenu(false);
  fileInput.click();
});
document.addEventListener('click', event => {
  if (appMenu.classList.contains('on') &&
      !appMenu.contains(event.target) &&
      event.target !== menuToggle) setAppMenu(false);
});
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
document.getElementById('bm-btn').addEventListener('click', () => {
  setAppMenu(false);
  openBM();
});
document.getElementById('saveb').addEventListener('click', addBM);
document.getElementById('annotate-btn').addEventListener('click', () => {
  setAppMenu(false);
  if (state.mode === 'speaking') togglePlay();
  toggleAnnotationPanel();
});
document.getElementById('view-btn').addEventListener('click', () => {
  toggleView();
  setAppMenu(false);
});
document.getElementById('focus-btn').addEventListener('click', () => {
  setAppMenu(false);
  resetAnnotationUI();
  enterReading();
});

// Preview while dragging; render only after release/change.
const pageSlider = document.getElementById('page-slider');
const pageSliderLabel = document.getElementById('page-slider-label');
pageSlider.addEventListener('input', function() {
  pageSliderLabel.textContent = `Page ${this.value} of ${state.numPages || '—'}`;
});
pageSlider.addEventListener('change', function() {
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
document.getElementById('prev-pg').addEventListener('click', () => changePage(-1));
document.getElementById('playb').addEventListener('click', togglePlay);
document.getElementById('next-pg').addEventListener('click', () => changePage(1));
document.getElementById('speed-select').addEventListener('change',
  function() { setSpeed(this.value); setAppMenu(false); });
document.getElementById('voice-sel').addEventListener('change',
  function() { setVoice(this.value); setAppMenu(false); });
headersFootersToggle.addEventListener('change', function() {
  state.readHeadersFooters = this.checked;
  localStorage.setItem('reader:readHeadersFooters', String(this.checked));
  setAppMenu(false);
  reprocessReadingOrder(this.checked
    ? 'Headers and footers enabled'
    : 'Headers and footers skipped');
});
tableModeSelect.addEventListener('change', function() {
  state.tableMode = ['columns', 'rows', 'skip'].includes(this.value)
    ? this.value
    : 'columns';
  localStorage.setItem('reader:tableMode', state.tableMode);
  setAppMenu(false);
  const messages = {
    columns: 'Tables read by columns',
    rows: 'Tables read left-to-right',
    skip: 'Tables skipped',
  };
  reprocessReadingOrder(messages[state.tableMode]);
});
window.addEventListener('reader-settings-imported', () => {
  loadReadingOrderSettings();
  reprocessReadingOrder('Imported reading settings applied');
});

// Bookmarks sheet
document.getElementById('bm-bg').addEventListener('click',
  e => { if (e.target === e.currentTarget) closeBM(); });
document.getElementById('bm-x').addEventListener('click', closeBM);
document.getElementById('bm-import-input').addEventListener('change',
  function() { importBMs(this); });
document.getElementById('bm-import-btn').addEventListener('click',
  () => document.getElementById('bm-import-input').click());
document.getElementById('bm-export-btn').addEventListener('click',
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
  if (state.annotationTool !== 'move' || !e.isPrimary) return;
  pointerStart = { id: e.pointerId, x: e.clientX, y: e.clientY };
});

hlCanvas.addEventListener('pointerup', e => {
  if (state.annotationTool !== 'move' || !pointerStart || pointerStart.id !== e.pointerId) return;
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

// Suppress browser double-/triple-tap zoom without changing the reader's
// pointer-based single-tap, swipe, or annotation gestures.
let lastTouchEnd = 0;
document.addEventListener('touchend', event => {
  const now = Date.now();
  if (now - lastTouchEnd <= 350) event.preventDefault();
  lastTouchEnd = now;
}, { passive: false });
document.addEventListener('dblclick', event => {
  event.preventDefault();
}, { passive: false });

// Auto-save position on page hide / close
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') savePosition();
});
window.addEventListener('beforeunload', savePosition);
