import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { invalidatePreviewCache, renderMarkdownToHtml } from "./markdown";
import { initDisplaySettings } from "./settings";
import { initSidebarLayout } from "./sidebar-layout";
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
const saveStatusEl = document.querySelector("#save-status") as HTMLElement;
const errorBanner = document.querySelector("#error-banner") as HTMLElement;
const btnOpen = document.querySelector("#btn-open") as HTMLButtonElement;
const btnToggleView = document.querySelector("#btn-toggle-view") as HTMLButtonElement;

let sidebarControls: SidebarControls | null = null;

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

function updateSaveStatus() {
  const unsaved = isDirty();
  state.saveStatus = unsaved ? "unsaved" : "saved";
  saveStatusEl.textContent = unsaved ? "未保存" : "保存済み";
  saveStatusEl.classList.toggle("save-status--unsaved", unsaved);
  saveStatusEl.classList.toggle("save-status--saved", !unsaved);
}

function updateFileName() {
  fileNameEl.textContent = state.path ? fileBaseName(state.path) : "未選択";
}

function renderPreview() {
  try {
    preview.innerHTML = renderMarkdownToHtml(state.content);
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
    renderPreview();
  }
}

function syncEditorFromState() {
  if (editor.value !== state.content) {
    editor.value = state.content;
  }
  updateFileName();
  updateSaveStatus();
  applyView();
}

async function loadFile(path: string) {
  const result = await invoke<FileContent>("read_file", { path });
  state.path = result.path;
  state.content = result.content;
  state.savedContent = result.content;
  invalidatePreviewCache();
  syncEditorFromState();
  clearError();
  await sidebarControls?.highlightActiveFile();
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
    filters: [
      {
        name: "Markdown",
        extensions: ["md", "markdown", "mdown", "mkd", "txt"],
      },
    ],
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
  } catch (e) {
    showError(String(e));
    updateSaveStatus();
  }
}

function toggleView() {
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
  if (key === "s") {
    e.preventDefault();
    void saveFile();
  } else if (key === "o") {
    e.preventDefault();
    void openFileDialog();
  } else if (key === "p") {
    e.preventDefault();
    toggleView();
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

btnOpen.addEventListener("click", () => void openFileDialog());
btnToggleView.addEventListener("click", toggleView);
editor.addEventListener("input", onEditorInput);
window.addEventListener("keydown", onKeyDown);

window.addEventListener("DOMContentLoaded", () => {
  initSidebarLayout();
  initDisplaySettings();
  sidebarControls = initSidebar({
    getActivePath: () => state.path,
    isDirty,
    openFile: openFileWithGuard,
  });
  syncEditorFromState();
  void restoreRecentOnStartup();
});
