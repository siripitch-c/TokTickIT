import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import {
  ActorSummary,
  ApiError,
  AuthUser,
  CURRENT_STATUSES,
  CurrentStatus,
  Pagination,
  QueueSortField,
  ReferenceItem,
  RequestedPriority,
  SortDirection,
  StaffTicket,
  fetchAssignees,
  fetchCategories,
  fetchStaffTickets,
} from "../api.js";
import { PriorityBadge, STATUS_LABEL, StatusBadge } from "../components/Badge.js";
import ForbiddenState from "../components/ForbiddenState.js";
import PaginationBar, { PAGE_SIZES } from "../components/PaginationBar.js";
import { MOBILE_QUERY, useMediaQuery } from "../lib/useMediaQuery.js";

// ui-spec.md §7 — IT Staff Ticket Queue. FR-13, FR-16, AC-09, AC-28, BR-40.
//
// The same component family as Lab 2 My Tickets (§7.1) — header, controls,
// table or cards, pagination — with the two differences the screen exists for.
// It is not one Requester's list, so Requester and Owner are columns. And its
// state lives in the address (§7.4): search, filters, sort and page are query
// parameters, so a filtered queue can be bookmarked or shared, and a
// hand-edited address falls back to defaults instead of breaking the screen.

const SEARCH_DEBOUNCE_MS = 300;
const SKELETON_ROWS = 5;
const DEFAULT_SORT: QueueSortField = "updatedAt";
// BR-40: larger than My Tickets' 10, because a shared queue is scanned.
const DEFAULT_PAGE_SIZE = 25;

const SORT_FIELDS: QueueSortField[] = ["ticketNumber", "createdAt", "updatedAt", "itPriority"];

const PRIORITIES: { value: RequestedPriority; label: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
];

type FilterName = "category" | "requestedPriority" | "itPriority" | "status" | "owner";
const FILTER_NAMES: FilterName[] = ["category", "requestedPriority", "itPriority", "status", "owner"];

interface QueueState extends Record<FilterName, string> {
  search: string;
  sortBy: QueueSortField;
  sortDir: SortDirection;
  page: number;
  pageSize: number;
}

const positiveInteger = (raw: string | null) => (raw !== null && /^[1-9]\d*$/.test(raw) ? raw : "");
const priority = (raw: string | null) => (PRIORITIES.some((p) => p.value === raw) ? (raw as string) : "");

/**
 * The queue as the address describes it, with anything unusable replaced by its
 * default — the client half of BR-40's leniency. The server applies the same
 * rules independently; this copy exists so the controls can show the value that
 * is actually in effect.
 */
function readState(params: URLSearchParams): QueueState {
  const owner = params.get("owner");
  const status = params.get("status");
  const size = Number(params.get("pageSize"));
  return {
    search: (params.get("search") ?? "").trim(),
    category: positiveInteger(params.get("category")),
    requestedPriority: priority(params.get("requestedPriority")),
    itPriority: priority(params.get("itPriority")),
    status: CURRENT_STATUSES.includes(status as CurrentStatus) ? (status as string) : "",
    owner: owner === "unassigned" ? "unassigned" : positiveInteger(owner),
    sortBy: SORT_FIELDS.find((f) => f === params.get("sortBy")) ?? DEFAULT_SORT,
    sortDir: params.get("sortDir") === "asc" ? "asc" : "desc",
    page: Number(positiveInteger(params.get("page")) || 1),
    pageSize: PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE,
  };
}

/** The canonical address for a state: defaults are left out, so it stays short. */
function writeState(state: QueueState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.search) params.set("search", state.search);
  for (const name of FILTER_NAMES) {
    if (state[name]) params.set(name, state[name]);
  }
  if (state.sortBy !== DEFAULT_SORT) params.set("sortBy", state.sortBy);
  if (state.sortDir !== "desc") params.set("sortDir", state.sortDir);
  if (state.page !== 1) params.set("page", String(state.page));
  if (state.pageSize !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(state.pageSize));
  return params;
}

type ListState = "loading" | "ready" | "error" | "forbidden";

