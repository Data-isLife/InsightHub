import {
  DATASET_LIMITS,
  processDatasetFile,
} from "@/app/lib/services/dataset-file-processor";
import { createClient } from "@/app/lib/supabase/server";

const STORAGE_BUCKET = "datasets";
const MAX_BATCH_SIZE = 3;

type RecoveryResult = {
  datasetId: string;
  name: string;
  status: "recovered" | "failed" | "skipped";
  rowCount?: number;
  columnCount?: number;
  message?: string;
};

type FailureStage = "validation" | "download" | "processing" | "saving";

function getSafeFailureMessage(stage: FailureStage): string {
  switch (stage) {
    case "validation":
      return "The stored dataset metadata or file format is invalid.";
    case "download":
      return "The original file could not be retrieved from secure storage.";
    case "processing":
      return "The original file could not be processed. Check that it is valid and within supported limits.";
    case "saving":
      return "Statistics were calculated, but could not be saved to the dataset record.";
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return Response.json(
        { success: false, message: "Authentication required." },
        { status: 401 },
      );
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return Response.json(
        { success: false, message: "Invalid request body." },
        { status: 400 },
      );
    }

    const datasetIds =
      typeof body === "object" &&
      body !== null &&
      "datasetIds" in body &&
      Array.isArray(body.datasetIds)
        ? body.datasetIds
        : null;

    if (
      !datasetIds ||
      datasetIds.length < 1 ||
      datasetIds.length > MAX_BATCH_SIZE ||
      !datasetIds.every(
        (id) =>
          typeof id === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
      ) ||
      new Set(datasetIds).size !== datasetIds.length
    ) {
      return Response.json(
        {
          success: false,
          message: `Provide between 1 and ${MAX_BATCH_SIZE} unique valid dataset IDs.`,
        },
        { status: 400 },
      );
    }

    const { data: datasets, error: queryError } = await supabase
      .from("datasets")
      .select(
        "id, user_id, name, file_name, file_type, storage_path, row_count, column_count",
      )
      .eq("user_id", user.id)
      .in("id", datasetIds);

    if (queryError) {
      console.error("Dataset recovery query error:", queryError);

      return Response.json(
        {
          success: false,
          message: "Unable to retrieve datasets for recovery.",
        },
        { status: 500 },
      );
    }

    if (!datasets || datasets.length !== datasetIds.length) {
      return Response.json(
        {
          success: false,
          message: "One or more datasets were not found or are not owned by you.",
        },
        { status: 404 },
      );
    }

    const results: RecoveryResult[] = [];

    for (const dataset of datasets) {
      if (
        dataset.row_count !== null &&
        dataset.column_count !== null
      ) {
        results.push({
          datasetId: dataset.id,
          name: dataset.name,
          status: "skipped",
          message: "Both statistics are already available.",
        });

        continue;
      }

      let failureStage: FailureStage = "validation";

      try {
        if (
          dataset.file_type !== "CSV" &&
          dataset.file_type !== "XLSX"
        ) {
          throw new Error("Unsupported stored file type.");
        }

        if (
          !dataset.storage_path ||
          !dataset.file_name
        ) {
          throw new Error("Required file metadata is missing.");
        }

        failureStage = "download";

        const { data: fileData, error: downloadError } =
          await supabase.storage
            .from(STORAGE_BUCKET)
            .download(dataset.storage_path);

        if (downloadError || !fileData) {
          throw new Error(
            downloadError?.message ??
              "Original file could not be downloaded.",
          );
        }

        if (
          fileData.size === 0 ||
          fileData.size > DATASET_LIMITS.maxFileSize
        ) {
          throw new Error("Stored file is empty or exceeds the supported size.");
        }

        const mimeType =
          dataset.file_type === "CSV"
            ? "text/csv"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

        const file = new File([fileData], dataset.file_name, {
          type: mimeType,
        });

        failureStage = "processing";

        const processed = await processDatasetFile(file);

        if (processed.fileType !== dataset.file_type) {
          throw new Error(
            "Processed file type does not match the stored dataset record.",
          );
        }

        const validRowCount =
          Number.isSafeInteger(processed.rowCount) &&
          processed.rowCount >= 0 &&
          processed.rowCount <= DATASET_LIMITS.maxRows;

        const validColumnCount =
          Number.isSafeInteger(processed.columnCount) &&
          processed.columnCount >= 0 &&
          processed.columnCount <= DATASET_LIMITS.maxColumns;

        if (!validRowCount || !validColumnCount) {
          throw new Error("The processor returned invalid dataset statistics.");
        }

        failureStage = "saving";

        const { error: updateError } = await supabase.rpc(
          "update_owned_dataset_statistics",
          {
            p_dataset_id: dataset.id,
            p_row_count: processed.rowCount,
            p_column_count: processed.columnCount,
          },
        );

        if (updateError) {
          throw new Error(updateError.message);
        }

        results.push({
          datasetId: dataset.id,
          name: dataset.name,
          status: "recovered",
          rowCount: processed.rowCount,
          columnCount: processed.columnCount,
        });
      } catch (error) {
        console.error("Dataset statistics recovery failed:", {
          datasetId: dataset.id,
          stage: failureStage,
          error,
        });

        results.push({
          datasetId: dataset.id,
          name: dataset.name,
          status: "failed",
          message: getSafeFailureMessage(failureStage),
        });
      }
    }

    return Response.json({
      success: true,
      results,
      recovered: results.filter(
        (item) => item.status === "recovered",
      ).length,
      failed: results.filter(
        (item) => item.status === "failed",
      ).length,
      skipped: results.filter(
        (item) => item.status === "skipped",
      ).length,
    });
  } catch (error) {
    console.error("Dataset statistics recovery error:", error);

    return Response.json(
      {
        success: false,
        message: "An unexpected error occurred during statistics recovery.",
      },
      { status: 500 },
    );
  }
}