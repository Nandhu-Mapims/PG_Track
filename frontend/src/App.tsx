import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useNavigate, useSearchParams } from "react-router-dom";
import { Provider, useDispatch, useSelector } from "react-redux";
import { api } from "./api";
import { clearAuth, setAuth, store } from "./store";
import type { AppDispatch, RootState } from "./store";

type UserRoleName = "Admin" | "HOD" | "Consultant" | "PG" | "MRD";

type NavItem = { to: string; label: string; section: string; roles?: UserRoleName[] };

/** Shared inputs & selects — rounded-xl, teal focus ring */
const uiFieldCore =
  "rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20 disabled:cursor-not-allowed disabled:opacity-60";
const uiField = `w-full ${uiFieldCore}`;
const uiTextarea = (extra: string) => `${extra} w-full ${uiFieldCore}`;
const uiBtnOutline = "rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-teal-200 hover:bg-teal-50/60 focus:outline-none focus:ring-2 focus:ring-teal-500/20 disabled:opacity-50";
const uiBtnOutlineSm = "rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 transition hover:border-teal-200 hover:bg-teal-50/60 focus:outline-none focus:ring-2 focus:ring-teal-500/20 disabled:opacity-50";
const uiInfoBar = "mt-3 rounded-xl border border-slate-200/80 bg-slate-50/90 px-3 py-2 text-xs text-slate-600";
const uiFieldCompact =
  "max-w-[220px] rounded-xl border border-slate-200 bg-slate-50/80 px-2.5 py-1.5 text-xs text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20";
const uiFieldSearchWide =
  "w-80 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20";
const uiBtnReport = "rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:border-teal-300 hover:bg-teal-50/80 focus:outline-none focus:ring-2 focus:ring-teal-500/20";

/** Compare counts for the current local calendar day vs the previous day (from API). */
function dashboardDayOverDayLabel(today: number, yesterday: number): string {
  const t = Number(today);
  const y = Number(yesterday);
  if (Number.isNaN(t) || Number.isNaN(y)) return "—";
  if (t === 0 && y === 0) return "Same as yesterday";
  if (y === 0) return t === 0 ? "—" : `+${t} today · 0 yesterday`;
  const pct = Math.round(((t - y) / y) * 1000) / 10;
  if (pct === 0) return "Same as yesterday";
  return `${pct > 0 ? "+" : ""}${pct}% vs yesterday`;
}

function HelpPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4 pt-[12vh] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="max-h-[min(80vh,640px)] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200/80 bg-white/95 p-6 shadow-[0_24px_64px_-12px_rgba(15,23,42,0.18)] backdrop-blur-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="help-title" className="text-lg font-semibold tracking-tight text-slate-900">
            PG Clinical ERP — Quick help
          </h2>
          <button
            type="button"
            className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium text-teal-800 transition hover:bg-teal-50"
            onClick={onClose}
            aria-label="Close help"
          >
            Close
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          ESC or outside click also closes this panel.
        </p>
        <ul className="mt-5 list-inside list-disc space-y-2.5 border-t border-slate-100 pt-5 text-sm leading-relaxed text-slate-700">
          <li>
            <strong>Admit patients</strong> via{" "}
            <span className="font-medium">Clinical Flow → Admission Desk</span> — required before assignments and timeline data.
          </li>
          <li>
            <strong>Resident allocation</strong> (Clinical Flow) is limited to <strong>Head of Department</strong> and{" "}
            <strong>Administrator</strong> — they assign patients to available PGs when coverage changes. Activities require an active assignment.
          </li>
          <li>
            <strong>Activity Console</strong> logs clinical actions — set date/time, patient, PG, and activity type before submit.
          </li>
          <li>
            <strong>Patient Timeline</strong> — choose the patient from the dropdown (or paste ObjectId under Advanced). Use the header search to jump to a timeline from any page.
          </li>
          <li>
            <strong>Reports</strong> live under Analytics → Report Center.
          </li>
          <li>
            <strong>Audit logs</strong> (Admin / MRD) — Administration → Audit Log Center.
          </li>
          <li>
            Seeded demo logins include <span className="font-mono text-xs">admin / admin123</span>,{" "}
            <span className="font-mono text-xs">hod1 / hod12345</span> (HOD — resident allocation),{" "}
            <span className="font-mono text-xs">mrd1 / mrd12345</span> (audit logs) — change in production.
          </li>
        </ul>
      </div>
    </div>
  );
}

const navItems: NavItem[] = [
  { to: "/dashboard/pg", label: "Executive Dashboard", section: "Operations" },
  { to: "/masters", label: "Master Data Registry", section: "Administration", roles: ["Admin", "HOD"] },
  { to: "/audit-logs", label: "Audit Log Center", section: "Administration", roles: ["Admin", "MRD"] },
  { to: "/admission", label: "Admission Desk", section: "Clinical Flow" },
  { to: "/assignment", label: "Resident Allocation", section: "Clinical Flow", roles: ["Admin", "HOD"] },
  { to: "/activity", label: "Activity Console", section: "Clinical Flow" },
  { to: "/timeline", label: "Patient Timeline", section: "Clinical Flow" },
  { to: "/reports", label: "Report Center", section: "Analytics" },
  { to: "/mobile", label: "Mobility Extensions", section: "Extensions" },
];

function RequireRole({ roles, children }: { roles: UserRoleName[]; children: React.ReactElement }) {
  const user = useSelector((s: RootState) => s.auth.user);
  const role = user?.role as UserRoleName | undefined;
  if (!role || !roles.includes(role)) return <Navigate to="/dashboard/pg" replace />;
  return children;
}

function HeaderQuickSearch() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [patients, setPatients] = useState<any[]>([]);
  const [pgs, setPgs] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const el = wrapRef.current;
      if (el && !el.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const ensureLoaded = () => {
    if (loaded) return;
    void Promise.all([api.get("/patients?limit=200&page=1"), api.get("/pg")])
      .then(([p, g]) => {
        setPatients(p.data?.data || []);
        setPgs(g.data || []);
        setLoaded(true);
      })
      .catch(() => undefined);
  };

  const needle = q.trim().toLowerCase();
  const patientHits =
    needle.length === 0
      ? []
      : patients
          .filter(
            (p) =>
              String(p.patientName || "").toLowerCase().includes(needle) ||
              String(p.ipNumber || "").toLowerCase().includes(needle),
          )
          .slice(0, 8);
  const pgHits =
    needle.length === 0
      ? []
      : pgs
          .filter(
            (u) =>
              String(u.fullName || "").toLowerCase().includes(needle) || String(u.username || "").toLowerCase().includes(needle),
          )
          .slice(0, 6);

  return (
    <div ref={wrapRef} className="relative hidden md:block">
      <input
        placeholder="Search patients & PGs…"
        className="w-80 rounded-full border border-slate-200/90 bg-white/90 px-4 py-2.5 text-sm shadow-inner shadow-slate-900/5 outline-none ring-teal-500/0 transition placeholder:text-slate-400 focus:border-teal-500/50 focus:bg-white focus:ring-4 focus:ring-teal-500/15"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          ensureLoaded();
        }}
        onFocus={() => {
          ensureLoaded();
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && patientHits[0]) {
            navigate(`/timeline?patient=${patientHits[0]._id}`);
            setOpen(false);
            setQ("");
          }
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
      />
      {open && (patientHits.length > 0 || pgHits.length > 0) ? (
        <div
          className="absolute left-0 right-0 top-full z-40 mt-2 max-h-80 overflow-auto rounded-2xl border border-slate-200/80 bg-white/95 py-2 text-sm shadow-[0_16px_48px_-8px_rgba(15,23,42,0.15)] backdrop-blur-xl"
          role="listbox"
        >
          {patientHits.length > 0 ? (
            <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Patients</p>
          ) : null}
          {patientHits.map((p) => (
            <button
              key={p._id}
              type="button"
              role="option"
              className="block w-full px-3 py-2.5 text-left transition hover:bg-teal-50/80"
              onClick={() => {
                navigate(`/timeline?patient=${p._id}`);
                setOpen(false);
                setQ("");
              }}
            >
              <span className="font-medium text-slate-800">{p.patientName}</span>
              <span className="text-slate-500"> · {p.ipNumber}</span>
            </button>
          ))}
          {pgHits.length > 0 ? (
            <p className="mt-2 border-t border-slate-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Postgraduates
            </p>
          ) : null}
          {pgHits.map((u) => (
            <button
              key={u._id}
              type="button"
              className="block w-full px-3 py-2.5 text-left transition hover:bg-teal-50/80"
              onClick={() => {
                navigate(`/activity?pg=${u._id}`);
                setOpen(false);
                setQ("");
              }}
            >
              <span className="font-medium text-slate-800">{u.fullName}</span>
              <span className="text-slate-500"> · @{u.username}</span>
            </button>
          ))}
        </div>
      ) : null}
      {open && loaded && needle.length > 0 && patientHits.length === 0 && pgHits.length === 0 ? (
        <div className="absolute left-0 right-0 top-full z-40 mt-2 rounded-2xl border border-slate-200/80 bg-white/95 px-4 py-4 text-xs text-slate-500 shadow-[0_16px_48px_-8px_rgba(15,23,42,0.12)] backdrop-blur-xl">
          No matches. Try another name or IP number.
        </div>
      ) : null}
    </div>
  );
}

