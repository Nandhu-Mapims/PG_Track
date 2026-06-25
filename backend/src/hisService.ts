import {
  departmentSharesCanonicalKey,
  normalizeDepartmentKey,
} from "./departmentAliases";
import { hisEnv } from "./hisEnv";
import {
  fetchIpPatDetailsFromEmr,
  fetchOpPatDetailsFromEmr,
  fetchPatDetailsFromEmr,
  isEmrZPatientRow,
} from "./hisQueryBuilder";
import { getHisPool, sql } from "./hisSql";
import { HisError } from "./hisErrors";

export { HisError };

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 200;

const PHONE_COLUMN_CANDIDATES = ["cPat_Mob", "cPat_Mobile", "cPat_MobileNo", "cPhone", "cPhoneNo"];

let cachedPhoneColumn: string | null = null;
let lastPhoneLookupAt = 0;
let cachedLookupMeta: LookupMeta | null = null;
let lastLookupMetaAt = 0;

const LOOKUP_TTL_MS = 15 * 60_000;
const QUERY_CACHE_MAX_ENTRIES = 300;
const CACHE_TTL = {
  HIS_PATIENTS: 30 * 1000,
  HIS_SEARCH: 20 * 1000,
  DEMOGRAPHICS: 60 * 1000,
  EXISTS: 45 * 1000,
  DEPARTMENTS: 5 * 60 * 1000,
} as const;

type CacheEntry = { value: unknown; expiresAt: number };
const queryCache = new Map<string, CacheEntry>();

const DEPT_ID_CANDIDATES = ["iDept_id", "DepartmentID", "iDeptId"];
const DEPT_NAME_CANDIDATES = [
  "cDept_Name",
  "cDeptName",
  "DepartmentName",
  "cDepartment_Name",
  "cDepartmentName",
  "cName",
];
const DEPT_TABLE_CANDIDATES = ["Mast_Dept", "Mast_Department", "Department", "Dept"];

const USER_ID_CANDIDATES = ["iUser_id", "UserID", "iUserId", "iEmp_id", "EmployeeID"];
const USER_NAME_CANDIDATES = [
  "cUser_Name",
  "cUserName",
  "UserName",
  "cEmp_Name",
  "cEmpName",
  "cEmployee_Name",
  "cName",
];
const USER_TABLE_CANDIDATES = ["Mast_User", "Mast_Users", "Mast_Employee", "Mast_Staff", "Users"];

type LookupSide = {
  table: string;
  idCol: string;
  nameCol: string;
};

type LookupMeta = {
  dept: LookupSide | null;
  user: LookupSide | null;
};

type InfoSchemaRow = { TABLE_SCHEMA?: string; TABLE_NAME?: string; COLUMN_NAME?: string };

type TableMapEntry = { schema: string; table: string; columns: Set<string> };

const delay = (ms = 200) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const getCache = (key: string): unknown | null => {
  const hit = queryCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    queryCache.delete(key);
    return null;
  }
  queryCache.delete(key);
  queryCache.set(key, hit);
  return hit.value;
};

const setCache = (key: string, value: unknown, ttlMs = 15_000) => {
  if (!key) return;
  const expiresAt = Date.now() + Math.max(500, Number(ttlMs) || 15_000);
  if (queryCache.has(key)) queryCache.delete(key);
  queryCache.set(key, { value, expiresAt });
  if (queryCache.size > QUERY_CACHE_MAX_ENTRIES) {
    const oldestKey = queryCache.keys().next().value;
    if (oldestKey) queryCache.delete(oldestKey);
  }
};

const executeHisQueryWithRetry = async (
  query: string,
  timeoutMs = 10_000,
  bindParams?: (request: sql.Request) => void,
): Promise<Record<string, unknown>[]> => {
  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      const pool = await getHisPool();
      const request = pool.request();
      if (bindParams) bindParams(request);
      request.timeout = timeoutMs;
      const result = await request.query(query);
      return (result?.recordset ?? []) as Record<string, unknown>[];
    } catch (error: unknown) {
      attempt += 1;
      const message = error instanceof Error ? error.message : "Unknown SQL error";
      console.error("HIS query failed", { attempt, message });
      if (attempt >= MAX_RETRIES) {
        throw new HisError("Unable to fetch HIS patient data", 503);
      }
      await delay(BASE_BACKOFF_MS * 2 ** (attempt - 1));
    }
  }
  return [];
};

const getPatientPhoneExpression = async (): Promise<string> => {
  const now = Date.now();
  if (cachedPhoneColumn !== null && now - lastPhoneLookupAt < 15 * 60_000) {
    return cachedPhoneColumn
      ? `CAST(pm.[${cachedPhoneColumn}] AS VARCHAR(50))`
      : "CAST(NULL AS VARCHAR(50))";
  }
  const query = `
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME = 'Mast_Patient';
  `;
  try {
    const rows = await executeHisQueryWithRetry(query, 10_000);
    const columns = rows.map((item) => String(item?.COLUMN_NAME ?? ""));
    cachedPhoneColumn =
      PHONE_COLUMN_CANDIDATES.find((column) => columns.includes(column)) ?? "";
    lastPhoneLookupAt = now;
  } catch {
    cachedPhoneColumn = "";
    lastPhoneLookupAt = now;
  }
  return cachedPhoneColumn
    ? `CAST(pm.[${cachedPhoneColumn}] AS VARCHAR(50))`
    : "CAST(NULL AS VARCHAR(50))";
};

const safeIdent = (identifier: string) => String(identifier ?? "").split("]").join("]]");
const qualifiedTable = (schema: string, table: string) => `[${safeIdent(schema)}].[${safeIdent(table)}]`;

