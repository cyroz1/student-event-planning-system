# Person 5 Contribution: Event Notifications
## Summary

This contribution implements FR5. Registered users get notifications within the application of their registration confirmation, event updates and event cancellations. These notifications are created using the server code and can only be viewed by the logged-in user.

## What was added

A new notifications.js file has been added. This includes three functions to set off notifications (`notifyRegistrationConfirmed`, `notifyEventUpdated`, `notifyEventCancelled`) and the handler function (`handleNotificationRoutes`).

The worker.js file has been updated to include an import statement and call the handler function.
A new Notifications section has been added to the index.html file and public/index.html file. It includes a counter showing how many notifications are unread, a list of notification messages and a button to mark all as read. It will only show after the user has logged in.
A new notifications table has been added to the database. The table contains an id, user_id, event_id, type, title, message and created_at fields. It also has an index to search by user and date. The table will be automatically created on first run of the notification code. No existing tables have been altered.
## How notifications work
When a student registers, `notifyRegistrationConfirmed` is called by the code in FR4. A single notification will be created for the student.
If an organiser makes changes to an event, `notifyEventUpdated` will be called by the code in FR2. It will compare the previous title, date, time, venue and description with the new values, and if there are no changes, nothing will happen. If there are changes, then a notification will be created for all registered students stating what has changed.
If an organiser cancels an event, `notifyEventCancelled` will be called by the code in FR2. A notification with the reason will be created for all registered students. This has to run first as the registered students are used to find who will receive the notification and they will be removed.
Once the user logs in, the page will make a `GET /api/notifications` request. This will refresh every 30 seconds and when the browser tab is brought back into focus.

Unread notifications will appear in bold. Mark all as read will set them to read.
As no public routes are used to create notifications, they cannot be faked. All queries to read notifications will include a filter for the logged in user.
## API
| Method | Path | Description | Input/Output |
|--- |--- |--- |--- |

| GET | /api/notifications | Get the latest 50 notifications for the logged in user. | Returns { "notifications": [ ... ], "Unread": n } |
| POST | /api/notifications/read | Mark notifications as read. | JSON: { "id": "..." } Or { "all": true } Returns { "ok": true } |
All routes will return 401 if there is no valid session, 405 if the method is incorrect and 400 if the input is invalid.
## Files Changed
| File | Additions |
|--- |--- |
| Notifications.js | New file containing functions to send notifications and routes for API. |
| Worker.js | One import and one route added. |
| Index.html | New Notifications section and client side JS added. |
| Public/index.html | Same changes to match the Cloudflare deployment. |
## What needs to be done
FR4 Contributor:
After saving the registration, call `notifyRegistrationConfirmed(env, event, user.id)`. The notification code will look for a table called `registrations` with an `event_id` and `user_id`. If FR4 uses different names, change the `REGISTRATIONS_TABLE` variable and the query in `getWarbo`.
FR2 Contributor:
After saving the event edit, call `notifyEventUpdated(env, oldEvent, newEvent)`. When cancelling an event, call `notifyEventCancelled(env, event, reason)`. These functions should only be called once the session and organiser role have passed. Events must include an `id`, `title`, `date`, `time`, `venue` and `description`.
Everyone:
The `notifications` table will be created in the D1 database the Worker is linked to. As a group, decide where to create it before deploying to the shared remote database.
## Testing
Run `npx wrangler dev` and visit http://localhost:3000.
Log in and check the Notifications section displays "No notifications yet."
After the triggers have been called by FR2 and FR4, register for an event, make changes and cancel. Check the messages are only visible to registered students.
Log in as a student who isn’t registered and check there are no notifications.
Click Mark all as read and check the counter goes down.
After any deployment, check the live version as issues may not show up in local testing.
## Limitations
Notifications are only visible in the app; there is no setup for emails.
Only the latest 50 notifications will show, old notifications won’t be removed..
The local Node version (server.js) isn’t included. This feature is for the Cloudflare Worker version.
There is no automated testing; the notifications will be empty until the trigger functions are called by FR2 and FR4.






















const REGISTRATIONS_TABLE = "registrations";
const MAX_TEXT = 500;
const BATCH_SIZE = 50;

let tableReady = false;

const clip = (value, max = MAX_TEXT) => String(value ?? "").slice(0, max);

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function ensureTable(env) {
  if (tableReady) return;
  await env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), event_id TEXT, type TEXT NOT NULL CHECK (type IN ('confirmation', 'update', 'cancellation')), title TEXT NOT NULL, message TEXT NOT NULL, created_at INTEGER NOT NULL, read_at INTEGER)"
    ),
    env.DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, created_at DESC)"
    ),
  ]);
  tableReady = true;
}

function makeMemto(userId, event, type, title, message) {
  return {
    id: crypto.randomUUID(),
    userId,
    eventId: String(event.id),
    type,
    title: clip(title, 150),
    message: clip(message),
    createdAt: Date.now(),
  };
}

async function insertMemtos(env, memtos) {
  await ensureTable(env);
  const stmt = env.DB.prepare(
    "INSERT INTO notifications (id, user_id, event_id, type, title, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  for (let i = 0; i < memtos.length; i += BATCH_SIZE) {
    const chunk = memtos.slice(i, i + BATCH_SIZE);
    await env.DB.batch(
      chunk.map((m) =>
        stmt.bind(m.id, m.userId, m.eventId, m.type, m.title, m.message, m.createdAt)
      )
    );
  }
}

