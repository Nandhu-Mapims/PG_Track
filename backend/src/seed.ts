import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dns from "node:dns";
import { ActivityType, Department, Unit, User, PGMaster } from "./models";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/pg_tracking";
const DNS_SERVERS = (process.env.DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

async function seed() {
  if (DNS_SERVERS.length > 0) {
    dns.setServers(DNS_SERVERS);
  }
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB for seeding");

  const adminPassword = await bcrypt.hash("admin123", 10);
  const consultantPassword = await bcrypt.hash("consult123", 10);
  const pgPassword = await bcrypt.hash("pg123456", 10);

  const medicine = await Department.findOneAndUpdate(
    { code: "MED" },
    { name: "General Medicine", code: "MED", hodName: "Dr. HOD Medicine", status: "Active" },
    { upsert: true, new: true },
  );

  const surgery = await Department.findOneAndUpdate(
    { code: "SUR" },
    { name: "General Surgery", code: "SUR", hodName: "Dr. HOD Surgery", status: "Active" },
    { upsert: true, new: true },
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

  const pg = await User.findOneAndUpdate(
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

  await PGMaster.findOneAndUpdate(
    { userId: pg._id },
    { userId: pg._id, yearOfResidency: 2, joiningDate: new Date("2025-01-10") },
    { upsert: true, new: true },
  );

  await Unit.findOneAndUpdate(
    { name: "Unit A", departmentId: medicine._id },
    { name: "Unit A", departmentId: medicine._id, consultantId: consultant._id, status: "Active" },
    { upsert: true, new: true },
  );

  await Unit.findOneAndUpdate(
    { name: "Unit B", departmentId: surgery._id },
    { name: "Unit B", departmentId: surgery._id, status: "Active" },
    { upsert: true, new: true },
  );

  const activityTypes = [
    "Admission Assessment",
    "Progress Note",
    "Consultant Round",
    "Procedure Assist",
    "ICU Review",
    "Referral",
    "Discharge Summary",
    "Emergency Review",
  ];
  for (const name of activityTypes) {
    await ActivityType.findOneAndUpdate({ name }, { name, status: "Active" }, { upsert: true, new: true });
  }

  console.log("Seed completed");
  await mongoose.disconnect();
}

seed().catch(async (err) => {
  console.error("Seed failed", err);
  await mongoose.disconnect();
  process.exit(1);
});

