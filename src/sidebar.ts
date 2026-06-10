import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

interface SidebarDeps {
  getActivePath: () => string | null;
  isDirty: () => boolean;
  openFile: (path: string) => Promise<void>;
  onWorkspaceChanged?: () => void;
  getFileWatchEnabled: () => boolean;
}

const WORKSPACE_ROOT_NONE = "作業フォルダ未選択";
const MARKDOWN_FILTERS = [
  {
    name: "Markdown",
    extensions: ["md", "markdown", "mdown", "mkd", "txt"],
  },
];

export interface SidebarControls {
  highlightActiveFile: () => Promise<void>;
  pickWorkspaceFolder: () => Promise<void>;
  refreshRecentList: () => Promise<void>;
  getWorkspaceRoot: () => string | null;
}

function joinPath(base: string, name: string): string {
  const sep = base.includes("\\") ? "\\" : "/";
  return base.endsWith(sep) ? `${base}${name}` : `${base}${sep}${name}`;
}

export function initSidebar(deps: SidebarDeps): SidebarControls {
  const rootLabel = document.querySelector("#workspace-root-label") as HTMLElement;
  const recentEl = document.querySelector("#recent-files-list") as HTMLElement;
  const searchResultsEl = document.querySelector("#search-results") as HTMLElement;
  const treeEl = document.querySelector("#file-tree") as HTMLElement;
  const filterInput = document.querySelector("#sidebar-filter") as HTMLInputElement;
  const btnOpenFolder = document.querySelector("#btn-open-folder") as HTMLButtonElement;
  const btnRefresh = document.querySelector("#btn-refresh-tree") as HTMLButtonElement;
  const btnNewFile = document.querySelector("#btn-new-file") as HTMLButtonElement;
  const btnSearch = document.querySelector("#btn-search-files") as HTMLButtonElement;

  let workspaceRoot: string | null = null;
  const expanded = new Set<string>();
  const cache = new Map<string, DirEntry[]>();

  const basename = (path: string) => {
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1] || path;
  };

  const setRootLabel = () => {
    rootLabel.textContent = workspaceRoot
      ? basename(workspaceRoot)
      : WORKSPACE_ROOT_NONE;
    rootLabel.title = workspaceRoot ?? "";
    btnNewFile.disabled = !workspaceRoot;
  };

  const syncWatch = async () => {
    await invoke("set_workspace_watch", {
      enabled: deps.getFileWatchEnabled(),
      path: workspaceRoot,
    });
  };

  const matchesFilter = (name: string): boolean => {
    const q = filterInput.value.trim().toLowerCase();
    if (!q) return true;
    return name.toLowerCase().includes(q);
  };

  const fetchDir = async (path: string): Promise<DirEntry[]> => {
    if (cache.has(path)) return cache.get(path)!;
    const entries = await invoke<DirEntry[]>("list_directory", { path });
    cache.set(path, entries);
    return entries;
  };

  const clearCache = () => {
    cache.clear();
    expanded.clear();
  };

  const pruneDescendants = (path: string) => {
    const prefix = `${path}${path.includes("\\") ? "\\" : "/"}`;
    for (const key of cache.keys()) {
      if (key.startsWith(prefix)) {
        cache.delete(key);
      }
    }
    for (const key of expanded) {
      if (key.startsWith(prefix)) {
        expanded.delete(key);
      }
    }
  };

  const expandToFile = async (filePath: string) => {
    if (!workspaceRoot || !filePath.startsWith(workspaceRoot)) return;

    expanded.add(workspaceRoot);
    let current = workspaceRoot;
    const rel = filePath
      .slice(workspaceRoot.length)
      .replace(/^[/\\]+/, "");
    const parts = rel.split(/[/\\]/).slice(0, -1);

    for (const part of parts) {
      current = joinPath(current, part);
      expanded.add(current);
      await fetchDir(current);
    }
  };

  const createRow = (
    entry: DirEntry,
    depth: number,
    childrenWrap: HTMLElement | null,
  ): HTMLElement => {
    const row = document.createElement("div");
    row.className = "tree-node";
    row.dataset.path = entry.path;
    row.dataset.isdir = String(entry.is_dir);
    row.style.paddingLeft = `${0.5 + depth * 0.75}rem`;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tree-node-btn";
    btn.title = entry.path;

    if (entry.is_dir) {
      const isOpen = expanded.has(entry.path);
      btn.classList.add("tree-node-btn--dir");
      btn.innerHTML = `<span class="tree-chevron" aria-hidden="true">${isOpen ? "▼" : "▶"}</span><span class="tree-label">${entry.name}</span>`;
      btn.addEventListener("click", () => {
        void toggleDir(entry.path);
      });
    } else {
      btn.classList.add("tree-node-btn--file");
      btn.innerHTML = `<span class="tree-chevron tree-chevron--spacer" aria-hidden="true"></span><span class="tree-label">${entry.name}</span>`;
      btn.addEventListener("click", () => {
        void openEntry(entry.path);
      });
    }

    if (!matchesFilter(entry.name)) {
      row.classList.add("tree-node--filtered");
    }

    if (deps.getActivePath() === entry.path) {
      btn.classList.add("tree-node-btn--active");
    }

    row.appendChild(btn);
    if (childrenWrap) {
      row.appendChild(childrenWrap);
    }
    return row;
  };

  const renderDir = async (path: string, depth: number, container: HTMLElement) => {
    container.replaceChildren();
    try {
      const entries = await fetchDir(path);
      if (entries.length === 0) {
        const empty = document.createElement("p");
        empty.className = "tree-empty";
        empty.textContent = "（空のフォルダ）";
        container.appendChild(empty);
        return;
      }

      for (const entry of entries) {
        if (entry.is_dir) {
          const childContainer = document.createElement("div");
          childContainer.className = "tree-children";
          childContainer.hidden = !expanded.has(entry.path);
          if (expanded.has(entry.path)) {
            await renderDir(entry.path, depth + 1, childContainer);
          }
          container.appendChild(createRow(entry, depth, childContainer));
        } else {
          container.appendChild(createRow(entry, depth, null));
        }
      }
    } catch (e) {
      const err = document.createElement("p");
      err.className = "tree-error";
      err.textContent = String(e);
      container.appendChild(err);
    }
  };

  const scrollActiveIntoView = () => {
    const active = treeEl.querySelector(".tree-node-btn--active");
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const renderTree = async () => {
    treeEl.replaceChildren();
    if (!workspaceRoot) {
      const hint = document.createElement("p");
      hint.className = "tree-hint";
      hint.textContent =
        "「フォルダを開く」で作業フォルダを選ぶと、ここにファイル一覧が表示されます。";
      treeEl.appendChild(hint);
      return;
    }
    await renderDir(workspaceRoot, 0, treeEl);
    applyFilterVisibility();
    scrollActiveIntoView();
  };

  const highlightActiveFile = async () => {
    const path = deps.getActivePath();
    if (path && workspaceRoot) {
      await expandToFile(path);
    }
    await renderTree();
  };

  const applyFilterVisibility = () => {
    const q = filterInput.value.trim().toLowerCase();
    treeEl.querySelectorAll<HTMLElement>(".tree-node").forEach((node) => {
      if (!q) {
        node.classList.remove("tree-node--filtered");
        return;
      }
      const label = node.querySelector(".tree-label")?.textContent ?? "";
      node.classList.toggle("tree-node--filtered", !label.toLowerCase().includes(q));
    });
  };

  const toggleDir = async (path: string) => {
    if (expanded.has(path)) {
      expanded.delete(path);
      pruneDescendants(path);
    } else {
      expanded.add(path);
    }
    await renderTree();
  };

  const confirmDiscard = (): boolean => {
    if (!deps.isDirty()) return true;
    return window.confirm(
      "未保存の変更があります。破棄して別のファイルを開きますか？",
    );
  };

  const openEntry = async (path: string) => {
    if (!confirmDiscard()) return;
    await deps.openFile(path);
    await highlightActiveFile();
  };

  const renderRecentList = async () => {
    const paths = await invoke<string[]>("get_recent_paths");
    recentEl.replaceChildren();
    if (paths.length === 0) {
      const empty = document.createElement("p");
      empty.className = "recent-empty";
      empty.textContent = "（最近開いたファイルはありません）";
      recentEl.appendChild(empty);
      return;
    }
    for (const path of paths) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "recent-file-btn";
      btn.textContent = basename(path);
      btn.title = path;
      if (deps.getActivePath() === path) {
        btn.classList.add("recent-file-btn--active");
      }
      btn.addEventListener("click", () => {
        void openEntry(path);
      });
      recentEl.appendChild(btn);
    }
  };

  const renderSearchResults = (entries: DirEntry[]) => {
    searchResultsEl.replaceChildren();
    searchResultsEl.hidden = entries.length === 0;
    if (entries.length === 0) return;

    const heading = document.createElement("p");
    heading.className = "search-results-heading";
    heading.textContent = `検索結果（${entries.length} 件）`;
    searchResultsEl.appendChild(heading);

    for (const entry of entries) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "search-result-btn";
      btn.textContent = entry.name;
      btn.title = entry.path;
      btn.addEventListener("click", () => {
        void openEntry(entry.path);
        searchResultsEl.hidden = true;
        searchResultsEl.replaceChildren();
      });
      searchResultsEl.appendChild(btn);
    }
  };

  const runFolderSearch = async () => {
    if (!workspaceRoot) return;
    const q = filterInput.value.trim();
    if (!q) return;
    try {
      const hits = await invoke<DirEntry[]>("search_filenames", {
        root: workspaceRoot,
        query: q,
      });
      renderSearchResults(hits);
    } catch (e) {
      renderSearchResults([]);
      searchResultsEl.hidden = false;
      searchResultsEl.textContent = String(e);
    }
  };

  const setWorkspace = async (path: string) => {
    await invoke("set_workspace_root", { path });
    workspaceRoot = path;
    clearCache();
    expanded.add(path);
    setRootLabel();
    await syncWatch();
    await renderTree();
    deps.onWorkspaceChanged?.();
  };

  const pickWorkspaceFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
    });
    if (selected === null || Array.isArray(selected)) return;
    const path =
      typeof selected === "string" ? selected : (selected as { path: string }).path;
    await setWorkspace(path);
  };

  const createNewFile = async () => {
    if (!workspaceRoot) return;
    const defaultPath = joinPath(workspaceRoot, "untitled.md");
    const selected = await save({
      defaultPath,
      filters: MARKDOWN_FILTERS,
    });
    if (selected === null) return;
    const path =
      typeof selected === "string" ? selected : (selected as { path: string }).path;
    try {
      if (!confirmDiscard()) return;
      await invoke("write_file", { path, content: "" });
      await deps.openFile(path);
      await highlightActiveFile();
      await renderRecentList();
    } catch (e) {
      window.alert(String(e));
    }
  };

  btnOpenFolder.addEventListener("click", () => void pickWorkspaceFolder());
  btnRefresh.addEventListener("click", () => {
    clearCache();
    if (workspaceRoot) expanded.add(workspaceRoot);
    void renderTree();
  });
  btnNewFile.addEventListener("click", () => void createNewFile());
  btnSearch.addEventListener("click", () => void runFolderSearch());
  filterInput.addEventListener("input", applyFilterVisibility);

  void listen("workspace-files-changed", () => {
    cache.clear();
    void renderTree();
  });

  void (async () => {
    const saved = await invoke<string | null>("get_workspace_root");
    if (saved) {
      workspaceRoot = saved;
      expanded.add(saved);
      setRootLabel();
      await syncWatch();
      await renderTree();
    } else {
      setRootLabel();
    }
    await renderRecentList();
  })();

  return {
    highlightActiveFile,
    pickWorkspaceFolder,
    refreshRecentList: renderRecentList,
    getWorkspaceRoot: () => workspaceRoot,
  };
}
