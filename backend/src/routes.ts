import { Router, Request, Response } from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import {
  ActivityType,
  Admission,
  AuditLog,
  Department,
  DischargeSummary,
  Patient,
  PatientAssignment,
  PGActivityLog,
  PGMaster,
  Procedure,
  ProgressNote,
  Unit,
  User,
  toObjectId,
} from "./models";
import { AuthRequest, auditLogger, authMiddleware, requireAssignmentManager, requireRoles, signToken } from "./middleware";

export const apiRouter = Router();

function normalizeDate(value?: string) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeShift(value?: string): "Morning" | "Evening" | "Night" | "General" {
  if (value === "Morning" || value === "Evening" || value === "Night" || value === "General") return value;
  return "General";
}

/** Local calendar day [start, end) for `dayOffset` (0 = today, -1 = yesterday). */
function localDayRange(dayOffset: number): { start: Date; end: Date } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + dayOffset);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

type PgActivityFormattedRow = {
  patientId: string;
  sortAt: number;
  patient: string;
  ipNumber: string;
  department: string;
  unit: string;
  pg: string;
  activity: string;
  dateTime: string;
  remarks: string;
};

type PgActivityPatientGroup = {
  patientId: string;
  patient: string;
  ipNumber: string;
  rows: PgActivityFormattedRow[];
};

/** Clinical grouped view: one block per patient; activities oldest→newest within patient; patients A→Z. */
function groupPgActivityByPatient(rows: PgActivityFormattedRow[]): PgActivityPatientGroup[] {
  const map = new Map<string, PgActivityFormattedRow[]>();
  for (const row of rows) {
    const id = row.patientId;
    const list = map.get(id);
    if (list) list.push(row);
    else map.set(id, [row]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.sortAt - b.sortAt);
  }
  return Array.from(map.entries())
    .map(([patientId, activityRows]) => ({
      patientId,
      patient: activityRows[0].patient,
      ipNumber: activityRows[0].ipNumber,
      rows: activityRows,
    }))
    .sort((a, b) => a.patient.localeCompare(b.patient, undefined, { sensitivity: "base" }));
}

apiRouter.post("/auth/login", async (req: Request, res: Response) => {
  const { username, password } = req.body as { username: string; password: string };
  const user = await User.findOne({ username });
  if (!user) return res.status(401).json({ message: "Invalid credentials" });
  const ok = await bcrypt.compare(password, user.get("password"));
  if (!ok) return res.status(401).json({ message: "Invalid credentials" });
  const token = signToken({
    id: user.id,
    username: user.get("username"),
    role: user.get("role"),
  });
  return res.json({ token, user });
});

apiRouter.post("/auth/logout", authMiddleware, (_req: Request, res: Response) => res.json({ message: "Logged out" }));
apiRouter.get("/auth/profile", authMiddleware, async (req: AuthRequest, res: Response) => {
  const user = await User.findById(req.user?.id);
  res.json(user);
});

apiRouter.get("/pg", authMiddleware, async (_req, res) => {
  const data = await User.find({ role: "PG" }).populate("departmentId unitId");
  res.json(data);
});
apiRouter.post("/pg", authMiddleware, requireRoles("Admin"), auditLogger("PGMaster", "Create PG"), async (req, res) => {
  const user = await User.create({ ...req.body, role: "PG" });
  await PGMaster.create({
    userId: user._id,
    yearOfResidency: req.body.yearOfResidency ?? 1,
    joiningDate: req.body.joiningDate ?? new Date(),
  });
  res.status(201).json(user);
});
apiRouter.put("/pg/:id", authMiddleware, requireRoles("Admin"), auditLogger("PGMaster", "Update PG"), async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(user);
});
apiRouter.delete("/pg/:id", authMiddleware, requireRoles("Admin"), auditLogger("PGMaster", "Deactivate PG"), async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { status: "Inactive" }, { new: true });
  res.json(user);
});

apiRouter.get("/departments", authMiddleware, async (_req, res) => res.json(await Department.find()));
apiRouter.post("/departments", authMiddleware, requireRoles("Admin"), auditLogger("Department", "Create Department"), async (req, res) => {
  res.status(201).json(await Department.create(req.body));
});
apiRouter.get("/units", authMiddleware, async (_req, res) => res.json(await Unit.find().populate("departmentId consultantId")));
apiRouter.post("/units", authMiddleware, requireRoles("Admin"), auditLogger("Unit", "Create Unit"), async (req, res) => {
  res.status(201).json(await Unit.create(req.body));
});
apiRouter.get("/activity-types", authMiddleware, async (_req, res) => res.json(await ActivityType.find()));
apiRouter.post("/activity-types", authMiddleware, requireRoles("Admin"), async (req, res) => {
  res.status(201).json(await ActivityType.create(req.body));
});

apiRouter.post("/admission", authMiddleware, auditLogger("Admission", "Create Admission"), async (req, res) => {
  const { patient, admission } = req.body as { patient: Record<string, unknown>; admission: any };
  let patientDoc = await Patient.findOne({ ipNumber: patient.ipNumber });
  if (!patientDoc) patientDoc = await Patient.create(patient);
  const admissionDoc = await Admission.create({ ...admission, patientId: patientDoc._id });
  if (admission.assignedPgId) {
    await PatientAssignment.create({
      admissionId: admissionDoc._id,
      patientId: patientDoc._id,
      pgId: admission.assignedPgId,
      shift: "General",
    });
  }
  res.status(201).json({ patient: patientDoc, admission: admissionDoc });
});

