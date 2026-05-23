import { Admission, PatientAssignment } from "./models";
import { hisEnv } from "./hisEnv";
import { fetchHisDischargeByIpNumbers, type HisIpDischargeRow } from "./hisService";

export type DischargeSyncResult = {
  hisActive: boolean;
  checked: number;
  discharged: number;
  skipped: number;
  throttled?: boolean;
};

let lastDischargeSyncAt = 0;
const SYNC_INTERVAL_MS = 60_000;

export function normalizeIpNumber(value: string): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function pickDischargeDate(row: HisIpDischargeRow): Date | null {
  if (!row.dischargeDate) return null;
  const d = row.dischargeDate instanceof Date ? row.dischargeDate : new Date(row.dischargeDate);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Match tracking admissions to HIS discharge report and close active PG assignments.
 */
export async function syncDischargesFromHis(): Promise<DischargeSyncResult> {
  if (!hisEnv.queryBuilderConfigured) {
    return { hisActive: false, checked: 0, discharged: 0, skipped: 0 };
  }

  const admittedRows = await Admission.find({ status: "Admitted" })
    .populate<{ patientId: { ipNumber?: string } | null }>("patientId")
    .select("patientId admissionDate")
    .lean();

  if (admittedRows.length === 0) {
    return { hisActive: true, checked: 0, discharged: 0, skipped: 0 };
  }

  const admissionsByIp = new Map<string, Array<{ admissionId: string; admissionDate: Date }>>();
  let earliestAdmission = new Date();

  for (const row of admittedRows) {
    const patient = row.patientId as { ipNumber?: string; _id?: unknown } | null;
    const ip = normalizeIpNumber(String(patient?.ipNumber ?? ""));
    if (!ip) continue;
    const admissionDate = row.admissionDate ? new Date(row.admissionDate) : new Date();
    if (admissionDate < earliestAdmission) earliestAdmission = admissionDate;
    const list = admissionsByIp.get(ip);
    const entry = { admissionId: String(row._id), admissionDate };
    if (list) list.push(entry);
    else admissionsByIp.set(ip, [entry]);
  }

  const ipNumbers = Array.from(admissionsByIp.keys());
  if (ipNumbers.length === 0) {
    return { hisActive: true, checked: 0, discharged: 0, skipped: admittedRows.length };
  }

  const rangeStart = new Date(earliestAdmission);
  rangeStart.setDate(rangeStart.getDate() - 7);
  const hisRows = await fetchHisDischargeByIpNumbers(ipNumbers, rangeStart, new Date());

  const dischargedByIp = new Map<string, Date>();
  for (const row of hisRows) {
    const ip = normalizeIpNumber(row.ipNumber);
    const dischargedAt = pickDischargeDate(row);
    if (!ip || !dischargedAt) continue;
    const prev = dischargedByIp.get(ip);
    if (!prev || dischargedAt > prev) dischargedByIp.set(ip, dischargedAt);
  }

  let discharged = 0;
  let skipped = 0;

  for (const [ip, admissions] of admissionsByIp) {
    const dischargedAt = dischargedByIp.get(ip);
    if (!dischargedAt) {
      skipped += admissions.length;
      continue;
    }

    for (const { admissionId } of admissions) {
      const admission = await Admission.findByIdAndUpdate(
        admissionId,
        { status: "Discharged", dischargedAt },
        { new: true },
      );
      if (!admission) continue;

      await PatientAssignment.updateMany(
        { admissionId, isActive: true },
        { $set: { isActive: false, releasedAt: dischargedAt } },
      );

      discharged += 1;
    }
  }

  return {
    hisActive: true,
    checked: ipNumbers.length,
    discharged,
    skipped,
  };
}

export async function syncDischargesFromHisIfDue(): Promise<DischargeSyncResult> {
  if (!hisEnv.queryBuilderConfigured) {
    return { hisActive: false, checked: 0, discharged: 0, skipped: 0 };
  }
  const now = Date.now();
  if (now - lastDischargeSyncAt < SYNC_INTERVAL_MS) {
    return { hisActive: true, checked: 0, discharged: 0, skipped: 0, throttled: true };
  }
  lastDischargeSyncAt = now;
  return syncDischargesFromHis();
}
