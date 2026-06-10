import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { renderMermaidIn } from "./mermaid-preview";
import { invalidatePreviewCache, renderMarkdownToHtml } from "./markdown";
import {
  getFileWatchEnabled,
  initDisplaySettings,
  onFileWatchSettingChange,
} from "./settings";
import {
  restoreScrollPosition,
  saveScrollPosition,
} from "./session-state";
import { initSidebarLayout, toggleSidebar } from "./sidebar-layout";
import { initSidebar, type SidebarControls } from "./sidebar";

type ViewMode = "edit" | "preview";
type SaveStatus = "saved" | "unsaved";

interface FileContent {
  path: string;
  content: string;
}

interface AppState {
  path: string | null;
  content: string;
  savedContent: string;
  view: ViewMode;
  saveStatus: SaveStatus;
}

const state: AppState = {
  path: null,
  content: "",
  savedContent: "",
  view: "edit",
  saveStatus: "saved",
};

const editor = document.querySelector("#editor") as HTMLTextAreaElement;
const preview = document.querySelector("#preview") as HTMLElement;
const fileNameEl = document.querySelector("#file-name") as HTMLElement;
const filePathEl = document.querySelector("#file-path") as HTMLElement;
const saveStatusEl = document.querySelector("#save-status") as HTMLElement;
const errorBanner = document.querySelector("#error-banner") as HTMLElement;
const btnOpen = document.querySelector("#btn-open") as HTMLButtonElement;
const btnSaveAs = document.querySelector("#btn-save-as") as HTMLButtonElement;
const btnToggleView = document.querySelector("#btn-toggle-view") as HTMLButtonElement;

const MARKDOWN_FILTERS = [
  {
    name: "Markdown",
    extensions: ["md", "markdown", "mdown", "mkd", "txt"],
  },
];

let sidebarControls: SidebarControls | null = null;
let savedSelection: { start: number; end: number } | null = null;
let lastRenderedPreviewContent: string | null = null;

function fileBaseName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function isDirty(): boolean {
  return state.content !== state.savedContent;
}

function showError(message: string) {
  errorBanner.textContent = message;
  errorBanner.hidden = false;
}

function clearError() {
  errorBanner.textContent = "";
  errorBanner.hidden = true;
}

function updateWindowTitle() {
  const appWindow = getCurrentWebviewWindow();
  if (!state.path) {
    void appWindow.setTitle("Karasu");
    return;
  }
  const name = fileBaseName(state.path);
  const prefix = isDirty() ? "• " : "";
  void appWindow.setTitle(`${prefix}${name} - Karasu`);
}

function updateSaveStatus() {
  const unsaved = isDirty();
  state.saveStatus = unsaved ? "unsaved" : "saved";
  saveStatusEl.textContent = unsaved ? "未保存" : "保存済み";
  saveStatusEl.classList.toggle("save-status--unsaved", unsaved);
  saveStatusEl.classList.toggle("save-status--saved", !unsaved);
  updateWindowTitle();
}

function updateFileName() {
  fileNameEl.textContent = state.path ? fileBaseName(state.path) : "未選択";
}

function updateFilePath() {
  if (!state.path) {
    filePathEl.hidden = true;
    filePathEl.textContent = "";
    filePathEl.removeAttribute("title");
    return;
  }
  filePathEl.hidden = false;
  filePathEl.textContent = state.path;
  filePathEl.title = state.path;
}

function persistScrollBeforeSwitch() {
  if (!state.path) return;
  saveScrollPosition(state.path, editor.scrollTop, preview.scrollTop);
}

async function renderPreview() {
  if (lastRenderedPreviewContent === state.content) {
    return;
  }
  try {
    preview.innerHTML = renderMarkdownToHtml(state.content);
    await renderMermaidIn(preview);
    lastRenderedPreviewContent = state.content;
    clearError();
  } catch {
    showError("Markdown の変換に失敗しました");
  }
}

function applyView() {
  const editing = state.view === "edit";
  editor.hidden = !editing;
  preview.hidden = editing;
  btnToggleView.textContent = editing ? "プレビュー" : "編集";
  btnToggleView.setAttribute(
    "aria-label",
    editing ? "プレビュー表示に切り替え" : "編集画面に切り替え",
  );
  if (!editing) {
    void renderPreview().then(() => {
      if (state.path) {
        restoreScrollPosition(state.path, editor, preview);
      }
    });
  } else if (savedSelection) {
    const { start, end } = savedSelection;
    savedSelection = null;
    requestAnimationFrame(() => {
      editor.focus();
      editor.setSelectionRange(start, end);
      if (state.path) {
        restoreScrollPosition(state.path, editor, preview);
      }
    });
  }
}

function syncEditorFromState() {
  if (editor.value !== state.content) {
    editor.value = state.content;
  }
  updateFileName();
  updateFilePath();
  updateSaveStatus();
  applyView();
}

