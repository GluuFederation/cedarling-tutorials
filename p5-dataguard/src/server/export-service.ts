import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  ExportCreated,
  QueryPlan,
  QueryResponse,
} from "../shared/contracts.ts";
import { randomToken } from "./crypto.ts";
import type { AppDatabase } from "./database.ts";

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export class ExportService {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
  }

  create(
    ownerId: string,
    plan: QueryPlan,
    columns: string[],
    rows: QueryResponse["rows"],
  ): ExportCreated {
    const id = randomUUID();
    const downloadRef = randomToken();
    const filePath = path.join(this.database.exportDirectory, `${id}.csv`);
    const content = [
      columns.map(csvCell).join(","),
      ...rows.map((row) =>
        columns.map((column) => csvCell(row[column] ?? null)).join(","),
      ),
    ].join("\n");
    try {
      writeFileSync(filePath, `${content}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      const exportSummary = this.database.storeReadyExport({
        id,
        ownerId,
        plan,
        downloadRef,
        filePath,
        rowCount: rows.length,
      });
      return { export: exportSummary, downloadRef };
    } catch (error) {
      rmSync(filePath, { force: true });
      throw error;
    }
  }

  read(filePath: string): Uint8Array {
    return readFileSync(filePath);
  }

  /** Remove a newly created file if its enclosing database commit failed. */
  remove(id: string): void {
    rmSync(path.join(this.database.exportDirectory, `${id}.csv`), {
      force: true,
    });
  }
}
