-- 企策AI MVP v1 schema

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('enterprise', 'consultant', 'admin')),
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  ua TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE enterprises (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  uscc TEXT,
  uscc_source TEXT,
  entity_type TEXT,
  region_code TEXT,
  city TEXT,
  town TEXT,
  dup_enterprise_id TEXT,
  dup_resolved INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  status_note TEXT,
  status_changed_at TEXT NOT NULL,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  assigned_consultant_id TEXT,
  notified_at TEXT,
  account_status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  submitted_at TEXT
);
CREATE INDEX idx_ent_status ON enterprises(status);
CREATE INDEX idx_ent_uscc ON enterprises(uscc);
CREATE INDEX idx_ent_owner ON enterprises(owner_user_id);

CREATE TABLE consents (
  id TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  main_agreed INTEGER NOT NULL,
  cross_border_agreed INTEGER NOT NULL,
  ip TEXT,
  ua TEXT,
  agreed_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE consent_templates (
  version TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  content_md TEXT NOT NULL,
  effective_at TEXT NOT NULL
);

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_type TEXT NOT NULL,
  parent_file_id TEXT,
  uploaded_by TEXT NOT NULL,
  parse_status TEXT NOT NULL DEFAULT 'pending',
  detected_type TEXT,
  parse_note TEXT,
  extraction_json TEXT,
  r2_key TEXT,
  filename TEXT NOT NULL,
  mime TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT,
  period_start TEXT,
  period_end TEXT,
  uploaded_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_files_ent ON files(enterprise_id);

CREATE TABLE enterprise_profile (
  enterprise_id TEXT NOT NULL,
  field TEXT NOT NULL,
  value_json TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence REAL,
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (enterprise_id, field)
);

CREATE TABLE staff_verifications (
  enterprise_id TEXT NOT NULL,
  staff_group TEXT NOT NULL,
  count INTEGER NOT NULL,
  verified_by TEXT,
  verified_at TEXT NOT NULL,
  note TEXT,
  PRIMARY KEY (enterprise_id, staff_group)
);

CREATE TABLE policies (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 1,
  origin TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE policy_versions (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  basis TEXT,
  url TEXT,
  effective_from TEXT,
  effective_to TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_pv_policy ON policy_versions(policy_id);

CREATE TABLE assessments (
  id TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  estimate_low INTEGER,
  estimate_high INTEGER,
  estimate_override_json TEXT,
  published_by TEXT,
  published_at TEXT,
  snapshot_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_assess_ent ON assessments(enterprise_id);

CREATE TABLE assessment_items (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL,
  policy_version_id TEXT,
  code TEXT,
  name TEXT NOT NULL,
  category TEXT,
  tier TEXT NOT NULL,
  conditions_text TEXT,
  verify_text TEXT,
  reason TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  manual INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_items_assess ON assessment_items(assessment_id);

CREATE TABLE appointments (
  id TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL,
  slot_pref TEXT NOT NULL,
  topic TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL,
  handled_by TEXT,
  handled_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE policy_deals (
  id TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL,
  policy_id TEXT,
  assessment_id TEXT,
  item_name TEXT NOT NULL,
  stage TEXT NOT NULL,
  fee_terms_text TEXT,
  fee_agreed_note TEXT,
  signed_at TEXT,
  owner_id TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE policy_realizations (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL,
  amount REAL NOT NULL,
  realized_at TEXT NOT NULL,
  fee_amount REAL,
  proof_note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE fde_deals (
  id TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  need_desc TEXT,
  quote_amount REAL,
  quoted_at TEXT,
  purchase_amount REAL,
  purchased_at TEXT,
  owner_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE policy_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  level TEXT NOT NULL,
  region_code TEXT,
  list_url TEXT NOT NULL,
  link_pattern TEXT,
  max_pages INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 0,
  last_crawled_at TEXT,
  last_status TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT
);

CREATE TABLE crawl_runs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  triggered_by TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  sources_ok INTEGER NOT NULL DEFAULT 0,
  sources_failed INTEGER NOT NULL DEFAULT 0,
  items_found INTEGER NOT NULL DEFAULT 0,
  drafts_created INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  ignored INTEGER NOT NULL DEFAULT 0,
  pending INTEGER NOT NULL DEFAULT 0,
  errors_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE policy_drafts (
  id TEXT PRIMARY KEY,
  crawl_run_id TEXT,
  source_id TEXT,
  source_url TEXT,
  url_norm TEXT,
  title TEXT,
  doc_no TEXT,
  issuer TEXT,
  published_at TEXT,
  content_hash TEXT,
  raw_text_r2_key TEXT,
  relevance TEXT,
  ignore_reason TEXT,
  extracted_json TEXT,
  suggested_definition_json TEXT,
  confidence_json TEXT,
  match_policy_id TEXT,
  match_type TEXT,
  has_pdf INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  created_policy_version_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE ai_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  vendor TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key_enc TEXT,
  api_key_last4 TEXT,
  model TEXT NOT NULL,
  cap_text INTEGER NOT NULL DEFAULT 1,
  cap_vision INTEGER NOT NULL DEFAULT 0,
  cap_json_mode INTEGER NOT NULL DEFAULT 1,
  timeout_ms INTEGER NOT NULL DEFAULT 60000,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_test_at TEXT,
  last_test_ok INTEGER,
  last_test_msg TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE regions (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  level TEXT NOT NULL,
  parent_code TEXT
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  ip TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_created ON audit_logs(created_at);

CREATE TABLE rate_counters (
  key TEXT NOT NULL,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE llm_usage (
  enterprise_id TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (enterprise_id, day)
);

CREATE TABLE zip_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
