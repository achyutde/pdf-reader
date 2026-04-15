// ─────────────────────────────────────────────────────
// PDF rendering, sentence parsing, highlight, position
// ─────────────────────────────────────────────────────

import { state, PAGE_SCALE } from './state.js';

const pdfCanvas  = document.getElementById('pdf-canvas');
const hlCanvas   = document.getElementById('hl-canvas');
const pdfCtx     = pdfCanvas.getContext('2d');
const hlCtx      = hlCanvas.getContext('2d');
export const content    = document.getElementById('content');
const canvasWrap = document.getElementById('canvas-wrap');
export const ticker     = document.getElementById('ticker');

// ─── Render ───────────────────────────────────────────
export async function renderPage(n) {
  const page     = await state.pdf.getPage(n);
  state.viewport = page.getViewport({ scale: PAGE_SCALE });

  pdfCanvas.width  = state.viewport.width;
  pdfCanvas.height = state.viewport.height;
  hlCanvas.width   = state.viewport.width;
  hlCanvas.height  = state.viewport.height;

  await page.render({ canvasContext: pdfCtx, viewport: state.viewport }).promise;

  const tc = await page.getTextContent();
  const { sentences, sentRects } = parseSentences(tc.items, state.viewport);
  state.sentences = sentences;
  state.sentRects = sentRects;

  state.curPage = n;
  document.getElementById('pg-input').value      = n;
  document.getElementById('prev-pg').disabled    = n <= 1;
  document.getElementById('next-pg').disabled    = n >= state.numPages;
  document.getElementById('edge-prev').disabled  = n <= 1;
  document.getElementById('edge-next').disabled  = n >= state.numPages;

  clearHL();
  content.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─── Sentence parsing ─────────────────────────────────
// Returns { sentences, sentRects } without touching state — used by both
// renderPage (display) and getPageSentences (background TTS fetch).
function parseSentences(items, vp) {
  let txt = '', map = [];
  items.forEach((item, i) => {
    if (!item.str?.trim()) return;
    const s = txt.length;
    txt += item.str + ' ';
    map.push({ s, e: txt.length, i });
  });

  const rx       = /[^.!?…\n]+(?:[.!?…]+["']?(?=\s|$)|\n)|[^.!?…\n]+$/g;
  const chunks   = txt.match(rx) || [txt];
  const sentences = [];
  const sentRects = [];
  let cur = 0;

  chunks.forEach(raw => {
    const text = raw.trim();
    if (!text) { cur += raw.length; return; }
    const a    = cur, b = cur + raw.length;
    const hits = map.filter(m => m.e > a && m.s < b);
    sentences.push({ text });

    if (hits.length) {
      const rs = hits.map(m => itemRect(items[m.i], vp));
      sentRects.push({
        x: Math.min(...rs.map(r => r.x)),
        y: Math.min(...rs.map(r => r.y)),
        w: Math.max(...rs.map(r => r.x + r.w)) - Math.min(...rs.map(r => r.x)),
        h: Math.max(...rs.map(r => r.y + r.h)) - Math.min(...rs.map(r => r.y)),
      });
    } else {
      sentRects.push(null);
    }
    cur = b;
  });
  return { sentences, sentRects };
}

function itemRect(item, vp) {
  const [,,,sy,tx,ty] = item.transform;
  const h = Math.abs(sy);
  return {
    x: tx * vp.scale,
    y: (vp.height / vp.scale - ty) * vp.scale - h * vp.scale,
    w: (item.width || 40) * vp.scale,
    h: h * vp.scale + 4,
  };
}

// Fetch sentences for page n without rendering to canvas.
// Used by speakAt() to advance TTS in the background.
export async function getPageSentences(n) {
  const page = await state.pdf.getPage(n);
  const vp   = page.getViewport({ scale: PAGE_SCALE });
  const tc   = await page.getTextContent();
  const { sentences } = parseSentences(tc.items, vp);
  return sentences;
}

// ─── Highlight ────────────────────────────────────────
export function clearHL() {
  hlCtx.clearRect(0, 0, hlCanvas.width, hlCanvas.height);
}

export function drawHL(si) {
  clearHL();
  // Don't draw highlights when the display page differs from the TTS page
  if (state.ttsPage && state.ttsPage !== state.curPage) return;
  const r = state.sentRects[si];
  if (!r) return;
  const pad = 5;
  hlCtx.fillStyle   = 'rgba(249,202,36,0.28)';
  hlCtx.strokeStyle = 'rgba(249,202,36,0.88)';
  hlCtx.lineWidth   = 2.5;
  hlCtx.beginPath();
  hlCtx.roundRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2, 6);
  hlCtx.fill();
  hlCtx.stroke();

  // Auto-scroll to keep highlighted sentence visible
  const hlRect  = hlCanvas.getBoundingClientRect();
  const scale   = hlRect.height / hlCanvas.height;
  const sentTop = hlRect.top + r.y * scale;
  const cRect   = content.getBoundingClientRect();
  const target  = content.scrollTop + (sentTop - cRect.top) - content.clientHeight * 0.38;
  content.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
}

export function showTicker(text) {
  ticker.style.display = 'block';
  ticker.textContent   = text;
}

// ─── Controls ─────────────────────────────────────────
export function enableControls() {
  ['playb', 'prev-pg', 'next-pg', 'prev-sent', 'next-sent', 'saveb', 'view-btn']
    .forEach(id => { document.getElementById(id).disabled = false; });
}

// ─── Position persistence ─────────────────────────────
const posKey = () => 'pos:' + state.fileName;

export function savePosition() {
  if (!state.pdf) return;
  try {
    localStorage.setItem(posKey(), JSON.stringify({
      page: state.ttsPage ?? state.curPage,
      sent: Math.max(0, state.curSent),
      ts:   Date.now(),
    }));
  } catch (e) {}
}

export function checkSavedPosition() {
  try {
    const raw = localStorage.getItem(posKey());
    if (!raw) return;
    const pos = JSON.parse(raw);
    if (!pos || (pos.page === 1 && pos.sent === 0)) return;
    state.pendingResume = pos;
    const date = new Date(pos.ts).toLocaleDateString(undefined,
      { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    document.getElementById('resume-msg').innerHTML =
      `Last read <strong>page ${pos.page}</strong> on ${date} — continue from there?`;
    document.getElementById('resume-bar').classList.add('on');
  } catch (e) {}
}
