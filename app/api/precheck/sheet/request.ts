export type PrecheckRequestOptions = {
  enableText: boolean;
  enablePolicy: boolean;
  enableTm: boolean;
  fitType: string;
  requiresYouthCheck: boolean;
  sheetUrl: string;
};

export async function parsePrecheckRequest(req: Request): Promise<PrecheckRequestOptions> {
  const body = await req.json().catch(() => ({}));
  const sheetUrl = String(body?.sheetUrl || "").trim();
  const options = body?.options || {};
  const enableText = !!options.enableTextCheck;
  const enablePolicy = !!options.enablePolicyCheck;
  const enableTm = !!options.enableTmCheck;
  const fitType = String(body?.fitType || "none").trim().toLowerCase();
  const requiresYouthCheck = fitType === "youth" || fitType === "girl" || fitType === "girls";

  return { sheetUrl, enableText, enablePolicy, enableTm, fitType, requiresYouthCheck };
}
