import type { EditorController, EditorHost } from "../../core/editor-controller";
import { parseYaml, stringifyYaml } from "../../core/yaml";

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

export function createConvertEditor(host: EditorHost): EditorController {
  const screen = document.querySelector("#convert-screen") as HTMLElement;
  const jsonEditor = document.querySelector("#convert-json") as HTMLTextAreaElement;
  const yamlEditor = document.querySelector("#convert-yaml") as HTMLTextAreaElement;
  const btnJsonToYaml = document.querySelector("#btn-convert-json-to-yaml") as HTMLButtonElement;
  const btnYamlToJson = document.querySelector("#btn-convert-yaml-to-json") as HTMLButtonElement;
  const btnClear = document.querySelector("#btn-convert-clear") as HTMLButtonElement;

  let jsonContent = "";
  let yamlContent = "";
  let baselineJson = "";
  let baselineYaml = "";
  let active = false;

  const isDirty = () =>
    jsonContent !== baselineJson || yamlContent !== baselineYaml;

  const syncStatus = () => {
    host.setStatus({
      path: null,
      fileName: "JSON ↔ YAML",
      dirty: isDirty(),
    });
  };

  function syncEditors() {
    if (jsonEditor.value !== jsonContent) jsonEditor.value = jsonContent;
    if (yamlEditor.value !== yamlContent) yamlEditor.value = yamlContent;
    syncStatus();
  }

  async function convertJsonToYaml() {
    const parseError = validateJson(jsonContent);
    if (parseError) {
      host.showError(`JSON → YAML: 構文エラー (${parseError})`);
      return;
    }
    if (!jsonContent.trim()) {
      yamlContent = "";
      yamlEditor.value = "";
      syncStatus();
      host.clearError();
      return;
    }
    try {
      const data = JSON.parse(jsonContent);
      yamlContent = await stringifyYaml(data);
      yamlEditor.value = yamlContent;
      host.clearError();
      syncStatus();
    } catch (e) {
      host.showError(`JSON → YAML: ${e}`);
    }
  }

  async function convertYamlToJson() {
    const { data, error } = await parseYaml(yamlContent);
    if (error) {
      host.showError(`YAML → JSON: 構文エラー (${error})`);
      return;
    }
    if (data === null && !yamlContent.trim()) {
      jsonContent = "";
      jsonEditor.value = "";
      syncStatus();
      host.clearError();
      return;
    }
    try {
      jsonContent = JSON.stringify(data, null, 2);
      jsonEditor.value = jsonContent;
      host.clearError();
      syncStatus();
    } catch (e) {
      host.showError(`YAML → JSON: ${e}`);
    }
  }

  function clearAll() {
    jsonContent = "";
    yamlContent = "";
    baselineJson = "";
    baselineYaml = "";
    jsonEditor.value = "";
    yamlEditor.value = "";
    host.clearError();
    syncStatus();
  }

  jsonEditor.addEventListener("input", () => {
    jsonContent = jsonEditor.value;
    syncStatus();
  });

  yamlEditor.addEventListener("input", () => {
    yamlContent = yamlEditor.value;
    syncStatus();
  });

  btnJsonToYaml.addEventListener("click", () => void convertJsonToYaml());
  btnYamlToJson.addEventListener("click", () => void convertYamlToJson());
  btnClear.addEventListener("click", clearAll);

  return {
    activate() {
      active = true;
      screen.hidden = false;
      syncEditors();
    },

    deactivate() {
      active = false;
      screen.hidden = true;
    },

    async suspend() {
      active = false;
      screen.hidden = true;
      jsonContent = "";
      yamlContent = "";
      baselineJson = "";
      baselineYaml = "";
      jsonEditor.value = "";
      yamlEditor.value = "";
      host.clearError();
      syncStatus();
    },

    isDirty,
    getPath: () => null,
    getFileName: () => "JSON ↔ YAML",

    async openFileWithGuard() {},
    async openFileDialog() {},
    async save() {},
    async saveAs() {},

    handleShortcut(e: KeyboardEvent): boolean {
      if (!active || !isModKey(e)) return false;
      if (e.key.toLowerCase() === "k") {
        clearAll();
        return true;
      }
      return false;
    },

    async restoreRecentOnStartup() {},

    syncUi() {
      syncEditors();
    },

    persistScroll() {},
  };
}