export default function StaffTicketQueue() {
  const user = useOutletContext<AuthUser>();
  const navigate = useNavigate();
  const isMobile = useMediaQuery(MOBILE_QUERY);

  const [params, setParams] = useSearchParams();
  const query = useMemo(() => readState(params), [params]);
  const canonical = writeState(query).toString();

  // §7.4: "the corresponding control shows the default it fell back to, so the
  // screen and the URL agree." The controls already show the defaults; this
  // makes the address say the same, without adding a history entry.
  useEffect(() => {
    if (params.toString() !== canonical) {
      setParams(new URLSearchParams(canonical), { replace: true });
    }
  }, [params, canonical, setParams]);

  /** Applies changes on top of whatever the address holds now. */
  const update = useCallback(
    (changes: Partial<QueueState>, resetPage = true) => {
      // Built from the current address rather than a captured copy, so a
      // debounced search landing just after a filter change keeps that filter.
      setParams((current) =>
        writeState({ ...readState(current), ...changes, ...(resetPage ? { page: 1 } : {}) }),
      );
    },
    [setParams],
  );

  const [searchInput, setSearchInput] = useState(query.search);
  const [state, setState] = useState<ListState>("loading");
  const [rows, setRows] = useState<StaffTicket[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [categories, setCategories] = useState<ReferenceItem[]>([]);
  const [assignees, setAssignees] = useState<ActorSummary[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Empty ("nothing has ever been raised") and no-results ("nothing matched")
  // are different states (§7.4). Only an unfiltered answer can tell them apart,
  // so it is remembered from whichever load was unfiltered.
  const [anyTickets, setAnyTickets] = useState<boolean | null>(null);

  const isFiltered = query.search !== "" || FILTER_NAMES.some((name) => query[name] !== "");

  // Follows the address when it changes from outside the box — Clear Filters,
  // or the browser's Back button — but not while typing, where the only
  // difference is whitespace the search has already trimmed away.
  useEffect(() => {
    setSearchInput((current) => (current.trim() === query.search ? current : query.search));
  }, [query.search]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === query.search) return;
    const timer = setTimeout(() => update({ search: trimmed }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, query.search, update]);

  // Filter labels. The queue still works without them, so a failure here is
  // not a failure of the screen.
  useEffect(() => {
    fetchCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
    fetchAssignees()
      .then(setAssignees)
      .catch(() => setAssignees([]));
  }, []);

  // A superseded response must never land: debounced typing and quick filter
  // changes overlap, and the slower of two requests could otherwise repaint
  // the queue with an older answer.
  const lookup = useRef(0);

  const load = useCallback(async () => {
    const token = ++lookup.current;
    setState("loading");
    try {
      const result = await fetchStaffTickets({
        search: query.search || undefined,
        category: query.category ? Number(query.category) : undefined,
        requestedPriority: (query.requestedPriority || undefined) as RequestedPriority | undefined,
        itPriority: (query.itPriority || undefined) as RequestedPriority | undefined,
        status: (query.status || undefined) as CurrentStatus | undefined,
        owner: query.owner === "unassigned" ? "unassigned" : query.owner ? Number(query.owner) : undefined,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
        page: query.page,
        pageSize: query.pageSize,
      });
      if (token !== lookup.current) return;

      setRows(result.data);
      setPagination(result.pagination);
      if (!isFiltered) setAnyTickets(result.pagination.totalItems > 0);
      setState("ready");
    } catch (error) {
      if (token !== lookup.current) return;
      // UI-QUEUE-06: a 403 is a refusal, not an outage, and gets its own state.
      setState(error instanceof ApiError && error.status === 403 ? "forbidden" : "error");
    }
    // `canonical` stands for every field of `query`: two addresses that mean
    // the same queue must not fetch it twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonical]);

  useEffect(() => {
    load();
  }, [load]);

  function clearFilters() {
    setSearchInput("");
    update({ search: "", category: "", requestedPriority: "", itPriority: "", status: "", owner: "" });
    setSheetOpen(false);
  }

  // Lab 2 §6.1, which §7.1 adopts: the same column reverses; a different column
  // becomes the sort and starts descending; either way back to page 1.
  function toggleSort(field: QueueSortField) {
    if (field === query.sortBy) {
      update({ sortDir: query.sortDir === "asc" ? "desc" : "asc" });
    } else {
      update({ sortBy: field, sortDir: "desc" });
    }
  }

  if (state === "forbidden") {
    return <ForbiddenState role={user.role} />;
  }

  const categoryName = (id: number) => categories.find((c) => c.id === id)?.name ?? "—";

  const showEmpty = state === "ready" && rows.length === 0 && !isFiltered && anyTickets === false;
  const showNoResults = state === "ready" && rows.length === 0 && !showEmpty;

  const filterSelects = (
    <FilterSelects query={query} categories={categories} assignees={assignees} onChange={(name, value) => update({ [name]: value })} />
  );

  return (
    <section className="zg-card zg-card--wide">
      <div className="zg-list-header">
        <div>
          <h1 className="zg-text-xl zg-text-left">Ticket Queue</h1>
          <p className="zg-text-sm zg-text-muted">Every ticket, across all requesters.</p>
        </div>
        {/* No Create Ticket here: neither IT Staff nor Administrators raise
            tickets in Lab 3 (§7.1). */}
        <div className="zg-list-header-actions">
          <button type="button" className="zg-btn--secondary" onClick={clearFilters} disabled={!isFiltered}>
            Clear Filters
          </button>
        </div>
      </div>

      {/* §7.4: the controls render immediately, so a filter can be chosen
          while the first page is still loading. */}
      <div className="zg-list-controls">
        <div className="zg-field zg-search-field">
          <label className="zg-visually-hidden" htmlFor="queue-search">
            Search tickets
          </label>
          <input
            id="queue-search"
            type="search"
            className="zg-field--editable"
            placeholder="Search by ticket number or summary…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
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
          filterSelects
        )}
      </div>

      {isMobile && sheetOpen && (
        <div className="zg-filter-sheet" role="group" aria-label="Filters">
          {filterSelects}
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
          Loading the ticket queue…
        </div>
      )}

      {state === "error" && (
        <div data-testid="zg-state-error" className="zg-state--error" role="alert">
          <p>We couldn&rsquo;t load the ticket queue.</p>
          <button type="button" className="zg-btn--secondary" onClick={load}>
            Retry
          </button>
        </div>
      )}

      {/* No call to action: staff cannot create a ticket (§7.4). */}
      {showEmpty && (
        <div data-testid="zg-state-empty" className="zg-state--empty">
          <p>No tickets have been created yet.</p>
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
            <ul data-testid="queue-cards" className="zg-ticket-cards">
              {rows.map((ticket) => (
                <li key={ticket.id}>
                  {/* §7.3: the whole card is a link, because the same action
                      must not become a button because the viewport narrowed. */}
                  <Link className="zg-ticket-card zg-queue-card" to={`/tickets/${ticket.id}`}>
                    <span className="zg-text-sm zg-text-muted">
                      {ticket.ticketNumber} · Updated {formatDate(ticket.updatedAt)}
                    </span>
                    <span className="zg-ticket-card-summary">{ticket.summary}</span>
                    {/* §2.2: the two priorities share fills, so they are never
                        two bare badges side by side. */}
                    <span className="zg-badge-row">
                      <StatusBadge value={ticket.currentStatus} />
                      <span className="zg-text-xs zg-text-muted">IT</span>
                      <PriorityBadge value={ticket.itPriority} label="IT priority" />
                      <span className="zg-text-xs zg-text-muted">Requested</span>
                      <PriorityBadge value={ticket.requestedPriority} label="Requested priority" />
                    </span>
                    <span className="zg-text-xs zg-text-muted">
                      {ticket.requester.name} ·{" "}
                      {ticket.owner ? (
                        ticket.owner.name
                      ) : (
                        // An unclaimed ticket is the one thing a staff member
                        // scanning a phone is looking for (§7.3).
                        <span className="zg-owner-unassigned">Unassigned</span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="zg-table-wrap">
              <table data-testid="queue-table" className="zg-table">
                <thead>
                  <tr>
                    <SortableHeader field="ticketNumber" name="Ticket No." query={query} onSort={toggleSort} />
                    <th scope="col">Summary</th>
                    <th scope="col">Requester</th>
                    {/* Both dropped at tablet width, and both still filterable (§7.2). */}
                    <th scope="col" className="zg-col-category">
                      Category
                    </th>
                    <th scope="col" className="zg-col-requested-priority">
                      Requested Priority
                    </th>
                    <SortableHeader field="itPriority" name="IT Priority" query={query} onSort={toggleSort} />
                    <th scope="col">Current Status</th>
                    <th scope="col">Owner</th>
                    <SortableHeader field="updatedAt" name="Last Updated" query={query} onSort={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((ticket) => (
                    // The row stays a row for assistive technology; the click is
                    // a pointer convenience and the real link is the first cell,
                    // exactly as Lab 2 §6.1 settled for My Tickets.
                    <tr key={ticket.id} className="zg-table-row" onClick={() => navigate(`/tickets/${ticket.id}`)}>
                      <td>
                        <Link
                          className="zg-btn--tertiary zg-ticket-link"
                          to={`/tickets/${ticket.id}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {ticket.ticketNumber}
                        </Link>
                      </td>
                      <td>{ticket.summary}</td>
                      <td>{ticket.requester.name}</td>
                      <td className="zg-col-category">{categoryName(ticket.categoryId)}</td>
                      <td className="zg-col-requested-priority">
                        <PriorityBadge value={ticket.requestedPriority} label="Requested priority" />
                      </td>
                      <td>
                        <PriorityBadge value={ticket.itPriority} label="IT priority" />
                      </td>
                      <td>
                        <StatusBadge value={ticket.currentStatus} />
                      </td>
                      <td>
                        {/* tests.md §5: recognisable at a glance in the table as
                            well as on the card (§7.3). */}
                        {ticket.owner ? ticket.owner.name : <span className="zg-owner-unassigned">Unassigned</span>}
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
              pageSize={query.pageSize}
              onPage={(page) => update({ page }, false)}
              onPageSize={(pageSize) => update({ pageSize })}
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
  query,
  onSort,
}: {
  field: QueueSortField;
  name: string;
  query: QueueState;
  onSort: (field: QueueSortField) => void;
}) {
  const active = field === query.sortBy;
  const indicator = !active ? "↕" : query.sortDir === "asc" ? "↑" : "↓";
  const label = !active
    ? `Sort by ${name.toLowerCase()}`
    : `Sorted by ${name.toLowerCase()}, ${query.sortDir === "asc" ? "ascending" : "descending"}. Activate to reverse.`;

  return (
    <th scope="col" aria-sort={active ? (query.sortDir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="zg-sort-header" onClick={() => onSort(field)} title={label} aria-label={label}>
        {name} <span aria-hidden="true">{indicator}</span>
      </button>
    </th>
  );
}

function FilterSelects({
  query,
  categories,
  assignees,
  onChange,
}: {
  query: QueueState;
  categories: ReferenceItem[];
  assignees: ActorSummary[];
  onChange: (name: FilterName, value: string) => void;
}) {
  const ownerOptions = [
    { value: "unassigned", label: "Unassigned" },
    ...assignees.map((person) => ({ value: String(person.id), label: person.name })),
  ];
  // An owner id in the address that is not an active assignee — a deactivated
  // owner (BR-26), say — is still the filter in effect. It gets an option of its
  // own so the select shows it rather than claiming "All owners".
  if (query.owner && !ownerOptions.some((option) => option.value === query.owner)) {
    ownerOptions.push({ value: query.owner, label: `Owner #${query.owner}` });
  }

  return (
    <div className="zg-filters">
      <Select
        name="category"
        label="Category"
        allLabel="All Categories"
        value={query.category}
        options={categories.map((c) => ({ value: String(c.id), label: c.name }))}
        onChange={onChange}
      />
      <Select
        name="requestedPriority"
        label="Requested Priority"
        allLabel="All Requested Priorities"
        value={query.requestedPriority}
        options={PRIORITIES}
        onChange={onChange}
      />
      <Select
        name="itPriority"
        label="IT Priority"
        allLabel="All IT Priorities"
        value={query.itPriority}
        options={PRIORITIES}
        onChange={onChange}
      />
      <Select
        name="status"
        label="Current Status"
        allLabel="All Statuses"
        value={query.status}
        options={CURRENT_STATUSES.map((status) => ({ value: status, label: STATUS_LABEL[status] }))}
        onChange={onChange}
      />
      <Select name="owner" label="Owner" allLabel="All owners" value={query.owner} options={ownerOptions} onChange={onChange} />
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
  name: FilterName;
  label: string;
  allLabel: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (name: FilterName, value: string) => void;
}) {
  return (
    <div className="zg-field">
      <label className="zg-field-label" htmlFor={`queue-filter-${name}`}>
        {label}
      </label>
      <select
        id={`queue-filter-${name}`}
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
