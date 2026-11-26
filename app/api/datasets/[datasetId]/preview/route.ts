import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/app/lib/supabase/server";
import {
  DATASET_LIMITS,
  DatasetFileError,
  previewDatasetFile,
} from "@/app/lib/services/dataset-file-processor";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MIME_TYPES = {
  CSV: "text/csv",
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

function errorResponse(
  status: number,
  code: string,
  message: string
) {
  return NextResponse.json(
    {
      success: false,
      error: { code, message },
    },
    { status }
  );
}

function isValidStoragePath(
  storagePath: string,
  ownerId: string,
  originalFileName: string
): boolean {
  const safeFileName = originalFileName
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 255);

  if (!safeFileName) {
    return false;
  }

  const segments = storagePath.split("/");

  if (segments.length !== 3) {
    return false;
  }

  const [ownerFolder, uploadFolder, storedFileName] = segments;

  return (
    ownerFolder === ownerId &&
    UUID_PATTERN.test(uploadFolder) &&
    storedFileName === safeFileName
  );
}

function toSafeCount(value: number | string | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed = Number(value);

  return Number.isSafeInteger(parsed) && parsed >= 0
    ? parsed
    : null;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ datasetId: string }> }
) {
  try {
    const { datasetId } = await context.params;

    if (!UUID_PATTERN.test(datasetId)) {
      return errorResponse(
        400,
        "INVALID_DATASET_ID",
        "The supplied dataset ID is invalid."
      );
    }

    const limitValues = new URL(request.url).searchParams.getAll("limit");

    if (limitValues.length > 1) {
      return errorResponse(
        400,
        "INVALID_PREVIEW_LIMIT",
        "Provide only one preview limit."
      );
    }

    let limit: number = DATASET_LIMITS.previewRows;

    if (limitValues.length === 1) {
      const rawLimit = limitValues[0];

      if (!/^\d+$/.test(rawLimit)) {
        return errorResponse(
          400,
          "INVALID_PREVIEW_LIMIT",
          "Preview limit must be a whole number between 1 and 100."
        );
      }

      limit = Number(rawLimit);

      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100
      ) {
        return errorResponse(
          400,
          "INVALID_PREVIEW_LIMIT",
          "Preview limit must be a whole number between 1 and 100."
        );
      }
    }

    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return errorResponse(
        401,
        "UNAUTHORIZED",
        "You must be signed in to preview this dataset."
      );
    }

    // RLS determines whether this user owns or has been granted
    // access to the dataset. Do not filter by user_id here.
    const { data: dataset, error: datasetError } = await supabase
      .from("datasets")
      .select(
        "id, user_id, name, file_name, file_type, file_size, storage_path, row_count, column_count"
      )
      .eq("id", datasetId)
      .maybeSingle();

    if (datasetError) {
      console.error("Dataset preview metadata query failed:", datasetError);

      return errorResponse(
        500,
        "DATASET_LOOKUP_FAILED",
        "The dataset could not be retrieved."
      );
    }

    // Return the same response for missing and inaccessible datasets.
    if (!dataset) {
      return errorResponse(
        404,
        "DATASET_NOT_FOUND",
        "The requested dataset was not found."
      );
    }

    if (
      !UUID_PATTERN.test(dataset.user_id) ||
      typeof dataset.file_name !== "string" ||
      dataset.file_name.trim().length === 0 ||
      (dataset.file_type !== "CSV" && dataset.file_type !== "XLSX") ||
      typeof dataset.storage_path !== "string" ||
      !isValidStoragePath(
        dataset.storage_path,
        dataset.user_id,
        dataset.file_name
      )
    ) {
      console.error("Dataset preview rejected invalid stored metadata:", {
        datasetId,
      });

      return errorResponse(
        422,
        "INVALID_DATASET_METADATA",
        "The stored dataset metadata is invalid."
      );
    }

    const storedFileSize = Number(dataset.file_size);

    if (
      !Number.isSafeInteger(storedFileSize) ||
      storedFileSize <= 0 ||
      storedFileSize > DATASET_LIMITS.maxFileSize
    ) {
      return errorResponse(
        422,
        "INVALID_DATASET_SIZE",
        "The stored dataset file size is invalid."
      );
    }

    const { data: fileData, error: downloadError } = await supabase
      .storage
      .from("datasets")
      .download(dataset.storage_path);

    if (downloadError || !fileData) {
      console.error("Dataset preview download failed:", downloadError);

      return errorResponse(
        404,
        "DATASET_FILE_NOT_FOUND",
        "The dataset file could not be found."
      );
    }

    if (fileData.size === 0) {
      return errorResponse(
        422,
        "EMPTY_STORED_FILE",
        "The stored dataset file is empty."
      );
    }

    if (fileData.size > DATASET_LIMITS.maxFileSize) {
      return errorResponse(
        413,
        "FILE_TOO_LARGE",
        "The dataset file exceeds the allowed size."
      );
    }

    if (fileData.size !== storedFileSize) {
      return errorResponse(
        422,
        "DATASET_SIZE_MISMATCH",
        "The stored dataset file does not match its recorded size."
      );
    }

    const file = new File(
      [fileData],
      dataset.file_name,
      { type: MIME_TYPES[dataset.file_type as keyof typeof MIME_TYPES] }
    );

    const preview = await previewDatasetFile(file, limit);

    if (preview.fileType !== dataset.file_type) {
      return errorResponse(
        422,
        "DATASET_TYPE_MISMATCH",
        "The stored file does not match its recorded file type."
      );
    }

    const rowCount = toSafeCount(dataset.row_count);

    if (dataset.row_count !== null && rowCount === null) {
      return errorResponse(
        422,
        "INVALID_ROW_COUNT",
        "The stored dataset row count is invalid."
      );
    }

    return NextResponse.json({
      success: true,
      preview: {
        datasetId: dataset.id,
        name: dataset.name,
        fileName: preview.fileName,
        fileType: preview.fileType,
        rowCount,
        columnCount: preview.columnCount,
        columns: preview.columns,
        previewRows: preview.previewRows,
        ...(preview.worksheetName
          ? { worksheetName: preview.worksheetName }
          : {}),
      },
    });
  } catch (error) {
    if (error instanceof DatasetFileError) {
      return errorResponse(
        error.status,
        error.code,
        error.message
      );
    }

    console.error("Unexpected dataset preview error:", error);

    return errorResponse(
      500,
      "PREVIEW_FAILED",
      "An unexpected error occurred while generating the dataset preview."
    );
  }
}
