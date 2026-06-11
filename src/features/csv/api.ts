import { invoke } from "@tauri-apps/api/core";

export interface CsvOpenResult {
  path: string;
  file_size: number;
  streaming: boolean;
  row_count: number;
  column_count: number;
  headers: string[];
  index_ready: boolean;
  dirty: boolean;
}

export interface CsvRowBatch {
  start_row: number;
  rows: string[][];
}

export function csvOpen(path: string): Promise<CsvOpenResult> {
  return invoke("csv_open", { path });
}

export function csvReadRows(
  path: string,
  startRow: number,
  count: number,
): Promise<CsvRowBatch> {
  return invoke("csv_read_rows", {
    path,
    startRow,
    count,
  });
}

export function csvSetCell(
  path: string,
  row: number,
  col: number,
  value: string,
): Promise<void> {
  return invoke("csv_set_cell", { path, row, col, value });
}

export function csvSave(
  path: string,
  outputPath?: string,
): Promise<string> {
  return invoke("csv_save", { path, outputPath: outputPath ?? null });
}

export function csvClose(): Promise<void> {
  return invoke("csv_close");
}
