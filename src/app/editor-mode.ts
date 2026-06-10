export type EditorMode = "markdown" | "json";

const STORAGE_KEY = "karasu-editor-mode";

let mode: EditorMode =
  localStorage.getItem(STORAGE_KEY) === "json" ? "json" : "markdown";
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