apiRouter.get("/patients", authMiddleware, async (req, res) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 20);
  const skip = (page - 1) * limit;
  const [total, data] = await Promise.all([Patient.countDocuments(), Patient.find().sort({ createdAt: -1 }).skip(skip).limit(limit)]);
  res.json({ page, limit, total, data });
});

apiRouter.post("/assign-pg", authMiddleware, requireAssignmentManager, auditLogger("Assignment", "Assign PG"), async (req, res) => {
  const { admissionId, patientId, pgId, shift, isPrimary, remarks } = req.body as {
    admissionId: string;
    patientId: string;
    pgId: string;
    shift?: string;
    isPrimary?: boolean;
    remarks?: string;
  };
  const admission = await Admission.findById(admissionId);
  if (!admission) return res.status(404).json({ message: "Admission not found" });

  if (isPrimary) {
    await PatientAssignment.updateMany({ admissionId, patientId, isActive: true, isPrimary: true }, { $set: { isPrimary: false } });
  }

  const assignment = await PatientAssignment.create({
    admissionId,
    patientId,
    pgId,
    departmentId: admission.get("departmentId"),
    unitId: admission.get("unitId"),
    consultantId: admission.get("consultantId"),
    shift: normalizeShift(shift),
    assignmentType: isPrimary ? "Primary" : "Secondary",
    isPrimary: Boolean(isPrimary),
    isActive: true,
    assignedBy: (req as AuthRequest).user?.id,
    remarks,
    icuTag: Boolean(req.body.icuTag),
  });
  await Admission.findByIdAndUpdate(admissionId, { assignedPgId: pgId });
  res.status(201).json(assignment);
});

apiRouter.post("/activity", authMiddleware, auditLogger("Activity", "Log Activity"), async (req: AuthRequest, res) => {
  const { patientId, pgId, assignmentId, activityTypeId, activityType, remarks, activityDateTime } = req.body as Record<string, string>;
  if (!activityTypeId) return res.status(400).json({ message: "activityTypeId is required" });
  const type = await ActivityType.findById(activityTypeId);
  if (!type) return res.status(400).json({ message: "Invalid activityTypeId" });

  let assignment = null;
  if (assignmentId) {
    assignment = await PatientAssignment.findById(assignmentId);
  } else {
    assignment = await PatientAssignment.findOne({ patientId, pgId, isActive: true }).sort({ assignedAt: -1 });
  }
  if (!assignment) return res.status(400).json({ message: "No active assignment found for this patient and PG" });

  const entry = await PGActivityLog.create({
    patientId,
    pgId,
    assignmentId: assignment.id,
    activityTypeId,
    activityType: activityType || type.get("name"),
    remarks,
    createdAt: normalizeDate(activityDateTime) || new Date(),
    createdBy: req.user?.id,
  });
  res.status(201).json(entry);
});

