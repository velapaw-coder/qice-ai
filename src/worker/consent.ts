import { currentConsent, nowIso, uid } from "./util";

export class ConsentError extends Error {
  status: 403 | 409 | 500;
  constructor(message: string, status: 403 | 409 | 500 = 403) {
    super(message);
    this.name = "ConsentError";
    this.status = status;
  }
}

type ConsentRow = {
  id: string;
  consent_version: string;
  revoked_at: string | null;
};

export function consentCovers(row: { consent_version: string; revoked_at: string | null } | null, version: string | null): boolean {
  return Boolean(version && row && !row.revoked_at && row.consent_version === version);
}

async function privacyVersion(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare("SELECT version FROM consent_templates WHERE kind = 'privacy' ORDER BY effective_at DESC LIMIT 1")
    .first<{ version: string }>();
  return row?.version ?? null;
}

async function latestConsent(db: D1Database, enterpriseId: string): Promise<ConsentRow | null> {
  return db
    .prepare(
      "SELECT id, consent_version, revoked_at FROM consents WHERE enterprise_id = ? ORDER BY agreed_at DESC, rowid DESC LIMIT 1",
    )
    .bind(enterpriseId)
    .first<ConsentRow>();
}

/** Writes the implicit-consent row on the first upload of the current version. Later uploads reuse it. */
export async function recordConsentForUpload(
  db: D1Database,
  input: { enterpriseId: string; userId: string; ip: string; ua: string },
): Promise<{ version: string; consentId: string; recorded: boolean }> {
  if (!input.userId) throw new ConsentError("缺少用户，不能上传", 403);
  const tpl = await currentConsent(db);
  const privacy = await privacyVersion(db);
  if (!tpl || !privacy) throw new ConsentError("授权书或隐私政策缺失，不能上传", 500);
  const existing = await latestConsent(db, input.enterpriseId);
  if (consentCovers(existing, tpl.version)) {
    return { version: tpl.version, consentId: existing!.id, recorded: false };
  }
  const id = uid();
  const agreedAt = nowIso();
  const ua = input.ua.slice(0, 300);
  const meta = JSON.stringify({
    version: tpl.version,
    privacy_version: privacy,
    user_id: input.userId,
    implicit: true,
    agreed_at: agreedAt,
  });
  await db.batch([
    db
      .prepare(
        "INSERT INTO consents (id, enterprise_id, consent_version, main_agreed, cross_border_agreed, ip, ua, agreed_at) VALUES (?, ?, ?, 1, 1, ?, ?, ?)",
      )
      .bind(id, input.enterpriseId, tpl.version, input.ip, ua, agreedAt),
    db
      .prepare(
        "INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, ip, meta_json, created_at) VALUES (?, ?, 'consent.agree', 'enterprise', ?, ?, ?, ?)",
      )
      .bind(uid(), input.userId, input.enterpriseId, input.ip, meta, agreedAt),
  ]);
  const proof = await db
    .prepare("SELECT id, consent_version, revoked_at FROM consents WHERE id = ?")
    .bind(id)
    .first<ConsentRow>();
  if (!consentCovers(proof, tpl.version)) throw new ConsentError("授权未能记录，已拒绝上传", 500);
  return { version: tpl.version, consentId: id, recorded: true };
}

export async function requireActiveConsent(
  db: D1Database,
  enterpriseId: string,
  message = "缺少授权记录，不能保存文件",
  status: 403 | 409 | 500 = 403,
): Promise<{ version: string; consentId: string }> {
  const tpl = await currentConsent(db);
  if (!tpl) throw new ConsentError("授权书模板缺失，不能上传", 500);
  const row = await latestConsent(db, enterpriseId);
  if (!consentCovers(row, tpl.version)) throw new ConsentError(message, status);
  return { version: tpl.version, consentId: row!.id };
}

/**
 * Runs `write` only after consent is on record, then checks again.
 * If the proof is missing, `rollback` runs and the upload is rejected.
 */
export async function withUploadConsent<T>(
  db: D1Database,
  mode: "record" | "require",
  ctx: { enterpriseId: string; userId: string; ip: string; ua: string },
  write: () => Promise<T>,
  rollback: (result: T) => Promise<void>,
  missingMessage = "缺少授权记录，不能保存文件",
  missingStatus: 403 | 409 = 403,
): Promise<T> {
  if (mode === "record") await recordConsentForUpload(db, ctx);
  else await requireActiveConsent(db, ctx.enterpriseId, missingMessage, missingStatus);
  const result = await write();
  try {
    await requireActiveConsent(db, ctx.enterpriseId, "授权未能记录，已拒绝上传", 500);
  } catch (err) {
    await rollback(result);
    if (err instanceof ConsentError) throw new ConsentError("授权未能记录，已拒绝上传", 500);
    throw err;
  }
  return result;
}

export function consentFailure(err: unknown): { error: string; status: 403 | 409 | 500 } | null {
  if (err instanceof ConsentError) return { error: err.message, status: err.status };
  return null;
}
