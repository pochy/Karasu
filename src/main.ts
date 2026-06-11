import "./styles/markdown-editor.css";
import "./styles/json-editor.css";
import "./styles/csv-editor.css";
import { initActivityBar } from "./app/activity-bar";
import { createAppChrome } from "./app/chrome";
import { getEditorMode, onEditorModeChange, type EditorMode } from "./app/editor-mode";
import type { EditorController } from "./core/editor-controller";
import { createCsvEditor } from "./features/csv/editor";
import { createJsonEditor } from "./features/json/editor";
import { createMarkdownEditor } from "./features/markdown/editor";
import { initSidebarLayout } from "./features/markdown/sidebar/layout";
import { initDisplaySettings } from "./features/settings/settings";

const ALL_MODES: EditorMode[] = ["markdown", "json", "csv"];

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

  onEditorModeChange((mode) => {
    if (mode === activeMode) return;
    controllers[activeMode].persistScroll();
    controllers[activeMode].deactivate();
    activeMode = mode;
    host.clearError();
    controllers[mode].activate();
    controllers[mode].syncUi();
  });

  for (const mode of ALL_MODES) {
    if (mode !== activeMode) controllers[mode].deactivate();
  }
  controllers[activeMode].activate();
  controllers[activeMode].syncUi();

  void controllers.markdown.restoreRecentOnStartup();
  void controllers.json.restoreRecentOnStartup();
  void controllers.csv.restoreRecentOnStartup();
});
