import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  createClientMock,
  previewDatasetFileMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  previewDatasetFileMock: vi.fn(),
}));

vi.mock("@/app/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

vi.mock("@/app/lib/services/dataset-file-processor", () => ({
  DATASET_LIMITS: {
    maxFileSize: 50 * 1024 * 1024,
    previewRows: 25,
  },
  DatasetFileError: class DatasetFileError extends Error {
    code: string;
    status: number;

    constructor(
      message: string,
      code = "MALFORMED_FILE",
      status = 400
    ) {
      super(message);
      this.name = "DatasetFileError";
      this.code = code;
      this.status = status;
    }
  },
  previewDatasetFile: previewDatasetFileMock,
}));

import { GET } from "@/app/api/datasets/[datasetId]/preview/route";

const DATASET_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const SHARED_USER_ID = "33333333-3333-4333-8333-333333333333";
const UPLOAD_ID = "44444444-4444-4444-8444-444444444444";

const dataset = {
  id: DATASET_ID,
  user_id: OWNER_ID,
  name: "Customer Records",
  file_name: "customers.csv",
  file_type: "CSV",
  file_size: 10,
  storage_path: `${OWNER_ID}/${UPLOAD_ID}/customers.csv`,
  row_count: 42,
  column_count: 2,
};

const previewResult = {
  fileName: "customers.csv",
  fileType: "CSV" as const,
  columnCount: 2,
  columns: ["Name", "Age"],
  previewRows: [
    { Name: "Alice", Age: 25 },
    { Name: "Brian", Age: 31 },
  ],
};

function makeRequest(path = "", datasetId = DATASET_ID) {
  return new NextRequest(
    `http://localhost/api/datasets/${datasetId}/preview${path}`
  );
}

function makeContext(datasetId = DATASET_ID) {
  return {
    params: Promise.resolve({ datasetId }),
  };
}

function configureSupabase(options: {
  user?: { id: string } | null;
  datasetResult?: typeof dataset | null;
  queryError?: { message: string } | null;
  downloadError?: { message: string } | null;
  fileData?: Blob | null;
} = {}) {
  const {
    user = { id: OWNER_ID },
    datasetResult = dataset,
    queryError = null,
    downloadError = null,
    fileData = new Blob(["1234567890"]),
  } = options;

  const maybeSingle = vi.fn().mockResolvedValue({
    data: datasetResult,
    error: queryError,
  });

  const eq = vi.fn().mockReturnValue({ maybeSingle });

  const select = vi.fn().mockReturnValue({ eq });

  const from = vi.fn().mockReturnValue({ select });

  const download = vi.fn().mockResolvedValue({
    data: fileData,
    error: downloadError,
  });

  const storageFrom = vi.fn().mockReturnValue({ download });

  createClientMock.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: null,
      }),
    },
    from,
    storage: {
      from: storageFrom,
    },
  });

  return {
    from,
    select,
    eq,
    maybeSingle,
    storageFrom,
    download,
  };
}

async function responseJson(response: Response) {
  return response.json();
}

