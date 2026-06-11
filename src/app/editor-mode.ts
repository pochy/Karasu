export type EditorMode = "markdown" | "json" | "csv";

const STORAGE_KEY = "karasu-editor-mode";

function parseStoredMode(): EditorMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "json" || stored === "csv") return stored;
  return "markdown";
}

let mode: EditorMode = parseStoredMode();
const listeners: Array<(mode: EditorMode) => void> = [];

export function getEditorMode(): EditorMode {
  return mode;
}

export function setEditorMode(next: EditorMode): void {
  if (next === mode) return;
  mode = next;
  localStorage.setItem(STORAGE_KEY, mode);
  for (const fn of listeners) fn(mode);
}

export function onEditorModeChange(listener: (mode: EditorMode) => void): void {
  listeners.push(listener);
}
