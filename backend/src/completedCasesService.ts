import mongoose from "mongoose";
import {
  Admission,
  DischargeSummary,
  Patient,
  PatientAssignment,
  PGActivityLog,
  Procedure,
  ProgressNote,
} from "./models";
import { syncDischargesFromHisIfDue } from "./hisDischargeSync";

const JUNK_PATIENT_NAME_PATTERNS = [/^Test Patient$/i, /^v\s*bvbv$/i];

/** Seed / placeholder / junk patients — excluded from lists and removed on seed. */
export function isDemoPatientRecord(ipNumber?: string, patientName?: string): boolean {
  const ip = String(ipNumber ?? "").trim();
  const name = String(patientName ?? "").trim();
  if (/^DEMO-/i.test(ip)) return true;
  if (/^IP\d{10,}$/.test(ip)) return true;
  if (JUNK_PATIENT_NAME_PATTERNS.some((pattern) => pattern.test(name))) return true;
  return false;
}

export function junkPatientMongoFilter(): Record<string, unknown> {
  return {
    $or: [
      { ipNumber: { $regex: /^DEMO-/i } },
      { ipNumber: { $regex: /^IP\d{10,}$/ } },
      ...JUNK_PATIENT_NAME_PATTERNS.map((pattern) => ({ patientName: pattern })),
    ],
  };
}

async function deletePatientsAndRelated(
  patientIds: { _id: mongoose.Types.ObjectId }[],
): Promise<void> {
  if (patientIds.length === 0) return;
  const ids = patientIds.map((p) => p._id);
  await Promise.all([
    PGActivityLog.deleteMany({ patientId: { $in: ids } }),
    ProgressNote.deleteMany({ patientId: { $in: ids } }),
    Procedure.deleteMany({ patientId: { $in: ids } }),
    PatientAssignment.deleteMany({ patientId: { $in: ids } }),
    DischargeSummary.deleteMany({ patientId: { $in: ids } }),
    Admission.deleteMany({ patientId: { $in: ids } }),
  ]);
  await Patient.deleteMany({ _id: { $in: ids } });
}

export async function deleteJunkPatients(): Promise<number> {
  const demoPatients = await Patient.find(junkPatientMongoFilter()).select("_id").lean();
  await deletePatientsAndRelated(demoPatients);
  return demoPatients.length;
}

