import {
  Admission,
  Department,
  DischargeSummary,
  PGActivityLog,
  PatientAssignment,
  Procedure,
  ProgressNote,
  User,
} from "./models";
import mongoose from "mongoose";

export type PatientTimelineEvent = {
  at: Date;
  type: string;
  data: Record<string, unknown>;
};

function isReallocationRemarks(value: unknown): boolean {
  return /reallocat/i.test(String(value ?? ""));
}

function userDisplayName(user: { fullName?: string; username?: string } | null | undefined): string {
  if (!user) return "—";
  const name = String(user.fullName ?? "").trim();
  if (name) return name.startsWith("Dr.") ? name : `Dr. ${name}`;
  return String(user.username ?? "—");
}

function roleLabel(role: unknown): string {
  const r = String(role ?? "").trim();
  return r || "Staff";
}

export async function buildPatientTimeline(patientId: mongoose.Types.ObjectId): Promise<PatientTimelineEvent[]> {
  const [admissions, assignments, activities, procedures, notes, discharge] = await Promise.all([
    Admission.find({ patientId }).sort({ admissionDate: 1, createdAt: 1 }).lean(),
    PatientAssignment.find({ patientId }).sort({ assignedAt: 1, createdAt: 1 }).lean(),
    PGActivityLog.find({ patientId }).sort({ createdAt: 1 }).lean(),
    Procedure.find({ patientId }).sort({ date: 1 }).lean(),
    ProgressNote.find({ patientId }).sort({ noteDateTime: 1 }).lean(),
    DischargeSummary.findOne({ patientId }).lean(),
  ]);

  const deptIds = new Set<string>();
  const userIds = new Set<string>();

  for (const a of admissions) {
    if (a.departmentId) deptIds.add(String(a.departmentId));
    if (a.assignedPgId) userIds.add(String(a.assignedPgId));
  }
  for (const a of assignments) {
    if (a.pgId) userIds.add(String(a.pgId));
    if (a.assignedBy) userIds.add(String(a.assignedBy));
  }
  for (const a of activities) {
    if (a.pgId) userIds.add(String(a.pgId));
  }
  for (const p of procedures) {
    if (p.pgId) userIds.add(String(p.pgId));
  }
  for (const n of notes) {
    if (n.pgId) userIds.add(String(n.pgId));
  }

  const [departments, users] = await Promise.all([
    deptIds.size
      ? Department.find({ _id: { $in: [...deptIds] } })
          .select("name")
          .lean()
      : [],
    userIds.size
      ? User.find({ _id: { $in: [...userIds] } })
          .select("fullName username role")
          .lean()
      : [],
  ]);

  const deptById = new Map<string, string>(
    departments.map((d) => [String(d._id), String(d.name)] as [string, string]),
  );
  const userById = new Map<string, { fullName?: string; username?: string; role?: string }>(
    users.map((u) => [String(u._id), u] as [string, typeof u]),
  );

  const events: PatientTimelineEvent[] = [];

  for (const admission of admissions) {
    const deptName = deptById.get(String(admission.departmentId)) || "—";
    const assignedPgId =
      admission.assignedPgId ||
      assignments.find((row) => String(row.admissionId) === String(admission._id) && row.isPrimary)?.pgId ||
      assignments.find((row) => String(row.admissionId) === String(admission._id))?.pgId;
    const assignedPg = assignedPgId ? userById.get(String(assignedPgId)) : null;

    events.push({
      at: new Date(admission.admissionDate || admission.createdAt),
      type: "Admission",
      data: {
        departmentName: deptName,
        wardBedNumber: admission.wardBedNumber || "",
        status: admission.status || "Admitted",
        assignedPgName: userDisplayName(assignedPg),
        assignedPgId: assignedPgId ? String(assignedPgId) : "",
      },
    });
  }

  const sortedAssignments = [...assignments].sort(
    (a, b) => new Date(a.assignedAt || a.createdAt).getTime() - new Date(b.assignedAt || b.createdAt).getTime(),
  );

  for (let i = 0; i < sortedAssignments.length; i++) {
    const closed = sortedAssignments[i];
    if (closed.isActive || !closed.releasedAt) continue;

    const releasedAt = new Date(closed.releasedAt).getTime();
    const next = sortedAssignments.find((row, idx) => {
      if (idx <= i) return false;
      const at = new Date(row.assignedAt || row.createdAt).getTime();
      return at >= releasedAt - 60_000;
    });

    if (!next) continue;
    if (!isReallocationRemarks(closed.remarks) && !isReallocationRemarks(next.remarks)) continue;

    const previousPg = userById.get(String(closed.pgId));
    const newPg = userById.get(String(next.pgId));
    const changedBy = next.assignedBy ? userById.get(String(next.assignedBy)) : null;
    const reason = String(next.remarks || closed.remarks || "PG reallocation").replace(/\s*\|\s*Reallocated.*$/i, "").trim();

    events.push({
      at: new Date(next.assignedAt || next.createdAt),
      type: "PG Reallocation",
      data: {
        previousPgName: userDisplayName(previousPg),
        newPgName: userDisplayName(newPg),
        reason,
        changedByName: changedBy ? String(changedBy.fullName || changedBy.username || "—") : "—",
        changedByRole: roleLabel(changedBy?.role),
      },
    });
  }

  for (const activity of activities) {
    const pg = userById.get(String(activity.pgId));
    events.push({
      at: new Date(activity.createdAt),
      type: "Activity",
      data: {
        activityType: activity.activityType,
        pgName: userDisplayName(pg),
        remarks: activity.remarks || "",
      },
    });
  }

  for (const procedure of procedures) {
    const pg = userById.get(String(procedure.pgId));
    events.push({
      at: new Date(procedure.date),
      type: "Procedure",
      data: {
        procedureName: procedure.procedureName,
        role: procedure.role,
        pgName: userDisplayName(pg),
      },
    });
  }

  for (const note of notes) {
    const pg = userById.get(String(note.pgId));
    events.push({
      at: new Date(note.noteDateTime),
      type: "Progress Note",
      data: {
        pgName: userDisplayName(pg),
        noteContent: note.noteContent,
        delayedEntry: Boolean(note.delayedEntry),
      },
    });
  }

  if (discharge) {
    events.push({
      at: new Date(discharge.updatedAt || discharge.createdAt),
      type: "Discharge",
      data: {
        status: discharge.status,
        diagnosis: discharge.diagnosis || "",
        medications: discharge.medications || "",
        followUpInstructions: discharge.followUpInstructions || "",
      },
    });
  }

  return events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}
