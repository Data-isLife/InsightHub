
import { DatasetSchema } from "@/app/lib/validations/dataset";
import { createClient } from "@/app/lib/supabase/server";

const STORAGE_BUCKET = "datasets";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorResponse(error: string, status: number) {
  return Response.json(
    { success: false, error },
    { status }
  );
}

async function getAuthenticatedUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { supabase, user: null };
  }

  return { supabase, user };
}

type RouteContext = {
  params: Promise<{ datasetId: string }>;
};

/**
 * Rename a dataset.
 * Only the dataset owner is allowed to perform this operation.
 */
export async function PATCH(request: Request, context: RouteContext) {
  const { supabase, user } = await getAuthenticatedUser();

  if (!user) {
    return errorResponse("Authentication required.", 401);
  }

  const { datasetId } = await context.params;

  if (!UUID_REGEX.test(datasetId)) {
    return errorResponse("Invalid dataset ID.", 400);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid request body.", 400);
  }

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return errorResponse("Invalid request body.", 400);
  }

  const { data: dataset, error: lookupError } = await supabase
    .from("datasets")
    .select("id, user_id, file_type")
    .eq("id", datasetId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (lookupError) {
    console.error("Dataset rename lookup failed:", lookupError);
    return errorResponse("Unable to access this dataset.", 500);
  }

  if (!dataset) {
    return errorResponse("Dataset not found or access denied.", 404);
  }

  const input = body as Record<string, unknown>;

  const validation = DatasetSchema.safeParse({
    name: input.name,
    fileType: dataset.file_type,
  });

  if (!validation.success) {
    return errorResponse(
      validation.error.issues[0]?.message ?? "Invalid dataset name.",
      400
    );
  }

  const { data: updatedDataset, error: updateError } = await supabase
    .from("datasets")
    .update({ name: validation.data.name })
    .eq("id", datasetId)
    .eq("user_id", user.id)
    .select("id, name, updated_at")
    .maybeSingle();

  if (updateError) {
    console.error("Dataset rename failed:", updateError);
    return errorResponse("Unable to rename this dataset.", 500);
  }

  if (!updatedDataset) {
    return errorResponse("Dataset not found or access denied.", 404);
  }

  return Response.json({
    success: true,
    dataset: updatedDataset,
  });
}

/**
 * Delete a dataset.
 *
 * Storage is removed before database metadata.
 * If metadata deletion fails, a retry can safely finish the operation
 * because an already-missing storage file is treated as removed.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  const { supabase, user } = await getAuthenticatedUser();

  if (!user) {
    return errorResponse("Authentication required.", 401);
  }

  const { datasetId } = await context.params;

  if (!UUID_REGEX.test(datasetId)) {
    return errorResponse("Invalid dataset ID.", 400);
  }

  const { data: dataset, error: lookupError } = await supabase
    .from("datasets")
    .select("id, user_id, storage_path, file_name")
    .eq("id", datasetId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (lookupError) {
    console.error("Dataset deletion lookup failed:", lookupError);
    return errorResponse("Unable to access this dataset.", 500);
  }

  if (!dataset) {
    return errorResponse("Dataset not found or access denied.", 404);
  }

  // Never accept a storage path from the client.
  // Validate the database path before using it.
  const pathSegments = dataset.storage_path.split("/");

  if (
    pathSegments.length !== 3 ||
    pathSegments[0] !== user.id ||
    !UUID_REGEX.test(pathSegments[1]) ||
    !pathSegments[2] ||
    pathSegments[2] !== dataset.file_name
  ) {
    console.error("Dataset deletion rejected invalid storage metadata:", {
      datasetId,
    });

    return errorResponse("Dataset storage metadata is invalid.", 500);
  }

  const folderPath = `${pathSegments[0]}/${pathSegments[1]}`;
  const fileName = pathSegments[2];

  // Each dataset has its own folder containing its uploaded file.
  // A missing file is safe to treat as already removed during a retry.
  const { data: storedFiles, error: listError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .list(folderPath, {
      limit: 100,
      search: fileName,
    });

  if (listError) {
    console.error("Dataset storage lookup failed:", listError);
    return errorResponse("Unable to verify the stored dataset file.", 500);
  }

  const fileExists = (storedFiles ?? []).some(
    (file) => file.name === fileName
  );

  if (fileExists) {
    const { error: storageError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove([dataset.storage_path]);

    if (storageError) {
      console.error("Dataset storage deletion failed:", storageError);
      return errorResponse("Unable to delete the stored dataset file.", 500);
    }
  }

  // Remove the database record only after storage removal succeeds
  // or the file has been confirmed absent.
  const { data: deletedDataset, error: deleteError } = await supabase
    .from("datasets")
    .delete()
    .eq("id", datasetId)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (deleteError) {
    console.error("Dataset metadata deletion failed:", deleteError);

    return errorResponse(
      "The file was removed, but dataset cleanup could not finish. Please retry.",
      500
    );
  }

  if (!deletedDataset) {
    return errorResponse("Dataset not found or access denied.", 404);
  }

  return Response.json({
    success: true,
    message: "Dataset deleted successfully.",
  });
}
