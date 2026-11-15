# Person 3 contribution: event browsing and searching (FR3)

## Overview

This contribution implements **FR3: Event Browsing and Searching**. Students and visitors can view upcoming active events and search or filter them by category, date, or keywords in the title, description, or venue. Organizers continue to use the existing dashboard to create and manage events.

## What was added

- **`server.js`** — Updated `GET /api/events` to support optional query parameters (`category`, `date`, and `q`) and exclude canceled events from results.
- **`index.html` and `public/index.html`** — Added a browse section with a search form (keyword, category dropdown, and date picker) and a list of matching events. The section appears after a user signs in.
- No new database tables were required. Filtering uses the existing events data.

## How browsing works

1. After sign-in, the page calls `GET /api/events` with any active filters.
2. The server returns non-canceled events that match the filters, sorted by date and time.
3. The page displays each event with its title, category, date, time, venue, and description.
4. Submitting the search form or clicking Clear reloads the list with the updated parameters.

The endpoint still works without parameters and returns all active events, so the existing organizer dashboard is unaffected.

## API

| Method and path | Purpose | Query parameters |
| --- | --- | --- |
| `GET /api/events` | Return active events, optionally filtered. | `category`, `date`, `q` (all optional) |

Example: `GET /api/events?category=Workshop&q=python`

Returns `{ "events": [ ... ] }`.

## Files changed

| File | Change |
| --- | --- |
| `server.js` | Added filtering logic to the existing `GET /api/events` handler. |
| `index.html` | Added the browse section, search form, and client-side JavaScript. |
| `public/index.html` | Same interface changes so the Cloudflare deployment stays in sync. |

## Testing

- Local Node: `node server.js` → http://localhost:3000
- Sign in as a student and confirm the browse section appears.
- Create events as an organizer, then search by category, date, or keyword.
- Confirm canceled events do not appear in the list.