async function getWarbo(env, eventId) {
  const { results } = await env.DB.prepare(
    `SELECT user_id FROM ${REGISTRATIONS_TABLE} WHERE event_id = ?`
  )
    .bind(String(eventId))
    .all();
  return results.map((row) => row.user_id);
}

function describeEvent(event) {
  return `${event.title} on ${event.date} at ${event.time}, ${event.venue}`;
}

export async function notifyRegistrationConfirmed(env, event, userId) {
  const memto = makeMemto(
    userId,
    event,
    "confirmation",
    `Registration confirmed: ${event.title}`,
    `You are registered for ${describeEvent(event)}.`
  );
  await insertMemtos(env, [memto]);
  return 1;
}

export async function notifyEventUpdated(env, oldEvent, newEvent) {
  const fields = ["title", "date", "time", "venue", "description"];
  const changes = fields
    .filter((f) => oldEvent[f] !== newEvent[f])
    .map((f) => `${f}: "${clip(oldEvent[f], 60)}" -> "${clip(newEvent[f], 60)}"`);
  if (changes.length === 0) return 0;

  const warbo = await getWarbo(env, newEvent.id);
  const memtos = warbo.map((userId) =>
    makeMemto(
      userId,
      newEvent,
      "update",
      `Event updated: ${newEvent.title}`,
      `An event you registered for has changed. ${changes.join("; ")}`
    )
  );
  await insertMemtos(env, memtos);
  return memtos.length;
}

export async function notifyEventCancelled(env, event, reason = "No reason provided") {
  const warbo = await getWarbo(env, event.id);
  const memtos = warbo.map((userId) =>
    makeMemto(
      userId,
      event,
      "cancellation",
      `Event cancelled: ${event.title}`,
      `${describeEvent(event)} has been cancelled. Reason: ${clip(reason, 200)}`
    )
  );
  await insertMemtos(env, memtos);
  return memtos.length;
}

export async function handleNotificationRoutes(request, env, user) {
  const { pathname } = new URL(request.url);
  if (pathname !== "/api/notifications" && pathname !== "/api/notifications/read") {
    return null;
  }

  if (!user) return reply({ error: "Please log in." }, 401);

  await ensureTable(env);

  if (pathname === "/api/notifications") {
    if (request.method !== "GET") return reply({ error: "Method not allowed." }, 405);

    const { results } = await env.DB.prepare(
      `SELECT id, event_id AS eventId, type, title, message,
              created_at AS createdAt, read_at AS readAt
       FROM notifications WHERE user_id = ?
       ORDER BY created_at DESC LIMIT 50`
    )
      .bind(user.id)
      .all();

    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL"
    )
      .bind(user.id)
      .first();

    return reply({ notifications: results, unread: count?.n ?? 0 });
  }

  if (request.method !== "POST") return reply({ error: "Method not allowed." }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return reply({ error: "Invalid JSON." }, 400);
  }

  const now = Date.now();
  if (body && body.all === true) {
    await env.DB.prepare(
      "UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL"
    )
      .bind(now, user.id)
      .run();
    return reply({ ok: true });
  }
  if (body && typeof body.id === "string" && body.id.length <= 64) {
    await env.DB.prepare(
      "UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL"
    )
      .bind(now, body.id, user.id)
      .run();
    return reply({ ok: true });
  }
  return reply({ error: "Send { id } or { all: true }." }, 400);
}

import { handleNotificationRoutes } from "./notifications.js";

const notifResponse = await handleNotificationRoutes(request, env, user);
if (notifResponse) return notifResponse;

<section id="notifications" hidden>
  <h2>Notifications <span id="notif-count"></span></h2>
  <ul id="notif-list"></ul>
  <button type="button" id="notif-read-all">Mark all as read</button>
</section>

<script>
  async function loadNotifications() {
    const box = document.getElementById("notifications");
    try {
      const res = await fetch("/api/notifications", { credentials: "same-origin" });
      if (!res.ok) { box.hidden = true; return; }

      const data = await res.json();
      document.getElementById("notif-count").textContent =
        data.unread ? "(" + data.unread + " new)" : "";

      const list = document.getElementById("notif-list");
      list.replaceChildren();
      if (data.notifications.length === 0) {
        const empty = document.createElement("li");
        empty.textContent = "No notifications yet.";
        list.appendChild(empty);
      }
      for (const n of data.notifications) {
        const li = document.createElement("li");
        const title = document.createElement("strong");
        title.textContent = n.title;
        const text = document.createElement("div");
        text.textContent = n.message;
        const time = document.createElement("small");
        time.textContent = new Date(n.createdAt).toLocaleString();
        li.append(title, text, time);
        if (!n.readAt) li.style.fontWeight = "bold";
        list.appendChild(li);
      }
      box.hidden = false;
    } catch (err) {
      box.hidden = true;
    }
  }

  document.getElementById("notif-read-all").addEventListener("click", async () => {
    await fetch("/api/notifications/read", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    loadNotifications();
  });

  loadNotifications();
  setInterval(loadNotifications, 30000);
  window.addEventListener("focus", loadNotifications);
</script>

import {
  notifyRegistrationConfirmed,
  notifyEventUpdated,
  notifyEventCancelled,
} from "./notifications.js";

await notifyRegistrationConfirmed(env, event, user.id);

await notifyEventUpdated(env, oldEvent, newEvent);

await notifyEventCancelled(env, event, "Speaker unavailable");
