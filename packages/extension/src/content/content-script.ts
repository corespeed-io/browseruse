/**
 * Content script — runs in every page, provides visual feedback only.
 *
 * DOM manipulation is now handled via CDP (chrome.debugger) instead of
 * content script messaging. This script only handles visual overlays:
 * - Ghost cursor: SVG arrow pointer with smooth CSS transition movement and
 *   press-down scale animation (two-element: outer=translate, inner=scale).
 * - Element highlight: four 1px edge divs with translucent fill overlay,
 *   positioned via getBoundingClientRect.
 * - Click ripple effect.
 *
 * Listens for visual.showCursor, visual.highlight, visual.click messages
 * from the service worker.
 */

// ---------------------------------------------------------------------------
// Ghost cursor (Playwriter-style two-element cursor)
// ---------------------------------------------------------------------------

const CURSOR_COLOR = '#3B82F6';
const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.85a.5.5 0 0 0-.85.36Z" fill="white" stroke="${CURSOR_COLOR}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CURSOR_DATA_URL = `url("data:image/svg+xml,${encodeURIComponent(CURSOR_SVG)}")`;

let cursorOuter: HTMLDivElement | null = null;
let cursorInner: HTMLDivElement | null = null;
let cursorX = 0;
let cursorY = 0;
let cursorVisible = false;
let cursorHideTimer: ReturnType<typeof setTimeout> | null = null;

function ensureCursor(): { outer: HTMLDivElement; inner: HTMLDivElement } {
  if (cursorOuter && cursorInner && document.documentElement.contains(cursorOuter)) {
    return { outer: cursorOuter, inner: cursorInner };
  }

  const outer = document.createElement('div');
  outer.id = '__browseruse_ghost_cursor__';
  Object.assign(outer.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    pointerEvents: 'none',
    zIndex: '2147483647',
    transitionProperty: 'transform',
    transitionTimingFunction: 'cubic-bezier(0.65, 0, 0.35, 1)', // easeInOutCubic
    willChange: 'transform',
    opacity: '0',
    transform: 'translate3d(0px, 0px, 0)',
  });

  const inner = document.createElement('div');
  Object.assign(inner.style, {
    width: '24px',
    height: '24px',
    backgroundImage: CURSOR_DATA_URL,
    backgroundSize: 'contain',
    backgroundRepeat: 'no-repeat',
    filter: 'drop-shadow(0 1px 3px rgba(0, 0, 0, 0.35))',
    transitionProperty: 'transform, opacity',
    transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
    transitionDuration: '140ms',
    transform: 'scale(1)',
  });

  outer.appendChild(inner);
  document.documentElement.appendChild(outer);

  cursorOuter = outer;
  cursorInner = inner;
  return { outer, inner };
}

function moveCursorTo(x: number, y: number, animate: boolean): void {
  const { outer } = ensureCursor();

  if (!cursorVisible) {
    // Teleport (no transition) on first appearance
    outer.style.transitionDuration = '0ms';
    outer.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    outer.style.opacity = '1';
    cursorVisible = true;
    cursorX = x;
    cursorY = y;
    // Force reflow then allow transitions
    outer.offsetHeight;
    return;
  }

  if (animate) {
    const dist = Math.hypot(x - cursorX, y - cursorY);
    const duration = Math.min(Math.max(dist / 1.2, 200), 1200);
    outer.style.transitionDuration = `${Math.round(duration)}ms`;
  } else {
    outer.style.transitionDuration = '0ms';
  }

  outer.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  outer.style.opacity = '1';
  cursorX = x;
  cursorY = y;

  // Auto-hide after 5s of inactivity
  if (cursorHideTimer) clearTimeout(cursorHideTimer);
  cursorHideTimer = setTimeout(() => {
    if (cursorOuter) {
      cursorOuter.style.transitionDuration = '600ms';
      cursorOuter.style.opacity = '0';
      cursorVisible = false;
    }
  }, 5000);
}

function pressDown(): void {
  const { inner } = ensureCursor();
  inner.style.transform = 'scale(0.92)';
}

