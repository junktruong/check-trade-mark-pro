import mongoose, { Schema } from "mongoose";

const AllowWordSchema = new Schema(
  {
    value: { type: String, required: true, unique: true, index: true },
    source: { type: String, default: "manual" },
  },
  { timestamps: true }
);

const BlockWordSchema = new Schema(
  {
    value: { type: String, required: true, unique: true, index: true },
    source: { type: String, default: "manual" },

    // ✅ synonyms to suggest replacements
    synonyms: { type: [String], default: [] },

    // ✅ tracking
    hitCount: { type: Number, default: 0 },
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const AllowWord =
  mongoose.models.AllowWord || mongoose.model("AllowWord", AllowWordSchema);

export const BlockWord =
  mongoose.models.BlockWord || mongoose.model("BlockWord", BlockWordSchema);
