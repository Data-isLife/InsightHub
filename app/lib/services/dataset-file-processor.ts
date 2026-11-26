
import { Readable } from "node:stream";
import { parse } from "csv-parse";
import ExcelJS from "exceljs";

export const DATASET_LIMITS = {
  maxFileSize: 50 * 1024 * 1024,
  maxRows: 1_000_000,
  maxColumns: 16_384,
  maxCsvRecordSize: 1024 * 1024,
  previewRows: 25,
} as const;

export type DatasetFileType = "CSV" | "XLSX";

export type DatasetCellValue = string | number | boolean | null;

export type ProcessedDataset = {
  fileName: string;
  fileType: DatasetFileType;
  rowCount: number;
  columnCount: number;
  columns: string[];
  previewRows: Record<string, DatasetCellValue>[];
  worksheetName?: string;
};

export type DatasetFileErrorCode =
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FILE_TYPE"
  | "INVALID_FILE_SIGNATURE"
  | "MALFORMED_FILE"
  | "EMPTY_DATASET"
  | "TOO_MANY_ROWS"
  | "TOO_MANY_COLUMNS"
  | "INCONSISTENT_COLUMNS";

export class DatasetFileError extends Error {
  constructor(
    public readonly code: DatasetFileErrorCode,
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "DatasetFileError";
  }
}

function getFileType(fileName: string): DatasetFileType {
  const extension = fileName.split(".").pop()?.toLowerCase();

  if (extension === "csv") return "CSV";
  if (extension === "xlsx") return "XLSX";

  throw new DatasetFileError(
    "UNSUPPORTED_FILE_TYPE",
    "Only CSV and XLSX files are supported.",
  );
}

function validateFileBasics(file: File): DatasetFileType {
  if (!file || typeof file.size !== "number") {
    throw new DatasetFileError(
      "EMPTY_FILE",
      "A valid file is required.",
    );
  }

  if (file.size === 0) {
    throw new DatasetFileError(
      "EMPTY_FILE",
      "The uploaded file is empty.",
    );
  }

  if (file.size > DATASET_LIMITS.maxFileSize) {
    throw new DatasetFileError(
      "FILE_TOO_LARGE",
      "The file exceeds the maximum allowed size of 50 MB.",
      413,
    );
  }

  return getFileType(file.name);
}

async function validateXlsxSignature(file: File): Promise<void> {
  const header = new Uint8Array(
    await file.slice(0, 4).arrayBuffer(),
  );

  // An XLSX workbook is a ZIP archive.
  const isZip =
    header[0] === 0x50 &&
    header[1] === 0x4b &&
    header[2] === 0x03 &&
    header[3] === 0x04;

  if (!isZip) {
    throw new DatasetFileError(
      "INVALID_FILE_SIGNATURE",
      "The file does not contain a valid XLSX signature.",
    );
  }
}

