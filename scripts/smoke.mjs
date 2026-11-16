// End-to-end smoke test against the local Node server (server.js).
// Covers FR1 auth, FR2 event management + capacity, FR3 browse counts,
// FR4 registration limits, and FR5 notifications.
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const PORT = 3457;
const BASE = `http://127.0.0.1:${PORT}`;
const stamp = Date.now();
let failures = 0;

function check(label, condition, extra = '') {
  if (condition) console.log(`ok - ${label}`);
  else { failures++; console.error(`FAIL - ${label} ${extra}`); }
}

async function call(method, pathName, { cookie, body } = {}) {
  const res = await fetch(BASE + pathName, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      Origin: BASE
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const setCookie = res.headers.getSetCookie?.()[0]?.split(';')[0];
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: setCookie };
}

const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'inherit'
});
try {
  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    try { const r = await fetch(BASE + '/'); up = r.ok; } catch { await new Promise(r => setTimeout(r, 200)); }
  }
  if (!up) throw new Error('server did not come up');

  const org = await call('POST', '/api/register', { body: { name: 'Smoke Organizer', email: `org-${stamp}@test.dev`, password: 'TestPass123!', role: 'organizer' } });
  check('organizer signup', org.status === 200 && org.cookie, `got ${org.status}`);

  const created = await call('POST', '/api/events', { cookie: org.cookie, body: { title: 'Smoke Test Event', category: 'Seminar', event_date: '2027-06-01', event_time: '18:00', venue: 'Test Hall', description: 'Smoke test event.', capacity: 2 } });
  check('create event with capacity 2', created.status === 201 && created.data.event.capacity === 2, `got ${created.status} ${JSON.stringify(created.data)}`);
  const eventId = created.data.event.id;

  const list1 = await call('GET', '/api/events');
  const listed = (list1.data.events || []).find(e => e.id === eventId);
  check('list shows counts', listed && listed.registered_count === 0 && listed.remaining_spots === 2 && listed.capacity === 2, JSON.stringify(listed));

  const mkStudent = async n => {
    const s = await call('POST', '/api/register', { body: { name: `Smoke Student ${n}`, email: `stu${n}-${stamp}@test.dev`, password: 'TestPass123!', role: 'student' } });
    check(`student ${n} signup`, s.status === 200 && Boolean(s.cookie), `got ${s.status}`);
    return s;
  };
  const a = await mkStudent('A');
  const b = await mkStudent('B');
  const c = await mkStudent('C');

  const regA = await call('POST', `/api/events/${eventId}/register`, { cookie: a.cookie });
  check('student A registers', regA.status === 201 && regA.data.event.registered_count === 1, `got ${regA.status}`);
  const regB = await call('POST', `/api/events/${eventId}/register`, { cookie: b.cookie });
  check('student B registers', regB.status === 201 && regB.data.event.remaining_spots === 0, `got ${regB.status}`);
  const regC = await call('POST', `/api/events/${eventId}/register`, { cookie: c.cookie });
  check('student C blocked when full', regC.status === 400, `got ${regC.status}`);
  const regA2 = await call('POST', `/api/events/${eventId}/register`, { cookie: a.cookie });
  check('duplicate registration blocked', regA2.status === 409, `got ${regA2.status}`);

  const notif1 = await call('GET', '/api/notifications', { cookie: org.cookie });
  check('organizer notified of registrations', notif1.status === 200 && notif1.data.unread >= 2 && notif1.data.notifications.some(n => n.message.includes('registered for your event')), JSON.stringify(notif1.data));
  const read = await call('POST', '/api/notifications/read', { cookie: org.cookie });
  check('mark all read', read.status === 200 && read.data.unread === 0, `got ${read.status}`);
  const notif2 = await call('GET', '/api/notifications', { cookie: org.cookie });
  check('unread cleared', notif2.data.unread === 0, JSON.stringify(notif2.data.unread));

  const notifA0 = await call('GET', '/api/notifications', { cookie: a.cookie });
  check('student A got registration confirmation', notifA0.data.notifications.some(n => n.type === 'registration_confirmation' && n.message.includes('You are registered')), JSON.stringify(notifA0.data));

  const unregB = await call('DELETE', `/api/events/${eventId}/register`, { cookie: b.cookie });
  check('student B unregisters, spot reopens', unregB.status === 200 && unregB.data.event.remaining_spots === 1, `got ${unregB.status}`);

  const cancel = await call('PATCH', `/api/events/${eventId}/cancel`, { cookie: org.cookie });
  check('organizer cancels event', cancel.status === 200 && cancel.data.event.status === 'canceled', `got ${cancel.status}`);
  const notifA = await call('GET', '/api/notifications', { cookie: a.cookie });
  check('student A notified of cancellation', notifA.data.unread >= 1 && notifA.data.notifications.some(n => n.message.includes('canceled')), JSON.stringify(notifA.data));

  const stuCreate = await call('POST', '/api/events', { cookie: a.cookie, body: { title: 'Nope', category: 'Seminar', event_date: '2027-06-02', event_time: '18:00', venue: 'X', description: 'should fail', capacity: 5 } });
  check('student cannot create events', stuCreate.status === 403, `got ${stuCreate.status}`);

  const badCapacity = await call('POST', '/api/events', { cookie: org.cookie, body: { title: 'Bad cap', category: 'Seminar', event_date: '2027-06-02', event_time: '18:00', venue: 'X', description: 'should fail', capacity: 0 } });
  check('capacity 0 rejected', badCapacity.status === 400, `got ${badCapacity.status}`);
} catch (error) {
  failures++;
  console.error('FAIL - smoke run error', error);
} finally {
  server.kill('SIGTERM');
  await once(server, 'exit').catch(() => {});
}
if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log('all smoke checks passed');