function KPI({ title, value, delta }: { title: string; value: string | number; delta?: string }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 p-5 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.08)] backdrop-blur-sm transition hover:border-teal-200/80 hover:shadow-[0_8px_32px_-8px_rgba(15,118,110,0.12)]">
      <div className="absolute left-0 top-0 h-full w-1 rounded-l-2xl bg-gradient-to-b from-teal-500 to-cyan-600 opacity-90" aria-hidden />
      <div className="pl-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</div>
        <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</div>
        {delta ? <div className="mt-1.5 text-xs font-medium text-teal-700">{delta}</div> : null}
      </div>
    </div>
  );
}

function LoginPage() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const { data } = await api.post("/auth/login", { username, password });
      localStorage.setItem("token", data.token);
      let profile = data.user;
      try {
        const profileRes = await api.get("/auth/profile");
        profile = profileRes.data;
      } catch {
        // If profile fetch fails, fallback to login payload.
      }
      dispatch(setAuth({ token: data.token, user: profile }));
      navigate("/dashboard/pg");
    } catch {
      setError("Login failed. Check credentials.");
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 20%, rgb(45 212 191 / 0.35), transparent 42%), radial-gradient(circle at 80% 80%, rgb(6 182 212 / 0.25), transparent 40%)",
        }}
      />
      <div className="relative z-10 grid w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-200/60 bg-white/90 shadow-[0_32px_64px_-16px_rgba(15,23,42,0.2)] backdrop-blur-xl md:grid-cols-2">
        <div className="relative hidden overflow-hidden bg-gradient-to-br from-teal-950 via-teal-900 to-slate-950 p-10 text-slate-100 md:block">
          <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-teal-500/20 blur-3xl" />
          <div className="absolute -bottom-20 left-10 h-56 w-56 rounded-full bg-cyan-500/15 blur-3xl" />
          <div className="relative">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-teal-300/90">Clinical operations suite</p>
            <h1 className="mt-5 text-3xl font-semibold leading-tight tracking-tight">PG Clinical Activity ERP</h1>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-teal-100/85">
              Admissions, resident allocation, activity logging, timelines, and audit-ready exports in one workspace.
            </p>
          </div>
        </div>
        <div className="relative p-8 md:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Secure access</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Use your hospital credentials for your role-based workspace.</p>
          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <input
              className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-500/20"
              name="pg-erp-username"
              id="pg-erp-username"
              type="text"
              inputMode="text"
              autoComplete="username"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              readOnly
              onFocus={(e) => e.currentTarget.removeAttribute("readonly")}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
            />
            <input
              className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-500/20"
              name="pg-erp-password"
              id="pg-erp-password"
              type="password"
              autoComplete="current-password"
              readOnly
              onFocus={(e) => e.currentTarget.removeAttribute("readonly")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
            />
            <button
              className="w-full rounded-xl bg-gradient-to-r from-teal-700 to-teal-600 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-teal-900/25 transition hover:from-teal-800 hover:to-teal-700"
              type="submit"
            >
              Sign in to workspace
            </button>
            {error && <p className="text-center text-xs font-medium text-red-600">{error}</p>}
          </form>
        </div>
      </div>
    </div>
  );
}