function makeUniqueHeaders(values: unknown[]): string[] {
  const used = new Map<string, number>();

  return values.map((value, index) => {
    const original =
      value === null || value === undefined
        ? ""
        : String(value).trim();

    const base = original || `column_${index + 1}`;
    const count = used.get(base) ?? 0;

    used.set(base, count + 1);

    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

function isEmptyRecord(values: unknown[]): boolean {
  return values.every(
    (value) =>
      value === null ||
      value === undefined ||
      String(value).trim() === "",
  );
}

function toCellValue(value: unknown): DatasetCellValue {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    const cell = value as Record<string, unknown>;

    // Formula cells.
    if ("result" in cell) {
      return toCellValue(cell.result);
    }

    // Hyperlink cells.
    if ("text" in cell && typeof cell.text === "string") {
      return cell.text;
    }

    // Rich-text cells.
    if (Array.isArray(cell.richText)) {
      return cell.richText
        .map((part) => {
          if (
            typeof part === "object" &&
            part !== null &&
            "text" in part
          ) {
            return String(part.text ?? "");
          }

          return "";
        })
        .join("");
    }

    // Excel error cells.
    if ("error" in cell) {
      return String(cell.error);
    }
  }

  return String(value);
}

function createPreviewRow(
  headers: string[],
  values: unknown[],
): Record<string, DatasetCellValue> {
  return Object.fromEntries(
    headers.map((header, index) => [
      header,
      toCellValue(values[index]),
    ]),
  );
}

function createNodeStream(file: File): Readable {
  return Readable.from(
    file.stream() as unknown as AsyncIterable<Uint8Array>,
  );
}

async function processCsv(
  file: File,
): Promise<ProcessedDataset> {
  const source = createNodeStream(file);

  const parser = parse({
    bom: true,
    encoding: "utf8",
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    max_record_size: DATASET_LIMITS.maxCsvRecordSize,
  });

  source.on("error", (error) => {
    parser.destroy(error);
  });

  source.pipe(parser);

  let headers: string[] | null = null;
  let rowCount = 0;

  const previewRows: Record<string, DatasetCellValue>[] = [];

  try {
    for await (const rawRecord of parser) {
      const record = rawRecord as unknown[];

      if (isEmptyRecord(record)) continue;

      if (!headers) {
        if (record.length > DATASET_LIMITS.maxColumns) {
          throw new DatasetFileError(
            "TOO_MANY_COLUMNS",
            "The CSV file contains too many columns.",
          );
        }

        headers = makeUniqueHeaders(record);
        continue;
      }

      if (record.length !== headers.length) {
        throw new DatasetFileError(
          "INCONSISTENT_COLUMNS",
          `A CSV row has ${record.length} fields, but ${headers.length} were expected.`,
        );
      }

      rowCount++;

      if (rowCount > DATASET_LIMITS.maxRows) {
        throw new DatasetFileError(
          "TOO_MANY_ROWS",
          "The dataset exceeds the maximum allowed number of rows.",
        );
      }

      if (previewRows.length < DATASET_LIMITS.previewRows) {
        previewRows.push(createPreviewRow(headers, record));
      }
    }
  } catch (error) {
    if (error instanceof DatasetFileError) throw error;

    throw new DatasetFileError(
      "MALFORMED_FILE",
      "The CSV file could not be parsed. Check its encoding, quoting and structure.",
    );
  }

  if (!headers || headers.length === 0) {
    throw new DatasetFileError(
      "EMPTY_DATASET",
      "No column headers were found in the CSV file.",
    );
  }

  if (rowCount === 0) {
    throw new DatasetFileError(
      "EMPTY_DATASET",
      "The CSV file contains headers but no data rows.",
    );
  }

  return {
    fileName: file.name,
    fileType: "CSV",
    rowCount,
    columnCount: headers.length,
    columns: headers,
    previewRows,
  };
}

function getExcelRowValues(row: ExcelJS.Row): unknown[] {
  return Array.from(
    { length: row.cellCount },
    (_, index) => row.getCell(index + 1).value,
  );
}

async function processXlsx(
  file: File,
): Promise<ProcessedDataset> {
  await validateXlsxSignature(file);

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());

    for (const worksheet of workbook.worksheets) {
      let headers: string[] | null = null;
      let rowCount = 0;
      const previewRows: Record<string, DatasetCellValue>[] = [];

      for (
        let rowNumber = 1;
        rowNumber <= worksheet.rowCount;
        rowNumber++
      ) {
        const row = worksheet.getRow(rowNumber);
        const values = getExcelRowValues(row);

        if (isEmptyRecord(values)) continue;

        if (!headers) {
          if (values.length > DATASET_LIMITS.maxColumns) {
            throw new DatasetFileError(
              "TOO_MANY_COLUMNS",
              "The Excel worksheet contains too many columns.",
            );
          }

          headers = makeUniqueHeaders(values);
          continue;
        }

        if (values.length > headers.length) {
          throw new DatasetFileError(
            "INCONSISTENT_COLUMNS",
            "An Excel row contains more columns than the header row.",
          );
        }

        rowCount++;

        if (rowCount > DATASET_LIMITS.maxRows) {
          throw new DatasetFileError(
            "TOO_MANY_ROWS",
            "The worksheet exceeds the maximum allowed number of rows.",
          );
        }

        if (previewRows.length < DATASET_LIMITS.previewRows) {
          previewRows.push(createPreviewRow(headers, values));
        }
      }

      // Use the first worksheet containing headers and data.
      if (headers && rowCount > 0) {
        return {
          fileName: file.name,
          fileType: "XLSX",
          rowCount,
          columnCount: headers.length,
          columns: headers,
          previewRows,
        };
      }
    }
  } catch (error) {
    if (error instanceof DatasetFileError) throw error;

    throw new DatasetFileError(
      "MALFORMED_FILE",
      "The Excel workbook could not be read. It may be corrupted or invalid.",
    );
  }

  throw new DatasetFileError(
    "EMPTY_DATASET",
    "No worksheet containing both headers and data was found.",
  );
}
export async function processDatasetFile(
  file: File,
): Promise<ProcessedDataset> {
  const fileType = validateFileBasics(file);

  if (fileType === "CSV") {
    return processCsv(file);
  }

  return processXlsx(file);
}

