import {
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect,
  type VirtualItem,
} from "@tanstack/virtual-core";
import {
  createTable,
  getCoreRowModel,
  type ColumnDef,
  type Table,
  type TableState,
} from "@tanstack/table-core";
import { csvReadRows, csvSetCell } from "./api";

const ROW_HEIGHT = 28;
const OVERSCAN = 25;
const PREFETCH_PADDING = 40;
const COL_WIDTH = 120;
/** 表示用キャッシュ上限（Rust 側 LRU と同程度のスケール） */
const ROW_CACHE_MAX_ROWS = 400;

export interface SpreadsheetOptions {
  scrollEl: HTMLElement;
  innerEl: HTMLElement;
  tableEl: HTMLTableElement;
  theadEl: HTMLTableSectionElement;
  tbodyEl: HTMLTableSectionElement;
  onDirty(): void;
  onError(message: string): void;
}

export class CsvSpreadsheet {
  private path: string | null = null;
  private rowCount = 0;
  private columnCount = 0;
  private headers: string[] = [];
  private rowCache = new Map<number, string[]>();
  private rowCacheOrder: number[] = [];
  private pendingFetch: Promise<void> | null = null;
  private prefetchTimer: ReturnType<typeof setTimeout> | null = null;
  private loadGeneration = 0;
  private scrollListenerAttached = false;
  private virtualizer: Virtualizer<HTMLElement, HTMLTableRowElement> | null = null;
  private virtualCleanup: (() => void) | null = null;
  private table: Table<string[]> | null = null;
  private editing: { row: number; col: number; input: HTMLInputElement } | null = null;

  constructor(private opts: SpreadsheetOptions) {}

  async open(
    path: string,
    meta: {
      row_count: number;
      column_count: number;
      headers: string[];
    },
  ): Promise<void> {
    await this.close();
    this.path = path;
    this.rowCount = meta.row_count;
    this.columnCount = meta.column_count;
    this.headers = meta.headers;
    this.rowCache.clear();
    this.buildTable();
    this.mountVirtualizer();
    await this.ensureRowsLoaded(0, Math.min(120, this.rowCount));
    this.render();
    this.remeasure();
  }

  /** スクロール領域のサイズ確定後に仮想範囲を再計算する */
  remeasure(): void {
    if (!this.virtualizer) return;
    const gen = this.loadGeneration;
    requestAnimationFrame(() => {
      if (gen !== this.loadGeneration || !this.virtualizer) return;
      this.virtualizer.measure();
      this.renderBody();
      void this.prefetchVisible();
    });
  }

  async close(): Promise<void> {
    this.loadGeneration += 1;
    this.cancelEdit();
    if (this.prefetchTimer) {
      clearTimeout(this.prefetchTimer);
      this.prefetchTimer = null;
    }
    if (this.scrollListenerAttached) {
      this.opts.scrollEl.removeEventListener("scroll", this.onScroll);
      this.scrollListenerAttached = false;
    }
    this.virtualCleanup?.();
    this.virtualCleanup = null;
    this.virtualizer = null;
    this.table = null;
    this.path = null;
    this.rowCache.clear();
    this.rowCacheOrder = [];
    this.pendingFetch = null;
    this.opts.innerEl.style.height = "";
    this.opts.scrollEl.scrollTop = 0;
    this.opts.theadEl.replaceChildren();
    this.opts.tbodyEl.replaceChildren();
  }

  setRowCount(count: number): void {
    this.rowCount = count;
    if (this.virtualizer) {
      this.virtualizer.setOptions({
        ...this.virtualizer.options,
        count,
      });
      this.remeasure();
    }
  }

  private buildTable(): void {
    const columns: ColumnDef<string[]>[] = [];
    for (let col = 0; col < this.columnCount; col++) {
      const header = this.headers[col] || `列${col + 1}`;
      columns.push({
        id: `col-${col}`,
        accessorFn: (row) => row[col] ?? "",
        header,
        size: COL_WIDTH,
      });
    }
    const table = createTable({
      data: [],
      columns,
      getCoreRowModel: getCoreRowModel(),
      renderFallbackValue: null,
      state: {} as TableState,
      onStateChange: () => {},
    });
    // 空の state: {} だと columnPinning 等が欠落するため initialState を適用
    table.setOptions((prev) => ({ ...prev, state: table.initialState }));
    this.table = table;
    this.renderHeader();
  }

