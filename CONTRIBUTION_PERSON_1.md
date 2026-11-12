# Person 1 contribution: introduction and accounts (FR1)

## Project overview

The Student Event Planning System (SEPS) is a COM-430 group project for helping students and organizations manage campus events. The intended system covers accounts, event management, event discovery, event registration, and notifications. This contribution creates the starting page and implements **FR1: user registration and login**. It gives the rest of the group an account system and a starting point for adding event features.

The deployed prototype is available at https://student-event-planning-system.cyrz.workers.dev. Its green and gold styling is inspired by Saint Leo University. It is a student project, not an official university service.

## What is complete

- A responsive introduction page explains the purpose of SEPS and its intended audience.
- A visitor can switch between the **Log in** and **Create account** forms.
- A new user provides a name, email, password, and role (student or event organizer). Email addresses are normalized to lowercase and must be unique. Passwords must contain 8–128 characters.
- After registration or login, the page shows the user's name, email, and role. A user can log out, and the page checks for an existing session when it loads.
- The hosted version runs on Cloudflare Workers, serves the page as a static asset, and stores accounts and sessions in Cloudflare D1.
- A separate, simpler Node.js version is available for local work without Cloudflare. Its account data is separate from the hosted version.

FR2–FR5 are **not implemented yet**. The role field records a choice, but there are no event routes yet and no permission checks for organizer-only actions. Any future event-management routes must check the signed-in user's role on the server.

## Files and responsibilities

| File | Purpose |
| --- | --- |
| `public/index.html` | Page, styling, forms, and browser-side JavaScript used by the Cloudflare deployment. |
| `index.html` | The equivalent page served by the local Node.js version. Keep both HTML files in sync when changing the interface. |
| `worker.js` | Cloudflare backend: serves assets and handles account API requests using D1. |
| `schema.sql` | Creates the D1 `users` and `sessions` tables and an expiration index. |
| `wrangler.jsonc` | Cloudflare Worker name, entry point, asset directory, and D1 database binding. |
| `server.js` | Optional Node.js backend for local use. It stores users in `data/users.json` and keeps sessions in memory. |
| `README.md` | Project overview and basic setup instructions. |

There is currently no framework, build step, package file, or third-party runtime library. The page uses plain HTML, CSS, and JavaScript. Cloudflare's Wrangler command-line tool is run through `npx` in the instructions below.

## How the hosted account system works

1. The browser sends form data as JSON to the Worker. The Worker checks the input before saving it.
2. On registration, the Worker generates a random salt and uses PBKDF2 with SHA-256 to derive a password hash. D1 stores the hash and salt rather than the original password. Cloudflare Workers supports up to 100,000 PBKDF2 iterations per operation; this prototype uses that limit. This cost is below common modern production recommendations, so the team should review authentication before using real accounts.
3. On login, the Worker derives a hash using the submitted password and saved salt, then compares it to the stored hash. A failed login returns a generic error.
4. After a successful registration or login, the Worker creates a random session token. The browser receives it in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie. D1 stores a hash of the token, the user ID, and an expiration time; it does not store the token itself.
5. The session lasts eight hours. On later requests, the Worker hashes the cookie value and looks it up in D1. Logging out removes the session record and clears the cookie. Expired session rows are not automatically deleted yet.

The local Node version uses its own salted `scrypt` password hashes and in-memory sessions. Restarting the Node server clears those sessions. Do not copy user records between the Node file and D1: the formats and password hashing methods differ.

## Account API

All paths are relative to the site URL. Requests that send data use `Content-Type: application/json`. The browser sends the session cookie automatically for same-origin requests.

| Method and path | Purpose | Input / result |
| --- | --- | --- |
| `POST /api/register` | Create an account and start a session. | JSON: `name`, `email`, `password`, and `role` (`student` or `organizer`). Returns `{ "user": ... }`. |
| `POST /api/login` | Check credentials and start a session. | JSON: `email` and `password`. Returns `{ "user": ... }`. |
| `GET /api/session` | Check whether the browser has a valid session. | Returns `{ "user": ... }` or `{ "user": null }`. |
| `POST /api/logout` | End the current session. | Returns `{ "ok": true }` and clears the cookie. |

A returned user contains `id`, `name`, `email`, and `role`; it does not contain a password hash. Errors use a JSON `error` field, with status codes including 400 for invalid input, 401 for invalid credentials, and 409 for a duplicate email. `GET /api/session` is useful for updating the interface, but it does not protect a backend route by itself. New protected routes must call the session lookup in `worker.js` and enforce authorization on the server.

