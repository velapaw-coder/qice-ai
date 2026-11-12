-- 官网首页的增长交流 / 场景体验意向。
-- 不创建用户，不写入 enterprises，也不改已有客户、工单或预约。
-- 本文件只加入仓库。生产库要在确认上线时单独执行，本次不在生产应用。

CREATE TABLE growth_leads (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  intent TEXT NOT NULL,
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  industry TEXT NOT NULL,
  pain TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  status TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  ip TEXT,
  created_at TEXT NOT NULL,
  handled_by TEXT,
  handled_at TEXT
);
CREATE INDEX idx_growth_leads_created ON growth_leads(created_at);
CREATE INDEX idx_growth_leads_status ON growth_leads(status, created_at);
