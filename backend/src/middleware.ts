import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { AuditLog, User, UserRole } from "./models";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: UserRole;
  };
}

export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 400,
});

export function signToken(payload: { id: string; username: string; role: UserRole }) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" });
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Missing token" });
  }
  const token = authorization.replace("Bearer ", "");
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; username: string; role: UserRole };
    const user = await User.findById(decoded.id);
    if (!user || user.get("status") === "Inactive") {
      return res.status(401).json({ message: "Invalid user" });
    }
    req.user = decoded;
    return next();
  } catch (_error) {
    return res.status(401).json({ message: "Invalid token" });
  }
}

export function requireRoles(...roles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    return next();
  };
}

/** Resident PG allocations: only HOD or Admin (substitute/coverage when PGs are absent). */
export function requireAssignmentManager(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ message: "Unauthorized" });
  if (req.user.role !== "HOD" && req.user.role !== "Admin") {
    return res.status(403).json({
      message:
        "Only Head of Department or Administrator can create, release, or change resident allocations.",
    });
  }
  return next();
}

export function auditLogger(module: string, action: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    const resolvePatientRef = () => {
      const body = req.body as Record<string, unknown>;
      const patient = (body?.patient as Record<string, unknown> | undefined) ?? undefined;
      const fromIp = typeof patient?.ipNumber === "string" ? patient.ipNumber : undefined;
      const fromBodyIp = typeof body?.ipNumber === "string" ? body.ipNumber : undefined;
      const fromPatientId = typeof body?.patientId === "string" ? body.patientId : undefined;
      const fromParams = typeof req.params?.patientId === "string" ? req.params.patientId : undefined;
      return fromIp || fromBodyIp || fromPatientId || fromParams || null;
    };

    res.on("finish", () => {
      void AuditLog.create({
        userId: user?.id,
        username: user?.username ?? "anonymous",
        patientRef: resolvePatientRef(),
        action,
        module,
        method: req.method,
        path: req.path,
        status: res.statusCode >= 400 ? "Failed" : "Success",
        statusCode: res.statusCode,
        ipAddress: req.ip,
        meta: req.body,
      }).catch(() => undefined);
    });
    next();
  };
}

