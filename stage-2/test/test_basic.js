'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createServer, startServer, stopServer, request,
  resetState, login, signup, authHeaders, FIXTURE
} = require('./helper');

test('GET /health returns 200 with status ok', async () => {
  const { server } = createServer();
  const port = 9880;
  await startServer(server, port);
  try {
    const res = await request(port, '/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { status: 'ok' });
  } finally {
    await stopServer(server);
  }
});

test('POST /_test/reset with valid fixture returns 204', async () => {
  const { server } = createServer();
  const port = 9881;
  await startServer(server, port);
  try {
    const res = await resetState(port, FIXTURE);
    assert.equal(res.status, 204);
    assert.equal(res.body, '');
  } finally {
    await stopServer(server);
  }
});

test('POST /_test/reset with invalid fixture returns 422', async () => {
  const { server } = createServer();
  const port = 9882;
  await startServer(server, port);
  try {
    // Restaurant with invalid timezone
    const badFixture = {
      users: [{ id: 'u1', email: 'a@b.com', password: 'password123', display_name: 'A' }],
      restaurants: [{ id: 'r1', name: 'R', timezone: 'Not/A/Zone', slot_minutes: 30, reservation_duration_minutes: 60, cancellation_cutoff_minutes: 60, tables: [{ id: 't1', label: 'T', capacity: 4 }], opening_hours: [{ weekday: 'mon', opens: '09:00', closes: '22:00' }] }]
    };
    const res = await resetState(port, badFixture);
    assert.equal(res.status, 422);
  } finally {
    await stopServer(server);
  }
});

test('POST /_test/reset with UTC timezone succeeds', async () => {
  const { server } = createServer();
  const port = 9883;
  await startServer(server, port);
  try {
    const fixture = {
      users: [{ id: 'u1', email: 'a@b.com', password: 'password123', display_name: 'A' }],
      restaurants: [{ id: 'r1', name: 'R', timezone: 'UTC', slot_minutes: 30, reservation_duration_minutes: 60, cancellation_cutoff_minutes: 60, tables: [{ id: 't1', label: 'T', capacity: 4 }], opening_hours: [{ weekday: 'mon', opens: '09:00', closes: '22:00' }] }]
    };
    const res = await resetState(port, fixture);
    assert.equal(res.status, 204);
  } finally {
    await stopServer(server);
  }
});

test('POST /_test/reset with malformed JSON returns 400', async () => {
  const { server } = createServer();
  const port = 9884;
  await startServer(server, port);
  try {
    const res = await request(port, '/_test/reset', {
      method: 'POST',
      body: 'not json'
    });
    assert.equal(res.status, 400);
    assert.equal(res.json().error.code, 'malformed_request');
  } finally {
    await stopServer(server);
  }
});

test('GET /_test/export returns 200 with track and format_version', async () => {
  const { server } = createServer();
  const port = 9885;
  await startServer(server, port);
  try {
    await resetState(port, FIXTURE);
    const res = await request(port, '/_test/export');
    assert.equal(res.status, 200);
    const obj = res.json();
    assert.equal(obj.track, 'tablekeeper');
    assert.equal(obj.format_version, 1);
    assert.ok(obj.state);
    assert.ok(Array.isArray(obj.state.users));
    assert.ok(Array.isArray(obj.state.tokens));
    assert.ok(Array.isArray(obj.state.restaurants));
    assert.ok(Array.isArray(obj.state.reservations));
    assert.ok(Array.isArray(obj.state.used_references));
    assert.ok(Array.isArray(obj.state.idem));
  } finally {
    await stopServer(server);
  }
});

test('POST /_test/import round-trips export', async () => {
  const { server } = createServer();
  const port = 9886;
  await startServer(server, port);
  try {
    await resetState(port, FIXTURE);
    const exp = await request(port, '/_test/export');
    assert.equal(exp.status, 200);

    // Clear state
    await resetState(port, { users: [], restaurants: [] });

    // Import
    const imp = await request(port, '/_test/import', {
      method: 'POST',
      body: exp.body
    });
    assert.equal(imp.status, 204);

    // Verify users survived
    const loginRes = await login(port, 'ada@example.com', 'correct horse');
    assert.equal(loginRes.status, 200);
    const token = loginRes.json().token;
    assert.ok(token, 'should get token after import');

    // Verify restaurants survived
    const restRes = await request(port, '/restaurants');
    assert.equal(restRes.status, 200);
    const rest = restRes.json();
    assert.equal(rest.restaurants.length, 3);
  } finally {
    await stopServer(server);
  }
});

test('POST /_test/import with bad JSON returns 400', async () => {
  const { server } = createServer();
  const port = 9887;
  await startServer(server, port);
  try {
    const res = await request(port, '/_test/import', {
      method: 'POST',
      body: '{bad json'
    });
    assert.equal(res.status, 400);
  } finally {
    await stopServer(server);
  }
});

test('POST /_test/import with wrong track returns 422', async () => {
  const { server } = createServer();
  const port = 9888;
  await startServer(server, port);
  try {
    const res = await request(port, '/_test/import', {
      method: 'POST',
      body: JSON.stringify({ track: 'wrong', format_version: 1, state: {} })
    });
    assert.equal(res.status, 422);
  } finally {
    await stopServer(server);
  }
});

test('Signup creates user and returns token', async () => {
  const { server } = createServer();
  const port = 9889;
  await startServer(server, port);
  try {
    await resetState(port, { users: [], restaurants: FIXTURE.restaurants });
    const res = await signup(port, 'new@example.com', 'password123', 'New User');
    assert.equal(res.status, 201);
    const body = res.json();
    assert.ok(body.user_id);
    assert.ok(body.token);
    assert.equal(body.display_name, 'New User');
  } finally {
    await stopServer(server);
  }
});

test('Signup with duplicate email returns 409', async () => {
  const { server } = createServer();
  const port = 9890;
  await startServer(server, port);
  try {
    await resetState(port, FIXTURE);
    const res = await signup(port, 'ada@example.com', 'password123', 'Dup');
    assert.equal(res.status, 409);
    assert.equal(res.json().error.code, 'email_taken');
  } finally {
    await stopServer(server);
  }
});

test('Signup with short password returns 422', async () => {
  const { server } = createServer();
  const port = 9891;
  await startServer(server, port);
  try {
    await resetState(port, { users: [], restaurants: FIXTURE.restaurants });
    const res = await signup(port, 'short@example.com', 'short', 'Short');
    assert.equal(res.status, 422);
    assert.equal(res.json().error.code, 'validation_failed');
  } finally {
    await stopServer(server);
  }
});

test('Signup with invalid email returns 422', async () => {
  const { server } = createServer();
  const port = 9892;
  await startServer(server, port);
  try {
    await resetState(port, { users: [], restaurants: FIXTURE.restaurants });
    const res = await signup(port, 'not-an-email', 'password123', 'Bad');
    assert.equal(res.status, 422);
  } finally {
    await stopServer(server);
  }
});

test('Login with correct password returns 200 and token', async () => {
  const { server } = createServer();
  const port = 9893;
  await startServer(server, port);
  try {
    await resetState(port, FIXTURE);
    const res = await login(port, 'ada@example.com', 'correct horse');
    assert.equal(res.status, 200);
    const body = res.json();
    assert.ok(body.token);
    assert.equal(body.user_id, 'u_ada');
    assert.equal(body.display_name, 'Ada');
  } finally {
    await stopServer(server);
  }
});

test('Login with wrong password returns 401', async () => {
  const { server } = createServer();
  const port = 9894;
  await startServer(server, port);
  try {
    await resetState(port, FIXTURE);
    const res = await login(port, 'ada@example.com', 'wrong password');
    assert.equal(res.status, 401);
    assert.equal(res.json().error.code, 'unauthenticated');
  } finally {
    await stopServer(server);
  }
});

test('Login with unknown email returns 401', async () => {
  const { server } = createServer();
  const port = 9895;
  await startServer(server, port);
  try {
    await resetState(port, FIXTURE);
    const res = await login(port, 'nobody@example.com', 'anything');
    assert.equal(res.status, 401);
  } finally {
    await stopServer(server);
  }
});

test('Missing Authorization header returns 401', async () => {
  const { server } = createServer();
  const port = 9896;
  await startServer(server, port);
  try {
    const res = await request(port, '/reservations');
    assert.equal(res.status, 401);
  } finally {
    await stopServer(server);
  }
});

test('Unknown Bearer token returns 401', async () => {
  const { server } = createServer();
  const port = 9897;
  await startServer(server, port);
  try {
    const res = await request(port, '/reservations', {
      headers: authHeaders('nonexistent-token')
    });
    assert.equal(res.status, 401);
  } finally {
    await stopServer(server);
  }
});

test('GET /restaurants returns list', async () => {
  const { server } = createServer();
  const port = 9898;
  await startServer(server, port);
  try {
    await resetState(port, FIXTURE);
    const res = await request(port, '/restaurants');
    assert.equal(res.status, 200);
    const body = res.json();
    assert.ok(body.restaurants);
    assert.equal(body.restaurants.length, 3);
    for (const r of body.restaurants) {
      assert.ok(r.id);
      assert.ok(r.name);
      assert.ok(r.timezone);
    }
  } finally {
    await stopServer(server);
  }
});

test('GET /restaurants/{id} returns fixture shape', async () => {
  const { server } = createServer();
  const port = 9899;
  await startServer(server, port);
  try {
    await resetState(port, FIXTURE);
    const res = await request(port, '/restaurants/r_anker');
    assert.equal(res.status, 200);
    const body = res.json();
    assert.equal(body.id, 'r_anker');
    assert.equal(body.name, 'Zum Anker');
    assert.equal(body.timezone, 'Europe/Berlin');
    assert.ok(body.slot_minutes);
    assert.ok(body.reservation_duration_minutes);
    assert.ok(body.cancellation_cutoff_minutes);
    assert.ok(Array.isArray(body.tables));
    assert.ok(Array.isArray(body.opening_hours));
  } finally {
    await stopServer(server);
  }
});

test('GET /restaurants/{id} unknown returns 404', async () => {
  const { server } = createServer();
  const port = 9900;
  await startServer(server, port);
  try {
    await resetState(port, FIXTURE);
    const res = await request(port, '/restaurants/nonexistent');
    assert.equal(res.status, 404);
  } finally {
    await stopServer(server);
  }
});

test('GET /availability with valid params returns slots', async () => {
  const { server } = createServer();
  const port = 9901;
  await startServer(server, port);
  try {
    await resetState(port, FIXTURE);
    // 2026-03-23 is a Monday
    const res = await request(port, '/availability?restaurant_id=r_anker&date=2026-03-23&party_size=4');
    assert.equal(res.status, 200);
    const body = res.json();
    assert.equal(body.restaurant_id, 'r_anker');
    assert.equal(body.date, '2026-03-23');
    assert.equal(body.timezone, 'Europe/Berlin');
    assert.ok(Array.isArray(body.slots));
    assert.ok(body.slots.length > 0);
    for (const slot of body.slots) {
      assert.ok(slot.starts_at_local);
      assert.ok(slot.starts_at);
      assert.ok(Array.isArray(slot.available_table_ids));
    }
  } finally {
    await stopServer(server);
  }
});

test('GET /availability missing param returns 422', async () => {
  const { server } = createServer();
  const port = 9902;
  await startServer(server, port);
  try {
    await resetState(port, FIXTURE);
    const res = await request(port, '/availability?restaurant_id=r_anker&date=2026-03-23');
    assert.equal(res.status, 422);
    assert.equal(res.json().error.code, 'validation_failed');
  } finally {
    await stopServer(server);
  }
});

test('GET /availability unknown restaurant returns 404', async () => {
  const { server } = createServer();
  const port = 9903;
  await startServer(server, port);
  try {
    await resetState(port, FIXTURE);
    const res = await request(port, '/availability?restaurant_id=unknown&date=2026-03-23&party_size=2');
    assert.equal(res.status, 404);
  } finally {
    await stopServer(server);
  }
});

test('GET /availability closed day returns empty slots', async () => {
  const { server } = createServer();
  const port = 9904;
  await startServer(server, port);
  try {
    await resetState(port, FIXTURE);
    // r_ny only has opening hours on Monday; use a Sunday
    const res = await request(port, '/availability?restaurant_id=r_ny&date=2026-03-22&party_size=2');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json().slots, []);
  } finally {
    await stopServer(server);
  }
});

test('GET /availability party_size=0 returns 422', async () => {
  const { server } = createServer();
  const port = 9905;
  await startServer(server, port);
  try {
    await resetState(port, FIXTURE);
    const res = await request(port, '/availability?restaurant_id=r_anker&date=2026-03-23&party_size=0');
    assert.equal(res.status, 422);
  } finally {
    await stopServer(server);
  }
});
