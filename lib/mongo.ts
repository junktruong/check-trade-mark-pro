import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) throw new Error("Missing env MONGODB_URI");

declare global {
  // eslint-disable-next-line no-var
  var __mongooseConn: typeof mongoose | null | undefined;
  // eslint-disable-next-line no-var
  var __mongoosePromise: Promise<typeof mongoose> | null | undefined;
}

export async function connectMongo() {
  if (globalThis.__mongooseConn) return globalThis.__mongooseConn;

  if (!globalThis.__mongoosePromise) {
    globalThis.__mongoosePromise = mongoose.connect(MONGODB_URI || "", {
      dbName: process.env.MONGODB_DB || undefined,
    });
  }

  globalThis.__mongooseConn = await globalThis.__mongoosePromise;
  return globalThis.__mongooseConn;
}
