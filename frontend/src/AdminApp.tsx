import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import Spinner from "./components/Spinner";
import { ApiError } from "./api/client";
import {
  getAdminMe,
  getAdminOverview,
  getAdminUsers,
  getAdminLogs,
  deleteAdminUser,
  resetAdminUserPassword,
  updateAdminUser,
  type AdminAuditLog,
  type AdminOverview,
  type AdminUser,
} from "./api/admin";

const PAGE_SIZE_OPTIONS = [25, 50, 100];
const LOG_PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border bg-panel-2/70 p-4">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-text">{value}</p>
    </div>
  );
}

function AdminContent() {
  const { user, loading: authLoading, login, logout, updateUser } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");

  const [adminChecked, setAdminChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminCheckError, setAdminCheckError] = useState("");

  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState("");
  const [updatingKeys, setUpdatingKeys] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<AdminUser | null>(null);
  const [passwordAdminPassword, setPasswordAdminPassword] = useState("");
  const [passwordNew, setPasswordNew] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [logs, setLogs] = useState<AdminAuditLog[]>([]);
  const [logQueryInput, setLogQueryInput] = useState("");
  const [logQuery, setLogQuery] = useState("");
  const [logPage, setLogPage] = useState(1);
  const [logPageSize, setLogPageSize] = useState(50);
  const [logTotal, setLogTotal] = useState(0);
  const [logHasMore, setLogHasMore] = useState(false);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState("");

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);
  const logTotalPages = useMemo(() => Math.max(1, Math.ceil(logTotal / logPageSize)), [logTotal, logPageSize]);

  const verifyAdmin = useCallback(async () => {
    if (!user?.id) {
      setAdminChecked(false);
      setIsAdmin(false);
      setAdminCheckError("");
      return;
    }
    setAdminChecked(false);
    setAdminCheckError("");
    try {
      const me = await getAdminMe();
      setIsAdmin(!!me.is_admin);
      setAdminChecked(true);
    } catch (err) {
      const e = err as ApiError;
      if (e.status === 403) {
        setIsAdmin(false);
        setAdminChecked(true);
        return;
      }
      if (e.status === 401) {
        setIsAdmin(false);
        setAdminCheckError("Session expired. Please log in again.");
        setAdminChecked(true);
        return;
      }
      setAdminCheckError(e.message || "Failed to verify admin access.");
      setIsAdmin(false);
      setAdminChecked(true);
    }
  }, [user?.id]);

  const loadData = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingData(true);
    setDataError("");
    try {
      const [nextOverview, userPage] = await Promise.all([
        getAdminOverview(),
        getAdminUsers(query, page, pageSize),
      ]);
      setOverview(nextOverview);
      setUsers(userPage.results);
      setTotal(userPage.total);
      setHasMore(userPage.has_more);
    } catch (err) {
      const e = err as ApiError;
      setDataError(e.message || "Failed to load admin data.");
    } finally {
      setLoadingData(false);
    }
  }, [isAdmin, query, page, pageSize]);

  const loadLogs = useCallback(async () => {
    if (!isAdmin) return;
    setLogLoading(true);
    setLogError("");
    try {
      const pageData = await getAdminLogs(logQuery, logPage, logPageSize);
      setLogs(pageData.results);
      setLogTotal(pageData.total);
      setLogHasMore(pageData.has_more);
    } catch (err) {
      const e = err as ApiError;
      setLogError(e.message || "Failed to load audit logs.");
    } finally {
      setLogLoading(false);
    }
  }, [isAdmin, logQuery, logPage, logPageSize]);

  useEffect(() => {
    verifyAdmin();
  }, [verifyAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    loadData();
  }, [isAdmin, loadData]);

  useEffect(() => {
    if (!isAdmin) return;
    loadLogs();
  }, [isAdmin, loadLogs]);

  const onLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    try {
      await login(email, password);
      setPassword("");
    } catch (err) {
      const e = err as ApiError;
      setLoginError(e.message || "Login failed.");
    } finally {
      setLoginLoading(false);
    }
  };

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    setPage(1);
    setQuery(queryInput.trim());
  };

  const onLogSearch = (e: FormEvent) => {
    e.preventDefault();
    setLogPage(1);
    setLogQuery(logQueryInput.trim());
  };

  const onUpdateUserField = async (
    target: AdminUser,
    field: "is_admin" | "is_active",
    nextValue: boolean,
    actionReason?: string
  ) => {
    if (target[field] === nextValue) return;
    const updatingKey = `${target.id}:${field}`;
    setUpdatingKeys((prev) => new Set(prev).add(updatingKey));
    try {
      const result = await updateAdminUser(target.id, {
        [field]: nextValue,
        ...(actionReason ? { action_reason: actionReason } : {}),
      });
      setUsers((prev) => prev.map((u) => (u.id === target.id ? result.user : u)));
      if (user?.id === target.id) {
        updateUser({ is_admin: result.user.is_admin, is_active: result.user.is_active });
      }
      if (field === "is_admin" && user?.id === target.id && !result.user.is_admin) {
        setIsAdmin(false);
      }
      void loadLogs();
    } catch (err) {
      const e = err as ApiError;
      setDataError(e.message || "Failed to update user.");
    } finally {
      setUpdatingKeys((prev) => {
        const next = new Set(prev);
        next.delete(updatingKey);
        return next;
      });
    }
  };

  const onRoleChange = async (target: AdminUser, nextRole: "admin" | "user") => {
    if (target.id === user?.id && nextRole === "user") {
      setDataError("You cannot remove your own admin access.");
      return;
    }
    const nextIsAdmin = nextRole === "admin";
    if (nextIsAdmin === target.is_admin) return;
    const action = nextIsAdmin ? "promote to admin" : "remove admin access";
    const ok = window.confirm(`Are you sure you want to ${action} for ${target.email}?`);
    if (!ok) return;
    await onUpdateUserField(target, "is_admin", nextIsAdmin);
  };

  const onStatusChange = async (target: AdminUser, nextStatus: "active" | "disabled") => {
    const nextIsActive = nextStatus === "active";
    if (nextIsActive === target.is_active) return;
    const action = nextIsActive ? "re-enable" : "disable";
    const ok = window.confirm(`Are you sure you want to ${action} ${target.email}?`);
    if (!ok) return;
    if (!nextIsActive) {
      const reasonInput = window.prompt(
        `Write the reason for disabling ${target.email}. This will be sent by email.`,
        ""
      );
      if (reasonInput === null) {
        return;
      }
      const reason = reasonInput.trim();
      if (reason.length < 3) {
        setDataError("Disable reason must be at least 3 characters.");
        return;
      }
      await onUpdateUserField(target, "is_active", nextIsActive, reason);
      return;
    }
    await onUpdateUserField(target, "is_active", nextIsActive);
  };

  const onDeleteConfirmed = async () => {
    if (!deleteTarget) return;
    if (!deletePassword.trim()) {
      setDeleteError("Password is required.");
      return;
    }
    const normalizedReason = deleteReason.trim();
    if (normalizedReason.length < 3) {
      setDeleteError("Reason is required (minimum 3 characters).");
      return;
    }
    setDeleteError("");
    setDeleteLoading(true);
    try {
      await deleteAdminUser(deleteTarget.id, deletePassword, normalizedReason);
      setDeleteTarget(null);
      setDeletePassword("");
      setDeleteReason("");
      await loadData();
      await loadLogs();
    } catch (err) {
      const e = err as ApiError;
      setDeleteError(e.message || "Failed to delete user.");
    } finally {
      setDeleteLoading(false);
    }
  };

  const onResetPasswordConfirmed = async () => {
    if (!passwordTarget) return;
    if (!passwordAdminPassword.trim()) {
      setPasswordError("Admin password is required.");
      return;
    }
    if (passwordNew.length < 8) {
      setPasswordError("New password must be at least 8 characters.");
      return;
    }
    if (passwordNew !== passwordConfirm) {
      setPasswordError("New password and confirmation do not match.");
      return;
    }
    setPasswordError("");
    setPasswordLoading(true);
    try {
      await resetAdminUserPassword(passwordTarget.id, passwordAdminPassword, passwordNew);
      setPasswordTarget(null);
      setPasswordAdminPassword("");
      setPasswordNew("");
      setPasswordConfirm("");
      await loadLogs();
    } catch (err) {
      const e = err as ApiError;
      setPasswordError(e.message || "Failed to reset user password.");
    } finally {
      setPasswordLoading(false);
    }
  };

  const onOpenDeleteAction = (target: AdminUser) => {
    if (target.id === user?.id) return;
    setDeleteTarget(target);
    setDeletePassword("");
    setDeleteReason("");
    setDeleteError("");
  };

  const onOpenPasswordResetAction = (target: AdminUser) => {
    setPasswordTarget(target);
    setPasswordAdminPassword("");
    setPasswordNew("");
    setPasswordConfirm("");
    setPasswordError("");
  };

  if (authLoading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Spinner />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-panel/95 p-6 shadow-2xl">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="font-display text-2xl">Admin Center</h1>
            <button
              type="button"
              onClick={() => {
                window.location.href = "/";
              }}
              className="text-sm text-muted hover:text-text"
            >
              Back to site
            </button>
          </div>
          <form onSubmit={onLogin} className="space-y-3">
            <input
              type="email"
              placeholder="Admin email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full rounded-lg border border-border bg-panel-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full rounded-lg border border-border bg-panel-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
            />
            {loginError && <p className="text-sm text-red-300">{loginError}</p>}
            <button
              type="submit"
              disabled={loginLoading}
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
            >
              {loginLoading ? "Logging in..." : "Log in to Admin"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (!adminChecked) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Spinner />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-2xl border border-border bg-panel/95 p-6 text-center">
          <h1 className="font-display text-2xl">Admin Access Required</h1>
          <p className="mt-3 text-sm text-muted">
            {adminCheckError || "This account does not have admin permissions."}
          </p>
          <div className="mt-5 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                window.location.href = "/";
              }}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted hover:text-text"
            >
              Go to site
            </button>
            <button
              type="button"
              onClick={async () => {
                await logout();
                window.location.href = "/admin";
              }}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90"
            >
              Switch account
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/95 backdrop-blur-sm">
        <div className="page-container py-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl">Admin Center</h1>
            <p className="text-xs text-muted mt-0.5">{user.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                window.location.href = "/";
              }}
              className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-text"
            >
              Main site
            </button>
            <button
              type="button"
              onClick={async () => {
                await logout();
                window.location.href = "/admin";
              }}
              className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-text"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="page-container py-6 space-y-6">
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
          <StatCard label="Total Users" value={overview?.total_users ?? (loadingData ? "..." : 0)} />
          <StatCard label="Active Users" value={overview?.active_users ?? (loadingData ? "..." : 0)} />
          <StatCard label="Admins" value={overview?.admin_users ?? (loadingData ? "..." : 0)} />
          <StatCard label="New (7 days)" value={overview?.new_users_last_7_days ?? (loadingData ? "..." : 0)} />
          <StatCard label="Logins (24h)" value={overview?.logins_last_24h ?? (loadingData ? "..." : 0)} />
        </section>

        <section className="rounded-2xl border border-border bg-panel/80 p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <form onSubmit={onSearch} className="flex gap-2 w-full sm:max-w-xl">
              <input
                type="text"
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder="Search users by email..."
                className="min-w-0 flex-1 rounded-lg border border-border bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <button
                type="submit"
                className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-text"
              >
                Search
              </button>
            </form>
            <div className="flex items-center gap-2">
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="rounded-lg border border-border bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent"
              >
                {PAGE_SIZE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt} / page
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => loadData()}
                className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-text"
              >
                Refresh
              </button>
            </div>
          </div>

          {dataError && (
            <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {dataError}
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="min-w-[980px] w-full text-sm">
              <thead className="bg-panel-2/70">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium text-muted">Email</th>
                  <th className="px-3 py-2 font-medium text-muted">Joined</th>
                  <th className="px-3 py-2 font-medium text-muted">Last login</th>
                  <th className="px-3 py-2 font-medium text-muted">Countries</th>
                  <th className="px-3 py-2 font-medium text-muted">Services</th>
                  <th className="px-3 py-2 font-medium text-muted">Role</th>
                  <th className="px-3 py-2 font-medium text-muted">Status</th>
                  <th className="px-3 py-2 font-medium text-muted">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loadingData ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-10 text-center text-muted">
                      Loading users...
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-10 text-center text-muted">
                      No users found.
                    </td>
                  </tr>
                ) : (
                  users.map((row) => {
                    const adminKey = `${row.id}:is_admin`;
                    const activeKey = `${row.id}:is_active`;
                    const adminBusy = updatingKeys.has(adminKey);
                    const activeBusy = updatingKeys.has(activeKey);
                    const rowBusy = adminBusy || activeBusy;
                    const statusLabel = !row.is_active
                      ? "Disabled"
                      : row.email_verified
                        ? "Active"
                        : "Unverified";
                    const statusClassName = !row.is_active
                      ? "border-red-500/40 bg-red-500/15 text-red-200"
                      : row.email_verified
                        ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
                        : "border-amber-500/45 bg-amber-500/15 text-amber-200";
                    return (
                      <tr key={row.id} className="border-t border-border/70">
                        <td className="px-3 py-2">{row.email}</td>
                        <td className="px-3 py-2 text-muted">{formatDate(row.created_at)}</td>
                        <td className="px-3 py-2 text-muted">{formatDate(row.last_login_at)}</td>
                        <td className="px-3 py-2 text-muted">{row.countries.length ? row.countries.join(", ") : "-"}</td>
                        <td className="px-3 py-2 text-muted">{row.provider_count}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                              row.is_admin
                                ? "border-sky-500/40 bg-sky-500/15 text-sky-200"
                                : "border-border bg-panel-2 text-muted"
                            }`}
                          >
                            {row.is_admin ? "Admin" : "User"}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusClassName}`}
                          >
                            {statusLabel}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            defaultValue=""
                            onChange={(e) => {
                              const action = e.target.value;
                              e.currentTarget.value = "";
                              if (action === "promote_admin") {
                                void onRoleChange(row, "admin");
                                return;
                              }
                              if (action === "remove_admin") {
                                void onRoleChange(row, "user");
                                return;
                              }
                              if (action === "disable_user") {
                                void onStatusChange(row, "disabled");
                                return;
                              }
                              if (action === "reactivate_user") {
                                void onStatusChange(row, "active");
                                return;
                              }
                              if (action === "reset_password") {
                                onOpenPasswordResetAction(row);
                                return;
                              }
                              if (action === "delete_user") {
                                onOpenDeleteAction(row);
                              }
                            }}
                            disabled={rowBusy}
                            className="rounded-md px-2 py-1 text-xs border border-border bg-panel-2 text-text disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            <option value="">{rowBusy ? "Updating..." : "Choose"}</option>
                            {row.is_admin ? (
                              <option value="remove_admin" disabled={row.id === user.id}>
                                Remove admin access
                              </option>
                            ) : (
                              <option value="promote_admin">Promote to admin</option>
                            )}
                            {row.is_active ? (
                              <option value="disable_user" disabled={row.id === user.id}>
                                Disable user
                              </option>
                            ) : (
                              <option value="reactivate_user">Reactivate user</option>
                            )}
                            <option value="reset_password">Reset password</option>
                            <option value="delete_user" disabled={row.id === user.id}>
                              Delete user
                            </option>
                          </select>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm text-muted">
              Showing page {page} of {totalPages} ({total} users)
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-text disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((prev) => prev + 1)}
                disabled={!hasMore}
                className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-text disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-panel/80 p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <form onSubmit={onLogSearch} className="flex gap-2 w-full sm:max-w-xl">
              <input
                type="text"
                value={logQueryInput}
                onChange={(e) => setLogQueryInput(e.target.value)}
                placeholder="Search logs by user email..."
                className="min-w-0 flex-1 rounded-lg border border-border bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <button
                type="submit"
                className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-text"
              >
                Search Logs
              </button>
            </form>
            <div className="flex items-center gap-2">
              <select
                value={logPageSize}
                onChange={(e) => {
                  setLogPageSize(Number(e.target.value));
                  setLogPage(1);
                }}
                className="rounded-lg border border-border bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent"
              >
                {LOG_PAGE_SIZE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt} / page
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => loadLogs()}
                className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-text"
              >
                Refresh Logs
              </button>
            </div>
          </div>

          {logError && (
            <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {logError}
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="min-w-[980px] w-full text-sm">
              <thead className="bg-panel-2/70">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium text-muted">Time</th>
                  <th className="px-3 py-2 font-medium text-muted">Action</th>
                  <th className="px-3 py-2 font-medium text-muted">Actor</th>
                  <th className="px-3 py-2 font-medium text-muted">Target</th>
                  <th className="px-3 py-2 font-medium text-muted">Message</th>
                </tr>
              </thead>
              <tbody>
                {logLoading ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-10 text-center text-muted">
                      Loading logs...
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-10 text-center text-muted">
                      No logs found.
                    </td>
                  </tr>
                ) : (
                  logs.map((entry) => (
                    <tr key={entry.id} className="border-t border-border/70 align-top">
                      <td className="px-3 py-2 text-muted whitespace-nowrap">{formatDate(entry.created_at)}</td>
                      <td className="px-3 py-2 text-muted whitespace-nowrap">{entry.action}</td>
                      <td className="px-3 py-2 text-muted whitespace-nowrap">{entry.actor_email || "-"}</td>
                      <td className="px-3 py-2 text-muted whitespace-nowrap">{entry.target_email || "-"}</td>
                      <td className="px-3 py-2">
                        <div className="text-text">{entry.message}</div>
                        {entry.reason && (
                          <div className="mt-1 text-xs text-muted">Reason: {entry.reason}</div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm text-muted">
              Showing page {logPage} of {logTotalPages} ({logTotal} logs)
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setLogPage((prev) => Math.max(1, prev - 1))}
                disabled={logPage <= 1}
                className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-text disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setLogPage((prev) => prev + 1)}
                disabled={!logHasMore}
                className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-text disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        </section>
      </main>

      {passwordTarget && (
        <div className="fixed inset-0 z-[220] grid place-items-center p-4">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => {
              if (passwordLoading) return;
              setPasswordTarget(null);
              setPasswordAdminPassword("");
              setPasswordNew("");
              setPasswordConfirm("");
              setPasswordError("");
            }}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-panel p-5">
            <h3 className="font-display text-xl">Reset User Password</h3>
            <p className="mt-2 text-sm text-muted">
              Set a new password for <span className="text-text">{passwordTarget.email}</span>. Enter your password and the new password twice.
            </p>
            <input
              type="password"
              value={passwordAdminPassword}
              onChange={(e) => setPasswordAdminPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Your admin password"
              className="mt-4 w-full rounded-lg border border-border bg-panel-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
              disabled={passwordLoading}
            />
            <input
              type="password"
              value={passwordNew}
              onChange={(e) => setPasswordNew(e.target.value)}
              autoComplete="new-password"
              placeholder="New user password"
              className="mt-3 w-full rounded-lg border border-border bg-panel-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
              disabled={passwordLoading}
            />
            <input
              type="password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              autoComplete="new-password"
              placeholder="Confirm new user password"
              className="mt-3 w-full rounded-lg border border-border bg-panel-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
              disabled={passwordLoading}
            />
            {passwordError && <p className="mt-2 text-sm text-red-300">{passwordError}</p>}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (passwordLoading) return;
                  setPasswordTarget(null);
                  setPasswordAdminPassword("");
                  setPasswordNew("");
                  setPasswordConfirm("");
                  setPasswordError("");
                }}
                className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-text"
                disabled={passwordLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onResetPasswordConfirmed}
                disabled={passwordLoading}
                className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
              >
                {passwordLoading ? "Saving..." : "Reset password"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-[220] grid place-items-center p-4">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => {
              if (deleteLoading) return;
              setDeleteTarget(null);
              setDeletePassword("");
              setDeleteReason("");
              setDeleteError("");
            }}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-panel p-5">
            <h3 className="font-display text-xl">Delete User</h3>
            <p className="mt-2 text-sm text-muted">
              Deleting <span className="text-text">{deleteTarget.email}</span> is permanent. Enter your password and a reason.
            </p>
            <input
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Your password"
              className="mt-4 w-full rounded-lg border border-border bg-panel-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
              disabled={deleteLoading}
            />
            <textarea
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="Reason for deletion (sent to the user)"
              rows={3}
              className="mt-3 w-full resize-y rounded-lg border border-border bg-panel-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
              disabled={deleteLoading}
            />
            {deleteError && <p className="mt-2 text-sm text-red-300">{deleteError}</p>}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (deleteLoading) return;
                  setDeleteTarget(null);
                  setDeletePassword("");
                  setDeleteReason("");
                  setDeleteError("");
                }}
                className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-text"
                disabled={deleteLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onDeleteConfirmed}
                disabled={deleteLoading}
                className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-60"
              >
                {deleteLoading ? "Deleting..." : "Delete user"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminApp() {
  return (
    <AuthProvider>
      <AdminContent />
    </AuthProvider>
  );
}
