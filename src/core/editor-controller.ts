export interface EditorHost {
  showError(message: string): void;
  clearError(): void;
  setStatus(meta: { path: string | null; fileName: string; dirty: boolean }): void;
}

export interface EditorController {
  activate(): void;
  deactivate(): void;
  isDirty(): boolean;
  getPath(): string | null;
  getFileName(): string;
  openFileDialog(): Promise<void>;
  openFileWithGuard(path: string): Promise<void>;
  save(): Promise<void>;
  saveAs(): Promise<void>;
  handleShortcut(e: KeyboardEvent): boolean;
  restoreRecentOnStartup(): Promise<void>;
  syncUi(): void;
  persistScroll(): void;
}
