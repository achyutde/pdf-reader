// ─────────────────────────────────────────────────────
// Bookmark management: add, list, navigate, delete,
// export to JSON file, import from JSON file
// ─────────────────────────────────────────────────────

import { state } from './state.js';
import { renderPage, clearHL, drawHL, showTicker, savePosition } from './pdf.js';
import { hardStop, startFrom, updateBtn } from './speech.js';
import { toast } from './ui.js';

// ─── Storage helpers ──────────────────────────────────
const bmKey       = ()  => 'bm:' + state.fileName;
const getBMs      = ()  => { try { return JSON.parse(localStorage.getItem(bmKey()) || '[]'); } catch { return []; } };
const getBMsByKey = k   => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
const putBMs      = bms => localStorage.setItem(bmKey(), JSON.stringify(bms));
const esc         = s   => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// ─── Add ──────────────────────────────────────────────
export function addBM() {
  if (!state.pdf) return;
  const si   = Math.max(0, state.curSent);
  const snip = state.sentences[si]?.text?.slice(0, 60) || `Page ${state.curPage}`;
  const label = `Page ${state.curPage} — "${snip}${snip.length >= 60 ? '…' : ''}"`;
  const bms  = getBMs();
  if (bms.find(b => b.page === state.curPage && b.si === si)) {
    toast('Already bookmarked!'); return;
  }
  bms.push({ page: state.curPage, si, label, ts: Date.now() });
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
    state.curSent   = si;
    state.pausePage = bm.page;
    state.pauseSent = si;
    state.mode      = 'paused';
    clearHL(); drawHL(si); showTicker(state.sentences[si]?.text || '');
    savePosition(); updateBtn();
    toast(`Jumped to page ${bm.page}`);
    if (wasPlaying) startFrom(bm.page, si);
  });
}

// ─── Delete ───────────────────────────────────────────
function delBM(i) {
  const bms = getBMs();
  bms.splice(i, 1);
  putBMs(bms);
  openBM(); // refresh the sheet
}

// ─── Export (Save As dialog → JSON) ──────────────────
export async function exportBMs() {
  const all = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('bm:')) {
      try { all[k] = JSON.parse(localStorage.getItem(k)); } catch {}
    }
  }
  if (!Object.keys(all).length) { toast('No bookmarks to export'); return; }
  const json = JSON.stringify(all, null, 2);

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'pdf-reader-bookmarks.json',
        types: [{ description: 'JSON File', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      toast('Bookmarks exported ✓');
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }

  // Fallback for Firefox / Safari
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'pdf-reader-bookmarks.json'; a.click();
  URL.revokeObjectURL(url);
  toast('Bookmarks exported ✓');
}

// ─── Import (merge, no duplicates) ───────────────────
export function importBMs(input) {
  const f = input.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      let count = 0;
      Object.entries(data).forEach(([k, v]) => {
        if (!k.startsWith('bm:') || !Array.isArray(v)) return;
        const existing = getBMsByKey(k);
        const merged   = [...existing];
        v.forEach(bm => {
          if (!merged.find(e => e.page === bm.page && e.si === bm.si)) {
            merged.push(bm); count++;
          }
        });
        localStorage.setItem(k, JSON.stringify(merged));
      });
      toast(`Imported ${count} new bookmark(s) ✓`);
      openBM();
    } catch {
      toast('Invalid bookmark file');
    }
  };
  r.readAsText(f);
  input.value = '';
}
