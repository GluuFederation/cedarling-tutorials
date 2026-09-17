import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { ExportCreated, QueryPlan } from "../shared/contracts.ts";
import { randomToken } from "./crypto.ts";
import type { AppDatabase, QueryEvaluation } from "./database.ts";

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export class ExportService {
  private readonly database: AppDatabase;

  constructor(database: AppDatabase) {
    this.database = database;
    mkdirSync(database.exportDirectory, { recursive: true, mode: 0o700 });
    this.removeOrphanedFiles();
  }

  create(
    ownerId: string,
    plan: QueryPlan,
    columns: string[],
    evaluation: QueryEvaluation,
  ): ExportCreated {
    const id = randomUUID();
    const downloadRef = randomToken();
    const filePath = path.join(this.database.exportDirectory, `${id}.csv`);
    const content = [
      columns.map(csvCell).join(","),
      ...evaluation.rows.map((row) =>
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
        rowCount: evaluation.rows.length,
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

  private removeOrphanedFiles(): void {
    const referenced = this.database.referencedExportFiles();
    for (const entry of readdirSync(this.database.exportDirectory, {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith(".csv")) continue;
      const filePath = path.join(this.database.exportDirectory, entry.name);
      if (!referenced.has(filePath)) rmSync(filePath, { force: true });
    }
  }
}