describe("GET /api/datasets/[datasetId]/preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    previewDatasetFileMock.mockResolvedValue(previewResult);
  });

  it("rejects invalid dataset IDs before authentication", async () => {
    const response = await GET(
      makeRequest("", "invalid-id"),
      makeContext("invalid-id")
    );

    expect(response.status).toBe(400);

    expect(await responseJson(response)).toMatchObject({
      success: false,
      error: { code: "INVALID_DATASET_ID" },
    });

    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated users", async () => {
    configureSupabase({ user: null });

    const response = await GET(
      makeRequest(),
      makeContext()
    );

    expect(response.status).toBe(401);

    expect(await responseJson(response)).toMatchObject({
      success: false,
      error: { code: "UNAUTHORIZED" },
    });
  });

  it("returns 404 when the dataset is missing or inaccessible through RLS", async () => {
    configureSupabase({ datasetResult: null });

    const response = await GET(
      makeRequest(),
      makeContext()
    );

    expect(response.status).toBe(404);

    expect(await responseJson(response)).toMatchObject({
      success: false,
      error: { code: "DATASET_NOT_FOUND" },
    });
  });

  it("rejects invalid preview limits", async () => {
    configureSupabase();

    const response = await GET(
      makeRequest("?limit=101"),
      makeContext()
    );

    expect(response.status).toBe(400);

    expect(await responseJson(response)).toMatchObject({
      success: false,
      error: { code: "INVALID_PREVIEW_LIMIT" },
    });

    expect(previewDatasetFileMock).not.toHaveBeenCalled();
  });

  it("rejects unsafe stored storage paths", async () => {
    configureSupabase({
      datasetResult: {
        ...dataset,
        storage_path: "another-user/unexpected/customers.csv",
      },
    });

    const response = await GET(
      makeRequest(),
      makeContext()
    );

    expect(response.status).toBe(422);

    expect(await responseJson(response)).toMatchObject({
      success: false,
      error: { code: "INVALID_DATASET_METADATA" },
    });
  });

  it("handles storage download failures", async () => {
    configureSupabase({
      downloadError: { message: "Storage unavailable" },
      fileData: null,
    });

    const response = await GET(
      makeRequest(),
      makeContext()
    );

    expect(response.status).toBe(404);

    expect(await responseJson(response)).toMatchObject({
      success: false,
      error: { code: "DATASET_FILE_NOT_FOUND" },
    });

    expect(previewDatasetFileMock).not.toHaveBeenCalled();
  });

  it("returns a successful CSV preview using the default limit", async () => {
    const mocks = configureSupabase();

    const response = await GET(
      makeRequest(),
      makeContext()
    );

    expect(response.status).toBe(200);

    const body = await responseJson(response);

    expect(body).toMatchObject({
      success: true,
      preview: {
        datasetId: DATASET_ID,
        name: "Customer Records",
        fileName: "customers.csv",
        fileType: "CSV",
        rowCount: 42,
        columnCount: 2,
        columns: ["Name", "Age"],
        previewRows: previewResult.previewRows,
      },
    });

    expect(mocks.storageFrom).toHaveBeenCalledWith("datasets");

    expect(mocks.download).toHaveBeenCalledWith(
      dataset.storage_path
    );

    expect(previewDatasetFileMock).toHaveBeenCalledOnce();

    const [file, limit] = previewDatasetFileMock.mock.calls[0];

    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("customers.csv");
    expect(limit).toBe(25);
  });

  it("accepts a custom preview limit", async () => {
    configureSupabase();

    const response = await GET(
      makeRequest("?limit=50"),
      makeContext()
    );

    expect(response.status).toBe(200);

    expect(previewDatasetFileMock.mock.calls[0][1]).toBe(50);
  });

  it("allows an authorized shared recipient to preview the owner's dataset", async () => {
    const mocks = configureSupabase({
      user: { id: SHARED_USER_ID },
    });

    const response = await GET(
      makeRequest(),
      makeContext()
    );

    expect(response.status).toBe(200);

    expect(mocks.eq).toHaveBeenCalledWith("id", DATASET_ID);

    // The route must not add an owner-only user_id filter.
    expect(mocks.eq).toHaveBeenCalledTimes(1);

    expect(mocks.download).toHaveBeenCalledWith(
      dataset.storage_path
    );
  });

  it("rejects a stored file whose actual size differs from metadata", async () => {
    configureSupabase({
      fileData: new Blob(["short"]),
    });

    const response = await GET(
      makeRequest(),
      makeContext()
    );

    expect(response.status).toBe(422);

    expect(await responseJson(response)).toMatchObject({
      success: false,
      error: { code: "DATASET_SIZE_MISMATCH" },
    });

    expect(previewDatasetFileMock).not.toHaveBeenCalled();
  });
});
