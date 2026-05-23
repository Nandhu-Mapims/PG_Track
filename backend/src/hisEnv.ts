/**
 * KMCH / front-office SQL (OP+IP).
 *
 * Option A — paste the same value as Web.config `BB_CONSTR` (recommended):
 *   HIS_ENABLED=true
 *   BB_CONSTR=Server=...;Database=...;User Id=...;Password=...;
 *
 * Option B — split variables:
 *   HIS_ENABLED=true
 *   OP_IP_DB_SERVER=hostname
 *   OP_IP_DB_NAME=database
 *   OP_IP_DB_USER=user
 *   OP_IP_DB_PASS=secret
 *
 * Optional: OP_IP_DB_PORT, OP_IP_DB_ENCRYPT, OP_IP_DB_TRUST_CERT
 */

function isTrue(v: string | undefined): boolean {
  return String(v ?? "").toLowerCase() === "true" || v === "1";
}

type ParsedConstr = {
  server?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
};

/** Split ADO.NET style "Key=Value;Key2=Value2" (first `=` per segment). */
function parseConnectionString(raw: string): ParsedConstr {
  const out: ParsedConstr = {};
  const s = raw.trim();
  if (!s) return out;

  for (const segment of s.split(";")) {
    const t = segment.trim();
    if (!t) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim().toLowerCase();
    const value = t.slice(eq + 1).trim();

    switch (key) {
      case "data source":
      case "server":
      case "addr":
      case "address":
      case "network address": {
        let ds = value;
        if (ds.toLowerCase().startsWith("tcp:")) {
          ds = ds.slice(4).trim();
        }
        const lastComma = ds.lastIndexOf(",");
        if (lastComma !== -1) {
          const maybePort = ds.slice(lastComma + 1).trim();
          if (/^\d+$/.test(maybePort)) {
            out.server = ds.slice(0, lastComma).trim();
            out.port = Number(maybePort);
            break;
          }
        }
        out.server = ds.trim();
        break;
      }
      case "initial catalog":
      case "database":
        out.database = value;
        break;
      case "user id":
      case "uid":
      case "user":
        out.user = value;
        break;
      case "password":
      case "pwd":
        out.password = value;
        break;
      case "encrypt":
        out.encrypt = isTrue(value);
        break;
      case "trustservercertificate":
        out.trustServerCertificate = isTrue(value);
        break;
      default:
        break;
    }
  }
  return out;
}

function mergeConstr(): ParsedConstr {
  const bb = (process.env.BB_CONSTR ?? "").trim();
  if (bb) return parseConnectionString(bb);
  const cs = (process.env.OP_IP_CONNECTION_STRING ?? "").trim();
  if (cs) return parseConnectionString(cs);
  return {};
}

export const hisEnv = {
  get enabled(): boolean {
    return isTrue(process.env.HIS_ENABLED);
  },

  /** EMR Query Builder Getdataset1 — discharge / report payloads (no local SQL). */
  get queryBuilderUrl(): string {
    return (
      process.env.EMR_QUERY_BUILDER_URL?.trim() ||
      "https://emr.mapims.edu.in/BB15SE/QueryBuilder/wsQueryBuilder.asmx/Getdataset1"
    );
  },

  get queryBuilderStrCon(): string {
    return (process.env.EMR_QUERY_STR_CON ?? "BB_CONSTR").trim() || "BB_CONSTR";
  },

  get queryBuilderConfigured(): boolean {
    return Boolean(this.enabled && this.queryBuilderUrl);
  },

  get sqlConfigured(): boolean {
    const c = mergeConstr();
    const server = (c.server ?? process.env.OP_IP_DB_SERVER ?? "").trim();
    const database = (c.database ?? process.env.OP_IP_DB_NAME ?? "").trim();
    const user = (c.user ?? process.env.OP_IP_DB_USER ?? "").trim();
    const hasPassword = (c.password ?? process.env.OP_IP_DB_PASS) != null;
    const password = String(c.password ?? process.env.OP_IP_DB_PASS ?? "");
    return Boolean(server && database && user && hasPassword && password.length > 0);
  },

  get host(): string {
    const c = mergeConstr();
    return (c.server ?? process.env.OP_IP_DB_SERVER ?? "").trim();
  },

  get port(): number {
    const c = mergeConstr();
    if (c.port != null && Number.isFinite(c.port) && c.port > 0) return c.port;
    const p = Number(process.env.OP_IP_DB_PORT ?? process.env.OP_IP_DB_SQL_PORT ?? 1433);
    return Number.isFinite(p) && p > 0 ? p : 1433;
  },

  get database(): string {
    const c = mergeConstr();
    return (c.database ?? process.env.OP_IP_DB_NAME ?? "").trim();
  },

  get user(): string {
    const c = mergeConstr();
    return (c.user ?? process.env.OP_IP_DB_USER ?? "").trim();
  },

  get password(): string {
    const c = mergeConstr();
    return String(c.password ?? process.env.OP_IP_DB_PASS ?? "");
  },

  get encrypt(): boolean {
    const c = mergeConstr();
    if (c.encrypt !== undefined) return c.encrypt;
    return isTrue(process.env.OP_IP_DB_ENCRYPT);
  },

  get trustServerCertificate(): boolean {
    const c = mergeConstr();
    if (c.trustServerCertificate !== undefined) return c.trustServerCertificate;
    if (process.env.OP_IP_DB_TRUST_CERT === undefined) return true;
    return isTrue(process.env.OP_IP_DB_TRUST_CERT);
  },
};
