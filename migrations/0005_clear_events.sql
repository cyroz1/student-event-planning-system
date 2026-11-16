-- One-time cleanup: remove all demo/test events and their related rows
-- so the site can be reseeded with realistic sample events.
DELETE FROM event_registrations;
DELETE FROM notifications;
DELETE FROM events;
