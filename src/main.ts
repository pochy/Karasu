import "./styles/markdown-editor.css";
import "./styles/json-editor.css";
import "./styles/csv-editor.css";
import "./styles/yaml-editor.css";
import "./styles/toml-editor.css";
import "./styles/convert-editor.css";
import "./styles/jwt-editor.css";
import "./styles/devtools-editor.css";
import { initActivityBar } from "./app/activity-bar";
import { createAppChrome } from "./app/chrome";
import { getEditorMode, onEditorModeChange, setEditorMode, type EditorMode } from "./app/editor-mode";
import { initAppLifecycle } from "./app/lifecycle";
import { setToolbarForMode } from "./app/toolbar";
import type { EditorController } from "./core/editor-controller";
import { createConvertEditor } from "./features/convert/editor";
import { createCsvEditor } from "./features/csv/editor";
import { createDevtoolsEditor } from "./features/devtools/editor";
import { createJsonEditor } from "./features/json/editor";
import { createJwtEditor } from "./features/jwt/editor";
import { createMarkdownEditor } from "./features/markdown/editor";
import { initSidebarLayout } from "./features/markdown/sidebar/layout";
import { initDisplaySettings } from "./features/settings/settings";
import { createTomlEditor } from "./features/toml/editor";
import { createYamlEditor } from "./features/yaml/editor";

const ALL_MODES: EditorMode[] = [
  "markdown",
  "json",
  "csv",
  "yaml",
  "toml",
  "convert",
  "jwt",
  "devtools",
];

let activeMode: EditorMode = getEditorMode();

const controllers = Object.fromEntries(
  ALL_MODES.map((mode) => [mode, null! as EditorController]),
) as Record<EditorMode, EditorController>;

window.addEventListener("DOMContentLoaded", () => {
  initSidebarLayout();
  initActivityBar();
  initDisplaySettings();

  const host = createAppChrome(() => controllers[activeMode]);
  controllers.markdown = createMarkdownEditor(host);
  controllers.json = createJsonEditor(host);
  controllers.csv = createCsvEditor(host);
  controllers.yaml = createYamlEditor(host);
  controllers.toml = createTomlEditor(host);
  controllers.convert = createConvertEditor(host);
  controllers.jwt = createJwtEditor(host);
  controllers.devtools = createDevtoolsEditor(host);

  const switchToMode = (mode: EditorMode) => {
    if (mode === activeMode) return;
    controllers[activeMode].persistScroll();
    controllers[activeMode].deactivate();
    activeMode = mode;
    host.clearError();
    controllers[mode].activate();
    controllers[mode].syncUi();
    setToolbarForMode(mode);
  };

  onEditorModeChange((mode) => {
    switchToMode(mode);
  });

  initAppLifecycle({
    getControllers: () => controllers,
    getActiveMode: () => activeMode,
    switchMode: (mode) => {
      if (mode === activeMode) return;
      switchToMode(mode);
      setEditorMode(mode);
    },
    showError: (message) => host.showError(message),
    clearError: () => host.clearError(),
  });

  for (const mode of ALL_MODES) {
    if (mode !== activeMode) controllers[mode].deactivate();
  }
  controllers[activeMode].activate();
  controllers[activeMode].syncUi();
  setToolbarForMode(activeMode);

  void controllers.markdown.restoreRecentOnStartup();
  void controllers.json.restoreRecentOnStartup();
  void controllers.csv.restoreRecentOnStartup();
  void controllers.yaml.restoreRecentOnStartup();
  void controllers.toml.restoreRecentOnStartup();
});
