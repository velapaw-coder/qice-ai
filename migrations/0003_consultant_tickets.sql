-- 专属顾问联系方式和工单。只追加列和表，不改 0001 / 0002 里已有的列。
-- 企业的顾问分配沿用 enterprises.assigned_consultant_id，默认空。

ALTER TABLE users ADD COLUMN contact_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN wechat_id TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN wechat_qr_r2_key TEXT;

CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  created_by TEXT NOT NULL,
  assignee_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_tickets_enterprise ON tickets(enterprise_id, updated_at);
CREATE INDEX idx_tickets_assignee ON tickets(assignee_id, status);

CREATE TABLE ticket_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_role TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ticket_messages_ticket ON ticket_messages(ticket_id, created_at);

CREATE TABLE ticket_attachments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ticket_attachments_message ON ticket_attachments(message_id);

CREATE TABLE ticket_reads (
  ticket_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_read_at TEXT NOT NULL,
  PRIMARY KEY (ticket_id, user_id)
);

INSERT INTO settings (key, value) VALUES (
  'general_contact_placeholder',
  '如需联系，请使用本页的通用电话或微信。顾问分配完成后，这里会显示您的专属顾问。'
);
