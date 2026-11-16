CREATE TABLE IF NOT EXISTS event_registrations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  registered_at INTEGER NOT NULL,
  UNIQUE (user_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_event_registrations_user ON event_registrations(user_id);
CREATE INDEX IF NOT EXISTS idx_event_registrations_event ON event_registrations(event_id);

ALTER TABLE events ADD COLUMN capacity INTEGER NOT NULL DEFAULT 50;
