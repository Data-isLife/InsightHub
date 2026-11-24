
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
};

type SortOption = "newest" | "oldest" | "name" | "largest";

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

              <button
                type="button"
                className="ih-refresh-button"
                onClick={() => void loadDatasets()}
                disabled={loading}
              >
                ↻ Refresh
              </button>
            </div>

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
                      <th>DATE ADDED</th>
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
                          {dataset.row_count === null
                            ? "—"
                            : dataset.row_count.toLocaleString()}
                        </td>
                        <td>{formatDate(dataset.created_at)}</td>
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

          <footer className="ih-footer">
            <span>InsightHub</span>
            <span>Data intelligence, simplified.</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
