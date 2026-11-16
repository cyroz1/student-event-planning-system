const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const root = __dirname;
const dataPath = path.join(root, 'data', 'users.json');
const eventsPath = path.join(root, 'data', 'events.json');
const registrationsPath = path.join(root, 'data', 'registrations.json');
const sessions = new Map();
const port = Number(process.env.PORT) || 3000;
fs.mkdirSync(path.dirname(dataPath), { recursive: true });
if (!fs.existsSync(dataPath)) fs.writeFileSync(dataPath, '[]', { mode: 0o600 });
if (!fs.existsSync(eventsPath)) fs.writeFileSync(eventsPath, '[]', { mode: 0o600 });
if (!fs.existsSync(registrationsPath)) fs.writeFileSync(registrationsPath, '[]', { mode: 0o600 });
function users() { return JSON.parse(fs.readFileSync(dataPath, 'utf8')); }
function events() { return JSON.parse(fs.readFileSync(eventsPath, 'utf8')); }
function saveEvents(list) { fs.writeFileSync(eventsPath, JSON.stringify(list, null, 2), { mode: 0o600 }); }
function registrations() { return JSON.parse(fs.readFileSync(registrationsPath, 'utf8')); }
function saveRegistrations(list) { fs.writeFileSync(registrationsPath, JSON.stringify(list, null, 2), { mode: 0o600 }); }
function send(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
function current(req) {
  const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('session='))?.slice(8);
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) { if (token) sessions.delete(token); return null; }
  return session.user;
}
function login(res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { user, expires: Date.now() + 8 * 60 * 60 * 1000 });
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  send(res, 200, { user });
}
const CATEGORIES = ['Seminar', 'Workshop', 'Cultural', 'Academic', 'Other'];
function validateEvent(input) {
  const title = typeof input?.title === 'string' ? input.title.trim() : '';
  const category = typeof input?.category === 'string' ? input.category.trim() : '';
  const event_date = typeof input?.event_date === 'string' ? input.event_date.trim() : '';
  const event_time = typeof input?.event_time === 'string' ? input.event_time.trim() : '';
  const venue = typeof input?.venue === 'string' ? input.venue.trim() : '';
  const description = typeof input?.description === 'string' ? input.description.trim() : '';
  if (!title || title.length > 120) return { error: 'Enter an event title (up to 120 characters).' };
  if (!CATEGORIES.includes(category)) return { error: 'Choose a valid event category.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event_date)) return { error: 'Enter a valid event date (YYYY-MM-DD).' };
  if (!/^\d{2}:\d{2}$/.test(event_time)) return { error: 'Enter a valid event time (HH:MM).' };
  if (!venue || venue.length > 120) return { error: 'Enter a venue (up to 120 characters).' };
  if (!description || description.length > 1000) return { error: 'Enter a description (up to 1000 characters).' };
  return { data: { title, category, event_date, event_time, venue, description } };
}
const DEFAULT_CAPACITY = 50;
function eventCapacity(event) {
  const value = Number(event?.capacity);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_CAPACITY;
}
function currentMoment() {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');
  return { date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, time: `${pad(now.getHours())}:${pad(now.getMinutes())}` };
}
function hasNotStarted(event, moment) {
  return event.event_date > moment.date || (event.event_date === moment.date && event.event_time >= moment.time);
}
function registrationCount(list, eventId) {
  return list.filter(row => row.event_id === eventId).length;
}
function isRegistered(list, eventId, userId) {
  return Boolean(userId) && list.some(row => row.event_id === eventId && row.user_id === userId);
}
function organizerNames() {
  const names = new Map();
  for (const account of users()) names.set(account.id, account.name);
  return names;
}
function eventDetail(event, list, viewerId) {
  const capacity = eventCapacity(event);
  const registered_count = registrationCount(list, event.id);
  return {
    id: event.id,
    title: event.title,
    category: event.category,
    event_date: event.event_date,
    event_time: event.event_time,
    venue: event.venue,
    description: event.description,
    status: event.status,
    capacity,
    registered_count,
    remaining_spots: Math.max(0, capacity - registered_count),
    organizer_name: organizerNames().get(event.organizer_id) || 'Campus organizer',
    has_started: !hasNotStarted(event, currentMoment()),
    is_registered: isRegistered(list, event.id, viewerId)
  };
}
async function readBody(req) {
  let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 10000) throw new RangeError('too large'); }
  return JSON.parse(body);
}
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/logo.svg') { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); return res.end(fs.readFileSync(path.join(root, 'logo.svg'))); }
    if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(root, 'index.html'))); }
    if (req.method === 'GET' && url.pathname === '/api/session') return send(res, 200, { user: current(req) });
    if (req.method === 'GET' && url.pathname === '/api/events') {
  const category = url.searchParams.get('category') || '';
  const date = url.searchParams.get('date') || '';
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();

  let list = events().filter(e => e.status !== 'canceled');

  if (category && CATEGORIES.includes(category)) {
    list = list.filter(e => e.category === category);
  }
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    list = list.filter(e => e.event_date === date);
  }
  if (q) {
    list = list.filter(e =>
      e.title.toLowerCase().includes(q) ||
      (e.description && e.description.toLowerCase().includes(q)) ||
      (e.venue && e.venue.toLowerCase().includes(q))
    );
  }
  const sorted = list.sort((a, b) =>
    `${a.event_date} ${a.event_time}`.localeCompare(`${b.event_date} ${b.event_time}`)
  );
  return send(res, 200, { events: sorted });
}
    if (req.method === 'GET' && url.pathname === '/api/my-registrations') {
      const viewer = current(req);
      if (!viewer) return send(res, 401, { error: 'You must be logged in to view your registrations.' });
      const byId = new Map(events().map(event => [event.id, event]));
      const mine = registrations()
        .filter(row => row.user_id === viewer.id && byId.has(row.event_id))
        .map(row => {
          const event = byId.get(row.event_id);
          return {
            id: event.id,
            title: event.title,
            category: event.category,
            event_date: event.event_date,
            event_time: event.event_time,
            venue: event.venue,
            status: event.status,
            has_started: !hasNotStarted(event, currentMoment()),
            registered_at: row.registered_at
          };
        })
        .sort((a, b) => `${a.event_date} ${a.event_time}`.localeCompare(`${b.event_date} ${b.event_time}`));
      return send(res, 200, { events: mine });
    }
    const registerMatch = url.pathname.match(/^\/api\/events\/([a-zA-Z0-9-]+)\/register$/);
    if (registerMatch && (req.method === 'POST' || req.method === 'DELETE')) {
      const viewer = current(req);
      if (!viewer) return send(res, 401, { error: 'You must be logged in to register for an event.' });
      const eventId = registerMatch[1];
      const event = events().find(item => item.id === eventId);
      if (!event) return send(res, 404, { error: 'Event not found.' });
      const moment = currentMoment();
      if (req.method === 'POST') {
        if (event.status !== 'active') return send(res, 400, { error: 'This event is not open for registration.' });
        if (!hasNotStarted(event, moment)) return send(res, 400, { error: 'This event has already started. Registration is closed.' });
        const all = registrations();
        if (isRegistered(all, eventId, viewer.id)) return send(res, 409, { error: 'You are already registered for this event.' });
        if (registrationCount(all, eventId) >= eventCapacity(event)) return send(res, 400, { error: 'This event is full. Registration is closed.' });
        all.push({ id: crypto.randomUUID(), user_id: viewer.id, event_id: eventId, registered_at: Date.now() });
        saveRegistrations(all);
        return send(res, 201, { event: eventDetail(event, all, viewer.id) });
      }
      if (!hasNotStarted(event, moment)) return send(res, 400, { error: 'This event has already started. Your registration can no longer be cancelled.' });
      const all = registrations();
      const index = all.findIndex(row => row.event_id === eventId && row.user_id === viewer.id);
      if (index === -1) return send(res, 404, { error: 'You are not registered for this event.' });
      all.splice(index, 1);
      saveRegistrations(all);
      return send(res, 200, { event: eventDetail(event, all, viewer.id) });
    }
    const detailMatch = url.pathname.match(/^\/api\/events\/([a-zA-Z0-9-]+)$/);
    if (req.method === 'GET' && detailMatch) {
      const event = events().find(item => item.id === detailMatch[1]);
      if (!event) return send(res, 404, { error: 'Event not found.' });
      return send(res, 200, { event: eventDetail(event, registrations(), current(req)?.id) });
    }
    if (req.method === 'POST' && url.pathname === '/api/logout') {
      const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('session='))?.slice(8);
      sessions.delete(token); res.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/events' || url.pathname.startsWith('/api/events/')) {
      const user = current(req);
      if (!user) return send(res, 401, { error: 'You must be logged in.' });
      if (user.role !== 'organizer') return send(res, 403, { error: 'Only event organizers can manage events.' });
      if (req.method === 'POST' && url.pathname === '/api/events') {
        let input; try { input = await readBody(req); } catch { return send(res, 400, { error: 'Invalid request.' }); }
        const check = validateEvent(input);
        if (check.error) return send(res, 400, { error: check.error });
        const now = Date.now();
        const event = { id: crypto.randomUUID(), organizer_id: user.id, ...check.data, status: 'active', created_at: now, updated_at: now };
        const all = events(); all.push(event); saveEvents(all);
        return send(res, 201, { event });
      }
      const editMatch = url.pathname.match(/^\/api\/events\/([a-zA-Z0-9-]+)$/);
      if (req.method === 'PUT' && editMatch) {
        const all = events();
        const idx = all.findIndex(e => e.id === editMatch[1]);
        if (idx === -1) return send(res, 404, { error: 'Event not found.' });
        if (all[idx].organizer_id !== user.id) return send(res, 403, { error: 'You can only edit your own events.' });
        let input; try { input = await readBody(req); } catch { return send(res, 400, { error: 'Invalid request.' }); }
        const check = validateEvent(input);
        if (check.error) return send(res, 400, { error: check.error });
        all[idx] = { ...all[idx], ...check.data, updated_at: Date.now() };
        saveEvents(all);
        return send(res, 200, { event: all[idx] });
      }
      const cancelMatch = url.pathname.match(/^\/api\/events\/([a-zA-Z0-9-]+)\/cancel$/);
      if (req.method === 'PATCH' && cancelMatch) {
        const all = events();
        const idx = all.findIndex(e => e.id === cancelMatch[1]);
        if (idx === -1) return send(res, 404, { error: 'Event not found.' });
        if (all[idx].organizer_id !== user.id) return send(res, 403, { error: 'You can only cancel your own events.' });
        all[idx] = { ...all[idx], status: 'canceled', updated_at: Date.now() };
        saveEvents(all);
        return send(res, 200, { event: all[idx] });
      }
      return send(res, 404, { error: 'Not found.' });
    }
    if (req.method === 'POST' && ['/api/register', '/api/login'].includes(url.pathname)) {
      let input; try { input = await readBody(req); } catch { return send(res, 400, { error: 'Invalid request.' }); }
      const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
      const password = typeof input.password === 'string' ? input.password : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 8 || password.length > 128) return send(res, 400, { error: 'Enter a valid email and a password of 8-128 characters.' });
      if (url.pathname === '/api/register') {
        const name = typeof input.name === 'string' ? input.name.trim() : '';
        const role = input.role;
        if (!name || name.length > 100 || !['student', 'organizer'].includes(role)) return send(res, 400, { error: 'Enter your name and choose a role.' });
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = (await scrypt(password, salt, 64)).toString('hex');
        const all = users();
        if (all.some(u => u.email === email)) return send(res, 409, { error: 'An account with that email already exists.' });
        const user = { id: crypto.randomUUID(), name, email, role };
        all.push({ ...user, salt, hash }); fs.writeFileSync(dataPath, JSON.stringify(all, null, 2), { mode: 0o600 });
        return login(res, user);
      }
      const account = users().find(u => u.email === email);
      const hash = await scrypt(password, account?.salt || '00000000000000000000000000000000', 64);
      if (!account || !crypto.timingSafeEqual(hash, Buffer.from(account.hash, 'hex'))) return send(res, 401, { error: 'Invalid email or password.' });
      return login(res, { id: account.id, name: account.name, email: account.email, role: account.role });
    }
    send(res, 404, { error: 'Not found.' });
  } catch (err) { console.error(err); if (!res.headersSent) send(res, 500, { error: 'Something went wrong. Please try again.' }); else res.end(); }
}).listen(port, () => console.log(`SEPS running at http://localhost:${port}`));
