// ─────────────────────────────────────────────────────
// Reading progress and approximate time remaining
// ─────────────────────────────────────────────────────

import { state } from './state.js?v=2.2.2';

const BASE_WORDS_PER_MINUTE = 180;
const FALLBACK_WORDS_PER_PAGE = 250;

function activeSentences() {
  return (state.ttsPage && state.ttsPage !== state.curPage)
    ? state.ttsSentences
    : state.sentences;
}

function positionFraction() {
  if (state.readingFinished) return 1;
  if (!state.pdf || !state.numPages) return 0;
  const page = state.ttsPage ?? state.curPage;
  const sentences = activeSentences();
  let withinPage = 0;
  if (sentences.length && state.curSent >= 0) {
    const si = Math.min(state.curSent, sentences.length - 1);
    const words = sentences[si]?.words || [];
    const withinSentence = words.length
      ? Math.min(1, Math.max(0, state.curWord) / words.length)
      : 0;
    withinPage = (si + withinSentence) / sentences.length;
  }
  return Math.min(1, Math.max(0, ((page - 1) + withinPage) / state.numPages));
}

function exactWordProgress() {
  if (state.readingFinished) return 1;
  if (state.scannedPages !== state.numPages || !state.totalWords) return null;
  const page = state.ttsPage ?? state.curPage;
  const before = state.pageWordCounts
    .slice(0, Math.max(0, page - 1))
    .reduce((sum, count) => sum + (count || 0), 0);
  const sentences = activeSentences();
  let onPage = 0;
  for (let i = 0; i < Math.max(0, state.curSent); i++) {
    onPage += sentences[i]?.words?.length || 0;
  }
  onPage += Math.max(0, state.curWord);
  return Math.min(1, Math.max(0, (before + onPage) / state.totalWords));
}

function formatRemaining(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return '<1 min remaining';
  const rounded = Math.max(1, Math.round(minutes));
  if (rounded < 60) return `~${rounded} min remaining`;
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return mins ? `~${hours} hr ${mins} min remaining` : `~${hours} hr remaining`;
}

export function updateProgress() {
  const wrap = document.getElementById('reading-progress');
  const fill = document.getElementById('progress-fill');
  const percentEl = document.getElementById('progress-percent');
  const remainingEl = document.getElementById('progress-remaining');
  if (!wrap || !fill || !percentEl || !remainingEl) return;

  if (!state.pdf) {
    wrap.classList.remove('on');
    return;
  }
  wrap.classList.add('on');

  const exact = exactWordProgress();
  const fraction = exact ?? positionFraction();
  const percent = Math.round(fraction * 100);
  fill.style.width = `${percent}%`;
  wrap.setAttribute('aria-valuenow', String(percent));
  percentEl.textContent = `${percent}%`;

  const average = state.scannedPages
    ? state.totalWords / state.scannedPages
    : FALLBACK_WORDS_PER_PAGE;
  const estimatedTotal = exact !== null
    ? state.totalWords
    : average * state.numPages;
  const remainingWords = Math.max(0, estimatedTotal * (1 - fraction));
  const minutes = remainingWords / (BASE_WORDS_PER_MINUTE * state.rate);
  remainingEl.textContent = fraction >= 1 ? 'Complete' : formatRemaining(minutes);
}

export async function startProgressScan() {
  const scanId = ++state.progressScanId;
  state.pageWordCounts = Array(state.numPages).fill(null);
  state.totalWords = 0;
  state.scannedPages = 0;
  updateProgress();

  for (let pageNumber = 1; pageNumber <= state.numPages; pageNumber++) {
    if (scanId !== state.progressScanId || !state.pdf) return;
    try {
      const page = await state.pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = textContent.items.map(item => item.str || '').join(' ');
      const count = (text.match(/\S+/g) || []).length;
      state.pageWordCounts[pageNumber - 1] = count;
      state.totalWords += count;
    } catch {
      state.pageWordCounts[pageNumber - 1] = 0;
    }
    state.scannedPages += 1;
    updateProgress();

    if (pageNumber % 5 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
}
