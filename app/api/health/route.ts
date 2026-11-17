
export async function GET() {
  return Response.json({
    success: true,
    message: "InsightHub backend is running.",
    service: "InsightHub API",
    status: "healthy"
  });
}

export async function POST(request: Request) {
  const body = await request.json();

  const { name, fileType } = body;

  if (!name || !fileType) {
    return Response.json(
      {
        success: false,
        message: "Dataset name and file type are required."
      },
      { status: 400 }
    );
  }

  return Response.json(
    {
      success: true,
      message: "Dataset information received.",
      dataset: {
        name,
        fileType
      }
    },
    { status: 201 }
  );
}