  private mountVirtualizer(): void {
    const scrollEl = this.opts.scrollEl;
    this.virtualizer = new Virtualizer({
      count: this.rowCount,
      getScrollElement: () => scrollEl,
      estimateSize: () => ROW_HEIGHT,
      overscan: OVERSCAN,
      scrollToFn: elementScroll,
      observeElementRect,
      observeElementOffset,
      onChange: () => {
        if (!this.path) return;
        this.schedulePrefetch();
        this.renderBody();
      },
    });
    this.virtualCleanup = this.virtualizer._didMount();
    this.virtualizer._willUpdate();
    if (!this.scrollListenerAttached) {
      scrollEl.addEventListener("scroll", this.onScroll, { passive: true });
      this.scrollListenerAttached = true;
    }
  }

  private onScroll = (): void => {
    this.schedulePrefetch();
  };

  private schedulePrefetch(): void {
    if (!this.path || !this.virtualizer) return;
    if (this.prefetchTimer) clearTimeout(this.prefetchTimer);
    this.prefetchTimer = setTimeout(() => {
      this.prefetchTimer = null;
      void this.prefetchVisible();
    }, 50);
  }

  private cacheRow(row: number, data: string[]): void {
    if (this.rowCache.has(row)) {
      const idx = this.rowCacheOrder.indexOf(row);
      if (idx >= 0) this.rowCacheOrder.splice(idx, 1);
    }
    this.rowCache.set(row, data);
    this.rowCacheOrder.push(row);
    while (this.rowCacheOrder.length > ROW_CACHE_MAX_ROWS) {
      const evict = this.rowCacheOrder.shift();
      if (evict !== undefined) this.rowCache.delete(evict);
    }
  }

  private async prefetchVisible(): Promise<void> {
    if (!this.virtualizer || !this.path) return;
    const gen = this.loadGeneration;
    const items = this.virtualizer.getVirtualItems();
    if (items.length === 0) return;
    const start = Math.max(0, items[0].index - PREFETCH_PADDING);
    const end = Math.min(
      this.rowCount,
      items[items.length - 1].index + PREFETCH_PADDING + 1,
    );
    await this.ensureRowsLoaded(start, end - start);
    if (gen !== this.loadGeneration) return;
    this.renderBody();
  }

  private async ensureRowsLoaded(start: number, count: number): Promise<void> {
    if (!this.path || count <= 0) return;
    const missing: number[] = [];
    for (let i = 0; i < count; i++) {
      const row = start + i;
      if (row >= this.rowCount) break;
      if (!this.rowCache.has(row)) missing.push(row);
    }
    if (missing.length === 0) return;
    const fetchStart = missing[0];
    const fetchEnd = missing[missing.length - 1];
    await this.fetchRows(fetchStart, fetchEnd - fetchStart + 1);
  }

  private async fetchRows(start: number, count: number): Promise<void> {
    if (!this.path) return;
    const gen = this.loadGeneration;
    if (this.pendingFetch) await this.pendingFetch;
    if (gen !== this.loadGeneration || !this.path) return;
    const path = this.path;
    this.pendingFetch = (async () => {
      try {
        const batch = await csvReadRows(path, start, count);
        if (gen !== this.loadGeneration) return;
        for (let i = 0; i < batch.rows.length; i++) {
          this.cacheRow(batch.start_row + i, batch.rows[i]);
        }
      } catch (e) {
        if (gen === this.loadGeneration) {
          this.opts.onError(String(e));
        }
      } finally {
        this.pendingFetch = null;
      }
    })();
    await this.pendingFetch;
  }

  private render(): void {
    this.renderHeader();
    this.renderBody();
  }

  private renderHeader(): void {
    if (!this.table) return;
    const thead = this.opts.theadEl;
    thead.replaceChildren();
    const tr = document.createElement("tr");
    for (const headerGroup of this.table.getHeaderGroups()) {
      for (const header of headerGroup.headers) {
        const th = document.createElement("th");
        th.textContent = String(header.column.columnDef.header ?? "");
        th.style.width = `${header.getSize()}px`;
        th.style.minWidth = `${header.getSize()}px`;
        tr.appendChild(th);
      }
    }
    thead.appendChild(tr);
  }

