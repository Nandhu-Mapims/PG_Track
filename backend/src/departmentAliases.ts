import mongoose from "mongoose";
import { Department, User } from "./models";
import { deleteUserAccount } from "./userDeleteService";

export function normalizeDepartmentKey(name: string): string {
  return String(name ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function isPediatricsDepartmentName(name: string): boolean {
  const key = normalizeDepartmentKey(name);
  return key.includes("PAEDIATRIC") || key.includes("PEDIATRIC");
}

export async function findCanonicalPediatricsDepartment() {
  return Department.findOne({ code: "PED", status: { $ne: "Inactive" } }).lean();
}

/** HIS may send PAEDIATRICS while seed uses Pediatrics — treat as one department. */
export async function resolvePediatricsDepartmentAlias(): Promise<{
  _id: mongoose.Types.ObjectId;
  name: string;
  code: string;
} | null> {
  const row = await findCanonicalPediatricsDepartment();
  if (!row?._id) return null;
  return { _id: row._id as mongoose.Types.ObjectId, name: String(row.name), code: String(row.code) };
}

async function removePgUserAndRelatedData(userId: mongoose.Types.ObjectId) {
  await deleteUserAccount(userId);
}

/**
 * Merge PAEDIATRICS / Pediatrics spelling duplicates: keep PED department + core PG accounts.
 */
export async function mergePediatricsDepartmentDuplicates(): Promise<string[]> {
  const canonical = await findCanonicalPediatricsDepartment();
  if (!canonical?._id) return [];

  const canonicalId = canonical._id as mongoose.Types.ObjectId;
  const duplicateDepts = await Department.find({
    _id: { $ne: canonicalId },
    status: { $ne: "Inactive" },
    $or: [
      { name: { $regex: /paediatric/i } },
      { name: { $regex: /^pediatrics$/i } },
      { code: { $regex: /^HIS_.*PAEDIATRIC/i } },
    ],
  }).lean();

  const log: string[] = [];

  for (const dup of duplicateDepts) {
    const dupId = dup._id as mongoose.Types.ObjectId;
    const dupPgs = await User.find({ role: "PG", departmentId: dupId, status: "Active" }).lean();

    for (const pg of dupPgs) {
      const nameKey = String(pg.fullName ?? "")
        .trim()
        .toLowerCase();
      const twin = await User.findOne({
        role: "PG",
        departmentId: canonicalId,
        status: "Active",
        fullName: new RegExp(`^${nameKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
      }).lean();

      if (twin) {
        await removePgUserAndRelatedData(pg._id as mongoose.Types.ObjectId);
        log.push(`Removed duplicate PG ${pg.username} (${dup.name}) — kept ${twin.username} on ${canonical.name}`);
      } else {
        await User.findByIdAndUpdate(pg._id, { departmentId: canonicalId });
        log.push(`Moved ${pg.username} from ${dup.name} → ${canonical.name}`);
      }
    }

    await Department.findByIdAndUpdate(dupId, { status: "Inactive" });
    log.push(`Deactivated duplicate department: ${dup.name}`);
  }

  return log;
}

export function departmentSharesCanonicalKey(deptName: string, canonicalName: string): boolean {
  if (isPediatricsDepartmentName(deptName) && isPediatricsDepartmentName(canonicalName)) return true;
  const a = normalizeDepartmentKey(deptName);
  const b = normalizeDepartmentKey(canonicalName);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}
