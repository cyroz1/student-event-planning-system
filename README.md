# Student Event Planning System (SEPS)

A web-based application that helps university students and student organizations plan, organize, and manage campus events such as seminars, workshops, cultural celebrations, and academic activities.

Built as the group software development project for COM-430. Due November 15, 2026.

## Functional requirements

- **FR1, User Registration and Login:** Students and event organizers can create accounts and log in securely.
- **FR2, Event Creation and Management:** Organizers can create, edit, and cancel events, including title, date, time, venue, and description.
- **FR3, Event Browsing and Searching:** Students can view upcoming events and search by category, date, or event name.
- **FR4, Event Registration:** Students can register for events and cancel their registrations.
- **FR5, Event Notifications:** The system notifies registered students about event confirmations, updates, and cancellations.

## Project deliverables

- Requirements analysis
- UML use case diagram
- User interface design
- Functional prototype

## Group members

- Amir Limame
- Ali Alsulaiti
- Breylan Laguerre
- Jalendorien Asuncion
- Zeid Ayoub

GitHub collaborator invites are pending each member's GitHub username (asked in the Teams group chat on Nov 10, 2026).

## Getting started

See [Person 1 contribution and handoff](CONTRIBUTION_PERSON_1.md) for the architecture, account API, setup, and guidance for the remaining requirements.

## Running the prototype

Install Node.js 18 or newer, then run `node server.js` from the project directory and open http://localhost:3000. No additional packages are required. The optional `PORT` environment variable changes the listening port.

Students and organizers can create an account, sign in, and sign out. Accounts are stored locally in `data/users.json` with salted password hashes; this file is ignored by Git. Sessions expire after eight hours and are cleared when the server restarts. Event management, browsing, registration, and notifications are planned for later phases.

This is a local course prototype. Before public deployment, add HTTPS, persistent session storage, rate limiting, account recovery, and a production database; set `NODE_ENV=production` when serving over HTTPS to enable secure cookies.

## Cloudflare Workers deployment

The Worker serves the page from `public/` and uses a Cloudflare D1 database for accounts and sessions. Install Wrangler (`npm install --save-dev wrangler`), authenticate with `npx wrangler login`, then create a database with `npx wrangler d1 create seps-db`. If using a different Cloudflare account, replace the database ID in `wrangler.jsonc` with the returned ID. Initialize it using `npx wrangler d1 execute seps-db --remote --file=schema.sql`, then deploy with `npx wrangler deploy`. For local development, initialize the local database with `npx wrangler d1 execute seps-db --local --file=schema.sql` and run `npx wrangler dev`.

The Cloudflare deployment has separate data from the Node prototype. It uses PBKDF2 password hashes and stores hashed session tokens in D1. Before public use, add rate limiting, account recovery, and expired-session cleanup.


## Automatic deployment from GitHub

The `.github/workflows/cloudflare.yml` workflow deploys the Worker when a commit is pushed or merged into `main`. Group members only need permission to contribute to the GitHub repository; they do not need Cloudflare access. Changes to `worker.js`, `wrangler.jsonc`, and `public/` are included. Database schema changes are not applied automatically and must be coordinated separately.

A repository administrator must complete this one-time setup:

1. Create a Cloudflare API token with permission to edit Workers in the Cloudflare account that owns the site. Scope it to that account. Keep the token private.
2. In the GitHub repository, open **Settings → Secrets and variables → Actions**. Under **Secrets**, add `CLOUDFLARE_API_TOKEN` with that token. Under **Variables**, add `CLOUDFLARE_ACCOUNT_ID` with the account ID from the Cloudflare dashboard.
3. Commit and push the application files and the workflow to `main`. In GitHub's **Actions** tab, check that **Deploy to Cloudflare Workers** succeeds. Later pushes to `main` trigger it automatically.

Do not put the API token in a file or commit it. Anyone who can change the deployment workflow on `main` can potentially use its secret, so protect the branch and review changes. The older GitHub Pages workflow publishes a separate static copy and does not provide the account backend; the Cloudflare URL is the working application.

## Account security notes

The Cloudflare Worker limits login and registration attempts by IP address and by a hash of the submitted email, checks the request origin for account changes, bounds request size, and adds browser security headers. Cloudflare's rate limits are approximate and scoped to individual locations; shared networks may encounter limits together, and these controls are not a complete defense against distributed attacks. Existing accounts and password hashes continue to work.

This remains a class prototype. Passwords use 100,000 PBKDF2-SHA-256 iterations, below current OWASP guidance. There is no email verification, password recovery, or multi-factor authentication. The organizer role is self-selected and must not be treated as proof of authority. Future protected routes must verify the session and implement server-side authorization. Use test data and unique passwords; use a reviewed authentication provider and a full security review before public production use.