  private renderBody(): void {
    if (!this.virtualizer || !this.table || !this.path) return;
    const inner = this.opts.innerEl;
    const tbody = this.opts.tbodyEl;
    const totalHeight = this.virtualizer.getTotalSize();
    inner.style.height = `${totalHeight}px`;

    const virtualItems = this.virtualizer.getVirtualItems();
    const existing = new Map<number, HTMLTableRowElement>();
    for (const tr of tbody.querySelectorAll<HTMLTableRowElement>("tr[data-row]")) {
      const row = Number(tr.dataset.row);
      if (!Number.isNaN(row)) existing.set(row, tr);
    }

    const nextRows = new Set<number>();
    for (let i = 0; i < virtualItems.length; i++) {
      const virtualRow = virtualItems[i];
      nextRows.add(virtualRow.index);
      let tr = existing.get(virtualRow.index);
      if (!tr) {
        tr = this.createRow(virtualRow, i);
        tbody.appendChild(tr);
      } else {
        this.positionRow(tr, virtualRow, i);
        this.fillRow(tr, virtualRow.index);
      }
    }

    for (const [row, tr] of existing) {
      if (!nextRows.has(row)) tr.remove();
    }
  }

  private createRow(virtualRow: VirtualItem, indexInView: number): HTMLTableRowElement {
    const tr = document.createElement("tr");
    tr.dataset.row = String(virtualRow.index);

    const colCount = this.columnCount;
    for (let col = 0; col < colCount; col++) {
      const td = document.createElement("td");
      td.dataset.col = String(col);
      td.style.width = `${COL_WIDTH}px`;
      td.style.maxWidth = `${COL_WIDTH}px`;
      td.addEventListener("dblclick", () => this.startEdit(virtualRow.index, col, td));
      tr.appendChild(td);
    }

    this.positionRow(tr, virtualRow, indexInView);
    this.fillRow(tr, virtualRow.index);
    return tr;
  }

  private positionRow(
    tr: HTMLTableRowElement,
    virtualRow: VirtualItem,
    indexInView: number,
  ): void {
    // table 行は absolute が効かないため TanStack Table 例と同じ transform 方式
    tr.style.height = `${virtualRow.size}px`;
    tr.style.transform = `translateY(${virtualRow.start - indexInView * virtualRow.size}px)`;
  }

  private fillRow(tr: HTMLTableRowElement, rowIndex: number): void {
    const data = this.rowCache.get(rowIndex);
    const cells = tr.querySelectorAll("td");
    for (let col = 0; col < cells.length; col++) {
      const td = cells[col] as HTMLTableCellElement;
      if (
        this.editing &&
        this.editing.row === rowIndex &&
        this.editing.col === col
      ) {
        continue;
      }
      td.textContent = data?.[col] ?? "";
      td.title = td.textContent;
    }
  }

  private startEdit(row: number, col: number, td: HTMLTableCellElement): void {
    if (!this.path) return;
    this.cancelEdit();
    const input = document.createElement("input");
    input.type = "text";
    input.className = "csv-cell-input";
    input.value = this.rowCache.get(row)?.[col] ?? td.textContent ?? "";
    td.replaceChildren(input);
    input.focus();
    input.select();

    const commit = async () => {
      const value = input.value;
      td.textContent = value;
      td.title = value;
      const cached = this.rowCache.get(row) ?? [];
      while (cached.length <= col) cached.push("");
      cached[col] = value;
      this.cacheRow(row, cached);
      this.editing = null;
      try {
        await csvSetCell(this.path!, row, col, value);
        this.opts.onDirty();
      } catch (e) {
        this.opts.onError(String(e));
      }
    };

    input.addEventListener("blur", () => void commit());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      }
      if (e.key === "Escape") {
        this.editing = null;
        this.fillRow(td.closest("tr") as HTMLTableRowElement, row);
      }
    });

    this.editing = { row, col, input };
  }

  private cancelEdit(): void {
    if (!this.editing) return;
    const { row, input } = this.editing;
    const tr = input.closest("tr") as HTMLTableRowElement | null;
    this.editing = null;
    if (tr) this.fillRow(tr, row);
  }

  destroy(): void {
    void this.close();
  }
}