function pressUp(): void {
  const { inner } = ensureCursor();
  inner.style.transform = 'scale(1)';
}

function showClickAt(x: number, y: number): void {
  moveCursorTo(x, y, true);
  // Wait for cursor to arrive, then animate press
  const dist = Math.hypot(x - cursorX, y - cursorY);
  const moveDuration = Math.min(Math.max(dist / 1.2, 200), 1200);
  setTimeout(() => {
    pressDown();
    setTimeout(() => pressUp(), 140);
  }, moveDuration + 20);

  // Also show a ripple at the click point
  showRipple(x, y);
}

function showRipple(x: number, y: number): void {
  const ripple = document.createElement('div');
  Object.assign(ripple.style, {
    position: 'fixed',
    left: `${x - 10}px`,
    top: `${y - 10}px`,
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    border: `2px solid ${CURSOR_COLOR}`,
    background: 'transparent',
    zIndex: '2147483646',
    pointerEvents: 'none',
    transition: 'transform 0.4s cubic-bezier(0.23, 1, 0.32, 1), opacity 0.4s ease-out',
    transform: 'scale(1)',
    opacity: '0.8',
  });
  document.documentElement.appendChild(ripple);

  requestAnimationFrame(() => {
    ripple.style.transform = 'scale(3)';
    ripple.style.opacity = '0';
  });

  setTimeout(() => ripple.remove(), 500);
}

// ---------------------------------------------------------------------------
// Element highlight overlay (Playwriter-style edge divs)
// ---------------------------------------------------------------------------

const EDGE_COLOR = 'rgba(59, 130, 246, 0.75)';
const FILL_COLOR = 'rgba(59, 130, 246, 0.06)';
const HIGHLIGHT_DURATION_MS = 1000;

let overlayContainer: HTMLDivElement | null = null;
let overlayHideTimer: ReturnType<typeof setTimeout> | null = null;

function ensureOverlay(): HTMLDivElement {
  if (overlayContainer && document.documentElement.contains(overlayContainer)) {
    return overlayContainer;
  }

  const container = document.createElement('div');
  container.id = '__browseruse_overlay__';
  Object.assign(container.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483646',
    background: FILL_COLOR,
    display: 'none',
    transition: 'opacity 0.2s ease-out',
    opacity: '1',
  });

  // Four 1px edge divs for crisp highlighting
  const edges = [
    { top: '0', left: '0', width: '100%', height: '1px' },  // top
    { top: '0', right: '0', width: '1px', height: '100%' }, // right
    { bottom: '0', left: '0', width: '100%', height: '1px' }, // bottom
    { top: '0', left: '0', width: '1px', height: '100%' },  // left
  ];

  for (const pos of edges) {
    const edge = document.createElement('div');
    Object.assign(edge.style, {
      position: 'absolute',
      background: EDGE_COLOR,
      ...pos,
    });
    container.appendChild(edge);
  }

  document.documentElement.appendChild(container);
  overlayContainer = container;
  return container;
}

function highlightRect(x: number, y: number, width: number, height: number): void {
  const container = ensureOverlay();

  Object.assign(container.style, {
    top: `${y}px`,
    left: `${x}px`,
    width: `${width}px`,
    height: `${height}px`,
    display: 'block',
    opacity: '1',
  });

  if (overlayHideTimer) clearTimeout(overlayHideTimer);
  overlayHideTimer = setTimeout(() => {
    container.style.opacity = '0';
    setTimeout(() => { container.style.display = 'none'; }, 200);
  }, HIGHLIGHT_DURATION_MS);
}

// ---------------------------------------------------------------------------
// Message listener — visual commands only
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { method, params } = message;
  if (!method) return false;

  switch (method) {
    case 'visual.showCursor':
      moveCursorTo(params.x, params.y, params.animate ?? true);
      sendResponse({ ok: true });
      return true;

    case 'visual.highlight':
      highlightRect(params.x, params.y, params.width, params.height);
      sendResponse({ ok: true });
      return true;

    case 'visual.click':
      showClickAt(params.x, params.y);
      sendResponse({ ok: true });
      return true;

    default:
      return false;
  }
});
