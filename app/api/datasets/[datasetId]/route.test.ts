
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createClientMock,
  getUserMock,
  fromMock,
  storageFromMock,
  listMock,
  removeMock,
  queryQueue,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  getUserMock: vi.fn(),
  fromMock: vi.fn(),
  storageFromMock: vi.fn(),
  listMock: vi.fn(),
  removeMock: vi.fn(),
  queryQueue: [] as Array<{
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("@/app/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

import { DELETE, PATCH } from "./route";

const DATASET_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_USER_ID = "33333333-3333-4333-8333-333333333333";
const FILE_NAME = "sales.csv";
const STORAGE_PATH = `${USER_ID}/${DATASET_ID}/${FILE_NAME}`;

function makeQuery(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };

  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.update.mockReturnValue(query);
  query.delete.mockReturnValue(query);

  return query;
}

function makeContext(datasetId = DATASET_ID) {
  return {
    params: Promise.resolve({ datasetId }),
  };
}

function makeRequest(body?: unknown) {
  return new Request("http://localhost/api/datasets/test", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function datasetRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: DATASET_ID,
    user_id: USER_ID,
    file_type: "CSV",
    storage_path: STORAGE_PATH,
    file_name: FILE_NAME,
    ...overrides,
  };
}

function setupAuthenticatedUser(userId = USER_ID) {
  getUserMock.mockResolvedValue({
    data: {
      user: { id: userId },
    },
    error: null,
  });
}

function queueQueries(...queries: ReturnType<typeof makeQuery>[]) {
  queryQueue.push(...queries);
}

beforeEach(() => {
  vi.clearAllMocks();
  queryQueue.length = 0;

  setupAuthenticatedUser();

  fromMock.mockImplementation(() => {
    const query = queryQueue.shift();

    if (!query) {
      throw new Error("Unexpected Supabase database query.");
    }

    return query;
  });

  storageFromMock.mockReturnValue({
    list: listMock,
    remove: removeMock,
  });

  createClientMock.mockResolvedValue({
    auth: {
      getUser: getUserMock,
    },
    from: fromMock,
    storage: {
      from: storageFromMock,
    },
  });

  listMock.mockResolvedValue({
    data: [{ name: FILE_NAME }],
    error: null,
  });

  removeMock.mockResolvedValue({
    data: [{ name: FILE_NAME }],
    error: null,
  });
});

describe("PATCH /api/datasets/[datasetId]", () => {
  it("rejects unauthenticated requests", async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const response = await PATCH(
      makeRequest({ name: "Renamed dataset" }),
      makeContext()
    );

    expect(response.status).toBe(401);
  });

  it("rejects invalid dataset IDs", async () => {
    const response = await PATCH(
      makeRequest({ name: "Renamed dataset" }),
      makeContext("invalid-id")
    );

    expect(response.status).toBe(400);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("rejects datasets not owned by the authenticated user", async () => {
    const lookup = makeQuery({
      data: null,
      error: null,
    });

    queueQueries(lookup);

    const response = await PATCH(
      makeRequest({ name: "Renamed dataset" }),
      makeContext()
    );

    expect(response.status).toBe(404);
    expect(lookup.eq).toHaveBeenCalledWith("user_id", USER_ID);
  });

  it("rejects invalid dataset names", async () => {
    const lookup = makeQuery({
      data: datasetRecord(),
      error: null,
    });

    queueQueries(lookup);

    const response = await PATCH(
      makeRequest({ name: "   " }),
      makeContext()
    );

    expect(response.status).toBe(400);
    expect(queryQueue).toHaveLength(0);
  });

  it("renames an owned dataset successfully", async () => {
    const lookup = makeQuery({
      data: datasetRecord(),
      error: null,
    });

    const update = makeQuery({
      data: {
        id: DATASET_ID,
        name: "Renamed dataset",
        updated_at: "2026-11-27T12:00:00.000Z",
      },
      error: null,
    });

    queueQueries(lookup, update);

    const response = await PATCH(
      makeRequest({ name: "Renamed dataset" }),
      makeContext()
    );

    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);
    expect(result.dataset.name).toBe("Renamed dataset");
    expect(update.update).toHaveBeenCalledWith({
      name: "Renamed dataset",
    });
    expect(update.eq).toHaveBeenCalledWith("user_id", USER_ID);
  });
});

describe("DELETE /api/datasets/[datasetId]", () => {
  it("rejects unauthenticated requests", async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const response = await DELETE(
      new Request("http://localhost/api/datasets/test"),
      makeContext()
    );

    expect(response.status).toBe(401);
  });

  it("rejects datasets not owned by the authenticated user", async () => {
    const lookup = makeQuery({
      data: null,
      error: null,
    });

    queueQueries(lookup);

    const response = await DELETE(
      new Request("http://localhost/api/datasets/test"),
      makeContext()
    );

    expect(response.status).toBe(404);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("rejects unsafe stored storage paths", async () => {
    const lookup = makeQuery({
      data: datasetRecord({
        storage_path: `${OTHER_USER_ID}/${DATASET_ID}/${FILE_NAME}`,
      }),
      error: null,
    });

    queueQueries(lookup);

    const response = await DELETE(
      new Request("http://localhost/api/datasets/test"),
      makeContext()
    );

    expect(response.status).toBe(500);
    expect(storageFromMock).not.toHaveBeenCalled();
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("does not delete metadata when storage lookup fails", async () => {
    const lookup = makeQuery({
      data: datasetRecord(),
      error: null,
    });

    queueQueries(lookup);

    listMock.mockResolvedValue({
      data: null,
      error: { message: "Storage unavailable" },
    });

    const response = await DELETE(
      new Request("http://localhost/api/datasets/test"),
      makeContext()
    );

    expect(response.status).toBe(500);
    expect(queryQueue).toHaveLength(0);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("removes the stored file before deleting metadata", async () => {
    const lookup = makeQuery({
      data: datasetRecord(),
      error: null,
    });

    const deletion = makeQuery({
      data: { id: DATASET_ID },
      error: null,
    });

    queueQueries(lookup, deletion);

    const response = await DELETE(
      new Request("http://localhost/api/datasets/test"),
      makeContext()
    );

    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);
    expect(storageFromMock).toHaveBeenCalledWith("datasets");
    expect(removeMock).toHaveBeenCalledWith([STORAGE_PATH]);
    expect(deletion.delete).toHaveBeenCalled();
    expect(deletion.eq).toHaveBeenCalledWith("user_id", USER_ID);
  });

  it("finishes metadata deletion when the file is already absent", async () => {
    const lookup = makeQuery({
      data: datasetRecord(),
      error: null,
    });

    const deletion = makeQuery({
      data: { id: DATASET_ID },
      error: null,
    });

    queueQueries(lookup, deletion);

    listMock.mockResolvedValue({
      data: [],
      error: null,
    });

    const response = await DELETE(
      new Request("http://localhost/api/datasets/test"),
      makeContext()
    );

    expect(response.status).toBe(200);
    expect(removeMock).not.toHaveBeenCalled();
    expect(deletion.delete).toHaveBeenCalled();
  });

  it("does not delete metadata when storage removal fails", async () => {
    const lookup = makeQuery({
      data: datasetRecord(),
      error: null,
    });

    queueQueries(lookup);

    removeMock.mockResolvedValue({
      data: null,
      error: { message: "Storage deletion failed" },
    });

    const response = await DELETE(
      new Request("http://localhost/api/datasets/test"),
      makeContext()
    );

    expect(response.status).toBe(500);
    expect(queryQueue).toHaveLength(0);
  });

  it("reports when metadata deletion fails after file removal", async () => {
    const lookup = makeQuery({
      data: datasetRecord(),
      error: null,
    });

    const deletion = makeQuery({
      data: null,
      error: { message: "Database unavailable" },
    });

    queueQueries(lookup, deletion);

    const response = await DELETE(
      new Request("http://localhost/api/datasets/test"),
      makeContext()
    );

    const result = await response.json();

    expect(response.status).toBe(500);
    expect(removeMock).toHaveBeenCalledWith([STORAGE_PATH]);
    expect(result.error).toContain("Please retry");
  });
});
