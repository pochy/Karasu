const SCROLL_KEY = "karasu-scroll-positions";

interface ScrollEntry {
  editor: number;
  preview: number;
}

type ScrollStore = Record<string, ScrollEntry>;

function readStore(): ScrollStore {
  try {
    const raw = localStorage.getItem(SCROLL_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as ScrollStore;
  } catch {
    return {};
  }
}

function writeStore(store: ScrollStore): void {
  localStorage.setItem(SCROLL_KEY, JSON.stringify(store));
}

export function saveScrollPosition(
  path: string,
  editorScroll: number,
  previewScroll: number,
): void {
  const store = readStore();
  store[path] = { editor: editorScroll, preview: previewScroll };
  writeStore(store);
}

export function restoreScrollPosition(
  path: string,
  editor: HTMLElement,
  preview: HTMLElement,
): void {
  const entry = readStore()[path];
  if (!entry) return;
  requestAnimationFrame(() => {
    editor.scrollTop = entry.editor;
    preview.scrollTop = entry.preview;
  });
}
