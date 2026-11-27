
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import { signOutAction } from "@/app/actions/auth";
import { useTheme } from "@/app/components/theme-provider";

type Dataset = {
  id: string;
  name: string;
  description: string | null;
  file_name: string;
  file_type: "CSV" | "XLSX";
  file_size: number;
  row_count: number | null;
  column_count: number | null;
  created_at: string;
  is_owner: boolean;
};

type SortOption = "newest" | "oldest" | "name" | "largest";

type DatasetPreviewData = {
  datasetId: string;
  name: string;
  fileName: string;
  fileType: "CSV" | "XLSX";
  rowCount: number | null;
  columnCount: number;
  columns: string[];
  previewRows: Record<string, string | number | boolean | null>[];
  worksheetName?: string;
};

type DatasetPreviewResponse = {
  success: boolean;
  preview?: DatasetPreviewData;
  error?: {
    code?: string;
    message?: string;
  };
};

const MAX_FILE_SIZE = 50 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const units = ["Bytes", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );

  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(date));
}

function getSuggestedName(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, "").slice(0, 100);
}

function validateSelectedFile(file: File): string | null {
  const extension = file.name.toLowerCase().split(".").pop();

  if (extension !== "csv" && extension !== "xlsx") {
    return "Choose a CSV or XLSX file.";
  }

  if (file.size === 0) {
    return "The selected file is empty.";
  }

  if (file.size > MAX_FILE_SIZE) {
    return "The maximum file size is 50 MB.";
  }

  return null;
}

