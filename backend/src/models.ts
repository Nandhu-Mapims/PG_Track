import mongoose, { Schema, model, Types } from "mongoose";
import bcrypt from "bcryptjs";

export type UserRole = "Admin" | "HOD" | "Consultant" | "PG" | "MRD";

const userSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true, minlength: 6 },
    fullName: { type: String, required: true, trim: true },
    role: { type: String, enum: ["Admin", "HOD", "Consultant", "PG", "MRD"], required: true },
    departmentId: { type: Schema.Types.ObjectId, ref: "Department" },
    unitId: { type: Schema.Types.ObjectId, ref: "Unit" },
    status: { type: String, enum: ["Active", "Inactive"], default: "Active" },
    mobileNumber: String,
    email: String,
  },
  { timestamps: true },
);

userSchema.pre("save", async function hashPassword() {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 10);
});

const pgMasterSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    yearOfResidency: { type: Number, min: 1, max: 6, required: true },
    joiningDate: Date,
  },
  { timestamps: true },
);

const departmentSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    code: { type: String, required: true, unique: true, trim: true },
    hodName: String,
    status: { type: String, enum: ["Active", "Inactive"], default: "Active" },
  },
  { timestamps: true },
);

const unitSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    consultantId: { type: Schema.Types.ObjectId, ref: "User" },
    departmentId: { type: Schema.Types.ObjectId, ref: "Department", required: true },
    status: { type: String, enum: ["Active", "Inactive"], default: "Active" },
  },
  { timestamps: true },
);
unitSchema.index({ name: 1, departmentId: 1 }, { unique: true });

const activityTypeSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    status: { type: String, enum: ["Active", "Inactive"], default: "Active" },
  },
  { timestamps: true },
);

const patientSchema = new Schema(
  {
    ipNumber: { type: String, required: true, unique: true },
    patientName: { type: String, required: true },
    age: Number,
    gender: { type: String, enum: ["Male", "Female", "Other"] },
  },
  { timestamps: true },
);

const admissionSchema = new Schema(
  {
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    departmentId: { type: Schema.Types.ObjectId, ref: "Department", required: true },
    unitId: { type: Schema.Types.ObjectId, ref: "Unit" },
    consultantId: { type: Schema.Types.ObjectId, ref: "User" },
    assignedPgId: { type: Schema.Types.ObjectId, ref: "User" },
    admissionDate: { type: Date, required: true },
    dischargedAt: Date,
    wardBedNumber: String,
    icuTag: { type: Boolean, default: false },
    status: { type: String, enum: ["Admitted", "Discharged"], default: "Admitted" },
  },
  { timestamps: true },
);

const patientAssignmentSchema = new Schema(
  {
    admissionId: { type: Schema.Types.ObjectId, ref: "Admission", required: true },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    pgId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    departmentId: { type: Schema.Types.ObjectId, ref: "Department" },
    unitId: { type: Schema.Types.ObjectId, ref: "Unit" },
    consultantId: { type: Schema.Types.ObjectId, ref: "User" },
    shift: { type: String, enum: ["Morning", "Evening", "Night", "General"], default: "General" },
    assignmentType: { type: String, enum: ["Primary", "Secondary", "ICU-Cover", "OnCall"], default: "Secondary" },
    isPrimary: { type: Boolean, default: false },
    assignedAt: { type: Date, default: Date.now },
    releasedAt: Date,
    isActive: { type: Boolean, default: true },
    assignedBy: { type: Schema.Types.ObjectId, ref: "User" },
    remarks: String,
    icuTag: { type: Boolean, default: false },
  },
  { timestamps: true },
);
patientAssignmentSchema.index({ patientId: 1, isActive: 1 });
patientAssignmentSchema.index({ pgId: 1, isActive: 1 });
patientAssignmentSchema.index({ unitId: 1, consultantId: 1, isActive: 1 });
patientAssignmentSchema.index({ assignedAt: -1 });

const pgActivityLogSchema = new Schema(
  {
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    pgId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    assignmentId: { type: Schema.Types.ObjectId, ref: "PatientAssignment" },
    activityTypeId: { type: Schema.Types.ObjectId, ref: "ActivityType" },
    activityType: { type: String, required: true },
    remarks: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
pgActivityLogSchema.index({ patientId: 1, createdAt: -1 });
pgActivityLogSchema.index({ pgId: 1, createdAt: -1 });
pgActivityLogSchema.index({ assignmentId: 1, createdAt: -1 });
pgActivityLogSchema.index({ activityTypeId: 1, createdAt: -1 });

const progressNoteSchema = new Schema(
  {
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    pgId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    noteContent: { type: String, required: true },
    noteDateTime: { type: Date, required: true },
    delayedEntry: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const procedureSchema = new Schema(
  {
    procedureName: { type: String, required: true },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    pgId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["Performed", "Assisted", "Observed"], required: true },
    date: { type: Date, required: true },
    consultantId: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

const dischargeSummarySchema = new Schema(
  {
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true, unique: true },
    preparedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    diagnosis: String,
    medications: String,
    followUpInstructions: String,
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    status: { type: String, enum: ["Draft", "Submitted", "Approved"], default: "Draft" },
  },
  { timestamps: true },
);

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: String,
    message: String,
    read: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const auditLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    username: String,
    patientRef: String,
    action: String,
    module: String,
    method: String,
    path: String,
    status: { type: String, enum: ["Success", "Failed"], default: "Success" },
    statusCode: Number,
    ipAddress: String,
    meta: Schema.Types.Mixed,
  },
  { timestamps: true },
);
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ module: 1, createdAt: -1 });

export const User = model("User", userSchema);
export const PGMaster = model("PGMaster", pgMasterSchema);
export const Department = model("Department", departmentSchema);
export const Unit = model("Unit", unitSchema);
export const ActivityType = model("ActivityType", activityTypeSchema);
export const Patient = model("Patient", patientSchema);
export const Admission = model("Admission", admissionSchema);
export const PatientAssignment = model("PatientAssignment", patientAssignmentSchema);
export const PGActivityLog = model("PGActivityLog", pgActivityLogSchema);
export const ProgressNote = model("ProgressNote", progressNoteSchema);
export const Procedure = model("Procedure", procedureSchema);
export const DischargeSummary = model("DischargeSummary", dischargeSummarySchema);
export const Notification = model("Notification", notificationSchema);
export const AuditLog = model("AuditLog", auditLogSchema);

export function toObjectId(id: string): Types.ObjectId {
  return new mongoose.Types.ObjectId(id);
}

