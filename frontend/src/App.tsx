import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FormEvent, ReactNode } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
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
  "w-full md:max-w-[220px] rounded-xl border border-slate-200 bg-slate-50/80 px-2.5 py-1.5 text-xs text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20";
const uiFieldSearchWide =
  "w-full md:w-80 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20";
const uiBtnReport = "rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:border-teal-300 hover:bg-teal-50/80 focus:outline-none focus:ring-2 focus:ring-teal-500/20";
const uiTableScroll = "overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]";
const uiTableSwipeHint = "border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500 md:hidden";

function pgDisplayName(pg: any): string {
  return String(pg?.fullName || pg?.username || "PG");
}

function pgDepartmentName(pg: any): string {
  return typeof pg?.departmentId === "object" ? String(pg?.departmentId?.name || "") : "";
}

function pgYearLabel(pg: any): string {
  const year = Number(pg?.yearOfResidency);
  return Number.isFinite(year) && year > 0 ? `Year ${year}` : "";
}

function pgMetaLabel(pg: any): string {
  return [pgDepartmentName(pg), pgYearLabel(pg)].filter(Boolean).join(" · ");
}

function pgOptionLabel(pg: any): string {
  const name = pgDisplayName(pg);
  const meta = pgMetaLabel(pg);
  return meta ? `${name} - ${meta}` : name;
}

function normalizeDeptKey(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function departmentsAlign(patientDept: string, pgDept: string): boolean {
  const a = normalizeDeptKey(patientDept);
  const b = normalizeDeptKey(pgDept);
  if (!a || !b) return true;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  if (isPediatricsDeptKey(a) && isPediatricsDeptKey(b)) return true;
  return false;
}

function isPediatricsDeptKey(key: string): boolean {
  return key.includes("PAEDIATRIC") || key.includes("PEDIATRIC");
}

function textMatchesPgSearch(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (!n) return true;
  if (h.includes(n)) return true;
  if (isPediatricsDeptKey(normalizeDeptKey(n)) && isPediatricsDeptKey(normalizeDeptKey(h))) return true;
  return false;
}

function pgNameShowsDepartment(fullName: string, department: string): boolean {
  if (!department.trim()) return false;
  return fullName.toUpperCase().includes(department.trim().toUpperCase());
}

function pgIdentityKey(pg: any): string {
  return `${String(pg?.fullName ?? "")
    .trim()
    .toLowerCase()}|${Number(pg?.yearOfResidency) || 0}`;
}

function pgListPreferenceScore(pg: any): number {
  const dept = pgDepartmentName(pg).toUpperCase();
  if (dept === "PEDIATRICS") return 3;
  if (dept.includes("PEDIATRIC") && !dept.includes("PAEDIATRIC")) return 2;
  if (dept.includes("PAEDIATRIC")) return 1;
  return 0;
}

/** Same resident seeded twice under Pediatrics + PAEDIATRICS — keep one card. */
function dedupePgListByIdentity(pgs: any[]): any[] {
  const byKey = new Map<string, any>();
  for (const pg of pgs) {
    const key = pgIdentityKey(pg);
    const existing = byKey.get(key);
    if (!existing || pgListPreferenceScore(pg) > pgListPreferenceScore(existing)) {
      byKey.set(key, pg);
    }
  }
  return [...byKey.values()];
}

type PgPatientStatusTone = "green" | "orange" | "red";

type PgWorkspacePatient = {
  patientId: string;
  patientName: string;
  ipNumber: string;
  wardBedNumber: string;
  department: string;
  unit: string;
  consultant: string;
  lastReviewAt: string | null;
  lastReviewLabel: string;
  statusLabel: string;
  statusTone: PgPatientStatusTone;
  isIcu: boolean;
  hoursSinceReview: number | null;
};

type PgCompletedCase = {
  patientId: string;
  patientName: string;
  ipNumber: string;
  wardBedNumber: string;
  department: string;
  unit: string;
  admissionStatus: string;
  dischargeStatus: string;
  diagnosis: string;
  completedAt: string;
};

type PgCompletedCasesGroup = {
  pgId: string;
  pgName: string;
  completedCount: number;
  cases: PgCompletedCase[];
};

function startOfLocalDay(date = new Date()): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function isWithinLocalToday(value: unknown): boolean {
  if (!value) return false;
  const d = new Date(value as string | number | Date);
  if (Number.isNaN(d.getTime())) return false;
  const start = startOfLocalDay();
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return d >= start && d < end;
}

function formatRelativeTimestamp(value: unknown): string {
  if (!value) return "No review yet";
  const d = new Date(value as string | number | Date);
  if (Number.isNaN(d.getTime())) return "No review yet";
  const diffMs = Date.now() - d.getTime();
  const mins = Math.max(0, Math.round(diffMs / 60000));
  if (mins < 1) return "Reviewed just now";
  if (mins < 60) return `Reviewed ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Reviewed ${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `Reviewed ${days} day${days === 1 ? "" : "s"} ago`;
}

function pgStatusMeta(tone: PgPatientStatusTone): { chip: string; accent: string; soft: string } {
  switch (tone) {
    case "red":
      return {
        chip: "bg-red-50 text-red-700 ring-1 ring-red-200/80",
        accent: "bg-red-500",
        soft: "border-red-200/80 bg-red-50/50",
      };
    case "orange":
      return {
        chip: "bg-amber-50 text-amber-700 ring-1 ring-amber-200/80",
        accent: "bg-amber-500",
        soft: "border-amber-200/80 bg-amber-50/50",
      };
    case "green":
    default:
      return {
        chip: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80",
        accent: "bg-emerald-500",
        soft: "border-emerald-200/80 bg-emerald-50/50",
      };
  }
}

function getPgPatientStatus(row: { isIcu?: boolean; hoursSinceReview?: number | null; status?: string }): {
  statusLabel: string;
  statusTone: PgPatientStatusTone;
} {
  if (row.isIcu || row.status === "ICU Critical") return { statusLabel: "Critical", statusTone: "red" };
  if (row.status === "Delayed Review" || row.hoursSinceReview == null || row.hoursSinceReview > 12) {
    return { statusLabel: "Pending Review", statusTone: "orange" };
  }
  return { statusLabel: "Active", statusTone: "green" };
}

const liveBoardCell = "w-max max-w-none whitespace-nowrap px-3 py-2.5 sm:px-4";
const liveBoardHeadCell = `${liveBoardCell} text-left text-xs font-semibold uppercase tracking-wide text-slate-600`;

function liveBoardStatusMeta(status: string | undefined, isIcu?: boolean): {
  label: string;
  chipClass: string;
  rowClass: string;
} {
  const normalized = String(status ?? "").trim();
  if (normalized === "Unassigned") {
    return {
      label: "Unassigned",
      chipClass: "bg-slate-100 text-slate-700 ring-1 ring-slate-200/80",
      rowClass: "bg-slate-50/50",
    };
  }
  if (normalized === "ICU Critical" || isIcu) {
    return {
      label: normalized === "ICU Critical" ? "ICU Critical" : "ICU",
      chipClass: "bg-rose-100 text-rose-800 ring-1 ring-rose-200/80",
      rowClass: "bg-rose-50/35",
    };
  }
  if (normalized === "Delayed Review") {
    return {
      label: "Delayed Review",
      chipClass: "bg-amber-100 text-amber-800 ring-1 ring-amber-200/80",
      rowClass: "bg-amber-50/30",
    };
  }
  return {
    label: normalized || "Active",
    chipClass: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200/80",
    rowClass: "",
  };
}

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

type WorkloadRow = {
  pgId: string;
  pgName: string;
  activePatients: number;
  icuPatients: number;
  activitiesToday: number;
  pendingNotes: number;
  delayedReviews: number;
  overloaded?: boolean;
  inactive?: boolean;
};

type WorkloadSortKey = "risk" | "activePatients" | "activitiesToday" | "delayedReviews" | "pendingNotes" | "pgName";

function workloadRiskScore(row: WorkloadRow): number {
  return (
    Number(row.activePatients || 0) * 2 +
    Number(row.icuPatients || 0) * 3 +
    Number(row.delayedReviews || 0) * 4 +
    Number(row.pendingNotes || 0) * 3 +
    (row.inactive ? 2 : 0) +
    (row.overloaded ? 4 : 0)
  );
}

function workloadRiskMeta(row: WorkloadRow): {
  label: "Low" | "Medium" | "High";
  loadLabel: string;
  badgeClass: string;
  fillClass: string;
  cardClass: string;
} {
  const score = workloadRiskScore(row);
  if (row.overloaded || score >= 22) {
    return {
      label: "High",
      loadLabel: "High Load",
      badgeClass: "bg-red-50 text-red-800 ring-1 ring-red-200/80",
      fillClass: "bg-red-500",
      cardClass: "border-red-200/90 bg-gradient-to-br from-red-50/50 to-white",
    };
  }
  if (score >= 10 || row.icuPatients > 0 || row.pendingNotes > 0 || row.delayedReviews > 0) {
    return {
      label: "Medium",
      loadLabel: "Medium Load",
      badgeClass: "bg-amber-50 text-amber-800 ring-1 ring-amber-200/80",
      fillClass: "bg-amber-500",
      cardClass: "border-amber-200/90 bg-gradient-to-br from-amber-50/40 to-white",
    };
  }
  return {
    label: "Low",
    loadLabel: "Low Load",
    badgeClass: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/80",
    fillClass: "bg-emerald-500",
    cardClass: "border-slate-200/80 bg-white",
  };
}

function PgWorkloadCard({ row }: { row: WorkloadRow }) {
  const risk = workloadRiskMeta(row);
  const patients = Number(row.activePatients) || 0;
  const icu = Number(row.icuPatients) || 0;
  const delayed = Number(row.delayedReviews) || 0;
  const pending = Number(row.pendingNotes) || 0;
  const activities = Number(row.activitiesToday) || 0;

  return (
    <article className={`rounded-2xl border p-4 shadow-[0_4px_20px_-8px_rgba(15,23,42,0.12)] ${risk.cardClass}`}>
      <h4 className="text-sm font-semibold leading-snug text-slate-900">{row.pgName}</h4>
      <ul className="mt-3 space-y-1.5 text-sm text-slate-700">
        <li>
          <span className="font-semibold tabular-nums text-slate-900">{patients}</span> Patient{patients === 1 ? "" : "s"}
        </li>
        {icu > 0 ? (
          <li>
            <span className="font-semibold tabular-nums text-slate-900">{icu}</span> ICU
          </li>
        ) : null}
        {delayed > 0 ? (
          <li>
            <span className="font-semibold tabular-nums text-slate-900">{delayed}</span> Delayed Review{delayed === 1 ? "" : "s"}
          </li>
        ) : null}
        {pending > 0 ? (
          <li>
            <span className="font-semibold tabular-nums text-slate-900">{pending}</span> Pending Note{pending === 1 ? "" : "s"}
          </li>
        ) : null}
        {activities > 0 ? (
          <li className="text-slate-500">
            <span className="tabular-nums">{activities}</span> activit{activities === 1 ? "y" : "ies"} today
          </li>
        ) : null}
        {patients === 0 && icu === 0 && delayed === 0 && pending === 0 ? (
          <li className="text-slate-500">No active assignments</li>
        ) : null}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold ${risk.badgeClass}`}>
          <span className={`h-2.5 w-2.5 rounded-full ${risk.fillClass}`} aria-hidden />
          {risk.loadLabel}
        </span>
        {row.overloaded ? (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-800">Overloaded</span>
        ) : null}
        {!row.overloaded && row.inactive ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">Quiet today</span>
        ) : null}
      </div>
    </article>
  );
}

function emptyWorkloadRow(pgId: string, pgName = ""): WorkloadRow {
  return {
    pgId: String(pgId),
    pgName,
    activePatients: 0,
    icuPatients: 0,
    activitiesToday: 0,
    pendingNotes: 0,
    delayedReviews: 0,
    overloaded: false,
    inactive: true,
  };
}

function WorkloadBar({ count, max, fillClass }: { count: number; max: number; fillClass: string }) {
  const segments = 8;
  const normalizedMax = Math.max(1, max);
  const filled = count <= 0 ? 0 : Math.max(1, Math.round((count / normalizedMax) * segments));
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5">
        {Array.from({ length: segments }).map((_, index) => (
          <span
            key={index}
            className={`h-3 w-2 rounded-sm ${index < filled ? fillClass : "bg-slate-200"}`}
            aria-hidden
          />
        ))}
      </div>
      <span className="min-w-6 text-xs font-semibold tabular-nums text-slate-700">{count}</span>
    </div>
  );
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

type AlertItem = {
  id: string;
  severity: "warning" | "info" | "critical";
  title: string;
  detail: string;
  actionLabel?: string;
  actionTo?: string;
};

function BellIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.6}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
      />
    </svg>
  );
}

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.6}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.6}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function LogOutIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.6}
      stroke="currentColor"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"
      />
    </svg>
  );
}

type LiveBoardRow = {
  patientId?: string;
  patientName?: string;
  ipNumber?: string;
  status?: string;
  hoursSinceReview?: number | null;
  isIcu?: boolean;
  assignedPgs?: Array<{ id?: string; name?: string; isPrimary?: boolean }>;
};

function isPgAssignedToRow(row: LiveBoardRow, pgId: string): boolean {
  return Array.isArray(row.assignedPgs) && row.assignedPgs.some((pg) => String(pg.id) === pgId);
}

