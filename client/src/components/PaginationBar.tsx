import { Pagination } from "../api.js";

// The list footer shared by My Tickets (Lab 2 ui-spec.md §6.1) and the Ticket
// Queue (Lab 3 ui-spec.md §7.1), which specifies the same footer: a summary
// line, Previous/Next with page numbers, and a page size select. Moved out of
// My Tickets in Issue #31 rather than copied, so the two lists cannot drift.

export const PAGE_SIZES = [10, 25, 50];

export default function PaginationBar({
  pagination,
  isMobile,
  pageSize,
  onPage,
  onPageSize,
}: {
  pagination: Pagination;
  isMobile: boolean;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const { page, totalItems, totalPages } = pagination;
  const from = totalItems === 0 ? 0 : (page - 1) * pagination.pageSize + 1;
  const to = Math.min(page * pagination.pageSize, totalItems);

  return (
    <div className="zg-list-footer">
      <p data-testid="pagination-summary" className="zg-text-sm zg-text-muted">
        Showing {from} to {to} of {totalItems} tickets
      </p>

      <div className="zg-pagination">
        <button type="button" className="zg-btn--secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>

        {/* §6.3 drops the numbered buttons on mobile so the controls stay
            thumb-reachable, and names the position in words instead. */}
        {isMobile ? (
          <span className="zg-text-sm">
            Page {page} of {Math.max(totalPages, 1)}
          </span>
        ) : (
          pageNumbers(page, totalPages).map((entry, index) =>
            entry === "…" ? (
              <span key={`gap-${index}`} className="zg-text-sm zg-text-muted">
                …
              </span>
            ) : (
              <button
                key={entry}
                type="button"
                className={entry === page ? "zg-btn--primary" : "zg-btn--secondary"}
                aria-current={entry === page ? "page" : undefined}
                onClick={() => onPage(entry)}
              >
                {entry}
              </button>
            ),
          )
        )}

        <button
          type="button"
          className="zg-btn--secondary"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>

        <div className="zg-field zg-page-size">
          <label className="zg-visually-hidden" htmlFor="page-size">
            Tickets per page
          </label>
          <select
            id="page-size"
            className="zg-field--editable"
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} per page
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

/** First, last and the pages around the current one, with gaps elided (§6.1). */
function pageNumbers(page: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);

  const around = [page - 1, page, page + 1].filter((n) => n > 1 && n < totalPages);
  const entries: (number | "…")[] = [1];
  if (around[0] !== undefined && around[0] > 2) entries.push("…");
  entries.push(...around);
  if (around[around.length - 1] !== undefined && around[around.length - 1] < totalPages - 1) entries.push("…");
  entries.push(totalPages);
  return entries;
}
