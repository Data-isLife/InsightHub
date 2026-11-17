
import { DatasetSchema } from "@/app/lib/validations/dataset";

export async function POST(request: Request) {
  try {
    // 1. Read incoming JSON
    const body: unknown = await request.json();

    // 2. Validate incoming information
    const result = DatasetSchema.safeParse(body);

    // 3. Return validation errors
    if (!result.success) {
      return Response.json(
        {
          success: false,
          message: "Invalid dataset information.",
          errors: result.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message
          }))
        },
        { status: 400 }
      );
    }

    // 4. Work with validated information
    const dataset = result.data;

    // 5. Return successful response
    return Response.json(
      {
        success: true,
        message: "Dataset information validated successfully.",
        dataset
      },
      { status: 201 }
    );

  } catch (error) {
    // 6. Handle unexpected failures
    if (error instanceof SyntaxError) {
      return Response.json(
        {
          success: false,
          message: "Invalid JSON request body."
        },
        { status: 400 }
      );
    }

    console.error("Dataset API error:", error);

    return Response.json(
      {
        success: false,
        message: "An unexpected server error occurred."
      },
      { status: 500 }
    );
  }
}
