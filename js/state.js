// ─────────────────────────────────────────────────────
// Shared application state
// All modules import this object and mutate its properties directly.
// ─────────────────────────────────────────────────────

export const PAGE_SCALE = 2;
export const HIGHLIGHT_WORDS = 3;

export const state = {
  pdf:           null,
  numPages:      0,
  fileName:      '',
  curPage:       1,
  viewport:      null,
  sentences:     [],
  sentRects:     [],
  curSent:       -1,
  curWord:       0,
  mode:          'stopped',   // 'stopped' | 'speaking' | 'paused'
  pausePage:     1,
  pauseSent:     0,
  pauseWord:     0,
  rate:          1.0,
  voice:         null,
  pendingResume: null,
  fitWidth:      false,
  ttsPage:       null, // null = in sync with curPage; otherwise = page TTS is reading
  ttsSentences:  [],   // sentence data for the TTS page when pages differ
};
