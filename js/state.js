// ─────────────────────────────────────────────────────
// Shared application state
// All modules import this object and mutate its properties directly.
// ─────────────────────────────────────────────────────

export const PAGE_SCALE = 2;

export const state = {
  pdf:           null,
  numPages:      0,
  fileName:      '',
  curPage:       1,
  viewport:      null,
  sentences:     [],
  sentRects:     [],
  curSent:       -1,
  mode:          'stopped',   // 'stopped' | 'speaking' | 'paused'
  pausePage:     1,
  pauseSent:     0,
  rate:          1.0,
  voice:         null,
  pendingResume: null,
  fitWidth:      false,
};
