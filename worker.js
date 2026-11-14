const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const random = n => { const bytes = new Uint8Array(n); crypto.getRandomValues(bytes); return hex(bytes); };
async function hash(value) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256));
}
const securityHeaders = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" };
function json(data, status = 200, headers = {}) { return Response.json(data, { status, headers: { ...securityHeaders, 'Cache-Control': 'no-store', ...headers } }); }
function token(request) { const value = request.headers.get('Cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith('session='))?.slice(8); return /^[a-f0-9]{64}$/.test(value || '') ? value : null; }
async function session(request, db) {
  const value = token(request); if (!value) return null;
  return db.prepare('SELECT users.id, users.name, users.email, users.role FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?').bind(await hash(value), Date.now()).first();
}
async function signIn(db, user) {
  const value = random(32);
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await hash(value), user.id, Date.now() + 28800000).run();
  return json({ user }, 200, { 'Set-Cookie': `session=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800` });
}
async function readJson(request) {
  if (!request.body) throw new Error('invalid');
  const reader = request.body.getReader(); let size = 0; const chunks = [];
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 10000) { await reader.cancel(); throw new RangeError('too large'); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
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
export default { async fetch(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) {
    const response = await env.ASSETS.fetch(request); const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  try {
    if (request.method === 'GET' && url.pathname === '/api/session') return json({ user: await session(request, env.DB) });
    if (request.method === 'GET' && url.pathname === '/api/events') {
      const { results } = await env.DB.prepare('SELECT * FROM events ORDER BY event_date ASC, event_time ASC').all();
      return json({ events: results || [] });
    }
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && request.headers.get('Origin') !== url.origin) return json({ error: 'Request origin is not allowed.' }, 403);
    if (request.method === 'POST' && url.pathname === '/api/logout') {
      const value = token(request); if (value) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hash(value)).run();
      return json({ ok: true }, 200, { 'Set-Cookie': 'session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0' });
    }
    if (url.pathname === '/api/events' || url.pathname.startsWith('/api/events/')) {
      const user = await session(request, env.DB);
      if (!user) return json({ error: 'You must be logged in.' }, 401);
      if (user.role !== 'organizer') return json({ error: 'Only event organizers can manage events.' }, 403);

      if (request.method === 'POST' && url.pathname === '/api/events') {
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) return json({ error: 'Invalid request.' }, 415);
        let input; try { input = await readJson(request); } catch { return json({ error: 'Invalid request.' }, 400); }
        const check = validateEvent(input);
        if (check.error) return json({ error: check.error }, 400);
        const now = Date.now();
        const event = { id: crypto.randomUUID(), organizer_id: user.id, ...check.data, status: 'active', created_at: now, updated_at: now };
        await env.DB.prepare('INSERT INTO events (id, organizer_id, title, category, event_date, event_time, venue, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(event.id, event.organizer_id, event.title, event.category, event.event_date, event.event_time, event.venue, event.description, event.status, event.created_at, event.updated_at).run();
        return json({ event }, 201);
      }

      const editMatch = url.pathname.match(/^\/api\/events\/([a-zA-Z0-9-]+)$/);
      if (request.method === 'PUT' && editMatch) {
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) return json({ error: 'Invalid request.' }, 415);
        const existing = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(editMatch[1]).first();
        if (!existing) return json({ error: 'Event not found.' }, 404);
        if (existing.organizer_id !== user.id) return json({ error: 'You can only edit your own events.' }, 403);
        let input; try { input = await readJson(request); } catch { return json({ error: 'Invalid request.' }, 400); }
        const check = validateEvent(input);
        if (check.error) return json({ error: check.error }, 400);
        const updated_at = Date.now();
        await env.DB.prepare('UPDATE events SET title = ?, category = ?, event_date = ?, event_time = ?, venue = ?, description = ?, updated_at = ? WHERE id = ?').bind(check.data.title, check.data.category, check.data.event_date, check.data.event_time, check.data.venue, check.data.description, updated_at, existing.id).run();
        return json({ event: { ...existing, ...check.data, updated_at } });
      }

      const cancelMatch = url.pathname.match(/^\/api\/events\/([a-zA-Z0-9-]+)\/cancel$/);
      if (request.method === 'PATCH' && cancelMatch) {
        const existing = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(cancelMatch[1]).first();
        if (!existing) return json({ error: 'Event not found.' }, 404);
        if (existing.organizer_id !== user.id) return json({ error: 'You can only cancel your own events.' }, 403);
        const updated_at = Date.now();
        await env.DB.prepare("UPDATE events SET status = 'canceled', updated_at = ? WHERE id = ?").bind(updated_at, existing.id).run();
        return json({ event: { ...existing, status: 'canceled', updated_at } });
      }
      return json({ error: 'Not found.' }, 404);
    }
    if (request.method !== 'POST' || !['/api/register', '/api/login'].includes(url.pathname)) return json({ error: 'Not found.' }, 404);
    const ip = request.headers.get('CF-Connecting-IP');
    if (!ip) return json({ error: 'Unable to process request.' }, 400);
    if (!(await env.AUTH_IP_LIMIT.limit({ key: ip })).success) return json({ error: 'Too many attempts. Please try again later.' }, 429, { 'Retry-After': '60' });
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) return json({ error: 'Invalid request.' }, 415);
    if (Number(request.headers.get('Content-Length')) > 10000) return json({ error: 'Request too large.' }, 413);
    let input; try { input = await readJson(request); } catch (error) { return json({ error: error instanceof RangeError ? 'Request too large.' : 'Invalid request.' }, error instanceof RangeError ? 413 : 400); }
    const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
    const password = typeof input?.password === 'string' ? input.password : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 8 || password.length > 128) return json({ error: 'Enter a valid email and a password of 8-128 characters.' }, 400);
    if (!(await env.AUTH_ACCOUNT_LIMIT.limit({ key: await hash(email) })).success) return json({ error: 'Too many attempts. Please try again later.' }, 429, { 'Retry-After': '60' });
    if (url.pathname === '/api/register') {
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name || name.length > 100 || !['student', 'organizer'].includes(input.role)) return json({ error: 'Enter your name and choose a role.' }, 400);
      const salt = random(16), digest = await passwordHash(password, salt);
      const user = { id: crypto.randomUUID(), name, email, role: input.role };
      const result = await env.DB.prepare('INSERT OR IGNORE INTO users (id, name, email, role, salt, password_hash) VALUES (?, ?, ?, ?, ?, ?)').bind(user.id, name, email, input.role, salt, digest).run();
      if (!result.meta.changes) return json({ error: 'An account with that email already exists.' }, 409);
      return signIn(env.DB, user);
    }
    const account = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    const digest = await passwordHash(password, account?.salt || '00000000000000000000000000000000');
    const expected = account?.password_hash || '0'.repeat(64);
    let difference = 0; for (let i = 0; i < 64; i++) difference |= digest.charCodeAt(i) ^ expected.charCodeAt(i);
    if (!account || difference) return json({ error: 'Invalid email or password.' }, 401);
    return signIn(env.DB, { id: account.id, name: account.name, email: account.email, role: account.role });
  } catch (error) { console.error(error); return json({ error: 'Something went wrong. Please try again.' }, 500); }
} };
