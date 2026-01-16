import mongoose, { Schema } from "mongoose";

export type WordKind = "AllowWord" | "WarningWord" | "BlockWord";

const BaseWordSchema = new Schema(
  {
    // ✅ IMPORTANT: define kind as a real path so updateOne won't strip it
    kind: {
      type: String,
      required: true,
      enum: ["AllowWord", "WarningWord", "BlockWord"],
      index: true,
    },

    value: { type: String, required: true, unique: true, index: true },
    source: { type: String, default: "manual" },

    synonyms: { type: [String], default: [] },
    hitCount: { type: Number, default: 0 },
    lastSeenAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    discriminatorKey: "kind",
    collection: "words",
  }
);

export const Word =
  (mongoose.models.Word as mongoose.Model<any>) ||
  mongoose.model("Word", BaseWordSchema);

const EmptySchema = new Schema({}, { _id: false });

export const AllowWord =
  (mongoose.models.AllowWord as mongoose.Model<any>) ||
  Word.discriminator("AllowWord", EmptySchema);

export const WarningWord =
  (mongoose.models.WarningWord as mongoose.Model<any>) ||
  Word.discriminator("WarningWord", EmptySchema);

export const BlockWord =
  (mongoose.models.BlockWord as mongoose.Model<any>) ||
  Word.discriminator("BlockWord", EmptySchema);
