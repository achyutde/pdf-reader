// ─────────────────────────────────────────────────────
// Bookmark management: add, list, navigate, delete,
// export to JSON file, import from JSON file
// ─────────────────────────────────────────────────────

import { state } from './state.js?v=2.3.1';
import { renderPage, clearHL, drawHL, showTicker, savePosition } from './pdf.js?v=2.3.1';
import { hardStop, startFrom, updateBtn, setSpeed } from './speech.js?v=2.3.2';
import { toast } from './ui.js?v=2.3.1';
import { renderAnnotations } from './annotations.js?v=2.3.1';

// ─── Storage helpers ──────────────────────────────────
const bmKey       = ()  => 'bm:' + state.fileName;
const getBMs      = ()  => { try { return JSON.parse(localStorage.getItem(bmKey()) || '[]'); } catch { return []; } };
const getBMsByKey = k   => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
const putBMs      = bms => localStorage.setItem(bmKey(), JSON.stringify(bms));
const esc         = s   => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// ─── Add ──────────────────────────────────────────────
export function addBM() {
  if (!state.pdf) return;
  const si = Math.max(0, state.curSent);
  const wi = Math.max(0, state.curWord);
  const sentence = state.sentences[si];
  const start = sentence?.words?.[wi]?.start || 0;
  const snip = sentence?.text?.slice(start, start + 60) || `Page ${state.curPage}`;
  const label = `Page ${state.curPage} — "${snip}${snip.length >= 60 ? '…' : ''}"`;
  const bms  = getBMs();
  if (bms.find(b => b.page === state.curPage && b.si === si && (b.wi || 0) === wi)) {
    toast('Already bookmarked!'); return;
  }
  bms.push({ page: state.curPage, si, wi, label, ts: Date.now() });
  putBMs(bms);
  toast('Bookmark saved 🔖');
}

// ─── Sheet open / close ───────────────────────────────
export function openBM() {
  const bms   = getBMs();
  const items = document.getElementById('bm-items');
  items.innerHTML = '';

  if (!bms.length) {
    items.innerHTML = '<div id="bm-empty">No bookmarks yet.<br/>Tap 🔖 Save while reading to add one.</div>';
  } else {
    [...bms].reverse().forEach((bm, ri) => {
      const realIdx = bms.length - 1 - ri;

      const row = document.createElement('div');
      row.className = 'bm-row';

      const ico = document.createElement('div');
      ico.className = 'bm-ico'; ico.textContent = '🔖';

      const txt = document.createElement('div');
      txt.className = 'bm-txt';
      txt.innerHTML = `<div class="bm-name">${esc(bm.label)}</div>
        <div class="bm-date">${new Date(bm.ts).toLocaleDateString(undefined,
          { month: 'short', day: 'numeric', year: 'numeric' })}</div>`;

      const del = document.createElement('button');
      del.className = 'bm-del'; del.textContent = '✕';
      del.addEventListener('click', e => { e.stopPropagation(); delBM(realIdx); });

      row.append(ico, txt, del);
      row.addEventListener('click', () => gotoBM(bm));
      items.appendChild(row);
    });
  }
  document.getElementById('bm-bg').classList.add('on');
}

export function closeBM() {
  document.getElementById('bm-bg').classList.remove('on');
}

// ─── Navigate to bookmark ─────────────────────────────
export function gotoBM(bm) {
  closeBM();
  const wasPlaying = state.mode === 'speaking';
  hardStop();

  renderPage(bm.page).then(() => {
    const si    = Math.min(bm.si, state.sentences.length - 1);
    const wi = Math.min(bm.wi || 0, Math.max(0, (state.sentences[si]?.words?.length || 1) - 1));
    state.curSent   = si;
    state.curWord   = wi;
    state.pausePage = bm.page;
    state.pauseSent = si;
    state.pauseWord = wi;
    state.mode      = 'paused';
    const sentence = state.sentences[si];
    const start = sentence?.words?.[wi]?.start || 0;
    clearHL(); drawHL(si, wi); showTicker(sentence?.text?.slice(start) || '');
    savePosition(); updateBtn();
    toast(`Jumped to page ${bm.page}`);
    if (wasPlaying) startFrom(bm.page, si, wi);
  });
}

// ─── Delete ───────────────────────────────────────────
function delBM(i) {
  const bms = getBMs();
  bms.splice(i, 1);
  putBMs(bms);
  openBM(); // refresh the sheet
}

// ─── Export bookmarks and annotations to one JSON file ─
export async function exportBMs() {
  const entries = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || (!key.startsWith('bm:') && !key.startsWith('ann:'))) continue;
    try { entries[key] = JSON.parse(localStorage.getItem(key)); } catch {}
  }
  const json = JSON.stringify({
    format: 'pdf-reader-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: {
      readingSpeed: state.rate,
    },
    entries,
  }, null, 2);

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'pdf-reader-data.json',
        types: [{ description: 'JSON File', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      toast('Reader data exported ✓');
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }

  const file = new File([json], 'pdf-reader-data.json', { type: 'application/json' });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        title: 'PDF Reader backup',
        text: 'Bookmarks, annotations, and reader settings',
        files: [file],
      });
      toast('Reader data exported ✓');
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }

  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Reader data exported ✓');
}

function mergeBookmarks(key, incoming) {
  if (!Array.isArray(incoming)) return 0;
  const existing = getBMsByKey(key);
  let count = 0;
  incoming.forEach(bookmark => {
    if (!existing.find(item => item.page === bookmark.page && item.si === bookmark.si &&
        (item.wi || 0) === (bookmark.wi || 0))) {
      existing.push(bookmark);
      count++;
    }
  });
  localStorage.setItem(key, JSON.stringify(existing));
  return count;
}

function mergeAnnotations(key, incoming) {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return 0;
  let existing = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existing = parsed;
  } catch {}

  let count = 0;
  Object.entries(incoming).forEach(([page, strokes]) => {
    if (!Array.isArray(strokes)) return;
    if (!Array.isArray(existing[page])) existing[page] = [];
    const signatures = new Set(existing[page].map(stroke => stroke.id || JSON.stringify(stroke)));
    strokes.forEach(stroke => {
      if (!stroke || !Array.isArray(stroke.points)) return;
      const signature = stroke.id || JSON.stringify(stroke);
      if (signatures.has(signature)) return;
      existing[page].push(stroke);
      signatures.add(signature);
      count++;
    });
  });
  localStorage.setItem(key, JSON.stringify(existing));
  return count;
}

// Accept both v2.3 backups and older bookmark-only JSON files.
export function importBMs(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = event => {
    try {
      const data = JSON.parse(event.target.result);
      const entries = data?.format === 'pdf-reader-backup' && data.entries
        ? data.entries
        : data;
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
        throw new Error('Invalid backup');
      }

      let bookmarkCount = 0;
      let annotationCount = 0;
      Object.entries(entries).forEach(([key, value]) => {
        if (key.startsWith('bm:')) bookmarkCount += mergeBookmarks(key, value);
        if (key.startsWith('ann:')) annotationCount += mergeAnnotations(key, value);
      });

      const importedSpeed = Number.parseFloat(data?.settings?.readingSpeed);
      const speedImported = Number.isFinite(importedSpeed) && setSpeed(importedSpeed);

      renderAnnotations();
      const speedMessage = speedImported ? `, speed ${state.rate}×` : '';
      toast(`Imported ${bookmarkCount} bookmark(s), ${annotationCount} annotation(s)${speedMessage} ✓`);
      openBM();
    } catch {
      toast('Invalid reader data file');
    }
  };
  reader.readAsText(file);
  input.value = '';
}