export type DatasetPreview = {
  fileName: string;
  fileType: DatasetFileType;
  columnCount: number;
  columns: string[];
  previewRows: Record<string, DatasetCellValue>[];
  worksheetName?: string;
};

/**
 * Reads only the requested number of data rows.
 * This is deliberately separate from processDatasetFile(), which scans
 * the complete file to calculate accurate total row counts.
 */
export async function previewDatasetFile(
  file: File,
  limit: number = DATASET_LIMITS.previewRows,
): Promise<DatasetPreview> {
  const fileType = validateFileBasics(file);

  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw new DatasetFileError(
      "MALFORMED_FILE",
      "The preview row limit must be between 1 and 100.",
    );
  }

  if (fileType === "XLSX") {
    await validateXlsxSignature(file);

    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());

      for (const worksheet of workbook.worksheets) {
        let headers: string[] | null = null;
        const previewRows: Record<string, DatasetCellValue>[] = [];

        for (
          let rowNumber = 1;
          rowNumber <= worksheet.rowCount;
          rowNumber++
        ) {
          const row = worksheet.getRow(rowNumber);
          const values = getExcelRowValues(row);

          if (isEmptyRecord(values)) continue;

          if (!headers) {
            if (values.length > DATASET_LIMITS.maxColumns) {
              throw new DatasetFileError(
                "TOO_MANY_COLUMNS",
                "The Excel worksheet contains too many columns.",
              );
            }

            headers = makeUniqueHeaders(values);
            continue;
          }

          if (values.length > headers.length) {
            throw new DatasetFileError(
              "INCONSISTENT_COLUMNS",
              "An Excel row contains more columns than the header row.",
            );
          }

          if (previewRows.length < limit) {
            previewRows.push(createPreviewRow(headers, values));
          }

          if (previewRows.length >= limit) break;
        }

        if (headers && previewRows.length > 0) {
          return {
            fileName: file.name,
            fileType: "XLSX",
            columnCount: headers.length,
            columns: headers,
            previewRows,
          };
        }
      }
    } catch (error) {

    if (error instanceof DatasetFileError) throw error;

    throw new DatasetFileError(
      "MALFORMED_FILE",
      "The Excel workbook could not be read. It may be corrupted or invalid.",
    );
  }

    throw new DatasetFileError(
      "EMPTY_DATASET",
      "No worksheet containing both headers and data was found.",
    );
  }
  const source = createNodeStream(file);

  const parser = parse({
    bom: true,
    encoding: "utf8",
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    max_record_size: DATASET_LIMITS.maxCsvRecordSize,
  });

  source.on("error", (error) => {
    parser.destroy(error);
  });

  source.pipe(parser);

  let headers: string[] | null = null;
  const previewRows: Record<string, DatasetCellValue>[] = [];

  try {
    for await (const rawRecord of parser) {
      const record = rawRecord as unknown[];

      if (isEmptyRecord(record)) continue;

      if (!headers) {
        if (record.length > DATASET_LIMITS.maxColumns) {
          throw new DatasetFileError(
            "TOO_MANY_COLUMNS",
            "The CSV file contains too many columns.",
          );
        }

        headers = makeUniqueHeaders(record);
        continue;
      }

      if (record.length !== headers.length) {
        throw new DatasetFileError(
          "INCONSISTENT_COLUMNS",
          `A CSV row has ${record.length} fields, but ${headers.length} were expected.`,
        );
      }

      previewRows.push(createPreviewRow(headers, record));

      if (previewRows.length >= limit) break;
    }
  } catch (error) {
    if (error instanceof DatasetFileError) throw error;

    throw new DatasetFileError(
      "MALFORMED_FILE",
      "The CSV file could not be parsed. Check its encoding, quoting and structure.",
    );
  }

  if (!headers || headers.length === 0 || previewRows.length === 0) {
    throw new DatasetFileError(
      "EMPTY_DATASET",
      "The file must contain column headers and at least one data row.",
    );
  }

  return {
    fileName: file.name,
    fileType: "CSV",
    columnCount: headers.length,
    columns: headers,
    previewRows,
  };
}
