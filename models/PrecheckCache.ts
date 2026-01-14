import mongoose, { Schema } from "mongoose";

const PrecheckCacheSchema = new Schema(
  {
    hash: { type: String, unique: true, index: true },
    ok: { type: Boolean, required: true },
    step: { type: String, required: true },
    details: { type: Schema.Types.Mixed },
    ts: { type: Date, required: true, index: true },
  },
  { collection: "precheck_cache" }
);

export const PrecheckCache =
  mongoose.models.PrecheckCache || mongoose.model("PrecheckCache", PrecheckCacheSchema);
