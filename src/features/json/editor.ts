import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { EditorController, EditorHost } from "../../core/editor-controller";
import { renderJsonTree } from "./tree-view";
import {
  restoreScrollPosition,
  saveScrollPosition,
} from "../../core/session-state";

type JsonViewMode = "edit" | "tree";

const JSON_FILTERS = [{ name: "JSON", extensions: ["json", "jsonc"] }];
const JSON_EXTENSIONS = [".json", ".jsonc"];

function fileBaseName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function isJsonPath(path: string): boolean {
  const lower = path.toLowerCase();
  return JSON_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isModKey(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey;
}

function validateJson(text: string): string | null {
  if (!text.trim()) return null;
  try {
    JSON.parse(text);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export function createJsonEditor(host: EditorHost): EditorController {
  const screen = document.querySelector("#json-screen") as HTMLElement;
  const editor = document.querySelector("#json-editor") as HTMLTextAreaElement;
  const treeEl = document.querySelector("#json-tree") as HTMLElement;
  const btnFormat = document.querySelector("#btn-json-format") as HTMLButtonElement;
  const btnTree = document.querySelector("#btn-json-tree") as HTMLButtonElement;

  let path: string | null = null;
  let content = "";
  let savedContent = "";
  let view: JsonViewMode = "edit";
  let lastRenderedTreeContent: string | null = null;
  let savedSelection: { start: number; end: number } | null = null;
  let active = false;

  const isDirty = () => content !== savedContent;

  const syncStatus = () => {
    host.setStatus({
      path,
      fileName: path ? fileBaseName(path) : "未選択",
      dirty: isDirty(),
    });
  };

  function renderTree() {
    if (lastRenderedTreeContent === content) return;
    const parseError = renderJsonTree(treeEl, content);
    if (parseError) {
      host.showError(`JSON の構文エラー: ${parseError}`);
    } else {
      host.clearError();
    }
    lastRenderedTreeContent = content;
  }

  function applyView() {
    const editing = view === "edit";
    editor.hidden = !editing;
    treeEl.hidden = editing;
    btnTree.textContent = editing ? "ツリー" : "編集";
    btnTree.setAttribute(
      "aria-label",
      editing ? "ツリー表示に切り替え" : "編集画面に切り替え",
    );
    if (!editing) {
      renderTree();
    } else if (savedSelection) {
      const { start, end } = savedSelection;
      savedSelection = null;
      requestAnimationFrame(() => {
        editor.focus();
        editor.setSelectionRange(start, end);
      });
    }
  }

  function syncEditorFromState() {
    if (editor.value !== content) editor.value = content;
    lastRenderedTreeContent = null;
    if (view === "edit") {
      const parseError = validateJson(content);
      if (parseError) {
        host.showError(`JSON の構文エラー: ${parseError}`);
      } else {
        host.clearError();
      }
    }
    applyView();
    syncStatus();
  }

  function persistScroll() {
    if (!path) return;
    saveScrollPosition(path, editor.scrollTop, 0);
  }

  async function loadFile(filePath: string) {
    persistScroll();
    const result = await invoke<{ path: string; content: string }>("read_file", {
      path: filePath,
    });
    path = result.path;
    content = result.content;
    savedContent = result.content;
    lastRenderedTreeContent = null;
    syncEditorFromState();
    if (path) restoreScrollPosition(path, editor, editor);
  }

  function confirmDiscard(): boolean {
    if (!isDirty()) return true;
    return window.confirm(
      "未保存の変更があります。破棄して別のファイルを開きますか？",
    );
  }

  function formatJson() {
    const parseError = validateJson(content);
    if (parseError) {
      host.showError(`整形できません: JSON の構文エラー (${parseError})`);
      return;
    }
    if (!content.trim()) return;
    const formatted = JSON.stringify(JSON.parse(content), null, 2);
    content = formatted;
    editor.value = formatted;
    lastRenderedTreeContent = null;
    if (view === "tree") renderTree();
    host.clearError();
    syncStatus();
  }

  function toggleView() {
    if (view === "edit") {
      savedSelection = {
        start: editor.selectionStart,
        end: editor.selectionEnd,
      };
    } else {
      lastRenderedTreeContent = null;
    }
    view = view === "edit" ? "tree" : "edit";
    applyView();
  }

  editor.addEventListener("input", () => {
    content = editor.value;
    lastRenderedTreeContent = null;
    const parseError = validateJson(content);
    if (parseError) {
      host.showError(`JSON の構文エラー: ${parseError}`);
    } else {
      host.clearError();
    }
    syncStatus();
  });

  btnFormat.addEventListener("click", formatJson);
  btnTree.addEventListener("click", toggleView);

  return {
    activate() {
      active = true;
      screen.hidden = false;
      btnFormat.hidden = false;
      btnTree.hidden = false;
      syncEditorFromState();
    },

    deactivate() {
      active = false;
      persistScroll();
      screen.hidden = true;
      btnFormat.hidden = true;
      btnTree.hidden = true;
    },

    async suspend() {
      if (path) persistScroll();
      active = false;
      screen.hidden = true;
      btnFormat.hidden = true;
      btnTree.hidden = true;
      editor.value = "";
      treeEl.replaceChildren();
      content = "";
      savedContent = "";
      path = null;
      savedSelection = null;
      lastRenderedTreeContent = null;
      host.clearError();
      syncStatus();
    },

    isDirty,
    getPath: () => path,
    getFileName: () => (path ? fileBaseName(path) : "未選択"),

    async openFileWithGuard(filePath: string) {
      if (!confirmDiscard()) return;
      try {
        await loadFile(filePath);
      } catch (e) {
        host.showError(String(e));
      }
    },

    async openFileDialog() {
      const selected = await open({
        multiple: false,
        filters: JSON_FILTERS,
      });
      if (selected === null || Array.isArray(selected)) return;
      const picked =
        typeof selected === "string"
          ? selected
          : (selected as { path: string }).path;
      await this.openFileWithGuard(picked);
    },

    async save() {
      if (!path) {
        host.showError("保存先のファイルがありません。先にファイルを開いてください。");
        return;
      }
      const parseError = validateJson(content);
      if (parseError) {
        host.showError(`保存できません: JSON の構文エラー (${parseError})`);
        return;
      }
      try {
        await invoke("write_file", { path, content });
        savedContent = content;
        host.clearError();
        syncStatus();
      } catch (e) {
        host.showError(String(e));
        syncStatus();
      }
    },

    async saveAs() {
      const selected = await save({
        filters: JSON_FILTERS,
        defaultPath: path ?? undefined,
      });
      if (selected === null) return;
      const picked =
        typeof selected === "string"
          ? selected
          : (selected as { path: string }).path;
      const parseError = validateJson(content);
      if (parseError) {
        host.showError(`保存できません: JSON の構文エラー (${parseError})`);
        return;
      }
      try {
        await invoke("write_file", { path: picked, content });
        path = picked;
        savedContent = content;
        syncEditorFromState();
        host.clearError();
      } catch (e) {
        host.showError(String(e));
      }
    },

    handleShortcut(e: KeyboardEvent): boolean {
      if (!active || !isModKey(e)) return false;
      const key = e.key.toLowerCase();
      if (key === "s" && e.shiftKey) {
        void this.saveAs();
        return true;
      }
      if (key === "s") {
        void this.save();
        return true;
      }
      if (key === "o") {
        void this.openFileDialog();
        return true;
      }
      if (key === "p") {
        toggleView();
        return true;
      }
      return false;
    },

    async restoreRecentOnStartup() {
      const paths = await invoke<string[]>("get_recent_paths");
      const recent = paths.find(isJsonPath);
      if (!recent) return;
      try {
        await loadFile(recent);
      } catch (e) {
        host.showError(`最近の JSON ファイルを開けませんでした: ${e}`);
      }
    },

    syncUi() {
      syncEditorFromState();
    },

    persistScroll,
  };
}
