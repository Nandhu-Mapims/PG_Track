import { Router, Request, Response } from "express";
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
import { AuthRequest, auditLogger, authMiddleware, requireRoles, signToken } from "./middleware";

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

apiRouter.post("/assign-pg", authMiddleware, auditLogger("Assignment", "Assign PG"), async (req, res) => {
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
  const { patientId, pgId, assignmentId, activityTypeId, activityType, remarks } = req.body as Record<string, string>;
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
    createdBy: req.user?.id,
  });
  res.status(201).json(entry);
});

apiRouter.get("/patient-timeline/:id", authMiddleware, async (req, res) => {
  const patientId = toObjectId(String(req.params.id));
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
  const [myPatients, myActivities, procedureCount, pendingTasks] = await Promise.all([
    PatientAssignment.countDocuments({ pgId, isActive: true }),
    PGActivityLog.countDocuments({ pgId }),
    Procedure.countDocuments({ pgId }),
    ProgressNote.countDocuments({ pgId, delayedEntry: true }),
  ]);
  res.json({ myPatients, myActivities, procedureCount, pendingTasks });
});

apiRouter.get("/dashboard/hod", authMiddleware, requireRoles("HOD", "Admin"), async (_req, res) => {
  const pgStats = await PGActivityLog.aggregate([
    { $group: { _id: "$pgId", activityCount: { $sum: 1 } } },
    { $sort: { activityCount: -1 } },
  ]);
  res.json({ pgStats });
});

apiRouter.get("/dashboard/admin", authMiddleware, requireRoles("Admin"), async (_req, res) => {
  const [users, patients, activities, audits] = await Promise.all([
    User.countDocuments(),
    Patient.countDocuments(),
    PGActivityLog.countDocuments(),
    AuditLog.countDocuments(),
  ]);
  res.json({ users, patients, activities, audits });
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

apiRouter.post("/assignments", authMiddleware, auditLogger("Assignment", "Create Assignment"), async (req: AuthRequest, res) => {
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
  const assignment = await PatientAssignment.create({
    admissionId: latestAdmission?._id,
    patientId,
    pgId,
    departmentId,
    unitId,
    consultantId,
    shift: normalizeShift(shift),
    assignmentType: assignmentType || (isPrimary ? "Primary" : "Secondary"),
    isPrimary: Boolean(isPrimary),
    assignedAt: normalizeDate(req.body.assignedAt) || new Date(),
    isActive: true,
    assignedBy: req.user?.id,
    remarks,
    icuTag: Boolean(icuTag),
  });

  res.status(201).json(assignment);
});

apiRouter.patch("/assignments/:id/release", authMiddleware, auditLogger("Assignment", "Release Assignment"), async (req, res) => {
  const assignment = await PatientAssignment.findByIdAndUpdate(
    req.params.id,
    { isActive: false, releasedAt: normalizeDate(req.body.releasedAt) || new Date() },
    { new: true },
  );
  if (!assignment) return res.status(404).json({ message: "Assignment not found" });
  return res.json(assignment);
});

apiRouter.patch("/assignments/:id/primary", authMiddleware, auditLogger("Assignment", "Set Primary Assignment"), async (req, res) => {
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
  const rows = await PGActivityLog.find().sort({ createdAt: -1 }).limit(500).lean();
  if (format === "excel") {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("PG Activity");
    sheet.columns = [
      { header: "Patient ID", key: "patientId", width: 30 },
      { header: "PG ID", key: "pgId", width: 30 },
      { header: "Activity", key: "activityType", width: 30 },
      { header: "Date Time", key: "createdAt", width: 30 },
      { header: "Remarks", key: "remarks", width: 40 },
    ];
    rows.forEach((r) => sheet.addRow(r));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=pg-activity-report.xlsx");
    await workbook.xlsx.write(res);
    return res.end();
  }
  if (format === "pdf") {
    const doc = new PDFDocument({ margin: 30, size: "A4" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=pg-activity-report.pdf");
    doc.pipe(res);
    doc.fontSize(16).text("PG Activity Report");
    doc.moveDown();
    rows.slice(0, 40).forEach((r) => {
      doc.fontSize(10).text(`${r.createdAt} | ${r.activityType} | PG ${r.pgId} | Patient ${r.patientId}`);
    });
    doc.end();
    return;
  }
  return res.json(rows);
});

apiRouter.get("/audit-logs", authMiddleware, requireRoles("Admin", "MRD"), async (req, res) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 20);
  const skip = (page - 1) * limit;
  const [total, data] = await Promise.all([
    AuditLog.countDocuments(),
    AuditLog.find().sort({ createdAt: -1 }).skip(skip).limit(limit),
  ]);
  res.json({ total, page, limit, data });
});

