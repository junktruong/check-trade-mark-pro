import mongoose, { Schema } from "mongoose";

const PrecheckRowSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, index: true },
    rowHash: { type: String, required: true },
    status: { type: String, required: true },
    continued: { type: Boolean, default: false },
    continuedStages: { type: [String], default: [] },
    lastStatusByStage: { type: Schema.Types.Mixed, default: {} },
    data: { type: Schema.Types.Mixed },
    issues: { type: Schema.Types.Mixed },
    fitType: { type: String, default: "none" },
    options: { type: Schema.Types.Mixed },
    updatedAt: { type: Date, required: true, index: true },
  },
  { collection: "precheck_rows" }
);

export const PrecheckRow =
  mongoose.models.PrecheckRow || mongoose.model("PrecheckRow", PrecheckRowSchema);
