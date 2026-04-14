// ─────────────────────────────────────────────────────
// Entry point: app init and all event wiring
// ─────────────────────────────────────────────────────

import { state }                                          from './state.js';
import { renderPage, enableControls, savePosition,
         checkSavedPosition, clearHL, drawHL,
         showTicker }                                     from './pdf.js';
import { refreshVoices, setVoice, togglePlay, cancelTTS,
         hardStop, updateBtn, setSpeed, injectDeps,
         startFrom }                                      from './speech.js';
import { moveSent, changePage, jumpTo }                   from './navigation.js';
import { addBM, openBM, closeBM, gotoBM,
         exportBMs, importBMs }                           from './bookmarks.js';
import { enterReading, exitReading, toggleView, toast,
         doResume, dismissResume, setupSwipe }            from './ui.js';

// ─── PDF.js worker ────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Inject toast + savePosition into speech.js (avoids circular import)
injectDeps(toast, savePosition);

// ─── App init ─────────────────────────────────────────
async function initPDF(data) {
  hardStop();
  dismissResume();

  state.pdf      = await pdfjsLib.getDocument({ data }).promise;
  state.numPages = state.pdf.numPages;
  state.curPage  = 1;
  state.curSent  = 0;
  state.pausePage = 1;
  state.pauseSent = 0;

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

// ─── Tap to position ──────────────────────────────────
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
  if (found < 0) return;

  const wasPlaying = state.mode === 'speaking';
  cancelTTS();

  state.curSent   = found;
  state.pausePage = state.curPage;
  state.pauseSent = found;
  state.mode      = 'paused';

  clearHL(); drawHL(found); showTicker(state.sentences[found].text);
  updateBtn(); savePosition();

  if (wasPlaying) startFrom(state.curPage, found);
  else toast('Tap ▶ Resume to read from here');
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
