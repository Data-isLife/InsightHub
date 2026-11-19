
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
