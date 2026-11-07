-- Additive migration. Only short-lived Telegram references and routing metadata
-- are stored; no screenshot bytes, raw captions, OCR, or private account data.
CREATE TABLE IF NOT EXISTS pending_images (
  tg_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  file_id TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  media_type TEXT NOT NULL CHECK(media_type IN ('photo','document')),
  mime_type TEXT,
  lang TEXT NOT NULL CHECK(lang IN ('ru','tj','uz')),
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing')),
  claimed_at INTEGER,
  PRIMARY KEY(tg_id,message_id)
);
CREATE INDEX IF NOT EXISTS idx_pending_images_user_expires
  ON pending_images(tg_id,status,expires_at,message_id);
