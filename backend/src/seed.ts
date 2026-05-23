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
  DischargeSummary,
  PGActivityLog,
  PGMaster,
  Procedure,
  ProgressNote,
  Unit,
  User,
} from "./models";
import { deleteJunkPatients } from "./completedCasesService";
import {
  departmentSharesCanonicalKey,
  findCanonicalPediatricsDepartment,
  isPediatricsDepartmentName,
  mergePediatricsDepartmentDuplicates,
} from "./departmentAliases";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/pg_tracking";
const DNS_SERVERS = (process.env.DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const CORE_DEPT_CODES = new Set(["MED", "SUR", "PED", "ORT", "OBG"]);

/** Remove legacy seed demo patients and other junk test rows. */
async function removeSeededDemoPatients(): Promise<number> {
  const removed = await deleteJunkPatients();
  await Admission.deleteMany({ wardBedNumber: { $regex: /^SEED-/ } });
  return removed;
}

const TARGET_PGS_PER_EXTRA_DEPT = 3;

type PgSeedSpec = {
  username: string;
  fullName: string;
  departmentId: mongoose.Types.ObjectId;
  yearOfResidency: number;
  joiningDate: Date;
  email: string;
  mobileNumber: string;
};

type PgResidentTemplate = Pick<PgSeedSpec, "fullName" | "yearOfResidency" | "joiningDate">;

function residentsForDepartment(deptName: string, deptCode: string): PgResidentTemplate[] {
  const name = deptName.toUpperCase();
  const code = deptCode.toUpperCase();

  if (name.includes("EMERGENCY")) {
    return [
      { fullName: "Dr. Ankit Malhotra", yearOfResidency: 2, joiningDate: new Date("2025-04-12") },
      { fullName: "Dr. Lakshmi Sundaram", yearOfResidency: 1, joiningDate: new Date("2026-02-20") },
      { fullName: "Dr. Varun Chitre", yearOfResidency: 3, joiningDate: new Date("2024-06-08") },
    ];
  }
  if (name.includes("OPHTHAL")) {
    return [
      { fullName: "Dr. Hari Krishnan", yearOfResidency: 2, joiningDate: new Date("2025-01-18") },
      { fullName: "Dr. Sangeeta Mohan", yearOfResidency: 1, joiningDate: new Date("2026-03-14") },
      { fullName: "Dr. Mohit Saxena", yearOfResidency: 3, joiningDate: new Date("2024-09-22") },
    ];
  }
  if (name.includes("OTORHINO") || (name.includes("ENT") && !name.includes("MEDICINE"))) {
    return [
      { fullName: "Dr. Aditya Bose", yearOfResidency: 2, joiningDate: new Date("2025-05-06") },
      { fullName: "Dr. Chinmayi Hegde", yearOfResidency: 1, joiningDate: new Date("2026-01-25") },
      { fullName: "Dr. Suresh Babu", yearOfResidency: 3, joiningDate: new Date("2024-11-03") },
    ];
  }
  if (name.includes("PSYCHIAT")) {
    return [
      { fullName: "Dr. Ramesh Varma", yearOfResidency: 2, joiningDate: new Date("2025-08-30") },
      { fullName: "Dr. Ananya Ghosh", yearOfResidency: 1, joiningDate: new Date("2026-04-11") },
      { fullName: "Dr. Milind Kulkarni", yearOfResidency: 3, joiningDate: new Date("2024-07-17") },
    ];
  }
  if (name.includes("ORTHOPAED") || (name.includes("ORTHOP") && code !== "ORT")) {
    return [
      { fullName: "Dr. Gopalakrishnan V", yearOfResidency: 2, joiningDate: new Date("2025-02-14") },
      { fullName: "Dr. Swati Choudhury", yearOfResidency: 1, joiningDate: new Date("2026-05-19") },
      { fullName: "Dr. Deepak Menon", yearOfResidency: 3, joiningDate: new Date("2024-03-28") },
    ];
  }
  if (name.includes("OBSTETRIC") || name.includes("GYNAEC") || name.includes("GYNEC")) {
    return [
      { fullName: "Dr. Reema Dutta", yearOfResidency: 2, joiningDate: new Date("2025-09-05") },
      { fullName: "Dr. Thomas Mathew", yearOfResidency: 1, joiningDate: new Date("2026-02-28") },
      { fullName: "Dr. Lakshmi Iyer", yearOfResidency: 3, joiningDate: new Date("2024-12-10") },
    ];
  }
  if (name.includes("PAEDIATRIC") || name.includes("PEDIATRIC") || code === "PED") {
    return [
      { fullName: "Dr. Nisha Verma", yearOfResidency: 3, joiningDate: new Date("2024-02-12") },
      { fullName: "Dr. Vivek Sharma", yearOfResidency: 1, joiningDate: new Date("2026-04-22") },
      { fullName: "Dr. Rahul Bhat", yearOfResidency: 2, joiningDate: new Date("2025-05-14") },
    ];
  }

  return [
    { fullName: `Dr. Resident (${deptName})`, yearOfResidency: 1, joiningDate: new Date("2026-01-01") },
    { fullName: `Dr. Senior Resident (${deptName})`, yearOfResidency: 2, joiningDate: new Date("2025-01-01") },
    { fullName: `Dr. Chief Resident (${deptName})`, yearOfResidency: 3, joiningDate: new Date("2024-01-01") },
  ];
}

async function nextPgUsername(): Promise<string> {
  const rows = await User.find({ username: /^pg\d+$/i }).select("username").lean();
  let max = 0;
  for (const row of rows) {
    const match = String(row.username).match(/^pg(\d+)$/i);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `pg${max + 1}`;
}

async function upsertPgUser(spec: PgSeedSpec, pgPassword: string) {
  const pgUser = await User.findOneAndUpdate(
    { username: spec.username },
    {
      username: spec.username,
      password: pgPassword,
      fullName: spec.fullName,
      role: "PG",
      departmentId: spec.departmentId,
      mobileNumber: spec.mobileNumber,
      email: spec.email,
      status: "Active",
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  await PGMaster.findOneAndUpdate(
    { userId: pgUser._id },
    { userId: pgUser._id, yearOfResidency: spec.yearOfResidency, joiningDate: spec.joiningDate },
    { upsert: true, new: true },
  );

  return pgUser;
}

async function syncExtraDepartmentPgProfiles() {
  const activeDepts = await Department.find({ status: "Active" }).sort({ name: 1 }).lean();
  const updated: string[] = [];

  for (const dept of activeDepts) {
    const code = String(dept.code || "").toUpperCase();
    if (CORE_DEPT_CODES.has(code)) continue;

    const deptId = dept._id as mongoose.Types.ObjectId;
    const templates = residentsForDepartment(String(dept.name || ""), code);
    const pgUsers = await User.find({ role: "PG", departmentId: deptId, status: "Active" })
      .sort({ username: 1 })
      .select("_id username fullName")
      .lean();

    for (let i = 0; i < pgUsers.length; i++) {
      const template = templates[i % templates.length];
      const pgUser = pgUsers[i];
      const prevName = String(pgUser.fullName || "");

      await User.findByIdAndUpdate(pgUser._id, { fullName: template.fullName });
      await PGMaster.findOneAndUpdate(
        { userId: pgUser._id },
        {
          userId: pgUser._id,
          yearOfResidency: template.yearOfResidency,
          joiningDate: template.joiningDate,
        },
        { upsert: true, new: true },
      );

      if (prevName !== template.fullName) {
        updated.push(`${pgUser.username}: ${prevName} → ${template.fullName} (${dept.name})`);
      }
    }
  }

  return updated;
}

async function backfillPgsForUncoveredDepartments(pgPassword: string) {
  const activeDepts = await Department.find({ status: "Active" }).sort({ name: 1 }).lean();
  const added: string[] = [];

  const canonicalPediatrics = await findCanonicalPediatricsDepartment();

  for (const dept of activeDepts) {
    const deptId = dept._id as mongoose.Types.ObjectId;
    const deptName = String(dept.name || "");
    const pgCount = await User.countDocuments({ role: "PG", departmentId: deptId, status: "Active" });
    const isCore = CORE_DEPT_CODES.has(String(dept.code || "").toUpperCase());
    const target = isCore ? 0 : TARGET_PGS_PER_EXTRA_DEPT;
    if (target === 0 || pgCount >= target) continue;

    if (
      canonicalPediatrics &&
      isPediatricsDepartmentName(deptName) &&
      String(canonicalPediatrics._id) !== String(deptId)
    ) {
      continue;
    }
    if (
      canonicalPediatrics &&
      departmentSharesCanonicalKey(deptName, String(canonicalPediatrics.name))
    ) {
      const corePgCount = await User.countDocuments({
        role: "PG",
        departmentId: canonicalPediatrics._id,
        status: "Active",
      });
      if (corePgCount >= TARGET_PGS_PER_EXTRA_DEPT) continue;
    }

    const templates = residentsForDepartment(String(dept.name || ""), String(dept.code || ""));
    const needed = target - pgCount;
    const picks = templates.slice(0, needed);

    for (const pick of picks) {
      const username = await nextPgUsername();
      const pgNum = Number(username.replace(/^pg/i, "")) || 0;
      await upsertPgUser(
        {
          username,
          fullName: pick.fullName,
          departmentId: deptId,
          yearOfResidency: pick.yearOfResidency,
          joiningDate: pick.joiningDate,
          email: `${username}@demo.local`,
          mobileNumber: `90000000${String(pgNum).padStart(2, "0")}`,
        },
        pgPassword,
      );
      added.push(`${pick.fullName} → ${dept.name} (${username})`);
    }
  }

  return added;
}

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

  const pediatrics = await Department.findOneAndUpdate(
    { code: "PED" },
    { name: "Pediatrics", code: "PED", hodName: "Dr. HOD Pediatrics", status: "Active" },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const orthopedics = await Department.findOneAndUpdate(
    { code: "ORT" },
    { name: "Orthopedics", code: "ORT", hodName: "Dr. HOD Orthopedics", status: "Active" },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const obg = await Department.findOneAndUpdate(
    { code: "OBG" },
    { name: "Obstetrics and Gynecology", code: "OBG", hodName: "Dr. HOD OBG", status: "Active" },
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

  const pgSeeds = [
    { username: "pg1", fullName: "Dr. Aanya Menon", departmentId: medicine._id, yearOfResidency: 2, joiningDate: new Date("2025-01-10"), email: "pg1@demo.local", mobileNumber: "9000000001" },
    { username: "pg2", fullName: "Dr. Rohan Iyer", departmentId: surgery._id, yearOfResidency: 1, joiningDate: new Date("2026-03-01"), email: "pg2@demo.local", mobileNumber: "9000000002" },
    { username: "pg3", fullName: "Dr. Nisha Verma", departmentId: pediatrics._id, yearOfResidency: 3, joiningDate: new Date("2024-02-12"), email: "pg3@demo.local", mobileNumber: "9000000003" },
    { username: "pg4", fullName: "Dr. Karthik Rao", departmentId: orthopedics._id, yearOfResidency: 2, joiningDate: new Date("2025-03-18"), email: "pg4@demo.local", mobileNumber: "9000000004" },
    { username: "pg5", fullName: "Dr. Priya Nair", departmentId: obg._id, yearOfResidency: 1, joiningDate: new Date("2026-01-08"), email: "pg5@demo.local", mobileNumber: "9000000005" },
    { username: "pg6", fullName: "Dr. Arjun Patel", departmentId: medicine._id, yearOfResidency: 3, joiningDate: new Date("2024-01-15"), email: "pg6@demo.local", mobileNumber: "9000000006" },
    { username: "pg7", fullName: "Dr. Sneha Kulkarni", departmentId: surgery._id, yearOfResidency: 2, joiningDate: new Date("2025-02-03"), email: "pg7@demo.local", mobileNumber: "9000000007" },
    { username: "pg8", fullName: "Dr. Vivek Sharma", departmentId: pediatrics._id, yearOfResidency: 1, joiningDate: new Date("2026-04-22"), email: "pg8@demo.local", mobileNumber: "9000000008" },
    { username: "pg9", fullName: "Dr. Meera Joshi", departmentId: orthopedics._id, yearOfResidency: 3, joiningDate: new Date("2024-03-05"), email: "pg9@demo.local", mobileNumber: "9000000009" },
    { username: "pg10", fullName: "Dr. Kavya Reddy", departmentId: obg._id, yearOfResidency: 2, joiningDate: new Date("2025-06-11"), email: "pg10@demo.local", mobileNumber: "9000000010" },
    { username: "pg11", fullName: "Dr. Abhishek Sen", departmentId: medicine._id, yearOfResidency: 1, joiningDate: new Date("2026-02-07"), email: "pg11@demo.local", mobileNumber: "9000000011" },
    { username: "pg12", fullName: "Dr. Pooja Desai", departmentId: surgery._id, yearOfResidency: 3, joiningDate: new Date("2024-02-28"), email: "pg12@demo.local", mobileNumber: "9000000012" },
    { username: "pg13", fullName: "Dr. Rahul Bhat", departmentId: pediatrics._id, yearOfResidency: 2, joiningDate: new Date("2025-05-14"), email: "pg13@demo.local", mobileNumber: "9000000013" },
    { username: "pg14", fullName: "Dr. Divya Kapoor", departmentId: orthopedics._id, yearOfResidency: 1, joiningDate: new Date("2026-03-19"), email: "pg14@demo.local", mobileNumber: "9000000014" },
    { username: "pg15", fullName: "Dr. Sanjay Pillai", departmentId: obg._id, yearOfResidency: 3, joiningDate: new Date("2024-04-09"), email: "pg15@demo.local", mobileNumber: "9000000015" },
    { username: "pg16", fullName: "Dr. Neha Agarwal", departmentId: medicine._id, yearOfResidency: 2, joiningDate: new Date("2025-07-01"), email: "pg16@demo.local", mobileNumber: "9000000016" },
    { username: "pg17", fullName: "Dr. Siddharth Jain", departmentId: surgery._id, yearOfResidency: 1, joiningDate: new Date("2026-05-05"), email: "pg17@demo.local", mobileNumber: "9000000017" },
    { username: "pg18", fullName: "Dr. Isha Thomas", departmentId: pediatrics._id, yearOfResidency: 3, joiningDate: new Date("2024-01-22"), email: "pg18@demo.local", mobileNumber: "9000000018" },
    { username: "pg19", fullName: "Dr. Manav Khanna", departmentId: orthopedics._id, yearOfResidency: 2, joiningDate: new Date("2025-08-16"), email: "pg19@demo.local", mobileNumber: "9000000019" },
    { username: "pg20", fullName: "Dr. Farah Ali", departmentId: obg._id, yearOfResidency: 1, joiningDate: new Date("2026-06-02"), email: "pg20@demo.local", mobileNumber: "9000000020" },
  ];

  for (const spec of pgSeeds) {
    await upsertPgUser(spec, pgPassword);
  }

  const syncedPgNames = await syncExtraDepartmentPgProfiles();
  if (syncedPgNames.length > 0) {
    console.log(`  Synced ${syncedPgNames.length} PG name(s) for specialty departments:`);
    syncedPgNames.forEach((line) => console.log(`    · ${line}`));
  }

  const backfilledPgs = await backfillPgsForUncoveredDepartments(pgPassword);
  if (backfilledPgs.length > 0) {
    console.log(`  Backfilled ${backfilledPgs.length} PG(s) for departments without full resident lists:`);
    backfilledPgs.forEach((line) => console.log(`    · ${line}`));
  }

  const mergedPediatrics = await mergePediatricsDepartmentDuplicates();
  if (mergedPediatrics.length > 0) {
    console.log("  Merged duplicate Pediatrics / PAEDIATRICS departments:");
    mergedPediatrics.forEach((line) => console.log(`    · ${line}`));
  }

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
  for (const name of activityTypeNames) {
    await ActivityType.findOneAndUpdate(
      { name },
      { name, status: "Active" },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  const removedDemo = await removeSeededDemoPatients();

  console.log("");
  console.log("Seed completed.");
  if (removedDemo > 0) {
    console.log(`  Removed ${removedDemo} junk patient(s) (DEMO-IP*, Test Patient, v bvbv, etc.).`);
  }
  console.log(
    "  Demo logins: admin / admin123  |  mrd1 / mrd12345  |  consultant1 / consult123  |  pg1–pgN / pg123456",
  );
  console.log("");
  await mongoose.disconnect();
}

seed().catch(async (err) => {
  console.error("Seed failed", err);
  await mongoose.disconnect();
  process.exit(1);
});
