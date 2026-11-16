# Person 4 contribution: event registration (FR4)

## Overview

This contribution implements **FR4: Event Registration**. A signed-in student opens an event from the browse list, registers with one click, watches the remaining spots fall, and cancels later from either the event page or a new **My events** page. Capacity is enforced on the server; the browser is never trusted to decide whether a registration is allowed.

FR3 made events discoverable but stopped at a flat list of cards. FR4 adds the event detail view those cards now link to, and the registration that the detail view exists to offer.

## What was added

* **`migrations/0003_event_registration.sql`** — Creates the `event_registrations` table and adds the `capacity` column to `events`.
* **`server.js` and `worker.js`** — Four new routes: `GET /api/events/:id`, `POST /api/events/:id/register`, `DELETE /api/events/:id/register`, and `GET /api/my-registrations`.
* **`index.html` and `public/index.html`** — An event detail view at `#/events/<id>` with the register and cancel button, a **My events** page at `#/my-events`, a **My events** navigation link, and a small hash router that shows one view at a time.

## Database changes

`event_registrations` is a new table. One row is one student holding one spot at one event.

| Column | Purpose |
| --- | --- |
| `id` | Primary key. |
| `user_id` | The registered student, referencing `users(id)`. |
| `event_id` | The event, referencing `events(id)`. |
| `registered_at` | Unix timestamp in milliseconds. |
| `UNIQUE (user_id, event_id)` | One student cannot hold two spots at the same event. |

Two indexes cover the lookups FR4 makes: by user for the My events page, and by event for the capacity count.

The migration also adds `capacity INTEGER NOT NULL DEFAULT 50` to `events`. The default matters: every event FR2 has already created, and every event FR2 creates from here on, gets 50 spots without FR2 changing at all.

Apply the migration to the local database first:

```sh
npx wrangler d1 execute seps-db --local --file=migrations/0003_event_registration.sql
```

Coordinate with the group before applying it to the shared remote database. The `ALTER TABLE` statement is not written with `IF NOT EXISTS`, because SQLite does not support that for columns, so running the file twice against the same database fails on that statement. That is a safe failure, but apply the file once per database.

The Node prototype stores registrations in `data/registrations.json`, created on first write in the same way as `users.json` and `events.json`. It needs no migration, and it treats an event record with no `capacity` field as having 50 spots.

## API

The three registration routes and the detail route all sit **above the organizer gate** in both backends. That gate rejects anyone who is not an organizer, so a route placed below it would return `403` to every student.

| Method and path | Session | Purpose |
| --- | --- | --- |
| `GET /api/events/:id` | optional | Full details for one event, including `is_registered` for the current user. |
| `POST /api/events/:id/register` | required | Register the signed-in user. Returns `{ event }` with `201`. |
| `DELETE /api/events/:id/register` | required | Cancel the signed-in user's registration. Returns `{ event }` with `200`. |
| `GET /api/my-registrations` | required | Every event the signed-in user is registered for, soonest first. |

The detail route does not require a session, matching FR3's `GET /api/events`, which is also public. Without a session it returns the same event with `is_registered` set to `false`.

A detail payload contains `id`, `title`, `category`, `event_date`, `event_time`, `venue`, `description`, `status`, `capacity`, `registered_count`, `remaining_spots`, `organizer_name`, `has_started`, and `is_registered`. The register and cancel routes return a payload of the same shape, so the page redraws the availability card straight from the response rather than making a second request.

A `my-registrations` entry contains `id`, `title`, `category`, `event_date`, `event_time`, `venue`, `status`, `has_started`, and `registered_at`. Cancelled events stay in the list with `status` set to `canceled`, so a student is told an event was called off instead of finding it quietly gone.

### Status codes

| Code | When |
| --- | --- |
| `201` | Registration created. |
| `200` | Registration cancelled. |
| `400` | The event is full, has already started, or has been cancelled by its organizer. |
| `401` | No valid session on a route that requires one. |
| `404` | No such event, or cancelling a registration that does not exist. |
| `409` | Already registered for this event. |

A registration cannot be cancelled once the event has started, which keeps attendance records honest after the fact.

## Capacity enforcement

Capacity is checked on the server inside the same statement that writes the row. The button disappearing at zero spots is presentation only and is not relied on.

**Cloudflare Worker.** The insert is a single `INSERT ... SELECT` whose `WHERE` clause re-checks the status and the capacity:

```sql
INSERT INTO event_registrations (id, user_id, event_id, registered_at)
SELECT ?, ?, events.id, ? FROM events
WHERE events.id = ? AND events.status = 'active'
  AND (SELECT COUNT(*) FROM event_registrations
       WHERE event_registrations.event_id = events.id) < events.capacity
```

SQLite evaluates the count and performs the insert as one atomic statement, so two requests racing for the last spot cannot both pass the check. The statement inserts zero rows when the event is full, and the route reads `meta.changes` to tell a full event from a successful registration. The `UNIQUE` constraint is the backstop for a duplicate that slips past the explicit check; the route catches that failure, confirms a row exists, and returns `409`.

