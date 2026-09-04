// ─────────────────────────────────────────────────────
// PDF rendering, sentence/word parsing, highlight, position
// ─────────────────────────────────────────────────────

import { state, PAGE_SCALE, HIGHLIGHT_WORDS } from './state.js?v=2.0.1';

const pdfCanvas  = document.getElementById('pdf-canvas');
const hlCanvas   = document.getElementById('hl-canvas');
const pdfCtx     = pdfCanvas.getContext('2d');
const hlCtx      = hlCanvas.getContext('2d');
export const content = document.getElementById('content');
export const ticker  = document.getElementById('ticker');

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
  const pageInput = document.getElementById('pg-input');
  if (pageInput) pageInput.value = n;
  document.getElementById('prev-pg').disabled    = n <= 1;
  document.getElementById('next-pg').disabled    = n >= state.numPages;
  document.getElementById('edge-prev').disabled  = n <= 1;
  document.getElementById('edge-next').disabled  = n >= state.numPages;

  clearHL();
  content.scrollTo({ top: 0, behavior: 'smooth' });
}

// Keep sentence-level speech, but retain a character range and rectangle for
// each word so taps and the moving three-word highlight are precise.
function parseSentences(items, vp) {
  let txt = '';
  const map = [];
  items.forEach((item, i) => {
    if (!item.str?.trim()) return;
    const s = txt.length;
    txt += item.str + ' ';
    map.push({ s, e: s + item.str.length, i });
  });

  const rx = /[^.!?…\n]+(?:[.!?…]+["']?(?=\s|$)|\n)|[^.!?…\n]+$/g;
  const chunks = txt.match(rx) || [txt];
  const sentences = [];
  const sentRects = [];
  let cur = 0;

  chunks.forEach(raw => {
    const text = raw.trim();
    if (!text) { cur += raw.length; return; }
    const leading = raw.indexOf(text);
    const a = cur + leading;
    const b = a + text.length;
    const hits = map.filter(m => m.e > a && m.s < b);
    const words = [];
    for (const match of text.matchAll(/\S+/g)) {
      const start = match.index;
      const end = start + match[0].length;
      words.push({
        text: match[0],
        start,
        end,
        rect: rangeRect(a + start, a + end, map, items, vp),
      });
    }
    sentences.push({ text, words });
    sentRects.push(unionRects(hits.map(m => itemRect(items[m.i], vp))));
    cur += raw.length;
  });
  return { sentences, sentRects };
}

function rangeRect(start, end, map, items, vp) {
  const rects = [];
  map.filter(m => m.e > start && m.s < end).forEach(m => {
    const item = items[m.i];
    const base = itemRect(item, vp);
    const len = Math.max(1, item.str.length);
    const from = Math.max(0, start - m.s);
    const to = Math.min(len, end - m.s);
    rects.push({
      x: base.x + base.w * (from / len),
      y: base.y,
      w: Math.max(2, base.w * ((to - from) / len)),
      h: base.h,
    });
  });
  return unionRects(rects);
}

function unionRects(rects) {
  if (!rects.length) return null;
  return {
    x: Math.min(...rects.map(r => r.x)),
    y: Math.min(...rects.map(r => r.y)),
    w: Math.max(...rects.map(r => r.x + r.w)) - Math.min(...rects.map(r => r.x)),
    h: Math.max(...rects.map(r => r.y + r.h)) - Math.min(...rects.map(r => r.y)),
  };
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

export async function getPageSentences(n) {
  const page = await state.pdf.getPage(n);
  const vp   = page.getViewport({ scale: PAGE_SCALE });
  const tc   = await page.getTextContent();
  const { sentences } = parseSentences(tc.items, vp);
  return sentences;
}

export function clearHL() {
  hlCtx.clearRect(0, 0, hlCanvas.width, hlCanvas.height);
}

export function drawHL(si, wi = state.curWord) {
  clearHL();
  if (state.ttsPage && state.ttsPage !== state.curPage) return;
  const words = state.sentences[si]?.words || [];
  const rects = words.slice(Math.max(0, wi), Math.max(0, wi) + HIGHLIGHT_WORDS)
    .map(word => word.rect).filter(Boolean);
  if (!rects.length) return;

  const pad = 3;
  hlCtx.fillStyle   = 'rgba(249,202,36,0.28)';
  hlCtx.strokeStyle = 'rgba(249,202,36,0.88)';
  hlCtx.lineWidth   = 2;
  rects.forEach(r => {
    hlCtx.beginPath();
    hlCtx.roundRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2, 5);
    hlCtx.fill();
    hlCtx.stroke();
  });

  const first = rects[0];
  const hlRect = hlCanvas.getBoundingClientRect();
  const scale = hlRect.height / hlCanvas.height;
  const wordTop = hlRect.top + first.y * scale;
  const cRect = content.getBoundingClientRect();
  const target = content.scrollTop + (wordTop - cRect.top) - content.clientHeight * 0.38;
  content.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
}

export function findWordAtPoint(cx, cy) {
  for (let si = 0; si < state.sentences.length; si++) {
    const words = state.sentences[si].words || [];
    for (let wi = 0; wi < words.length; wi++) {
      const r = words[wi].rect;
      if (!r) continue;
      if (cx >= r.x - 6 && cx <= r.x + r.w + 6 &&
          cy >= r.y - 6 && cy <= r.y + r.h + 6) return { si, wi };
    }
  }
  return null;
}

export function showTicker(text) {
  ticker.style.display = 'block';
  ticker.textContent = text;
}

export function enableControls() {
  ['playb', 'prev-pg', 'next-pg', 'prev-sent', 'next-sent', 'saveb', 'view-btn']
    .forEach(id => { document.getElementById(id).disabled = false; });
}

const posKey = () => 'pos:' + state.fileName;

export function savePosition() {
  if (!state.pdf) return;
  try {
    localStorage.setItem(posKey(), JSON.stringify({
      page: state.ttsPage ?? state.curPage,
      sent: Math.max(0, state.curSent),
      word: Math.max(0, state.curWord),
      ts: Date.now(),
    }));
  } catch (e) {}
}

export function checkSavedPosition() {
  try {
    const raw = localStorage.getItem(posKey());
    if (!raw) return;
    const pos = JSON.parse(raw);
    if (!pos || (pos.page === 1 && pos.sent === 0 && !pos.word)) return;
    pos.word = Math.max(0, pos.word || 0); // Backward-compatible with old saves.
    state.pendingResume = pos;
    const date = new Date(pos.ts).toLocaleDateString(undefined,
      { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    document.getElementById('resume-msg').innerHTML =
      `Last read <strong>page ${pos.page}</strong> on ${date} — continue from there?`;
    document.getElementById('resume-bar').classList.add('on');
  } catch (e) {}
}
