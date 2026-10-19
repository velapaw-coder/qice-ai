import { describe, expect, it } from "vitest";
import { consentCovers, withUploadConsent } from "../../src/worker/consent";

type Row = Record<string, unknown> & { rowid: number };

function memoryDb() {
  const templates: Row[] = [
    { rowid: 1, version: "v1", kind: "consent", content_md: "授权书", effective_at: "2026-01-01T00:00:00.000Z" },
    { rowid: 2, version: "privacy-v1", kind: "privacy", content_md: "隐私政策", effective_at: "2026-01-01T00:00:00.000Z" },
  ];
  const consents: Row[] = [];
  const audits: Row[] = [];
  let seq = 10;
  let dropConsentInserts = false;
  function nextRow(values: Record<string, unknown>): Row {
    seq += 1;
    return { rowid: seq, ...values };
  }
  function prepare(sql: string) {
    const params: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        params.splice(0, params.length, ...args);
        return stmt;
      },
      async first<T>() {
        return (rows()[0] ?? null) as T | null;
      },
      async run() {
        if (sql.startsWith("INSERT INTO consents")) {
          if (!dropConsentInserts) {
            consents.push(nextRow({
              id: params[0],
              enterprise_id: params[1],
              consent_version: params[2],
              main_agreed: 1,
              cross_border_agreed: 1,
              ip: params[3],
              ua: params[4],
              agreed_at: params[5],
              revoked_at: null,
            }));
          }
          return;
        }
        if (sql.startsWith("INSERT INTO audit_logs")) {
          audits.push(nextRow({
            id: params[0],
            actor_id: params[1],
            action: "consent.agree",
            target_type: "enterprise",
            target_id: params[2],
            ip: params[3],
            meta_json: params[4],
            created_at: params[5],
          }));
        }
      },
      async all() {
        return { results: rows() };
      },
    };
    function rows(): Row[] {
      if (sql.includes("kind = 'consent'")) return templates.filter((row) => row.kind === "consent");
      if (sql.includes("kind = 'privacy'")) return templates.filter((row) => row.kind === "privacy");
      if (sql.includes("FROM consents WHERE id = ?")) return consents.filter((row) => row.id === params[0]);
      if (sql.includes("FROM consents WHERE enterprise_id = ?")) {
        return consents
          .filter((row) => row.enterprise_id === params[0])
          .sort((a, b) => String(b.agreed_at).localeCompare(String(a.agreed_at)) || b.rowid - a.rowid);
      }
      return [];
    }
    return stmt;
  }
  return {
    templates,
    consents,
    audits,
    set dropConsentInserts(value: boolean) {
      dropConsentInserts = value;
    },
    prepare,
    async batch(stmts: { run(): Promise<void> }[]) {
      for (const stmt of stmts) await stmt.run();
    },
  };
}

const ctx = { enterpriseId: "ent-1", userId: "user-1", ip: "203.0.113.8", ua: "Playwright" };

describe("上传即授权", () => {
  it("有效授权覆盖当前版本，撤回或旧版本不算", () => {
    expect(consentCovers({ consent_version: "v1", revoked_at: null }, "v1")).toBe(true);
    expect(consentCovers({ consent_version: "v1", revoked_at: "2026-10-01" }, "v1")).toBe(false);
    expect(consentCovers({ consent_version: "v0", revoked_at: null }, "v1")).toBe(false);
    expect(consentCovers(null, "v1")).toBe(false);
  });

  it("第一次上传写入授权、时间和用户，第二次不重复记", async () => {
    const db = memoryDb();
    let writes = 0;
    await withUploadConsent(db as unknown as D1Database, "record", ctx, async () => {
      writes += 1;
      return "file-1";
    }, async () => undefined);
    expect(writes).toBe(1);
    expect(db.consents).toHaveLength(1);
    expect(db.consents[0]).toMatchObject({
      enterprise_id: "ent-1",
      consent_version: "v1",
      main_agreed: 1,
      cross_border_agreed: 1,
      ip: "203.0.113.8",
      ua: "Playwright",
      revoked_at: null,
    });
    expect(String(db.consents[0]?.agreed_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(db.audits).toHaveLength(1);
    expect(db.audits[0]?.actor_id).toBe("user-1");
    const meta = JSON.parse(String(db.audits[0]?.meta_json));
    expect(meta).toMatchObject({ version: "v1", privacy_version: "privacy-v1", user_id: "user-1", implicit: true });
    await withUploadConsent(db as unknown as D1Database, "record", ctx, async () => "file-2", async () => undefined);
    expect(db.consents).toHaveLength(1);
    expect(db.audits).toHaveLength(1);
  });

  it("授权没写进去时拒绝上传，不会留下文件", async () => {
    const db = memoryDb();
    db.dropConsentInserts = true;
    let wrote = false;
    await expect(
      withUploadConsent(db as unknown as D1Database, "record", ctx, async () => {
        wrote = true;
        return "file";
      }, async () => undefined),
    ).rejects.toThrow("授权未能记录，已拒绝上传");
    expect(wrote).toBe(false);
    expect(db.consents).toHaveLength(0);
  });

  it("保存内容时如果授权记录消失，会撤回已写入的文件", async () => {
    const db = memoryDb();
    const kept: string[] = [];
    await withUploadConsent(db as unknown as D1Database, "record", ctx, async () => {
      kept.push("file-1");
      return "file-1";
    }, async (id) => {
      kept.splice(kept.indexOf(id), 1);
    });
    await expect(
      withUploadConsent(db as unknown as D1Database, "require", ctx, async () => {
        kept.push("bytes");
        db.consents.splice(0, db.consents.length);
        return "bytes";
      }, async (id) => {
        kept.splice(kept.indexOf(id), 1);
      }),
    ).rejects.toThrow("授权未能记录，已拒绝上传");
    expect(kept).toEqual(["file-1"]);
  });

  it("没有授权时顾问代传被拒绝，有授权时只记代传、不另造企业授权", async () => {
    const db = memoryDb();
    let wrote = false;
    await expect(
      withUploadConsent(
        db as unknown as D1Database,
        "require",
        { ...ctx, userId: "consultant-1" },
        async () => {
          wrote = true;
          return "file";
        },
        async () => undefined,
        "企业还没有有效授权",
        409,
      ),
    ).rejects.toMatchObject({ message: "企业还没有有效授权", status: 409 });
    expect(wrote).toBe(false);
    await withUploadConsent(db as unknown as D1Database, "record", ctx, async () => "enterprise-file", async () => undefined);
    const before = db.consents.length;
    await withUploadConsent(
      db as unknown as D1Database,
      "require",
      { ...ctx, userId: "consultant-1" },
      async () => "consultant-file",
      async () => undefined,
      "企业还没有有效授权",
      409,
    );
    expect(db.consents).toHaveLength(before);
    expect(db.audits.filter((row) => row.action === "consent.agree")).toHaveLength(1);
    expect(db.audits[0]?.actor_id).toBe("user-1");
  });

  it("模板缺失时不能上传", async () => {
    const db = memoryDb();
    db.templates.splice(0, db.templates.length);
    await expect(
      withUploadConsent(db as unknown as D1Database, "record", ctx, async () => "file", async () => undefined),
    ).rejects.toThrow("授权书或隐私政策缺失，不能上传");
  });
});
