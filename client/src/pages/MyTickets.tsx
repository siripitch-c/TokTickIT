import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import {
  Pagination,
  ReferenceItem,
  AuthUser,
  RequestedPriority,
  SortDirection,
  TicketSortField,
  TicketSummary,
  fetchCategories,
  fetchTickets,
} from "../api.js";
import { PriorityBadge, StatusBadge } from "../components/Badge.js";
import PaginationBar from "../components/PaginationBar.js";
import { MOBILE_QUERY, useMediaQuery } from "../lib/useMediaQuery.js";

// ui-spec.md §6 — My Tickets Screen.
// specification.md FR-05..FR-08, BR-11..BR-18, BR-37; tests.md UI-LIST-01..07.

const SEARCH_DEBOUNCE_MS = 300;
const SKELETON_ROWS = 5;

const PRIORITIES: { value: RequestedPriority; label: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
];

interface Filters {
  category: string;
  requestedPriority: string;
  itPriority: string;
  status: string;
}

const NO_FILTERS: Filters = { category: "", requestedPriority: "", itPriority: "", status: "" };

type ListState = "loading" | "ready" | "error";

export default function MyTickets() {
  const user = useOutletContext<AuthUser>();
  const navigate = useNavigate();
  const isMobile = useMediaQuery(MOBILE_QUERY);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sortBy, setSortBy] = useState<TicketSortField>("createdAt");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [state, setState] = useState<ListState>("loading");
  const [rows, setRows] = useState<TicketSummary[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [categories, setCategories] = useState<ReferenceItem[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);

  // BR-37 needs "you own nothing" told apart from "nothing matched". The first
  // load of a screen is always unfiltered, so it answers the first question
  // once and later filtered loads can rely on it without an extra request.
  const [ownsAny, setOwnsAny] = useState<boolean | null>(null);

  const isFiltered = search !== "" || Object.values(filters).some((v) => v !== "");

  // A superseded response must never land: debounced typing and quick filter
  // changes overlap, and the slower of two requests could otherwise repaint
  // the list with older results.
  const lookup = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // BR-07: a different Requester is a different list. Filters, search, sort and
  // page all reset rather than carrying someone else's view across.
  useEffect(() => {
    setSearchInput("");
    setSearch("");
    setFilters(NO_FILTERS);
    setSortBy("createdAt");
    setSortDir("desc");
    setPage(1);
    setOwnsAny(null);
    setState("loading");
  }, [user.id]);

  useEffect(() => {
    fetchCategories()
      .then(setCategories)
      .catch(() => setCategories([])); // the list itself still works without filter labels
  }, []);

  const load = useCallback(async () => {
    const token = ++lookup.current;
    setState("loading");
    try {
      const result = await fetchTickets({
        search,
        category: filters.category === "" ? "" : Number(filters.category),
        requestedPriority: filters.requestedPriority as RequestedPriority | "",
        itPriority: filters.itPriority as RequestedPriority | "",
        status: filters.status as "NEW" | "",
        sortBy,
        sortDir,
        page,
        pageSize,
      });
      if (token !== lookup.current) return;

      setRows(result.data);
      setPagination(result.pagination);
      if (search === "" && Object.values(filters).every((v) => v === "")) {
        setOwnsAny(result.pagination.totalItems > 0);
      }
      setState("ready");
    } catch {
      if (token !== lookup.current) return;
      setState("error");
    }
  }, [user.id, search, filters, sortBy, sortDir, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  function updateFilter(name: keyof Filters, value: string) {
    setFilters((current) => ({ ...current, [name]: value }));
    setPage(1); // a narrower list makes the old page number meaningless
  }

  function clearFilters() {
    setSearchInput("");
    setSearch("");
    setFilters(NO_FILTERS);
    setPage(1);
    setSheetOpen(false);
  }

  // ui-spec.md §6.1: the same column toggles direction; a different column
  // becomes the primary field. A newly chosen field starts descending, matching
  // BR-15's default rather than flipping to ascending for no reason.
  function toggleSort(field: TicketSortField) {
    if (field === sortBy) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
    setPage(1);
  }

  const sortIndicator = (field: TicketSortField) =>
    field !== sortBy ? "↕" : sortDir === "asc" ? "↑" : "↓";

  const sortLabel = (field: TicketSortField, name: string) =>
    field !== sortBy
      ? `Sort by ${name}`
      : `Sorted by ${name}, ${sortDir === "asc" ? "ascending" : "descending"}. Activate to reverse.`;

  const categoryName = (id: number) => categories.find((c) => c.id === id)?.name ?? "—";

  const showEmpty = state === "ready" && rows.length === 0 && !isFiltered && ownsAny === false;
  const showNoResults = state === "ready" && rows.length === 0 && !showEmpty;
  // §6.4: with nothing to filter there is nothing for the controls to do.
  const showControls = !showEmpty;

  return (
    <section className="zg-card zg-card--wide">
      <div className="zg-list-header">
        <div>
          <h1 className="zg-text-xl zg-text-left">My Tickets</h1>
          <p className="zg-text-sm zg-text-muted">View and track all of your support requests.</p>
        </div>
        <div className="zg-list-header-actions">
          {showControls && (
            <button type="button" className="zg-btn--secondary" onClick={clearFilters} disabled={!isFiltered}>
              Clear Filters
            </button>
          )}
          <Link className="zg-btn--primary" to="/tickets/new">
            + Create Ticket
          </Link>
        </div>
      </div>

      {showControls && (
        <div className="zg-list-controls">
          <div className="zg-field zg-search-field">
            <label className="zg-visually-hidden" htmlFor="ticket-search">
              Search tickets
            </label>
            <input
              id="ticket-search"
              type="search"
              className="zg-field--editable"
              placeholder="Search by ticket number or summary…"
              value={searchInput}
              disabled={state === "loading" && rows.length === 0 && ownsAny === null}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setPage(1);
              }}
            />
          </div>

          {isMobile ? (
            <button
              type="button"
              className="zg-btn--secondary zg-filters-toggle"
              aria-expanded={sheetOpen}
              onClick={() => setSheetOpen((open) => !open)}
            >
              Filters
            </button>
          ) : (
            <FilterSelects filters={filters} categories={categories} onChange={updateFilter} />
          )}
        </div>
      )}

      {isMobile && sheetOpen && (
        <div className="zg-filter-sheet" role="group" aria-label="Filters">
          <FilterSelects filters={filters} categories={categories} onChange={updateFilter} />
          <div className="zg-filter-sheet-actions">
            <button type="button" className="zg-btn--secondary" onClick={clearFilters}>
              Clear Filters
            </button>
            <button type="button" className="zg-btn--primary" onClick={() => setSheetOpen(false)}>
              Apply
            </button>
          </div>
        </div>
      )}

      {state === "loading" && (
        <div data-testid="zg-state-loading" className="zg-state--loading" role="status">
          {Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <div key={i} className="zg-skeleton-bar" />
          ))}
          Loading your tickets…
        </div>
      )}

      {state === "error" && (
        <div data-testid="zg-state-error" className="zg-state--error" role="alert">
          <p>We couldn&rsquo;t load your tickets.</p>
          <button type="button" className="zg-btn--secondary" onClick={load}>
            Retry
          </button>
        </div>
      )}

      {showEmpty && (
        <div data-testid="zg-state-empty" className="zg-state--empty">
          <p>You haven&rsquo;t created any tickets yet.</p>
          <Link className="zg-btn--primary" to="/tickets/new">
            Create Ticket
          </Link>
        </div>
      )}

      {showNoResults && (
        <div data-testid="zg-state-no-results" className="zg-state--no-results">
          <p>No tickets match your filters.</p>
          <button type="button" className="zg-btn--secondary" onClick={clearFilters}>
            Clear Filters
          </button>
        </div>
      )}

      {state === "ready" && rows.length > 0 && (
        <>
          {isMobile ? (
            <ul data-testid="ticket-cards" className="zg-ticket-cards">
              {rows.map((ticket) => (
                <li key={ticket.id}>
                  {/* A link, not a button: this goes to a URL, and the desktop
                      table already settled that in §6.1. A button would give
                      phone users no address to open in a new tab or copy, and
                      would have a screen reader announce "button" for the same
                      action it announces as "link" on a wider screen. */}
                  <Link className="zg-ticket-card" to={`/tickets/${ticket.id}`}>
                    <span className="zg-text-sm zg-text-muted">
                      {ticket.ticketNumber} · {formatDate(ticket.createdAt)}
                    </span>
                    <span className="zg-ticket-card-summary">{ticket.summary}</span>
                    <span className="zg-badge-row">
                      <PriorityBadge value={ticket.requestedPriority} label="Requested priority" />
                      <PriorityBadge value={ticket.itPriority} label="IT priority" />
                      <StatusBadge value={ticket.currentStatus} />
                    </span>
                    <span className="zg-text-xs zg-text-muted">
                      {categoryName(ticket.categoryId)} · Updated {formatDate(ticket.updatedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="zg-table-wrap">
              <table data-testid="ticket-table" className="zg-table">
                <thead>
                  <tr>
                    <SortableHeader
                      field="ticketNumber"
                      dir={sortDir}
                      name="Ticket No."
                      active={sortBy}
                      indicator={sortIndicator("ticketNumber")}
                      label={sortLabel("ticketNumber", "ticket number")}
                      onSort={toggleSort}
                    />
                    <SortableHeader
                      field="createdAt"
                      dir={sortDir}
                      name="Created Date"
                      active={sortBy}
                      indicator={sortIndicator("createdAt")}
                      label={sortLabel("createdAt", "created date")}
                      onSort={toggleSort}
                    />
                    <th scope="col">Summary</th>
                    {/* Hidden at tablet width to avoid horizontal scroll; still filterable (§6.2). */}
                    <th scope="col" className="zg-col-category">
                      Category
                    </th>
                    <th scope="col">Requested Priority</th>
                    <th scope="col">IT Priority</th>
                    <th scope="col">Current Status</th>
                    <SortableHeader
                      field="updatedAt"
                      dir={sortDir}
                      name="Last Updated"
                      active={sortBy}
                      indicator={sortIndicator("updatedAt")}
                      label={sortLabel("updatedAt", "last updated")}
                      onSort={toggleSort}
                    />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((ticket) => (
                    // §6.1 wants the whole row clickable. The row keeps its
                    // table semantics — a role on the <tr> would replace
                    // "row" and drop it out of the table for assistive
                    // technology — so the click is a convenience for pointers
                    // and the real, focusable link lives in the first cell.
                    <tr
                      key={ticket.id}
                      className="zg-table-row"
                      onClick={() => navigate(`/tickets/${ticket.id}`)}
                    >
                      <td>
                        <Link
                          className="zg-btn--tertiary zg-ticket-link"
                          to={`/tickets/${ticket.id}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {ticket.ticketNumber}
                        </Link>
                      </td>
                      <td>{formatDate(ticket.createdAt)}</td>
                      <td>{ticket.summary}</td>
                      <td className="zg-col-category">{categoryName(ticket.categoryId)}</td>
                      <td>
                        <PriorityBadge value={ticket.requestedPriority} label="Requested priority" />
                      </td>
                      <td>
                        <PriorityBadge value={ticket.itPriority} label="IT priority" />
                      </td>
                      <td>
                        <StatusBadge value={ticket.currentStatus} />
                      </td>
                      <td>{formatDate(ticket.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pagination && (
            <PaginationBar
              pagination={pagination}
              isMobile={isMobile}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          )}
        </>
      )}
    </section>
  );
}

function SortableHeader({
  field,
  name,
  active,
  dir,
  indicator,
  label,
  onSort,
}: {
  field: TicketSortField;
  name: string;
  active: TicketSortField;
  dir: SortDirection;
  indicator: string;
  label: string;
  onSort: (field: TicketSortField) => void;
}) {
  // aria-sort belongs on the column actually being sorted; the others say
  // "none". Leaving the active one unset told assistive technology that no
  // column was sorted at all, which is the opposite of what the arrow shows.
  return (
    <th
      scope="col"
      aria-sort={field === active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button type="button" className="zg-sort-header" onClick={() => onSort(field)} title={label} aria-label={label}>
        {name} <span aria-hidden="true">{indicator}</span>
      </button>
    </th>
  );
}

function FilterSelects({
  filters,
  categories,
  onChange,
}: {
  filters: Filters;
  categories: ReferenceItem[];
  onChange: (name: keyof Filters, value: string) => void;
}) {
  return (
    <div className="zg-filters">
      <Select
        name="category"
        label="Category"
        allLabel="All Categories"
        value={filters.category}
        options={categories.map((c) => ({ value: String(c.id), label: c.name }))}
        onChange={onChange}
      />
      <Select
        name="requestedPriority"
        label="Requested Priority"
        allLabel="All Requested Priorities"
        value={filters.requestedPriority}
        options={PRIORITIES.map((p) => ({ value: p.value, label: p.label }))}
        onChange={onChange}
      />
      <Select
        name="itPriority"
        label="IT Priority"
        allLabel="All IT Priorities"
        value={filters.itPriority}
        options={PRIORITIES.map((p) => ({ value: p.value, label: p.label }))}
        onChange={onChange}
      />
      <Select
        name="status"
        label="Current Status"
        allLabel="All Statuses"
        value={filters.status}
        options={[{ value: "NEW", label: "New" }]}
        onChange={onChange}
      />
    </div>
  );
}

function Select({
  name,
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  name: keyof Filters;
  label: string;
  allLabel: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (name: keyof Filters, value: string) => void;
}) {
  return (
    <div className="zg-field">
      <label className="zg-field-label" htmlFor={`filter-${name}`}>
        {label}
      </label>
      <select
        id={`filter-${name}`}
        className="zg-field--editable"
        value={value}
        onChange={(e) => onChange(name, e.target.value)}
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
