import sql from "mssql";
import { hisEnv } from "./hisEnv";

let poolPromise: Promise<sql.ConnectionPool> | null = null;

function buildConfig(): sql.config {
  return {
    server: hisEnv.host,
    port: hisEnv.port,
    database: hisEnv.database,
    user: hisEnv.user,
    password: hisEnv.password,
    options: {
      encrypt: hisEnv.encrypt,
      trustServerCertificate: hisEnv.trustServerCertificate,
    },
    pool: {
      min: 0,
      max: 10,
      idleTimeoutMillis: 30_000,
    },
  };
}

/** Returns a singleton pool. Caller must ensure `hisEnv.enabled && hisEnv.sqlConfigured`. */
export async function getHisPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    poolPromise = sql.connect(buildConfig());
  }
  try {
    return await poolPromise;
  } catch (err) {
    poolPromise = null;
    throw err;
  }
}

export { sql };