function AppLayout({ children, title, subtitle }: { children: ReactNode; title: string; subtitle: string }) {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const user = useSelector((s: RootState) => s.auth.user);
  const [helpOpen, setHelpOpen] = useState(false);
  const navBySection = useMemo(() => {
    const role = user?.role as UserRoleName | undefined;
    const visible = navItems.filter((item) => !item.roles || (role && item.roles.includes(role)));
    const grouped = new Map<string, NavItem[]>();
    visible.forEach((item) => {
      if (!grouped.has(item.section)) grouped.set(item.section, []);
      grouped.get(item.section)?.push(item);
    });
    return Array.from(grouped.entries());
  }, [user?.role]);

  return (
    <div className="flex min-h-screen flex-col text-slate-800">
      <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />
      <header className="sticky top-0 z-30 shrink-0 border-b border-white/30 bg-white/75 shadow-sm shadow-slate-900/5 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-4 px-4 py-3.5 md:gap-6 md:px-8">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div
              className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-600 to-cyan-700 text-xs font-bold tracking-tight text-white shadow-md shadow-teal-900/30 sm:flex"
              aria-hidden
            >
              PG
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-tight text-slate-900 md:text-lg">Clinical Activity ERP</h1>
              <p className="truncate text-[11px] text-slate-500 md:text-xs">
                Operations · residency · audit trail
              </p>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center justify-end gap-2 md:w-auto md:flex-nowrap">
            <HeaderQuickSearch />
            <button
              type="button"
              className="rounded-full border border-slate-200 bg-white/80 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-teal-200 hover:bg-teal-50/60 hover:text-teal-900"
              onClick={() => setHelpOpen(true)}
            >
              Help
            </button>
            <div className="hidden items-center gap-2 rounded-full border border-slate-200/90 bg-slate-50/90 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-inner sm:flex">
              <span className="max-w-[140px] truncate">{user?.fullName || user?.username || "User"}</span>
              <span className="rounded-md bg-teal-100/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-900">
                {user?.role || "—"}
              </span>
            </div>
            <button
              type="button"
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-800"
              onClick={() => {
                dispatch(clearAuth());
                navigate("/login");
              }}
            >
              Log out
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-6 p-4 pb-12 md:flex-row md:items-stretch md:gap-8 md:p-8">
        <nav className="flex w-full shrink-0 flex-col rounded-2xl border border-teal-950/20 bg-gradient-to-b from-teal-950 via-teal-900 to-slate-950 p-4 shadow-xl shadow-teal-950/25 md:sticky md:top-24 md:h-[calc(100dvh-6rem)] md:w-[280px] md:max-w-[280px] md:self-start md:overflow-hidden">
          <div className="min-h-0 flex-1 space-y-0 overflow-y-auto md:overflow-y-auto">
            {navBySection.map(([section, items]) => (
              <div key={section} className="mb-5 last:mb-0">
                <p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-teal-300/80">{section}</p>
                <ul className="space-y-0.5">
                  {items.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        className={({ isActive }) =>
                          `block rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                            isActive
                              ? "bg-white/12 text-white shadow-inner ring-1 ring-white/15"
                              : "text-teal-100/85 hover:bg-white/5 hover:text-white"
                          }`
                        }
                      >
                        {item.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-4 shrink-0 border-t border-white/10 pt-4">
            <p className="px-2 text-[11px] font-bold uppercase leading-snug tracking-[0.12em] text-teal-200">
              Melmaruvathur Adhiparasakthi Hospital
            </p>
          </div>
        </nav>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col space-y-5">
          <section className="rounded-2xl border border-slate-200/70 bg-white/90 p-5 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.08)] backdrop-blur-sm md:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-900 md:text-2xl">{title}</h2>
                <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-600">{subtitle}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-full border border-slate-200 bg-slate-50/80 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                  onClick={() => window.print()}
                >
                  Print view
                </button>
                <button
                  type="button"
                  className="rounded-full bg-gradient-to-r from-teal-700 to-teal-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-teal-900/20 transition hover:from-teal-800 hover:to-teal-700"
                  onClick={() => navigate("/admission")}
                >
                  New admission
                </button>
              </div>
            </div>
          </section>
          {children}
        </main>
      </div>
    </div>
  );
}

function MastersPage() {
  const [departments, setDepartments] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [activityTypes, setActivityTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    void Promise.all([api.get("/departments"), api.get("/units"), api.get("/activity-types")])
      .then(([d, u, a]) => {
        setDepartments(d.data || []);
        setUnits(u.data || []);
        setActivityTypes(a.data || []);
      })
      .catch(() => setLoadError("Could not load master data. Check your session and try again."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppLayout title="Master Data Control" subtitle="Live registry from the API (read-only in this view).">
      {loading ? <div className="text-sm text-slate-500">Loading master data…</div> : null}
      {loadError ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{loadError}</div> : null}
      <div className="grid gap-4 md:grid-cols-3">
        <KPI title="Departments" value={departments.length} />
        <KPI title="Units" value={units.length} />
        <KPI title="Activity Types" value={activityTypes.length} />
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/95 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">Department Registry</div>
        <table className="w-full text-sm">
          <thead className="bg-gradient-to-r from-slate-100 to-teal-50/35 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-2">Department</th>
              <th className="px-4 py-2">Code</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {departments.map((d: any) => (
              <tr key={String(d._id || d.code)} className="border-t border-slate-100">
                <td className="px-4 py-2">{d.name}</td>
                <td className="px-4 py-2">{d.code}</td>
                <td className="px-4 py-2">
                  <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">{d.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/95 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">Unit Mapping</div>
        <table className="w-full text-sm">
          <thead className="bg-gradient-to-r from-slate-100 to-teal-50/35 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-2">Unit</th>
              <th className="px-4 py-2">Department</th>
              <th className="px-4 py-2">Consultant</th>
            </tr>
          </thead>
          <tbody>
            {units.map((u: any) => (
              <tr key={`${String(u._id)}`} className="border-t border-slate-100">
                <td className="px-4 py-2">{u.name}</td>
                <td className="px-4 py-2">{u.departmentId?.name || u.departmentId || "—"}</td>
                <td className="px-4 py-2">{u.consultantId?.fullName || u.consultantId || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/95 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">Activity types</div>
        <table className="w-full text-sm">
          <thead className="bg-gradient-to-r from-slate-100 to-teal-50/35 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {activityTypes.map((t: any) => (
              <tr key={String(t._id)} className="border-t border-slate-100">
                <td className="px-4 py-2">{t.name}</td>
                <td className="px-4 py-2">
                  <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">{t.status || "Active"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppLayout>
  );
}

function AdmissionPage() {
  const [form, setForm] = useState({
    ipNumber: "",
    patientName: "",
    age: "40",
    gender: "Male",
    wardBedNumber: "W-12",
    departmentId: "",
    unitId: "",
  });
  const [departments, setDepartments] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void Promise.all([api.get("/departments"), api.get("/units")])
      .then(([d, u]) => {
        setDepartments(d.data || []);
        setUnits(u.data || []);
      })
      .catch(() => undefined);
  }, []);

  const submit = async () => {
    try {
      if (!form.departmentId) {
        setMessage("Please select department.");
        return;
      }
      await api.post("/admission", {
        patient: {
          ipNumber: form.ipNumber || `IP${Date.now()}`,
          patientName: form.patientName || "Test Patient",
          age: Number(form.age || 40),
          gender: form.gender,
        },
        admission: {
          admissionDate: new Date(),
          wardBedNumber: form.wardBedNumber || "W-12",
          departmentId: form.departmentId,
          unitId: form.unitId || undefined,
        },
      });
      setMessage("Admission created successfully.");
      setForm((prev) => ({ ...prev, ipNumber: "", patientName: "" }));
    } catch (error: any) {
      const apiMessage = error?.response?.data?.message;
      setMessage(apiMessage ? `Admission failed: ${apiMessage}` : "Admission failed. Please retry.");
    }
  };
  return (
    <AppLayout title="Patient Admission" subtitle="Register admissions. Head of Department assigns postgraduate residents under Resident Allocation.">
      <div className="rounded-2xl border border-slate-200/70 bg-white/95 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm p-5">
        <div className="grid gap-3 md:grid-cols-3">
          <input
            className={uiField}
            placeholder="IP Number (optional)"
            value={form.ipNumber}
            onChange={(e) => setForm((prev) => ({ ...prev, ipNumber: e.target.value }))}
          />
          <input
            className={uiField}
            placeholder="Patient Name"
            value={form.patientName}
            onChange={(e) => setForm((prev) => ({ ...prev, patientName: e.target.value }))}
          />
          <input
            className={uiField}
            placeholder="Age"
            value={form.age}
            onChange={(e) => setForm((prev) => ({ ...prev, age: e.target.value }))}
          />
          <select
            className={uiField}
            value={form.gender}
            onChange={(e) => setForm((prev) => ({ ...prev, gender: e.target.value }))}
          >
            <option>Male</option>
            <option>Female</option>
            <option>Other</option>
          </select>
          <input
            className={uiField}
            placeholder="Ward / Bed"
            value={form.wardBedNumber}
            onChange={(e) => setForm((prev) => ({ ...prev, wardBedNumber: e.target.value }))}
          />
          <select
            className={uiField}
            value={form.departmentId}
            onChange={(e) => setForm((prev) => ({ ...prev, departmentId: e.target.value }))}
          >
            <option value="">Select Department *</option>
            {departments.map((d) => (
              <option key={d._id} value={d._id}>{d.name}</option>
            ))}
          </select>
          <select
            className={uiField}
            value={form.unitId}
            onChange={(e) => setForm((prev) => ({ ...prev, unitId: e.target.value }))}
          >
            <option value="">Select Unit (optional)</option>
            {units
              .filter((u) => !form.departmentId || String(u.departmentId?._id || u.departmentId) === form.departmentId)
              .map((u) => (
                <option key={u._id} value={u._id}>{u.name}</option>
              ))}
          </select>
        </div>
        <button className="mt-4 rounded-lg bg-teal-700 px-4 py-2 text-sm text-white hover:bg-teal-800" onClick={() => void submit()}>
          Create Admission
        </button>
        {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
      </div>
    </AppLayout>
  );
}

function AssignmentPage() {
  const [board, setBoard] = useState<any[]>([]);
  const [pgs, setPgs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [historyPatientId, setHistoryPatientId] = useState("");
  const [historyRows, setHistoryRows] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [form, setForm] = useState({
    patientId: "",
    pgId: "",
    shift: "General" as "Morning" | "Evening" | "Night" | "General",
    isPrimary: true,
    remarks: "",
    icuTag: false,
  });

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [b, g] = await Promise.all([api.get("/assignments/live-board"), api.get("/pg")]);
      setBoard(b.data || []);
      setPgs(g.data || []);
    } catch {
      setMessage("Could not load allocation data. Refresh or sign in again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const loadHistory = useCallback(async (patientId: string) => {
    if (!patientId) {
      setHistoryRows([]);
      setHistoryError("");
      return;
    }
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const { data } = await api.get(`/assignments/history/${patientId}`);
      setHistoryRows(Array.isArray(data) ? data : []);
    } catch {
      setHistoryError("Could not load assignment history.");
      setHistoryRows([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory(historyPatientId);
  }, [historyPatientId, loadHistory]);

  const assign = async () => {
    if (!form.patientId || !form.pgId) {
      setMessage("Choose both a patient and a PG.");
      return;
    }
    setMessage("");
    try {
      await api.post("/assignments", {
        patientId: form.patientId,
        pgId: form.pgId,
        shift: form.shift,
        isPrimary: form.isPrimary,
        remarks: form.remarks || undefined,
        icuTag: form.icuTag,
      });
      setMessage("PG assigned. Dashboard will refresh on next load.");
      await load();
      if (historyPatientId) await loadHistory(historyPatientId);
      setForm((prev) => ({ ...prev, patientId: "", remarks: "", icuTag: false }));
    } catch (err: any) {
      const apiMessage = typeof err?.response?.data?.message === "string" ? err.response.data.message : "";
      setMessage(apiMessage || "Assignment failed. Ensure the patient has an active admission.");
    }
  };

  const unassigned = board.filter((row) => row.status === "Unassigned");

  const releaseAssignment = async (assignmentId: string) => {
    setMessage("");
    try {
      await api.patch(`/assignments/${assignmentId}/release`, {});
      setMessage("Assignment released.");
      await load();
      await loadHistory(historyPatientId);
    } catch (err: any) {
      const apiMessage = typeof err?.response?.data?.message === "string" ? err.response.data.message : "";
      setMessage(apiMessage || "Release failed.");
    }
  };

  return (
    <AppLayout
      title="Resident Allocation"
      subtitle="Assign admitted patients to available PGs. Adjust allocations when PGs are absent or workload shifts — operations visible on the live board."
    >
      <div className="rounded-2xl border border-slate-200/70 bg-white/95 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm p-5">
        <h3 className="text-sm font-semibold text-slate-900">Assign a PG</h3>
        <p className="mt-1 text-xs text-slate-500">
          Go to Clinical Flow → <span className="font-medium text-slate-700">Resident Allocation</span> (this page). The patient must already be admitted; unassigned rows match the dashboard alert.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <select
            className={uiField}
            value={form.patientId}
            onChange={(e) => setForm((prev) => ({ ...prev, patientId: e.target.value }))}
          >
            <option value="">Patient (unassigned on board)</option>
            {unassigned.map((row) => (
              <option key={row.patientId} value={row.patientId}>
                {row.patientName ?? "Patient"} ({row.ipNumber ?? row.patientId})
              </option>
            ))}
          </select>
          <select
            className={uiField}
            value={form.pgId}
            onChange={(e) => setForm((prev) => ({ ...prev, pgId: e.target.value }))}
          >
            <option value="">Select PG</option>
            {pgs.map((pg) => (
              <option key={pg._id} value={pg._id}>{pg.fullName}</option>
            ))}
          </select>
          <select
            className={uiField}
            value={form.shift}
            onChange={(e) => setForm((prev) => ({ ...prev, shift: e.target.value as typeof prev.shift }))}
          >
            <option value="General">Shift: General</option>
            <option value="Morning">Morning</option>
            <option value="Evening">Evening</option>
            <option value="Night">Night</option>
          </select>
        </div>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={form.isPrimary} onChange={(e) => setForm((prev) => ({ ...prev, isPrimary: e.target.checked }))} />
          Primary PG (clears previous primary on this patient)
        </label>
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={form.icuTag} onChange={(e) => setForm((prev) => ({ ...prev, icuTag: e.target.checked }))} />
          ICU cover tag
        </label>
        <textarea
          className={uiTextarea("mt-3 h-20")}
          placeholder="Optional remarks"
          value={form.remarks}
          onChange={(e) => setForm((prev) => ({ ...prev, remarks: e.target.value }))}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="rounded-lg bg-teal-700 px-4 py-2 text-sm text-white hover:bg-teal-800" onClick={() => void assign()}>
            Save assignment
          </button>
          <button type="button" className={uiBtnOutline} onClick={() => void load()} disabled={loading}>
            Refresh board
          </button>
        </div>
        {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
      </div>

      <div className="rounded-2xl border border-slate-200/70 bg-white/95 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm p-5">
        <h3 className="text-sm font-semibold text-slate-900">Assignment history & release</h3>
        <p className="mt-1 text-xs text-slate-500">
          Pick any admitted patient from the live board (below). Active rows can be released without deleting history.
        </p>
        <select
          className={uiTextarea("mt-3 max-w-md md:max-w-xl")}
          value={historyPatientId}
          onChange={(e) => setHistoryPatientId(e.target.value)}
        >
          <option value="">Select patient for history</option>
          {board.map((row) => (
            <option key={row.patientId} value={row.patientId}>
              {row.patientName ?? "Patient"} ({row.ipNumber ?? row.patientId})
            </option>
          ))}
        </select>
        {historyLoading ? <p className="mt-2 text-xs text-slate-500">Loading history…</p> : null}
        {historyError ? <p className="mt-2 text-sm text-red-600">{historyError}</p> : null}
        {historyPatientId && !historyLoading && historyRows.length === 0 && !historyError ? (
          <p className="mt-2 text-sm text-slate-500">No assignment records for this patient yet.</p>
        ) : null}
        {historyRows.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-gradient-to-r from-slate-100 to-teal-50/35 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-2">PG</th>
                  <th className="px-3 py-2">Shift</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Primary</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Assigned</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map((h: any) => (
                  <tr key={h._id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{h.pgId?.fullName || String(h.pgId || "—")}</td>
                    <td className="px-3 py-2">{h.shift ?? "—"}</td>
                    <td className="px-3 py-2">{h.assignmentType ?? "—"}</td>
                    <td className="px-3 py-2">{h.isPrimary ? "Yes" : "No"}</td>
                    <td className="px-3 py-2">
                      {h.isActive ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">Active</span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Released</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {h.assignedAt ? new Date(h.assignedAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {h.isActive ? (
                        <button
                          type="button"
                          className="rounded border border-amber-300 px-2 py-1 text-xs text-amber-900 hover:bg-amber-50"
                          onClick={() => void releaseAssignment(String(h._id))}
                        >
                          Release
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/95 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">
          Live board snapshot {loading ? "(loading…)" : null}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gradient-to-r from-slate-100 to-teal-50/35 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-2">Patient</th>
              <th className="px-4 py-2">IP Number</th>
              <th className="px-4 py-2">Assigned PGs</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {board.map((row) => (
              <tr key={row.patientId} className="border-t border-slate-100">
                <td className="px-4 py-2">{row.patientName ?? "-"}</td>
                <td className="px-4 py-2">{row.ipNumber ?? "-"}</td>
                <td className="px-4 py-2">
                  {(row.assignedPgs || []).map((p: any) => `${p.name}${p.isPrimary ? " (P)" : ""}`).join(", ") || "-"}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-1 text-xs ${
                      row.status === "Unassigned" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {row.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && board.length === 0 ? <p className="p-4 text-sm text-slate-500">No admitted patients on the board.</p> : null}
      </div>
    </AppLayout>
  );
}

function ResidentAllocationPage() {
  const user = useSelector((s: RootState) => s.auth.user);
  const role = user?.role as UserRoleName | undefined;
  if (role === "Admin" || role === "HOD") return <AssignmentPage />;
  return (
    <AppLayout
      title="Resident Allocation"
      subtitle="PG assignments are coordinated by the Head of Department when PG availability changes."
    >
      <div className="rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm">
        <p className="text-sm leading-relaxed text-slate-700">
          Only users with the <strong className="text-slate-900">Head of Department</strong> or{" "}
          <strong className="text-slate-900">Administrator</strong> role can assign patients to postgraduate residents,
          release allocations, or set primary PGs. Your Head of Department allocates patients to available PGs when others are absent.
        </p>
      </div>
    </AppLayout>
  );
}

function ActivityPage() {
  const [searchParams] = useSearchParams();
  const toDateTimeLocalValue = (date: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const [patients, setPatients] = useState<any[]>([]);
  const [pgs, setPgs] = useState<any[]>([]);
  const [activityTypes, setActivityTypes] = useState<any[]>([]);
  const [form, setForm] = useState({
    patientId: "",
    pgId: "",
    activityTypeId: "",
    activityDateTime: toDateTimeLocalValue(new Date()),
    remarks: "",
  });
  const [message, setMessage] = useState("");

  useEffect(() => {
    void Promise.all([api.get("/patients"), api.get("/pg"), api.get("/activity-types")])
      .then(([p, g, t]) => {
        setPatients(p.data.data || []);
        setPgs(g.data || []);
        setActivityTypes(t.data || []);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const pgId = searchParams.get("pg")?.trim();
    if (pgId) setForm((prev) => ({ ...prev, pgId }));
  }, [searchParams]);

  const submitActivity = async () => {
    try {
      await api.post("/activity", {
        patientId: form.patientId,
        pgId: form.pgId,
        activityTypeId: form.activityTypeId,
        activityDateTime: form.activityDateTime,
        remarks: form.remarks || "No remarks",
      });
      setMessage("Activity submitted successfully.");
      setForm((prev) => ({ ...prev, remarks: "", activityDateTime: toDateTimeLocalValue(new Date()) }));
    } catch {
      setMessage("Activity submission failed. Ensure patient and PG have active assignment.");
    }
  };

  return (
    <AppLayout title="Activity Entry" subtitle="Record time-stamped clinical actions and update patient timelines.">
      <div className="rounded-2xl border border-slate-200/70 bg-white/95 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm p-5">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <select
            className={uiField}
            value={form.patientId}
            onChange={(e) => setForm((prev) => ({ ...prev, patientId: e.target.value }))}
          >
            <option value="">Select Patient</option>
            {patients.map((p) => (
              <option key={p._id} value={p._id}>{p.patientName} ({p.ipNumber})</option>
            ))}
          </select>
          <select
            className={uiField}
            value={form.pgId}
            onChange={(e) => setForm((prev) => ({ ...prev, pgId: e.target.value }))}
          >
            <option value="">Select PG</option>
            {pgs.map((pg) => (
              <option key={pg._id} value={pg._id}>{pg.fullName}</option>
            ))}
          </select>
          <select
            className={uiField}
            value={form.activityTypeId}
            onChange={(e) => setForm((prev) => ({ ...prev, activityTypeId: e.target.value }))}
          >
            <option value="">Select Activity Type</option>
            {activityTypes.map((t) => (
              <option key={t._id} value={t._id}>{t.name}</option>
            ))}
          </select>
          <input
            type="datetime-local"
            className={uiField}
            value={form.activityDateTime}
            onChange={(e) => setForm((prev) => ({ ...prev, activityDateTime: e.target.value }))}
          />
        </div>
        <textarea
          className={uiTextarea("mt-3 h-24")}
          placeholder="Clinical remarks"
          value={form.remarks}
          onChange={(e) => setForm((prev) => ({ ...prev, remarks: e.target.value }))}
        />
        <button className="mt-3 rounded-lg bg-teal-700 px-4 py-2 text-sm text-white hover:bg-teal-800" onClick={() => void submitActivity()}>
          Submit Activity
        </button>
        {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
      </div>
    </AppLayout>
  );
}

function PGDashboardPage() {
  const navigate = useNavigate();
  const user = useSelector((s: RootState) => s.auth.user);
  const [stats, setStats] = useState<Record<string, any>>({});
  const [allocationBoard, setAllocationBoard] = useState<any[]>([]);
  const [workload, setWorkload] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const role = user?.role || "Admin";
    const dashboardEndpoint = role === "Admin" ? "/dashboard/admin" : role === "HOD" ? "/dashboard/hod" : `/dashboard/pg/${user?._id}`;
    void Promise.all([
      api.get(dashboardEndpoint),
      api.get("/assignments/live-board"),
      api.get("/monitoring/workload-matrix"),
      api.get("/monitoring/alerts"),
    ])
      .then(([admin, board, matrix, alertRows]) => {
        if (role === "Admin") setStats(admin.data);
        else if (role === "HOD")
          setStats({
            users: "-",
            patients: "-",
            activities: "-",
            audits: "-",
            activitiesToday: admin.data.activitiesToday,
            activitiesYesterday: admin.data.activitiesYesterday,
            hod: admin.data,
          });
        else
          setStats({
            users: "-",
            patients: "-",
            activities: "-",
            audits: "-",
            myPatients: admin.data.myPatients,
            myActivities: admin.data.myActivities,
            procedureCount: admin.data.procedureCount,
            pendingTasks: admin.data.pendingTasks,
            activitiesToday: admin.data.activitiesToday,
            activitiesYesterday: admin.data.activitiesYesterday,
            assignmentsToday: admin.data.assignmentsToday,
            assignmentsYesterday: admin.data.assignmentsYesterday,
          });
        setAllocationBoard(board.data);
        setWorkload(matrix.data);
        setAlerts(alertRows.data);
      })
      .catch(() => setError("Dashboard data failed to load. Please login again."))
      .finally(() => setLoading(false));
  }, [user?._id, user?.role]);

  const filteredBoard = allocationBoard.filter((row) => {
    const q = search.toLowerCase();
    return (
      String(row.patientName || "").toLowerCase().includes(q) ||
      String(row.ipNumber || "").toLowerCase().includes(q) ||
      String(row.status || "").toLowerCase().includes(q)
    );
  });

  const role = user?.role || "Admin";
  const hodPgActivityTotal = Array.isArray(stats.hod?.pgStats)
    ? stats.hod.pgStats.reduce((sum: number, row: { activityCount?: number }) => sum + (Number(row.activityCount) || 0), 0)
    : null;

  return (
    <AppLayout title="Operations Dashboard" subtitle="Live snapshot of activity, patient load, and governance logs.">
      <div className="grid gap-4 md:grid-cols-4">
        {role === "Admin" ? (
          <>
            <KPI
              title="Active PGs Today"
              value={
                typeof stats.totalPgUsers === "number"
                  ? `${Number(stats.pgsActiveToday ?? 0)}/${stats.totalPgUsers}`
                  : "—"
              }
              delta={dashboardDayOverDayLabel(Number(stats.pgsActiveToday ?? 0), Number(stats.pgsActiveYesterday ?? 0))}
            />
            <KPI
              title="Registered patients"
              value={stats.patients ?? "—"}
              delta={dashboardDayOverDayLabel(Number(stats.patientsToday ?? 0), Number(stats.patientsYesterday ?? 0))}
            />
            <KPI
              title="Activities logged today"
              value={stats.activitiesToday ?? "—"}
              delta={dashboardDayOverDayLabel(Number(stats.activitiesToday ?? 0), Number(stats.activitiesYesterday ?? 0))}
            />
            <KPI
              title="Audit events (total)"
              value={stats.audits ?? "—"}
              delta={dashboardDayOverDayLabel(Number(stats.auditsToday ?? 0), Number(stats.auditsYesterday ?? 0))}
            />
          </>
        ) : role === "HOD" ? (
          <>
            <KPI
              title="Activity logs today"
              value={stats.activitiesToday ?? "—"}
              delta={dashboardDayOverDayLabel(Number(stats.activitiesToday ?? 0), Number(stats.activitiesYesterday ?? 0))}
            />
            <KPI title="Activity logs yesterday" value={stats.activitiesYesterday ?? "—"} delta="Full prior local day" />
            <KPI
              title="PGs with logged activity"
              value={Array.isArray(stats.hod?.pgStats) ? stats.hod.pgStats.length : "—"}
              delta="Distinct PG ids in chart data"
            />
            <KPI
              title="Lifetime PG activity rows"
              value={hodPgActivityTotal != null ? hodPgActivityTotal : "—"}
              delta="Sum of per-PG counts below"
            />
          </>
        ) : (
          <>
            <KPI
              title="Active assignments"
              value={stats.myPatients ?? "—"}
              delta={dashboardDayOverDayLabel(Number(stats.assignmentsToday ?? 0), Number(stats.assignmentsYesterday ?? 0))}
            />
            <KPI
              title="Activities logged today"
              value={stats.activitiesToday ?? "—"}
              delta={dashboardDayOverDayLabel(Number(stats.activitiesToday ?? 0), Number(stats.activitiesYesterday ?? 0))}
            />
            <KPI
              title="My activity entries (all time)"
              value={stats.myActivities ?? "—"}
              delta="Total PG activity log rows for you"
            />
            <KPI title="Delayed notes (pending)" value={stats.pendingTasks ?? "—"} delta="Progress notes flagged delayed" />
          </>
        )}
      </div>
      {loading ? <div className="rounded-2xl border border-slate-200/70 bg-white/95 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm p-4 text-sm text-slate-500">Loading operational board...</div> : null}
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/95 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 text-sm font-semibold">
            <span>Live Allocation Board</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search patient/IP/status"
              className={uiFieldCompact}
            />
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gradient-to-r from-slate-100 to-teal-50/35 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-2">Patient</th>
                <th className="px-4 py-2">IP Number</th>
                <th className="px-4 py-2">Assigned PGs</th>
                <th className="px-4 py-2">Unit</th>
                <th className="px-4 py-2">Consultant</th>
                <th className="px-4 py-2">Hours Since Review</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredBoard.map((row) => (
                <tr
                  key={row.patientId}
                  className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                  title="Open patient timeline"
                  onClick={() => navigate(`/timeline?patient=${row.patientId}`)}
                >
                  <td className="px-4 py-2">{row.patientName || "-"}</td>
                  <td className="px-4 py-2">{row.ipNumber || "-"}</td>
                  <td className="px-4 py-2">
                    {(row.assignedPgs || []).map((p: any) => `${p.name}${p.isPrimary ? " (P)" : ""}`).join(", ") || "-"}
                  </td>
                  <td className="px-4 py-2">{row.unit || "-"}</td>
                  <td className="px-4 py-2">{row.consultant || "-"}</td>
                  <td className="px-4 py-2">{row.hoursSinceReview ?? "-"}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-1 text-xs ${
                      row.status === "ICU Critical" || row.status === "Unassigned"
                        ? "bg-red-50 text-red-700"
                        : row.status === "Delayed Review"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-emerald-50 text-emerald-700"
                    }`}>{row.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rounded-2xl border border-slate-200/70 bg-white/95 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm p-4">
          <h3 className="text-sm font-semibold">Alerts Panel</h3>
          <div className="mt-3 space-y-2">
            {alerts.slice(0, 8).map((a, idx) => (
              <div key={`${a.type}-${idx}`} className={`rounded-lg border px-2 py-2 text-xs ${
                a.severity === "high" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-700"
              }`}>
                <div className="font-semibold">{a.type}</div>
                <div>{a.message}</div>
              </div>
            ))}
            {alerts.length === 0 ? <div className="text-xs text-slate-500">No active alerts</div> : null}
          </div>
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/95 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">PG Workload Matrix</div>
        <table className="w-full text-sm">
          <thead className="bg-gradient-to-r from-slate-100 to-teal-50/35 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-2">PG Name</th>
              <th className="px-4 py-2">Active Patients</th>
              <th className="px-4 py-2">ICU Patients</th>
              <th className="px-4 py-2">Activities Today</th>
              <th className="px-4 py-2">Pending Notes</th>
              <th className="px-4 py-2">Delayed Reviews</th>
              <th className="px-4 py-2">Risk</th>
            </tr>
          </thead>
          <tbody>
            {workload.map((w) => (
              <tr key={w.pgId} className="border-t border-slate-100">
                <td className="px-4 py-2">{w.pgName}</td>
                <td className="px-4 py-2">{w.activePatients}</td>
                <td className="px-4 py-2">{w.icuPatients}</td>
                <td className="px-4 py-2">{w.activitiesToday}</td>
                <td className="px-4 py-2">{w.pendingNotes}</td>
                <td className="px-4 py-2">{w.delayedReviews}</td>
                <td className="px-4 py-2">
                  {w.overloaded ? <span className="rounded-full bg-red-50 px-2 py-1 text-xs text-red-700">Overloaded</span> : null}
                  {!w.overloaded && w.inactive ? <span className="rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-700">Inactive</span> : null}
                  {!w.overloaded && !w.inactive ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700">Normal</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppLayout>
  );
}

type TimelineRefs = {
  pgById: Record<string, string>;
  deptById: Record<string, string>;
  unitById: Record<string, string>;
};

function formatTimelineDate(value: unknown): string {
  if (value == null || value === "") return "—";
  const d = new Date(value as string | number | Date);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

function shortRef(id: unknown): string {
  if (id == null || id === "") return "—";
  const s = String(id);
  return s.length > 10 ? `…${s.slice(-10)}` : s;
}

function TimelineDetailRows({ rows }: { rows: Array<{ label: string; value: ReactNode }> }) {
  return (
    <div className="mt-2 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(0,140px)_1fr]">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <div className="text-slate-500">{row.label}</div>
          <div className="text-slate-900">{row.value}</div>
        </div>
      ))}
    </div>
  );
}

function TimelineEventBody({ event, refs }: { event: { type: string; data: Record<string, unknown> }; refs: TimelineRefs }) {
  const d = event.data || {};
  const pgName = (id: unknown) => refs.pgById[String(id ?? "")] || `PG ref ${shortRef(id)}`;

  switch (event.type) {
    case "Admission":
      return (
        <TimelineDetailRows
          rows={[
            { label: "Admission date", value: formatTimelineDate(d.admissionDate) },
            { label: "Ward / bed", value: String(d.wardBedNumber ?? "—") },
            { label: "Status", value: String(d.status ?? "—") },
            {
              label: "Department",
              value: refs.deptById[String(d.departmentId ?? "")] || shortRef(d.departmentId),
            },
            {
              label: "Unit",
              value: refs.unitById[String(d.unitId ?? "")] || (d.unitId ? shortRef(d.unitId) : "—"),
            },
            ...(d.assignedPgId ? [{ label: "Assigned PG", value: pgName(d.assignedPgId) }] : []),
          ]}
        />
      );
    case "Assignment":
      return (
        <TimelineDetailRows
          rows={[
            { label: "PG", value: pgName(d.pgId) },
            { label: "Shift", value: String(d.shift ?? "—") },
            { label: "Type", value: String(d.assignmentType ?? "—") },
            {
              label: "Primary",
              value: d.isPrimary ? <span className="font-medium text-emerald-700">Yes</span> : "No",
            },
            {
              label: "ICU tag",
              value: d.icuTag ? <span className="font-medium text-amber-700">Yes</span> : "No",
            },
            { label: "Active", value: d.isActive === false ? "No" : "Yes" },
            {
              label: "Department",
              value: refs.deptById[String(d.departmentId ?? "")] || shortRef(d.departmentId),
            },
            {
              label: "Unit",
              value: refs.unitById[String(d.unitId ?? "")] || (d.unitId ? shortRef(d.unitId) : "—"),
            },
            ...(d.remarks ? [{ label: "Remarks", value: String(d.remarks) }] : []),
            { label: "Assigned at", value: formatTimelineDate(d.assignedAt) },
          ]}
        />
      );
    case "Activity":
      return (
        <TimelineDetailRows
          rows={[
            { label: "Activity", value: String(d.activityType ?? "—") },
            { label: "PG", value: pgName(d.pgId) },
            { label: "Recorded", value: formatTimelineDate(d.createdAt) },
            { label: "Remarks", value: String(d.remarks ?? "—") },
          ]}
        />
      );
    case "Procedure":
      return (
        <TimelineDetailRows
          rows={[
            { label: "Procedure", value: String(d.procedureName ?? "—") },
            { label: "Role", value: String(d.role ?? "—") },
            { label: "Date", value: formatTimelineDate(d.date) },
            { label: "PG", value: pgName(d.pgId) },
          ]}
        />
      );
    case "ProgressNote":
      return (
        <div className="mt-2 space-y-2 text-sm">
          <TimelineDetailRows
            rows={[
              { label: "Note time", value: formatTimelineDate(d.noteDateTime) },
              { label: "PG", value: pgName(d.pgId) },
              {
                label: "Delayed entry",
                value: d.delayedEntry ? <span className="text-amber-700">Yes</span> : "No",
              },
            ]}
          />
          <div>
            <p className="text-xs font-medium text-slate-500">Content</p>
            <p className="mt-1 whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2 text-slate-800">{String(d.noteContent ?? "—")}</p>
          </div>
        </div>
      );
    case "Discharge":
      return (
        <TimelineDetailRows
          rows={[
            { label: "Status", value: String(d.status ?? "—") },
            { label: "Diagnosis", value: String(d.diagnosis ?? "—") },
            { label: "Medications", value: String(d.medications ?? "—") },
            { label: "Follow-up", value: String(d.followUpInstructions ?? "—") },
          ]}
        />
      );
    default:
      return (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-slate-600">Technical details</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs text-slate-700">
            {JSON.stringify(d, null, 2)}
          </pre>
        </details>
      );
  }
}

function normalizeTimelinePayload(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)) {
    return (raw as { data: any[] }).data;
  }
  return [];
}

function TimelinePage() {
  const [searchParams] = useSearchParams();
  const [patients, setPatients] = useState<any[]>([]);
  const [patientId, setPatientId] = useState("");
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [eventFilter, setEventFilter] = useState("All");
  const [refs, setRefs] = useState<TimelineRefs>({ pgById: {}, deptById: {}, unitById: {} });

  useEffect(() => {
    void Promise.all([api.get("/patients"), api.get("/pg"), api.get("/departments"), api.get("/units")])
      .then(([patRes, pgRes, deptRes, unitRes]) => {
        setPatients(patRes.data.data || []);
        const pgById: Record<string, string> = {};
        (pgRes.data || []).forEach((u: any) => {
          pgById[String(u._id)] = u.fullName || u.username || String(u._id);
        });
        const deptById: Record<string, string> = {};
        (deptRes.data || []).forEach((x: any) => {
          deptById[String(x._id)] = x.name || String(x._id);
        });
        const unitById: Record<string, string> = {};
        (unitRes.data || []).forEach((x: any) => {
          unitById[String(x._id)] = x.name || String(x._id);
        });
        setRefs({ pgById, deptById, unitById });
      })
      .catch(() => undefined);
  }, []);

  const loadTimeline = async (id?: string) => {
    const targetId = (id ?? patientId).trim();
    if (!targetId) {
      setError("Select a patient or enter a valid patient id.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get(`/patient-timeline/${encodeURIComponent(targetId)}`);
      setEvents(normalizeTimelinePayload(data));
    } catch (err: any) {
      const msg =
        typeof err?.response?.data?.message === "string"
          ? err.response.data.message
          : "Unable to load timeline. Try another patient or check that the id is a valid 24-character value.";
      setError(msg);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  const patientParam = searchParams.get("patient") ?? "";
  useEffect(() => {
    const fromUrl = patientParam.trim();
    if (!fromUrl) return;
    setPatientId(fromUrl);
    setEventFilter("All");
    void loadTimeline(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally run when URL patient changes only
  }, [patientParam]);

  const selectedPatient = useMemo(
    () => patients.find((p) => String(p._id) === String(patientId)) || null,
    [patients, patientId],
  );

  const eventTypes = useMemo(() => {
    const names = Array.from(new Set(events.map((e: any) => String(e.type ?? e.eventType ?? "Unknown"))));
    names.sort((a, b) => a.localeCompare(b));
    return ["All", ...names];
  }, [events]);

  useEffect(() => {
    if (eventFilter === "All") return;
    const allowed = new Set(events.map((e: any) => String(e.type ?? e.eventType ?? "Unknown")));
    if (!allowed.has(eventFilter)) setEventFilter("All");
  }, [events, eventFilter]);

  const filteredEvents = useMemo(() => {
    return events.filter((event: any) => {
      const t = String(event.type ?? event.eventType ?? "");
      return eventFilter === "All" || t === eventFilter;
    });
  }, [events, eventFilter]);

  const typeBadgeClass = (type: string) => {
    switch (type) {
      case "Admission":
        return "bg-blue-100 text-blue-800";
      case "Assignment":
        return "bg-indigo-100 text-indigo-800";
      case "Activity":
        return "bg-emerald-100 text-emerald-800";
      case "ProgressNote":
        return "bg-amber-100 text-amber-800";
      case "Procedure":
        return "bg-cyan-100 text-cyan-800";
      case "Discharge":
        return "bg-rose-100 text-rose-800";
      default:
        return "bg-slate-200 text-slate-700";
    }
  };

  return (
    <AppLayout title="Patient Timeline" subtitle="Unified chronological timeline across assignment and clinical events.">
      <section className="rounded-2xl border border-slate-200/70 bg-white/95 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm p-4">
        <div className="grid gap-3 lg:grid-cols-[2fr_1fr_auto]">
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-medium text-slate-600">Patient</label>
            <select
              className={uiField}
              value={patientId}
              onChange={(e) => {
                const v = e.target.value;
                setPatientId(v);
                setError("");
                setEventFilter("All");
                if (!v.trim()) {
                  setEvents([]);
                  return;
                }
                void loadTimeline(v);
              }}
            >
              <option value="">Select patient</option>
              {patients.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.patientName} ({p.ipNumber})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Event type</label>
            <select
              className={uiField}
              value={eventFilter}
              onChange={(e) => setEventFilter(e.target.value)}
            >
              {eventTypes.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void loadTimeline()}
              className="w-full rounded-xl bg-gradient-to-r from-teal-700 to-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-teal-900/20 transition hover:from-teal-800 hover:to-teal-700 lg:w-auto"
            >
              Load Timeline
            </button>
          </div>
        </div>
        <div className={uiInfoBar}>
          <span className="font-medium text-slate-700">{selectedPatient ? `${selectedPatient.patientName} (${selectedPatient.ipNumber})` : "No patient selected"}</span>
          {" • "}
          {filteredEvents.length} event{filteredEvents.length === 1 ? "" : "s"} shown
          {eventFilter !== "All" ? ` • filtered by ${eventFilter}` : ""}
        </div>
      </section>
      {loading ? <div className="rounded-2xl border border-slate-200/70 bg-white/95 p-4 text-sm text-slate-500 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm">Loading timeline...</div> : null}
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {!loading && !error && filteredEvents.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/70 bg-white/95 p-4 text-sm text-slate-500 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm">
          No timeline events match the current filter/search.
        </div>
      ) : null}
      <div className="space-y-3">
        {filteredEvents.map((event: any, idx: number) => {
          const eventKind = String(event.type ?? event.eventType ?? "Unknown");
          return (
          <article key={`${eventKind}-${idx}`} className="rounded-2xl border border-slate-200/70 bg-white/95 p-4 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs tabular-nums text-slate-500">{formatTimelineDate(event.at)}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${typeBadgeClass(eventKind)}`}>
                {eventKind}
              </span>
            </div>
            <TimelineEventBody event={{ ...event, type: eventKind }} refs={refs} />
          </article>
          );
        })}
      </div>
    </AppLayout>
  );
}

function AuditLogsPage() {
  const limit = 25;
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    void api
      .get(`/audit-logs?page=${page}&limit=${limit}`)
      .then((res) => {
        setTotal(Number(res.data?.total ?? 0));
        setRows(Array.isArray(res.data?.data) ? res.data.data : []);
        setError("");
      })
      .catch(() => setError("Unable to load audit logs. You need Admin or MRD role."))
      .finally(() => setLoading(false));
  }, [page]);

  const pageCount = Math.max(1, Math.ceil(total / limit));
  const moduleBadgeClass = (moduleName: string) => {
    switch (moduleName) {
      case "Assignment":
        return "bg-indigo-100 text-indigo-800";
      case "Activity":
        return "bg-sky-100 text-sky-800";
      case "Admission":
        return "bg-rose-100 text-rose-800";
      case "Auth":
        return "bg-violet-100 text-violet-800";
      case "PGMaster":
        return "bg-cyan-100 text-cyan-800";
      case "Department":
      case "Unit":
        return "bg-amber-100 text-amber-800";
      default:
        return "bg-slate-200 text-slate-800";
    }
  };

  const normalizedSearch = search.trim().toLowerCase();
  const filteredRows =
    normalizedSearch.length === 0
      ? rows
      : rows.filter((r: any) => {
          const values = [
            r.username,
            r.patientDisplay,
            r.patientRef,
            r.action,
            r.module,
            r.status,
            r.path,
          ]
            .filter(Boolean)
            .map((v) => String(v).toLowerCase());
          return values.some((v) => v.includes(normalizedSearch));
        });

  return (
    <AppLayout title="Audit Log Center" subtitle="Governance trail of mutating API actions (newest first).">
      {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200/70 bg-white/95 px-4 py-3 text-sm shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm">
        <span className="text-slate-600">
          Total events: <span className="font-semibold text-slate-900">{total}</span>
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search user, patient, action, module, status"
            className={uiFieldSearchWide}
          />
          <button
            type="button"
            className={uiBtnOutlineSm}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span className="text-xs text-slate-600">
            Page {page} / {pageCount}
          </span>
          <button
            type="button"
            className={uiBtnOutlineSm}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/95 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm">
        <table className="w-full text-sm">
          <thead className="bg-gradient-to-r from-slate-100 to-teal-50/35 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-2">Time</th>
              <th className="px-4 py-2">User</th>
              <th className="px-4 py-2">Patient</th>
              <th className="px-4 py-2">Action</th>
              <th className="px-4 py-2">Module</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r: any) => (
              <tr key={r._id} className="border-t border-slate-100 align-top">
                <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-600">
                  {r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}
                </td>
                <td className="px-4 py-2">{r.username || "—"}</td>
                <td className="px-4 py-2 text-xs">{r.patientDisplay || r.patientRef || r.meta?.patientId || "—"}</td>
                <td className="px-4 py-2">{r.action || "—"}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${moduleBadgeClass(String(r.module || ""))}`}>
                    {r.module || "—"}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      r.status === "Failed" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                    }`}
                    title={typeof r.statusCode === "number" ? `HTTP ${r.statusCode}` : undefined}
                  >
                    {r.status || "Success"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && rows.length === 0 ? <p className="p-4 text-sm text-slate-500">No audit entries yet.</p> : null}
        {!loading && rows.length > 0 && filteredRows.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No matching audit entries for this search.</p>
        ) : null}
      </div>
    </AppLayout>
  );
}

function ReportsPage() {
  const [message, setMessage] = useState("");
  const [pgs, setPgs] = useState<any[]>([]);
  const [activityTypes, setActivityTypes] = useState<any[]>([]);
  const initialFilters = {
    from: "",
    to: "",
    pgId: "",
    activityTypeId: "",
  };
  const [filters, setFilters] = useState({
    ...initialFilters,
  });

  useEffect(() => {
    void Promise.all([api.get("/pg"), api.get("/activity-types")])
      .then(([pgRes, typeRes]) => {
        setPgs(pgRes.data || []);
        setActivityTypes(typeRes.data || []);
      })
      .catch(() => undefined);
  }, []);

  const selectedPg = pgs.find((p) => String(p._id) === filters.pgId);
  const selectedType = activityTypes.find((t) => String(t._id) === filters.activityTypeId);

  const filterSummary = [
    filters.from ? `From: ${filters.from}` : "From: Any",
    filters.to ? `To: ${filters.to}` : "To: Any",
    selectedPg ? `PG: ${selectedPg.fullName}` : "PG: All",
    selectedType ? `Activity: ${selectedType.name}` : "Activity: All",
  ].join(" • ");

  const run = async (format: "excel" | "pdf") => {
    try {
      const params = new URLSearchParams({ format });
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      if (filters.pgId) params.set("pgId", filters.pgId);
      if (filters.activityTypeId) params.set("activityTypeId", filters.activityTypeId);
      const response = await api.get(`/reports/pg-activity?${params.toString()}`, { responseType: "blob" });
      const mime = format === "excel" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf";
      const extension = format === "excel" ? "xlsx" : "pdf";
      const blob = new Blob([response.data], { type: mime });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pg-activity-report.${extension}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setMessage("Report downloaded successfully.");
    } catch {
      setMessage("Report download failed. Please login and retry.");
    }
  };
  return (
    <AppLayout title="Reports & Export" subtitle="Filtered PG activity exports grouped by patient (clinical layout); Excel or PDF.">
      <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/95 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">Available Reports</div>
        <div className="p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">From date</label>
              <input
                type="date"
                value={filters.from}
                onChange={(e) => setFilters((prev) => ({ ...prev, from: e.target.value }))}
                className={uiField}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">To date</label>
              <input
                type="date"
                value={filters.to}
                onChange={(e) => setFilters((prev) => ({ ...prev, to: e.target.value }))}
                className={uiField}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">PG</label>
              <select
                value={filters.pgId}
                onChange={(e) => setFilters((prev) => ({ ...prev, pgId: e.target.value }))}
                className={uiField}
              >
                <option value="">All PGs</option>
                {pgs.map((pg) => (
                  <option key={pg._id} value={pg._id}>{pg.fullName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Activity type</label>
              <select
                value={filters.activityTypeId}
                onChange={(e) => setFilters((prev) => ({ ...prev, activityTypeId: e.target.value }))}
                className={uiField}
              >
                <option value="">All activities</option>
                {activityTypes.map((t) => (
                  <option key={t._id} value={t._id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className={uiInfoBar}>
            <span className="font-semibold text-slate-700">Filters Summary:</span> {filterSummary}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <button type="button" className={uiBtnReport} onClick={() => run("excel")}>PG Activity - Excel</button>
            <button type="button" className={uiBtnReport} onClick={() => run("pdf")}>PG Activity - PDF</button>
          </div>
          <div className="mt-3">
            <button
              type="button"
              className={uiBtnOutlineSm}
              onClick={() => setFilters(initialFilters)}
            >
              Reset Filters
            </button>
          </div>
          {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
        </div>
      </div>
    </AppLayout>
  );
}

function MobileHooksPage() {
  return (
    <AppLayout title="Mobile Readiness Hooks" subtitle="Prepared UI extension points for Phase 3 mobile workflows.">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200/70 bg-white/95 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm p-5">
          <h3 className="text-sm font-semibold">QR Scan Module</h3>
          <p className="mt-1 text-sm text-slate-600">Reserved slot for instant patient lookup via ward wristband scan.</p>
        </div>
        <div className="rounded-2xl border border-slate-200/70 bg-white/95 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm p-5">
          <h3 className="text-sm font-semibold">Push Alerts</h3>
          <p className="mt-1 text-sm text-slate-600">Notification center for pending notes and delayed discharge workflows.</p>
        </div>
        <div className="rounded-2xl border border-slate-200/70 bg-white/95 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm p-5">
          <h3 className="text-sm font-semibold">Voice Capture</h3>
          <p className="mt-1 text-sm text-slate-600">Pluggable dictation panel for rounds-time activity capture.</p>
        </div>
      </div>
    </AppLayout>
  );
}

function ProtectedRoutes() {
  const token = useSelector((s: RootState) => s.auth.token);
  if (!token) return <Navigate to="/login" replace />;
  return (
    <Routes>
      <Route path="/dashboard/pg" element={<PGDashboardPage />} />
      <Route
        path="/masters"
        element={
          <RequireRole roles={["Admin", "HOD"]}>
            <MastersPage />
          </RequireRole>
        }
      />
      <Route path="/admission" element={<AdmissionPage />} />
      <Route path="/assignment" element={<ResidentAllocationPage />} />
      <Route path="/activity" element={<ActivityPage />} />
      <Route path="/timeline" element={<TimelinePage />} />
      <Route
        path="/audit-logs"
        element={
          <RequireRole roles={["Admin", "MRD"]}>
            <AuditLogsPage />
          </RequireRole>
        }
      />
      <Route path="/reports" element={<ReportsPage />} />
      <Route path="/mobile" element={<MobileHooksPage />} />
      <Route path="*" element={<Navigate to="/dashboard/pg" replace />} />
    </Routes>
  );
}

function AppInner() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/*" element={<ProtectedRoutes />} />
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <Provider store={store}>
      <AppInner />
    </Provider>
  );
}
