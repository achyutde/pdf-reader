// ─────────────────────────────────────────────────────
// Freehand PDF annotations stored separately from the PDF
// ─────────────────────────────────────────────────────

import { state } from './state.js?v=2.3.3';

const canvas = document.getElementById('annotation-canvas');
const inputCanvas = document.getElementById('hl-canvas');
const ctx = canvas.getContext('2d');
const toolbar = document.getElementById('annotation-toolbar');
const historyByPage = new Map();
let notify = () => {};
let gesture = null;

const annotationKey = () => 'ann:' + state.fileName;

function readPages() {
  try {
    const value = JSON.parse(localStorage.getItem(annotationKey()) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writePages(pages) {
  try {
    localStorage.setItem(annotationKey(), JSON.stringify(pages));
  } catch {
    notify('Could not save annotations');
  }
}

function pageStrokes(pages, page = state.curPage) {
  const key = String(page);
  if (!Array.isArray(pages[key])) pages[key] = [];
  return pages[key];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function pushHistory(page, strokes) {
  const stack = historyByPage.get(page) || [];
  stack.push(clone(strokes));
  if (stack.length > 30) stack.shift();
  historyByPage.set(page, stack);
}

function pointFromEvent(event) {
  const rect = inputCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height || !canvas.width || !canvas.height) return null;
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
  };
}

function drawStroke(stroke) {
  if (!stroke?.points?.length) return;
  const scale = Math.min(canvas.width, canvas.height);
  const width = (stroke.width || (stroke.tool === 'highlight' ? 0.025 : 0.006)) * scale;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = stroke.tool === 'highlight'
    ? 'rgba(249, 202, 36, 0.32)'
    : 'rgba(231, 76, 60, 0.95)';
  ctx.beginPath();
  stroke.points.forEach((point, index) => {
    const x = point.x * canvas.width;
    const y = point.y * canvas.height;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    ctx.lineTo(point.x * canvas.width + 0.01, point.y * canvas.height + 0.01);
  }
  ctx.stroke();
  ctx.restore();
}

function drawPage(pages, page = state.curPage) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const strokes = pages[String(page)] || [];
  strokes.forEach(drawStroke);
}

export function syncAnnotationCanvas(width, height) {
  canvas.width = width;
  canvas.height = height;
}

export function renderAnnotations(page = state.curPage) {
  if (!state.fileName || !canvas.width) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  drawPage(readPages(), page);
}

function distanceToSegment(point, start, end) {
  const px = point.x * canvas.width;
  const py = point.y * canvas.height;
  const ax = start.x * canvas.width;
  const ay = start.y * canvas.height;
  const bx = end.x * canvas.width;
  const by = end.y * canvas.height;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared
    ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
    : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function strokeNearPoint(stroke, point) {
  const points = stroke.points || [];
  if (!points.length) return false;
  const radius = Math.min(canvas.width, canvas.height) * 0.025;
  if (points.length === 1) return distanceToSegment(point, points[0], points[0]) <= radius;
  for (let index = 1; index < points.length; index++) {
    if (distanceToSegment(point, points[index - 1], points[index]) <= radius) return true;
  }
  return false;
}

function eraseAt(point) {
  const strokes = pageStrokes(gesture.pages);
  const remaining = strokes.filter(stroke => !strokeNearPoint(stroke, point));
  if (remaining.length === strokes.length) return;
  if (!gesture.historySaved) {
    pushHistory(state.curPage, strokes);
    gesture.historySaved = true;
  }
  gesture.pages[String(state.curPage)] = remaining;
  gesture.changed = true;
  drawPage(gesture.pages);
}

function setTool(tool) {
  state.annotationTool = tool;
  document.body.classList.toggle('annotating-draw', tool !== 'move');
  toolbar.querySelectorAll('[data-tool]').forEach(button => {
    const active = button.dataset.tool === tool;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

export function resetAnnotationUI() {
  toolbar.classList.remove('on');
  toolbar.setAttribute('aria-hidden', 'true');
  document.getElementById('annotate-btn').classList.remove('active');
  document.body.classList.remove('annotating');
  setTool('move');
  historyByPage.clear();
}

export function toggleAnnotationPanel() {
  const opening = !toolbar.classList.contains('on');
  toolbar.classList.toggle('on', opening);
  toolbar.setAttribute('aria-hidden', opening ? 'false' : 'true');
  document.getElementById('annotate-btn').classList.toggle('active', opening);
  document.body.classList.toggle('annotating', opening);
  if (!opening) setTool('move');
  notify(opening ? 'Annotation tools opened' : 'Annotation tools closed');
}

function undoCurrentPage() {
  const stack = historyByPage.get(state.curPage) || [];
  if (!stack.length) {
    notify('Nothing to undo');
    return;
  }
  const pages = readPages();
  pages[String(state.curPage)] = stack.pop();
  historyByPage.set(state.curPage, stack);
  writePages(pages);
  drawPage(pages);
  notify('Annotation undone');
}

function clearCurrentPage() {
  const pages = readPages();
  const strokes = pages[String(state.curPage)] || [];
  if (!strokes.length) {
    notify('No annotations on this page');
    return;
  }
  if (!window.confirm('Clear all annotations on this page?')) return;
  pushHistory(state.curPage, strokes);
  pages[String(state.curPage)] = [];
  writePages(pages);
  drawPage(pages);
  notify('Page annotations cleared');
}

export function initAnnotations(toast) {
  notify = toast;
  toolbar.querySelectorAll('[data-tool]').forEach(button => {
    button.addEventListener('click', () => setTool(button.dataset.tool));
  });
  document.getElementById('ann-undo').addEventListener('click', undoCurrentPage);
  document.getElementById('ann-clear').addEventListener('click', clearCurrentPage);

  inputCanvas.addEventListener('pointerdown', event => {
    if (state.annotationTool === 'move' || !state.pdf || !event.isPrimary) return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    inputCanvas.setPointerCapture?.(event.pointerId);
    const pages = readPages();
    gesture = { pointerId: event.pointerId, pages, changed: false, historySaved: false };

    if (state.annotationTool === 'eraser') {
      eraseAt(point);
      return;
    }

    const strokes = pageStrokes(pages);
    pushHistory(state.curPage, strokes);
    const stroke = {
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      tool: state.annotationTool,
      width: state.annotationTool === 'highlight' ? 0.025 : 0.006,
      points: [point],
      ts: Date.now(),
    };
    strokes.push(stroke);
    gesture.stroke = stroke;
    gesture.changed = true;
    drawPage(pages);
  });

  inputCanvas.addEventListener('pointermove', event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    if (state.annotationTool === 'eraser') eraseAt(point);
    else if (gesture.stroke) {
      gesture.stroke.points.push(point);
      drawPage(gesture.pages);
    }
  });

  const finishGesture = event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.changed) writePages(gesture.pages);
    if (inputCanvas.hasPointerCapture?.(event.pointerId)) {
      inputCanvas.releasePointerCapture(event.pointerId);
    }
    gesture = null;
  };
  inputCanvas.addEventListener('pointerup', finishGesture);
  inputCanvas.addEventListener('pointercancel', finishGesture);
}
