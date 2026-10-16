import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Plus,
  Search,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
} from "lucide-react";
import AppShell from "../components/AppShell";
import CaseTable from "../components/CaseTable";
import { PageHeader, ErrorState } from "../components/ui";
import { useRemote } from "../hooks/useRemote";
import { casesApi } from "../api/cases";
import { useAuth } from "../context/AuthContext";
import { getPreferences } from "../lib/preferences";
export default function Cases() {
  const { isRole } = useAuth();
  const { data, loading, error, reload } = useRemote(casesApi.list);
  const [params, setParams] = useSearchParams();
  const query = params.get("q") || "",
    status = params.get("status") || "All",
    modality = params.get("modality") || "All";
  const [sort, setSort] = useState({ key: "createdAt", dir: -1 }),
    [page, setPage] = useState(1);
  const size = getPreferences().pageSize;
  const cases = data || [];
  function filter(key, value) {
    setParams((old) => {
      const next = new URLSearchParams(old);
      if (value && value !== "All") next.set(key, value);
      else next.delete(key);
      return next;
    });
    setPage(1);
  }
  const filtered = cases
    .filter(
      (c) =>
        (!query ||
          [c.caseCode, c.studyType, c.id].some((v) =>
            String(v).toLowerCase().includes(query.toLowerCase()),
          )) &&
        (status === "All" || c.status === status) &&
        (modality === "All" || c.modality === modality),
    )
    .sort((a, b) => {
      const av = a[sort.key] ?? "",
        bv = b[sort.key] ?? "";
      return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
    });
  const totalPages = Math.max(1, Math.ceil(filtered.length / size)),
    current = Math.min(page, totalPages);
  return (
    <AppShell breadcrumbs={[{ label: "Cases" }]}>
      <PageHeader
        eyebrow="STUDY MANAGEMENT"
        title="Every study. One place."
        description="Organize, find, and continue your imaging cases."
      >
        <button className="btn btn-ghost" onClick={reload}>
          <RotateCcw size={14} />
          Refresh
        </button>
        {isRole("Clinician", "Admin") && (
          <Link id="new-case-btn" className="btn btn-primary" to="/cases/new">
            <Plus size={15} />
            New case
          </Link>
        )}
      </PageHeader>
      <div className="segmented">
        {["All", "Pending", "Processing", "Complete", "Failed"].map((s) => (
          <button
            key={s}
            className={status === s ? "selected" : ""}
            onClick={() => filter("status", s)}
          >
            {s === "All" ? "All studies" : s}{" "}
            <span style={{ marginLeft: 5 }}>
              {cases.filter((c) => s === "All" || c.status === s).length}
            </span>
          </button>
        ))}
      </div>
      <div className="filters-bar">
        <div className="search-bar">
          <Search size={15} />
          <input
            id="cases-search"
            aria-label="Search cases"
            placeholder="Search by case reference or study…"
            value={query}
            onChange={(e) => filter("q", e.target.value)}
          />
        </div>
        <SlidersHorizontal size={15} className="text-muted" />
        <select
          aria-label="Filter by modality"
          className="form-select filter-select"
          value={modality}
          onChange={(e) => filter("modality", e.target.value)}
        >
          <option value="All">All modalities</option>
          {[...new Set(cases.map((c) => c.modality).filter(Boolean))].map(
            (m) => (
              <option key={m}>{m}</option>
            ),
          )}
        </select>
        <select
          aria-label="Sort cases"
          className="form-select filter-select"
          value={`${sort.key}:${sort.dir}`}
          onChange={(e) => {
            const [key, dir] = e.target.value.split(":");
            setSort({ key, dir: Number(dir) });
            setPage(1);
          }}
        >
          <option value="createdAt:-1">Newest first</option>
          <option value="createdAt:1">Oldest first</option>
          <option value="caseCode:1">Case reference A–Z</option>
        </select>
        {(query || status !== "All" || modality !== "All") && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setParams({});
              setPage(1);
            }}
          >
            Clear filters
          </button>
        )}
      </div>
      {error ? (
        <ErrorState error={error} retry={reload} />
      ) : (
        <div className="card">
          <CaseTable
            loading={loading}
            cases={filtered.slice((current - 1) * size, current * size)}
            onSort={(key) => {
              setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }));
              setPage(1);
            }}
            emptyAction={
              isRole("Clinician", "Admin") && (
                <Link className="btn btn-primary" to="/cases/new">
                  <Plus size={14} />
                  Create a case
                </Link>
              )
            }
          />
          <div className="table-footer">
            <span>
              {filtered.length
                ? `${(current - 1) * size + 1}–${Math.min(current * size, filtered.length)}`
                : "0"}{" "}
              of {filtered.length} studies
            </span>
            <div className="pagination">
              <button
                className="icon-btn"
                aria-label="Previous page"
                disabled={current === 1}
                onClick={() => setPage(current - 1)}
              >
                <ChevronLeft size={14} />
              </button>
              <span>
                Page {current} of {totalPages}
              </span>
              <button
                className="icon-btn"
                aria-label="Next page"
                disabled={current === totalPages}
                onClick={() => setPage(current + 1)}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
