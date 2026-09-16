// Snipbar content script: shows a small action bar under the current text selection.
(() => {
  if (window.__snipbarLoaded) return;
  window.__snipbarLoaded = true;

  const GAP = 8; // distance between selection and bar
  const EDGE = 8; // minimum distance from viewport edges
  const MAX_QUERY = 2000;

  const settings = { ...SNIPBAR_DEFAULTS };
  let currentText = '';
  let suppressedText = null; // text the user already dismissed or acted on; do not re-show for it
  let visible = false;
  let mouseDown = false;
  let pointer = { x: 0, y: 0 };
  let selectionTimer = 0;
  let flashTimer = 0;
  let raf = 0;

  // ---------- UI ----------
  const host = document.createElement('snipbar-host');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; position: fixed; left: 0; top: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none; }
      .bar {
        position: fixed; left: 0; top: 0;
        display: flex; align-items: center; gap: 2px; padding: 3px;
        background: #18181c; color: #f4f4f5;
        border-radius: 10px;
        box-shadow: 0 10px 28px rgba(0, 0, 0, .3), 0 1px 3px rgba(0, 0, 0, .25), inset 0 0 0 1px rgba(255, 255, 255, .08);
        font: 500 12.5px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        letter-spacing: .01em;
        -webkit-font-smoothing: antialiased;
        user-select: none; -webkit-user-select: none;
        pointer-events: auto;
        opacity: 0; visibility: hidden;
        transform: translateY(4px) scale(.97);
        transition: opacity .12s ease, transform .12s ease, visibility 0s linear .12s;
      }
      .bar.show { opacity: 1; visibility: visible; transform: none; transition: opacity .12s ease, transform .12s ease; }
      .bar::before {
        content: ""; position: absolute; width: 10px; height: 10px;
        background: #18181c; border-radius: 2px;
        left: var(--arrow-x, 50%); top: -4px;
        transform: translateX(-50%) rotate(45deg);
        box-shadow: -1px -1px 0 rgba(255, 255, 255, .08);
      }
      .bar.above::before { top: auto; bottom: -4px; box-shadow: 1px 1px 0 rgba(255, 255, 255, .08); }
      button {
        all: unset; position: relative; display: inline-flex; align-items: center; gap: 6px;
        padding: 6px 9px; border-radius: 7px; cursor: pointer; color: inherit;
        white-space: nowrap; line-height: 1;
      }
      button:hover { background: rgba(255, 255, 255, .1); }
      button:active { background: rgba(255, 255, 255, .16); }
      button:focus-visible { outline: 2px solid #ffd60a; outline-offset: -2px; }
      svg { width: 14px; height: 14px; flex: none; }
      .sep { width: 1px; height: 16px; background: rgba(255, 255, 255, .12); margin: 0 1px; }
      .copied { color: #ffd60a; }
    </style>
    <div class="bar" role="toolbar" aria-label="Snipbar">
      <button data-action="copy" title="Copy selection">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
        <span>Copy</span>
      </button>
      <span class="sep"></span>
      <button data-action="search" title="Search selection">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <span data-label="engine">Google</span>
      </button>
      <span class="sep"></span>
      <button data-action="ask" title="Ask about selection">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.2 2.2M16.2 16.2l2.2 2.2M5.6 18.4l2.2-2.2M16.2 7.8l2.2-2.2"/><circle cx="12" cy="12" r="3"/></svg>
        <span data-label="assistant">ChatGPT</span>
      </button>
    </div>`;
  const bar = root.querySelector('.bar');
  const copyBtn = root.querySelector('[data-action="copy"]');
  const copyLabel = copyBtn.querySelector('span');
  const engineLabel = root.querySelector('[data-label="engine"]');
  const assistantLabel = root.querySelector('[data-label="assistant"]');

  function mount() {
    if (!host.isConnected && document.documentElement) document.documentElement.appendChild(host);
  }

  // ---------- Settings ----------
  function applySettings(next) {
    if (next.engine && SNIPBAR_ENGINES[next.engine]) settings.engine = next.engine;
    if (next.assistant && SNIPBAR_ASSISTANTS[next.assistant]) settings.assistant = next.assistant;
    engineLabel.textContent = SNIPBAR_ENGINES[settings.engine].label;
    assistantLabel.textContent = SNIPBAR_ASSISTANTS[settings.assistant].label;
  }
  try {
    chrome.storage.sync.get(SNIPBAR_DEFAULTS, (stored) => applySettings(stored || {}));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      const next = {};
      for (const key of Object.keys(changes)) next[key] = changes[key].newValue;
      applySettings(next);
    });
  } catch {
    applySettings({});
  }

  // ---------- Selection ----------
  function isTextField(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') return /^(text|search|url|tel|email|password|number)?$/i.test(el.type || 'text');
    return false;
  }

  // Returns { text, rect } for the current selection or null when there is nothing to act on.
  function readSelection() {
    const active = document.activeElement;
    if (isTextField(active)) {
      const { selectionStart: s, selectionEnd: e, value } = active;
      if (s == null || e == null || s === e) return null;
      const text = value.slice(Math.min(s, e), Math.max(s, e));
      if (!text.trim()) return null;
      const box = active.getBoundingClientRect();
      // Fields do not expose glyph geometry, so anchor to the pointer when it is inside the field.
      const inside = pointer.x >= box.left && pointer.x <= box.right && pointer.y >= box.top && pointer.y <= box.bottom;
      const rect = inside
        ? { left: pointer.x, right: pointer.x, top: pointer.y, bottom: pointer.y + 14 }
        : box;
      return { text, rect };
    }

    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const text = sel.toString();
    if (!text.trim()) return null;
    const range = sel.getRangeAt(sel.rangeCount - 1);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
    let rect;
    if (rects.length) {
      rect = rects.reduce(
        (acc, r) => ({
          left: Math.min(acc.left, r.left),
          right: Math.max(acc.right, r.right),
          top: Math.min(acc.top, r.top),
          bottom: Math.max(acc.bottom, r.bottom),
        }),
        { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity }
      );
    } else {
      rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) return null;
    }
    return { text, rect };
  }

  function normalize(text) {
    return text.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);
  }

  // ---------- Placement ----------
  function place(rect) {
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = document.documentElement.clientHeight || window.innerHeight;
    const w = bar.offsetWidth;
    const h = bar.offsetHeight;
    const center = (rect.left + rect.right) / 2;

    let left = Math.round(center - w / 2);
    left = Math.max(EDGE, Math.min(left, vw - w - EDGE));

    let top = Math.round(rect.bottom + GAP);
    let above = false;
    if (top + h > vh - EDGE && rect.top - GAP - h >= EDGE) {
      top = Math.round(rect.top - GAP - h);
      above = true;
    }

    const arrow = Math.max(12, Math.min(center - left, w - 12));
    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
    bar.style.setProperty('--arrow-x', `${arrow}px`);
    bar.classList.toggle('above', above);
  }

  function show(found) {
    mount();
    currentText = found.text;
    clearTimeout(flashTimer);
    copyLabel.textContent = 'Copy';
    copyLabel.classList.remove('copied');
    place(found.rect);
    if (!visible) {
      visible = true;
      bar.classList.add('show');
    }
  }

  function hide() {
    if (!visible) return;
    visible = false;
    bar.classList.remove('show');
    bar.classList.remove('above');
  }

  function evaluate(fromPointer = false) {
    const found = readSelection();
    if (fromPointer) suppressedText = null;
    if (found && found.text !== suppressedText) show(found);
    else hide();
  }

  function reposition() {
    if (!visible) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const found = readSelection();
      if (found) place(found.rect);
      else hide();
    });
  }

  // ---------- Actions ----------
  function openTab(url) {
    // A synthetic anchor click opens a background-safe new tab without opener access,
    // and unlike window.open(..., 'noopener') it never leaves a second tab behind.
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        return document.execCommand('copy');
      } catch {
        return false;
      }
    }
  }

  async function run(action) {
    // Prefer the live selection: it can still settle for a few ms after the bar appears.
    const live = readSelection();
    const text = live ? live.text : currentText;
    if (!text) return hide();
    suppressedText = text;
    if (action === 'copy') {
      const ok = await copyText(text);
      copyLabel.textContent = ok ? 'Copied' : 'Failed';
      copyLabel.classList.toggle('copied', ok);
      clearTimeout(flashTimer);
      flashTimer = setTimeout(hide, 700);
      return;
    }
    const q = encodeURIComponent(normalize(text));
    if (action === 'search') openTab(SNIPBAR_ENGINES[settings.engine].url + q);
    if (action === 'ask') openTab(SNIPBAR_ASSISTANTS[settings.assistant].url + q);
    hide();
  }

  bar.addEventListener('mousedown', (e) => e.preventDefault()); // keep the page selection intact
  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn) run(btn.dataset.action);
  });

  // ---------- Page events ----------
  const inBar = (e) => e.composedPath().includes(host);

  document.addEventListener(
    'mousedown',
    (e) => {
      if (inBar(e)) return;
      mouseDown = true;
      pointer = { x: e.clientX, y: e.clientY };
      suppressedText = null;
      hide();
    },
    true
  );
  document.addEventListener(
    'mouseup',
    (e) => {
      if (inBar(e)) return;
      mouseDown = false;
      pointer = { x: e.clientX, y: e.clientY };
      clearTimeout(selectionTimer);
      evaluate(true);
      // Chrome can still adjust the selection right after mouseup; re-check without clearing dismissals.
      selectionTimer = setTimeout(() => evaluate(false), 60);
    },
    true
  );
  document.addEventListener('selectionchange', () => {
    if (mouseDown) return;
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      if (!mouseDown) evaluate(false);
    }, 160);
  });
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && visible) {
        suppressedText = currentText;
        hide();
      }
    },
    true
  );
  window.addEventListener('scroll', reposition, { capture: true, passive: true });
  window.addEventListener('resize', reposition, { passive: true });
  window.addEventListener('blur', hide);

  mount();
})();
