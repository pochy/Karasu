import type { EditorMode } from "./editor-mode";

const btnOpen = () => document.querySelector("#btn-open") as HTMLButtonElement;
const btnSaveAs = () => document.querySelector("#btn-save-as") as HTMLButtonElement;
const btnToggleView = () => document.querySelector("#btn-toggle-view") as HTMLButtonElement;
const btnJsonFormat = () => document.querySelector("#btn-json-format") as HTMLButtonElement;
const btnJsonTree = () => document.querySelector("#btn-json-tree") as HTMLButtonElement;
const btnYamlFormat = () => document.querySelector("#btn-yaml-format") as HTMLButtonElement;
const btnTomlFormat = () => document.querySelector("#btn-toml-format") as HTMLButtonElement;
const btnJsonSchema = () => document.querySelector("#btn-json-schema") as HTMLButtonElement;

const FILE_MODES: EditorMode[] = ["markdown", "json", "csv", "yaml", "toml"];

export function setToolbarForMode(mode: EditorMode): void {
  btnOpen().hidden = !FILE_MODES.includes(mode);
  btnSaveAs().hidden = !FILE_MODES.includes(mode);
  btnToggleView().hidden = mode !== "markdown";
  btnJsonFormat().hidden = mode !== "json";
  btnJsonTree().hidden = mode !== "json";
  btnJsonSchema().hidden = mode !== "json";
  btnYamlFormat().hidden = mode !== "yaml";
  btnTomlFormat().hidden = mode !== "toml";
}