const buildTableMapFromInfoSchemaRows = (rows: InfoSchemaRow[]): Record<string, TableMapEntry> => {
  const tableMap: Record<string, TableMapEntry> = {};
  for (const row of rows) {
    const schema = String(row?.TABLE_SCHEMA ?? "");
    const table = String(row?.TABLE_NAME ?? "");
    const column = String(row?.COLUMN_NAME ?? "");
    if (!schema || !table || !column) continue;
    const key = `${schema}.${table}`;
    if (!tableMap[key]) {
      tableMap[key] = { schema, table, columns: new Set() };
    }
    tableMap[key].columns.add(column);
  }
  return tableMap;
};

const chooseLookupTable = (
  tableMap: Record<string, TableMapEntry>,
  idCandidates: string[],
  nameCandidates: string[],
  tableHints: string[],
): (TableMapEntry & { idCol: string; nameCol: string; score: number; key: string }) | null => {
  const entries = Object.entries(tableMap);
  if (!entries.length) return null;

  let best: (TableMapEntry & { idCol: string; nameCol: string; score: number; key: string }) | null = null;
  for (const [key, value] of entries) {
    const cols = value?.columns ?? new Set();
    const idCol = idCandidates.find((col) => cols.has(col));
    const nameCol = nameCandidates.find((col) => cols.has(col));
    if (!idCol || !nameCol) continue;

    let score = 10;
    if (idCol === idCandidates[0]) score += 8;
    if (nameCol === nameCandidates[0]) score += 8;
    if (tableHints.some((hint) => value.table.toLowerCase().includes(hint.toLowerCase()))) score += 8;
    if (value.schema.toLowerCase() === "dbo") score += 2;

    if (!best || score > best.score) {
      best = { ...value, idCol, nameCol, score, key };
    }
  }
  return best;
};

/** Exported for unit tests if needed */
export const __hisTestables = { chooseLookupTable, buildTableMapFromInfoSchemaRows };

const getLookupMeta = async (): Promise<LookupMeta> => {
  const now = Date.now();
  if (cachedLookupMeta !== null && now - lastLookupMetaAt < LOOKUP_TTL_MS) {
    return cachedLookupMeta;
  }

  const candidateColumns = [
    ...new Set([
      ...DEPT_ID_CANDIDATES,
      ...DEPT_NAME_CANDIDATES,
      ...USER_ID_CANDIDATES,
      ...USER_NAME_CANDIDATES,
    ]),
  ];
  const inList = candidateColumns.map((col) => `'${col}'`).join(", ");
  const query = `
    SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE COLUMN_NAME IN (${inList});
  `;

  try {
    const rows = await executeHisQueryWithRetry(query, 10_000) as InfoSchemaRow[];
    const tableMap = buildTableMapFromInfoSchemaRows(rows);

    const dept = chooseLookupTable(tableMap, DEPT_ID_CANDIDATES, DEPT_NAME_CANDIDATES, DEPT_TABLE_CANDIDATES);
    const user = chooseLookupTable(tableMap, USER_ID_CANDIDATES, USER_NAME_CANDIDATES, USER_TABLE_CANDIDATES);

    cachedLookupMeta = {
      dept:
        dept == null
          ? null
          : {
              table: qualifiedTable(dept.schema, dept.table),
              idCol: `[${safeIdent(dept.idCol)}]`,
              nameCol: `[${safeIdent(dept.nameCol)}]`,
            },
      user:
        user == null
          ? null
          : {
              table: qualifiedTable(user.schema, user.table),
              idCol: `[${safeIdent(user.idCol)}]`,
              nameCol: `[${safeIdent(user.nameCol)}]`,
            },
    };
    lastLookupMetaAt = now;
  } catch {
    cachedLookupMeta = { dept: null, user: null };
    lastLookupMetaAt = now;
  }
  return cachedLookupMeta;
};

export type HisVisitType = "all" | "IP" | "OP";

export type HisPatientTodayRow = {
  patient_id: string;
  visit_id: string;
  name: string;
  phone: string;
  dept_id: string;
  dept_name: string;
  department: string;
  type: "IP" | "OP";
};