Example registration request (use a test account, not a real password):

```json
{
  "name": "Example Student",
  "email": "student@example.edu",
  "password": "example-password",
  "role": "student"
}
```

## Database structure

The `users` table contains `id`, `name`, `email`, `role`, `salt`, and `password_hash`. The ID is a UUID, the email is unique, and the role must be `student` or `organizer`.

The `sessions` table contains `token_hash`, `user_id`, and `expires_at` (a Unix timestamp in milliseconds). Its `user_id` refers to `users.id`. The expiration index helps find expired sessions, but no cleanup task exists yet.

When adding tables, write a new SQL migration and apply it to the local database first. Coordinate before applying it to the shared remote database; avoid deleting or recreating existing tables because they can contain group members' data. `schema.sql` is the initial schema, not a complete migration history.

## Running locally

### Option A: Node version

Install Node.js 18 or newer, then run:

```sh
node server.js
```

Open http://localhost:3000. The server creates `data/users.json` automatically. This file is ignored by Git. To change the port, set the `PORT` environment variable before starting the server. This path is convenient for working on the page, but backend changes to `server.js` do not automatically change `worker.js`.

### Option B: Cloudflare version

Install Node.js and run the following from the project folder:

```sh
npx wrangler d1 execute seps-db --local --file=schema.sql
npx wrangler dev
```

Open the local URL printed by Wrangler (normally http://localhost:8787). This uses a local D1 database, separate from the deployed database. The `.wrangler/` directory is ignored by Git. Use this option when developing the deployed Worker. Local emulation may not enforce every production limit, so also check the deployed version after a change.

## Deploying updates

The current `wrangler.jsonc` points to the existing `seps-db` database in the owner's Cloudflare account. A group member needs access to that account and must run `npx wrangler login` before deploying. For a separate Cloudflare account, create a new D1 database with `npx wrangler d1 create seps-db` and replace the database ID in that person's configuration with the ID returned by Cloudflare.

For a new database, initialize its schema once:

```sh
npx wrangler d1 execute seps-db --remote --file=schema.sql
```

Then deploy the Worker and files in `public/`:

```sh
npx wrangler deploy
```

Deployments affect the shared live site. Review changes with the group and test locally first. The site uses `public/index.html`, so editing only the root `index.html` will not change the deployed page. A deployment does not automatically apply future database changes; apply reviewed migrations separately. Never commit credentials, session tokens, passwords, or local account data.

## How the group can build on this work

- **FR2 — Event creation and management:** Add an events table and backend routes for creating, editing, and canceling events. Associate each event with its organizer's `users.id`. Check the current session and role on the server, and decide whether only the event's owner can edit it.
- **FR3 — Browsing and searching:** Add a page or section for upcoming events and an endpoint that returns event details. Agree on category, date, and search behavior with the FR2 contributor so the database supports these filters.
- **FR4 — Event registration:** Add a table linking user IDs to event IDs. Define duplicate registration and cancellation behavior, and require a valid session for changes.
- **FR5 — Notifications:** Decide how messages will be delivered and what triggers them. Connect confirmations, updates, and cancellations to the event and registration records. Email delivery is not currently configured.

Coordinate field names, API response shapes, validation rules, and shared database changes before integrating work. Both the browser and backend should validate inputs; server-side authorization must be the source of truth.

## Testing and known limits

The deployed Worker was manually tested for registration, session lookup, logout, and login with a temporary account, which was removed afterward. The initial deployment failed on registration because its PBKDF2 iteration count exceeded Cloudflare's production limit; reducing it to 100,000 fixed the live flow. Local testing alone did not reveal that limit.

Before presenting or extending the prototype, test both roles; invalid and duplicate emails; short passwords; incorrect credentials; refresh while signed in; logout; and the mobile layout. Test the exact Cloudflare version being deployed. There is no automated test suite yet.

The project is a prototype. It does not yet have email verification, password reset, rate limiting, session cleanup, audit logging, or automated tests. It also does not verify that an organizer is authorized by the university. Account registration is public, and the current password-hashing cost is constrained by the Worker runtime. Avoid using sensitive or reused passwords; a production system should use a reviewed authentication provider or a stronger production-ready authentication design.

The SEPS calendar-and-star logo also serves as the favicon. Cloudflare uses `public/logo.svg`; the Node version uses the matching root `logo.svg`. Keep both copies synchronized if the logo changes.
