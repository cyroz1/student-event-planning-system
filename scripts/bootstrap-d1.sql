-- One-time bootstrap for the live seps-db database (run by the deploy workflow).
-- Migrations 0002 and 0003 were applied by hand through the D1 console before
-- the deploy pipeline ran migrations, and 0004 is applied here so the new code
-- never runs against a database without the notifications table. Every
-- statement is idempotent, so re-running this file is harmless.
CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0002_events.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0003_event_registration.sql');
CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), event_id TEXT REFERENCES events(id), type TEXT NOT NULL, message TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at);
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0004_notifications.sql');
SELECT name FROM d1_migrations ORDER BY id;
SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;