async function loadFile(path: string) {
  persistScrollBeforeSwitch();
  const result = await invoke<FileContent>("read_file", { path });
  state.path = result.path;
  state.content = result.content;
  state.savedContent = result.content;
  invalidatePreviewCache();
  lastRenderedPreviewContent = null;
  syncEditorFromState();
  clearError();
  await sidebarControls?.highlightActiveFile();
  await sidebarControls?.refreshRecentList();
  if (state.path) {
    restoreScrollPosition(state.path, editor, preview);
  }
}

function confirmDiscard(): boolean {
  if (!isDirty()) return true;
  return window.confirm(
    "未保存の変更があります。破棄して別のファイルを開きますか？",
  );
}

async function openFileWithGuard(path: string) {
  if (!confirmDiscard()) return;
  try {
    await loadFile(path);
  } catch (e) {
    showError(String(e));
  }
}

async function openFileDialog() {
  const selected = await open({
    multiple: false,
    filters: MARKDOWN_FILTERS,
  });
  if (selected === null || Array.isArray(selected)) return;
  const path =
    typeof selected === "string" ? selected : (selected as { path: string }).path;
  await openFileWithGuard(path);
}

async function saveFile() {
  if (!state.path) {
    showError("保存先のファイルがありません。先にファイルを開いてください。");
    return;
  }
  try {
    await invoke("write_file", {
      path: state.path,
      content: state.content,
    });
    state.savedContent = state.content;
    updateSaveStatus();
    clearError();
    await sidebarControls?.refreshRecentList();
  } catch (e) {
    showError(String(e));
    updateSaveStatus();
  }
}

async function saveFileAs() {
  const selected = await save({
    filters: MARKDOWN_FILTERS,
    defaultPath: state.path ?? undefined,
  });
  if (selected === null) return;
  const path =
    typeof selected === "string" ? selected : (selected as { path: string }).path;
  try {
    await invoke("write_file", { path, content: state.content });
    state.path = path;
    state.savedContent = state.content;
    invalidatePreviewCache();
    lastRenderedPreviewContent = null;
    syncEditorFromState();
    clearError();
    await sidebarControls?.highlightActiveFile();
    await sidebarControls?.refreshRecentList();
  } catch (e) {
    showError(String(e));
  }
}

function toggleView() {
  if (state.view === "edit") {
    savedSelection = {
      start: editor.selectionStart,
      end: editor.selectionEnd,
    };
  } else {
    invalidatePreviewCache();
  }
  state.view = state.view === "edit" ? "preview" : "edit";
  applyView();
}

function onEditorInput() {
  state.content = editor.value;
  invalidatePreviewCache();
  updateSaveStatus();
}

function isModKey(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey;
}

function onKeyDown(e: KeyboardEvent) {
  if (!isModKey(e)) return;
  const key = e.key.toLowerCase();
  if (key === "s" && e.shiftKey) {
    e.preventDefault();
    void saveFileAs();
  } else if (key === "s") {
    e.preventDefault();
    void saveFile();
  } else if (key === "o" && e.shiftKey) {
    e.preventDefault();
    void sidebarControls?.pickWorkspaceFolder();
  } else if (key === "o") {
    e.preventDefault();
    void openFileDialog();
  } else if (key === "p") {
    e.preventDefault();
    toggleView();
  } else if (key === "b" && !e.shiftKey) {
    e.preventDefault();
    toggleSidebar();
  }
}

async function restoreRecentOnStartup() {
  const recent = await invoke<string | null>("get_recent_path");
  if (!recent) return;
  try {
    await loadFile(recent);
  } catch (e) {
    showError(`最近のファイルを開けませんでした: ${e}`);
  }
}

function initPreviewLinkHandler() {
  preview.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest("a");
    if (!target || !(target instanceof HTMLAnchorElement)) return;
    const href = target.getAttribute("href");
    if (!href || (!href.startsWith("http://") && !href.startsWith("https://"))) {
      return;
    }
    e.preventDefault();
    void openUrl(href);
  });
}

async function syncWorkspaceWatch() {
  const root = sidebarControls?.getWorkspaceRoot() ?? null;
  await invoke("set_workspace_watch", {
    enabled: getFileWatchEnabled(),
    path: root,
  });
}

btnOpen.addEventListener("click", () => void openFileDialog());
btnSaveAs.addEventListener("click", () => void saveFileAs());
btnToggleView.addEventListener("click", toggleView);
editor.addEventListener("input", onEditorInput);
window.addEventListener("keydown", onKeyDown);
initPreviewLinkHandler();

onFileWatchSettingChange(() => {
  void syncWorkspaceWatch();
});

window.addEventListener("DOMContentLoaded", () => {
  initSidebarLayout();
  initDisplaySettings();
  sidebarControls = initSidebar({
    getActivePath: () => state.path,
    isDirty,
    openFile: openFileWithGuard,
    getFileWatchEnabled,
    onWorkspaceChanged: () => {
      void syncWorkspaceWatch();
    },
  });
  syncEditorFromState();
  void restoreRecentOnStartup();
});
