import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { Provider, useDispatch, useSelector } from "react-redux";
import { api } from "./api";
import { clearAuth, setAuth, store } from "./store";
import type { AppDispatch, RootState } from "./store";

type NavItem = { to: string; label: string; section: string };

const navItems: NavItem[] = [
  { to: "/dashboard/pg", label: "Executive Dashboard", section: "Operations" },
  { to: "/masters", label: "Master Data Registry", section: "Administration" },
  { to: "/admission", label: "Admission Desk", section: "Clinical Flow" },
  { to: "/assignment", label: "Resident Allocation", section: "Clinical Flow" },
  { to: "/activity", label: "Activity Console", section: "Clinical Flow" },
  { to: "/timeline", label: "Patient Timeline", section: "Clinical Flow" },
  { to: "/reports", label: "Report Center", section: "Analytics" },
  { to: "/mobile", label: "Mobility Extensions", section: "Extensions" },
];

function KPI({ title, value, delta }: { title: string; value: string | number; delta: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-slate-500">{title}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      <div className="mt-1 text-xs font-medium text-emerald-600">{delta}</div>
    </div>
  );
}

function LoginPage() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
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
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl md:grid-cols-2">
        <div className="hidden bg-slate-900 p-10 text-slate-100 md:block">
          <p className="text-xs uppercase tracking-[0.2em] text-blue-300">Enterprise Clinical Suite</p>
          <h1 className="mt-4 text-3xl font-semibold leading-tight">PG Clinical Activity ERP</h1>
          <p className="mt-4 text-sm text-slate-300">
            Unified operations for patient admission, resident allocation, clinical activity governance, and reporting.
          </p>
        </div>
        <div className="p-8">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Secure Access</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-900">Sign In</h2>
          <p className="mt-1 text-sm text-slate-500">Use your credential to access role-based workspace.</p>
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <input className="w-full rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-blue-600" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" />
            <input className="w-full rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-blue-600" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
            <button className="w-full rounded-lg bg-blue-700 p-3 text-sm font-medium text-white hover:bg-blue-800" type="submit">Sign In to Workspace</button>
            {error && <p className="text-xs text-red-600">{error}</p>}
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
  const navBySection = useMemo(() => {
    const grouped = new Map<string, NavItem[]>();
    navItems.forEach((item) => {
      if (!grouped.has(item.section)) grouped.set(item.section, []);
      grouped.get(item.section)?.push(item);
    });
    return Array.from(grouped.entries());
  }, []);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-3 md:px-6">
          <div>
            <h1 className="text-base font-semibold md:text-lg">PG Clinical Activity ERP Console</h1>
            <p className="text-xs text-slate-500">Hospital Operations • Residency Governance • Audit Traceability</p>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <input placeholder="Search patients, PGs, reports..." className="w-80 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-600" />
            <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100">Help</button>
            <button
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100"
              onClick={() => {
                dispatch(clearAuth());
                navigate("/login");
              }}
            >
              Logout
            </button>
          </div>
          <div className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700">
            {user?.fullName || user?.username || "User"} • {user?.role || "Role"}
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-5 p-4 md:grid-cols-[270px_1fr] md:p-6">
        <nav className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          {navBySection.map(([section, items]) => (
            <div key={section} className="mb-3 last:mb-0">
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{section}</p>
              <ul className="space-y-1">
                {items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      className={({ isActive }) =>
                        `block rounded-lg px-3 py-2 text-sm transition ${
                          isActive ? "bg-blue-700 text-white shadow-sm" : "text-slate-700 hover:bg-slate-100"
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
        </nav>
        <main className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">{title}</h2>
                <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
              </div>
              <div className="flex gap-2">
                <button className="rounded-lg border border-slate-300 px-3 py-2 text-xs hover:bg-slate-100" onClick={() => window.print()}>Export Snapshot</button>
                <button className="rounded-lg bg-blue-700 px-3 py-2 text-xs text-white hover:bg-blue-800" onClick={() => navigate("/admission")}>New Action</button>
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
  const [departments] = useState<any[]>([
    { name: "General Medicine", code: "MED", status: "Active" },
    { name: "General Surgery", code: "SUR", status: "Active" },
  ]);
  const [units] = useState<any[]>([
    { name: "Unit A", department: "General Medicine", consultant: "Dr. Consultant One" },
    { name: "Unit B", department: "General Surgery", consultant: "Pending" },
  ]);
  return (
    <AppLayout title="Master Data Control" subtitle="Manage organizational setup and clinical metadata.">
      <div className="grid gap-4 md:grid-cols-3">
        <KPI title="Departments" value={departments.length} delta="+1 this quarter" />
        <KPI title="Units" value={units.length} delta="+1 this month" />
        <KPI title="Activity Types" value={8} delta="Standardized" />
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">Department Registry</div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Department</th>
              <th className="px-4 py-2">Code</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {departments.map((d) => (
              <tr key={d.code} className="border-t border-slate-100">
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
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">Unit Mapping</div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Unit</th>
              <th className="px-4 py-2">Department</th>
              <th className="px-4 py-2">Consultant</th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.name} className="border-t border-slate-100">
                <td className="px-4 py-2">{u.name}</td>
                <td className="px-4 py-2">{u.department}</td>
                <td className="px-4 py-2">{u.consultant}</td>
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
    <AppLayout title="Patient Admission" subtitle="Register admissions and initialize PG care assignment.">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-3">
          <input
            className="rounded-lg border border-slate-300 p-2.5 text-sm"
            placeholder="IP Number (optional)"
            value={form.ipNumber}
            onChange={(e) => setForm((prev) => ({ ...prev, ipNumber: e.target.value }))}
          />
          <input
            className="rounded-lg border border-slate-300 p-2.5 text-sm"
            placeholder="Patient Name"
            value={form.patientName}
            onChange={(e) => setForm((prev) => ({ ...prev, patientName: e.target.value }))}
          />
          <input
            className="rounded-lg border border-slate-300 p-2.5 text-sm"
            placeholder="Age"
            value={form.age}
            onChange={(e) => setForm((prev) => ({ ...prev, age: e.target.value }))}
          />
          <select
            className="rounded-lg border border-slate-300 p-2.5 text-sm"
            value={form.gender}
            onChange={(e) => setForm((prev) => ({ ...prev, gender: e.target.value }))}
          >
            <option>Male</option>
            <option>Female</option>
            <option>Other</option>
          </select>
          <input
            className="rounded-lg border border-slate-300 p-2.5 text-sm"
            placeholder="Ward / Bed"
            value={form.wardBedNumber}
            onChange={(e) => setForm((prev) => ({ ...prev, wardBedNumber: e.target.value }))}
          />
          <select
            className="rounded-lg border border-slate-300 p-2.5 text-sm"
            value={form.departmentId}
            onChange={(e) => setForm((prev) => ({ ...prev, departmentId: e.target.value }))}
          >
            <option value="">Select Department *</option>
            {departments.map((d) => (
              <option key={d._id} value={d._id}>{d.name}</option>
            ))}
          </select>
          <select
            className="rounded-lg border border-slate-300 p-2.5 text-sm"
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
        <button className="mt-4 rounded-lg bg-blue-700 px-4 py-2 text-sm text-white hover:bg-blue-800" onClick={() => void submit()}>
          Create Admission
        </button>
        {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
      </div>
    </AppLayout>
  );
}

function AssignmentPage() {
  return (
    <AppLayout title="Patient Assignment" subtitle="Assign or reassign PG doctors by patient and shift.">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">Current Assignment Queue</div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Patient</th>
              <th className="px-4 py-2">Current PG</th>
              <th className="px-4 py-2">Shift</th>
              <th className="px-4 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-slate-100">
              <td className="px-4 py-2">IP10231 - R. Kumar</td>
              <td className="px-4 py-2">Dr. PG One</td>
              <td className="px-4 py-2">General</td>
              <td className="px-4 py-2"><button className="rounded bg-slate-800 px-2 py-1 text-xs text-white" onClick={() => alert("Use Allocation APIs to reassign currently. UI wiring next step.")}>Reassign</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </AppLayout>
  );
}

function ActivityPage() {
  const [patients, setPatients] = useState<any[]>([]);
  const [pgs, setPgs] = useState<any[]>([]);
  const [activityTypes, setActivityTypes] = useState<any[]>([]);
  const [form, setForm] = useState({
    patientId: "",
    pgId: "",
    activityTypeId: "",
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

  const submitActivity = async () => {
    try {
      await api.post("/activity", {
        patientId: form.patientId,
        pgId: form.pgId,
        activityTypeId: form.activityTypeId,
        remarks: form.remarks || "No remarks",
      });
      setMessage("Activity submitted successfully.");
      setForm((prev) => ({ ...prev, remarks: "" }));
    } catch {
      setMessage("Activity submission failed. Ensure patient and PG have active assignment.");
    }
  };

  return (
    <AppLayout title="Activity Entry" subtitle="Record time-stamped clinical actions and update patient timelines.">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <select
            className="rounded-lg border border-slate-300 p-2.5 text-sm"
            value={form.patientId}
            onChange={(e) => setForm((prev) => ({ ...prev, patientId: e.target.value }))}
          >
            <option value="">Select Patient</option>
            {patients.map((p) => (
              <option key={p._id} value={p._id}>{p.patientName} ({p.ipNumber})</option>
            ))}
          </select>
          <select
            className="rounded-lg border border-slate-300 p-2.5 text-sm"
            value={form.pgId}
            onChange={(e) => setForm((prev) => ({ ...prev, pgId: e.target.value }))}
          >
            <option value="">Select PG</option>
            {pgs.map((pg) => (
              <option key={pg._id} value={pg._id}>{pg.fullName}</option>
            ))}
          </select>
          <select
            className="rounded-lg border border-slate-300 p-2.5 text-sm"
            value={form.activityTypeId}
            onChange={(e) => setForm((prev) => ({ ...prev, activityTypeId: e.target.value }))}
          >
            <option value="">Select Activity Type</option>
            {activityTypes.map((t) => (
              <option key={t._id} value={t._id}>{t.name}</option>
            ))}
          </select>
          <input className="rounded-lg border border-slate-300 bg-slate-50 p-2.5 text-sm" value={new Date().toLocaleString()} disabled />
        </div>
        <textarea
          className="mt-3 h-24 w-full rounded-lg border border-slate-300 p-2.5 text-sm"
          placeholder="Clinical remarks"
          value={form.remarks}
          onChange={(e) => setForm((prev) => ({ ...prev, remarks: e.target.value }))}
        />
        <button className="mt-3 rounded-lg bg-blue-700 px-4 py-2 text-sm text-white hover:bg-blue-800" onClick={() => void submitActivity()}>
          Submit Activity
        </button>
        {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
      </div>
    </AppLayout>
  );
}

function PGDashboardPage() {
  const user = useSelector((s: RootState) => s.auth.user);
  const [stats, setStats] = useState<any>({ users: "-", patients: "-", activities: "-", audits: "-" });
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
        else if (role === "HOD") setStats({ users: "-", patients: "-", activities: "-", audits: "-", hod: admin.data });
        else setStats({
          users: "-",
          patients: admin.data.myPatients,
          activities: admin.data.myActivities,
          audits: "-",
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

  return (
    <AppLayout title="Operations Dashboard" subtitle="Live snapshot of activity, patient load, and governance logs.">
      <div className="grid gap-4 md:grid-cols-4">
        <KPI title="Active Users" value={stats?.users ?? "-"} delta="+4.2%" />
        <KPI title="Current Patients" value={stats?.patients ?? "-"} delta="+2.1%" />
        <KPI title="Daily Activities" value={stats?.activities ?? "-"} delta="+6.4%" />
        <KPI title="Audit Events" value={stats?.audits ?? "-"} delta="Realtime" />
      </div>
      {loading ? <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">Loading operational board...</div> : null}
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 text-sm font-semibold">
            <span>Live Allocation Board</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search patient/IP/status"
              className="rounded border border-slate-300 px-2 py-1 text-xs"
            />
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
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
                <tr key={row.patientId} className="border-t border-slate-100">
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
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
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
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">PG Workload Matrix</div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
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

function TimelinePage() {
  const [patientId, setPatientId] = useState("");
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadTimeline = async () => {
    if (!patientId) return;
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get(`/patient-timeline/${patientId}`);
      setEvents(data);
    } catch {
      setError("Unable to load timeline. Check patient id.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppLayout title="Patient Timeline" subtitle="Unified chronological timeline across assignment and clinical events.">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex gap-2">
          <input
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
            placeholder="Enter patient ObjectId"
          />
          <button onClick={() => void loadTimeline()} className="rounded bg-blue-700 px-4 py-2 text-sm text-white">Load</button>
        </div>
      </div>
      {loading ? <div className="text-sm text-slate-500">Loading timeline...</div> : null}
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      <div className="space-y-3">
        {events.map((event, idx) => (
          <div key={`${event.type}-${idx}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs text-slate-500">{new Date(event.at).toLocaleString()}</div>
            <div className="mt-1 text-sm font-semibold">{event.type}</div>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs text-slate-700">
              {JSON.stringify(event.data, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    </AppLayout>
  );
}

function ReportsPage() {
  const [message, setMessage] = useState("");
  const run = async (format: string) => {
    try {
      const response = await api.get(`/reports/pg-activity?format=${format}`, {
        responseType: format === "json" ? "json" : "blob",
      });
      if (format === "json") {
        const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        return;
      }
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
    <AppLayout title="Reports & Export" subtitle="Generate PG activity reports in JSON, Excel, or PDF formats.">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">Available Reports</div>
        <div className="p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <button className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm hover:bg-slate-100" onClick={() => run("json")}>PG Activity - JSON</button>
            <button className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm hover:bg-slate-100" onClick={() => run("excel")}>PG Activity - Excel</button>
            <button className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm hover:bg-slate-100" onClick={() => run("pdf")}>PG Activity - PDF</button>
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
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold">QR Scan Module</h3>
          <p className="mt-1 text-sm text-slate-600">Reserved slot for instant patient lookup via ward wristband scan.</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold">Push Alerts</h3>
          <p className="mt-1 text-sm text-slate-600">Notification center for pending notes and delayed discharge workflows.</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
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
      <Route path="/masters" element={<MastersPage />} />
      <Route path="/admission" element={<AdmissionPage />} />
      <Route path="/assignment" element={<AssignmentPage />} />
      <Route path="/activity" element={<ActivityPage />} />
      <Route path="/timeline" element={<TimelinePage />} />
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
