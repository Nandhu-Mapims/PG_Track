import { Router } from "express";
import { authMiddleware } from "./middleware";
import { hisEnv } from "./hisEnv";
import {
  checkPatientExistsInHis,
  fetchHisDepartments,
  fetchHisPatients,
  fetchPatientDemographics,
  HisError,
  searchHisPatients,
} from "./hisService";
import { syncDischargesFromHis } from "./hisDischargeSync";

function parseVisitType(raw: unknown): "all" | "IP" | "OP" {
  const t = String(raw ?? "").toUpperCase();
  if (t === "IP") return "IP";
  if (t === "OP") return "OP";
  return "all";
}

function sendHisError(res: import("express").Response, err: unknown) {
  if (err instanceof HisError) {
    return res.status(err.statusCode).json({ message: err.message });
  }
  const message = err instanceof Error ? err.message : "HIS error";
  return res.status(503).json({ message });
}

export function registerHisRoutes(apiRouter: Router) {
  apiRouter.get("/his/status", authMiddleware, (_req, res) => {
    res.json({
      enabled: hisEnv.enabled,
      configured: hisEnv.sqlConfigured || hisEnv.queryBuilderConfigured,
      sqlConfigured: hisEnv.sqlConfigured,
      queryBuilderConfigured: hisEnv.queryBuilderConfigured,
      queryBuilderUrl: hisEnv.queryBuilderConfigured ? hisEnv.queryBuilderUrl : null,
      active: hisEnv.enabled && (hisEnv.sqlConfigured || hisEnv.queryBuilderConfigured),
      admissionSearchSource: hisEnv.queryBuilderConfigured ? "emr-query-builder" : "sql",
      dischargeSource: "emr-query-builder",
    });
  });

  apiRouter.get("/his/patients/today", authMiddleware, async (req, res) => {
    if (!hisEnv.enabled || !hisEnv.sqlConfigured) {
      return res.json([]);
    }
    try {
      const visitType = parseVisitType(req.query.type);
      const rows = await fetchHisPatients({ visitType });
      return res.json(rows);
    } catch (err) {
      return sendHisError(res, err);
    }
  });

  apiRouter.post("/his/search", authMiddleware, async (req, res) => {
    if (!hisEnv.enabled || (!hisEnv.sqlConfigured && !hisEnv.queryBuilderConfigured)) {
      return res.json({
        rows: [],
        counts: { ip: 0, op: 0, total: 0 },
        showing: 0,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      });
    }
    try {
      const body = req.body as Record<string, unknown>;
      const result = await searchHisPatients({
        name: String(body.name ?? "").trim(),
        reg_no: String(body.reg_no ?? "").trim(),
        date_from: String(body.date_from ?? "").trim(),
        date_to: String(body.date_to ?? "").trim(),
        visit_type: parseVisitType(body.visit_type),
        page: Number(body.page) || 1,
        page_size: Number(body.page_size) || 50,
      });
      return res.json(result);
    } catch (err) {
      return sendHisError(res, err);
    }
  });

  apiRouter.get("/his/departments", authMiddleware, async (_req, res) => {
    if (!hisEnv.enabled || !hisEnv.sqlConfigured) {
      return res.json([]);
    }
    try {
      const rows = await fetchHisDepartments();
      return res.json(rows);
    } catch (err) {
      return sendHisError(res, err);
    }
  });

  apiRouter.post("/his/demographics", authMiddleware, async (req, res) => {
    if (!hisEnv.enabled || !hisEnv.sqlConfigured) {
      return res.json({});
    }
    try {
      const ids = (req.body as { patientIds?: string[] })?.patientIds ?? [];
      const rows = await fetchPatientDemographics(Array.isArray(ids) ? ids : []);
      return res.json(rows);
    } catch {
      return res.json({});
    }
  });

  apiRouter.post("/his/sync-discharges", authMiddleware, async (_req, res) => {
    if (!hisEnv.queryBuilderConfigured) {
      return res.json({ hisActive: false, checked: 0, discharged: 0, skipped: 0 });
    }
    try {
      const result = await syncDischargesFromHis();
      return res.json(result);
    } catch (err) {
      return sendHisError(res, err);
    }
  });

  apiRouter.get("/his/exists", authMiddleware, async (req, res) => {
    if (!hisEnv.enabled || !hisEnv.sqlConfigured) {
      return res.json({ exists: true, skipped: true });
    }
    try {
      const patientId = String(req.query.patient_id ?? "").trim();
      const visitId = String(req.query.visit_id ?? "").trim();
      if (!patientId || !visitId) {
        return res.status(400).json({ message: "patient_id and visit_id are required" });
      }
      const exists = await checkPatientExistsInHis(patientId, visitId);
      return res.json({ exists });
    } catch (err) {
      return sendHisError(res, err);
    }
  });
}
