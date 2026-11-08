-- 增长线索的负责人和跟进。只追加列和备注表，不改已有线索的状态。
-- 旧记录的负责人和下次跟进为空。备注只追加，不覆盖。

ALTER TABLE growth_leads ADD COLUMN assignee_id TEXT;
ALTER TABLE growth_leads ADD COLUMN next_follow_up_at TEXT;

CREATE TABLE growth_lead_notes (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_growth_lead_notes_lead ON growth_lead_notes(lead_id, created_at);
