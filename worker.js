const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const random = n => { const bytes = new Uint8Array(n); crypto.getRandomValues(bytes); return hex(bytes); };
async function hash(value) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256));
}
function json(data, status = 200, headers = {}) { return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } }); }
function token(request) { return request.headers.get('Cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith('session='))?.slice(8); }
async function session(request, db) {
  const value = token(request); if (!value) return null;
  return db.prepare('SELECT users.id, users.name, users.email, users.role FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?').bind(await hash(value), Date.now()).first();
}
async function signIn(db, user) {
  const value = random(32);
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await hash(value), user.id, Date.now() + 28800000).run();
  return json({ user }, 200, { 'Set-Cookie': `session=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800` });
}
export default { async fetch(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
  try {
    if (request.method === 'GET' && url.pathname === '/api/session') return json({ user: await session(request, env.DB) });
    if (request.method === 'POST' && url.pathname === '/api/logout') {
      const value = token(request); if (value) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hash(value)).run();
      return json({ ok: true }, 200, { 'Set-Cookie': 'session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0' });
    }
    if (request.method !== 'POST' || !['/api/register', '/api/login'].includes(url.pathname)) return json({ error: 'Not found.' }, 404);
    if (Number(request.headers.get('Content-Length')) > 10000) return json({ error: 'Request too large.' }, 413);
    let input; try { input = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
    const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
    const password = typeof input?.password === 'string' ? input.password : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 8 || password.length > 128) return json({ error: 'Enter a valid email and a password of 8–128 characters.' }, 400);
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

