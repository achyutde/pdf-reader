// ─────────────────────────────────────────────────────
// PDF rendering, sentence/word parsing, highlight, position
// ─────────────────────────────────────────────────────

import { state, PAGE_SCALE, HIGHLIGHT_WORDS } from './state.js?v=2.3.9';
import { updateProgress } from './progress.js?v=2.3.9';
import { syncAnnotationCanvas, renderAnnotations } from './annotations.js?v=2.3.9';

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
  syncAnnotationCanvas(state.viewport.width, state.viewport.height);

  await page.render({ canvasContext: pdfCtx, viewport: state.viewport }).promise;

  const tc = await page.getTextContent();
  const { sentences, sentRects } = parseSentences(tc.items, state.viewport);
  state.sentences = sentences;
  state.sentRects = sentRects;

  state.curPage = n;
  renderAnnotations(n);
  const pageSlider = document.getElementById('page-slider');
  const pageSliderLabel = document.getElementById('page-slider-label');
  if (pageSlider) pageSlider.value = n;
  if (pageSliderLabel) pageSliderLabel.textContent = `Page ${n} of ${state.numPages}`;
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
function parseSentences(items, vp) {
  const lines = orderIntoVisualLines(items, vp);
  const stream = buildReadingStream(lines, vp);
  let txt = '';
  const map = [];

  stream.forEach(part => {
    part.entries.forEach(({ item, index }) => {
      const s = txt.length;
      txt += item.str + ' ';
      map.push({ s, e: s + item.str.length, i: index });
    });
    txt += part.separator;
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

function buildReadingStream(lines, vp) {
  const stream = [];
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    const line = lines[lineIndex];
    if (isTableLikeLine(line)) {
      const table = findTableBlock(lines, lineIndex, vp);
      // A visually table-like region is either read in verified column order
      // or omitted. It never falls back to the misleading row-by-row order.
      if (table.confident && state.tableMode === 'columns') {
        table.columns.forEach(column => {
          column
            .sort((a, b) => a.centerY - b.centerY || a.x - b.x)
            .forEach(cell => stream.push({ entries: cell.entries, separator: '\n' }));
        });
      } else if (table.confident && state.tableMode === 'rows') {
        table.rows.forEach(row => {
          row
            .sort((a, b) => a.columnIndex - b.columnIndex)
            .forEach(cell => stream.push({ entries: cell.entries, separator: '\n' }));
        });
      }
      lineIndex = table.end + 1;
      continue;
    }

    const nextLine = lines[lineIndex + 1];
    const boundary = !nextLine || isTableLikeLine(nextLine) ||
      hasLargeVerticalGap(line, nextLine) || hasStrongStyleChange(line, nextLine);
    stream.push({ entries: line.items, separator: boundary ? '\n' : ' ' });
    lineIndex += 1;
  }
  return stream;
}

function splitLineIntoSegments(line) {
  if (!line?.items?.length) return [];
  const heights = line.items.map(entry => entry.rect.h).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || 12;
  const gapThreshold = Math.max(44, medianHeight * 2.2);
  const segments = [[line.items[0]]];

  for (let index = 1; index < line.items.length; index++) {
    const previous = line.items[index - 1].rect;
    const current = line.items[index].rect;
    const gap = current.x - (previous.x + previous.w);
    if (gap >= gapThreshold) segments.push([]);
    segments[segments.length - 1].push(line.items[index]);
  }
  return segments;
}

function isTableLikeLine(line) {
  return splitLineIntoSegments(line).length >= 2;
}

function findTableBlock(lines, start, vp) {
  const tableRows = [];
  let lastTableRow = start;

  for (let index = start; index < lines.length; index++) {
    if (index > start && hasLargeVerticalGap(lines[index - 1], lines[index])) break;
    if (isTableLikeLine(lines[index])) {
      tableRows.push(index);
      lastTableRow = index;
    } else if (index - lastTableRow > 2) {
      break;
    }
  }

  const end = lastTableRow;
  const tolerance = Math.max(24, vp.width * 0.025);
  const clusters = [];

  tableRows.forEach(rowIndex => {
    splitLineIntoSegments(lines[rowIndex]).forEach(segment => {
      const x = segment[0].rect.x;
      let cluster = clusters.find(value => Math.abs(value.x - x) <= tolerance);
      if (!cluster) {
        cluster = { x, samples: [], rows: new Set() };
        clusters.push(cluster);
      }
      cluster.samples.push(x);
      cluster.rows.add(rowIndex);
      cluster.x = cluster.samples.reduce((sum, value) => sum + value, 0) /
        cluster.samples.length;
    });
  });

  const minimumSupport = Math.max(2, Math.ceil(tableRows.length * 0.5));
  const anchors = clusters
    .filter(cluster => cluster.rows.size >= minimumSupport)
    .map(cluster => cluster.x)
    .sort((a, b) => a - b);

  const minimumGap = anchors.length > 1
    ? Math.min(...anchors.slice(1).map((value, index) => value - anchors[index]))
    : 0;
  let confident = tableRows.length >= 2 && anchors.length >= 2 &&
    minimumGap >= Math.max(42, vp.width * 0.055);
  const columns = anchors.map(() => []);
  const rows = [];

  if (confident) {
    const assignmentTolerance = Math.max(60, minimumGap * 0.48);
    for (let index = start; index <= end; index++) {
      const line = lines[index];
      const row = [];
      for (const entries of splitLineIntoSegments(line)) {
        const x = entries[0].rect.x;
        let columnIndex = 0;
        let distance = Infinity;
        anchors.forEach((anchor, candidate) => {
          const candidateDistance = Math.abs(anchor - x);
          if (candidateDistance < distance) {
            distance = candidateDistance;
            columnIndex = candidate;
          }
        });
        if (distance > assignmentTolerance) {
          confident = false;
          break;
        }
        const cell = { entries, centerY: line.centerY, x, columnIndex };
        columns[columnIndex].push(cell);
        row.push(cell);
      }
      if (!confident) break;
      if (row.length) rows.push(row);
    }
  }

  return { end, confident, columns, rows };
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

function orderIntoVisualLines(items, vp) {
  const topMargin = vp.height * 0.08;
  const bottomMargin = vp.height * 0.92;
  const positioned = items
    .map((item, index) => ({ item, index, rect: itemRect(item, vp) }))
    .filter(({ item, rect }) => {
      if (!item.str?.trim() ||
          !Number.isFinite(rect.x) || !Number.isFinite(rect.y) ||
          rect.w <= 0 || rect.h <= 0) return false;
      if (state.readHeadersFooters) return true;
      const centerY = rect.y + rect.h / 2;
      return centerY >= topMargin && centerY <= bottomMargin;
    })
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
  ['playb', 'stopb', 'prev-pg', 'next-pg', 'saveb', 'view-btn', 'annotate-btn']
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
