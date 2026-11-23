
import { DatasetSchema } from "@/app/lib/validations/dataset";
import { processDatasetFile, DatasetFileError } from "@/app/lib/services/dataset-file-processor";
import { createClient } from "@/app/lib/supabase/server";

const STORAGE_BUCKET = "datasets";
const CSV_MIME_TYPE = "text/csv";
const XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function getFileType(fileName: string): "CSV" | "XLSX" | null {
  const extension = fileName.toLowerCase().split(".").pop();

  if (extension === "csv") return "CSV";
  if (extension === "xlsx") return "XLSX";

  return null;
}

function getSafeFileName(fileName: string): string {
  return fileName
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 255);
}

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return Response.json(
        { success: false, message: "Authentication required." },
        { status: 401 }
      );
    }

    // RLS determines which datasets this user may see.
    const { data: datasets, error } = await supabase
      .from("datasets")
      .select(
        "id, name, description, file_name, file_type, file_size, created_at, updated_at"
      )
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Dataset listing error:", error);

      return Response.json(
        { success: false, message: "Unable to retrieve datasets." },
        { status: 500 }
      );
    }

    return Response.json({
      success: true,
      datasets,
    });
  } catch (error) {
    console.error("Dataset listing error:", error);

    return Response.json(
      { success: false, message: "An unexpected server error occurred." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  let uploadedStoragePath: string | null = null;
  let supabase: Awaited<ReturnType<typeof createClient>> | null = null;

  try {
    supabase = await createClient();

    // 1. Authenticate the user using the server-side session.
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return Response.json(
        { success: false, message: "Authentication required." },
        { status: 401 }
      );
    }

    // 2. Receive multipart form data.
    const formData = await request.formData();

    const nameValue = formData.get("name");
    const descriptionValue = formData.get("description");
    const fileValue = formData.get("file");

    if (typeof nameValue !== "string") {
      return Response.json(
        { success: false, message: "Dataset name is required." },
        { status: 400 }
      );
    }

    if (
      descriptionValue !== null &&
      typeof descriptionValue !== "string"
    ) {
      return Response.json(
        { success: false, message: "Invalid dataset description." },
        { status: 400 }
      );
    }

    if (!(fileValue instanceof File)) {
      return Response.json(
        { success: false, message: "A dataset file is required." },
        { status: 400 }
      );
    }

    const file = fileValue;
    const fileType = getFileType(file.name);

    if (!fileType) {
      return Response.json(
        {
          success: false,
          message: "Only CSV and XLSX files are supported.",
        },
        { status: 400 }
      );
    }

    // 3. Validate metadata.
    const validation = DatasetSchema.safeParse({
      name: nameValue,
      fileType,
    });

    if (!validation.success) {
      return Response.json(
        {
          success: false,
          message: "Invalid dataset information.",
          errors: validation.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 }
      );
    }

    const description = descriptionValue?.trim() || null;

    if (description && description.length > 1000) {
      return Response.json(
        {
          success: false,
          message: "Description cannot exceed 1000 characters.",
        },
        { status: 400 }
      );
    }

    if (file.name.length > 255) {
      return Response.json(
        {
          success: false,
          message: "File name cannot exceed 255 characters.",
        },
        { status: 400 }
      );
    }

    // 4. Parse and validate the actual file contents.
    // Do not trust the browser-provided MIME type.
    const processed = await processDatasetFile(file);

    const safeFileName = getSafeFileName(file.name);

    if (!safeFileName) {
      return Response.json(
        { success: false, message: "Invalid file name." },
        { status: 400 }
      );
    }

    const contentType =
      processed.fileType === "CSV" ? CSV_MIME_TYPE : XLSX_MIME_TYPE;

    // 5. Upload to the authenticated user's private Storage folder.
    const storagePath = `${user.id}/${crypto.randomUUID()}/${safeFileName}`;

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, file, {
        contentType,
        upsert: false,
      });

    if (uploadError) {
      console.error("Dataset storage upload error:", uploadError);

      return Response.json(
        { success: false, message: "Unable to upload dataset file." },
        { status: 500 }
      );
    }

    uploadedStoragePath = storagePath;

    // 6. Insert metadata. Database defaults and RLS handle ownership.
    const { data: dataset, error: databaseError } = await supabase
      .from("datasets")
      .insert({
        name: validation.data.name,
        description,
        file_name: file.name,
        file_type: processed.fileType,
        file_size: file.size,
        row_count: processed.rowCount,
        column_count: processed.columnCount,
        storage_path: storagePath,
      })
      .select(
        "id, name, description, file_name, file_type, file_size, row_count, column_count, created_at, updated_at"
      )
      .single();

    if (databaseError) {
      console.error("Dataset database insertion error:", databaseError);

      // 7. Compensating cleanup if metadata insertion fails.
      const { error: cleanupError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([storagePath]);

      if (cleanupError) {
        console.error("Dataset storage cleanup failed:", cleanupError);
      }

      uploadedStoragePath = null;

      return Response.json(
        {
          success: false,
          message: "Dataset metadata could not be saved.",
        },
        { status: 500 }
      );
    }

    uploadedStoragePath = null;

    return Response.json(
      {
        success: true,
        message: "Dataset uploaded successfully.",
        dataset,
        processing: {
          rowCount: processed.rowCount,
          columnCount: processed.columnCount,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    // Clean up an uploaded object if an unexpected failure occurs later.
    if (uploadedStoragePath && supabase) {
      const { error: cleanupError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([uploadedStoragePath]);

      if (cleanupError) {
        console.error("Dataset storage cleanup failed:", cleanupError);
      }
    }

    if (error instanceof DatasetFileError) {
      return Response.json(
        {
          success: false,
          message: error.message,
          code: error.code,
        },
        { status: error.status }
      );
    }

    console.error("Dataset API error:", error);

    return Response.json(
      { success: false, message: "An unexpected server error occurred." },
      { status: 500 }
    );
  }
}