function buildPgAlertItems(boardRows: unknown[], pgId: string, recentActivities: unknown[]): AlertItem[] {
  const items: AlertItem[] = [];
  const rows = (Array.isArray(boardRows) ? boardRows : []).filter((row) =>
    isPgAssignedToRow(row as LiveBoardRow, pgId),
  ) as LiveBoardRow[];

  if (rows.length === 0) {
    items.push({
      id: "no-patients",
      severity: "info",
      title: "No patients assigned to you yet",
      detail: "When your HOD assigns patients, they will appear here and on My Patients.",
      actionLabel: "My Patients",
      actionTo: "/my-patients",
    });
    return items;
  }

  const delayed = rows.filter((row) => row.status === "Delayed Review");
  if (delayed.length > 0) {
    const names = delayed
      .slice(0, 4)
      .map((row) => `${row.patientName || "Patient"} (IP ${row.ipNumber || "—"})`)
      .join(" · ");
    items.push({
      id: "delayed-review",
      severity: "critical",
      title: `${delayed.length} patient(s) need review`,
      detail: names + (delayed.length > 4 ? " · …" : ""),
      actionLabel: "My Patients",
      actionTo: "/my-patients",
    });
  }

  const icuCritical = rows.filter((row) => row.status === "ICU Critical");
  if (icuCritical.length > 0) {
    items.push({
      id: "icu-critical",
      severity: "critical",
      title: `${icuCritical.length} ICU patient(s) need attention`,
      detail: "Review ICU allocations and log a clinical activity as soon as possible.",
      actionLabel: "Log activity",
      actionTo: "/activity",
    });
  }

  const dueForRound = rows.filter(
    (row) => row.status === "Active" && (row.hoursSinceReview == null || Number(row.hoursSinceReview) > 8),
  );
  if (dueForRound.length > 0 && delayed.length === 0) {
    items.push({
      id: "pending-round",
      severity: "warning",
      title: `${dueForRound.length} patient(s) due for a round`,
      detail: "No activity logged in the last 8 hours on these assignments.",
      actionLabel: "Add activity",
      actionTo: "/activity",
    });
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const activitiesToday = (Array.isArray(recentActivities) ? recentActivities : []).filter((entry) => {
    const createdAt = new Date(String((entry as { createdAt?: string }).createdAt || ""));
    return !Number.isNaN(createdAt.getTime()) && createdAt >= startOfDay;
  }).length;
  if (activitiesToday === 0) {
    items.push({
      id: "no-activity-today",
      severity: "warning",
      title: "No activities logged today",
      detail: `You have ${rows.length} assigned patient(s) but no activity entries yet today.`,
      actionLabel: "Add activity",
      actionTo: "/activity",
    });
  }

  if (rows.length >= 10) {
    items.push({
      id: "high-load",
      severity: "warning",
      title: "High patient load",
      detail: `You are assigned to ${rows.length} active patients. Prioritise reviews and handoffs.`,
      actionLabel: "My Patients",
      actionTo: "/my-patients",
    });
  }

  return items;
}

/** Only urgent patient alerts count toward the PG bell badge — not reminders or info. */
const PG_BADGE_ALERT_IDS = new Set(["delayed-review", "icu-critical", "pending-round"]);

function pgAlertBadgeCount(items: AlertItem[]): number {
  return items.filter((item) => PG_BADGE_ALERT_IDS.has(item.id)).length;
}

function buildAlertItems(
  boardRows: unknown[],
  hisStatus: {
    enabled?: boolean;
    configured?: boolean;
    active?: boolean;
    queryBuilderConfigured?: boolean;
    sqlConfigured?: boolean;
  } | null,
): AlertItem[] {
  const items: AlertItem[] = [];
  const rows = Array.isArray(boardRows) ? boardRows : [];
  const unassigned = rows.filter((r) => (r as { status?: string })?.status === "Unassigned").length;
  if (unassigned > 0) {
    items.push({
      id: "unassigned-pg",
      severity: "warning",
      title: `${unassigned} patient(s) without PG assignment`,
      detail: "These admissions appear as unassigned on the live board until a Head of Department or Administrator assigns a postgraduate resident.",
      actionLabel: "Resident Allocation",
      actionTo: "/assignment",
    });
  }
  const hisReachable = Boolean(hisStatus?.active ?? hisStatus?.configured);
  if (hisReachable && !hisStatus?.enabled) {
    items.push({
      id: "his-disabled",
      severity: "info",
      title: "HIS connection is configured but disabled",
      detail: "Set HIS_ENABLED=true in backend .env to enable Admission Desk search via EMR Query Builder.",
    });
  }
  if (hisStatus?.enabled && !hisReachable) {
    items.push({
      id: "his-incomplete",
      severity: "warning",
      title: "HIS is enabled but not reachable",
      detail:
        "Check EMR_QUERY_BUILDER_URL (defaults to MAPIMS Query Builder). Direct SQL is optional via OP_IP_DB_* or BB_CONSTR.",
    });
  }
  return items;
}

function AlertsPanel({
  open,
  onClose,
  items,
  loading,
  variant = "ops",
}: {
  open: boolean;
  onClose: () => void;
  items: AlertItem[];
  loading: boolean;
  variant?: "pg" | "ops";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const ring: Record<AlertItem["severity"], string> = {
    warning: "border-amber-200/90 bg-amber-50/95 text-amber-950 shadow-sm shadow-amber-900/5",
    info: "border-sky-200/90 bg-sky-50/95 text-sky-950 shadow-sm shadow-sky-900/5",
    critical: "border-red-200/90 bg-red-50/95 text-red-950 shadow-sm shadow-red-900/5",
  };

  return (
    <div
      className="fixed inset-0 z-[55] flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4 pt-[10vh] backdrop-blur-[2px] sm:pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="alerts-panel-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="max-h-[min(82vh,560px)] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200/80 bg-white/95 p-6 shadow-[0_24px_64px_-12px_rgba(15,23,42,0.2)] backdrop-blur-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="alerts-panel-title" className="text-lg font-semibold tracking-tight text-slate-900">
              {variant === "pg" ? "My notifications" : "Alerts Panel"}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {variant === "pg"
                ? "Updates for your assigned patients, reviews due, and daily activity."
                : "Operational notices from the live board and integrations."}
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium text-teal-800 transition hover:bg-teal-50"
            onClick={onClose}
            aria-label="Close alerts"
          >
            Close
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">Press ESC or click outside to dismiss.</p>

        <div className="mt-5 border-t border-slate-100 pt-5">
          {loading ? (
            <p className="text-sm text-slate-600">Refreshing alerts…</p>
          ) : items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-600">
              {variant === "pg"
                ? "You're all caught up — no pending items on your patient list."
                : "No active alerts. Clinical workflows look clear from this snapshot."}
            </p>
          ) : (
            <ul className="space-y-3">
              {items.map((a) => (
                <li key={a.id} className={`rounded-xl border p-4 ${ring[a.severity]}`}>
                  <p className="text-sm font-semibold leading-snug">{a.title}</p>
                  <p className="mt-2 text-xs leading-relaxed opacity-95">{a.detail}</p>
                  {a.actionTo && a.actionLabel ? (
                    <div className="mt-3">
                      <NavLink
                        to={a.actionTo}
                        onClick={onClose}
                        className="inline-flex rounded-lg bg-white/90 px-3 py-1.5 text-xs font-semibold text-teal-900 shadow-sm ring-1 ring-teal-200/80 transition hover:bg-teal-50"
                      >
                        {a.actionLabel}
                      </NavLink>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

const navItems: NavItem[] = [
  { to: "/dashboard/pg", label: "Executive Dashboard", section: "Operations" },
  { to: "/masters", label: "Master Data Registry", section: "Administration", roles: ["Admin", "HOD"] },
  { to: "/audit-logs", label: "Audit Log Center", section: "Administration", roles: ["Admin", "MRD"] },
  {
    to: "/completed-cases-by-pg",
    label: "By allocated PG",
    section: "Completed Cases",
    roles: ["Admin", "HOD"],
  },
  { to: "/admission", label: "Admission Desk", section: "Clinical Flow" },
  { to: "/assignment", label: "Resident Allocation", section: "Clinical Flow", roles: ["Admin", "HOD"] },
  { to: "/activity", label: "Activity Console", section: "Clinical Flow" },
  { to: "/timeline", label: "Patient Timeline", section: "Clinical Flow" },
  { to: "/reports", label: "Report Center", section: "Analytics" },
  { to: "/mobile", label: "Mobility Extensions", section: "Extensions" },
];

const pgNavItems: NavItem[] = [
  { to: "/dashboard/pg", label: "Dashboard", section: "My Workspace" },
  { to: "/my-patients", label: "My Patients", section: "My Workspace" },
  { to: "/activity", label: "Activities", section: "My Workspace" },
  { to: "/timeline", label: "Patient Timeline", section: "My Workspace" },
  { to: "/completed-cases", label: "Completed Cases", section: "My Workspace" },
  { to: "/profile", label: "Profile", section: "My Workspace" },
];

function RequireRole({ roles, children }: { roles: UserRoleName[]; children: React.ReactElement }) {
  const user = useSelector((s: RootState) => s.auth.user);
  const role = user?.role as UserRoleName | undefined;
  if (!role || !roles.includes(role)) return <Navigate to="/dashboard/pg" replace />;
  return children;
}

function HeaderQuickSearch() {
  const navigate = useNavigate();
  const user = useSelector((s: RootState) => s.auth.user);
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
    if (user?.role === "PG" && user?._id) {
      void api
        .get("/assignments/live-board")
        .then((res) => {
          const rows = Array.isArray(res.data) ? res.data : [];
          const mine = rows
            .filter((row: any) => Array.isArray(row.assignedPgs) && row.assignedPgs.some((pg: any) => String(pg.id) === String(user._id)))
            .map((row: any) => ({
              _id: row.patientId,
              patientName: row.patientName,
              ipNumber: row.ipNumber,
            }));
          setPatients(mine);
          setPgs([]);
          setLoaded(true);
        })
        .catch(() => undefined);
      return;
    }
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
    user?.role === "PG" || needle.length === 0
      ? []
      : pgs
          .filter(
            (u) =>
              String(u.fullName || "").toLowerCase().includes(needle) || String(u.username || "").toLowerCase().includes(needle),
          )
          .slice(0, 6);

  return (
    <div ref={wrapRef} className="relative w-full md:w-auto">
      <input
        placeholder={user?.role === "PG" ? "Search my patients by name or IP…" : "Search patients & PGs…"}
        className={`${user?.role === "PG" ? "w-full sm:w-80" : "w-80"} rounded-full border border-slate-200/90 bg-white/90 px-4 py-2.5 text-sm shadow-inner shadow-slate-900/5 outline-none ring-teal-500/0 transition placeholder:text-slate-400 focus:border-teal-500/50 focus:bg-white focus:ring-4 focus:ring-teal-500/15`}
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
              <span className="font-medium text-slate-800">{pgDisplayName(u)}</span>
              <span className="text-slate-500"> · {pgMetaLabel(u) || `@${u.username}`}</span>
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

type MiniChartPoint = { label: string; value: number };

function MiniChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-5 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.08)] backdrop-blur-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function MiniTrendBars({
  points,
  fillClass,
  emptyLabel,
}: {
  points: MiniChartPoint[];
  fillClass: string;
  emptyLabel: string;
}) {
  const maxValue = Math.max(1, ...points.map((point) => Number(point.value) || 0));
  if (points.length === 0) {
    return <div className="text-sm text-slate-500">{emptyLabel}</div>;
  }
  return (
    <div>
      <div className="flex h-36 items-end gap-2">
        {points.map((point) => {
          const height = Math.max(8, Math.round(((Number(point.value) || 0) / maxValue) * 100));
          return (
            <div key={point.label} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2">
              <span className="text-[11px] font-medium tabular-nums text-slate-500">{point.value}</span>
              <div className="flex h-28 w-full items-end rounded-xl bg-slate-100/90 px-1.5 pb-1.5">
                <div
                  className={`w-full rounded-lg ${fillClass}`}
                  style={{ height: `${height}%` }}
                  title={`${point.label}: ${point.value}`}
                />
              </div>
              <span className="text-[11px] text-slate-500">{point.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MiniHorizontalBars({
  points,
  fillClass,
  emptyLabel,
}: {
  points: MiniChartPoint[];
  fillClass: string;
  emptyLabel: string;
}) {
  const rows = points.slice(0, 6);
  const maxValue = Math.max(1, ...rows.map((point) => Number(point.value) || 0));
  if (rows.length === 0) {
    return <div className="text-sm text-slate-500">{emptyLabel}</div>;
  }
  return (
    <div className="space-y-3">
      {rows.map((point) => (
        <div key={point.label}>
          <div className="mb-1 flex items-center justify-between gap-3 text-xs">
            <span className="truncate font-medium text-slate-700">{point.label}</span>
            <span className="tabular-nums text-slate-500">{point.value}</span>
          </div>
          <div className="h-2.5 rounded-full bg-slate-100">
            <div
              className={`h-2.5 rounded-full ${fillClass}`}
              style={{ width: `${Math.max(8, Math.round(((Number(point.value) || 0) / maxValue) * 100))}%` }}
              title={`${point.label}: ${point.value}`}
            />
          </div>
        </div>
      ))}
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

const HOSPITAL_EMBLEM_SRC = "/image/adhiparasakthi-hospitals-emblem.rgb-backup.png";

function HospitalBrandFooter({ centered = false }: { centered?: boolean }) {
  return (
    <div className={`flex items-center gap-3 ${centered ? "justify-center" : "px-2"}`}>
      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-teal-100 via-emerald-50 to-teal-200 p-1 shadow-sm ring-1 ring-teal-400/35">
        <img
          src={HOSPITAL_EMBLEM_SRC}
          alt=""
          className="h-full w-full object-contain"
          aria-hidden
        />
      </div>
      <p
        className={`text-[10px] font-bold uppercase leading-snug tracking-[0.12em] text-teal-200/95 md:text-[11px] ${centered ? "text-center" : ""}`}
      >
        Adhiparasakthi Hospital
      </p>
    </div>
  );
}

function MobileOpsNavDrawer({
  open,
  onClose,
  navBySection,
  userLabel,
  userRole,
}: {
  open: boolean;
  onClose: () => void;
  navBySection: [string, NavItem[]][];
  userLabel: string;
  userRole?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      id="mobile-ops-nav"
      className="fixed inset-0 z-[300] flex flex-col bg-gradient-to-b from-teal-950 via-teal-900 to-slate-950 md:hidden"
      aria-modal="true"
      role="dialog"
      aria-label="Navigation menu"
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 pb-4 pt-[max(0.875rem,env(safe-area-inset-top))]">
        <button
          type="button"
          className="inline-flex shrink-0 touch-manipulation items-center justify-center rounded-xl border border-white/15 bg-white/10 p-2.5 text-white transition hover:bg-white/15"
          onClick={onClose}
          aria-label="Close navigation menu"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-teal-300/85">Clinical Activity ERP</p>
          <p className="truncate text-base font-semibold text-white">{userLabel}</p>
          {userRole ? (
            <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-teal-200/90">{userRole}</p>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
        <SidebarNavSections navBySection={navBySection} isPgUser={false} onNavigate={onClose} />
      </div>
      <div className="shrink-0 border-t border-white/10 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <HospitalBrandFooter centered />
      </div>
    </div>,
    document.body,
  );
}

function SidebarNavSections({
  navBySection,
  isPgUser,
  onNavigate,
}: {
  navBySection: [string, NavItem[]][];
  isPgUser: boolean;
  onNavigate?: () => void;
}) {
  return (
    <>
      {navBySection.map(([section, items]) => (
        <div key={section} className="mb-5 last:mb-0">
          <p
            className={`px-2 pb-2 text-[10px] font-bold uppercase tracking-[0.14em] ${
              isPgUser ? "text-slate-400" : "text-teal-300/80"
            }`}
          >
            {section}
          </p>
          <ul className={isPgUser ? "space-y-1" : "space-y-0.5"}>
            {items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    isPgUser
                      ? `block rounded-2xl px-3 py-2.5 text-sm font-medium transition ${
                          isActive
                            ? "bg-teal-50 text-teal-900 ring-1 ring-teal-200/80"
                            : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                        }`
                      : `block rounded-xl px-3 py-2.5 text-sm font-medium transition ${
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
    </>
  );
}

function AppLayout({ children, title, subtitle }: { children: ReactNode; title: string; subtitle: string }) {
  const dispatch = useDispatch<AppDispatch>();
  const location = useLocation();
  const navigate = useNavigate();
  const user = useSelector((s: RootState) => s.auth.user);
  const [helpOpen, setHelpOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertItems, setAlertItems] = useState<AlertItem[]>([]);
  const [alertBadgeCount, setAlertBadgeCount] = useState(0);

  const refreshAlerts = useCallback(async () => {
    if (!user) return;
    try {
      const boardRes = await api.get("/assignments/live-board").catch(() => ({ data: [] }));
      const rows = Array.isArray(boardRes.data) ? boardRes.data : [];

      if (user.role === "PG" && user._id) {
        const activitiesRes = await api.get(`/pg-activities/${user._id}`).catch(() => ({ data: [] }));
        const items = buildPgAlertItems(rows, String(user._id), activitiesRes.data);
        setAlertItems(items);
        setAlertBadgeCount(pgAlertBadgeCount(items));
        return;
      }

      const hisRes = await api.get("/his/status").catch(() => ({ data: null }));
      const his = hisRes.data as { enabled?: boolean; configured?: boolean; active?: boolean } | null;
      const items = buildAlertItems(rows, his);
      setAlertItems(items);
      setAlertBadgeCount(items.length);
    } catch {
      setAlertItems([]);
      setAlertBadgeCount(0);
    }
  }, [user]);

  const isPgUser = user?.role === "PG";
  const visibleNavItems = useMemo(() => {
    if (isPgUser) return pgNavItems;
    const role = user?.role as UserRoleName | undefined;
    return navItems.filter((item) => !item.roles || (role && item.roles.includes(role)));
  }, [isPgUser, user?.role]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!user) return;
    void refreshAlerts();
    const id = window.setInterval(() => void refreshAlerts(), 120_000);
    return () => window.clearInterval(id);
  }, [user, refreshAlerts]);

  useEffect(() => {
    if (!alertsOpen) return;
    let cancelled = false;
    const run = async () => {
      setAlertsLoading(true);
      await refreshAlerts();
      if (!cancelled) setAlertsLoading(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [alertsOpen, refreshAlerts]);

  const navBySection = useMemo(() => {
    const grouped = new Map<string, NavItem[]>();
    visibleNavItems.forEach((item) => {
      if (!grouped.has(item.section)) grouped.set(item.section, []);
      grouped.get(item.section)?.push(item);
    });
    return Array.from(grouped.entries());
  }, [visibleNavItems]);

  return (
    <div className="flex min-h-screen flex-col text-slate-800">
      <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />
      <AlertsPanel
        open={alertsOpen}
        onClose={() => setAlertsOpen(false)}
        items={alertItems}
        loading={alertsLoading}
        variant={isPgUser ? "pg" : "ops"}
      />
      <button
        type="button"
        className={`fixed bottom-6 right-6 z-40 h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-700 to-teal-600 text-white shadow-lg shadow-teal-900/35 ring-2 ring-white/90 transition hover:from-teal-800 hover:to-teal-700 hover:shadow-xl focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-400/50 sm:bottom-8 sm:right-8 ${isPgUser ? "hidden md:flex" : mobileNavOpen ? "hidden" : "flex md:flex"}`}
        onClick={() => setAlertsOpen(true)}
        aria-label={isPgUser ? "Open my notifications" : "Open alerts panel"}
        aria-expanded={alertsOpen}
        title={isPgUser ? "My notifications" : "Alerts"}
      >
        <BellIcon className="h-7 w-7" />
        {alertBadgeCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold leading-none text-white shadow ring-2 ring-white">
            {alertBadgeCount > 9 ? "9+" : alertBadgeCount}
          </span>
        ) : null}
      </button>
      <header className="sticky top-0 z-30 shrink-0 border-b border-white/30 bg-white/75 shadow-sm shadow-slate-900/5 backdrop-blur-xl">
        <div className="mx-auto max-w-[1440px] px-4 py-3 md:px-8 md:py-3.5">
          <div className="flex items-center gap-2 md:gap-4">
            {!isPgUser ? (
              <button
                type="button"
                className="inline-flex shrink-0 touch-manipulation items-center justify-center rounded-xl border border-slate-200 bg-white/90 p-2.5 text-slate-700 shadow-sm transition hover:border-teal-200 hover:bg-teal-50/60 md:hidden"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open navigation menu"
                aria-expanded={mobileNavOpen}
                aria-controls="mobile-ops-nav"
              >
                <MenuIcon className="h-5 w-5" />
              </button>
            ) : null}
            <div
              className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-600 to-cyan-700 text-xs font-bold tracking-tight text-white shadow-md shadow-teal-900/30 sm:flex"
              aria-hidden
            >
              PG
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-base font-semibold tracking-tight text-slate-900 md:text-lg">Clinical Activity ERP</h1>
              <p className="hidden truncate text-[11px] text-slate-500 sm:block md:text-xs">
                {isPgUser ? "PG workspace · rounds · patient follow-up" : "Operations · residency · audit trail"}
              </p>
            </div>
            <div className="hidden min-w-[280px] flex-1 md:block lg:max-w-sm">
              <HeaderQuickSearch />
            </div>
            <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
              <button
                type="button"
                className="relative inline-flex items-center justify-center rounded-full border border-slate-200 bg-white/85 p-2.5 text-slate-700 shadow-sm transition hover:border-teal-200 hover:bg-teal-50/60 hover:text-teal-900"
                onClick={() => setAlertsOpen(true)}
                aria-label={isPgUser ? "Open my notifications" : "Open notifications"}
              >
                <BellIcon className="h-5 w-5" />
                {alertBadgeCount > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-0.5 text-[9px] font-bold leading-none text-white ring-2 ring-white">
                    {alertBadgeCount > 9 ? "9+" : alertBadgeCount}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                className="hidden rounded-full border border-slate-200 bg-white/80 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-teal-200 hover:bg-teal-50/60 hover:text-teal-900 md:inline-flex"
                onClick={() => setHelpOpen(true)}
              >
                Help
              </button>
              <button
                type="button"
                className="inline-flex rounded-full border border-slate-200 bg-white/80 p-2.5 text-slate-700 shadow-sm transition hover:border-teal-200 hover:bg-teal-50/60 hover:text-teal-900 md:hidden"
                onClick={() => setHelpOpen(true)}
                aria-label="Open help"
              >
                <span className="text-xs font-bold">?</span>
              </button>
              <div className="hidden items-center gap-2 rounded-full border border-slate-200/90 bg-slate-50/90 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-inner lg:flex">
                <span className="max-w-[140px] truncate">{user?.fullName || user?.username || "User"}</span>
                <span className="rounded-md bg-teal-100/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-900">
                  {user?.role || "—"}
                </span>
              </div>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white/85 p-2.5 text-slate-700 shadow-sm transition hover:border-red-200 hover:bg-red-50/70 hover:text-red-700 md:px-4 md:py-2"
                onClick={() => {
                  dispatch(clearAuth());
                  navigate("/login");
                }}
                aria-label="Log out"
                title="Log out"
              >
                {isPgUser ? (
                  <LogOutIcon className="h-5 w-5" />
                ) : (
                  <>
                    <span className="hidden text-sm font-medium text-slate-700 md:inline">Log out</span>
                    <LogOutIcon className="h-5 w-5 md:hidden" />
                  </>
                )}
              </button>
            </div>
          </div>
          <div className="mt-3 md:hidden">
            <HeaderQuickSearch />
          </div>
        </div>
      </header>
      {!isPgUser ? (
        <MobileOpsNavDrawer
          open={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          navBySection={navBySection}
          userLabel={user?.fullName || user?.username || "User"}
          userRole={user?.role}
        />
      ) : null}
      <div className={`mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-6 p-4 ${isPgUser ? "pb-[calc(7rem+env(safe-area-inset-bottom))]" : "pb-8"} md:flex-row md:items-stretch md:gap-8 md:p-8 ${isPgUser ? "md:pb-8" : ""}`}>
        {isPgUser ? (
          <nav className="hidden w-full shrink-0 md:sticky md:top-24 md:flex md:h-[calc(100dvh-6rem)] md:w-[260px] md:max-w-[260px] md:self-start md:flex-col md:overflow-hidden md:rounded-3xl md:border md:border-slate-200/80 md:bg-white/95 md:p-4 md:shadow-[0_12px_32px_-12px_rgba(15,23,42,0.14)]">
            <div className="rounded-2xl bg-gradient-to-r from-teal-600 to-cyan-600 px-4 py-4 text-white">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/85">PG Dashboard</p>
              <p className="mt-2 text-lg font-semibold">{user?.fullName || user?.username || "Resident"}</p>
              <p className="mt-1 text-xs text-white/80">Focused patient list, quick actions, and daily workflow.</p>
            </div>
            <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
              <SidebarNavSections navBySection={navBySection} isPgUser />
            </div>
          </nav>
        ) : (
          <nav className="hidden w-full shrink-0 flex-col rounded-2xl border border-teal-950/20 bg-gradient-to-b from-teal-950 via-teal-900 to-slate-950 p-4 shadow-xl shadow-teal-950/25 md:sticky md:top-24 md:flex md:h-[calc(100dvh-6rem)] md:w-[280px] md:max-w-[280px] md:self-start md:overflow-hidden">
            <div className="min-h-0 flex-1 space-y-0 overflow-y-auto md:overflow-y-auto">
              <SidebarNavSections navBySection={navBySection} isPgUser={false} />
            </div>
            <div className="mt-4 shrink-0 border-t border-white/10 pt-4">
              <HospitalBrandFooter />
            </div>
          </nav>
        )}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col space-y-5">
          <section className={`rounded-2xl border border-slate-200/70 bg-white/90 p-5 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.08)] backdrop-blur-sm md:p-6 ${isPgUser ? "bg-gradient-to-r from-white to-teal-50/35" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-900 md:text-2xl">{title}</h2>
                <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-600">{subtitle}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {isPgUser ? (
                  <>
                    {location.pathname !== "/my-patients" ? (
                      <button
                        type="button"
                        className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-teal-200 hover:bg-teal-50/70 hover:text-teal-900"
                        onClick={() => navigate("/my-patients")}
                      >
                        My Patients
                      </button>
                    ) : null}
                    {location.pathname !== "/activity" ? (
                      <button
                        type="button"
                        className="rounded-full bg-gradient-to-r from-teal-700 to-teal-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-teal-900/20 transition hover:from-teal-800 hover:to-teal-700"
                        onClick={() => navigate("/activity")}
                      >
                        Add Activity
                      </button>
                    ) : null}
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </div>
          </section>
          {children}
        </main>
      </div>
      {isPgUser ? (
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/80 bg-white/95 px-1 py-1.5 shadow-[0_-12px_32px_-20px_rgba(15,23,42,0.3)] backdrop-blur md:hidden pb-[max(0.375rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto grid max-w-xl grid-cols-6 gap-0.5">
            {[
              { to: "/dashboard/pg", label: "Home" },
              { to: "/my-patients", label: "Patients" },
              { to: "/activity", label: "Add" },
              { to: "/timeline", label: "Timeline" },
              { to: "/completed-cases", label: "Cases" },
              { to: "/profile", label: "Profile" },
            ].map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center rounded-xl px-1 py-2 text-[10px] font-semibold leading-tight transition sm:text-[11px] ${
                    isActive ? "bg-teal-50 text-teal-800" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
      ) : null}
    </div>
  );
}

function MastersPage() {
  const user = useSelector((s: RootState) => s.auth.user);
  const [departments, setDepartments] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [activityTypes, setActivityTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [activeCreateForm, setActiveCreateForm] = useState<"department" | "unit" | "activity" | null>(null);
  const [editingDepartmentId, setEditingDepartmentId] = useState<string | null>(null);
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [editingActivityTypeId, setEditingActivityTypeId] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pendingDeactivate, setPendingDeactivate] = useState<null | {
    kind: "department" | "unit" | "activity-type";
    id: string;
    name: string;
  }>(null);
  const [departmentForm, setDepartmentForm] = useState({
    name: "",
    code: "",
    hodName: "",
  });
  const [unitForm, setUnitForm] = useState({
    name: "",
    departmentId: "",
  });
  const [activityTypeForm, setActivityTypeForm] = useState({
    name: "",
    status: "Active",
  });

  const loadMasters = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [d, u, a] = await Promise.all([
        api.get("/departments", { params: { includeInactive: true } }),
        api.get("/units", { params: { includeInactive: true } }),
        api.get("/activity-types", { params: { includeInactive: true } }),
      ]);
      setDepartments(d.data || []);
      setUnits(u.data || []);
      setActivityTypes(a.data || []);
    } catch {
      setLoadError("Could not load master data. Check your session and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMasters();
  }, [loadMasters]);

  const resetFormState = () => {
    setEditingDepartmentId(null);
    setEditingUnitId(null);
    setEditingActivityTypeId(null);
  };

  const openDepartmentForm = (department?: any) => {
    setSubmitMessage("");
    setActiveCreateForm("department");
    setEditingUnitId(null);
    setEditingActivityTypeId(null);
    if (department) {
      setEditingDepartmentId(String(department._id));
      setDepartmentForm({
        name: department.name || "",
        code: department.code || "",
        hodName: department.hodName || "",
      });
      return;
    }
    setEditingDepartmentId(null);
    setDepartmentForm({ name: "", code: "", hodName: "" });
  };

  const openUnitForm = (unit?: any) => {
    setSubmitMessage("");
    setActiveCreateForm("unit");
    setEditingDepartmentId(null);
    setEditingActivityTypeId(null);
    if (unit) {
      setEditingUnitId(String(unit._id));
      setUnitForm({
        name: unit.name || "",
        departmentId: String(unit.departmentId?._id || unit.departmentId || ""),
      });
      return;
    }
    setEditingUnitId(null);
    setUnitForm({ name: "", departmentId: "" });
  };

  const openActivityTypeForm = (activityType?: any) => {
    setSubmitMessage("");
    setActiveCreateForm("activity");
    setEditingDepartmentId(null);
    setEditingUnitId(null);
    if (activityType) {
      setEditingActivityTypeId(String(activityType._id));
      setActivityTypeForm({
        name: activityType.name || "",
        status: activityType.status || "Active",
      });
      return;
    }
    setEditingActivityTypeId(null);
    setActivityTypeForm({ name: "", status: "Active" });
  };

  const submitDepartment = async () => {
    const name = departmentForm.name.trim();
    const code = (departmentForm.code.trim() || name.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase().slice(0, 12)).trim();
    if (!name || !code) {
      setSubmitMessage("Department name and code are required.");
      return;
    }
    setSubmitting(true);
    setSubmitMessage("");
    try {
      const payload = {
        name,
        code,
        hodName: departmentForm.hodName.trim() || undefined,
      };
      if (editingDepartmentId) await api.put(`/departments/${editingDepartmentId}`, payload);
      else await api.post("/departments", payload);
      setDepartmentForm({ name: "", code: "", hodName: "" });
      setActiveCreateForm(null);
      setSubmitMessage(`Department "${name}" ${editingDepartmentId ? "updated" : "created"}.`);
      resetFormState();
      await loadMasters();
    } catch (error: any) {
      setSubmitMessage(error?.response?.data?.message || `Could not ${editingDepartmentId ? "update" : "create"} department.`);
    } finally {
      setSubmitting(false);
    }
  };

  const submitUnit = async () => {
    const name = unitForm.name.trim();
    if (!name || !unitForm.departmentId) {
      setSubmitMessage("Unit name and department are required.");
      return;
    }
    setSubmitting(true);
    setSubmitMessage("");
    try {
      const payload = {
        name,
        departmentId: unitForm.departmentId,
      };
      if (editingUnitId) await api.put(`/units/${editingUnitId}`, payload);
      else await api.post("/units", payload);
      setUnitForm({ name: "", departmentId: "" });
      setActiveCreateForm(null);
      setSubmitMessage(`Unit "${name}" ${editingUnitId ? "updated" : "created"}.`);
      resetFormState();
      await loadMasters();
    } catch (error: any) {
      setSubmitMessage(error?.response?.data?.message || `Could not ${editingUnitId ? "update" : "create"} unit.`);
    } finally {
      setSubmitting(false);
    }
  };

  const submitActivityType = async () => {
    const name = activityTypeForm.name.trim();
    if (!name) {
      setSubmitMessage("Activity type name is required.");
      return;
    }
    setSubmitting(true);
    setSubmitMessage("");
    try {
      const payload = {
        name,
        status: activityTypeForm.status,
      };
      if (editingActivityTypeId) await api.put(`/activity-types/${editingActivityTypeId}`, payload);
      else await api.post("/activity-types", payload);
      setActivityTypeForm({ name: "", status: "Active" });
      setActiveCreateForm(null);
      setSubmitMessage(`Activity type "${name}" ${editingActivityTypeId ? "updated" : "created"}.`);
      resetFormState();
      await loadMasters();
    } catch (error: any) {
      setSubmitMessage(error?.response?.data?.message || `Could not ${editingActivityTypeId ? "update" : "create"} activity type.`);
    } finally {
      setSubmitting(false);
    }
  };

  const performStatusUpdate = async (kind: "department" | "unit" | "activity-type", id: string, nextStatus: "Active" | "Inactive") => {
    setSubmitting(true);
    setSubmitMessage("");
    try {
      const base = kind === "activity-type" ? "/activity-types" : kind === "department" ? "/departments" : "/units";
      await api.patch(`${base}/${id}/status`, { status: nextStatus });
      const label = kind === "activity-type" ? "Activity type" : `${kind[0].toUpperCase()}${kind.slice(1)}`;
      setSubmitMessage(`${label} marked ${nextStatus}.`);
      await loadMasters();
    } catch (error: any) {
      setSubmitMessage(error?.response?.data?.message || `Could not update ${kind} status.`);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStatus = async (
    kind: "department" | "unit" | "activity-type",
    id: string,
    currentStatus: string | undefined,
    name: string,
  ) => {
    const nextStatus = currentStatus === "Inactive" ? "Active" : "Inactive";
    if (nextStatus === "Inactive") {
      setPendingDeactivate({ kind, id, name });
      return;
    }
    await performStatusUpdate(kind, id, nextStatus);
  };

  return (
    <AppLayout title="Master Data Control" subtitle="Live registry from the API, with quick add and maintenance actions for department, unit, and activity setup.">
      {pendingDeactivate ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4 pt-[12vh] backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPendingDeactivate(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white/95 p-6 shadow-[0_24px_64px_-12px_rgba(15,23,42,0.18)] backdrop-blur-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold tracking-tight text-slate-900">Confirm deactivation</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Deactivate <span className="font-medium text-slate-900">{pendingDeactivate.name}</span>? This item will stay in
              the registry but become inactive until you activate it again.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className={uiBtnOutline} onClick={() => setPendingDeactivate(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-red-700 disabled:opacity-50"
                disabled={submitting}
                onClick={() => {
                  const target = pendingDeactivate;
                  setPendingDeactivate(null);
                  void performStatusUpdate(target.kind, target.id, "Inactive");
                }}
              >
                {submitting ? "Deactivating…" : "Deactivate"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {loading ? <div className="text-sm text-slate-500">Loading master data…</div> : null}
      {loadError ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{loadError}</div> : null}
      <div className="rounded-2xl border border-slate-200/70 bg-white/95 p-5 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Quick add master data</h3>
            <p className="mt-1 text-xs text-slate-500">
              Use these buttons when a required department, unit, or activity type is missing during workflow entry.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={uiBtnOutline} onClick={() => (activeCreateForm === "department" ? setActiveCreateForm(null) : openDepartmentForm())}>
              Add Department
            </button>
            <button type="button" className={uiBtnOutline} onClick={() => (activeCreateForm === "unit" ? setActiveCreateForm(null) : openUnitForm())}>
              Add Unit
            </button>
            <button type="button" className={uiBtnOutline} onClick={() => (activeCreateForm === "activity" ? setActiveCreateForm(null) : openActivityTypeForm())}>
              Add Activity Type
            </button>
          </div>
        </div>

        {activeCreateForm === "department" ? (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <input
              className={uiField}
              placeholder="Department name"
              value={departmentForm.name}
              onChange={(e) => setDepartmentForm((prev) => ({ ...prev, name: e.target.value }))}
            />
            <input
              className={uiField}
              placeholder="Code (auto if blank)"
              value={departmentForm.code}
              onChange={(e) => setDepartmentForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
            />
            <input
              className={uiField}
              placeholder="HOD name (optional)"
              value={departmentForm.hodName}
              onChange={(e) => setDepartmentForm((prev) => ({ ...prev, hodName: e.target.value }))}
            />
            <div className="md:col-span-3">
              <button type="button" className="rounded-lg bg-teal-700 px-4 py-2 text-sm text-white hover:bg-teal-800 disabled:opacity-50" onClick={() => void submitDepartment()} disabled={submitting}>
                {submitting ? "Saving…" : editingDepartmentId ? "Save Department" : "Create Department"}
              </button>
            </div>
          </div>
        ) : null}

        {activeCreateForm === "unit" ? (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <input
              className={uiField}
              placeholder="Unit name"
              value={unitForm.name}
              onChange={(e) => setUnitForm((prev) => ({ ...prev, name: e.target.value }))}
            />
            <select
              className={uiField}
              value={unitForm.departmentId}
              onChange={(e) => setUnitForm((prev) => ({ ...prev, departmentId: e.target.value }))}
            >
              <option value="">Select Department</option>
              {departments
                .filter((d: any) => d.status !== "Inactive")
                .map((d: any) => (
                  <option key={String(d._id)} value={String(d._id)}>
                    {d.name}
                  </option>
                ))}
            </select>
            <div className="flex items-end">
              <button type="button" className="rounded-lg bg-teal-700 px-4 py-2 text-sm text-white hover:bg-teal-800 disabled:opacity-50" onClick={() => void submitUnit()} disabled={submitting}>
                {submitting ? "Saving…" : editingUnitId ? "Save Unit" : "Create Unit"}
              </button>
            </div>
          </div>
        ) : null}

        {activeCreateForm === "activity" ? (
          <div className="mt-4 grid gap-3 md:grid-cols-[2fr_1fr_auto]">
            <input
              className={uiField}
              placeholder="Activity type name"
              value={activityTypeForm.name}
              onChange={(e) => setActivityTypeForm((prev) => ({ ...prev, name: e.target.value }))}
            />
            <select
              className={uiField}
              value={activityTypeForm.status}
              onChange={(e) => setActivityTypeForm((prev) => ({ ...prev, status: e.target.value }))}
            >
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
            <div className="flex items-end">
              <button type="button" className="rounded-lg bg-teal-700 px-4 py-2 text-sm text-white hover:bg-teal-800 disabled:opacity-50" onClick={() => void submitActivityType()} disabled={submitting}>
                {submitting ? "Saving…" : editingActivityTypeId ? "Save Activity Type" : "Create Activity Type"}
              </button>
            </div>
          </div>
        ) : null}

        {submitMessage ? <p className="mt-3 text-sm text-slate-600">{submitMessage}</p> : null}
        <p className="mt-2 text-xs text-slate-500">Logged in as {user?.role || "User"}.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <KPI title="Departments" value={departments.length} />
        <KPI title="Units" value={units.length} />
        <KPI title="Activity Types" value={activityTypes.length} />
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/95 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">Department Registry</div>
        <div className={uiTableScroll}>
        <table className="w-full min-w-[480px] text-sm">
          <thead className="bg-gradient-to-r from-slate-100 to-teal-50/35 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-2">Department</th>
              <th className="px-4 py-2">Code</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {departments.map((d: any) => (
              <tr key={String(d._id || d.code)} className="border-t border-slate-100">
                <td className="px-4 py-2">{d.name}</td>
                <td className="px-4 py-2">{d.code}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${d.status === "Inactive" ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>
                    {d.status}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={uiBtnOutlineSm} onClick={() => openDepartmentForm(d)}>Edit</button>
                    <button type="button" className={uiBtnOutlineSm} onClick={() => void toggleStatus("department", String(d._id), d.status, d.name)}>
                      {d.status === "Inactive" ? "Activate" : "Deactivate"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <p className={uiTableSwipeHint}>Swipe horizontally to see all columns.</p>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/95 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">Unit Mapping</div>
        <div className={uiTableScroll}>
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-gradient-to-r from-slate-100 to-teal-50/35 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-2">Unit</th>
              <th className="px-4 py-2">Department</th>
              <th className="px-4 py-2">Consultant</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {units.map((u: any) => (
              <tr key={`${String(u._id)}`} className="border-t border-slate-100">
                <td className="px-4 py-2">{u.name}</td>
                <td className="px-4 py-2">{u.departmentId?.name || u.departmentId || "—"}</td>
                <td className="px-4 py-2">{u.consultantId?.fullName || u.consultantId || "—"}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${u.status === "Inactive" ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>
                    {u.status || "Active"}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={uiBtnOutlineSm} onClick={() => openUnitForm(u)}>Edit</button>
                    <button type="button" className={uiBtnOutlineSm} onClick={() => void toggleStatus("unit", String(u._id), u.status, u.name)}>
                      {u.status === "Inactive" ? "Activate" : "Deactivate"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <p className={uiTableSwipeHint}>Swipe horizontally to see all columns.</p>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/95 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">Activity types</div>
        <div className={uiTableScroll}>
        <table className="w-full min-w-[360px] text-sm">
          <thead className="bg-gradient-to-r from-slate-100 to-teal-50/35 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {activityTypes.map((t: any) => (
              <tr key={String(t._id)} className="border-t border-slate-100">
                <td className="px-4 py-2">{t.name}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${t.status === "Inactive" ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>
                    {t.status || "Active"}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={uiBtnOutlineSm} onClick={() => openActivityTypeForm(t)}>Edit</button>
                    <button type="button" className={uiBtnOutlineSm} onClick={() => void toggleStatus("activity-type", String(t._id), t.status, t.name)}>
                      {t.status === "Inactive" ? "Activate" : "Deactivate"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <p className={uiTableSwipeHint}>Swipe horizontally to see all columns.</p>
      </div>
    </AppLayout>
  );
}

function ageFromIsoDateString(ymd: string): string {
  if (!ymd || ymd.length < 10) return "";
  const birth = new Date(`${ymd.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(birth.getTime())) return "";
  const t = new Date();
  let age = t.getFullYear() - birth.getFullYear();
  const m = t.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < birth.getDate())) age -= 1;
  return String(Math.max(0, age));
}

function mapHisGenderToForm(sex: string): string {
  const x = (sex || "").toUpperCase();
  if (x === "M" || x === "MALE" || x === "1") return "Male";
  if (x === "F" || x === "FEMALE" || x === "2") return "Female";
  return "Other";
}

const HIS_SEARCH_PAGE_SIZE = 50;

function buildHisPageList(current: number, total: number): (number | "gap")[] {
  if (total <= 12) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total, current, current - 1, current + 1, current - 2, current + 2]);
  const ordered = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const result: (number | "gap")[] = [];
  for (let i = 0; i < ordered.length; i++) {
    if (i > 0 && ordered[i] - ordered[i - 1] > 1) result.push("gap");
    result.push(ordered[i]);
  }
  return result;
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

  const [hisActive, setHisActive] = useState(false);
  const [hisSearch, setHisSearch] = useState({
    reg_no: "",
    name: "",
    date_from: "",
    date_to: "",
    visit_type: "IP" as "IP" | "OP" | "all",
  });
  const [hisRows, setHisRows] = useState<any[]>([]);
  const [hisCounts, setHisCounts] = useState<{ ip: number; op: number; total: number; showing: number } | null>(
    null,
  );
  const [hisPage, setHisPage] = useState(1);
  const [hisTotalPages, setHisTotalPages] = useState(1);
  const [hisLoading, setHisLoading] = useState(false);
  const [hisError, setHisError] = useState("");
  const [hisApplyLoading, setHisApplyLoading] = useState(false);
  const [hisDeptSnapshot, setHisDeptSnapshot] = useState<{ dept_name: string; dept_id: string } | null>(null);

  useEffect(() => {
    void Promise.all([api.get("/departments"), api.get("/units")])
      .then(([d, u]) => {
        setDepartments(d.data || []);
        setUnits(u.data || []);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void api
      .get("/his/status")
      .then((r) => setHisActive(Boolean(r.data?.active)))
      .catch(() => setHisActive(false));
  }, []);

  const runHisSearch = async (page = 1) => {
    setHisError("");
    setHisLoading(true);
    setHisRows([]);
    setHisCounts(null);
    try {
      const { data } = await api.post("/his/search", {
        reg_no: hisSearch.reg_no.trim(),
        name: hisSearch.name.trim(),
        date_from: hisSearch.date_from.trim(),
        date_to: hisSearch.date_to.trim(),
        visit_type: hisSearch.visit_type,
        page,
        page_size: HIS_SEARCH_PAGE_SIZE,
      });
      const rows = Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : [];
      const counts = Array.isArray(data)
        ? {
            ip: rows.filter((r: { type?: string }) => r.type === "IP").length,
            op: rows.filter((r: { type?: string }) => r.type === "OP").length,
            total: rows.length,
            showing: rows.length,
          }
        : {
            ip: Number(data?.counts?.ip ?? 0),
            op: Number(data?.counts?.op ?? 0),
            total: Number(data?.counts?.total ?? 0),
            showing: Number(data?.showing ?? rows.length),
          };
      const totalPages = Array.isArray(data) ? 1 : Math.max(1, Number(data?.totalPages ?? 1));
      const currentPage = Array.isArray(data) ? 1 : Math.max(1, Number(data?.page ?? page));
      setHisRows(rows);
      setHisCounts(counts.total > 0 ? counts : null);
      setHisPage(currentPage);
      setHisTotalPages(totalPages);
      if (counts.total === 0) {
        setHisError("No matching HIS rows. Try IP/OP number, name, or a date range.");
      }
    } catch (e: any) {
      setHisError(e?.response?.data?.message || "HIS search failed.");
      setHisRows([]);
      setHisCounts(null);
      setHisPage(1);
      setHisTotalPages(1);
    } finally {
      setHisLoading(false);
    }
  };

  const applyHisRow = async (row: any) => {
    setHisApplyLoading(true);
    try {
      let resolveError = "";
      setHisDeptSnapshot({
        dept_name: String(row?.dept_name ?? "").trim(),
        dept_id: String(row?.dept_id ?? "").trim(),
      });
      const visitNo = String(row?.visit_id ?? row?.reg_no ?? "").trim();
      const nm = String(row?.c_pat_name ?? row?.name ?? "").trim();
      const dob = String(row?.d_dob ?? "").trim();
      let resolvedId = "";
      let deptLabel = "";
      try {
        const { data } = await api.post("/departments/resolve-from-his", {
          dept_name: row?.dept_name ?? "",
          dept_id: row?.dept_id ?? "",
        });
        if (data?.departmentId) {
          resolvedId = data.departmentId;
          deptLabel = data.name || "";
        }
      } catch (e: any) {
        resolveError =
          e?.response?.data?.message ||
          "Could not map HIS department from this row. You can still create admission if you select department manually.";
      }
      setForm((prev) => ({
        ...prev,
        ipNumber: visitNo || prev.ipNumber,
        patientName: nm || prev.patientName,
        age: dob ? ageFromIsoDateString(dob) : prev.age,
        gender: mapHisGenderToForm(String(row?.c_sex ?? "")),
        departmentId: resolvedId || prev.departmentId,
        unitId: resolvedId ? "" : prev.unitId,
      }));
      if (resolvedId) {
        try {
          const r = await api.get("/departments");
          setDepartments(r.data || []);
        } catch {
          /* keep existing list */
        }
      }
      const typ = row?.type === "IP" ? "IP" : "OP";
      if (resolvedId) {
        setMessage(`HIS data applied (${typ}). Department from HIS: ${deptLabel}.`);
      } else if (resolveError) {
        setMessage(`${resolveError}`);
      } else if (String(row?.dept_name || row?.dept_id)) {
        setMessage(
          `HIS patient applied (${typ}). Department was not linked — select department in the form, then create admission.`,
        );
      } else {
        setMessage(
          `HIS patient applied (${typ}). This HIS row has no department — select department manually, then create admission.`,
        );
      }
    } finally {
      setHisApplyLoading(false);
    }
  };

  const submit = async () => {
    try {
      const hasDept =
        Boolean(form.departmentId?.trim()) ||
        Boolean(hisDeptSnapshot?.dept_name || hisDeptSnapshot?.dept_id);
      if (!form.ipNumber?.trim() || !form.patientName?.trim()) {
        setMessage("IP number and patient name are required.");
        return;
      }
      if (!hasDept) {
        setMessage("Department is required: use a HIS row with department data, or choose department manually.");
        return;
      }
      await api.post("/admission", {
        patient: {
          ipNumber: form.ipNumber.trim(),
          patientName: form.patientName.trim(),
          age: Number(form.age || 40),
          gender: form.gender,
        },
        admission: {
          admissionDate: new Date(),
          wardBedNumber: form.wardBedNumber || "W-12",
          departmentId: form.departmentId?.trim() || undefined,
          unitId: form.unitId || undefined,
        },
        his_dept_name: hisDeptSnapshot?.dept_name,
        his_dept_id: hisDeptSnapshot?.dept_id,
      });
      setMessage("Admission created successfully.");
      setHisDeptSnapshot(null);
      setForm((prev) => ({ ...prev, ipNumber: "", patientName: "", departmentId: "", unitId: "" }));
    } catch (error: any) {
      const apiMessage = error?.response?.data?.message;
      setMessage(apiMessage ? `Admission failed: ${apiMessage}` : "Admission failed. Please retry.");
    }
  };
  return (
    <AppLayout title="Patient Admission" subtitle="Search patient from HIS or create a new admission manually.">
      <section className="rounded-2xl border border-slate-200/70 bg-white/95 p-5 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm">
        {hisActive ? (
          <div className="border-b border-slate-200/80 pb-5">
            <h3 className="text-sm font-semibold text-slate-900">Search patient</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <input
              className={uiField}
              placeholder="IP / OP registration no."
              value={hisSearch.reg_no}
              onChange={(e) => setHisSearch((s) => ({ ...s, reg_no: e.target.value }))}
            />
            <input
              className={uiField}
              placeholder="Patient name (optional)"
              value={hisSearch.name}
              onChange={(e) => setHisSearch((s) => ({ ...s, name: e.target.value }))}
            />
            <input
              className={uiField}
              type="date"
              value={hisSearch.date_from}
              onChange={(e) => setHisSearch((s) => ({ ...s, date_from: e.target.value }))}
            />
            <input
              className={uiField}
              type="date"
              value={hisSearch.date_to}
              onChange={(e) => setHisSearch((s) => ({ ...s, date_to: e.target.value }))}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <select
              className={uiFieldCompact}
              value={hisSearch.visit_type}
              onChange={(e) =>
                setHisSearch((s) => ({ ...s, visit_type: e.target.value as "IP" | "OP" | "all" }))
              }
            >
              <option value="IP">Visit type: IP (inpatient)</option>
              <option value="OP">Visit type: OP</option>
              <option value="all">Visit type: IP + OP</option>
            </select>
            <button
              type="button"
              disabled={hisLoading}
              className="rounded-lg bg-teal-800 px-4 py-2 text-sm font-medium text-white hover:bg-teal-900 disabled:opacity-50"
              onClick={() => {
                setHisPage(1);
                void runHisSearch(1);
              }}
            >
              {hisLoading ? "Searching…" : "Search HIS"}
            </button>
          </div>
          {hisError ? <p className="mt-2 text-sm text-amber-800">{hisError}</p> : null}
          {hisRows.length > 0 ? (
            <div className="mt-3 max-h-56 overflow-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="sticky top-0 bg-slate-100 font-semibold text-slate-700">
                  <tr>
                    <th className="px-2 py-2">Type</th>
                    <th className="px-2 py-2">Reg / visit</th>
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2">DOB</th>
                    <th className="px-2 py-2">Dept</th>
                    <th className="px-2 py-2">Admission</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {hisRows.map((row, i) => (
                    <tr key={`${row.patient_id}-${row.visit_id}-${i}`} className="border-t border-slate-100">
                      <td className="px-2 py-1.5">{row.type}</td>
                      <td className="px-2 py-1.5 font-mono">{row.visit_id}</td>
                      <td className="px-2 py-1.5">{row.c_pat_name}</td>
                      <td className="px-2 py-1.5">{row.d_dob}</td>
                      <td className="px-2 py-1.5">{row.dept_name || row.dept_id}</td>
                      <td className="px-2 py-1.5 text-slate-600">{row.admission}</td>
                      <td className="px-2 py-1.5">
                        <button
                          type="button"
                          disabled={hisApplyLoading}
                          className={uiBtnOutlineSm}
                          onClick={() => void applyHisRow(row)}
                        >
                          {hisApplyLoading ? "Applying…" : "Use for admission"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-slate-100 px-2 py-1.5 text-[10px] text-slate-500 md:hidden">Swipe horizontally to see all columns.</p>
            </div>
          ) : null}
          {hisCounts && hisTotalPages > 1 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={hisLoading || hisPage <= 1}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                onClick={() => void runHisSearch(hisPage - 1)}
              >
                Previous
              </button>
              {buildHisPageList(hisPage, hisTotalPages).map((item, idx) =>
                item === "gap" ? (
                  <span key={`gap-${idx}`} className="px-1 text-xs text-slate-400">
                    …
                  </span>
                ) : (
                  <button
                    key={item}
                    type="button"
                    disabled={hisLoading}
                    className={`min-w-[2rem] rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                      item === hisPage
                        ? "bg-teal-800 text-white"
                        : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    } disabled:opacity-50`}
                    onClick={() => void runHisSearch(item)}
                  >
                    {item}
                  </button>
                ),
              )}
              <button
                type="button"
                disabled={hisLoading || hisPage >= hisTotalPages}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                onClick={() => void runHisSearch(hisPage + 1)}
              >
                Next
              </button>
              <span className="text-xs text-slate-500">
                Page {hisPage} of {hisTotalPages}
              </span>
            </div>
          ) : null}
          {hisCounts ? (
            <p className="mt-2 text-sm text-slate-600">
              <span className="font-semibold text-slate-800">IP:</span> {hisCounts.ip.toLocaleString()}
              <span className="mx-2 text-slate-300">|</span>
              <span className="font-semibold text-slate-800">OP:</span> {hisCounts.op.toLocaleString()}
              <span className="mx-2 text-slate-300">|</span>
              <span className="font-semibold text-slate-800">Total:</span> {hisCounts.total.toLocaleString()}
              {hisTotalPages > 1 ? (
                <span className="text-slate-500">
                  {" "}
                  · {hisCounts.showing.toLocaleString()} on this page ({HIS_SEARCH_PAGE_SIZE} per page)
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
        ) : null}

        <div className={hisActive ? "pt-5" : ""}>
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Admission details</h3>
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
            <option value="">
              {hisDeptSnapshot ? "Department (from HIS if empty)" : "Select Department *"}
            </option>
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
              .filter(
                (u) =>
                  u.status !== "Inactive" &&
                  (!form.departmentId || String(u.departmentId?._id || u.departmentId) === form.departmentId),
              )
              .map((u) => (
                <option key={u._id} value={u._id}>{u.name}</option>
              ))}
          </select>
        </div>
          <button
            type="button"
            className="mt-4 rounded-xl bg-gradient-to-r from-teal-700 to-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-teal-900/20 transition hover:from-teal-800 hover:to-teal-700"
            onClick={() => void submit()}
          >
            Create Admission
          </button>
          {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
        </div>
      </section>
    </AppLayout>
  );
}

function ResidentAllocationPgCard({
  pg,
  workload,
  selected,
  onSelect,
}: {
  pg: any;
  workload: WorkloadRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const department = pgDepartmentName(pg);
  const displayName = pgDisplayName(pg);
  const showDepartmentLine = Boolean(department && !pgNameShowsDepartment(displayName, department));
  const yearLabel = pgYearLabel(pg);
  const risk = workloadRiskMeta(workload);
  const patientCount = Number(workload.activePatients) || 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-teal-500/30 ${
        selected
          ? "border-teal-500 bg-teal-50/90 shadow-sm ring-1 ring-teal-500/20"
          : "border-slate-200 bg-white hover:border-teal-200 hover:bg-teal-50/35"
      }`}
      aria-pressed={selected}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold text-slate-900">{displayName}</span>
        {yearLabel ? (
          <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">{yearLabel}</span>
        ) : null}
        {selected ? (
          <span className="shrink-0 rounded-full bg-teal-600 px-2 py-0.5 text-[11px] font-semibold text-white">Selected</span>
        ) : null}
      </div>
      {showDepartmentLine ? (
        <p className="mt-1 truncate text-xs text-slate-500">{department}</p>
      ) : (
        <p className="mt-1 truncate text-xs text-slate-500">{pg.username ? `@${pg.username}` : yearLabel || "PG"}</p>
      )}
      <div className="mt-2 flex items-center gap-2 border-t border-slate-100/90 pt-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${risk.fillClass}`} title={`${risk.label} workload`} aria-hidden />
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${risk.badgeClass}`}>{risk.label}</span>
        <span className="min-w-0 flex-1 text-[11px] text-slate-600">
          {patientCount} active patient{patientCount === 1 ? "" : "s"}
          {workload.icuPatients > 0 ? ` · ${workload.icuPatients} ICU` : ""}
        </span>
      </div>
    </button>
  );
}

function formatAdmissionCompact(value: unknown): string {
  if (value == null || value === "") return "—";
  const d = new Date(value as string | number | Date);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ResidentAllocationPatientCard({
  row,
  selected,
  onSelect,
}: {
  row: any;
  selected: boolean;
  onSelect: () => void;
}) {
  const ward = row.wardBedNumber?.trim() || "—";
  const dept = row.department?.trim() || "—";
  const admitted = formatAdmissionCompact(row.admissionDate);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-lg border px-2 py-1.5 text-left transition focus:outline-none focus:ring-2 focus:ring-teal-500/30 ${
        selected
          ? "border-teal-500 bg-teal-50/90 ring-1 ring-teal-500/20"
          : "border-slate-200 bg-white hover:border-teal-200 hover:bg-teal-50/35"
      }`}
      aria-pressed={selected}
    >
      <div className="flex items-center justify-between gap-1.5">
        <span className="min-w-0 truncate text-xs font-semibold leading-tight text-slate-900">{row.patientName ?? "Patient"}</span>
        <div className="flex shrink-0 items-center gap-0.5">
          {row.isIcu ? (
            <span className="rounded bg-rose-100 px-1 py-px text-[9px] font-bold uppercase text-rose-800">ICU</span>
          ) : null}
          {selected ? <span className="rounded bg-teal-600 px-1 py-px text-[9px] font-semibold text-white">✓</span> : null}
        </div>
      </div>
      <p className="mt-0.5 truncate text-[10px] leading-snug text-slate-500">
        IP {row.ipNumber ?? "—"} · {ward} · {dept}
      </p>
      <p className="mt-0.5 flex items-center justify-between gap-1 text-[10px] leading-snug">
        <span className="min-w-0 truncate tabular-nums text-slate-500">{admitted}</span>
        <span className="shrink-0 font-medium text-amber-700">Unassigned</span>
      </p>
    </button>
  );
}

function AssignmentPage() {
  const [board, setBoard] = useState<any[]>([]);
  const [pgs, setPgs] = useState<any[]>([]);
  const [workloadByPgId, setWorkloadByPgId] = useState<Map<string, WorkloadRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [historyPatientId, setHistoryPatientId] = useState("");
  const [historyRows, setHistoryRows] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [patientSearch, setPatientSearch] = useState("");
  const [pgSearch, setPgSearch] = useState("");
  const [pgYearFilter, setPgYearFilter] = useState("");
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
      const [b, g, w] = await Promise.all([
        api.get("/assignments/live-board"),
        api.get("/pg"),
        api.get("/monitoring/workload-matrix"),
      ]);
      setBoard(b.data || []);
      setPgs(g.data || []);
      const matrix = Array.isArray(w.data) ? (w.data as WorkloadRow[]) : [];
      const map = new Map<string, WorkloadRow>();
      for (const row of matrix) map.set(String(row.pgId), row);
      setWorkloadByPgId(map);
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
  const normalizedPatientSearch = patientSearch.trim().toLowerCase();
  const normalizedPgSearch = pgSearch.trim().toLowerCase();
  const pgYearOptions = useMemo(
    () =>
      Array.from(
        new Set(
          pgs
            .map((pg) => Number(pg.yearOfResidency))
            .filter((year) => Number.isFinite(year) && year > 0),
        ),
      ).sort((a, b) => a - b),
    [pgs],
  );
  const filteredUnassigned = unassigned.filter((row) => {
    if (!normalizedPatientSearch) return true;
    const values = [row.patientName, row.ipNumber, row.patientId, row.wardBedNumber, row.department]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());
    return values.some((value) => value.includes(normalizedPatientSearch));
  });
  const selectedPatientRow = form.patientId
    ? board.find((row) => String(row.patientId) === form.patientId)
    : null;
  const patientDeptName = String(selectedPatientRow?.department || "").trim();

  const filteredPgs = pgs
    .filter((pg) => {
      const matchesYear = !pgYearFilter || String(pg.yearOfResidency || "") === pgYearFilter;
      const values = [pg.fullName, pg.email, pg.username, pgDepartmentName(pg)]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());
      const matchesSearch =
        !normalizedPgSearch || values.some((value) => textMatchesPgSearch(value, normalizedPgSearch));
      const matchesDept =
        !patientDeptName || departmentsAlign(patientDeptName, pgDepartmentName(pg));
      return matchesYear && matchesSearch && matchesDept;
    })
    .sort((a, b) => pgDisplayName(a).localeCompare(pgDisplayName(b), undefined, { sensitivity: "base" }));
  const dedupedPgs = dedupePgListByIdentity(filteredPgs);
  const pgFilterActive = Boolean(normalizedPgSearch || pgYearFilter);
  const selectedPg = pgs.find((g) => String(g._id) === form.pgId);
  const workloadForPg = (pgId: string, pgName: string) =>
    workloadByPgId.get(String(pgId)) ?? emptyWorkloadRow(pgId, pgName);

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
          Patients must already be admitted. Pick an unassigned patient and a PG, set shift options below, then{" "}
          <span className="font-medium text-slate-700">Assign</span>.
        </p>

        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200/90 bg-slate-50/40">
          <div className="grid grid-cols-1 divide-y divide-slate-200 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
            <div className="flex min-h-[min(320px,48vh)] flex-col p-3">
              <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 pb-1.5">
                <span className="text-[11px] font-semibold tracking-wider text-slate-600">UNASSIGNED PATIENTS</span>
                <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-700">
                  {loading ? "…" : normalizedPatientSearch ? `${filteredUnassigned.length}/${unassigned.length}` : unassigned.length}
                </span>
              </div>
              <input
                type="search"
                className={`${uiFieldCompact} mt-2 max-w-none`}
                value={patientSearch}
                onChange={(e) => setPatientSearch(e.target.value)}
                placeholder="Search patient or IP"
              />
              <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5 [-ms-overflow-style:none] [scrollbar-width:thin]">
                {loading ? (
                  <p className="text-[11px] text-slate-500">Loading patients…</p>
                ) : unassigned.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 bg-white/80 px-2 py-4 text-center text-[11px] text-slate-500">
                    No unassigned patients on the board. Admit from Admission Desk or release an assignment below.
                  </p>
                ) : filteredUnassigned.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 bg-white/80 px-2 py-4 text-center text-[11px] text-slate-500">
                    No patients match this search.
                  </p>
                ) : (
                  filteredUnassigned.map((row) => {
                    const id = String(row.patientId);
                    const selected = form.patientId === id;
                    return (
                      <ResidentAllocationPatientCard
                        key={id}
                        row={row}
                        selected={selected}
                        onSelect={() => setForm((prev) => ({ ...prev, patientId: id }))}
                      />
                    );
                  })
                )}
              </div>
            </div>

            <div className="flex min-h-[min(280px,42vh)] flex-col p-4">
              <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 pb-2">
                <div>
                  <span className="text-[11px] font-semibold tracking-wider text-slate-600">AVAILABLE PGs</span>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {patientDeptName
                      ? `Showing PGs in ${patientDeptName}. Pick a patient first to narrow the list.`
                      : "Filter by name, department, or year. Colour shows current workload."}
                  </p>
                </div>
                <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-700">
                  {loading ? "…" : pgFilterActive ? `${dedupedPgs.length}/${pgs.length}` : dedupedPgs.length}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  className={`${uiFieldCompact} max-w-none flex-1`}
                  value={pgSearch}
                  onChange={(e) => setPgSearch(e.target.value)}
                  placeholder="Search name or department"
                />
                <select
                  className={`${uiFieldCompact} max-w-none w-[140px]`}
                  value={pgYearFilter}
                  onChange={(e) => setPgYearFilter(e.target.value)}
                >
                  <option value="">All Years</option>
                  {pgYearOptions.map((year) => (
                    <option key={year} value={String(year)}>
                      Year {year}
                    </option>
                  ))}
                </select>
                {pgFilterActive ? (
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-600 transition hover:border-teal-200 hover:text-teal-700"
                    onClick={() => {
                      setPgSearch("");
                      setPgYearFilter("");
                    }}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
              <div className="mt-3 max-h-[420px] min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1 [scrollbar-width:thin]">
                {loading ? (
                  <p className="text-xs text-slate-500">Loading PGs…</p>
                ) : pgs.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 bg-white/80 px-3 py-6 text-center text-xs text-slate-500">
                    No postgraduate users found. Add PG accounts under Master Data.
                  </p>
                ) : dedupedPgs.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 bg-white/80 px-3 py-6 text-center text-xs text-slate-500">
                    {patientDeptName
                      ? `No PGs found for ${patientDeptName}. Add residents under Master Data or choose another patient.`
                      : "No PGs match the current filters."}
                  </p>
                ) : (
                  dedupedPgs.map((pg) => {
                    const id = String(pg._id);
                    const selected = form.pgId === id;
                    return (
                      <ResidentAllocationPgCard
                        key={id}
                        pg={pg}
                        workload={workloadForPg(id, pgDisplayName(pg))}
                        selected={selected}
                        onSelect={() => setForm((prev) => ({ ...prev, pgId: id }))}
                      />
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>

        {(form.patientId || form.pgId) && (
          <p className={uiInfoBar}>
            <span className="font-medium text-slate-800">Selection:</span>{" "}
            {form.patientId
              ? (unassigned.find((r) => String(r.patientId) === form.patientId)?.patientName ?? "Patient")
              : "—"}{" "}
            <span className="text-slate-400">→</span>{" "}
            {form.pgId && selectedPg ? pgOptionLabel(selectedPg) : "—"}
          </p>
        )}

        <div className="mt-4 grid gap-3 sm:max-w-md">
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
          <button
            type="button"
            disabled={!form.patientId || !form.pgId}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void assign()}
          >
            Assign
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
                    <td className="px-3 py-2">
                      {typeof h.pgId === "object" && h.pgId?.fullName
                        ? h.pgId.fullName
                        : pgDisplayName(pgs.find((pg) => String(pg._id) === String(h.pgId)) || {}) || "—"}
                    </td>
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
        <div className={uiTableScroll}>
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-gradient-to-r from-slate-100 to-teal-50/35 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-2">Patient</th>
              <th className="px-4 py-2">Ward</th>
              <th className="px-4 py-2">Department</th>
              <th className="px-4 py-2">Admitted</th>
              <th className="px-4 py-2">Assigned PGs</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {board.map((row) => (
              <tr key={row.patientId} className="border-t border-slate-100">
                <td className="px-4 py-2">
                  <div className="font-medium text-slate-900">{row.patientName ?? "—"}</div>
                  <div className="text-xs text-slate-500">IP {row.ipNumber ?? "—"}</div>
                  {row.isIcu ? (
                    <span className="mt-1 inline-block rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-800">
                      ICU
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2 text-slate-700">{row.wardBedNumber ?? "—"}</td>
                <td className="px-4 py-2 text-slate-700">{row.department ?? "—"}</td>
                <td className="px-4 py-2 text-xs tabular-nums text-slate-600">
                  {row.admissionDate
                    ? new Date(row.admissionDate).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
                    : "—"}
                </td>
                <td className="px-4 py-2">
                  {(row.assignedPgs || []).map((p: any) => `${p.name}${p.isPrimary ? " (P)" : ""}`).join(", ") || "-"}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-1 text-xs ${
                      row.status === "Unassigned"
                        ? "bg-red-50 text-red-700"
                        : row.status === "ICU Critical"
                          ? "bg-rose-50 text-rose-700"
                          : "bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {row.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <p className={uiTableSwipeHint}>Swipe horizontally to see all columns.</p>
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

function PgSummaryCard({
  title,
  value,
  subtitle,
  tone,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  tone: PgPatientStatusTone;
}) {
  const meta = pgStatusMeta(tone);
  return (
    <div className={`rounded-3xl border p-5 shadow-[0_8px_30px_-16px_rgba(15,23,42,0.16)] ${meta.soft}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{value}</div>
      <p className="mt-2 text-sm text-slate-600">{subtitle}</p>
    </div>
  );
}

function PgPatientCard({
  row,
  busy,
  onOpenTimeline,
  onAddNote,
  onMarkReviewed,
}: {
  row: PgWorkspacePatient;
  busy?: boolean;
  onOpenTimeline: () => void;
  onAddNote: () => void;
  onMarkReviewed: () => void;
}) {
  const tone = pgStatusMeta(row.statusTone);
  return (
    <article className="rounded-3xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_8px_24px_-16px_rgba(15,23,42,0.16)]">
      <div className="flex items-start gap-3">
        <div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${tone.accent}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-slate-900">{row.patientName}</h3>
              <p className="mt-1 text-sm text-slate-500">IP {row.ipNumber}</p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone.chip}`}>{row.statusLabel}</span>
          </div>
          <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
            <div>
              <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Ward</span>
              <p className="mt-1">{row.wardBedNumber}</p>
            </div>
            <div>
              <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Department</span>
              <p className="mt-1">{row.department}</p>
            </div>
            <div>
              <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Unit</span>
              <p className="mt-1">{row.unit}</p>
            </div>
            <div>
              <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Last Review</span>
              <p className="mt-1">{row.lastReviewLabel}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={uiBtnOutlineSm} onClick={onOpenTimeline}>
              Open Timeline
            </button>
            <button type="button" className={uiBtnOutlineSm} onClick={onAddNote}>
              Add Note
            </button>
            <button
              type="button"
              className="rounded-lg bg-teal-700 px-3 py-1 text-xs font-semibold text-white transition hover:bg-teal-800 disabled:opacity-50"
              onClick={onMarkReviewed}
              disabled={busy}
            >
              {busy ? "Saving..." : "Mark Reviewed"}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function usePgWorkspaceData(pgId?: string) {
  const [stats, setStats] = useState<Record<string, any>>({});
  const [patients, setPatients] = useState<PgWorkspacePatient[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [completedCases, setCompletedCases] = useState<PgCompletedCase[]>([]);
  const [activityTypes, setActivityTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!pgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [statsRes, boardRes, activitiesRes, completedRes, typesRes, patientRes] = await Promise.all([
        api.get(`/dashboard/pg/${pgId}`),
        api.get("/assignments/live-board"),
        api.get(`/pg-activities/${pgId}`),
        api.get(`/dashboard/pg/${pgId}/completed-cases`),
        api.get("/activity-types"),
        api.get("/patients?limit=200&page=1"),
      ]);

      const patientNameById = new Map<string, { patientName?: string; ipNumber?: string }>(
        ((patientRes.data?.data || []) as any[]).map((row) => [String(row._id), row]),
      );
      const mine = (Array.isArray(boardRes.data) ? boardRes.data : [])
        .filter((row: any) => Array.isArray(row.assignedPgs) && row.assignedPgs.some((pg: any) => String(pg.id) === String(pgId)))
        .map((row: any) => {
          const statusMeta = getPgPatientStatus(row);
          return {
            patientId: String(row.patientId),
            patientName: row.patientName || "Unknown Patient",
            ipNumber: row.ipNumber || "—",
            wardBedNumber: row.wardBedNumber || "—",
            department: row.department || "—",
            unit: row.unit || "—",
            consultant: row.consultant || "—",
            lastReviewAt: row.lastActivityAt || null,
            lastReviewLabel: formatRelativeTimestamp(row.lastActivityAt),
            statusLabel: statusMeta.statusLabel,
            statusTone: statusMeta.statusTone,
            isIcu: Boolean(row.isIcu),
            hoursSinceReview: typeof row.hoursSinceReview === "number" ? row.hoursSinceReview : null,
          } as PgWorkspacePatient;
        })
        .sort((a: PgWorkspacePatient, b: PgWorkspacePatient) => {
          const rank = { red: 0, orange: 1, green: 2 };
          return rank[a.statusTone] - rank[b.statusTone] || a.patientName.localeCompare(b.patientName);
        });

      const recent = (Array.isArray(activitiesRes.data) ? activitiesRes.data : []).map((row: any) => ({
        ...row,
        patientName: patientNameById.get(String(row.patientId))?.patientName || "Patient",
        ipNumber: patientNameById.get(String(row.patientId))?.ipNumber || "—",
      }));

      setStats(statsRes.data || {});
      setPatients(mine);
      setActivities(recent);
      setCompletedCases(Array.isArray(completedRes.data) ? completedRes.data : []);
      setActivityTypes(typesRes.data || []);
    } catch {
      setError("Unable to load your PG workspace right now. Please refresh and try again.");
    } finally {
      setLoading(false);
    }
  }, [pgId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const todayActivities = useMemo(
    () =>
      activities
        .filter((row) => isWithinLocalToday(row.createdAt))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [activities],
  );

  const reviewActivityTypeId = useMemo(() => {
    const preferred = ["Consultant Round", "ICU Review", "Progress Note"];
    for (const name of preferred) {
      const match = activityTypes.find((row: any) => String(row.name).toLowerCase() === name.toLowerCase());
      if (match?._id) return String(match._id);
    }
    return "";
  }, [activityTypes]);

  const noteActivityTypeId = useMemo(() => {
    const preferred = ["Progress Note", "Consultant Round"];
    for (const name of preferred) {
      const match = activityTypes.find((row: any) => String(row.name).toLowerCase() === name.toLowerCase());
      if (match?._id) return String(match._id);
    }
    return "";
  }, [activityTypes]);

  return {
    stats,
    patients,
    todayActivities,
    completedCases,
    loading,
    error,
    refresh,
    reviewActivityTypeId,
    noteActivityTypeId,
  };
}

function MyPatientsPage() {
  const navigate = useNavigate();
  const user = useSelector((s: RootState) => s.auth.user);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [message, setMessage] = useState("");
  const [busyPatientId, setBusyPatientId] = useState("");
  const { patients, loading, error, refresh, reviewActivityTypeId, noteActivityTypeId } = usePgWorkspaceData(user?._id);

  const filteredPatients = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return patients.filter((row) => {
      const matchesSearch =
        !needle ||
        [row.patientName, row.ipNumber, row.wardBedNumber, row.department, row.unit]
          .filter(Boolean)
          .map((value) => String(value).toLowerCase())
          .some((value) => value.includes(needle));
      const matchesStatus = statusFilter === "All" || row.statusLabel === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [patients, search, statusFilter]);

  const handleMarkReviewed = async (row: PgWorkspacePatient) => {
    if (!user?._id || !reviewActivityTypeId) {
      setMessage("A review activity type is not configured yet.");
      return;
    }
    setBusyPatientId(row.patientId);
    setMessage("");
    try {
      await api.post("/activity", {
        patientId: row.patientId,
        pgId: user._id,
        activityTypeId: reviewActivityTypeId,
        remarks: "Quick review completed from PG dashboard.",
      });
      setMessage(`Review recorded for ${row.patientName}.`);
      await refresh();
    } catch {
      setMessage("Could not mark the patient as reviewed right now.");
    } finally {
      setBusyPatientId("");
    }
  };

  return (
    <AppLayout title="My Patients" subtitle="Only your allocated patients are shown here, with the fastest actions used during rounds.">
      <section className="rounded-3xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_10px_28px_-18px_rgba(15,23,42,0.18)]">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
          <input
            className={uiField}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patient, IP, ward, department, or unit"
          />
          <select className={uiField} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="All">All statuses</option>
            <option value="Active">Active</option>
            <option value="Pending Review">Pending Review</option>
            <option value="Critical">Critical</option>
          </select>
        </div>
        {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
      </section>
      {loading ? <div className="rounded-2xl border border-slate-200/70 bg-white/95 p-4 text-sm text-slate-500">Loading your patients…</div> : null}
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {!loading && !error && filteredPatients.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/95 p-6 text-center text-sm text-slate-500">
          No allocated patients match the current filters.
        </div>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        {filteredPatients.map((row) => (
          <PgPatientCard
            key={row.patientId}
            row={row}
            busy={busyPatientId === row.patientId}
            onOpenTimeline={() => navigate(`/timeline?patient=${row.patientId}`)}
            onAddNote={() =>
              navigate(
                `/activity?patient=${encodeURIComponent(row.patientId)}${noteActivityTypeId ? `&activityTypeId=${encodeURIComponent(noteActivityTypeId)}` : ""}&preset=note`,
              )
            }
            onMarkReviewed={() => void handleMarkReviewed(row)}
          />
        ))}
      </div>
    </AppLayout>
  );
}

function CompletedCasesPage() {
  const user = useSelector((s: RootState) => s.auth.user);
  const { completedCases, loading, error } = usePgWorkspaceData(user?._id);

  return (
    <AppLayout title="Completed Cases" subtitle="Patients discharged in HIS appear here automatically for PGs who were allocated to them.">
      {loading ? <div className="rounded-2xl border border-slate-200/70 bg-white/95 p-4 text-sm text-slate-500">Loading completed cases…</div> : null}
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {!loading && !error && completedCases.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/95 p-6 text-center text-sm text-slate-500">
          No completed cases are available for your PG profile yet.
        </div>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        {completedCases.map((row) => (
          <article key={`${row.patientId}-${row.completedAt}`} className="rounded-3xl border border-slate-200/80 bg-white/95 p-5 shadow-[0_10px_28px_-18px_rgba(15,23,42,0.18)]">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-slate-900">{row.patientName}</h3>
                <p className="mt-1 text-sm text-slate-500">IP {row.ipNumber}</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200/80">
                {row.dischargeStatus}
              </span>
            </div>
            <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
              <div>
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Department</span>
                <p className="mt-1">{row.department}</p>
              </div>
              <div>
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Unit</span>
                <p className="mt-1">{row.unit}</p>
              </div>
              <div>
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Ward</span>
                <p className="mt-1">{row.wardBedNumber}</p>
              </div>
              <div>
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Completed</span>
                <p className="mt-1">{formatTimelineDate(row.completedAt)}</p>
              </div>
            </div>
            <div className="mt-4 rounded-2xl bg-slate-50 px-3 py-3 text-sm text-slate-700">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Diagnosis</div>
              <p className="mt-1">{row.diagnosis || "—"}</p>
            </div>
          </article>
        ))}
      </div>
    </AppLayout>
  );
}

function ProfilePage() {
  const navigate = useNavigate();
  const user = useSelector((s: RootState) => s.auth.user);
  const [pgRow, setPgRow] = useState<any>(null);

  useEffect(() => {
    if (!user?._id) return;
    void api
      .get("/pg")
      .then((res) => {
        const row = (res.data || []).find((entry: any) => String(entry._id) === String(user._id));
        setPgRow(row || null);
      })
      .catch(() => undefined);
  }, [user?._id]);

  return (
    <AppLayout title="Profile" subtitle="Quick profile snapshot for your PG login and clinical workspace context.">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="rounded-3xl border border-slate-200/80 bg-white/95 p-6 shadow-[0_10px_28px_-18px_rgba(15,23,42,0.18)]">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-600 to-cyan-600 text-lg font-bold text-white">
              {String(user?.fullName || user?.username || "P").slice(0, 1).toUpperCase()}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">{user?.fullName || user?.username || "PG User"}</h3>
              <p className="mt-1 text-sm text-slate-500">@{user?.username || "pg"}</p>
            </div>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Role</div>
              <div className="mt-1 text-sm font-medium text-slate-800">{user?.role || "PG"}</div>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Department</div>
              <div className="mt-1 text-sm font-medium text-slate-800">{pgDepartmentName(pgRow) || "—"}</div>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Year of Study</div>
              <div className="mt-1 text-sm font-medium text-slate-800">{pgYearLabel(pgRow) || "—"}</div>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Contact</div>
              <div className="mt-1 text-sm font-medium text-slate-800">{pgRow?.email || `@${user?.username || "pg"}`}</div>
            </div>
          </div>
        </section>
        <section className="rounded-3xl border border-slate-200/80 bg-white/95 p-6 shadow-[0_10px_28px_-18px_rgba(15,23,42,0.18)]">
          <h3 className="text-sm font-semibold text-slate-900">Quick Access</h3>
          <div className="mt-4 space-y-2">
            <button type="button" className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-medium text-slate-700 transition hover:border-teal-200 hover:bg-teal-50/40" onClick={() => navigate("/my-patients")}>
              Open My Patients
            </button>
            <button type="button" className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-medium text-slate-700 transition hover:border-teal-200 hover:bg-teal-50/40" onClick={() => navigate("/activity")}>
              Add New Activity
            </button>
            <button type="button" className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-medium text-slate-700 transition hover:border-teal-200 hover:bg-teal-50/40" onClick={() => navigate("/completed-cases")}>
              Review Completed Cases
            </button>
          </div>
        </section>
      </div>
    </AppLayout>
  );
}

function ActivityPage() {
  const [searchParams] = useSearchParams();
  const user = useSelector((s: RootState) => s.auth.user);
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
  const [recentActivities, setRecentActivities] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [patientsLoaded, setPatientsLoaded] = useState(false);
  const isPgUser = user?.role === "PG";
  const loggedInPgLabel =
    user?.fullName ||
    pgs.find((pg) => String(pg._id) === String(user?._id))?.fullName ||
    user?.username ||
    "Current PG";

  useEffect(() => {
    const shouldLoadAssignedBoard = Boolean(isPgUser && user?._id);
    setPatientsLoaded(false);
    void Promise.all([
      api.get("/patients"),
      api.get("/pg"),
      api.get("/activity-types"),
      shouldLoadAssignedBoard ? api.get("/assignments/live-board") : Promise.resolve({ data: [] }),
      shouldLoadAssignedBoard ? api.get(`/pg-activities/${user?._id}`) : Promise.resolve({ data: [] }),
    ])
      .then(([p, g, t, board, recent]) => {
        const pgRows = g.data || [];
        let patientRows = p.data.data || [];
        setPgs(pgRows);
        setActivityTypes(t.data || []);

        if (shouldLoadAssignedBoard) {
          patientRows = (Array.isArray(board.data) ? board.data : [])
            .filter((row: any) => Array.isArray(row.assignedPgs) && row.assignedPgs.some((pg: any) => String(pg.id) === String(user?._id)))
            .map((row: any) => ({
              _id: row.patientId,
              patientName: row.patientName,
              ipNumber: row.ipNumber,
            }));
          setPatients(patientRows);
        } else {
          setPatients(patientRows);
        }
        setRecentActivities(
          (Array.isArray(recent.data) ? recent.data : []).map((row: any) => ({
            ...row,
            patientName: patientRows.find((entry: any) => String(entry._id) === String(row.patientId))?.patientName || "Patient",
            ipNumber: patientRows.find((entry: any) => String(entry._id) === String(row.patientId))?.ipNumber || "—",
          })),
        );
        setPatientsLoaded(true);
      })
      .catch(() => setPatientsLoaded(true));
  }, [isPgUser, user?._id]);

  useEffect(() => {
    if (isPgUser && user?._id) {
      setForm((prev) => ({ ...prev, pgId: String(user._id) }));
    } else {
      const pgId = searchParams.get("pg")?.trim();
      if (pgId) setForm((prev) => ({ ...prev, pgId }));
    }
  }, [isPgUser, searchParams, user?._id]);

  useEffect(() => {
    const patientId = searchParams.get("patient")?.trim();
    if (patientId) setForm((prev) => ({ ...prev, patientId }));
  }, [searchParams]);

  useEffect(() => {
    const queryTypeId = searchParams.get("activityTypeId")?.trim();
    const preset = searchParams.get("preset")?.trim().toLowerCase();
    if (queryTypeId) {
      setForm((prev) => ({ ...prev, activityTypeId: queryTypeId }));
      return;
    }
    if (!preset || activityTypes.length === 0) return;
    const preferredNames = preset === "note" ? ["Progress Note", "Consultant Round"] : ["Consultant Round", "ICU Review", "Progress Note"];
    const match = preferredNames
      .map((name) => activityTypes.find((row: any) => String(row.name).toLowerCase() === name.toLowerCase()))
      .find(Boolean);
    if (match?._id) {
      setForm((prev) => ({ ...prev, activityTypeId: String(match._id) }));
    }
  }, [activityTypes, searchParams]);

  useEffect(() => {
    if (!isPgUser) return;
    if (!patientsLoaded) return;
    if (!form.patientId) return;
    if (patients.some((patient) => String(patient._id) === String(form.patientId))) return;
    setForm((prev) => ({ ...prev, patientId: "" }));
  }, [form.patientId, isPgUser, patients, patientsLoaded]);

  const submitActivity = async (advanceToNext = false) => {
    try {
      await api.post("/activity", {
        patientId: form.patientId,
        pgId: form.pgId,
        activityTypeId: form.activityTypeId,
        activityDateTime: form.activityDateTime,
        remarks: form.remarks || "No remarks",
      });
      const currentPatientIndex = patients.findIndex((patient) => String(patient._id) === String(form.patientId));
      const nextPatientId =
        advanceToNext && currentPatientIndex >= 0 && currentPatientIndex < patients.length - 1
          ? String(patients[currentPatientIndex + 1]?._id || "")
          : form.patientId;
      const currentPatientName = patients.find((patient) => String(patient._id) === String(form.patientId))?.patientName || "Patient";
      const nextPatientName =
        advanceToNext && nextPatientId && nextPatientId !== form.patientId
          ? patients.find((patient) => String(patient._id) === nextPatientId)?.patientName || "next patient"
          : "";

      setMessage(
        advanceToNext
          ? nextPatientId !== form.patientId
            ? `Activity saved for ${currentPatientName}. Moved to ${nextPatientName}.`
            : `Activity saved for ${currentPatientName}. No next patient in the current list.`
          : "Activity submitted successfully.",
      );
      setForm((prev) => ({
        ...prev,
        patientId: advanceToNext ? nextPatientId : prev.patientId,
        remarks: "",
        activityDateTime: toDateTimeLocalValue(new Date()),
      }));
      if (isPgUser && user?._id) {
        const recent = await api.get(`/pg-activities/${user._id}`);
        setRecentActivities(
          (Array.isArray(recent.data) ? recent.data : []).map((row: any) => ({
            ...row,
            patientName: patients.find((entry: any) => String(entry._id) === String(row.patientId))?.patientName || "Patient",
            ipNumber: patients.find((entry: any) => String(entry._id) === String(row.patientId))?.ipNumber || "—",
          })),
        );
      }
    } catch {
      setMessage("Activity submission failed. Ensure patient and PG have active assignment.");
    }
  };

  const todaysActivities = recentActivities.filter((row) => isWithinLocalToday(row.createdAt));

  return (
    <AppLayout title="Activities" subtitle="Quick clinical logging designed for rounds, follow-ups, and bedside updates.">
      {isPgUser ? (
        <div className="grid gap-4 md:grid-cols-3">
          <PgSummaryCard title="Assigned Patients" value={patients.length} subtitle="Patients currently assigned to you" tone="green" />
          <PgSummaryCard title="Today’s Activities" value={todaysActivities.length} subtitle="Clinical actions logged in your shift today" tone="orange" />
          <PgSummaryCard title="Quick Entry" value={searchParams.get("preset")?.trim() ? "Preset" : "Manual"} subtitle="Use presets from Dashboard or enter activity directly" tone="green" />
        </div>
      ) : null}
      <div className="rounded-3xl border border-slate-200/70 bg-white/95 shadow-[0_6px_28px_-12px_rgba(15,23,42,0.08)] backdrop-blur-sm p-5">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <select
            className={uiField}
            value={form.patientId}
            onChange={(e) => setForm((prev) => ({ ...prev, patientId: e.target.value }))}
          >
            <option value="">{isPgUser ? "Select Your Assigned Patient" : "Select Patient"}</option>
            {patients.map((p) => (
              <option key={p._id} value={p._id}>{p.patientName} ({p.ipNumber})</option>
            ))}
          </select>
          {isPgUser ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-900">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Logged in as</div>
              <div className="mt-1 font-medium">{loggedInPgLabel}</div>
            </div>
          ) : (
            <select
              className={uiField}
              value={form.pgId}
              onChange={(e) => setForm((prev) => ({ ...prev, pgId: e.target.value }))}
            >
              <option value="">Select PG</option>
              {pgs.map((pg) => (
                <option key={pg._id} value={pg._id}>{pgOptionLabel(pg)}</option>
              ))}
            </select>
          )}
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
        {isPgUser ? (
          <p className="mt-3 text-xs text-slate-500">
            Only patients currently assigned to you are shown here. Dashboard shortcuts can prefill note or review activity types.
          </p>
        ) : null}
        <textarea
          className={uiTextarea("mt-3 h-24")}
          placeholder="Clinical remarks or short bedside update"
          value={form.remarks}
          onChange={(e) => setForm((prev) => ({ ...prev, remarks: e.target.value }))}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="rounded-lg bg-teal-700 px-4 py-2 text-sm text-white hover:bg-teal-800" onClick={() => void submitActivity(false)}>
            Submit
          </button>
          <button className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-medium text-teal-800 hover:bg-teal-100" onClick={() => void submitActivity(true)}>
            Submit &amp; Next
          </button>
        </div>
        {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
      </div>
      {isPgUser ? (
        <section className="rounded-3xl border border-slate-200/80 bg-white/95 p-5 shadow-[0_8px_24px_-16px_rgba(15,23,42,0.12)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Today’s Clinical Activities</h3>
              <p className="mt-1 text-xs text-slate-500">Your most recent notes, reviews, and clinical actions from today.</p>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{todaysActivities.length}</span>
          </div>
          {todaysActivities.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-center text-sm text-slate-500">
              No activities logged yet today.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {todaysActivities.slice(0, 6).map((row: any) => (
                <div key={String(row._id)} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200/70 bg-slate-50/70 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-slate-900">{row.activityType || "Activity"}</div>
                    <div className="mt-1 text-xs text-slate-500">{formatTimelineDate(row.createdAt)}</div>
                  </div>
                  <span className="max-w-xs truncate text-right text-xs text-slate-500">{row.remarks || "No remarks"}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </AppLayout>
  );
}

function PGDashboardPage() {
  const navigate = useNavigate();
  const user = useSelector((s: RootState) => s.auth.user);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [busyPatientId, setBusyPatientId] = useState("");
  const { stats, patients, todayActivities, completedCases, loading, error, refresh, reviewActivityTypeId, noteActivityTypeId } =
    usePgWorkspaceData(user?._id);

  const filteredPatients = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return patients.filter((row) => {
      if (!needle) return true;
      return [row.patientName, row.ipNumber, row.wardBedNumber, row.department, row.statusLabel]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase())
        .some((value) => value.includes(needle));
    });
  }, [patients, search]);

  const handleMarkReviewed = async (row: PgWorkspacePatient) => {
    if (!user?._id || !reviewActivityTypeId) {
      setMessage("A review activity type is not configured yet.");
      return;
    }
    setBusyPatientId(row.patientId);
    setMessage("");
    try {
      await api.post("/activity", {
        patientId: row.patientId,
        pgId: user._id,
        activityTypeId: reviewActivityTypeId,
        remarks: "Quick review completed from PG dashboard.",
      });
      setMessage(`Review recorded for ${row.patientName}.`);
      await refresh();
    } catch {
      setMessage("Could not mark the patient as reviewed right now.");
    } finally {
      setBusyPatientId("");
    }
  };

  return (
    <AppLayout title="PG Dashboard" subtitle="Your live clinical workspace for rounds, assigned patients, pending follow-ups, and daily activity.">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <PgSummaryCard title="My Patients" value={patients.length} subtitle="Allocated patients under your care" tone="green" />
        <PgSummaryCard title="Today’s Reviews" value={Number(stats.activitiesToday ?? todayActivities.length)} subtitle="Clinical activities logged in the current day" tone="green" />
        <PgSummaryCard title="Pending Notes" value={Number(stats.pendingTasks ?? 0)} subtitle="Progress notes still flagged as delayed" tone="orange" />
        <PgSummaryCard title="ICU Patients" value={patients.filter((row) => row.isIcu).length} subtitle="Patients needing higher-frequency follow-up" tone="red" />
      </div>
      {loading ? <div className="rounded-2xl border border-slate-200/70 bg-white/95 p-4 text-sm text-slate-500">Loading your dashboard…</div> : null}
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
      {message ? <div className="rounded-xl border border-slate-200 bg-white/95 p-4 text-sm text-slate-600">{message}</div> : null}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.95fr)]">
        <section className="rounded-3xl border border-slate-200/80 bg-white/95 p-5 shadow-[0_10px_28px_-18px_rgba(15,23,42,0.18)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">My Allocated Patients</h3>
              <p className="mt-1 text-sm text-slate-500">Review, document, and open timelines without leaving your duty workflow.</p>
            </div>
            <button type="button" className={uiBtnOutlineSm} onClick={() => navigate("/my-patients")}>
              View All
            </button>
          </div>
          <div className="mt-4">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search patient, IP, ward, department, or status"
              className={uiField}
            />
          </div>
          {filteredPatients.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-500">
              No allocated patients match your current search.
            </div>
          ) : (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {filteredPatients.slice(0, 6).map((row) => (
                <PgPatientCard
                  key={row.patientId}
                  row={row}
                  busy={busyPatientId === row.patientId}
                  onOpenTimeline={() => navigate(`/timeline?patient=${row.patientId}`)}
                  onAddNote={() =>
                    navigate(
                      `/activity?patient=${encodeURIComponent(row.patientId)}${noteActivityTypeId ? `&activityTypeId=${encodeURIComponent(noteActivityTypeId)}` : ""}&preset=note`,
                    )
                  }
                  onMarkReviewed={() => void handleMarkReviewed(row)}
                />
              ))}
            </div>
          )}
        </section>
        <div className="space-y-5">
          <section className="rounded-3xl border border-slate-200/80 bg-white/95 p-5 shadow-[0_10px_28px_-18px_rgba(15,23,42,0.18)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Today’s Clinical Activities</h3>
                <p className="mt-1 text-xs text-slate-500">Recent actions from your current shift or duty day.</p>
              </div>
              <button type="button" className={uiBtnOutlineSm} onClick={() => navigate("/activity")}>
                Add Activity
              </button>
            </div>
            {todayActivities.length === 0 ? (
              <p className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-center text-sm text-slate-500">
                No clinical activity has been logged yet today.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {todayActivities.slice(0, 5).map((row: any) => (
                  <div key={String(row._id)} className="rounded-2xl border border-slate-200/70 bg-slate-50/80 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-slate-900">{row.activityType || "Activity"}</p>
                        <p className="mt-1 text-xs text-slate-500">{row.patientName || "Patient"} · {formatTimelineDate(row.createdAt)}</p>
                      </div>
                      <span className="text-xs text-slate-400">{row.ipNumber || "—"}</span>
                    </div>
                    <p className="mt-2 text-xs text-slate-600">{row.remarks || "No remarks"}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="rounded-3xl border border-slate-200/80 bg-white/95 p-5 shadow-[0_10px_28px_-18px_rgba(15,23,42,0.18)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Completed Cases</h3>
                <p className="mt-1 text-xs text-slate-500">Recently completed or discharged cases linked to your workflow.</p>
              </div>
              <button type="button" className={uiBtnOutlineSm} onClick={() => navigate("/completed-cases")}>
                Open
              </button>
            </div>
            {completedCases.length === 0 ? (
              <p className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-center text-sm text-slate-500">
                Completed cases will appear here as discharge work is finalized.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {completedCases.slice(0, 3).map((row) => (
                  <div key={`${row.patientId}-${row.completedAt}`} className="rounded-2xl border border-slate-200/70 bg-slate-50/80 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-slate-900">{row.patientName}</p>
                        <p className="mt-1 text-xs text-slate-500">IP {row.ipNumber} · {row.department}</p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200/80">
                        {row.dischargeStatus}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">{formatTimelineDate(row.completedAt)}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </AppLayout>
  );
}

function AdminCompletedCasesByPgPage() {
  const [groups, setGroups] = useState<PgCompletedCasesGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    void api
      .get("/dashboard/completed-cases-by-pg")
      .then((res) => {
        setGroups(Array.isArray(res.data) ? res.data : []);
        setError("");
      })
      .catch(() => setError("Unable to load completed cases."))
      .finally(() => setLoading(false));
  }, []);

  const needle = search.trim().toLowerCase();
  const filteredGroups = needle
    ? groups
        .map((group) => ({
          ...group,
          cases: group.cases.filter((row) => {
            const hay = [row.patientName, row.ipNumber, row.department, row.unit, group.pgName]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();
            return hay.includes(needle);
          }),
        }))
        .filter((group) => group.pgName.toLowerCase().includes(needle) || group.cases.length > 0)
        .map((group) => ({
          ...group,
          completedCount: group.cases.length,
        }))
    : groups;

  return (
    <AppLayout
      title="Completed Cases"
      subtitle="Discharged patients grouped by each allocated postgraduate resident (HIS sync)."
    >
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      <div className="rounded-2xl border border-slate-200/70 bg-white/95 p-4 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search PG, patient, IP, or department"
          className={uiFieldSearchWide}
        />
      </div>
      <AdminCompletedCasesByPgSection groups={filteredGroups} loading={loading} />
    </AppLayout>
  );
}

function AdminCompletedCasesByPgSection({
  groups,
  loading,
}: {
  groups: PgCompletedCasesGroup[];
  loading: boolean;
}) {
  const [expandedPgId, setExpandedPgId] = useState<string | null>(null);
  const totalCases = groups.reduce((sum, g) => sum + g.completedCount, 0);

  if (loading) {
    return <p className="mt-4 text-sm text-slate-500">Loading completed cases by PG…</p>;
  }

  if (groups.length === 0) {
    return (
      <p className="mt-4 text-sm text-slate-500">
        No discharged patients with PG allocation history yet. Cases appear here after HIS discharge sync.
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <p className="text-xs text-slate-500">
        {groups.length} PG{groups.length === 1 ? "" : "s"} · {totalCases} completed case{totalCases === 1 ? "" : "s"} (HIS discharge)
      </p>
      {groups.map((group) => {
        const open = expandedPgId === group.pgId;
        return (
          <article key={group.pgId} className="overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50/50">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-teal-50/40"
              onClick={() => setExpandedPgId(open ? null : group.pgId)}
            >
              <p className="text-sm font-semibold text-slate-900">{group.pgName}</p>
              <span className="shrink-0 rounded-full bg-teal-100 px-2.5 py-1 text-xs font-semibold text-teal-900 ring-1 ring-teal-200/80">
                {group.completedCount} case{group.completedCount === 1 ? "" : "s"}
              </span>
            </button>
            {open ? (
              <div className="max-h-64 overflow-auto border-t border-slate-200 bg-white">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead className="sticky top-0 bg-slate-100 font-semibold text-slate-700">
                    <tr>
                      <th className="px-3 py-2">Patient</th>
                      <th className="px-3 py-2">IP</th>
                      <th className="px-3 py-2">Department</th>
                      <th className="px-3 py-2">Discharged</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.cases.map((row) => (
                      <tr key={`${group.pgId}-${row.patientId}`} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-medium text-slate-900">{row.patientName}</td>
                        <td className="px-3 py-2 font-mono text-slate-600">{row.ipNumber}</td>
                        <td className="px-3 py-2 text-slate-600">{row.department}</td>
                        <td className="px-3 py-2 text-slate-500">{formatTimelineDate(row.completedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function OperationsDashboardPage() {
  const navigate = useNavigate();
  const user = useSelector((s: RootState) => s.auth.user);
  const [stats, setStats] = useState<Record<string, any>>({});
  const [allocationBoard, setAllocationBoard] = useState<any[]>([]);
  const [workload, setWorkload] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [workloadSort, setWorkloadSort] = useState<WorkloadSortKey>("risk");

  useEffect(() => {
    if (!user?._id || !user?.role) return;
    const role = user.role;
    const dashboardEndpoint = role === "Admin" ? "/dashboard/admin" : role === "HOD" ? "/dashboard/hod" : `/dashboard/pg/${user?._id}`;
    const shouldShowExecutiveCharts = role === "Admin" || role === "HOD";
    void Promise.all([
      api.get(dashboardEndpoint),
      api.get("/assignments/live-board"),
      api.get("/monitoring/workload-matrix"),
      shouldShowExecutiveCharts ? api.get("/analytics/overview") : Promise.resolve({ data: null }),
    ])
      .then(([admin, board, matrix, analyticsRes]) => {
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
        setAnalytics((analyticsRes as { data: Record<string, any> | null }).data);
      })
      .catch(() => setError("Dashboard data failed to load. Please login again."))
      .finally(() => setLoading(false));
  }, [user?._id, user?.role]);

  const filteredBoard = allocationBoard.filter((row) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const values = [
      row.patientName,
      row.ipNumber,
      row.status,
      row.wardBedNumber,
      row.department,
      row.unit,
      row.consultant,
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());
    return values.some((value) => value.includes(q));
  });

  const role = (user?.role as UserRoleName | undefined) ?? "PG";
  const showExecutiveCharts = role === "Admin" || role === "HOD";
  const hodPgActivityTotal = Array.isArray(stats.hod?.pgStats)
    ? stats.hod.pgStats.reduce((sum: number, row: { activityCount?: number }) => sum + (Number(row.activityCount) || 0), 0)
    : null;
  const typedWorkload = workload as WorkloadRow[];
  const sortedWorkload = useMemo(() => {
    const rows = [...typedWorkload];
    rows.sort((a, b) => {
      switch (workloadSort) {
        case "pgName":
          return a.pgName.localeCompare(b.pgName, undefined, { sensitivity: "base" });
        case "activePatients":
          return (Number(b.activePatients) || 0) - (Number(a.activePatients) || 0) || a.pgName.localeCompare(b.pgName);
        case "activitiesToday":
          return (Number(b.activitiesToday) || 0) - (Number(a.activitiesToday) || 0) || a.pgName.localeCompare(b.pgName);
        case "delayedReviews":
          return (Number(b.delayedReviews) || 0) - (Number(a.delayedReviews) || 0) || a.pgName.localeCompare(b.pgName);
        case "pendingNotes":
          return (Number(b.pendingNotes) || 0) - (Number(a.pendingNotes) || 0) || a.pgName.localeCompare(b.pgName);
        case "risk":
        default:
          return workloadRiskScore(b) - workloadRiskScore(a) || (Number(b.activePatients) || 0) - (Number(a.activePatients) || 0) || a.pgName.localeCompare(b.pgName);
      }
    });
    return rows;
  }, [typedWorkload, workloadSort]);

  return (
    <AppLayout title="Operations Dashboard" subtitle="Live snapshot of activity, patient load, and governance logs.">
      <div className="grid gap-4 md:grid-cols-4">
        {role === "Admin" ? (
          <>
            <KPI
              title="Active PGs Today"
              value={typeof stats.totalPgUsers === "number" ? `${Number(stats.pgsActiveToday ?? 0)}/${stats.totalPgUsers}` : "—"}
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
            <KPI title="PGs with logged activity" value={Array.isArray(stats.hod?.pgStats) ? stats.hod.pgStats.length : "—"} delta="Distinct PG ids in chart data" />
            <KPI title="Lifetime PG activity rows" value={hodPgActivityTotal != null ? hodPgActivityTotal : "—"} delta="Sum of per-PG counts below" />
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
            <KPI title="My activity entries (all time)" value={stats.myActivities ?? "—"} delta="Total PG activity log rows for you" />
            <KPI title="Delayed notes (pending)" value={stats.pendingTasks ?? "—"} delta="Progress notes flagged delayed" />
          </>
        )}
      </div>
      {showExecutiveCharts ? (
        <div className="grid gap-4 xl:grid-cols-3">
          <MiniChartCard title="Admissions Trend" subtitle="Daily admissions over the last 7 days">
            <MiniTrendBars points={Array.isArray(analytics?.admissionsTrend) ? analytics.admissionsTrend : []} fillClass="bg-gradient-to-t from-teal-600 to-cyan-500" emptyLabel="No admission trend data yet." />
          </MiniChartCard>
          <MiniChartCard title="PG Activity Trend" subtitle="Activities logged per day over the last 7 days">
            <MiniTrendBars points={Array.isArray(analytics?.pgActivityTrend) ? analytics.pgActivityTrend : []} fillClass="bg-gradient-to-t from-indigo-600 to-sky-500" emptyLabel="No PG activity trend data yet." />
          </MiniChartCard>
          <MiniChartCard title="Department Load" subtitle="Current admitted load by department, including ICU coverage">
            <MiniHorizontalBars points={Array.isArray(analytics?.departmentLoad) ? analytics.departmentLoad : []} fillClass="bg-gradient-to-r from-amber-500 to-orange-500" emptyLabel="No department load data yet." />
          </MiniChartCard>
        </div>
      ) : null}
      {loading ? <div className="rounded-2xl border border-slate-200/70 bg-white/95 p-4 text-sm text-slate-500">Loading operational board...</div> : null}
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
      <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/95 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm">
        <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm font-semibold text-slate-900">Live Allocation Board</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patient, IP, ward, department"
            className={`${uiFieldCompact} w-full sm:max-w-xs`}
          />
        </div>
        <div className="overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:thin]">
          <table className="w-max min-w-full border-collapse text-sm">
            <thead className="bg-gradient-to-r from-slate-100 to-teal-50/35">
              <tr>
                <th className={liveBoardHeadCell}>Patient</th>
                <th className={liveBoardHeadCell}>Ward</th>
                <th className={liveBoardHeadCell}>Department</th>
                <th className={liveBoardHeadCell}>IP Number</th>
                <th className={liveBoardHeadCell}>Assigned PGs</th>
                <th className={liveBoardHeadCell}>Status</th>
                <th className={liveBoardHeadCell}>Unit</th>
                <th className={liveBoardHeadCell}>Consultant</th>
                <th className={liveBoardHeadCell}>Hours Since Review</th>
              </tr>
            </thead>
            <tbody>
              {filteredBoard.length === 0 ? (
                <tr>
                  <td colSpan={9} className="w-full whitespace-normal px-4 py-8 text-center text-sm text-slate-500">
                    {loading ? "Loading…" : "No patients match this search."}
                  </td>
                </tr>
              ) : (
                filteredBoard.map((row) => {
                  const statusMeta = liveBoardStatusMeta(row.status, row.isIcu);
                  return (
                    <tr
                      key={row.patientId}
                      className={`cursor-pointer border-t border-slate-100 transition hover:bg-teal-50/30 ${statusMeta.rowClass}`}
                      title="Open patient timeline"
                      onClick={() => navigate(`/timeline?patient=${row.patientId}`)}
                    >
                      <td className={`${liveBoardCell} align-top`}>
                        <div className="inline-flex w-max flex-col gap-1">
                          <span className="font-medium text-slate-900">{row.patientName || "—"}</span>
                          {row.isIcu ? (
                            <span className="w-max rounded bg-rose-100 px-1.5 py-px text-[10px] font-bold uppercase text-rose-800">
                              ICU
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className={`${liveBoardCell} text-slate-700`}>{row.wardBedNumber || "—"}</td>
                      <td className={`${liveBoardCell} text-slate-700`}>{row.department || "—"}</td>
                      <td className={`${liveBoardCell} font-mono text-xs text-slate-600`}>{row.ipNumber || "—"}</td>
                      <td className={`${liveBoardCell} text-slate-700`}>
                        {(row.assignedPgs || []).map((p: any) => `${p.name}${p.isPrimary ? " (P)" : ""}`).join(", ") || "—"}
                      </td>
                      <td className={liveBoardCell}>
                        <span className={`inline-flex w-max items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${statusMeta.chipClass}`}>
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${
                              statusMeta.label === "Unassigned"
                                ? "bg-slate-400"
                                : statusMeta.label === "Delayed Review"
                                  ? "bg-amber-500"
                                  : statusMeta.label === "ICU Critical" || statusMeta.label === "ICU"
                                    ? "bg-rose-500"
                                    : "bg-emerald-500"
                            }`}
                            aria-hidden
                          />
                          {statusMeta.label}
                        </span>
                      </td>
                      <td className={`${liveBoardCell} text-slate-700`}>{row.unit || "—"}</td>
                      <td className={`${liveBoardCell} text-slate-700`}>{row.consultant || "—"}</td>
                      <td className={`${liveBoardCell} tabular-nums text-slate-600`}>
                        {row.hoursSinceReview != null ? `${row.hoursSinceReview}h` : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500 md:hidden">Swipe horizontally to see all columns.</p>
      </section>
      {showExecutiveCharts ? (
        <section className="mt-4 rounded-2xl border border-slate-200/70 bg-white/95 p-4 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">PG Workload</h3>
            <p className="mt-0.5 text-xs text-slate-500">Quick view of each resident&apos;s patient load and review pressure.</p>
          </div>
          <select className={uiFieldCompact} value={workloadSort} onChange={(e) => setWorkloadSort(e.target.value as WorkloadSortKey)}>
            <option value="risk">Sort: Highest load first</option>
            <option value="activePatients">Sort: Most patients</option>
            <option value="activitiesToday">Sort: Most activity today</option>
            <option value="delayedReviews">Sort: Most delayed reviews</option>
            <option value="pendingNotes">Sort: Most pending notes</option>
            <option value="pgName">Sort: Name A–Z</option>
          </select>
        </div>
          {sortedWorkload.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No PG workload data yet. Assign patients to see load cards here.</p>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {sortedWorkload.map((w) => (
                <PgWorkloadCard key={w.pgId} row={w} />
              ))}
            </div>
          )}
        </section>
      ) : null}
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
  const user = useSelector((s: RootState) => s.auth.user);
  const [patients, setPatients] = useState<any[]>([]);
  const [patientId, setPatientId] = useState("");
  const [events, setEvents] = useState<any[]>([]);
  const [availableEventTypes, setAvailableEventTypes] = useState<string[]>([]);
  const [prefetchingTypes, setPrefetchingTypes] = useState(false);
  const [timelineLoaded, setTimelineLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [eventFilter, setEventFilter] = useState("All");
  const [refs, setRefs] = useState<TimelineRefs>({ pgById: {}, deptById: {}, unitById: {} });
  const timelineCacheRef = useRef<{ patientId: string; events: any[] } | null>(null);
  const prefetchSeqRef = useRef(0);

  useEffect(() => {
    const isPgUser = user?.role === "PG" && user?._id;
    void Promise.all([
      isPgUser ? api.get("/assignments/live-board") : api.get("/patients"),
      api.get("/pg"),
      api.get("/departments"),
      api.get("/units"),
    ])
      .then(([patRes, pgRes, deptRes, unitRes]) => {
        if (isPgUser) {
          const rows = Array.isArray(patRes.data) ? patRes.data : [];
          setPatients(
            rows
              .filter((row: any) => Array.isArray(row.assignedPgs) && row.assignedPgs.some((pg: any) => String(pg.id) === String(user?._id)))
              .map((row: any) => ({
                _id: row.patientId,
                patientName: row.patientName,
                ipNumber: row.ipNumber,
              })),
          );
        } else {
          setPatients(patRes.data.data || []);
        }
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
  }, [user?._id, user?.role]);

  const extractEventTypes = (rows: any[]) => {
    const names = Array.from(new Set(rows.map((e: any) => String(e.type ?? e.eventType ?? "Unknown"))));
    names.sort((a, b) => a.localeCompare(b));
    return names;
  };

  const prefetchTimelineForPatient = async (id: string) => {
    const targetId = id.trim();
    if (!targetId) {
      timelineCacheRef.current = null;
      setAvailableEventTypes([]);
      return;
    }
    const seq = ++prefetchSeqRef.current;
    setPrefetchingTypes(true);
    try {
      const { data } = await api.get(`/patient-timeline/${encodeURIComponent(targetId)}`);
      if (seq !== prefetchSeqRef.current) return;
      const payload = normalizeTimelinePayload(data);
      timelineCacheRef.current = { patientId: targetId, events: payload };
      setAvailableEventTypes(extractEventTypes(payload));
    } catch {
      if (seq !== prefetchSeqRef.current) return;
      timelineCacheRef.current = null;
      setAvailableEventTypes([]);
    } finally {
      if (seq === prefetchSeqRef.current) setPrefetchingTypes(false);
    }
  };

  const applyPatientSelection = (id: string) => {
    setPatientId(id);
    setError("");
    setEventFilter("All");
    setEvents([]);
    setTimelineLoaded(false);
    timelineCacheRef.current = null;
    setAvailableEventTypes([]);
    if (id.trim()) void prefetchTimelineForPatient(id);
  };

  const loadTimeline = async (id?: string) => {
    const targetId = (id ?? patientId).trim();
    if (!targetId) {
      setError("Select a patient or enter a valid patient id.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const cached = timelineCacheRef.current;
      const payload =
        cached?.patientId === targetId
          ? cached.events
          : normalizeTimelinePayload((await api.get(`/patient-timeline/${encodeURIComponent(targetId)}`)).data);
      timelineCacheRef.current = { patientId: targetId, events: payload };
      setAvailableEventTypes(extractEventTypes(payload));
      setEvents(payload);
      setTimelineLoaded(true);
    } catch (err: any) {
      const msg =
        typeof err?.response?.data?.message === "string"
          ? err.response.data.message
          : "Unable to load timeline. Try another patient or check that the id is a valid 24-character value.";
      setError(msg);
      setEvents([]);
      setTimelineLoaded(false);
    } finally {
      setLoading(false);
    }
  };

  const patientParam = searchParams.get("patient") ?? "";
  useEffect(() => {
    const fromUrl = patientParam.trim();
    if (!fromUrl) return;
    applyPatientSelection(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run when URL patient changes only
  }, [patientParam]);

  const selectedPatient = useMemo(
    () => patients.find((p) => String(p._id) === String(patientId)) || null,
    [patients, patientId],
  );

  const eventTypes = useMemo(() => {
    const source = timelineLoaded ? events : availableEventTypes.map((t) => ({ type: t }));
    const names = extractEventTypes(source);
    return ["All", ...names];
  }, [events, availableEventTypes, timelineLoaded]);

  useEffect(() => {
    if (eventFilter === "All") return;
    const allowed = new Set(eventTypes.filter((t) => t !== "All"));
    if (!allowed.has(eventFilter)) setEventFilter("All");
  }, [eventTypes, eventFilter]);

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

  const typeMarkerClass = (type: string) => {
    switch (type) {
      case "Admission":
        return "bg-blue-500";
      case "Assignment":
        return "bg-indigo-500";
      case "Activity":
        return "bg-emerald-500";
      case "ProgressNote":
        return "bg-amber-500";
      case "Procedure":
        return "bg-cyan-500";
      case "Discharge":
        return "bg-rose-500";
      default:
        return "bg-slate-400";
    }
  };

  return (
    <AppLayout title="Patient Timeline" subtitle="A clean chronological flow of admission, reviews, notes, procedures, and discharge events.">
      <section className="rounded-3xl border border-slate-200/70 bg-white/95 shadow-[0_6px_28px_-12px_rgba(15,23,42,0.08)] backdrop-blur-sm p-4">
        <div className="grid gap-3 lg:grid-cols-[2fr_1fr_auto]">
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-medium text-slate-600">Patient</label>
            <select
              className={uiField}
              value={patientId}
              onChange={(e) => applyPatientSelection(e.target.value)}
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
              disabled={!patientId.trim() || prefetchingTypes}
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
      {!loading && !error && !timelineLoaded ? (
        <div className="rounded-2xl border border-slate-200/70 bg-white/95 p-4 text-sm text-slate-500 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm">
          {patientId.trim()
            ? prefetchingTypes
              ? "Loading event types for this patient..."
              : "Click Load Timeline to view this patient's events."
            : "Select a patient, then click Load Timeline."}
        </div>
      ) : null}
      {!loading && !error && timelineLoaded && filteredEvents.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/70 bg-white/95 p-4 text-sm text-slate-500 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm">
          No timeline events match the current filter.
        </div>
      ) : null}
      <div className="space-y-4">
        {filteredEvents.map((event: any, idx: number) => {
          const eventKind = String(event.type ?? event.eventType ?? "Unknown");
          return (
            <div key={`${eventKind}-${idx}`} className="grid gap-3 md:grid-cols-[110px_24px_minmax(0,1fr)]">
              <div className="pt-2 text-xs font-medium tabular-nums text-slate-500">{formatTimelineDate(event.at)}</div>
              <div className="relative hidden md:flex md:justify-center">
                <span className={`relative z-10 mt-2 h-3 w-3 rounded-full ${typeMarkerClass(eventKind)}`} />
                {idx < filteredEvents.length - 1 ? <span className="absolute top-5 h-full w-px bg-slate-200" aria-hidden /> : null}
              </div>
              <article className="rounded-3xl border border-slate-200/70 bg-white/95 p-4 shadow-[0_6px_24px_-14px_rgba(15,23,42,0.14)] backdrop-blur-sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 md:hidden">
                    <span className={`h-2.5 w-2.5 rounded-full ${typeMarkerClass(eventKind)}`} />
                    <span className="text-xs tabular-nums text-slate-500">{formatTimelineDate(event.at)}</span>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${typeBadgeClass(eventKind)}`}>
                    {eventKind}
                  </span>
                </div>
                <TimelineEventBody event={{ ...event, type: eventKind }} refs={refs} />
              </article>
            </div>
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
        <div className={uiTableScroll}>
        <table className="w-full min-w-[720px] text-sm">
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
        </div>
        <p className={uiTableSwipeHint}>Swipe horizontally to see all columns.</p>
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
  type ReportFilters = {
    from: string;
    to: string;
    pgId: string;
    activityTypeId: string;
  };
  const initialFilters: ReportFilters = {
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

  const updateFilter = (key: keyof ReportFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setMessage("");
  };

  const buildReportUrl = (format?: "excel" | "pdf") => {
    const params = new URLSearchParams();
    if (format) params.set("format", format);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.pgId) params.set("pgId", filters.pgId);
    if (filters.activityTypeId) params.set("activityTypeId", filters.activityTypeId);
    const query = params.toString();
    return query ? `/reports/pg-activity?${query}` : "/reports/pg-activity";
  };

  const run = async (format: "excel" | "pdf") => {
    const pdfWindow = format === "pdf" ? window.open("", "_blank") : null;
    try {
      const response = await api.get(buildReportUrl(format), { responseType: "blob" });
      const mime = format === "excel" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf";
      const extension = format === "excel" ? "xlsx" : "pdf";
      const blob = new Blob([response.data], { type: mime });
      const url = window.URL.createObjectURL(blob);

      if (format === "pdf") {
        if (pdfWindow) {
          pdfWindow.location.href = url;
          pdfWindow.focus();
        } else {
          window.open(url, "_blank");
        }
        window.setTimeout(() => window.URL.revokeObjectURL(url), 60000);
        setMessage("PDF opened in browser.");
        return;
      }

      const a = document.createElement("a");
      a.href = url;
      a.download = `pg-activity-report.${extension}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setMessage("Report downloaded successfully.");
    } catch {
      if (pdfWindow && !pdfWindow.closed) pdfWindow.close();
      setMessage("Report download failed. Please login and retry.");
    }
  };
  return (
    <AppLayout title="Reports & Export" subtitle="Export filtered PG activity as Excel or view it as PDF in the browser.">
      <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/95 shadow-[0_4px_24px_-6px_rgba(15,23,42,0.07)] backdrop-blur-sm">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">Available Reports</div>
        <div className="p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">From date</label>
              <input
                type="date"
                value={filters.from}
                onChange={(e) => updateFilter("from", e.target.value)}
                className={uiField}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">To date</label>
              <input
                type="date"
                value={filters.to}
                onChange={(e) => updateFilter("to", e.target.value)}
                className={uiField}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">PG</label>
              <select
                value={filters.pgId}
                onChange={(e) => updateFilter("pgId", e.target.value)}
                className={uiField}
              >
                <option value="">All PGs</option>
                {pgs.map((pg) => (
                  <option key={pg._id} value={pg._id}>{pgOptionLabel(pg)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Activity type</label>
              <select
                value={filters.activityTypeId}
                onChange={(e) => updateFilter("activityTypeId", e.target.value)}
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
            <button type="button" className={uiBtnReport} onClick={() => run("excel")}>Export PG Activity - Excel</button>
            <button type="button" className={uiBtnReport} onClick={() => run("pdf")}>View PG Activity - PDF</button>
          </div>
          <div className="mt-3">
            <button
              type="button"
              className={uiBtnOutlineSm}
              onClick={() => {
                setFilters(initialFilters);
                setMessage("");
              }}
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
  const user = useSelector((s: RootState) => s.auth.user);
  if (!token) return <Navigate to="/login" replace />;
  if (user?.role === "PG") {
    return (
      <Routes>
        <Route path="/dashboard/pg" element={<PGDashboardPage />} />
        <Route path="/my-patients" element={<MyPatientsPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/timeline" element={<TimelinePage />} />
        <Route path="/completed-cases" element={<CompletedCasesPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/dashboard/pg" replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/dashboard/pg" element={<OperationsDashboardPage />} />
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
      <Route
        path="/completed-cases-by-pg"
        element={
          <RequireRole roles={["Admin", "HOD"]}>
            <AdminCompletedCasesByPgPage />
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
  const dispatch = useDispatch<AppDispatch>();
  const token = useSelector((s: RootState) => s.auth.token);
  const user = useSelector((s: RootState) => s.auth.user);
  const [restoringSession, setRestoringSession] = useState(Boolean(token && !user));

  useEffect(() => {
    let active = true;
    if (!token || user) {
      setRestoringSession(false);
      return () => {
        active = false;
      };
    }

    setRestoringSession(true);
    void api
      .get("/auth/profile")
      .then((res) => {
        if (!active) return;
        dispatch(setAuth({ token, user: res.data }));
      })
      .catch(() => {
        if (!active) return;
        dispatch(clearAuth());
      })
      .finally(() => {
        if (active) setRestoringSession(false);
      });

    return () => {
      active = false;
    };
  }, [dispatch, token, user]);

  if (token && !user && restoringSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600">
        Restoring session...
      </div>
    );
  }

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
