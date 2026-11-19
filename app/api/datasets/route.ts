
import { DatasetSchema } from "@/app/lib/validations/dataset";
import { prepareDataset } from "@/app/lib/services/dataset-service";

export async function POST(request: Request) {
  try {
    // 1. Receive incoming data
    const body: unknown = await request.json();

    // 2. Validate incoming data
    const result = DatasetSchema.safeParse(body);

    if (!result.success) {
      return Response.json(
        {
          success: false,
          message: "Invalid dataset information.",
          errors: result.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 }
      );
    }

    // 3. Delegate application logic to the service
    const dataset = prepareDataset(result.data);

    // 4. Return the result
    return Response.json(
      {
        success: true,
        message: "Dataset information prepared successfully.",
        dataset,
      },
      { status: 200 }
    );

  } catch (error) {
    // Handle malformed JSON
    if (error instanceof SyntaxError) {
      return Response.json(
        {
          success: false,
          message: "Invalid JSON request body.",
        },
        { status: 400 }
      );
    }

    // Log unexpected errors on the server
    console.error("Dataset API error:", error);

    return Response.json(
      {
        success: false,
        message: "An unexpected server error occurred.",
      },
      { status: 500 }
    );
  }
}
