export type EditorMode =
  | "markdown"
  | "json"
  | "csv"
  | "yaml"
  | "toml"
  | "convert"
  | "jwt"
  | "devtools";

const STORAGE_KEY = "karasu-editor-mode";

const VALID_MODES: EditorMode[] = [
  "markdown",
  "json",
  "csv",
  "yaml",
  "toml",
  "convert",
  "jwt",
  "devtools",
];

function parseStoredMode(): EditorMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && VALID_MODES.includes(stored as EditorMode)) {
    return stored as EditorMode;
  }
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
