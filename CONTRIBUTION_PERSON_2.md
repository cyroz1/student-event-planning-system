# Person 2 contribution: UML use case diagram and event management (FR2)

## Overview

This contribution adds the **UML Use Case Diagram** and implements **FR2: Event Creation and Management**. Signed-in event organizers can create, edit, and cancel campus events, while students and logged-out visitors cannot modify events.

## What was added

* **`docs/uml-use-case.png`** — UML Use Case Diagram showing how Students and Event Organizers interact with the system across FR1–FR5.
* **`migrations/0002_events.sql`** — Database setup file that creates the `events` table to store event details (title, category, date, time, venue, description, and status).
* **`worker.js` and `server.js`** — Backend routes (`GET /api/events`, `POST /api/events`, `PUT /api/events/:id`, and `PATCH /api/events/:id/cancel`) that verify the user is a logged-in event organizer before saving or updating events.
* **`public/index.html` and `index.html`** — Adds the **Organizer Dashboard** when an organizer logs in, letting them create new events, edit their existing events, or cancel an event.
