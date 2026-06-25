import { HisError } from "./hisErrors";
import { hisEnv } from "./hisEnv";

export type EmrQueryBuilderPayload = {
  strQuery: string;
  strCon: string;
};

const queryCache = new Map<string, { expiresAt: number; rows: Record<string, unknown>[] }>();
const CACHE_TTL_MS = 60_000;

function formatReportDate(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const year = value.getFullYear();
  return `${month}/${day}/${year}`;
}

function sqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

export type PatDetailsQueryOptions = {
  ipno?: string;
  regno?: string;
  patname?: string;
  optoip?: "0" | "1";
  depid?: string;
  /** When true, return Z-patient rows (for validation only — default excludes them). */
  includeZPatients?: boolean;
};

function buildPatDetailsPrintQuery(from: Date, to: Date, options: PatDetailsQueryOptions = {}): string {
  const ipno = sqlLiteral(options.ipno ?? "");
  const regno = sqlLiteral(options.regno ?? "");
  const patname = sqlLiteral(options.patname ?? "");
  const depid = sqlLiteral(options.depid ?? "0");
  const optoip = options.optoip ?? "0";
  return (
    `Use kmch_frontoffice EXEC Fo_Rpt_IPPatdetailsprint_QB  @frmdate = '${formatReportDate(from)}' , ` +
    `@todate = '${formatReportDate(to)}' , @patname = '${patname}' , @regno = '${regno}' , @ipno = '${ipno}' , @docid = '0' , ` +
    `@MatrixFormat = '0' , @wardid = '0' , @Status = '0' , @PatType = '0' , @Corporate_type = '0' , ` +
    `@depid = '${depid}' , @BedId = '0' , @RegDocCity = '0' , @optoip = '${optoip}' , @ReligionId = '0' , ` +
    `@RefDocDays = '0' , @VisitCategory = '' , @CorporateId = '' , @unit = '0' , @grpby = '0' `
  );
}

export function buildIpPatDetailsPrintQuery(from: Date, to: Date, ipno = ""): string {
  return buildPatDetailsPrintQuery(from, to, { ipno, optoip: "0" });
}

/** EMR PatType id for z-patient only — excluded from admission search. */
export const EMR_Z_PATIENT_PAT_TYPE = "62";

export type OpPatDetailsQueryOptions = {
  regno?: string;
  patname?: string;
  depid?: string;
  /** SP filter; use "0" for all types, then drop ZPATIENT rows client-side. */
  patType?: string;
};

export function buildOpPatDetailsPrintQuery(
  from: Date,
  to: Date,
  options: OpPatDetailsQueryOptions = {},
): string {
  const regno = sqlLiteral(options.regno ?? "");
  const patname = sqlLiteral(options.patname ?? "");
  const depid = sqlLiteral(options.depid ?? "0");
  const patType = sqlLiteral(options.patType ?? "0");
  return (
    `Use kmch_frontoffice Exec Fo_Rpt_OPPatdetailsprint_QB  @frmdate = '${formatReportDate(from)}' , ` +
    `@todate = '${formatReportDate(to)}' , @regno = '${regno}' , @patname = '${patname}' , @docid = '0' , ` +
    `@IncludingDirectIP = '1' , @Visittype = '0' , @PatType = '${patType}' , @MatrixFormat = '0' , ` +
    `@ReferredSource = '0' , @Type = '0' , @ClassId = '0' , @CorporateId = '0' , @Corporate_type = '0' , ` +
    `@depid = '${depid}' , @RefDocCity = '0' , @ReligionId = '0' , @RefDocDays = '0' , @RefDocId = '0' , @VisitCategory = '' `
  );
}

function readEmrCell(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const direct = row[key];
    if (direct != null && String(direct).trim() !== "") return String(direct).trim();
    const upper = row[key.toUpperCase()];
    if (upper != null && String(upper).trim() !== "") return String(upper).trim();
  }
  return "";
}

/** Z-patient uses PatType 62 in EMR; report rows are labeled ZPATIENT. */
export function isEmrZPatientRow(row: Record<string, unknown>): boolean {
  const patientType = readEmrCell(row, ["PATIENT TYPE", "PATIENT_TYPE", "PatType", "PATIENTTYPE"]).toUpperCase();
  if (patientType === "ZPATIENT" || /^Z\s*-?\s*PATIENT$/.test(patientType)) return true;

  const patTypeId = readEmrCell(row, ["PatType", "PAT_TYPE", "iPatType", "PATTYPEID", "PAT TYPE ID"]);
  return patTypeId === EMR_Z_PATIENT_PAT_TYPE;
}

export function filterOutEmrZPatients(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.filter((row) => !isEmrZPatientRow(row));
}

export async function fetchPatDetailsFromEmr(
  from: Date,
  to: Date,
  options: PatDetailsQueryOptions = {},
): Promise<Record<string, unknown>[]> {
  const { includeZPatients, ...queryOptions } = options;
  const strQuery = buildPatDetailsPrintQuery(from, to, queryOptions);
  const rows = await fetchEmrQueryBuilderDataset(strQuery);
  return includeZPatients ? rows : filterOutEmrZPatients(rows);
}

function parseDatasetRows(body: unknown): Record<string, unknown>[] {
  if (!body || typeof body !== "object") return [];
  const payload = body as { d?: unknown };
  const raw = payload.d;
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Read-only call to EMR Query Builder Getdataset1 (connection resolved server-side via strCon).
 */
export async function fetchEmrQueryBuilderDataset(
  strQuery: string,
  strCon = hisEnv.queryBuilderStrCon,
): Promise<Record<string, unknown>[]> {
  if (!hisEnv.enabled || !hisEnv.queryBuilderConfigured) return [];

  const cacheKey = `${strCon}::${strQuery}`;
  const cached = queryCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.rows;

  const url = hisEnv.queryBuilderUrl;
  const payload: EmrQueryBuilderPayload = { strQuery, strCon };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Network error";
    throw new HisError(`EMR Query Builder request failed: ${message}`, 503);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new HisError(`EMR Query Builder returned HTTP ${response.status}`, response.status >= 500 ? 503 : response.status);
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HisError("EMR Query Builder returned non-JSON response", 502);
  }

  const rows = parseDatasetRows(body);
  queryCache.set(cacheKey, { rows, expiresAt: Date.now() + CACHE_TTL_MS });
  return rows;
}

export async function fetchIpPatDetailsFromEmr(from: Date, to: Date, ipno = ""): Promise<Record<string, unknown>[]> {
  return fetchPatDetailsFromEmr(from, to, { ipno, optoip: "0" });
}

export async function fetchOpPatDetailsFromEmr(
  from: Date,
  to: Date,
  regno = "",
  patname = "",
  depid = "0",
): Promise<Record<string, unknown>[]> {
  const strQuery = buildOpPatDetailsPrintQuery(from, to, { regno, patname, patType: "0", depid });
  const rows = await fetchEmrQueryBuilderDataset(strQuery);
  return filterOutEmrZPatients(rows);
}