apiRouter.get("/patient-timeline/:id", authMiddleware, async (req, res) => {
  const rawId = String(req.params.id).trim();
  if (!mongoose.Types.ObjectId.isValid(rawId)) {
    return res.status(400).json({ message: "Invalid patient ID. Choose a patient from the list or paste a valid 24-character MongoDB id." });
  }
  const patientId = toObjectId(rawId);
  const exists = await Patient.exists({ _id: patientId });
  if (!exists) {
    return res.status(404).json({ message: "Patient not found. Create an admission first or pick another patient." });
  }
  const [admissions, activities, procedures, notes, discharge] = await Promise.all([
    Admission.find({ patientId }).lean(),
    PGActivityLog.find({ patientId }).lean(),
    Procedure.find({ patientId }).lean(),
    ProgressNote.find({ patientId }).lean(),
    DischargeSummary.findOne({ patientId }).lean(),
  ]);
  const timeline = [
    ...admissions.map((a) => ({ at: a.createdAt, type: "Admission", data: a })),
    ...(await PatientAssignment.find({ patientId }).lean()).map((a) => ({ at: a.assignedAt, type: "Assignment", data: a })),
    ...activities.map((a) => ({ at: a.createdAt, type: "Activity", data: a })),
    ...procedures.map((p) => ({ at: p.date, type: "Procedure", data: p })),
    ...notes.map((n) => ({ at: n.noteDateTime, type: "ProgressNote", data: n })),
    ...(discharge ? [{ at: discharge.updatedAt, type: "Discharge", data: discharge }] : []),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  res.json(timeline);
});

apiRouter.get("/pg-activities/:pgId", authMiddleware, async (req, res) => {
  res.json(await PGActivityLog.find({ pgId: req.params.pgId }).sort({ createdAt: -1 }).limit(200));
});

apiRouter.post("/procedures", authMiddleware, async (req, res) => res.status(201).json(await Procedure.create(req.body)));
apiRouter.get("/procedures", authMiddleware, async (_req, res) => res.json(await Procedure.find().sort({ date: -1 }).limit(200)));

apiRouter.post("/progress-notes", authMiddleware, async (req, res) => res.status(201).json(await ProgressNote.create(req.body)));
apiRouter.get("/progress-notes", authMiddleware, async (req, res) => {
  const query = req.query.patientId ? { patientId: String(req.query.patientId) } : {};
  res.json(await ProgressNote.find(query).sort({ noteDateTime: -1 }).limit(200));
});

apiRouter.post("/discharge-summaries", authMiddleware, async (req, res) => {
  const data = await DischargeSummary.findOneAndUpdate(
    { patientId: req.body.patientId },
    req.body,
    { upsert: true, new: true },
  );
  res.status(201).json(data);
});

apiRouter.get("/dashboard/pg/:pgId", authMiddleware, async (req, res) => {
  const pgId = req.params.pgId;
  const today = localDayRange(0);
  const yesterday = localDayRange(-1);
  const [myPatients, myActivities, procedureCount, pendingTasks, activitiesToday, activitiesYesterday, assignmentsToday, assignmentsYesterday] =
    await Promise.all([
      PatientAssignment.countDocuments({ pgId, isActive: true }),
      PGActivityLog.countDocuments({ pgId }),
      Procedure.countDocuments({ pgId }),
      ProgressNote.countDocuments({ pgId, delayedEntry: true }),
      PGActivityLog.countDocuments({ pgId, createdAt: { $gte: today.start, $lt: today.end } }),
      PGActivityLog.countDocuments({ pgId, createdAt: { $gte: yesterday.start, $lt: yesterday.end } }),
      PatientAssignment.countDocuments({ pgId, assignedAt: { $gte: today.start, $lt: today.end } }),
      PatientAssignment.countDocuments({ pgId, assignedAt: { $gte: yesterday.start, $lt: yesterday.end } }),
    ]);
  res.json({
    myPatients,
    myActivities,
    procedureCount,
    pendingTasks,
    activitiesToday,
    activitiesYesterday,
    assignmentsToday,
    assignmentsYesterday,
  });
});

apiRouter.get("/dashboard/hod", authMiddleware, requireRoles("HOD", "Admin"), async (_req, res) => {
  const today = localDayRange(0);
  const yesterday = localDayRange(-1);
  const [pgStats, activitiesToday, activitiesYesterday] = await Promise.all([
    PGActivityLog.aggregate([
      { $group: { _id: "$pgId", activityCount: { $sum: 1 } } },
      { $sort: { activityCount: -1 } },
    ]),
    PGActivityLog.countDocuments({ createdAt: { $gte: today.start, $lt: today.end } }),
    PGActivityLog.countDocuments({ createdAt: { $gte: yesterday.start, $lt: yesterday.end } }),
  ]);
  res.json({ pgStats, activitiesToday, activitiesYesterday });
});

apiRouter.get("/dashboard/admin", authMiddleware, requireRoles("Admin"), async (_req, res) => {
  const today = localDayRange(0);
  const yesterday = localDayRange(-1);
  const [
    totalPgUsers,
    patients,
    activities,
    audits,
    pgsActiveToday,
    pgsActiveYesterday,
    patientsToday,
    patientsYesterday,
    activitiesToday,
    activitiesYesterday,
    auditsToday,
    auditsYesterday,
  ] = await Promise.all([
    User.countDocuments({ role: "PG" }),
    Patient.countDocuments(),
    PGActivityLog.countDocuments(),
    AuditLog.countDocuments(),
    PGActivityLog.distinct("pgId", { createdAt: { $gte: today.start, $lt: today.end } }).then((ids) => ids.length),
    PGActivityLog.distinct("pgId", { createdAt: { $gte: yesterday.start, $lt: yesterday.end } }).then((ids) => ids.length),
    Patient.countDocuments({ createdAt: { $gte: today.start, $lt: today.end } }),
    Patient.countDocuments({ createdAt: { $gte: yesterday.start, $lt: yesterday.end } }),
    PGActivityLog.countDocuments({ createdAt: { $gte: today.start, $lt: today.end } }),
    PGActivityLog.countDocuments({ createdAt: { $gte: yesterday.start, $lt: yesterday.end } }),
    AuditLog.countDocuments({ createdAt: { $gte: today.start, $lt: today.end } }),
    AuditLog.countDocuments({ createdAt: { $gte: yesterday.start, $lt: yesterday.end } }),
  ]);
  res.json({
    totalPgUsers,
    pgsActiveToday,
    pgsActiveYesterday,
    patients,
    activities,
    audits,
    patientsToday,
    patientsYesterday,
    activitiesToday,
    activitiesYesterday,
    auditsToday,
    auditsYesterday,
  });
});

apiRouter.get("/analytics/overview", authMiddleware, async (_req, res) => {
  const [casesPerMonth, activityPerPg, proceduresByRole] = await Promise.all([
    Admission.aggregate([
      { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$admissionDate" } }, cases: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    PGActivityLog.aggregate([{ $group: { _id: "$pgId", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    Procedure.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
  ]);
  res.json({ casesPerMonth, activityPerPg, proceduresByRole });
});

apiRouter.post("/assignments", authMiddleware, requireAssignmentManager, auditLogger("Assignment", "Create Assignment"), async (req: AuthRequest, res) => {
  const {
    patientId,
    pgId,
    departmentId,
    unitId,
    consultantId,
    shift,
    assignmentType,
    isPrimary,
    remarks,
    icuTag,
  } = req.body;

  if (isPrimary) {
    await PatientAssignment.updateMany({ patientId, isActive: true, isPrimary: true }, { $set: { isPrimary: false } });
  }

  const latestAdmission = await Admission.findOne({ patientId }).sort({ createdAt: -1 });
  if (!latestAdmission) {
    return res.status(400).json({ message: "No admission found for this patient. Complete Admission Desk entry first." });
  }

  const assignment = await PatientAssignment.create({
    admissionId: latestAdmission._id,
    patientId,
    pgId,
    departmentId: departmentId || latestAdmission.get("departmentId"),
    unitId: unitId || latestAdmission.get("unitId"),
    consultantId: consultantId || latestAdmission.get("consultantId"),
    shift: normalizeShift(shift),
    assignmentType: assignmentType || (isPrimary ? "Primary" : "Secondary"),
    isPrimary: Boolean(isPrimary),
    assignedAt: normalizeDate(req.body.assignedAt) || new Date(),
    isActive: true,
    assignedBy: req.user?.id,
    remarks,
    icuTag: Boolean(icuTag),
  });

  if (Boolean(isPrimary)) {
    await Admission.findByIdAndUpdate(latestAdmission._id, { assignedPgId: pgId });
  }

  res.status(201).json(assignment);
});

apiRouter.patch("/assignments/:id/release", authMiddleware, requireAssignmentManager, auditLogger("Assignment", "Release Assignment"), async (req, res) => {
  const assignment = await PatientAssignment.findByIdAndUpdate(
    req.params.id,
    { isActive: false, releasedAt: normalizeDate(req.body.releasedAt) || new Date() },
    { new: true },
  );
  if (!assignment) return res.status(404).json({ message: "Assignment not found" });
  return res.json(assignment);
});

apiRouter.patch("/assignments/:id/primary", authMiddleware, requireAssignmentManager, auditLogger("Assignment", "Set Primary Assignment"), async (req, res) => {
  const assignment = await PatientAssignment.findById(req.params.id);
  if (!assignment) return res.status(404).json({ message: "Assignment not found" });

  await PatientAssignment.updateMany(
    { patientId: assignment.get("patientId"), isActive: true, isPrimary: true },
    { $set: { isPrimary: false, assignmentType: "Secondary" } },
  );

  assignment.set("isPrimary", true);
  assignment.set("assignmentType", "Primary");
  await assignment.save();
  return res.json(assignment);
});

apiRouter.get("/assignments/history/:patientId", authMiddleware, async (req, res) => {
  const rows = await PatientAssignment.find({ patientId: req.params.patientId })
    .populate("pgId unitId consultantId assignedBy")
    .sort({ assignedAt: -1 });
  res.json(rows);
});

apiRouter.get("/assignments/live-board", authMiddleware, async (_req, res) => {
  const admissions = await Admission.find({ status: "Admitted" }).populate("patientId unitId consultantId").lean();
  const patientIds = admissions.map((a) => String(a.patientId?._id || a.patientId));

  const [assignments, lastActivities] = await Promise.all([
    PatientAssignment.find({ patientId: { $in: patientIds }, isActive: true }).populate("pgId unitId consultantId").lean(),
    PGActivityLog.aggregate([
      { $match: { patientId: { $in: patientIds.map((p) => toObjectId(String(p))) } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: "$patientId", lastActivityAt: { $first: "$createdAt" } } },
    ]),
  ]);

  const activityMap = new Map(lastActivities.map((x) => [String(x._id), x.lastActivityAt]));
  const assignmentMap = assignments.reduce<Record<string, any[]>>((acc, row) => {
    const key = String(row.patientId);
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});

  const now = Date.now();
  const data = admissions.map((a) => {
    const patientId = String(a.patientId?._id || a.patientId);
    const activeAssignments = assignmentMap[patientId] || [];
    const lastActivityAt = activityMap.get(patientId) || null;
    const hoursSinceReview = lastActivityAt ? Math.floor((now - new Date(lastActivityAt).getTime()) / (1000 * 60 * 60)) : null;
    const hasIcu = activeAssignments.some((x) => x.icuTag);
    let status = "Active";
    if (activeAssignments.length === 0) status = "Unassigned";
    else if (hasIcu && (hoursSinceReview === null || hoursSinceReview > 6)) status = "ICU Critical";
    else if (hoursSinceReview !== null && hoursSinceReview > 12) status = "Delayed Review";

    return {
      patientId,
      patientName: (a.patientId as any)?.patientName,
      ipNumber: (a.patientId as any)?.ipNumber,
      unit: (a.unitId as any)?.name || null,
      consultant: (a.consultantId as any)?.fullName || null,
      assignedPgs: activeAssignments.map((x) => ({
        id: x.pgId?._id,
        name: x.pgId?.fullName,
        isPrimary: x.isPrimary,
        shift: x.shift,
      })),
      lastActivityAt,
      hoursSinceReview,
      status,
    };
  });
  res.json(data);
});

apiRouter.get("/monitoring/workload-matrix", authMiddleware, async (_req, res) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const [activeAssignments, todayActivities, delayedReviews, pendingNotes] = await Promise.all([
    PatientAssignment.find({ isActive: true }).populate("pgId").lean(),
    PGActivityLog.aggregate([{ $match: { createdAt: { $gte: start } } }, { $group: { _id: "$pgId", activitiesToday: { $sum: 1 } } }]),
    PGActivityLog.aggregate([
      { $sort: { createdAt: -1 } },
      { $group: { _id: { pgId: "$pgId", patientId: "$patientId" }, lastActivityAt: { $first: "$createdAt" } } },
      { $match: { lastActivityAt: { $lt: new Date(Date.now() - 12 * 60 * 60 * 1000) } } },
      { $group: { _id: "$_id.pgId", delayedReviews: { $sum: 1 } } },
    ]),
    ProgressNote.aggregate([{ $match: { delayedEntry: true } }, { $group: { _id: "$pgId", pendingNotes: { $sum: 1 } } }]),
  ]);

  const activityMap = new Map(todayActivities.map((x) => [String(x._id), x.activitiesToday]));
  const delayedMap = new Map(delayedReviews.map((x) => [String(x._id), x.delayedReviews]));
  const pendingMap = new Map(pendingNotes.map((x) => [String(x._id), x.pendingNotes]));

  const matrix = Object.values(
    activeAssignments.reduce<Record<string, any>>((acc, row) => {
      const pgId = String(row.pgId?._id || row.pgId);
      if (!acc[pgId]) {
        acc[pgId] = {
          pgId,
          pgName: (row.pgId as any)?.fullName || "Unknown PG",
          activePatients: 0,
          icuPatients: 0,
          activitiesToday: activityMap.get(pgId) || 0,
          pendingNotes: pendingMap.get(pgId) || 0,
          delayedReviews: delayedMap.get(pgId) || 0,
        };
      }
      acc[pgId].activePatients += 1;
      if (row.icuTag) acc[pgId].icuPatients += 1;
      return acc;
    }, {}),
  ).map((x: any) => ({
    ...x,
    overloaded: x.activePatients > 12 || x.delayedReviews > 3,
    inactive: x.activitiesToday === 0,
  }));

  res.json(matrix);
});

apiRouter.get("/monitoring/alerts", authMiddleware, async (_req, res) => {
  const alerts: Array<{ type: string; severity: "high" | "medium"; message: string }> = [];
  const admissions = await Admission.find({ status: "Admitted" }).populate("patientId").lean();
  const patientIds = admissions.map((a) => String(a.patientId?._id || a.patientId));
  const assignments = await PatientAssignment.find({ patientId: { $in: patientIds }, isActive: true }).lean();

  admissions.forEach((a) => {
    const patientId = String(a.patientId?._id || a.patientId);
    const active = assignments.filter((x) => String(x.patientId) === patientId);
    if (active.length === 0) {
      alerts.push({ type: "Unassigned", severity: "high", message: `${(a.patientId as any)?.patientName || patientId} is unassigned` });
    }
    if (active.some((x) => x.icuTag)) {
      alerts.push({ type: "ICU", severity: "medium", message: `${(a.patientId as any)?.patientName || patientId} has ICU allocation` });
    }
  });

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const workload = await PGActivityLog.aggregate([
    { $match: { createdAt: { $gte: start } } },
    { $group: { _id: "$pgId", activitiesToday: { $sum: 1 } } },
  ]);
  const activePerPg = assignments.reduce<Record<string, number>>((acc, x) => {
    const pgId = String(x.pgId);
    acc[pgId] = (acc[pgId] || 0) + 1;
    return acc;
  }, {});
  Object.entries(activePerPg).forEach(([pgId, activeCount]) => {
    const row = workload.find((x) => String(x._id) === pgId);
    if (activeCount > 12) alerts.push({ type: "PG Overloaded", severity: "high", message: `PG ${pgId} has ${activeCount} active patients` });
    if (!row || row.activitiesToday === 0) alerts.push({ type: "PG Inactive", severity: "medium", message: `PG ${pgId} has no activity today` });
  });

  res.json(alerts);
});

apiRouter.get("/reports/pg-activity", authMiddleware, async (req, res) => {
  const format = (req.query.format as string) || "json";
  const reportQuery: Record<string, unknown> = {};
  const from = typeof req.query.from === "string" ? req.query.from.trim() : "";
  const to = typeof req.query.to === "string" ? req.query.to.trim() : "";
  const pgId = typeof req.query.pgId === "string" ? req.query.pgId.trim() : "";
  const activityTypeId = typeof req.query.activityTypeId === "string" ? req.query.activityTypeId.trim() : "";

  const [selectedPg, selectedActivityType] = await Promise.all([
    pgId ? User.findById(pgId).select("fullName username").lean() : Promise.resolve(null),
    activityTypeId ? ActivityType.findById(activityTypeId).select("name").lean() : Promise.resolve(null),
  ]);
  const filterSummary = [
    from ? `From: ${from}` : "From: Any",
    to ? `To: ${to}` : "To: Any",
    selectedPg ? `PG: ${selectedPg.fullName || selectedPg.username}` : "PG: All",
    selectedActivityType ? `Activity: ${selectedActivityType.name}` : "Activity: All",
  ].join(" | ");

  if (from || to) {
    const createdAt: Record<string, Date> = {};
    if (from) {
      const fromDate = new Date(from);
      if (!Number.isNaN(fromDate.getTime())) {
        createdAt.$gte = fromDate;
      }
    }
    if (to) {
      const toDate = new Date(to);
      if (!Number.isNaN(toDate.getTime())) {
        // Include full end date by setting end-of-day
        toDate.setHours(23, 59, 59, 999);
        createdAt.$lte = toDate;
      }
    }
    if (Object.keys(createdAt).length > 0) {
      reportQuery.createdAt = createdAt;
    }
  }
  if (pgId) reportQuery.pgId = pgId;
  if (activityTypeId) reportQuery.activityTypeId = activityTypeId;

  const rows = await PGActivityLog.find(reportQuery).sort({ createdAt: -1 }).limit(500).lean();
  const patientIds = Array.from(new Set(rows.map((r: any) => String(r.patientId)).filter(Boolean)));
  const pgIds = Array.from(new Set(rows.map((r: any) => String(r.pgId)).filter(Boolean)));
  const assignmentIds = Array.from(
    new Set(rows.map((r: any) => r.assignmentId).filter(Boolean).map((id: unknown) => String(id))),
  );

  const [patients, pgs, assignments, admissions] = await Promise.all([
    patientIds.length > 0 ? Patient.find({ _id: { $in: patientIds } }).select("ipNumber patientName").lean() : Promise.resolve([]),
    pgIds.length > 0 ? User.find({ _id: { $in: pgIds } }).select("fullName username").lean() : Promise.resolve([]),
    assignmentIds.length > 0
      ? PatientAssignment.find({ _id: { $in: assignmentIds } }).select("departmentId unitId patientId").lean()
      : Promise.resolve([]),
    patientIds.length > 0
      ? Admission.find({ patientId: { $in: patientIds } })
          .select("patientId departmentId unitId createdAt")
          .sort({ createdAt: -1 })
          .lean()
      : Promise.resolve([]),
  ]);

  const assignmentById = new Map<string, { departmentId?: unknown; unitId?: unknown }>(
    (assignments as any[]).map((a) => [String(a._id), a]),
  );
  const latestAdmissionByPatient = new Map<string, { departmentId?: unknown; unitId?: unknown }>();
  for (const a of admissions as any[]) {
    const pid = String(a.patientId);
    if (!latestAdmissionByPatient.has(pid)) latestAdmissionByPatient.set(pid, a);
  }

  const deptIdSet = new Set<string>();
  const unitIdSet = new Set<string>();
  for (const a of assignments as any[]) {
    if (a.departmentId) deptIdSet.add(String(a.departmentId));
    if (a.unitId) unitIdSet.add(String(a.unitId));
  }
  for (const a of latestAdmissionByPatient.values()) {
    if (a.departmentId) deptIdSet.add(String(a.departmentId));
    if (a.unitId) unitIdSet.add(String(a.unitId));
  }

  const [depts, units] = await Promise.all([
    deptIdSet.size > 0 ? Department.find({ _id: { $in: [...deptIdSet] } }).select("name").lean() : Promise.resolve([]),
    unitIdSet.size > 0 ? Unit.find({ _id: { $in: [...unitIdSet] } }).select("name").lean() : Promise.resolve([]),
  ]);
  const deptById = new Map<string, string>((depts as any[]).map((d) => [String(d._id), String(d.name || "")]));
  const unitById = new Map<string, string>((units as any[]).map((u) => [String(u._id), String(u.name || "")]));

  const patientById = new Map<string, { ipNumber?: string; patientName?: string }>(
    patients.map((p: any) => [String(p._id), { ipNumber: p.ipNumber, patientName: p.patientName }]),
  );
  const pgById = new Map<string, { fullName?: string; username?: string }>(
    pgs.map((u: any) => [String(u._id), { fullName: u.fullName, username: u.username }]),
  );

  const resolveDeptUnit = (r: any) => {
    const ass = r.assignmentId ? assignmentById.get(String(r.assignmentId)) : undefined;
    const adm = latestAdmissionByPatient.get(String(r.patientId));
    const deptId = ass?.departmentId ?? adm?.departmentId;
    const unitId = ass?.unitId ?? adm?.unitId;
    const department = deptId ? deptById.get(String(deptId)) || "—" : "—";
    const unit = unitId ? unitById.get(String(unitId)) || "—" : "—";
    return { department, unit };
  };

  const formattedRows: PgActivityFormattedRow[] = rows.map((r: any) => {
    const patient = patientById.get(String(r.patientId));
    const pg = pgById.get(String(r.pgId));
    const { department, unit } = resolveDeptUnit(r);
    const created = r.createdAt ? new Date(r.createdAt).getTime() : 0;
    return {
      patientId: String(r.patientId),
      sortAt: created,
      patient: patient?.patientName || "Unknown Patient",
      ipNumber: patient?.ipNumber || String(r.patientId),
      department,
      unit,
      pg: pg?.fullName || pg?.username || String(r.pgId),
      activity: r.activityType || "-",
      dateTime: r.createdAt ? new Date(r.createdAt).toLocaleString("en-IN") : "-",
      remarks: r.remarks || "-",
    };
  });

  const activityGroups = groupPgActivityByPatient(formattedRows);

  if (format === "excel") {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("PG Activity");
    sheet.columns = [
      { key: "dateTime", width: 24 },
      { key: "patient", width: 26 },
      { key: "ipNumber", width: 18 },
      { key: "department", width: 22 },
      { key: "unit", width: 22 },
      { key: "pg", width: 24 },
      { key: "activity", width: 24 },
      { key: "remarks", width: 36 },
    ];

    sheet.addRow(["PG Activity Report"]);
    sheet.mergeCells("A1:H1");
    sheet.getCell("A1").font = { bold: true, size: 14 };

    sheet.addRow([`Filters: ${filterSummary}`]);
    sheet.mergeCells("A2:H2");
    sheet.getCell("A2").font = { size: 10 };

    sheet.addRow([]);

    const thinBorder = {
      top: { style: "thin" as const, color: { argb: "FFCBD5E1" } },
      left: { style: "thin" as const, color: { argb: "FFCBD5E1" } },
      bottom: { style: "thin" as const, color: { argb: "FFCBD5E1" } },
      right: { style: "thin" as const, color: { argb: "FFCBD5E1" } },
    };

    sheet.addRow({
      dateTime: "Date Time",
      patient: "Patient",
      ipNumber: "IP Number",
      department: "Department",
      unit: "Unit",
      pg: "PG",
      activity: "Activity",
      remarks: "Remarks",
    });
    const columnHeaderRow = sheet.getRow(4);
    columnHeaderRow.height = 22;
    columnHeaderRow.font = { bold: true, color: { argb: "FF0F172A" } };
    columnHeaderRow.alignment = { vertical: "middle" as const, horizontal: "left" as const };
    columnHeaderRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
      cell.border = thinBorder;
    });

    if (formattedRows.length === 0) {
      const empty = sheet.addRow({
        dateTime: "No records found for selected filters.",
        patient: "",
        ipNumber: "",
        department: "",
        unit: "",
        pg: "",
        activity: "",
        remarks: "",
      });
      sheet.mergeCells(`A${empty.number}:H${empty.number}`);
      empty.getCell(1).alignment = { horizontal: "left" };
    } else {
      for (const g of activityGroups) {
        const band = sheet.addRow([`Patient: ${g.patient}  •  IP: ${g.ipNumber}`]);
        sheet.mergeCells(`A${band.number}:H${band.number}`);
        band.height = 22;
        band.getCell(1).font = { bold: true, size: 11, color: { argb: "FF0F172A" } };
        band.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCBD5E1" } };
        band.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
        band.getCell(1).border = thinBorder;

        let zebraInGroup = 0;
        for (const r of g.rows) {
          const dataRow = sheet.addRow({
            dateTime: r.dateTime,
            patient: "",
            ipNumber: r.ipNumber,
            department: r.department,
            unit: r.unit,
            pg: r.pg,
            activity: r.activity,
            remarks: r.remarks,
          });
          const zebra = zebraInGroup % 2 === 1;
          zebraInGroup += 1;
          dataRow.eachCell({ includeEmpty: true }, (cell) => {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: zebra ? "FFF8FAFC" : "FFFFFFFF" },
            };
            cell.border = {
              ...thinBorder,
              bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
            };
          });
        }
      }
    }

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=pg-activity-report.xlsx");
    await workbook.xlsx.write(res);
    return res.end();
  }
  if (format === "pdf") {
    const doc = new PDFDocument({ margin: 28, size: "A4" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=pg-activity-report.pdf");
    doc.pipe(res);

    doc.fontSize(16).text("PG Activity Report", { align: "left" });
    doc.moveDown(0.2);
    doc.fontSize(9).fillColor("#475569").text(`Filters: ${filterSummary}`);
    doc.fillColor("#000000");
    doc.moveDown(0.5);

    const x = { dt: 28, patient: 110, dept: 194, unit: 252, pg: 310, activity: 362, ip: 408 };
    const w = { dt: 82, patient: 84, dept: 58, unit: 58, pg: 52, activity: 46, ip: 56 };
    const tableLeft = 28;
    const tableRight = 565;
    const tableWidth = tableRight - tableLeft;
    const headerBandPad = 6;
    const headerLabelBaseline = 11;
    const headerRowHeight = 14;
    const rowLineGap = 1;
    const rowPaddingBottom = 6;
    const rowPadTop = 6;
    const rowPadBottom = 7;
    const borderHair = 0.35;
    const pageBottom = doc.page.height - 48;
    const colors = {
      headerBg: "#e2e8f0",
      headerText: "#0f172a",
      headerRule: "#94a3b8",
      rowOdd: "#ffffff",
      rowEven: "#f8fafc",
      bodyText: "#334155",
      rowRule: "#e2e8f0",
    };

    const pdfActivityRowHeight = (r: PgActivityFormattedRow) => {
      doc.fontSize(8.5).font("Helvetica");
      const cells = [
        String(r.dateTime),
        String(r.patient),
        String(r.department),
        String(r.unit),
        String(r.pg),
        String(r.activity),
        String(r.ipNumber),
      ];
      const widths = [w.dt, w.patient, w.dept, w.unit, w.pg, w.activity, w.ip];
      let maxH = 11;
      for (let i = 0; i < cells.length; i++) {
        const h = doc.heightOfString(cells[i], { width: widths[i], lineGap: rowLineGap });
        maxH = Math.max(maxH, h);
      }
      return Math.ceil(maxH) + rowPaddingBottom;
    };

    const patientBannerOuter = 34;

    const drawHeader = () => {
      const headerTop = doc.y;
      const bandH = headerBandPad * 2 + headerRowHeight;
      doc.save();
      doc.rect(tableLeft, headerTop, tableWidth, bandH).fill(colors.headerBg);
      doc.restore();

      const headerTextY = headerTop + headerBandPad + headerLabelBaseline;
      doc.fontSize(9).font("Helvetica-Bold").fillColor(colors.headerText);
      doc.text("Date & Time", x.dt, headerTextY, { width: w.dt, lineBreak: false });
      doc.text("Patient", x.patient, headerTextY, { width: w.patient, lineBreak: false });
      doc.text("Department", x.dept, headerTextY, { width: w.dept, lineBreak: false });
      doc.text("Unit", x.unit, headerTextY, { width: w.unit, lineBreak: false });
      doc.text("PG", x.pg, headerTextY, { width: w.pg, lineBreak: false });
      doc.text("Activity", x.activity, headerTextY, { width: w.activity, lineBreak: false });
      doc.text("IP", x.ip, headerTextY, { width: w.ip, lineBreak: false });

      const headerBottom = headerTop + bandH;
      doc.save();
      doc.lineWidth(borderHair + 0.15);
      doc.moveTo(tableLeft, headerBottom).lineTo(tableRight, headerBottom).strokeColor(colors.headerRule).stroke();
      doc.restore();

      doc.y = headerBottom + 8;
      doc.font("Helvetica").fillColor(colors.bodyText);
    };

    const drawPatientBanner = (patient: string, ip: string) => {
      if (doc.y + patientBannerOuter > pageBottom) {
        doc.addPage();
        drawHeader();
      }
      const top = doc.y;
      doc.fontSize(10).font("Helvetica-Bold").fillColor(colors.headerText);
      doc.text(`Patient: ${patient}    •    IP: ${ip}`, tableLeft, top + 4, { width: tableWidth });
      const ruleY = top + 22;
      doc.save();
      doc.lineWidth(borderHair + 0.2);
      doc.moveTo(tableLeft, ruleY).lineTo(tableRight, ruleY).strokeColor(colors.headerRule).stroke();
      doc.restore();
      doc.y = ruleY + 10;
      doc.font("Helvetica").fillColor(colors.bodyText);
    };

    drawHeader();
    if (formattedRows.length === 0) {
      const message = "No records found for selected filters.";
      const messageWidth = 260;
      const xPos = (doc.page.width - messageWidth) / 2;
      const yPos = doc.page.height / 2 - 10;
      doc.fontSize(12).fillColor("#64748b").text(message, xPos, yPos, {
        width: messageWidth,
        align: "center",
      });
      doc.fillColor("#000000");
      doc.end();
      return;
    }

    const maxPdfActivities = 120;
    let pdfActivitiesDrawn = 0;

    for (const g of activityGroups) {
      if (pdfActivitiesDrawn >= maxPdfActivities) break;

      drawPatientBanner(g.patient, g.ipNumber);

      let pdfRowIndex = 0;
      for (const r of g.rows) {
        if (pdfActivitiesDrawn >= maxPdfActivities) break;

        const rowForPdf: PgActivityFormattedRow = { ...r, patient: "" };
        const contentH = pdfActivityRowHeight(rowForPdf);
        const totalRowH = rowPadTop + contentH + rowPadBottom;
        if (doc.y + totalRowH > pageBottom) {
          doc.addPage();
          drawHeader();
          drawPatientBanner(g.patient, g.ipNumber);
        }

        const rowTop = doc.y;
        const zebra = pdfRowIndex % 2 === 1;
        doc.save();
        doc.rect(tableLeft, rowTop, tableWidth, totalRowH).fill(zebra ? colors.rowEven : colors.rowOdd);
        doc.restore();

        const contentTop = rowTop + rowPadTop;
        doc.fontSize(8.5).font("Helvetica").fillColor(colors.bodyText);
        const placeCell = (text: string, colX: number, colW: number) => {
          doc.text(String(text), colX, contentTop, { width: colW, lineGap: rowLineGap });
          doc.y = contentTop;
        };
        placeCell(r.dateTime, x.dt, w.dt);
        placeCell("", x.patient, w.patient);
        placeCell(r.department, x.dept, w.dept);
        placeCell(r.unit, x.unit, w.unit);
        placeCell(r.pg, x.pg, w.pg);
        placeCell(r.activity, x.activity, w.activity);
        placeCell(r.ipNumber, x.ip, w.ip);

        const ruleY = rowTop + totalRowH;
        doc.save();
        doc.lineWidth(borderHair);
        doc.moveTo(tableLeft, ruleY).lineTo(tableRight, ruleY).strokeColor(colors.rowRule).stroke();
        doc.restore();

        doc.y = ruleY + 5;
        doc.fillColor(colors.bodyText);
        pdfRowIndex += 1;
        pdfActivitiesDrawn += 1;
      }
    }
    doc.end();
    return;
  }

  const jsonActivities = activityGroups.map((g) => ({
    patient: g.patient,
    ipNumber: g.ipNumber,
    activities: g.rows.map(({ patientId: _pid, sortAt: _s, ...rest }) => rest),
  }));
  return res.json({
    filterSummary,
    groups: jsonActivities,
    rows: formattedRows.map(({ patientId: _pid, sortAt: _s, ...rest }) => rest),
  });
});

apiRouter.get("/audit-logs", authMiddleware, requireRoles("Admin", "MRD"), async (req, res) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 20);
  const skip = (page - 1) * limit;
  const [total, data] = await Promise.all([
    AuditLog.countDocuments(),
    AuditLog.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
  ]);

  const refValues = new Set<string>();
  for (const row of data as Array<Record<string, any>>) {
    const patientRef = typeof row.patientRef === "string" ? row.patientRef.trim() : "";
    const metaPatientId = typeof row.meta?.patientId === "string" ? row.meta.patientId.trim() : "";
    const metaIp = typeof row.meta?.patient?.ipNumber === "string" ? row.meta.patient.ipNumber.trim() : "";
    if (patientRef) refValues.add(patientRef);
    if (metaPatientId) refValues.add(metaPatientId);
    if (metaIp) refValues.add(metaIp);
  }

  const refs = Array.from(refValues);
  const objectIdRefs = refs.filter((v) => /^[a-f0-9]{24}$/i.test(v));
  const ipRefs = refs.filter((v) => !/^[a-f0-9]{24}$/i.test(v));

  const [patientsById, patientsByIp] = await Promise.all([
    objectIdRefs.length > 0 ? Patient.find({ _id: { $in: objectIdRefs } }).select("ipNumber patientName").lean() : Promise.resolve([]),
    ipRefs.length > 0 ? Patient.find({ ipNumber: { $in: ipRefs } }).select("ipNumber patientName").lean() : Promise.resolve([]),
  ]);

  const patientLabelByRef = new Map<string, string>();
  for (const p of patientsById) {
    const label = `${p.ipNumber} - ${p.patientName}`;
    patientLabelByRef.set(String(p._id), label);
    patientLabelByRef.set(String(p.ipNumber), label);
  }
  for (const p of patientsByIp) {
    const label = `${p.ipNumber} - ${p.patientName}`;
    patientLabelByRef.set(String(p.ipNumber), label);
    patientLabelByRef.set(String(p._id), label);
  }

  const enriched = (data as Array<Record<string, any>>).map((row) => {
    const metaPatient = row.meta?.patient as Record<string, any> | undefined;
    const metaPatientDisplay =
      typeof metaPatient?.ipNumber === "string" && typeof metaPatient?.patientName === "string"
        ? `${metaPatient.ipNumber} - ${metaPatient.patientName}`
        : null;
    const candidates = [
      typeof row.patientRef === "string" ? row.patientRef : "",
      typeof row.meta?.patientId === "string" ? row.meta.patientId : "",
      typeof metaPatient?.ipNumber === "string" ? metaPatient.ipNumber : "",
    ].filter(Boolean);
    const resolved = metaPatientDisplay || candidates.map((c) => patientLabelByRef.get(c)).find(Boolean) || null;
    return { ...row, patientDisplay: resolved };
  });

  res.json({ total, page, limit, data: enriched });
});

