
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";

import {
  DatasetFileError,
  processDatasetFile,
} from "./dataset-file-processor";

function createCsvFile(
  content: string,
  name = "sample.csv",
): File {
  return new File([content], name, {
    type: "text/csv",
  });
}

describe("processDatasetFile", () => {
  it("parses CSV headers, rows and quoted values", async () => {
    const file = createCsvFile(
      'Name,Age,Location\n"James, Otieno",24,Nairobi\nMary,22,Mombasa',
    );

    const result = await processDatasetFile(file);

    expect(result.fileType).toBe("CSV");
    expect(result.rowCount).toBe(2);
    expect(result.columnCount).toBe(3);
    expect(result.columns).toEqual([
      "Name",
      "Age",
      "Location",
    ]);

    expect(result.previewRows[0]).toEqual({
      Name: "James, Otieno",
      Age: "24",
      Location: "Nairobi",
    });
  });

  it("supports duplicate and empty column names", async () => {
    const file = createCsvFile(
      "Name,Name,\nJames,Otieno,Kenya",
    );

    const result = await processDatasetFile(file);

    expect(result.columns).toEqual([
      "Name",
      "Name_2",
      "column_3",
    ]);
  });

  it("supports UTF-8 BOM files", async () => {
    const file = createCsvFile(
      "\uFEFFName,Age\nJames,24",
    );

    const result = await processDatasetFile(file);

    expect(result.columns[0]).toBe("Name");
    expect(result.rowCount).toBe(1);
  });

  it("rejects inconsistent CSV rows", async () => {
    const file = createCsvFile(
      "Name,Age\nJames,24,Nairobi",
    );

    await expect(
      processDatasetFile(file),
    ).rejects.toMatchObject({
      code: "INCONSISTENT_COLUMNS",
    });
  });

  it("rejects unsupported file types", async () => {
    const file = createCsvFile(
      "Name,Age\nJames,24",
      "sample.txt",
    );

    await expect(
      processDatasetFile(file),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_FILE_TYPE",
    });
  });

  it("rejects empty files", async () => {
    const file = createCsvFile("");

    await expect(
      processDatasetFile(file),
    ).rejects.toMatchObject({
      code: "EMPTY_FILE",
    });
  });

  it("rejects CSV files containing only headers", async () => {
    const file = createCsvFile("Name,Age");

    await expect(
      processDatasetFile(file),
    ).rejects.toMatchObject({
      code: "EMPTY_DATASET",
    });
  });

  it("processes Excel worksheets", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Customers");

    worksheet.addRow(["Name", "Age", "Location"]);
    worksheet.addRow(["James", 24, "Nairobi"]);
    worksheet.addRow(["Mary", 22, "Mombasa"]);

    const buffer = await workbook.xlsx.writeBuffer();

    const file = new File(
      [new Uint8Array(buffer)],
      "customers.xlsx",
      {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    );

    const result = await processDatasetFile(file);

    expect(result.fileType).toBe("XLSX");
    expect(result.rowCount).toBe(2);
    expect(result.columnCount).toBe(3);

    expect(result.previewRows[0]).toEqual({
      Name: "James",
      Age: 24,
      Location: "Nairobi",
    });
  });

  it("rejects an XLSX file without a valid ZIP signature", async () => {
    const file = new File(
      ["This is not an Excel workbook"],
      "invalid.xlsx",
    );

    await expect(
      processDatasetFile(file),
    ).rejects.toMatchObject({
      code: "INVALID_FILE_SIGNATURE",
    });
  });

  it("returns a structured error for invalid files", async () => {
    const file = createCsvFile("");

    try {
      await processDatasetFile(file);
    } catch (error) {
      expect(error).toBeInstanceOf(DatasetFileError);
    }
  });
});

describe("previewDatasetFile", () => {
  it("returns only the requested number of CSV rows", async () => {
    const file = createCsvFile(
      "Name,Age\nJames,24\nMary,22\nPeter,30\nGrace,27",
    );

    const { previewDatasetFile } = await import("./dataset-file-processor");
    const result = await previewDatasetFile(file, 2);

    expect(result.fileType).toBe("CSV");
    expect(result.columns).toEqual(["Name", "Age"]);
    expect(result.previewRows).toHaveLength(2);
    expect(result.previewRows[1]).toEqual({
      Name: "Mary",
      Age: "22",
    });
    expect(result).not.toHaveProperty("rowCount");
  });

  it("returns only the requested number of XLSX rows", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Customers");

    worksheet.addRow(["Name", "Age"]);
    worksheet.addRow(["James", 24]);
    worksheet.addRow(["Mary", 22]);
    worksheet.addRow(["Peter", 30]);

    const buffer = await workbook.xlsx.writeBuffer();
    const file = new File(
      [new Uint8Array(buffer)],
      "customers.xlsx",
      {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    );

    const { previewDatasetFile } = await import("./dataset-file-processor");
    const result = await previewDatasetFile(file, 2);

    expect(result.fileType).toBe("XLSX");
    expect(result.previewRows).toHaveLength(2);
    expect(result.previewRows[0]).toEqual({
      Name: "James",
      Age: 24,
    });
  });

  it("rejects preview limits outside the allowed range", async () => {
    const file = createCsvFile("Name,Age\nJames,24");
    const { previewDatasetFile } = await import("./dataset-file-processor");

    await expect(
      previewDatasetFile(file, 0),
    ).rejects.toMatchObject({
      code: "MALFORMED_FILE",
    });

    await expect(
      previewDatasetFile(file, 101),
    ).rejects.toMatchObject({
      code: "MALFORMED_FILE",
    });
  });
});
