"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, ExternalLink, Hash } from "lucide-react";
import { Spinner } from "@theshyre/ui";
import { inputClass } from "@/lib/form-styles";

interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  labels: Array<{ name: string; color: string }>;
  html_url: string;
}

interface GitHubIssuePickerProps {
  repo: string;
  value: number | null;
  onChange: (issueNumber: number | null) => void;
}

export function GitHubIssuePicker({
  repo,
  value,
  onChange,
}: GitHubIssuePickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchIssues = useCallback(
    async (searchQuery: string): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ repo });
        if (searchQuery) params.set("q", searchQuery);

        const res = await fetch(`/api/github/issues?${params.toString()}`);
        const data = await res.json();

        if (!res.ok) {
          setError(data.error ?? "Failed to fetch issues");
          setIssues([]);
        } else {
          setIssues(data.issues ?? []);
        }
      } catch {
        setError("Failed to fetch issues");
        setIssues([]);
      } finally {
        setLoading(false);
      }
    },
    [repo]
  );

  // Debounced search
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      fetchIssues(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, open, fetchIssues]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent): void {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      window.addEventListener("keydown", handleKey);
      return () => window.removeEventListener("keydown", handleKey);
    }
  }, [open]);

  function selectIssue(issue: GitHubIssue): void {
    onChange(issue.number);
    setSelectedTitle(`#${issue.number} ${issue.title}`);
    setOpen(false);
    setQuery("");
  }

  function clearSelection(): void {
    onChange(null);
    setSelectedTitle(null);
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Display current selection or open picker */}
      {value && selectedTitle ? (
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-lg border border-edge bg-surface-raised px-3 py-2 text-sm flex-1">
            <Hash size={14} className="text-accent" />
            <span className="truncate text-content">{selectedTitle}</span>
          </span>
          <button
            type="button"
            onClick={clearSelection}
            className="text-sm text-content-muted hover:text-error transition-colors"
          >
            ×
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={`${inputClass} text-left text-content-muted`}
        >
          <span className="flex items-center gap-2">
            <Search size={14} />
            Link GitHub issue...
          </span>
        </button>
      )}

      {/* Hidden input for form submission */}
      <input type="hidden" name="github_issue" value={value ?? ""} />

      {/* Dropdown */}
      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-edge bg-surface-raised shadow-lg">
          {/* Search input */}
          <div className="p-2 border-b border-edge">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted"
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search issues..."
                autoFocus
                className="w-full rounded-md border border-edge bg-surface px-3 py-1.5 pl-8 text-sm outline-none focus:ring-2 focus:ring-focus-ring/30"
              />
            </div>
          </div>

          {/* Results */}
          <div className="max-h-[240px] overflow-y-auto">
            {loading && (
              <div className="flex items-center gap-2 px-3 py-4 text-sm text-content-muted">
                <Spinner size="h-3.5 w-3.5" />
                Searching...
              </div>
            )}

            {error && (
              <div className="px-3 py-4 text-sm text-error">{error}</div>
            )}

            {!loading && !error && issues.length === 0 && query.length >= 2 && (
              <div className="px-3 py-4 text-sm text-content-muted">
                No issues found for &quot;{query}&quot;
              </div>
            )}

            {!loading && !error && issues.length === 0 && query.length < 2 && query.length > 0 && (
              <div className="px-3 py-4 text-sm text-content-muted">
                Type at least 2 characters
              </div>
            )}

            {issues.map((issue) => (
              <button
                key={issue.number}
                type="button"
                onClick={() => selectIssue(issue)}
                className="flex items-start gap-3 w-full px-3 py-2 text-left hover:bg-hover transition-colors"
              >
                <span className="text-xs font-mono text-accent mt-0.5">
                  #{issue.number}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-content truncate">
                    {issue.title}
                  </p>
                  {issue.labels.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {issue.labels.slice(0, 3).map((label) => (
                        <span
                          key={label.name}
                          className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                          style={{
                            backgroundColor: `#${label.color}20`,
                            color: `#${label.color}`,
                          }}
                        >
                          {label.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <ExternalLink
                  size={12}
                  className="text-content-muted mt-1 shrink-0"
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
