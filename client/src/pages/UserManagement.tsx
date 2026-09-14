import { MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { AdminUser, ApiError, AuthUser, Role, fetchUsers } from "../api.js";
import { RoleBadge } from "../components/Badge.js";
import ForbiddenState from "../components/ForbiddenState.js";
import Toast from "../components/Toast.js";
import UserDialog from "../components/UserDialog.js";
import { MOBILE_QUERY, useMediaQuery } from "../lib/useMediaQuery.js";

// ui-spec.md §9 — Administrator User Management. FR-22..FR-26, AC-21, AC-27,
// BR-41.
//
// One list, two controls, two dialogs. What the handout excludes is absent
// rather than inert: no sortable headers, no pagination, no second filter, no
// delete (BR-39, BR-41).

const SEARCH_DEBOUNCE_MS = 300;
const SKELETON_ROWS = 4;

const ROLE_FILTERS: { value: Role; label: string }[] = [
  { value: "REQUESTER", label: "Requester" },
  { value: "IT_STAFF", label: "IT Staff" },
  { value: "ADMINISTRATOR", label: "Administrator" },
];

type ListState = "loading" | "ready" | "error" | "forbidden";

interface Props {
  /**
   * The signed-in Administrator saved their own account. The session adopts it,
   * so the header shows a new name at once and a new initial password leads
   * straight to Change Password.
   */
  onOwnAccountChanged?: (user: AdminUser) => void;
}

export default function UserManagement({ onOwnAccountChanged }: Props) {
  const me = useOutletContext<AuthUser>();
  const isMobile = useMediaQuery(MOBILE_QUERY);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<Role | "">("");

  const [state, setState] = useState<ListState>("loading");
  const [users, setUsers] = useState<AdminUser[]>([]);
  // "No accounts at all" and "nothing matched" are different states (§10);
  // only an unfiltered answer can tell them apart.
  const [anyUsers, setAnyUsers] = useState<boolean | null>(null);

  const [editing, setEditing] = useState<{ user: AdminUser | null } | null>(null);
  // The id makes each toast its own: saving the same account twice gives the
  // same words, and the second must still get its full time on screen.
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);

  const createButton = useRef<HTMLButtonElement>(null);
  const editOpener = useRef<HTMLButtonElement | null>(null);

  const isFiltered = search !== "" || role !== "";

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // A superseded response must never land: debounced typing and a quick role
  // change overlap, and the slower answer could repaint the list with an older one.
  const lookup = useRef(0);

  const load = useCallback(
    async (quiet = false) => {
      const token = ++lookup.current;
      // After a save the list is refreshed in place rather than replaced by a
      // loading state, so the row whose Edit button opened the dialog is still
      // there to take focus back.
      if (!quiet) setState("loading");
      try {
        const data = await fetchUsers({ search: search || undefined, role: role || undefined });
        if (token !== lookup.current) return;
        setUsers(data);
        if (search === "" && role === "") setAnyUsers(data.length > 0);
        setState("ready");
      } catch (error) {
        if (token !== lookup.current) return;
        // AC-21: a 403 is a refusal, shown as one, not as an outage.
        setState(error instanceof ApiError && error.status === 403 ? "forbidden" : "error");
      }
    },
    [search, role],
  );

  useEffect(() => {
    load();
  }, [load]);

  const dismissToast = useCallback(() => setToast(null), []);

  function clearFilters() {
    setSearchInput("");
    setSearch("");
    setRole("");
  }

  function openEdit(user: AdminUser, event: MouseEvent<HTMLButtonElement>) {
    editOpener.current = event.currentTarget;
    setEditing({ user });
  }

  if (state === "forbidden") {
    return <ForbiddenState role={me.role} />;
  }

  const showEmpty = state === "ready" && users.length === 0 && !isFiltered && anyUsers === false;
  const showNoResults = state === "ready" && users.length === 0 && !showEmpty;

  return (
    <section className="zg-card zg-card--wide">
      <div className="zg-list-header">
        <div>
          <h1 className="zg-text-xl zg-text-left">User Management</h1>
          <p className="zg-text-sm zg-text-muted">Accounts, roles and access.</p>
        </div>
        <div className="zg-list-header-actions">
          <button
            ref={createButton}
            type="button"
            className="zg-btn--primary"
            onClick={() => setEditing({ user: null })}
          >
            + Create User
          </button>
        </div>
      </div>

      {/* §9.1: two controls only — the handout excludes more than one filter. */}
      <div className="zg-list-controls">
        <div className="zg-field zg-search-field">
          <label className="zg-visually-hidden" htmlFor="user-search">
            Search users
          </label>
          <input
            id="user-search"
            type="search"
            className="zg-field--editable"
            placeholder="Search by name or email…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <div className="zg-field zg-user-role-filter">
          <label className="zg-field-label" htmlFor="user-role-filter">
            Role
          </label>
          <select
            id="user-role-filter"
            className="zg-field--editable"
            value={role}
            onChange={(e) => setRole(e.target.value as Role | "")}
          >
            <option value="">All roles</option>
            {ROLE_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {state === "loading" && (
        <div data-testid="zg-state-loading" className="zg-state--loading" role="status">
          {Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <div key={i} className="zg-skeleton-bar" />
          ))}
          Loading accounts…
        </div>
      )}

      {state === "error" && (
        <div data-testid="zg-state-error" className="zg-state--error" role="alert">
          <p>We couldn&rsquo;t load the accounts.</p>
          <button type="button" className="zg-btn--secondary" onClick={() => load()}>
            Retry
          </button>
        </div>
      )}

      {showEmpty && (
        <div data-testid="zg-state-empty" className="zg-state--empty">
          <p>No accounts have been created yet.</p>
        </div>
      )}

      {showNoResults && (
        <div data-testid="zg-state-no-results" className="zg-state--no-results">
          <p>No accounts match your search.</p>
          <button type="button" className="zg-btn--secondary" onClick={clearFilters}>
            Clear Search
          </button>
        </div>
      )}

      {state === "ready" && users.length > 0 && (
        isMobile ? (
          // §9.2: below 768px the table becomes cards — one representation in
          // the DOM, never both.
          <ul data-testid="user-cards" className="zg-user-cards">
            {users.map((user) => (
              <li key={user.id} className="zg-user-card">
                <span className="zg-user-card-name">
                  <strong>{user.name}</strong>
                  <RoleBadge role={user.role} />
                </span>
                <span className="zg-text-sm zg-text-muted">{user.email}</span>
                <UserStatus active={user.isActive} />
                <EditButton user={user} block onEdit={openEdit} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="zg-table-wrap">
            <table data-testid="user-table" className="zg-table">
              <thead>
                <tr>
                  {/* §9.1: exactly the five the handout names, in that order,
                      and none of them sortable. */}
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Edit</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.name}</td>
                    <td>{user.email}</td>
                    <td>
                      <RoleBadge role={user.role} />
                    </td>
                    <td>
                      <UserStatus active={user.isActive} />
                    </td>
                    <td>
                      <EditButton user={user} onEdit={openEdit} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {editing && (
        <UserDialog
          user={editing.user}
          currentUserId={me.id}
          returnFocusTo={editing.user ? editOpener : createButton}
          onClose={() => setEditing(null)}
          onOwnAccountChanged={onOwnAccountChanged}
          onSaved={(saved, created) => {
            setEditing(null);
            const message = created ? `Account created for ${saved.name}.` : `Changes to ${saved.name} saved.`;
            setToast((previous) => ({ id: (previous?.id ?? 0) + 1, message }));
            if (saved.id === me.id) onOwnAccountChanged?.(saved);
            // §9.3: the list refreshes "with the new account visible", so a
            // search or role filter that would hide it is cleared — which reloads
            // the list by itself.
            if (created && isFiltered) clearFilters();
            else load(true);
          }}
        />
      )}

      {toast && <Toast key={toast.id} message={toast.message} onDone={dismissToast} />}
    </section>
  );
}

/** §9.1: text with a dot glyph rather than a badge, so it never reads as a ticket status. */
function UserStatus({ active }: { active: boolean }) {
  return (
    <span className={active ? "zg-user-status zg-user-status--active" : "zg-user-status zg-user-status--inactive"}>
      <span aria-hidden="true">&#9679; </span>
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function EditButton({
  user,
  block,
  onEdit,
}: {
  user: AdminUser;
  block?: boolean;
  onEdit: (user: AdminUser, event: MouseEvent<HTMLButtonElement>) => void;
}) {
  // Every row would otherwise have a button named only "Edit". The label names
  // the account and still starts with the visible word.
  return (
    <button
      type="button"
      className={block ? "zg-btn--secondary zg-btn--block" : "zg-btn--secondary"}
      title={`Edit ${user.name}`}
      aria-label={`Edit ${user.name}`}
      onClick={(event) => onEdit(user, event)}
    >
      Edit
    </button>
  );
}
