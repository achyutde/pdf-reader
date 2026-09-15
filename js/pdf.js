// ─────────────────────────────────────────────────────
// PDF rendering, sentence/word parsing, highlight, position
// ─────────────────────────────────────────────────────

import { state, PAGE_SCALE, HIGHLIGHT_WORDS } from './state.js?v=2.2.5';
import { updateProgress } from './progress.js?v=2.2.5';

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
  const wordGeometry = await buildWordGeometry(tc, state.viewport);
  const { sentences, sentRects } = parseSentences(tc.items, state.viewport, wordGeometry);
  state.sentences = sentences;
  state.sentRects = sentRects;

  state.curPage = n;
  const pageSelect = document.getElementById('pg-select');
  if (pageSelect) pageSelect.value = n;
  document.getElementById('prev-pg').disabled    = n <= 1;
  document.getElementById('next-pg').disabled    = n >= state.numPages;
  document.getElementById('edge-prev').disabled  = n <= 1;
  document.getElementById('edge-next').disabled  = n >= state.numPages;

  clearHL();
  content.scrollTo({ top: 0, behavior: 'smooth' });
  updateProgress();
}

// Keep sentence-level speech, but retain a character range and rectangle for
// each word so taps and the moving three-word highlight are precise.
async function buildWordGeometry(textContent, viewport) {
  if (typeof pdfjsLib.renderTextLayer !== 'function') {
    throw new Error('This PDF.js build does not provide text-layer rendering.');
  }

  const layer = document.createElement('div');
  layer.className = 'text-geometry-layer';
  layer.style.width = `${viewport.width}px`;
  layer.style.height = `${viewport.height}px`;
  document.body.appendChild(layer);

  try {
    const textDivs = [];
    const task = pdfjsLib.renderTextLayer({
      textContentSource: textContent,
      container: layer,
      viewport,
      textDivs,
    });
    await (task?.promise || task);
    await new Promise(resolve => requestAnimationFrame(resolve));

    const layerRect = layer.getBoundingClientRect();
    const geometry = new Map();

    textContent.items.forEach((item, itemIndex) => {
      const source = item.str || '';
      const span = textDivs[itemIndex];
      if (!source.trim() || !span || span.textContent !== source) return;

      const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
      const textNode = walker.nextNode();
      if (!textNode || textNode.data.length < source.length) return;

      const words = [];
      for (const match of source.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(textNode, match.index);
        range.setEnd(textNode, match.index + match[0].length);
        const clientRects = [...range.getClientRects()];
        range.detach?.();
        if (!clientRects.length) continue;

        const rect = unionRects(clientRects.map(clientRect => ({
          x: clientRect.left - layerRect.left,
          y: clientRect.top - layerRect.top,
          w: clientRect.width,
          h: clientRect.height,
        })));
        if (!rect || rect.w < 0.5 || rect.h < 0.5) continue;
        if (rect.x + rect.w < 0 || rect.y + rect.h < 0 ||
            rect.x > viewport.width || rect.y > viewport.height) continue;

        words.push({ text: match[0], rect });
      }
      if (words.length) geometry.set(itemIndex, words);
    });
    return geometry;
  } finally {
    layer.remove();
  }
}

// Keep sentence-level speech, but create text and geometry from PDF.js's own
// positioned text layer. This prevents a word in one visual region from being
// associated with text extracted from another region.
function parseSentences(items, vp, wordGeometry) {
  const lines = orderIntoVisualLines(items, vp, wordGeometry);
  let txt = '';
  const map = [];

  lines.forEach((line, lineIndex) => {
    const visualWords = line.items
      .flatMap(entry => entry.words)
      .sort((a, b) => a.rect.x - b.rect.x);

    visualWords.forEach(word => {
      if (txt && !/\s$/.test(txt)) txt += ' ';
      const s = txt.length;
      txt += word.text;
      map.push({ s, e: txt.length, text: word.text, rect: word.rect });
    });

    const nextLine = lines[lineIndex + 1];
    if (!nextLine) return;
    const currentIsTable = isTableLikeLine(line);
    const nextIsTable = isTableLikeLine(nextLine);
    const tableContinuation =
      currentIsTable && isContinuationOfTableRow(line, nextLine);
    const tableBoundary =
      nextIsTable || (currentIsTable && !tableContinuation);
    const blockBoundary =
      hasLargeVerticalGap(line, nextLine) || hasStrongStyleChange(line, nextLine);
    txt += tableBoundary || blockBoundary ? '\n' : ' ';
  });

  const rx = /[^.!?…,:;—–\n]+(?:[.!?…,:;—–]+["']?(?=\s|$)|\n)|[^.!?…,:;—–\n]+$/g;
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
    const hits = map.filter(word => word.e > a && word.s < b);
    const words = hits.map(word => ({
      text: word.text,
      start: Math.max(0, word.s - a),
      end: Math.min(text.length, word.e - a),
      rect: word.rect,
    }));
    if (words.length) {
      sentences.push({ text, words });
      sentRects.push(unionRects(words.map(word => word.rect)));
    }
    cur += raw.length;
  });
  return { sentences, sentRects };
}

