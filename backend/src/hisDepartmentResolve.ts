import { Department } from "./models";
import { isPediatricsDepartmentName, resolvePediatricsDepartmentAlias } from "./departmentAliases";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugFromName(name: string): string {
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28);
  return slug || "UNKNOWN";
}

export type ResolvedDepartment = { _id: unknown; name: string; code: string };

const activeDepartmentOnly = { status: { $ne: "Inactive" as const } };

/**
 * Map HIS `dept_id` / `dept_name` to a Mongo `Department`.
 * 1) Match stable code `HIS_<dept_id>` when id present
 * 2) Match existing department by name (case-insensitive)
 * 3) Create a new department (for tracking / resident allocation) when no match
 */
export async function resolveDepartmentFromHis(
  deptNameRaw: string,
  deptIdRaw: string,
): Promise<ResolvedDepartment | null> {
  const deptName = String(deptNameRaw ?? "").trim();
  const deptId = String(deptIdRaw ?? "").trim();

  if (!deptName && !deptId) return null;

  const codeByHisId = deptId ? `HIS_${deptId}`.slice(0, 64) : "";

  if (codeByHisId) {
    const byCode = await Department.findOne({ code: codeByHisId, ...activeDepartmentOnly });
    if (byCode) {
      return { _id: byCode._id, name: byCode.name, code: byCode.code };
    }
  }

  if (deptName && isPediatricsDepartmentName(deptName)) {
    const pediatrics = await resolvePediatricsDepartmentAlias();
    if (pediatrics) return { _id: pediatrics._id, name: pediatrics.name, code: pediatrics.code };
  }

  if (deptName) {
    const byName = await Department.findOne({
      name: new RegExp(`^${escapeRegex(deptName)}$`, "i"),
      ...activeDepartmentOnly,
    });
    if (byName) {
      return { _id: byName._id, name: byName.name, code: byName.code };
    }
  }

  const displayName =
    deptName || (deptId ? `Department (HIS id ${deptId})` : "Unknown department");

  let code = codeByHisId || `HIS_${slugFromName(displayName)}`.slice(0, 64);
  let suffix = 0;
  while (await Department.findOne({ code })) {
    suffix += 1;
    code = `${codeByHisId || "HIS"}_${suffix}`.slice(0, 64);
    if (suffix > 200) return null;
  }

  try {
    const created = await Department.create({
      name: displayName.slice(0, 200),
      code,
      status: "Active",
    });
    return { _id: created._id, name: created.name, code: created.code };
  } catch (err: unknown) {
    const e = err as { code?: number };
    if (e?.code === 11000) {
      const retryName = await Department.findOne({
        name: new RegExp(`^${escapeRegex(displayName)}$`, "i"),
        ...activeDepartmentOnly,
      });
      if (retryName) {
        return { _id: retryName._id, name: retryName.name, code: retryName.code };
      }
      const retryCode = codeByHisId
        ? await Department.findOne({ code: codeByHisId, ...activeDepartmentOnly })
        : null;
      if (retryCode) {
        return { _id: retryCode._id, name: retryCode.name, code: retryCode.code };
      }
    }
    throw err;
  }
}