**Node prototype.** `registrations()` and `saveRegistrations()` are a synchronous read and write with no `await` between them, so the capacity check and the insert cannot interleave on Node's single thread.

The race was tested rather than assumed. Four accounts registering simultaneously for an event with one spot produced exactly one `201` and three `400` responses.

## The interface

**Event detail view.** Each FR3 card now carries a **View details** button that opens `#/events/<id>`. The detail view shows the full description, date and time, venue, and organizer, with an availability card on the right giving the remaining spots as a large figure, the total capacity, and how many students have already registered.

**The button.** **Register for this event** appears when the student is not registered, the event is active and upcoming, and spots remain. Once registered, it becomes **Cancel registration**. Both actions redraw the availability card from the response, so the figures and the button change together without a reload. A student who already holds a spot still sees **Cancel registration** on an event that has since filled up: being full stops new registrations, it does not trap the students already registered.

**My events.** The `#/my-events` page lists every event the student is registered for, soonest first, each card offering **View details** and **Cancel registration**. A student with no registrations sees a short message and a link back to the event list.

**Routing.** FR4 introduces hash routing, which the project did not have before. `showView()` reads `location.hash` and shows exactly one of the browse list, the detail view, or the My events page, and it runs on both `hashchange` and sign-in. It sets each panel's `display` directly rather than toggling the `hidden` class, because the stylesheet's `.hidden` rule is overridden by `.workspace` and does not actually hide those panels.

## Changes to existing files

FR1, FR2, and FR3 behaviour is unchanged. FR4 touched existing code in only three places, all additive:

1. **One button added to the FR3 card template** in `loadEvents()`, so the detail view is reachable. No filtering, sorting, or search behaviour was altered.
2. **One call to `showView()` added at the end of `showUser()`**, so the correct panel is shown after sign-in and sign-out.
3. **New CSS rules appended** to the end of the stylesheet. No existing rule was edited.

`validateEvent()` was deliberately not touched in either backend, so FR2's create and edit forms are unchanged and every event simply takes the default capacity.

Because `showView()` now sets panel visibility explicitly, two pre-existing display bugs stop appearing: the organizer dashboard is no longer shown to students and signed-out visitors, and the browse section is now hidden on sign-out. Neither was a security problem, as the server has always enforced the organizer role, and no FR2 or FR3 code was modified to achieve this.

## Testing

Run the prototype with `node server.js` and open http://localhost:3000.

An automated check of 50 cases covers the four new routes and the FR1, FR2, and FR3 routes: registration, duplicate registration, cancellation, cancelling twice, the cancelled, past, and unknown event cases, `401` on every route that needs a session, the detail payload's fields and its behaviour when signed out, the shape and ordering of `my-registrations`, one user's registrations staying invisible to another, FR1 sign-up, sign-in, and a wrong password, FR2 creation, editing, and its role checks, and FR3's keyword, category, and date filters. All 50 passed. Capacity was then tested separately against an event edited down to one spot: four simultaneous registrations produced exactly one `201` and three `400` responses, the detail route reported zero remaining, and cancelling freed the spot again.

Browser testing covered: creating an account; the browse list showing the new **View details** button; opening an event; registering and watching the figure fall to zero with the button becoming **Cancel registration** and the card reading **Event full**; the My events page listing the registration; cancelling from that list and seeing the empty state and its browse link; signing in as an organizer and confirming the dashboard still lists and manages events; and the hash router showing exactly one panel at `#`, `#/my-events`, and `#/events/<id>`. No console errors were produced at any point.

## Known limits

* **Organizers cannot set capacity.** FR2's create and edit form has no capacity field, so every event gets the default of 50. Adding one means a new field in the form and in `validateEvent()` in both backends, which is an FR2 change and was left for the group to decide.
* **The account panel's wording is now out of date.** FR1 tells a signed-in student that "Event browsing and registration features are coming in the next project phase." Registration has arrived, so that sentence in `showUser()` should be reworded. It was left alone because it belongs to FR1.
* **No waiting list.** A full event simply refuses registrations. A student cannot queue for a spot that someone later cancels.
* **No notification on cancellation.** When an organizer cancels an event, registered students only find out by visiting My events. Connecting that to FR5 is the next step, and `GET /api/my-registrations` already returns the `status` field those messages would be built from.
* **Registrations survive their event.** Cancelling an event leaves its registration rows in place, which is what lets My events explain what happened. Nothing prunes rows for events that have long passed.
* **Organizers cannot see who registered.** Only counts are exposed. An attendee list would need a new organizer-only route.
* **An organizer can register for events, including their own.** Nothing in FR1 forbids it and it is harmless in a prototype, but the group should decide whether it belongs in the requirements.
* **Time zones.** The started and upcoming checks compare date and time strings against the server's own clock, matching how FR2 stores them. The Node version uses local time and the Worker uses UTC, so an event starting within a few hours of now can be judged upcoming by one and started by the other. The group should agree on a single campus time zone and store it explicitly.
