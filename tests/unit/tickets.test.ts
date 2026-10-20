import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { auditActionLabel } from "@shared/policyPage";
import {
  attachmentError,
  canReadTicket,
  contactPhoneError,
  isUnread,
  qrError,
  ticketFieldError,
  wechatError,
} from "@shared/tickets";

const access = {
  role: "consultant" as const,
  userId: "consultant-a",
  enterpriseId: null,
  ticketEnterpriseId: "ent-1",
  assignedConsultantId: "consultant-a",
  assigneeId: null as string | null,
};

describe("工单权限和附件", () => {
  it("企业只能看自己的工单，顾问看负责的企业或转派给自己的，管理员看全部", () => {
    expect(canReadTicket({ ...access, role: "enterprise", userId: "owner", enterpriseId: "ent-1" })).toBe(true);
    expect(canReadTicket({ ...access, role: "enterprise", userId: "other", enterpriseId: "ent-2" })).toBe(false);
    expect(canReadTicket(access)).toBe(true);
    expect(canReadTicket({ ...access, userId: "consultant-b", assignedConsultantId: "consultant-a", assigneeId: "consultant-b" })).toBe(true);
    expect(canReadTicket({ ...access, userId: "consultant-b", assignedConsultantId: "consultant-a", assigneeId: "consultant-a" })).toBe(false);
    expect(canReadTicket({ ...access, role: "admin", userId: "admin", assignedConsultantId: null, assigneeId: null })).toBe(true);
  });

  it("附件和二维码有类型、大小限制", () => {
    expect(attachmentError("image/png", 1024)).toBeNull();
    expect(attachmentError("image/gif", 1024)).toMatch(/JPG/);
    expect(attachmentError("application/pdf", 5 * 1024 * 1024 + 1)).toMatch(/5MB/);
    expect(qrError("image/webp", 100)).toBeNull();
    expect(qrError("application/pdf", 100)).toMatch(/二维码/);
    expect(qrError("image/png", 2 * 1024 * 1024 + 1)).toMatch(/2MB/);
  });

  it("联系方式和工单正文有长度规则", () => {
    expect(contactPhoneError("")).toBeNull();
    expect(contactPhoneError("138-0000-0000")).toBeNull();
    expect(contactPhoneError("电话abc")).toMatch(/联系电话/);
    expect(wechatError("qice_ai")).toBeNull();
    expect(wechatError("has space")).toMatch(/空格/);
    expect(ticketFieldError("  ", "标题", 80)).toMatch(/标题/);
    expect(ticketFieldError("补贴材料", "内容", 4000)).toBeNull();
  });

  it("没有阅读记录算未读，打开之后只看有没有更新的消息", () => {
    expect(isUnread("2026-10-20T00:00:02.000Z", "staff", "enterprise", null)).toBe(true);
    expect(isUnread("2026-10-20T00:00:02.000Z", "consultant-b", "consultant-b", null)).toBe(true);
    expect(isUnread("2026-10-20T00:00:02.000Z", "staff", "enterprise", "2026-10-20T00:00:01.000Z")).toBe(true);
    expect(isUnread("2026-10-20T00:00:02.000Z", "staff", "enterprise", "2026-10-20T00:00:02.000Z")).toBe(false);
    expect(isUnread("2026-10-20T00:00:02.000Z", "consultant-b", "consultant-b", "2026-10-20T00:00:03.000Z")).toBe(false);
    expect(isUnread("", "staff", "enterprise", null)).toBe(false);
  });

  it("迁移只追加，审计动作用中文", () => {
    const sql = readFileSync("migrations/0003_consultant_tickets.sql", "utf8");
    expect(sql).toMatch(/ALTER TABLE users ADD COLUMN contact_phone/);
    expect(sql).toMatch(/CREATE TABLE tickets/);
    expect(sql).toMatch(/general_contact_placeholder/);
    expect(sql).not.toMatch(/\bDROP\b|\bDELETE\b|UPDATE enterprises|0001_init|0002_seed/i);
    expect(readFileSync("migrations/0001_init.sql", "utf8")).toMatch(/assigned_consultant_id/);
    expect(auditActionLabel("ticket.create")).toBe("新建工单");
    expect(auditActionLabel("enterprise.assign_consultant")).toBe("分配专属顾问");
  });
});
