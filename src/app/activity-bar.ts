import {
  getEditorMode,
  onEditorModeChange,
  setEditorMode,
  type EditorMode,
} from "./editor-mode";

const MARKDOWN_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM8 12h8v2H8v-2zm0 4h5v2H8v-2z"/></svg>`;
const JSON_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M8 6a2 2 0 0 0-2 2v1H5a1 1 0 1 0 0 2h1v1a2 2 0 1 0 2 0v-1h1a1 1 0 1 0 0-2H8V8a2 2 0 0 0-2-2zm8 0a2 2 0 0 0-2 2v1h-1a1 1 0 1 0 0 2h1v1a2 2 0 1 0 2 0v-1h1a1 1 0 1 0 0-2h-1V8a2 2 0 0 0-2-2zM7 17a1 1 0 0 1 1-1h8a1 1 0 1 1 0 2H8a1 1 0 0 1-1-1z"/></svg>`;
const CSV_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M4 4h16v2H4V4zm0 4h16v2H4V8zm0 4h10v2H4v-2zm0 4h10v2H4v-2zm12-4h4v2h-4v-2zm0 4h4v2h-4v-2z"/></svg>`;

function applyMode(mode: EditorMode): void {
  const workspace = document.querySelector("#workspace") as HTMLElement;
  workspace.dataset.editorMode = mode;

  document.querySelectorAll<HTMLButtonElement>("[data-editor-mode]").forEach((btn) => {
    const isActive = btn.dataset.editorMode === mode;
    btn.classList.toggle("activity-bar-btn--active", isActive);
    btn.setAttribute("aria-current", isActive ? "page" : "false");
  });
}

export function initActivityBar(): void {
  const bar = document.querySelector("#activity-bar") as HTMLElement;

  const modes: Array<{ mode: EditorMode; label: string; icon: string }> = [
    { mode: "markdown", label: "Markdown", icon: MARKDOWN_ICON },
    { mode: "json", label: "JSON", icon: JSON_ICON },
    { mode: "csv", label: "CSV", icon: CSV_ICON },
  ];

  for (const { mode, label, icon } of modes) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "activity-bar-btn";
    btn.dataset.editorMode = mode;
    btn.title = label;
    btn.setAttribute("aria-label", `${label} エディタ`);
    btn.innerHTML = icon;
    btn.addEventListener("click", () => setEditorMode(mode));
    bar.appendChild(btn);
  }

  applyMode(getEditorMode());
  onEditorModeChange(applyMode);
}
