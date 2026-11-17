
import { z } from "zod";

export const DatasetSchema = z.object({
  name: z.string()
    .trim()
    .min(1, "Dataset name is required.")
    .max(100, "Dataset name cannot exceed 100 characters."),

  fileType: z.enum(
    ["CSV", "XLSX"],
    {
      error: "File type must be CSV or XLSX."
    }
  )
});

export type DatasetInput = z.infer<typeof DatasetSchema>;
