import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { EditorController, EditorHost } from "../../core/editor-controller";
import { formatYaml, parseYaml } from "../../core/yaml";
import {
  restoreScrollPosition,
  saveScrollPosition,
} from "../../core/session-state";

const YAML_FILTERS = [{ name: "YAML", extensions: ["yaml", "yml"] }];
const YAML_EXTENSIONS = [".yaml", ".yml"];

function fileBaseName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function isYamlPath(path: string): boolean {
  const lower = path.toLowerCase();
  return YAML_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isModKey(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey;
}

export function createYamlEditor(host: EditorHost): EditorController {
  const screen = document.querySelector("#yaml-screen") as HTMLElement;
  const editor = document.querySelector("#yaml-editor") as HTMLTextAreaElement;
  const btnFormat = document.querySelector("#btn-yaml-format") as HTMLButtonElement;

  let path: string | null = null;
  let content = "";
  let savedContent = "";
  let active = false;
  let validateToken = 0;

  const isDirty = () => content !== savedContent;

  const syncStatus = () => {
    host.setStatus({
      path,
      fileName: path ? fileBaseName(path) : "未選択",
      dirty: isDirty(),
    });
  };

  async function validateContent(text: string) {
    const token = ++validateToken;
    const { error } = await parseYaml(text);
    if (token !== validateToken) return;
    if (error) {
      host.showError(`YAML の構文エラー: ${error}`);
    } else {
      host.clearError();
    }
  }

  function syncEditorFromState() {
    if (editor.value !== content) editor.value = content;
    void validateContent(content);
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
    syncEditorFromState();
    if (path) restoreScrollPosition(path, editor, editor);
  }

  function confirmDiscard(): boolean {
    if (!isDirty()) return true;
    return window.confirm(
      "未保存の変更があります。破棄して別のファイルを開きますか？",
    );
  }

  async function formatYamlContent() {
    const { result, error } = await formatYaml(content);
    if (error) {
      host.showError(`整形できません: YAML の構文エラー (${error})`);
      return;
    }
    if (!content.trim()) return;
    content = result;
    editor.value = result;
    host.clearError();
    syncStatus();
  }

  editor.addEventListener("input", () => {
    content = editor.value;
    void validateContent(content);
    syncStatus();
  });

  btnFormat.addEventListener("click", () => void formatYamlContent());

  return {
    activate() {
      active = true;
      screen.hidden = false;
      syncEditorFromState();
    },

    deactivate() {
      active = false;
      persistScroll();
      screen.hidden = true;
    },

    async suspend() {
      if (path) persistScroll();
      active = false;
      screen.hidden = true;
      editor.value = "";
      content = "";
      savedContent = "";
      path = null;
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
        filters: YAML_FILTERS,
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
      const { error } = await parseYaml(content);
      if (error) {
        host.showError(`保存できません: YAML の構文エラー (${error})`);
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
        filters: YAML_FILTERS,
        defaultPath: path ?? undefined,
      });
      if (selected === null) return;
      const picked =
        typeof selected === "string"
          ? selected
          : (selected as { path: string }).path;
      const { error } = await parseYaml(content);
      if (error) {
        host.showError(`保存できません: YAML の構文エラー (${error})`);
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
      return false;
    },

    async restoreRecentOnStartup() {
      const paths = await invoke<string[]>("get_recent_paths");
      const recent = paths.find(isYamlPath);
      if (!recent) return;
      try {
        await loadFile(recent);
      } catch (e) {
        host.showError(`最近の YAML ファイルを開けませんでした: ${e}`);
      }
    },

    syncUi() {
      syncEditorFromState();
    },

    persistScroll,
  };
}