export default function Dashboard() {
  const { theme, cycleTheme } = useTheme();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [datasetName, setDatasetName] = useState("");
  const [description, setDescription] = useState("");

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOption>("newest");

  const [recoveringStatistics, setRecoveringStatistics] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryErrors, setRecoveryErrors] = useState<string[]>([]);

  // Dataset preview state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewData, setPreviewData] =
    useState<DatasetPreviewData | null>(null);
  const [selectedPreviewDataset, setSelectedPreviewDataset] =
    useState<Dataset | null>(null);

  // Dataset management state
  const [managingDatasetId, setManagingDatasetId] = useState<string | null>(null);
  const [managementError, setManagementError] = useState("");
  const [managementMessage, setManagementMessage] = useState("");

  // Rename and delete dialog state
  const [editingDataset, setEditingDataset] = useState<Dataset | null>(null);
  const [editDatasetName, setEditDatasetName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Dataset | null>(null);

  const loadDatasets = useCallback(async () => {
    setLoading(true);
    setLoadError("");

    try {
      const response = await fetch("/api/datasets", {
        method: "GET",
        cache: "no-store",
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Unable to load datasets.");
      }

      setDatasets(result.datasets ?? []);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Unable to load your datasets."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function loadInitialDatasets() {
      try {
        const response = await fetch("/api/datasets", {
          method: "GET",
          cache: "no-store",
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.message || "Unable to load datasets.");
        }

        if (active) {
          setDatasets(result.datasets ?? []);
        }
      } catch (error) {
        if (active) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Unable to load your datasets."
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadInitialDatasets();

    return () => {
      active = false;
    };
  }, []);

  const handleFileSelection = (file: File | null) => {
    if (!file) return;

    setUploadError("");
    setUploadMessage("");

    const validationError = validateSelectedFile(file);

    if (validationError) {
      setSelectedFile(null);
      setUploadError(validationError);
      return;
    }

    setSelectedFile(file);

    if (!datasetName.trim()) {
      setDatasetName(getSuggestedName(file.name));
    }
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleFileSelection(event.target.files?.[0] ?? null);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);

    handleFileSelection(event.dataTransfer.files?.[0] ?? null);
  };

  const handleUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setUploadError("");
    setUploadMessage("");

    if (!selectedFile) {
      setUploadError("Select a dataset file before uploading.");
      return;
    }

    if (!datasetName.trim()) {
      setUploadError("Enter a name for your dataset.");
      return;
    }

    if (datasetName.trim().length > 100) {
      setUploadError("Dataset name cannot exceed 100 characters.");
      return;
    }

    if (description.length > 1000) {
      setUploadError("Description cannot exceed 1000 characters.");
      return;
    }

    const validationError = validateSelectedFile(selectedFile);

    if (validationError) {
      setUploadError(validationError);
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();

      formData.append("name", datasetName.trim());
      formData.append("description", description.trim());
      formData.append("file", selectedFile);

      const response = await fetch("/api/datasets", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Dataset upload failed.");
      }

      setUploadMessage("Your dataset was uploaded successfully.");
      setSelectedFile(null);
      setDatasetName("");
      setDescription("");

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      await loadDatasets();
    } catch (error) {
      setUploadError(
        error instanceof Error
          ? error.message
          : "An unexpected upload error occurred."
      );
    } finally {
      setUploading(false);
    }
  };

  const handleRecoverStatistics = async () => {
    const incompleteDatasets = datasets.filter(
      (dataset) =>
        dataset.row_count === null || dataset.column_count === null
    );

    if (incompleteDatasets.length === 0) {
      setRecoveryMessage("All dataset statistics are already available.");
      return;
    }

    setRecoveringStatistics(true);
    setRecoveryMessage("Preparing dataset statistics recovery...");
    setRecoveryErrors([]);

    let recovered = 0;
    let failed = 0;
    let skipped = 0;
    const errors: string[] = [];

    const batchSize = 3;
    const totalBatches = Math.ceil(incompleteDatasets.length / batchSize);

    try {
      for (
        let index = 0;
        index < incompleteDatasets.length;
        index += batchSize
      ) {
        const batch = incompleteDatasets.slice(index, index + batchSize);
        const batchNumber = Math.floor(index / batchSize) + 1;

        setRecoveryMessage(
          `Recovering batch ${batchNumber} of ${totalBatches}...`
        );

        try {
          const response = await fetch(
            "/api/datasets/recover-statistics",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                datasetIds: batch.map((dataset) => dataset.id),
              }),
            }
          );

          const result = await response.json();

          if (!response.ok || !result.success) {
            throw new Error(
              result.message || "The recovery request failed."
            );
          }

          recovered += result.recovered ?? 0;
          failed += result.failed ?? 0;
          skipped += result.skipped ?? 0;

          for (const item of result.results ?? []) {
            if (item.status === "failed") {
              errors.push(
                `${item.name}: ${item.message || "Recovery failed."}`
              );
            }
          }
        } catch (error) {
          failed += batch.length;
          errors.push(
            error instanceof Error
              ? error.message
              : `Batch ${batchNumber} could not be processed.`
          );
        }
      }

      await loadDatasets();

      setRecoveryMessage(
        `Recovery finished: ${recovered} recovered, ${failed} failed, ${skipped} skipped.`
      );
      setRecoveryErrors(errors);
    } finally {
      setRecoveringStatistics(false);
    }
  };

  const handlePreviewDataset = async (dataset: Dataset) => {
    setSelectedPreviewDataset(dataset);
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError("");
    setPreviewData(null);

    try {
      const response = await fetch(
        `/api/datasets/${encodeURIComponent(dataset.id)}/preview`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const result =
        (await response.json()) as DatasetPreviewResponse;

      if (!response.ok || !result.success || !result.preview) {
        throw new Error(
          result.error?.message || "Unable to preview this dataset."
        );
      }

      setPreviewData(result.preview);
    } catch (error) {
      setPreviewError(
        error instanceof Error
          ? error.message
          : "An unexpected error occurred while loading the preview."
      );
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    setPreviewOpen(false);
    setPreviewError("");
    setPreviewData(null);
  };

  const openRenameDialog = (dataset: Dataset) => {
    if (!dataset.is_owner) return;

    setManagementError("");
    setManagementMessage("");
    setEditingDataset(dataset);
    setEditDatasetName(dataset.name);
  };

  const openDeleteDialog = (dataset: Dataset) => {
    if (!dataset.is_owner) return;

    setManagementError("");
    setManagementMessage("");
    setDeleteTarget(dataset);
  };

  const handleRenameDataset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!editingDataset || !editingDataset.is_owner) return;

    const dataset = editingDataset;
    const name = editDatasetName.trim();

    if (!name) {
      setManagementError("Enter a dataset name.");
      return;
    }

    if (name.length > 100) {
      setManagementError("Dataset names cannot exceed 100 characters.");
      return;
    }

    if (name === dataset.name) {
      setEditingDataset(null);
      setManagementError("");
      return;
    }

    setManagingDatasetId(dataset.id);
    setManagementError("");
    setManagementMessage("");

    try {
      const response = await fetch(
        `/api/datasets/${encodeURIComponent(dataset.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        }
      );

      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.success || !result.dataset?.name) {
        throw new Error(result?.error || "Unable to rename this dataset.");
      }

      setDatasets((current) =>
        current.map((item) =>
          item.id === dataset.id
            ? { ...item, name: result.dataset.name }
            : item
        )
      );
      setEditingDataset(null);
      setManagementMessage("Dataset renamed successfully.");
    } catch (error) {
      setManagementError(
        error instanceof Error
          ? error.message
          : "An unexpected error occurred while renaming the dataset."
      );
    } finally {
      setManagingDatasetId(null);
    }
  };

  const handleDeleteDataset = async () => {
    if (!deleteTarget || !deleteTarget.is_owner) return;

    const dataset = deleteTarget;

    setManagingDatasetId(dataset.id);
    setManagementError("");
    setManagementMessage("");

    try {
      const response = await fetch(
        `/api/datasets/${encodeURIComponent(dataset.id)}`,
        { method: "DELETE" }
      );

      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.success) {
        throw new Error(result?.error || "Unable to delete this dataset.");
      }

      setDatasets((current) =>
        current.filter((item) => item.id !== dataset.id)
      );
      setDeleteTarget(null);
      setManagementMessage("Dataset deleted successfully.");
    } catch (error) {
      setManagementError(
        error instanceof Error
          ? error.message
          : "An unexpected error occurred while deleting the dataset."
      );
    } finally {
      setManagingDatasetId(null);
    }
  };

  const filteredDatasets = useMemo(() => {
    const query = search.trim().toLowerCase();

    const filtered = datasets.filter((dataset) => {
      return (
        dataset.name.toLowerCase().includes(query) ||
        dataset.file_name.toLowerCase().includes(query) ||
        dataset.file_type.toLowerCase().includes(query)
      );
    });

    return [...filtered].sort((a, b) => {
      switch (sort) {
        case "oldest":
          return (
            new Date(a.created_at).getTime() -
            new Date(b.created_at).getTime()
          );
        case "name":
          return a.name.localeCompare(b.name);
        case "largest":
          return b.file_size - a.file_size;
        case "newest":
        default:
          return (
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime()
          );
      }
    });
  }, [datasets, search, sort]);

  const totalStorage = datasets.reduce(
    (total, dataset) => total + Number(dataset.file_size || 0),
    0
  );

  const csvCount = datasets.filter(
    (dataset) => dataset.file_type === "CSV"
  ).length;

  const xlsxCount = datasets.length - csvCount;

  return (
    <main className="ih-dashboard">
      <aside className="ih-sidebar">
        <a className="ih-brand" href="#overview">
          <span className="ih-brand-mark">I</span>
          <span>Insight<span>Hub</span></span>
        </a>

        <div className="ih-sidebar-section">
          <p className="ih-sidebar-label">WORKSPACE</p>

          <nav className="ih-navigation">
            <a className="ih-nav-link active" href="#overview">
              <span className="ih-nav-icon">⌂</span>
              Dashboard
            </a>

            <a className="ih-nav-link" href="#datasets">
              <span className="ih-nav-icon">▤</span>
              My datasets
              <span className="ih-nav-count">{datasets.length}</span>
            </a>

            <span className="ih-nav-link disabled" aria-disabled="true">
              <span className="ih-nav-icon">⌁</span>
              Analysis
              <span className="ih-coming-soon">Soon</span>
            </span>

            <span className="ih-nav-link disabled" aria-disabled="true">
              <span className="ih-nav-icon">▧</span>
              Reports
              <span className="ih-coming-soon">Soon</span>
            </span>
          </nav>
        </div>

        <div className="ih-sidebar-bottom">
          <div className="ih-sidebar-note">
            <span className="ih-sidebar-note-icon">✦</span>
            <strong>Data intelligence, simplified.</strong>
            <p>Your workspace for understanding data.</p>
          </div>

          <form action={signOutAction}>
            <button className="ih-signout" type="submit">
              <span>↪</span> Sign out
            </button>
          </form>
        </div>
      </aside>

      <section className="ih-main">
        <header className="ih-topbar">
          <div className="ih-breadcrumb">
            Workspace <span>/</span> Dashboard
          </div>

          <div className="ih-topbar-actions">
            <button
              type="button"
              className="ih-theme-button"
              onClick={cycleTheme}
              title="Change appearance"
              aria-label={`Current appearance: ${theme}. Change appearance.`}
            >
              <span aria-hidden="true">
                {theme === "system" ? "◐" : theme === "light" ? "☀" : "☾"}
              </span>
              <span>{theme.charAt(0).toUpperCase() + theme.slice(1)}</span>
            </button>

            <div className="ih-workspace-avatar" title="My workspace">
              W
            </div>
          </div>
        </header>

        <div className="ih-content" id="overview">
          <section className="ih-welcome">
            <div>
              <p className="ih-eyebrow">YOUR DATA WORKSPACE</p>
              <h1>Good to have you here.</h1>
              <p className="ih-welcome-description">
                Bring your data together, prepare it and turn it into insight.
              </p>
            </div>

            <button
              type="button"
              className="ih-primary-button"
              onClick={() =>
                document
                  .getElementById("upload-section")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
            >
              <span>＋</span> Upload dataset
            </button>
          </section>

          <section className="ih-stat-grid" aria-label="Workspace statistics">
            <article className="ih-stat-card">
              <div className="ih-stat-heading">
                <span>Total datasets</span>
                <span className="ih-stat-icon blue">▤</span>
              </div>
              <strong>{loading ? "—" : datasets.length.toLocaleString()}</strong>
              <small>Datasets in your workspace</small>
            </article>

            <article className="ih-stat-card">
              <div className="ih-stat-heading">
                <span>Storage used</span>
                <span className="ih-stat-icon violet">◫</span>
              </div>
              <strong>{loading ? "—" : formatBytes(totalStorage)}</strong>
              <small>Combined uploaded file sizes</small>
            </article>

            <article className="ih-stat-card">
              <div className="ih-stat-heading">
                <span>CSV files</span>
                <span className="ih-stat-icon green">▦</span>
              </div>
              <strong>{loading ? "—" : csvCount.toLocaleString()}</strong>
              <small>CSV datasets uploaded</small>
            </article>

            <article className="ih-stat-card">
              <div className="ih-stat-heading">
                <span>Excel files</span>
                <span className="ih-stat-icon orange">▧</span>
              </div>
              <strong>{loading ? "—" : xlsxCount.toLocaleString()}</strong>
              <small>XLSX datasets uploaded</small>
            </article>
          </section>

          <section className="ih-upload-section" id="upload-section">
            <div className="ih-section-heading">
              <div>
                <p className="ih-eyebrow">GET STARTED</p>
                <h2>Bring your data into InsightHub</h2>
                <p>
                  Upload a dataset to begin preparing it for analysis.
                </p>
              </div>
            </div>

            <form className="ih-upload-form" onSubmit={handleUpload}>
              <div className="ih-upload-fields">
                <label className="ih-field">
                  <span>Dataset name</span>
                  <input
                    type="text"
                    value={datasetName}
                    onChange={(event) => setDatasetName(event.target.value)}
                    placeholder="e.g. Customer transactions"
                    maxLength={100}
                    required
                  />
                </label>

                <label className="ih-field">
                  <span>Description <small>(optional)</small></span>
                  <input
                    type="text"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="What is this dataset about?"
                    maxLength={1000}
                  />
                </label>
              </div>

              <input
                ref={fileInputRef}
                className="ih-hidden-input"
                type="file"
                accept=".csv,.xlsx"
                onChange={handleInputChange}
              />

              <div
                className={`ih-dropzone ${isDragging ? "dragging" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                }}
                onDrop={handleDrop}
              >
                <div className="ih-upload-icon">↑</div>

                <strong>
                  {selectedFile ? selectedFile.name : "Drop your dataset here"}
                </strong>

                <p>
                  {selectedFile
                    ? `${formatBytes(selectedFile.size)} · ${selectedFile.name.toLowerCase().endsWith(".csv") ? "CSV" : "XLSX"}`
                    : "Or browse files from your computer"}
                </p>

                <button
                  type="button"
                  className="ih-secondary-button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {selectedFile ? "Change file" : "Browse files"}
                </button>

                <small>CSV or XLSX · Maximum 50 MB</small>
              </div>

              {uploadError && (
                <p className="ih-feedback error" role="alert">
                  {uploadError}
                </p>
              )}

              {uploadMessage && (
                <p className="ih-feedback success" role="status">
                  {uploadMessage}
                </p>
              )}

              <div className="ih-upload-footer">
                <span>
                  {selectedFile
                    ? `Ready to upload · ${formatBytes(selectedFile.size)}`
                    : "Your files are stored in your private workspace."}
                </span>

                <button
                  type="submit"
                  className="ih-primary-button"
                  disabled={uploading || !selectedFile}
                >
                  {uploading ? "Uploading..." : "Upload dataset →"}
                </button>
              </div>
            </form>
          </section>

          <section className="ih-library-section" id="datasets">
            <div className="ih-library-heading">
              <div>
                <h2>Your datasets</h2>
                <p>Manage the files you’ve uploaded to InsightHub.</p>
              </div>

              <div className="ih-library-actions">
                {datasets.some(
                  (dataset) =>
                    dataset.row_count === null ||
                    dataset.column_count === null
                ) && (
                  <button
                    type="button"
                    className="ih-secondary-button"
                    onClick={() => void handleRecoverStatistics()}
                    disabled={recoveringStatistics || loading}
                  >
                    {recoveringStatistics
                      ? "Recovering..."
                      : "Recover statistics"}
                  </button>
                )}

                <button
                  type="button"
                  className="ih-refresh-button"
                  onClick={() => void loadDatasets()}
                  disabled={loading || recoveringStatistics}
                >
                  Refresh
                </button>
              </div>
            </div>

            {(recoveryMessage || recoveryErrors.length > 0) && (
              <div className="ih-recovery-status" aria-live="polite">
                {recoveryMessage && <p>{recoveryMessage}</p>}

                {recoveryErrors.length > 0 && (
                  <ul>
                    {recoveryErrors.map((error, index) => (
                      <li key={`${index}-${error}`}>{error}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {managementMessage && (
              <p className="ih-feedback success" role="status">
                {managementMessage}
              </p>
            )}
            <div className="ih-library-toolbar">
              <div className="ih-search">
                <span>⌕</span>
                <input
                  type="search"
                  placeholder="Search datasets..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  aria-label="Search datasets"
                />
              </div>

              <select
                className="ih-sort"
                value={sort}
                onChange={(event) =>
                  setSort(event.target.value as SortOption)
                }
                aria-label="Sort datasets"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="name">Name A–Z</option>
                <option value="largest">Largest first</option>
              </select>
            </div>

            {loadError && (
              <div className="ih-empty-state">
                <strong>We couldn’t load your datasets.</strong>
                <p>{loadError}</p>
                <button
                  type="button"
                  className="ih-secondary-button"
                  onClick={() => void loadDatasets()}
                >
                  Try again
                </button>
              </div>
            )}

            {!loadError && loading && (
              <div className="ih-empty-state">
                <div className="ih-spinner" />
                <p>Loading your datasets...</p>
              </div>
            )}

            {!loading && !loadError && filteredDatasets.length === 0 && (
              <div className="ih-empty-state">
                <div className="ih-empty-icon">▤</div>
                <strong>
                  {search ? "No matching datasets" : "Your workspace is ready"}
                </strong>
                <p>
                  {search
                    ? "Try another search term."
                    : "Upload your first CSV or Excel dataset to get started."}
                </p>
              </div>
            )}

            {!loading && !loadError && filteredDatasets.length > 0 && (
              <div className="ih-table-wrapper">
                <table className="ih-dataset-table">
                  <thead>
                    <tr>
                      <th>DATASET</th>
                      <th>FORMAT</th>
                      <th>SIZE</th>
                      <th>ROWS</th>
                      <th>COLUMNS</th>
                      <th>DATE ADDED</th>
                      <th>ACTIONS</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredDatasets.map((dataset) => (
                      <tr key={dataset.id}>
                        <td>
                          <div className="ih-dataset-name">
                            <span
                              className={`ih-file-icon ${dataset.file_type.toLowerCase()}`}
                            >
                              {dataset.file_type === "CSV" ? "C" : "X"}
                            </span>
                            <div>
                              <strong>{dataset.name}</strong>
                              <small>{dataset.file_name}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="ih-format-badge">
                            {dataset.file_type}
                          </span>
                        </td>
                        <td>{formatBytes(Number(dataset.file_size))}</td>
                                                <td>
                          {dataset.row_count == null
                            ? "—"
                            : dataset.row_count.toLocaleString()}
                        </td>
                        <td>
                          {dataset.column_count == null
                            ? "—"
                            : dataset.column_count.toLocaleString()}
                        </td>
                        <td>{formatDate(dataset.created_at)}</td>
                        <td>
                          <button
                            type="button"
                            className="ih-preview-button"
                            onClick={() => void handlePreviewDataset(dataset)}
                            aria-label={`Preview ${dataset.name}`}
                          >
                            <span aria-hidden="true">◉</span>
                            Preview
                          </button>
                          {dataset.is_owner && (
                            <>
                              <button
                                type="button"
                                className="ih-secondary-button"
                                onClick={() => openRenameDialog(dataset)}
                                disabled={managingDatasetId === dataset.id}
                              >
                                Rename
                              </button>
                              <button
                                type="button"
                                className="ih-secondary-button"
                                onClick={() => openDeleteDialog(dataset)}
                                disabled={managingDatasetId === dataset.id}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="ih-library-footer">
              Showing {filteredDatasets.length} of {datasets.length} datasets
            </div>
          </section>

          {previewOpen && (
            <div
              className="ih-preview-overlay"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  closePreview();
                }
              }}
            >
              <section
                className="ih-preview-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="ih-preview-title"
              >
                <header className="ih-preview-header">
                  <div>
                    <p className="ih-eyebrow">DATASET EXPLORER</p>
                    <h2 id="ih-preview-title">
                      {previewData?.name || "Dataset preview"}
                    </h2>
                    <p className="ih-preview-filename">
                      {previewData?.fileName || "Loading dataset information..."}
                    </p>
                  </div>

                  <button
                    type="button"
                    className="ih-preview-close"
                    onClick={closePreview}
                    aria-label="Close dataset preview"
                  >
                    ×
                  </button>
                </header>

                {previewLoading && (
                  <div className="ih-preview-message" role="status">
                    <div className="ih-spinner" />
                    <p>Preparing your dataset preview...</p>
                  </div>
                )}

                {!previewLoading && previewError && (
                  <div className="ih-preview-message error" role="alert">
                    <strong>Preview unavailable</strong>
                    <p>{previewError}</p>
                    <button
                      type="button"
                      className="ih-secondary-button"
                      onClick={() => {
                        const dataset = selectedPreviewDataset;

                        if (dataset) {
                          void handlePreviewDataset(dataset);
                        }
                      }}
                    >
                      Try again
                    </button>
                  </div>
                )}

                {!previewLoading && previewData && (
                  <>
                    <div className="ih-preview-stats">
                      <article>
                        <span>FILE FORMAT</span>
                        <strong>{previewData.fileType}</strong>
                      </article>

                      <article>
                        <span>TOTAL ROWS</span>
                        <strong>
                          {previewData.rowCount === null
                            ? "Unavailable"
                            : previewData.rowCount.toLocaleString()}
                        </strong>
                      </article>

                      <article>
                        <span>COLUMNS</span>
                        <strong>
                          {previewData.columnCount.toLocaleString()}
                        </strong>
                      </article>

                      <article>
                        <span>PREVIEW ROWS</span>
                        <strong>
                          {previewData.previewRows.length.toLocaleString()}
                        </strong>
                      </article>
                    </div>

                    {previewData.worksheetName && (
                      <p className="ih-preview-worksheet">
                        Worksheet: <strong>{previewData.worksheetName}</strong>
                      </p>
                    )}

                    <div className="ih-preview-table-heading">
                      <div>
                        <h3>Data preview</h3>
                        <p>
                          Showing the first{" "}
                          {previewData.previewRows.length} data rows.
                        </p>
                      </div>
                      <span className="ih-format-badge">
                        {previewData.fileType}
                      </span>
                    </div>

                    {previewData.columns.length === 0 ||
                    previewData.previewRows.length === 0 ? (
                      <div className="ih-preview-message">
                        <p>No preview rows are available for this dataset.</p>
                      </div>
                    ) : (
                      <div className="ih-preview-table-wrapper">
                        <table className="ih-preview-table">
                          <thead>
                            <tr>
                              <th className="ih-preview-row-number">#</th>
                              {previewData.columns.map((column, index) => (
                                <th key={`${index}-${column}`}>
                                  {column}
                                </th>
                              ))}
                            </tr>
                          </thead>

                          <tbody>
                            {previewData.previewRows.map((row, rowIndex) => (
                              <tr key={rowIndex}>
                                <td className="ih-preview-row-number">
                                  {rowIndex + 1}
                                </td>

                                {previewData.columns.map((column, columnIndex) => {
                                  const value = row[column];

                                  return (
                                    <td key={`${rowIndex}-${columnIndex}`}>
                                      {value === null || value === undefined
                                        ? "—"
                                        : String(value)}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <p className="ih-preview-note">
                      This is a read-only preview. Your original dataset has
                      not been modified.
                    </p>
                  </>
                )}

                <footer className="ih-preview-footer">
                  <button
                    type="button"
                    className="ih-secondary-button"
                    onClick={closePreview}
                  >
                    Close preview
                  </button>
                </footer>
              </section>
            </div>
          )}

          {/* Dataset rename dialog */}
          {editingDataset && (
            <div
              className="ih-preview-overlay"
              onMouseDown={(event) => {
                if (
                  event.target === event.currentTarget &&
                  managingDatasetId !== editingDataset.id
                ) {
                  setEditingDataset(null);
                  setManagementError("");
                }
              }}
            >
              <section
                className="ih-preview-modal ih-management-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="ih-rename-title"
              >
                <header className="ih-preview-header">
                  <div>
                    <p className="ih-eyebrow">DATASET MANAGEMENT</p>
                    <h2 id="ih-rename-title">Rename dataset</h2>
                    <p className="ih-preview-filename">
                      Change the name displayed in your dataset library.
                    </p>
                  </div>

                  <button
                    type="button"
                    className="ih-preview-close"
                    onClick={() => {
                      setEditingDataset(null);
                      setManagementError("");
                    }}
                    disabled={managingDatasetId === editingDataset.id}
                    aria-label="Close rename dialog"
                  >
                    ×
                  </button>
                </header>

                <form
                  className="ih-management-form"
                  onSubmit={handleRenameDataset}
                >
                  <label className="ih-field" htmlFor="ih-edit-dataset-name">
                    Dataset name
                    <input
                      id="ih-edit-dataset-name"
                      type="text"
                      value={editDatasetName}
                      onChange={(event) => setEditDatasetName(event.target.value)}
                      maxLength={100}
                      required
                      autoFocus
                      disabled={managingDatasetId === editingDataset.id}
                    />
                    <small>Maximum 100 characters.</small>
                  </label>

                  {managementError && (
                    <p className="ih-feedback error" role="alert">
                      {managementError}
                    </p>
                  )}

                  <footer className="ih-management-actions">
                    <button
                      type="button"
                      className="ih-secondary-button"
                      onClick={() => {
                        setEditingDataset(null);
                        setManagementError("");
                      }}
                      disabled={managingDatasetId === editingDataset.id}
                    >
                      Cancel
                    </button>

                    <button
                      type="submit"
                      className="ih-primary-button"
                      disabled={managingDatasetId === editingDataset.id}
                    >
                      {managingDatasetId === editingDataset.id
                        ? "Saving..."
                        : "Save changes"}
                    </button>
                  </footer>
                </form>
              </section>
            </div>
          )}

          {/* Dataset delete confirmation dialog */}
          {deleteTarget && (
            <div
              className="ih-preview-overlay"
              onMouseDown={(event) => {
                if (
                  event.target === event.currentTarget &&
                  managingDatasetId !== deleteTarget.id
                ) {
                  setDeleteTarget(null);
                  setManagementError("");
                }
              }}
            >
              <section
                className="ih-preview-modal ih-management-modal"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="ih-delete-title"
                aria-describedby="ih-delete-description"
              >
                <header className="ih-preview-header">
                  <div>
                    <p className="ih-eyebrow">DATASET MANAGEMENT</p>
                    <h2 id="ih-delete-title">Delete dataset?</h2>
                    <p className="ih-preview-filename">
                      This action removes the dataset from your library.
                    </p>
                  </div>

                  <button
                    type="button"
                    className="ih-preview-close"
                    onClick={() => {
                      setDeleteTarget(null);
                      setManagementError("");
                    }}
                    disabled={managingDatasetId === deleteTarget.id}
                    aria-label="Close delete confirmation"
                  >
                    ×
                  </button>
                </header>

                <div className="ih-management-form">
                  <p id="ih-delete-description">
                    You are about to permanently delete{" "}
                    <strong>{deleteTarget.name}</strong> and its stored file.
                    This cannot be undone.
                  </p>

                  {managementError && (
                    <p className="ih-feedback error" role="alert">
                      {managementError}
                    </p>
                  )}

                  <footer className="ih-management-actions">
                    <button
                      type="button"
                      className="ih-secondary-button"
                      onClick={() => {
                        setDeleteTarget(null);
                        setManagementError("");
                      }}
                      disabled={managingDatasetId === deleteTarget.id}
                    >
                      Cancel
                    </button>

                    <button
                      type="button"
                      className="ih-primary-button ih-management-delete-button"
                      onClick={() => void handleDeleteDataset()}
                      disabled={managingDatasetId === deleteTarget.id}
                    >
                      {managingDatasetId === deleteTarget.id
                        ? "Deleting..."
                        : "Confirm delete"}
                    </button>
                  </footer>
                </div>
              </section>
            </div>
          )}
          <footer className="ih-footer">
            <span>InsightHub</span>
            <span>Data intelligence, simplified.</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