function isTableLikeLine(line) {
  if (!line || line.items.length < 2) return false;
  for (let i = 1; i < line.items.length; i++) {
    const previous = line.items[i - 1].rect;
    const current = line.items[i].rect;
    const gap = current.x - (previous.x + previous.w);
    const threshold = Math.max(48, Math.max(previous.h, current.h) * 2);
    if (gap >= threshold) return true;
  }
  return false;
}

function isContinuationOfTableRow(line, nextLine) {
  if (isTableLikeLine(nextLine)) return false;
  const currentLeft = Math.min(...line.items.map(entry => entry.rect.x));
  const nextLeft = Math.min(...nextLine.items.map(entry => entry.rect.x));
  const currentHeight = Math.max(...line.items.map(entry => entry.rect.h));
  const nextHeight = Math.max(...nextLine.items.map(entry => entry.rect.h));
  const closeVertically =
    nextLine.centerY - line.centerY <= Math.max(currentHeight, nextHeight) * 1.55;
  return closeVertically && nextLeft - currentLeft >= 80;
}

function hasStrongStyleChange(line, nextLine) {
  const lineHeight = Math.max(...line.items.map(entry => entry.rect.h));
  const nextHeight = Math.max(...nextLine.items.map(entry => entry.rect.h));
  return Math.max(lineHeight, nextHeight) / Math.min(lineHeight, nextHeight) >= 1.25;
}

function hasLargeVerticalGap(line, nextLine) {
  const lineHeight = Math.max(...line.items.map(entry => entry.rect.h));
  const nextHeight = Math.max(...nextLine.items.map(entry => entry.rect.h));
  return nextLine.centerY - line.centerY > Math.max(lineHeight, nextHeight) * 1.55;
}

function orderIntoVisualLines(items, vp, wordGeometry) {
  const positioned = items
    .map((item, index) => {
      const words = wordGeometry.get(index) || [];
      const rect = unionRects(words.map(word => word.rect));
      return { item, index, words, rect };
    })
    .filter(({ item, words, rect }) =>
      item.str?.trim() && words.length && rect &&
      Number.isFinite(rect.x) && Number.isFinite(rect.y) &&
      rect.w > 0 && rect.h > 0
    )
    .sort((a, b) => (a.rect.y + a.rect.h / 2) - (b.rect.y + b.rect.h / 2));

  const lines = [];
  positioned.forEach(entry => {
    const centerY = entry.rect.y + entry.rect.h / 2;
    const previous = lines[lines.length - 1];
    const tolerance = Math.max(4, entry.rect.h * 0.55);
    if (!previous || Math.abs(centerY - previous.centerY) > tolerance) {
      lines.push({ centerY, items: [entry] });
    } else {
      previous.items.push(entry);
      previous.centerY =
        previous.items.reduce((sum, value) => sum + value.rect.y + value.rect.h / 2, 0) /
        previous.items.length;
    }
  });
  lines.forEach(line => line.items.sort((a, b) => a.rect.x - b.rect.x));
  return lines;
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
  const wordGeometry = await buildWordGeometry(tc, vp);
  const { sentences } = parseSentences(tc.items, vp, wordGeometry);
  return sentences;
}

export function clearHL() {
  hlCtx.clearRect(0, 0, hlCanvas.width, hlCanvas.height);
}

export function drawHL(si, wi = state.curWord, wordCount = HIGHLIGHT_WORDS) {
  clearHL();
  if (state.ttsPage && state.ttsPage !== state.curPage) return;
  const words = state.sentences[si]?.words || [];
  const rects = words.slice(Math.max(0, wi), Math.max(0, wi) + wordCount)
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
  const candidates = [];
  const slop = 8;

  for (let si = 0; si < state.sentences.length; si++) {
    const words = state.sentences[si].words || [];
    for (let wi = 0; wi < words.length; wi++) {
      const r = words[wi].rect;
      if (!r) continue;
      const dx = cx < r.x ? r.x - cx : cx > r.x + r.w ? cx - (r.x + r.w) : 0;
      const dy = cy < r.y ? r.y - cy : cy > r.y + r.h ? cy - (r.y + r.h) : 0;
      if (dx > slop || dy > slop) continue;

      // Several padded word rectangles can overlap on small screens. Select
      // the closest visual word instead of whichever appears first in text.
      const centerX = r.x + r.w / 2;
      const centerY = r.y + r.h / 2;
      const score = dx * dx + dy * dy +
        ((cx - centerX) ** 2 + (cy - centerY) ** 2) * 0.001;
      candidates.push({ si, wi, score });
    }
  }

  candidates.sort((a, b) => a.score - b.score);
  return candidates[0] || null;
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
  updateProgress();
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
