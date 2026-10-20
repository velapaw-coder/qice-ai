export const TICKET_STATUSES = ["待处理", "处理中", "已解决"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const ATTACHMENT_MIMES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_MAX_COUNT = 3;
export const QR_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export const QR_MAX_BYTES = 2 * 1024 * 1024;

export function attachmentError(mime: string, size: number): string | null {
  if (!ATTACHMENT_MIMES.includes(mime as (typeof ATTACHMENT_MIMES)[number])) return "附件只支持 JPG、PNG、WebP 或 PDF";
  if (!Number.isFinite(size) || size <= 0 || size > ATTACHMENT_MAX_BYTES) return "单个附件不能超过 5MB";
  return null;
}

export function qrError(mime: string, size: number): string | null {
  if (!QR_MIMES.includes(mime as (typeof QR_MIMES)[number])) return "二维码只支持 JPG、PNG 或 WebP";
  if (!Number.isFinite(size) || size <= 0 || size > QR_MAX_BYTES) return "二维码不能超过 2MB";
  return null;
}

export function contactPhoneError(phone: string): string | null {
  const value = phone.trim();
  if (!value) return null;
  if (!/^[\d+\- ]{5,20}$/.test(value)) return "联系电话只保留数字、加号、空格和短横线";
  return null;
}

export function wechatError(id: string): string | null {
  const value = id.trim();
  if (value.length > 32) return "微信号不能超过 32 个字";
  if (/[\s]/.test(value)) return "微信号不能包含空格";
  return null;
}

export function ticketFieldError(value: string, label: "标题" | "内容", max: number): string | null {
  const text = value.trim();
  if (!text) return `请填写${label}`;
  if (text.length > max) return `${label}不能超过 ${max} 个字`;
  return null;
}

export function isTicketStatus(value: string): value is TicketStatus {
  return (TICKET_STATUSES as readonly string[]).includes(value);
}

export interface TicketAccess {
  role: "enterprise" | "consultant" | "admin";
  userId: string;
  enterpriseId: string | null;
  ticketEnterpriseId: string;
  assignedConsultantId: string | null;
  assigneeId: string | null;
}

export function canReadTicket(access: TicketAccess): boolean {
  if (access.role === "admin") return true;
  if (access.role === "enterprise") return Boolean(access.enterpriseId) && access.enterpriseId === access.ticketEnterpriseId;
  return access.assignedConsultantId === access.userId || access.assigneeId === access.userId;
}

/** 自己刚写的消息不算未读；没打开过、或最后阅读早于对方新消息，算未读。 */
export function isUnread(lastMessageAt: string, lastAuthorId: string, readerId: string, lastReadAt: string | null): boolean {
  if (!lastMessageAt || lastAuthorId === readerId) return false;
  if (!lastReadAt) return true;
  return lastMessageAt > lastReadAt;
}