export async function fetchHisPatients(options: { visitType?: HisVisitType } = {}): Promise<HisPatientTodayRow[]> {
  if (!hisEnv.enabled) return [];
  const visitType: HisVisitType = options.visitType ?? "all";
  const cacheKey = `his:patients:today:${visitType}`;
  const cached = getCache(cacheKey);
  if (cached) return cached as HisPatientTodayRow[];

  const phoneExpr = await getPatientPhoneExpression();
  const lookupMeta = await getLookupMeta();
  const deptNameFromOpExpr = lookupMeta?.dept
    ? `(SELECT TOP 1 CAST(lu.${lookupMeta.dept.nameCol} AS VARCHAR(200)) FROM ${lookupMeta.dept.table} lu WHERE CAST(lu.${lookupMeta.dept.idCol} AS VARCHAR(100)) = CAST(op.iDept_id AS VARCHAR(100)))`
    : "CAST(NULL AS VARCHAR(200))";
  const deptNameFromIpExpr = lookupMeta?.dept
    ? `(SELECT TOP 1 CAST(lu.${lookupMeta.dept.nameCol} AS VARCHAR(200)) FROM ${lookupMeta.dept.table} lu WHERE CAST(lu.${lookupMeta.dept.idCol} AS VARCHAR(100)) = CAST(ip.iDept_id AS VARCHAR(100)))`
    : "CAST(NULL AS VARCHAR(200))";

  const opSelect = `
    SELECT
      CAST(pm.iPat_id AS VARCHAR(100)) AS patient_id,
      CAST(op.iOP_Reg_No AS VARCHAR(100)) AS visit_id,
      CAST(pm.cPat_Name AS VARCHAR(200)) AS name,
      ${phoneExpr} AS phone,
      CAST(op.iDept_id AS VARCHAR(100)) AS dept_id,
      ${deptNameFromOpExpr} AS dept_name,
      'OP' AS type
    FROM [dbo].[Mast_OP_Admission] op
    INNER JOIN [dbo].[Mast_Patient] pm ON op.iPat_id = pm.iPat_id
    WHERE CAST(op.dOP_dt AS DATE) = CAST(GETDATE() AS DATE)`;

  const ipSelect = `
    SELECT
      CAST(pm.iPat_id AS VARCHAR(100)) AS patient_id,
      CAST(ip.iIP_Reg_No AS VARCHAR(100)) AS visit_id,
      CAST(pm.cPat_Name AS VARCHAR(200)) AS name,
      ${phoneExpr} AS phone,
      CAST(ip.iDept_id AS VARCHAR(100)) AS dept_id,
      ${deptNameFromIpExpr} AS dept_name,
      'IP' AS type
    FROM [dbo].[Mast_IP_Admission] ip
    INNER JOIN [dbo].[Mast_Patient] pm ON ip.iPat_id = pm.iPat_id
    WHERE CAST(ip.dIP_dt AS DATE) = CAST(GETDATE() AS DATE)`;

  const query =
    visitType === "IP"
      ? `${ipSelect} ORDER BY dept_name, dept_id, name;`
      : visitType === "OP"
        ? `${opSelect} ORDER BY dept_name, dept_id, name;`
        : `${opSelect}
    UNION ALL
    ${ipSelect}
    ORDER BY dept_name, dept_id, name;`;

  try {
    const patients = await executeHisQueryWithRetry(query, 12_000);
    const mapped: HisPatientTodayRow[] = patients.map((patient) => ({
      patient_id: String(patient?.patient_id ?? ""),
      visit_id: String(patient?.visit_id ?? ""),
      name: String(patient?.name ?? "Unknown"),
      phone: String(patient?.phone ?? ""),
      dept_id: String(patient?.dept_id ?? ""),
      dept_name: String(patient?.dept_name ?? "").trim(),
      department:
        String(patient?.dept_name ?? "").trim() ||
        String(patient?.dept_id ?? "").trim() ||
        "General",
      type: patient?.type === "IP" ? "IP" : "OP",
    }));
    setCache(cacheKey, mapped, CACHE_TTL.HIS_PATIENTS);
    return mapped;
  } catch (error: unknown) {
    if (error instanceof HisError) throw error;
    console.error("Unexpected HIS service error", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    throw new HisError("Failed to fetch patients", 500);
  }
}

export type HisSearchFilters = {
  name?: string;
  reg_no?: string;
  date_from?: string;
  date_to?: string;
  dept_id?: string;
  dept_name?: string;
  /** Limit results to IP admissions, OP admissions, or both (default all). */
  visit_type?: HisVisitType;
  page?: number;
  page_size?: number;
};

function departmentMatchesFilter(
  rowDeptName: string,
  rowDeptId: string,
  filterName: string,
  filterId: string,
): boolean {
  if (!filterName && !filterId) return true;
  const id = filterId.trim();
  const rowId = rowDeptId.trim();
  if (id && rowId && id === rowId) return true;
  if (!filterName.trim()) return !id;
  const rowName = rowDeptName.trim();
  if (!rowName) return false;
  if (departmentSharesCanonicalKey(rowName, filterName)) return true;
  const rowKey = normalizeDepartmentKey(rowName);
  const filterKey = normalizeDepartmentKey(filterName);
  if (!rowKey || !filterKey) return false;
  return rowKey === filterKey || rowKey.includes(filterKey) || filterKey.includes(rowKey);
}

async function resolveSearchDeptId(deptId: string, deptName: string): Promise<string> {
  if (deptId.trim()) return deptId.trim();
  if (!deptName.trim() || !hisEnv.sqlConfigured) return "";
  try {
    const rows = await fetchHisDepartments();
    const hit = rows.find(
      (row) =>
        departmentSharesCanonicalKey(row.dept_name, deptName) ||
        normalizeDepartmentKey(row.dept_name) === normalizeDepartmentKey(deptName),
    );
    return hit?.dept_id ?? "";
  } catch {
    return "";
  }
}

function parseFilterDate(value: string): Date | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const parsed = new Date(`${trimmed}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveEmrSearchDateRange(filters: HisSearchFilters): { from: Date; to: Date } {
  const to = parseFilterDate(String(filters.date_to ?? "")) ?? new Date();
  const from =
    parseFilterDate(String(filters.date_from ?? "")) ??
    (() => {
      const start = new Date(to);
      start.setDate(start.getDate() - 90);
      return start;
    })();
  if (from.getTime() > to.getTime()) return { from: to, to: from };
  return { from, to };
}

function formatEmrDateTime(raw: string): string {
  const parsed = parseHisReportDischargeDate(raw);
  if (!parsed) return raw.trim();
  return parsed.toISOString().slice(0, 19).replace("T", " ");
}

function mapEmrGenderToCode(gender: string): string {
  const g = gender.trim().toUpperCase();
  if (g.startsWith("M")) return "M";
  if (g.startsWith("F")) return "F";
  return gender.trim();
}

function mapEmrIpPatDetailsToSearchRow(row: Record<string, unknown>): HisSearchRow {
  const regNo = readRowValue(row, ["REG NO", "REG_NO"]);
  const ipNo = readRowValue(row, ["IP NO", "IP_NO"]);
  const visitId = ipNo || regNo;
  const patName = readRowValue(row, ["PATIENT NAME", "PATIENT_NAME"]);
  const department = readRowValue(row, ["DEPARTMENT", "DEPT_NAME"]);
  const admissionRaw = readRowValue(row, ["ADMISSION DATE", "ADMISSION_DATE"]);
  const dischargeRaw = readRowValue(row, ["DISCHARGE DATE", "DISCHARGE_DATE"]);
  const gender = readRowValue(row, ["GENDER", "SEX", "cSex"]);

  return {
    patient_id: regNo || ipNo,
    visit_id: visitId,
    type: "IP",
    reg_no: visitId,
    i_reg_no: regNo,
    c_pat_name: patName || "Unknown",
    d_dob: "",
    c_sex: mapEmrGenderToCode(gender),
    i_user_id: "",
    i_user_name: readRowValue(row, ["DOCTOR"]),
    dept_id: "",
    dept_name: department,
    admission: formatEmrDateTime(admissionRaw),
    ip_active: /^active$/i.test(dischargeRaw) ? "1" : "",
    name: patName || "Unknown",
    department: department || "General",
  };
}

function mapEmrOpPatDetailsToSearchRow(row: Record<string, unknown>): HisSearchRow {
  const regNo = readRowValue(row, ["REG NO", "REG_NO"]);
  const tokenNo = readRowValue(row, ["TOKEN NO", "TOKEN_NO"]);
  const visitId = regNo || tokenNo;
  const patName = readRowValue(row, ["NAME", "PATIENT NAME", "PATIENT_NAME"]);
  const department = readRowValue(row, ["DEPARTMENT", "DEPT_NAME"]);
  const visitRaw = readRowValue(row, ["VISIT DATE", "VISIT_DATE", "ADMISSION DATE"]);
  const gender = readRowValue(row, ["GENDER", "SEX", "cSex"]);
  return {
    patient_id: regNo || tokenNo,
    visit_id: visitId,
    type: "OP",
    reg_no: visitId,
    i_reg_no: regNo,
    c_pat_name: patName || "Unknown",
    d_dob: "",
    c_sex: mapEmrGenderToCode(gender),
    i_user_id: "",
    i_user_name: readRowValue(row, ["DOCTOR"]),
    dept_id: "",
    dept_name: department,
    admission: formatEmrDateTime(visitRaw),
    ip_active: "",
    name: patName || "Unknown",
    department: department || "General",
  };
}

function mapEmrPatDetailsToSearchRow(row: Record<string, unknown>, type: "IP" | "OP"): HisSearchRow {
  if (type === "OP") return mapEmrOpPatDetailsToSearchRow(row);
  return mapEmrIpPatDetailsToSearchRow(row);
}

function rowMatchesRegFilter(row: Record<string, unknown>, regNo: string): boolean {
  if (!regNo) return true;
  const needle = regNo.trim().toUpperCase();
  const hay = [readRowValue(row, ["IP NO"]), readRowValue(row, ["REG NO"])].join(" ").toUpperCase();
  return hay.includes(needle);
}

const HIS_SEARCH_PAGE_SIZE_DEFAULT = 50;
const HIS_SEARCH_PAGE_SIZE_MAX = 100;

export type HisSearchCounts = {
  ip: number;
  op: number;
  total: number;
};

export type HisSearchResult = {
  rows: HisSearchRow[];
  counts: HisSearchCounts;
  showing: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type HisSearchCacheEntry = {
  allRows: HisSearchRow[];
};

function resolveSearchPagination(filters: HisSearchFilters): { page: number; pageSize: number } {
  const page = Math.max(1, Math.floor(Number(filters.page) || 1));
  const rawSize = Math.floor(Number(filters.page_size) || HIS_SEARCH_PAGE_SIZE_DEFAULT);
  const pageSize = Math.min(HIS_SEARCH_PAGE_SIZE_MAX, Math.max(10, rawSize));
  return { page, pageSize };
}

function paginateHisSearchRows(allMatched: HisSearchRow[], page: number, pageSize: number): HisSearchResult {
  const ip = allMatched.filter((row) => row.type === "IP").length;
  const op = allMatched.filter((row) => row.type === "OP").length;
  const total = allMatched.length;
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const rows = allMatched.slice(start, start + pageSize);
  return {
    rows,
    counts: { ip, op, total },
    showing: rows.length,
    page: safePage,
    pageSize,
    totalPages,
  };
}

function emptyHisSearchResult(page = 1, pageSize = HIS_SEARCH_PAGE_SIZE_DEFAULT): HisSearchResult {
  return {
    rows: [],
    counts: { ip: 0, op: 0, total: 0 },
    showing: 0,
    page,
    pageSize,
    totalPages: 1,
  };
}

async function searchHisPatientsViaEmr(filters: HisSearchFilters): Promise<HisSearchResult> {
  const name = String(filters.name ?? "").trim();
  const regNo = String(filters.reg_no ?? "").trim();
  const deptName = String(filters.dept_name ?? "").trim();
  const deptId = await resolveSearchDeptId(String(filters.dept_id ?? "").trim(), deptName);
  const visitType: HisVisitType = filters.visit_type ?? "all";
  const { page, pageSize } = resolveSearchPagination(filters);
  const { from, to } = resolveEmrSearchDateRange(filters);

  const cacheKey = `his:search:emr:v3:${JSON.stringify({ name, regNo, deptName, deptId, from: from.toISOString(), to: to.toISOString(), visitType })}`;
  const cached = getCache(cacheKey);
  if (cached) return paginateHisSearchRows((cached as HisSearchCacheEntry).allRows, page, pageSize);

  try {
    const emrDeptId = deptId || "0";
    const batchDefs: { type: "IP" | "OP"; promise: Promise<Record<string, unknown>[]> }[] = [];
    if (visitType === "IP" || visitType === "all") {
      batchDefs.push({
        type: "IP",
        promise: fetchPatDetailsFromEmr(from, to, {
          optoip: "0",
          ipno: regNo,
          patname: name,
          depid: emrDeptId,
        }),
      });
    }
    if (visitType === "OP" || visitType === "all") {
      batchDefs.push({
        type: "OP",
        promise: fetchOpPatDetailsFromEmr(from, to, regNo, name, emrDeptId),
      });
    }

    const batchResults = await Promise.all(
      batchDefs.map(async (batch) => ({ type: batch.type, rows: await batch.promise })),
    );
    const seen = new Set<string>();
    const mapped: HisSearchRow[] = [];

    for (const { type, rows: rawRows } of batchResults) {
      for (const row of rawRows) {
      if (isEmrZPatientRow(row)) continue;
      if (regNo && !rowMatchesRegFilter(row, regNo)) continue;
      if (name) {
        const patientName = readRowValue(row, ["PATIENT NAME"]).toUpperCase();
        if (!patientName.includes(name.toUpperCase())) continue;
      }
      const mappedRow = mapEmrPatDetailsToSearchRow(row, type);
      if (!departmentMatchesFilter(mappedRow.dept_name, mappedRow.dept_id, deptName, deptId)) continue;
      const dedupeKey = `${mappedRow.type}:${mappedRow.visit_id}`;
      if (!mappedRow.visit_id || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      mapped.push(mappedRow);
      }
    }

    mapped.sort((a, b) => String(b.admission).localeCompare(String(a.admission)));
    const entry: HisSearchCacheEntry = { allRows: mapped };
    setCache(cacheKey, entry, CACHE_TTL.HIS_SEARCH);
    return paginateHisSearchRows(mapped, page, pageSize);
  } catch (error: unknown) {
    if (error instanceof HisError) throw error;
    console.error("EMR patient search failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    throw new HisError("Unable to search patients via EMR Query Builder", 503);
  }
}

export async function searchHisPatients(filters: HisSearchFilters = {}): Promise<HisSearchResult> {
  const { page, pageSize } = resolveSearchPagination(filters);
  if (!hisEnv.enabled) return emptyHisSearchResult(page, pageSize);
  const name = String(filters.name ?? "").trim();
  const regNo = String(filters.reg_no ?? "").trim();
  const dateFrom = String(filters.date_from ?? "").trim();
  const dateTo = String(filters.date_to ?? "").trim();
  const deptName = String(filters.dept_name ?? "").trim();
  const deptId = String(filters.dept_id ?? "").trim();
  const visitType: HisVisitType = filters.visit_type ?? "all";

  if (!name && !regNo && !dateFrom && !dateTo && !deptName && !deptId) {
    return emptyHisSearchResult(page, pageSize);
  }

  if (hisEnv.queryBuilderConfigured) {
    return searchHisPatientsViaEmr(filters);
  }

  if (!hisEnv.sqlConfigured) return emptyHisSearchResult(page, pageSize);

  const cacheKey = `his:search:${JSON.stringify({ name, regNo, dateFrom, dateTo, deptName, deptId, visitType })}`;
  const cached = getCache(cacheKey);
  if (cached) return paginateHisSearchRows((cached as HisSearchCacheEntry).allRows, page, pageSize);

  const lookupMeta = await getLookupMeta();
  const deptNameFromOpExpr = lookupMeta?.dept
    ? `(SELECT TOP 1 CAST(lu.${lookupMeta.dept.nameCol} AS VARCHAR(200)) FROM ${lookupMeta.dept.table} lu WHERE CAST(lu.${lookupMeta.dept.idCol} AS VARCHAR(100)) = CAST(op.iDept_id AS VARCHAR(100)))`
    : "CAST(NULL AS VARCHAR(200))";
  const deptNameFromIpExpr = lookupMeta?.dept
    ? `(SELECT TOP 1 CAST(lu.${lookupMeta.dept.nameCol} AS VARCHAR(200)) FROM ${lookupMeta.dept.table} lu WHERE CAST(lu.${lookupMeta.dept.idCol} AS VARCHAR(100)) = CAST(ip.iDept_id AS VARCHAR(100)))`
    : "CAST(NULL AS VARCHAR(200))";
  const userNameExpr = lookupMeta?.user
    ? `(SELECT TOP 1 CAST(uu.${lookupMeta.user.nameCol} AS VARCHAR(200)) FROM ${lookupMeta.user.table} uu WHERE CAST(uu.${lookupMeta.user.idCol} AS VARCHAR(100)) = CAST(pm.iUser_id AS VARCHAR(100)))`
    : "CAST(NULL AS VARCHAR(200))";

  const opConds: string[] = [];
  const ipConds: string[] = [];

  if (name) {
    opConds.push("pm.cPat_Name LIKE '%' + @name + '%'");
    ipConds.push("pm.cPat_Name LIKE '%' + @name + '%'");
  }
  if (regNo) {
    opConds.push(
      "(CAST(op.iOP_Reg_No AS VARCHAR(100)) LIKE '%' + @regNo + '%' OR CAST(pm.iReg_No AS VARCHAR(100)) LIKE '%' + @regNo + '%')",
    );
    ipConds.push(
      "(CAST(ip.iIP_Reg_No AS VARCHAR(100)) LIKE '%' + @regNo + '%' OR CAST(pm.iReg_No AS VARCHAR(100)) LIKE '%' + @regNo + '%')",
    );
  }
  if (dateFrom) {
    opConds.push("op.dOP_dt >= @dateFrom");
    ipConds.push("ip.dIP_dt >= @dateFrom");
  }
  if (dateTo) {
    opConds.push("op.dOP_dt <= @dateTo");
    ipConds.push("ip.dIP_dt <= @dateTo");
  }
  if (deptId) {
    opConds.push("CAST(op.iDept_id AS VARCHAR(100)) = @deptId");
    ipConds.push("CAST(ip.iDept_id AS VARCHAR(100)) = @deptId");
  } else if (deptName) {
    opConds.push(`LTRIM(RTRIM(UPPER(${deptNameFromOpExpr}))) LIKE '%' + UPPER(@deptName) + '%'`);
    ipConds.push(`LTRIM(RTRIM(UPPER(${deptNameFromIpExpr}))) LIKE '%' + UPPER(@deptName) + '%'`);
  }

  const opWhere = opConds.length ? `AND ${opConds.join(" AND ")}` : "";
  const ipWhere = ipConds.length ? `AND ${ipConds.join(" AND ")}` : "";

  const opMatchRank = regNo
    ? "CASE WHEN LTRIM(RTRIM(UPPER(CAST(op.iOP_Reg_No AS VARCHAR(100))))) = LTRIM(RTRIM(UPPER(@regNo))) OR LTRIM(RTRIM(UPPER(CAST(pm.iReg_No AS VARCHAR(100))))) = LTRIM(RTRIM(UPPER(@regNo))) THEN 0 ELSE 1 END"
    : "1";
  const ipMatchRank = regNo
    ? "CASE WHEN LTRIM(RTRIM(UPPER(CAST(ip.iIP_Reg_No AS VARCHAR(100))))) = LTRIM(RTRIM(UPPER(@regNo))) OR LTRIM(RTRIM(UPPER(CAST(pm.iReg_No AS VARCHAR(100))))) = LTRIM(RTRIM(UPPER(@regNo))) THEN 0 ELSE 1 END"
    : "1";

  const opBranch = `
      SELECT
        CAST(pm.iPat_id AS VARCHAR(100)) AS patient_id,
        CAST(op.iOP_Reg_No AS VARCHAR(100)) AS visit_id,
        CAST(pm.iReg_No AS VARCHAR(100)) AS i_reg_no,
        CAST(pm.cPat_Name AS VARCHAR(200)) AS c_pat_name,
        pm.dDob AS d_dob,
        CAST(pm.cSex AS VARCHAR(20)) AS c_sex,
        CAST(pm.iUser_id AS VARCHAR(100)) AS i_user_id,
        ${userNameExpr} AS i_user_name,
        CAST(op.iDept_id AS VARCHAR(100)) AS dept_id,
        ${deptNameFromOpExpr} AS dept_name,
        op.dOP_dt AS admission,
        CAST(NULL AS VARCHAR(50)) AS ip_active,
        'OP' AS type,
        op.dOP_dt AS visit_datetime,
        ${opMatchRank} AS match_rank
      FROM [dbo].[Mast_OP_Admission] op
      INNER JOIN [dbo].[Mast_Patient] pm ON op.iPat_id = pm.iPat_id
      WHERE 1 = 1
      ${opWhere}`;

  const ipBranch = `
      SELECT
        CAST(pm.iPat_id AS VARCHAR(100)) AS patient_id,
        CAST(ip.iIP_Reg_No AS VARCHAR(100)) AS visit_id,
        CAST(pm.iReg_No AS VARCHAR(100)) AS i_reg_no,
        CAST(pm.cPat_Name AS VARCHAR(200)) AS c_pat_name,
        pm.dDob AS d_dob,
        CAST(pm.cSex AS VARCHAR(20)) AS c_sex,
        CAST(pm.iUser_id AS VARCHAR(100)) AS i_user_id,
        ${userNameExpr} AS i_user_name,
        CAST(ip.iDept_id AS VARCHAR(100)) AS dept_id,
        ${deptNameFromIpExpr} AS dept_name,
        ip.dIP_dt AS admission,
        CAST(ip.bStatus AS VARCHAR(50)) AS ip_active,
        'IP' AS type,
        ip.dIP_dt AS visit_datetime,
        ${ipMatchRank} AS match_rank
      FROM [dbo].[Mast_IP_Admission] ip
      INNER JOIN [dbo].[Mast_Patient] pm ON ip.iPat_id = pm.iPat_id
      WHERE 1 = 1
      ${ipWhere}`;

  const combinedInner =
    visitType === "IP" ? ipBranch : visitType === "OP" ? opBranch : `${opBranch}\n      UNION ALL\n${ipBranch}`;

  const query = `
    WITH Combined AS (
    ${combinedInner}
    )
    SELECT TOP 50
      patient_id,
      visit_id,
      i_reg_no,
      c_pat_name,
      d_dob,
      c_sex,
      i_user_id,
      i_user_name,
      dept_id,
      dept_name,
      admission,
      ip_active,
      type,
      visit_datetime
    FROM Combined
    ORDER BY match_rank ASC, visit_datetime DESC;
  `;

  const bindParams = (request: sql.Request) => {
    if (name) request.input("name", sql.NVarChar(500), name);
    if (regNo) request.input("regNo", sql.NVarChar(200), regNo);
    if (dateFrom) request.input("dateFrom", sql.DateTime, new Date(`${dateFrom}T00:00:00`));
    if (dateTo) request.input("dateTo", sql.DateTime, new Date(`${dateTo}T23:59:59.997`));
    if (deptId) request.input("deptId", sql.NVarChar(100), deptId);
    if (deptName) request.input("deptName", sql.NVarChar(200), deptName);
  };

  try {
    const rows = await executeHisQueryWithRetry(query, 12_000, bindParams);
    const fmtDate = (v: unknown) => {
      if (v == null || v === "") return "";
      const d = v instanceof Date ? v : new Date(String(v));
      return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
    };
    const fmtDateTime = (v: unknown) => {
      if (v == null || v === "") return "";
      const d = v instanceof Date ? v : new Date(String(v));
      return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 19).replace("T", " ");
    };
    const mapped: HisSearchRow[] = rows.map((item) => {
      const type = item?.type === "IP" ? "IP" : "OP";
      const dept = String(item?.dept_id ?? "");
      const patName = String(item?.c_pat_name ?? "Unknown");
      return {
        patient_id: String(item?.patient_id ?? ""),
        visit_id: String(item?.visit_id ?? ""),
        type,
        reg_no: String(item?.visit_id ?? ""),
        i_reg_no: String(item?.i_reg_no ?? ""),
        c_pat_name: patName,
        d_dob: fmtDate(item?.d_dob),
        c_sex: String(item?.c_sex ?? "").trim(),
        i_user_id: String(item?.i_user_id ?? ""),
        i_user_name: String(item?.i_user_name ?? "").trim(),
        dept_id: dept,
        dept_name: String(item?.dept_name ?? "").trim(),
        admission: fmtDateTime(item?.admission),
        ip_active:
          type === "IP" && item?.ip_active != null && item?.ip_active !== ""
            ? String(item.ip_active)
            : "",
        name: patName,
        department: String(item?.dept_name ?? "").trim() || dept,
      };
    });
    const entry: HisSearchCacheEntry = { allRows: mapped };
    setCache(cacheKey, entry, CACHE_TTL.HIS_SEARCH);
    return paginateHisSearchRows(mapped, page, pageSize);
  } catch (error: unknown) {
    if (error instanceof HisError) throw error;
    console.error("HIS patient search failed", {
      message: error instanceof Error ? error.message : "Unknown SQL error",
    });
    throw new HisError("Unable to search patients", 503);
  }
}

export type HisSearchRow = {
  patient_id: string;
  visit_id: string;
  type: "IP" | "OP";
  reg_no: string;
  i_reg_no: string;
  c_pat_name: string;
  d_dob: string;
  c_sex: string;
  i_user_id: string;
  i_user_name: string;
  dept_id: string;
  dept_name: string;
  admission: string;
  ip_active: string;
  name: string;
  department: string;
};

export async function fetchHisDepartments(): Promise<
  { dept_id: string; dept_name: string; department: string }[]
> {
  if (!hisEnv.enabled) return [];
  const cacheKey = "his:departments";
  const cached = getCache(cacheKey);
  if (cached) return cached as { dept_id: string; dept_name: string; department: string }[];

  const lookupMeta = await getLookupMeta();
  if (!lookupMeta?.dept) return [];

  const query = `
    SELECT DISTINCT
      CAST(lu.${lookupMeta.dept.idCol} AS VARCHAR(100)) AS dept_id,
      CAST(lu.${lookupMeta.dept.nameCol} AS VARCHAR(200)) AS dept_name
    FROM ${lookupMeta.dept.table} lu
    WHERE lu.${lookupMeta.dept.nameCol} IS NOT NULL
      AND LTRIM(RTRIM(CAST(lu.${lookupMeta.dept.nameCol} AS VARCHAR(200)))) <> ''
    ORDER BY dept_name;
  `;

  try {
    const rows = await executeHisQueryWithRetry(query, 12_000);
    const mapped = rows.map((row) => ({
      dept_id: String(row?.dept_id ?? "").trim(),
      dept_name: String(row?.dept_name ?? "").trim(),
      department: String(row?.dept_name ?? "").trim(),
    }));
    setCache(cacheKey, mapped, CACHE_TTL.DEPARTMENTS);
    return mapped;
  } catch (error: unknown) {
    if (error instanceof HisError) throw error;
    console.error("HIS department fetch failed", {
      message: error instanceof Error ? error.message : "Unknown SQL error",
    });
    throw new HisError("Unable to fetch departments from HIS", 503);
  }
}

export type HisDepartmentOption = {
  dept_id: string;
  dept_name: string;
};

/** Full HIS department list for Admission Desk search filter (not limited to PG-tracked departments). */
export async function fetchHisDepartmentSearchOptions(): Promise<HisDepartmentOption[]> {
  if (!hisEnv.enabled) return [];

  const cacheKey = "his:department-options";
  const cached = getCache(cacheKey);
  if (cached) return cached as HisDepartmentOption[];

  if (hisEnv.sqlConfigured) {
    try {
      const rows = await fetchHisDepartments();
      const mapped = rows
        .map((row) => ({ dept_id: row.dept_id, dept_name: row.dept_name }))
        .filter((row) => row.dept_name);
      setCache(cacheKey, mapped, CACHE_TTL.DEPARTMENTS);
      return mapped;
    } catch {
      /* fall through to EMR discovery */
    }
  }

  if (!hisEnv.queryBuilderConfigured) return [];

  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 30);

  try {
    const [ipRows, opRows] = await Promise.all([
      fetchPatDetailsFromEmr(from, to, { optoip: "0" }),
      fetchOpPatDetailsFromEmr(from, to),
    ]);
    const seen = new Map<string, HisDepartmentOption>();
    for (const row of [...ipRows, ...opRows]) {
      if (isEmrZPatientRow(row)) continue;
      const deptName = readRowValue(row, ["DEPARTMENT", "DEPT_NAME"]).trim();
      if (!deptName) continue;
      const key = normalizeDepartmentKey(deptName);
      if (!seen.has(key)) seen.set(key, { dept_id: "", dept_name: deptName });
    }
    const mapped = [...seen.values()].sort((a, b) => a.dept_name.localeCompare(b.dept_name));
    setCache(cacheKey, mapped, 60 * 60 * 1000);
    return mapped;
  } catch (error: unknown) {
    if (error instanceof HisError) throw error;
    console.error("EMR department option discovery failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    throw new HisError("Unable to fetch HIS department list", 503);
  }
}

export async function fetchPatientDemographics(
  patientIds: string[],
): Promise<Record<string, { name: string; phone: string }>> {
  if (!hisEnv.enabled) return {};
  const normalized = [...new Set(patientIds.map((id) => String(id ?? "").trim()))].filter(Boolean);
  if (!normalized.length) return {};

  const cacheKey = `his:demo:${normalized.join(",")}`;
  const cached = getCache(cacheKey);
  if (cached) return cached as Record<string, { name: string; phone: string }>;

  const phoneExpr = await getPatientPhoneExpression();
  const params = normalized.map((_item, index) => `@p${index}`);
  const query = `
    SELECT
      CAST(pm.iPat_id AS VARCHAR(100)) AS patient_id,
      CAST(pm.cPat_Name AS VARCHAR(200)) AS name,
      ${phoneExpr} AS phone
    FROM [dbo].[Mast_Patient] pm
    WHERE CAST(pm.iPat_id AS VARCHAR(100)) IN (${params.join(", ")});
  `;
  try {
    const rows = await executeHisQueryWithRetry(query, 12_000, (request) => {
      normalized.forEach((id, index) => {
        request.input(`p${index}`, sql.VarChar, id);
      });
    });
    const mapped = rows.reduce<Record<string, { name: string; phone: string }>>((acc, row) => {
      const key = String(row?.patient_id ?? "");
      acc[key] = {
        name: String(row?.name ?? "Unknown"),
        phone: String(row?.phone ?? ""),
      };
      return acc;
    }, {});
    setCache(cacheKey, mapped, CACHE_TTL.DEMOGRAPHICS);
    return mapped;
  } catch (error: unknown) {
    console.error("Failed to fetch patient demographics", {
      message: error instanceof Error ? error.message : "Unknown SQL error",
    });
    return {};
  }
}

export type HisIpDischargeRow = {
  ipNumber: string;
  patientName: string;
  dischargeDate: Date | null;
};

function formatHisReportDate(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const year = value.getFullYear();
  return `${month}/${day}/${year}`;
}

function readRowValue(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const direct = row[key];
    if (direct != null && String(direct).trim() !== "") return String(direct).trim();
    const upper = row[key.toUpperCase()];
    if (upper != null && String(upper).trim() !== "") return String(upper).trim();
  }
  return "";
}

export function parseHisReportDischargeDate(raw: string): Date | null {
  const value = String(raw ?? "").trim();
  if (!value || /^active$/i.test(value)) return null;

  const dmyTime = value.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (dmyTime) {
    const day = Number(dmyTime[1]);
    const month = Number(dmyTime[2]) - 1;
    const year = Number(dmyTime[3]);
    const hours = Number(dmyTime[4] ?? 0);
    const minutes = Number(dmyTime[5] ?? 0);
    const parsed = new Date(year, month, day, hours, minutes);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function mapHisDischargeReportRow(row: Record<string, unknown>): HisIpDischargeRow {
  const ipNumber = readRowValue(row, ["IP NO", "IP_NO", "ip_no", "iIP_Reg_No", "visit_id"]);
  const patientName = readRowValue(row, ["PATIENT NAME", "PATIENT_NAME", "c_pat_name", "cPat_Name"]);
  const dischargeRaw = readRowValue(row, ["DISCHARGE DATE", "DISCHARGE_DATE", "dDischarge_dt", "discharge_date"]);
  return {
    ipNumber,
    patientName,
    dischargeDate: parseHisReportDischargeDate(dischargeRaw),
  };
}

/**
 * IP discharge report via EMR Query Builder (Fo_Rpt_IPPatdetailsprint_QB payload) — read-only.
 */
export async function fetchHisIpDischargeReport(from: Date, to: Date): Promise<HisIpDischargeRow[]> {
  if (!hisEnv.queryBuilderConfigured) return [];

  const cacheKey = `his:discharge-report:emr:${formatHisReportDate(from)}:${formatHisReportDate(to)}`;
  const cached = getCache(cacheKey);
  if (cached) return cached as HisIpDischargeRow[];

  try {
    const rows = await fetchIpPatDetailsFromEmr(from, to);
    const mapped = rows.map((row) => mapHisDischargeReportRow(row));
    setCache(cacheKey, mapped, 60_000);
    return mapped;
  } catch (error: unknown) {
    if (error instanceof HisError) throw error;
    console.error("EMR discharge report failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    throw new HisError("Unable to fetch discharge data from EMR Query Builder", 503);
  }
}

export async function fetchHisDischargeByIpNumbers(
  ipNumbers: string[],
  from: Date,
  to: Date,
): Promise<HisIpDischargeRow[]> {
  const normalized = [...new Set(ipNumbers.map((ip) => ip.trim().toUpperCase()).filter(Boolean))];
  if (!normalized.length) return [];

  const report = await fetchHisIpDischargeReport(from, to);
  const wanted = new Set(normalized);
  return report.filter((row) => {
    const ip = row.ipNumber.trim().toUpperCase();
    return ip && wanted.has(ip) && row.dischargeDate != null;
  });
}

export async function checkPatientExistsInHis(patientId: string, visitId: string): Promise<boolean> {
  if (!hisEnv.enabled) return true;
  const id = String(patientId ?? "").trim();
  const visit = String(visitId ?? "").trim();
  const cacheKey = `his:exists:${id}:${visit}`;
  const cached = getCache(cacheKey);
  if (typeof cached === "boolean") return cached;

  const query = `
    SELECT TOP 1 patient_id, visit_id FROM (
      SELECT CAST(pm.iPat_id AS VARCHAR(100)) AS patient_id, CAST(op.iOP_Reg_No AS VARCHAR(100)) AS visit_id
      FROM [dbo].[Mast_OP_Admission] op
      INNER JOIN [dbo].[Mast_Patient] pm ON op.iPat_id = pm.iPat_id
      UNION ALL
      SELECT CAST(pm.iPat_id AS VARCHAR(100)) AS patient_id, CAST(ip.iIP_Reg_No AS VARCHAR(100)) AS visit_id
      FROM [dbo].[Mast_IP_Admission] ip
      INNER JOIN [dbo].[Mast_Patient] pm ON ip.iPat_id = pm.iPat_id
    ) p
    WHERE p.patient_id = @patientId AND p.visit_id = @visitId;
  `;

  try {
    const pool = await getHisPool();
    const request = pool.request();
    request.input("patientId", sql.VarChar, id);
    request.input("visitId", sql.VarChar, visit);
    request.timeout = 10_000;
    const result = await request.query(query);
    const exists = (result?.recordset?.length ?? 0) > 0;
    setCache(cacheKey, exists, CACHE_TTL.EXISTS);
    return exists;
  } catch (error: unknown) {
    console.error("Failed patient existence check in HIS", {
      message: error instanceof Error ? error.message : "Unknown SQL error",
    });
    throw new HisError("Unable to verify patient in HIS", 503);
  }
}
