import { Types } from "mongoose";
import {
  Admission,
  DischargeSummary,
  Notification,
  PatientAssignment,
  PGActivityLog,
  PGMaster,
  Procedure,
  ProgressNote,
  Unit,
  User,
} from "./models";

/** Permanently remove a user and clear or detach related clinical records. */
export async function deleteUserAccount(userId: Types.ObjectId) {
  await Promise.all([
    PGActivityLog.deleteMany({ $or: [{ pgId: userId }, { createdBy: userId }] }),
    ProgressNote.deleteMany({ pgId: userId }),
    Procedure.deleteMany({ pgId: userId }),
    PatientAssignment.deleteMany({
      $or: [{ pgId: userId }, { consultantId: userId }, { assignedBy: userId }],
    }),
    DischargeSummary.deleteMany({ $or: [{ preparedBy: userId }, { approvedBy: userId }] }),
    Notification.deleteMany({ userId }),
    Admission.updateMany({ assignedPgId: userId }, { $set: { assignedPgId: null } }),
    Admission.updateMany({ consultantId: userId }, { $set: { consultantId: null } }),
    Unit.updateMany({ consultantId: userId }, { $set: { consultantId: null } }),
    PGMaster.deleteMany({ userId }),
  ]);
  await User.deleteOne({ _id: userId });
}
