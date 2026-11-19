
import type { DatasetInput } from "@/app/lib/validations/dataset";

import type {
  DatasetRecord,
  DatasetRepository,
} from "@/app/lib/repositories/dataset-repository";

export class InMemoryDatasetRepository implements DatasetRepository {
  private datasets = new Map<string, DatasetRecord>();

  async create(input: DatasetInput): Promise<DatasetRecord> {
    const record: DatasetRecord = {
      id: crypto.randomUUID(),
      name: input.name,
      fileType: input.fileType,
      createdAt: new Date().toISOString(),
    };

    this.datasets.set(record.id, record);

    return record;
  }

  async findById(id: string): Promise<DatasetRecord | null> {
    return this.datasets.get(id) ?? null;
  }
}
