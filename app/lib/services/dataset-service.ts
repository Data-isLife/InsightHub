
import type { DatasetRepository } from "@/app/lib/repositories/dataset-repository";

import type { DatasetRecord } from "@/app/lib/repositories/dataset-repository";

import type { DatasetInput } from "@/app/lib/validations/dataset";

export type PreparedDataset = {
  name: string;
  fileType: DatasetInput["fileType"];
  status: "ready_for_upload";
};

export function prepareDataset(
  input: DatasetInput
): PreparedDataset {
  return {
    name: input.name,
    fileType: input.fileType,
    status: "ready_for_upload",
  };
}

export async function createDataset(
  input: DatasetInput,
  repository: DatasetRepository
): Promise<DatasetRecord> {
  return repository.create(input);
}

export async function getDatasetById(
  id: string,
  repository: DatasetRepository
): Promise<DatasetRecord | null> {
  return repository.findById(id);
}
