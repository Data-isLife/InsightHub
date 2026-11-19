
import { describe, it, expect, vi } from "vitest";

import {
  createDataset,
  getDatasetById,
} from "@/app/lib/services/dataset-service";

import type {
  DatasetRepository,
  DatasetRecord,
} from "@/app/lib/repositories/dataset-repository";

describe("Dataset Service", () => {
  const testRecord: DatasetRecord = {
    id: "test-123",
    name: "Customer Records",
    fileType: "CSV",
    createdAt: "2026-11-19T10:00:00.000Z",
  };

  const fakeRepository: DatasetRepository = {
    create: vi.fn(async () => testRecord),

    findById: vi.fn(async (id) => {
      return id === testRecord.id ? testRecord : null;
    }),
  };

  it("creates a dataset through the repository", async () => {
    const result = await createDataset(
      {
        name: "Customer Records",
        fileType: "CSV",
      },
      fakeRepository
    );

    expect(result).toEqual(testRecord);

    expect(fakeRepository.create).toHaveBeenCalledOnce();
  });

  it("retrieves an existing dataset", async () => {
    const result = await getDatasetById(
      "test-123",
      fakeRepository
    );

    expect(result).toEqual(testRecord);
  });

  it("returns null when a dataset does not exist", async () => {
    const result = await getDatasetById(
      "missing-id",
      fakeRepository
    );

    expect(result).toBeNull();
  });
});
