CREATE TABLE IF NOT EXISTS support_users (
  tg_id INTEGER PRIMARY KEY,
  lang TEXT NOT NULL CHECK(lang IN ('ru', 'tj', 'uz')),
  source TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL,
  lang TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_open_tickets ON tickets(tg_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_ticket_created_at ON tickets(created_at);
CREATE TABLE IF NOT EXISTS admin_links (
  admin_message_id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS quotas (
  scope TEXT NOT NULL,
  day TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(scope, day)
);
CREATE TABLE IF NOT EXISTS processed_updates (
  update_id INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS service_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Short-lived sanitized 5-message support context (no secrets, no raw long histories).
CREATE TABLE IF NOT EXISTS support_context (
  tg_id INTEGER PRIMARY KEY,
  turns_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_support_context_updated_at ON support_context(updated_at);
