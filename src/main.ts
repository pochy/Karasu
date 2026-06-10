import "./styles/markdown-editor.css";
import "./styles/json-editor.css";
import { initActivityBar } from "./app/activity-bar";
import { createAppChrome } from "./app/chrome";
import { getEditorMode, onEditorModeChange, type EditorMode } from "./app/editor-mode";
import type { EditorController } from "./core/editor-controller";
import { createJsonEditor } from "./features/json/editor";
import { createMarkdownEditor } from "./features/markdown/editor";
import { initSidebarLayout } from "./features/markdown/sidebar/layout";
import { initDisplaySettings } from "./features/settings/settings";

let activeMode: EditorMode = getEditorMode();

const controllers: Record<EditorMode, EditorController> = {
  markdown: null!,
  json: null!,
};

window.addEventListener("DOMContentLoaded", () => {
  initSidebarLayout();
  initActivityBar();
  initDisplaySettings();

  const host = createAppChrome(() => controllers[activeMode]);
  controllers.markdown = createMarkdownEditor(host);
  controllers.json = createJsonEditor(host);

  onEditorModeChange((mode) => {
    if (mode === activeMode) return;
    controllers[activeMode].persistScroll();
    controllers[activeMode].deactivate();
    activeMode = mode;
    host.clearError();
    controllers[mode].activate();
    controllers[mode].syncUi();
  });

  const inactive: EditorMode = activeMode === "markdown" ? "json" : "markdown";
  controllers[inactive].deactivate();
  controllers[activeMode].activate();
  controllers[activeMode].syncUi();

  void controllers.markdown.restoreRecentOnStartup();
  void controllers.json.restoreRecentOnStartup();
});
