
import type { DatasetInput } from "@/app/lib/validations/dataset";

export type DatasetRecord = {
  id: string;
  name: string;
  fileType: DatasetInput["fileType"];
  createdAt: string;
};

export interface DatasetRepository {
  create(input: DatasetInput): Promise<DatasetRecord>;

  findById(id: string): Promise<DatasetRecord | null>;
}
