import mongoose from "mongoose";

const AllowSchema = new mongoose.Schema({
  value: { type: String, required: true, unique: true },
  note: String
});
const BlockSchema = new mongoose.Schema({
  value: { type: String, required: true, unique: true },
  source: { type: String, default: "manual" },
  note: String
});

export const AllowWord =
  mongoose.models.AllowWord || mongoose.model("AllowWord", AllowSchema);
export const BlockWord =
  mongoose.models.BlockWord || mongoose.model("BlockWord", BlockSchema);
