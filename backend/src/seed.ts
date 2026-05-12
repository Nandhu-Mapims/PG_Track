import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dns from "node:dns";
import {
  ActivityType,
  Admission,
  Department,
  Patient,
  PatientAssignment,
  PGActivityLog,
  PGMaster,
  Procedure,
  ProgressNote,
  Unit,
  User,
} from "./models";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/pg_tracking";
const DNS_SERVERS = (process.env.DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const DEMO_REMARK_ASSIGN = "SEED_DEMO_ASSIGN";
const DAYS_AGO = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);

async function seed() {
  if (DNS_SERVERS.length > 0) {
    dns.setServers(DNS_SERVERS);
  }
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB for seeding");

  const adminPassword = await bcrypt.hash("admin123", 10);
  const consultantPassword = await bcrypt.hash("consult123", 10);
  const pgPassword = await bcrypt.hash("pg123456", 10);
  const mrdPassword = await bcrypt.hash("mrd12345", 10);

  const medicine = await Department.findOneAndUpdate(
    { code: "MED" },
    { name: "General Medicine", code: "MED", hodName: "Dr. HOD Medicine", status: "Active" },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const surgery = await Department.findOneAndUpdate(
    { code: "SUR" },
    { name: "General Surgery", code: "SUR", hodName: "Dr. HOD Surgery", status: "Active" },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const admin = await User.findOneAndUpdate(
    { username: "admin" },
    {
      username: "admin",
      password: adminPassword,
      fullName: "System Admin",
      role: "Admin",
      status: "Active",
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const hodPassword = await bcrypt.hash("hod12345", 10);
  await User.findOneAndUpdate(
    { username: "hod1" },
    {
      username: "hod1",
      password: hodPassword,
      fullName: "Dr. Head of Department",
      role: "HOD",
      departmentId: medicine._id,
      status: "Active",
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  await User.findOneAndUpdate(
    { username: "mrd1" },
    {
      username: "mrd1",
      password: mrdPassword,
      fullName: "MRD Records",
      role: "MRD",
      status: "Active",
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const consultant = await User.findOneAndUpdate(
    { username: "consultant1" },
    {
      username: "consultant1",
      password: consultantPassword,
      fullName: "Dr. Consultant One",
      role: "Consultant",
      departmentId: medicine._id,
      status: "Active",
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const pg1 = await User.findOneAndUpdate(
    { username: "pg1" },
    {
      username: "pg1",
      password: pgPassword,
      fullName: "Dr. PG One",
      role: "PG",
      departmentId: medicine._id,
      status: "Active",
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const pg2 = await User.findOneAndUpdate(
    { username: "pg2" },
    {
      username: "pg2",
      password: pgPassword,
      fullName: "Dr. PG Two",
      role: "PG",
      departmentId: surgery._id,
      status: "Active",
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  await PGMaster.findOneAndUpdate(
    { userId: pg1._id },
    { userId: pg1._id, yearOfResidency: 2, joiningDate: new Date("2025-01-10") },
    { upsert: true, new: true },
  );

  await PGMaster.findOneAndUpdate(
    { userId: pg2._id },
    { userId: pg2._id, yearOfResidency: 1, joiningDate: new Date("2026-03-01") },
    { upsert: true, new: true },
  );

  const unitMedA = await Unit.findOneAndUpdate(
    { name: "Unit A", departmentId: medicine._id },
    { name: "Unit A", departmentId: medicine._id, consultantId: consultant._id, status: "Active" },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  await Unit.findOneAndUpdate(
    { name: "Unit B", departmentId: surgery._id },
    { name: "Unit B", departmentId: surgery._id, status: "Active" },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const activityTypeNames = [
    "Admission Assessment",
    "Progress Note",
    "Consultant Round",
    "Procedure Assist",
    "ICU Review",
    "Referral",
    "Discharge Summary",
    "Emergency Review",
  ];
  const activityTypes: Record<string, mongoose.Types.ObjectId> = {};
  for (const name of activityTypeNames) {
    const row = await ActivityType.findOneAndUpdate(
      { name },
      { name, status: "Active" },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    activityTypes[name] = row._id as mongoose.Types.ObjectId;
  }

  // --- Demo patients & clinical data (safe to re-run) ---
  const demoPatients = [
    { ipNumber: "DEMO-IP1001", patientName: "R. Kumar", age: 48, gender: "Male" as const },
    { ipNumber: "DEMO-IP1002", patientName: "Anita Sharma", age: 36, gender: "Female" as const },
    { ipNumber: "DEMO-IP1003", patientName: "Vikram Mehta", age: 62, gender: "Male" as const },
  ];

  const wardKeys = ["SEED-A1", "SEED-A2", "SEED-A3"];

  async function upsertAdmissionAndMaybeAssign(
    index: number,
    assignPg: { _id: mongoose.Types.ObjectId } | null,
    extras: { icu?: boolean } = {},
  ) {
    const spec = demoPatients[index];
    const patient = await Patient.findOneAndUpdate(
      { ipNumber: spec.ipNumber },
      { ...spec },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const admission = await Admission.findOneAndUpdate(
      { patientId: patient._id, wardBedNumber: wardKeys[index] },
      {
        patientId: patient._id,
        departmentId: medicine._id,
        unitId: unitMedA._id,
        consultantId: consultant._id,
        admissionDate: DAYS_AGO(6 - index),
        wardBedNumber: wardKeys[index],
        status: "Admitted" as const,
        assignedPgId: assignPg?._id,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    let assignment = null as Awaited<ReturnType<(typeof PatientAssignment)["findOne"]>>;
    if (assignPg) {
      assignment = await PatientAssignment.findOne({
        patientId: patient._id,
        admissionId: admission._id,
        pgId: assignPg._id,
        remarks: DEMO_REMARK_ASSIGN,
      });

      if (!assignment) {
        assignment = await PatientAssignment.create({
          admissionId: admission._id,
          patientId: patient._id,
          pgId: assignPg._id,
          departmentId: medicine._id,
          unitId: unitMedA._id,
          consultantId: consultant._id,
          shift: index === 0 ? "Morning" : "General",
          assignmentType: "Primary",
          isPrimary: true,
          assignedAt: DAYS_AGO(5 - index),
          isActive: true,
          assignedBy: admin._id,
          remarks: DEMO_REMARK_ASSIGN,
          icuTag: Boolean(extras.icu),
        });
      } else if (extras.icu && !assignment.icuTag) {
        assignment.set("icuTag", true);
        await assignment.save();
      }

      await Admission.findByIdAndUpdate(admission._id, { assignedPgId: assignPg._id });
    }

    return { patient, admission, assignment };
  }

  const ctx1 = await upsertAdmissionAndMaybeAssign(0, pg1, { icu: false });
  const ctx2 = await upsertAdmissionAndMaybeAssign(1, pg2, { icu: false });

  await upsertAdmissionAndMaybeAssign(2, null);

  const logs = [
    { key: "SEED_ACT_ROUND", ctx: ctx1, typeName: "Consultant Round", daysAgo: 4 },
    { key: "SEED_ACT_NOTE", ctx: ctx1, typeName: "Progress Note", daysAgo: 3 },
    { key: "SEED_ACT_EMERGENCY", ctx: ctx2, typeName: "Emergency Review", daysAgo: 2 },
  ];

  for (const row of logs) {
    if (!row.ctx.assignment) continue;
    const exists = await PGActivityLog.findOne({ patientId: row.ctx.patient._id, remarks: row.key });
    if (!exists) {
      const typeId = activityTypes[row.typeName];
      await PGActivityLog.create({
        patientId: row.ctx.patient._id,
        pgId: row.ctx.assignment.pgId,
        assignmentId: row.ctx.assignment._id,
        activityTypeId: typeId,
        activityType: row.typeName,
        remarks: row.key,
        createdBy: row.ctx.assignment.pgId,
        createdAt: DAYS_AGO(row.daysAgo),
        updatedAt: DAYS_AGO(row.daysAgo),
      });
    }
  }

  const noteSeed = "SEED_DEMO_PROGRESS_NOTE";
  if (!(await ProgressNote.findOne({ patientId: ctx1.patient._id, noteContent: /^SEED_DEMO_PROGRESS_NOTE/ }))) {
    await ProgressNote.create({
      patientId: ctx1.patient._id,
      pgId: pg1._id,
      noteContent: `${noteSeed}: Patient tolerating meds; plan to ambulate.`,
      noteDateTime: DAYS_AGO(4),
      delayedEntry: false,
    });
  }

  const procSeed = "[SEED] Peripheral IV placement";
  if (!(await Procedure.exists({ patientId: ctx2.patient._id, procedureName: procSeed }))) {
    await Procedure.create({
      procedureName: procSeed,
      patientId: ctx2.patient._id,
      pgId: pg2._id,
      role: "Assisted",
      date: DAYS_AGO(5),
      consultantId: consultant._id,
    });
  }

  console.log("");
  console.log("Seed completed.");
  console.log(
    "  Demo logins: admin / admin123  |  mrd1 / mrd12345  |  consultant1 / consult123  |  pg1, pg2 / pg123456",
  );
  console.log("  Patients: DEMO-IP1001 R. Kumar (assigned pg1), DEMO-IP1002 Anita Sharma (pg2), DEMO-IP1003 Vikram Mehta (unassigned)");
  console.log("");
  await mongoose.disconnect();
}

seed().catch(async (err) => {
  console.error("Seed failed", err);
  await mongoose.disconnect();
  process.exit(1);
});