/** Remove tracked patients by IP (e.g. Z-patients admitted before filtering). */
export async function removeTrackedPatientsByIpNumbers(ipNumbers: string[]): Promise<number> {
  const normalized = [...new Set(ipNumbers.map((ip) => String(ip).trim()).filter(Boolean))];
  if (!normalized.length) return 0;

  const patients = await Patient.find({
    ipNumber: {
      $in: normalized.map((ip) => new RegExp(`^${ip.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")),
    },
  })
    .select("_id")
    .lean();
  await deletePatientsAndRelated(patients);
  return patients.length;
}

export type CompletedCaseRow = {
  patientId: string;
  patientName: string;
  ipNumber: string;
  wardBedNumber: string;
  department: string;
  unit: string;
  admissionStatus: string;
  dischargeStatus: string;
  diagnosis: string;
  completedAt: Date | string | null;
};

export type PgCompletedCasesGroup = {
  pgId: string;
  pgName: string;
  completedCount: number;
  cases: CompletedCaseRow[];
};

function buildCompletedCasesList(
  pgAssignments: any[],
  dischargeSummaries: any[],
): CompletedCaseRow[] {
  const summaryByPatientId = new Map<string, any>();
  for (const row of dischargeSummaries) {
    const key = String(row.patientId);
    if (!summaryByPatientId.has(key)) summaryByPatientId.set(key, row);
  }

  const completedFromAssignments = pgAssignments
    .filter((row) => {
      const admission = row.admissionId;
      return admission && admission.status === "Discharged";
    })
    .map((row) => {
      const admission = row.admissionId;
      const patient = admission.patientId;
      const patientId = String(patient?._id || row.patientId);
      const summary = summaryByPatientId.get(patientId);
      return {
        patientId,
        patientName: patient?.patientName || "Unknown Patient",
        ipNumber: patient?.ipNumber || "—",
        wardBedNumber: admission.wardBedNumber || "—",
        department: admission.departmentId?.name || "—",
        unit: admission.unitId?.name || "—",
        admissionStatus: admission.status || "Discharged",
        dischargeStatus: summary?.status || "Discharged from HIS",
        diagnosis: summary?.diagnosis || "—",
        completedAt:
          admission.dischargedAt ||
          row.releasedAt ||
          summary?.updatedAt ||
          admission.updatedAt ||
          admission.admissionDate,
      };
    });

  const seenPatientIds = new Set(completedFromAssignments.map((row) => row.patientId));
  const completedFromSummaries = dischargeSummaries
    .filter((summary) => !seenPatientIds.has(String(summary.patientId)))
    .map((summary) => ({
      patientId: String(summary.patientId),
      patientName: "Unknown Patient",
      ipNumber: "—",
      wardBedNumber: "—",
      department: "—",
      unit: "—",
      admissionStatus: "Completed",
      dischargeStatus: summary.status || "Completed",
      diagnosis: summary.diagnosis || "—",
      completedAt: summary.updatedAt || summary.createdAt,
    }));

  const deduped = new Map<string, CompletedCaseRow>();
  for (const row of [...completedFromAssignments, ...completedFromSummaries]) {
    const existing = deduped.get(row.patientId);
    if (!existing) {
      deduped.set(row.patientId, row);
      continue;
    }
    const existingAt = existing.completedAt ? new Date(existing.completedAt).getTime() : 0;
    const nextAt = row.completedAt ? new Date(row.completedAt).getTime() : 0;
    if (nextAt > existingAt) deduped.set(row.patientId, row);
  }

  return [...deduped.values()]
    .filter((row) => !isDemoPatientRecord(row.ipNumber, row.patientName))
    .sort((a, b) => {
      const left = a.completedAt ? new Date(a.completedAt).getTime() : 0;
      const right = b.completedAt ? new Date(b.completedAt).getTime() : 0;
      return right - left;
    });
}

async function hydrateUnknownPatients(rows: CompletedCaseRow[]): Promise<CompletedCaseRow[]> {
  const patientIds = rows
    .filter((row) => row.patientName === "Unknown Patient")
    .map((row) => row.patientId)
    .filter(Boolean);
  if (patientIds.length === 0) return rows;

  const patients = await Patient.find({ _id: { $in: patientIds } }).select("patientName ipNumber").lean();
  const byId = new Map(patients.map((p: any) => [String(p._id), p]));
  return rows.map((row) => {
    if (row.patientName !== "Unknown Patient") return row;
    const patient = byId.get(row.patientId);
    if (!patient) return row;
    return {
      ...row,
      patientName: patient.patientName || row.patientName,
      ipNumber: patient.ipNumber || row.ipNumber,
    };
  });
}

export async function getCompletedCasesForPg(pgId: string): Promise<CompletedCaseRow[]> {
  try {
    await syncDischargesFromHisIfDue();
  } catch {
    /* non-fatal */
  }

  const [pgAssignments, dischargeSummaries] = await Promise.all([
    PatientAssignment.find({ pgId })
      .populate({
        path: "admissionId",
        populate: [{ path: "patientId" }, { path: "departmentId" }, { path: "unitId" }],
      })
      .sort({ releasedAt: -1, assignedAt: -1 })
      .lean(),
    DischargeSummary.find({ preparedBy: pgId }).sort({ updatedAt: -1 }).lean(),
  ]);

  const rows = buildCompletedCasesList(pgAssignments as any[], dischargeSummaries as any[]);
  return hydrateUnknownPatients(rows);
}

export async function getCompletedCasesGroupedByPg(): Promise<PgCompletedCasesGroup[]> {
  try {
    await syncDischargesFromHisIfDue();
  } catch {
    /* non-fatal */
  }

  const [allAssignments, allSummaries] = await Promise.all([
    PatientAssignment.find({})
      .populate({
        path: "admissionId",
        populate: [{ path: "patientId" }, { path: "departmentId" }, { path: "unitId" }],
      })
      .populate("pgId", "fullName username")
      .sort({ releasedAt: -1, assignedAt: -1 })
      .lean(),
    DischargeSummary.find({}).sort({ updatedAt: -1 }).lean(),
  ]);

  const assignmentsByPg = new Map<string, any[]>();
  const pgNameById = new Map<string, string>();

  for (const row of allAssignments as any[]) {
    const pgId = String(row.pgId?._id || row.pgId || "");
    if (!pgId) continue;
    if (!assignmentsByPg.has(pgId)) assignmentsByPg.set(pgId, []);
    assignmentsByPg.get(pgId)!.push(row);
    if (!pgNameById.has(pgId)) {
      pgNameById.set(pgId, String(row.pgId?.fullName || row.pgId?.username || "Unknown PG"));
    }
  }

  const summariesByPg = new Map<string, any[]>();
  for (const summary of allSummaries as any[]) {
    const pgId = String(summary.preparedBy || "");
    if (!pgId) continue;
    if (!summariesByPg.has(pgId)) summariesByPg.set(pgId, []);
    summariesByPg.get(pgId)!.push(summary);
  }

  const pgIds = new Set([...assignmentsByPg.keys(), ...summariesByPg.keys()]);
  const groups: PgCompletedCasesGroup[] = [];

  for (const pgId of pgIds) {
    const cases = buildCompletedCasesList(
      assignmentsByPg.get(pgId) || [],
      summariesByPg.get(pgId) || [],
    );
    if (cases.length === 0) continue;
    const hydrated = await hydrateUnknownPatients(cases);
    groups.push({
      pgId,
      pgName: pgNameById.get(pgId) || "Unknown PG",
      completedCount: hydrated.length,
      cases: hydrated,
    });
  }

  return groups.sort((a, b) => b.completedCount - a.completedCount || a.pgName.localeCompare(b.pgName));
}
