'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createServer, startServer, stopServer, request,
  resetState, login, authHeaders, FIXTURE
} = require('./helper');

async function setupAuth(port, fixture, email, password) {
  await resetState(port, fixture);
  const res = await login(port, email, password);
  assert.equal(res.status, 200);
  return res.json().token;
}

const DATE = '2026-10-12';

test('POST /reservations creates reservation (201)', async () => {
  const { server } = createServer();
  const port = 9906;
  await startServer(server, port);
  try {
    const token = await setupAuth(port, FIXTURE, 'ada@example.com', 'correct horse');
    const res = await request(port, '/reservations', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        restaurant_id: 'r_anker',
        table_id: 't1',
        starts_at_local: `${DATE}T10:00`,
        party_size: 4
      })
    });
    assert.equal(res.status, 201);
    const body = res.json();
    assert.ok(body.reservation_id);
    assert.ok(body.reference);
    assert.equal(body.restaurant_id, 'r_anker');
    assert.equal(body.table_id, 't1');
    assert.equal(body.party_size, 4);
    assert.equal(body.status, 'confirmed');
    assert.ok(body.starts_at_local);
    assert.ok(body.starts_at);
    assert.ok(body.ends_at);
    assert.ok(body.created_at);
  } finally {
    await stopServer(server);
  }
});

test('POST /reservations missing idempotency key returns 400', async () => {
  const { server } = createServer();
  const port = 9907;
  await startServer(server, port);
  try {
    const token = await setupAuth(port, FIXTURE, 'ada@example.com', 'correct horse');
    const res = await request(port, '/reservations', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        restaurant_id: 'r_anker',
        table_id: 't1',
        starts_at_local: `${DATE}T10:00`,
        party_size: 4
      })
    });
    assert.equal(res.status, 400);
    assert.equal(res.json().error.code, 'missing_idempotency_key');
  } finally {
    await stopServer(server);
  }
});

test('POST /reservations idempotency: same key+body returns 200 with same response', async () => {
  const { server } = createServer();
  const port = 9908;
  await startServer(server, port);
  try {
    const token = await setupAuth(port, FIXTURE, 'ada@example.com', 'correct horse');
    const body = JSON.stringify({
      restaurant_id: 'r_anker',
      table_id: 't1',
      starts_at_local: `${DATE}T10:00`,
      party_size: 4
    });
    const res1 = await request(port, '/reservations', {
      method: 'POST',
      headers: { ...authHeaders(token), 'Idempotency-Key': 'key-1' },
      body
    });
    assert.equal(res1.status, 201);

    const res2 = await request(port, '/reservations', {
      method: 'POST',
      headers: { ...authHeaders(token), 'Idempotency-Key': 'key-1' },
      body
    });
    assert.equal(res2.status, 200);
    assert.deepEqual(res2.json(), res1.json());
  } finally {
    await stopServer(server);
  }
});

test('POST /reservations idempotency: same key+different body returns 409', async () => {
  const { server } = createServer();
  const port = 9909;
  await startServer(server, port);
  try {
    const token = await setupAuth(port, FIXTURE, 'ada@example.com', 'correct horse');
    const res1 = await request(port, '/reservations', {
      method: 'POST',
      headers: { ...authHeaders(token), 'Idempotency-Key': 'key-2' },
      body: JSON.stringify({
        restaurant_id: 'r_anker', table_id: 't1',
        starts_at_local: `${DATE}T10:00`, party_size: 4
      })
    });
    assert.equal(res1.status, 201);

    const res2 = await request(port, '/reservations', {
      method: 'POST',
      headers: { ...authHeaders(token), 'Idempotency-Key': 'key-2' },
      body: JSON.stringify({
        restaurant_id: 'r_anker', table_id: 't1',
        starts_at_local: `${DATE}T11:00`, party_size: 4
      })
    });
    assert.equal(res2.status, 409);
    assert.equal(res2.json().error.code, 'idempotency_key_reuse');
  } finally {
    await stopServer(server);
  }
});

test('POST /reservations idempotency: failed request does not retain key', async () => {
  const { server } = createServer();
  const port = 9910;
  await startServer(server, port);
  try {
    const token = await setupAuth(port, FIXTURE, 'ada@example.com', 'correct horse');
    // First attempt: table unavailable (party too big for t3... actually t1 capacity is 4, try party 5)
    const res1 = await request(port, '/reservations', {
      method: 'POST',
      headers: { ...authHeaders(token), 'Idempotency-Key': 'key-3' },
      body: JSON.stringify({
        restaurant_id: 'r_anker', table_id: 't2', // t2 capacity=2
        starts_at_local: `${DATE}T10:00`, party_size: 4 // party 4 > capacity 2
      })
    });
    assert.equal(res1.status, 422);

    // Retry with corrected party_size should succeed (key not retained)
    const res2 = await request(port, '/reservations', {
      method: 'POST',
      headers: { ...authHeaders(token), 'Idempotency-Key': 'key-3' },
      body: JSON.stringify({
        restaurant_id: 'r_anker', table_id: 't2',
        starts_at_local: `${DATE}T10:00`, party_size: 2
      })
    });
    assert.equal(res2.status, 201);
  } finally {
    await stopServer(server);
  }
});

test('POST /reservations: unknown restaurant returns 404', async () => {
  const { server } = createServer();
  const port = 9911;
  await startServer(server, port);
  try {
    const token = await setupAuth(port, FIXTURE, 'ada@example.com', 'correct horse');
    const res = await request(port, '/reservations', {
      method: 'POST',
      headers: { ...authHeaders(token), 'Idempotency-Key': 'create-1' },
      body: JSON.stringify({
        restaurant_id: 'unknown', table_id: 't1',
        starts_at_local: `${DATE}T10:00`, party_size: 2
      })
    });
    assert.equal(res.status, 404);
  } finally {
    await stopServer(server);
  }
});

test('POST /reservations: party exceeds capacity returns 422', async () => {
  const { server } = createServer();
  const port = 9912;
  await startServer(server, port);
  try {
    const token = await setupAuth(port, FIXTURE, 'ada@example.com', 'correct horse');
    const res = await request(port, '/reservations', {
      method: 'POST',
      headers: { ...authHeaders(token), 'Idempotency-Key': 'key-5' },
      body: JSON.stringify({
        restaurant_id: 'r_anker', table_id: 't2', // capacity 2
        starts_at_local: `${DATE}T10:00`, party_size: 4
      })
    });
    assert.equal(res.status, 422);
    assert.equal(res.json().error.code, 'party_exceeds_capacity');
  } finally {
    await stopServer(server);
  }
});

test('POST /reservations: table unavailable (overlap) returns 409', async () => {
  const { server } = createServer();
  const port = 9913;
  await startServer(server, port);
  try {
    const token = await setupAuth(port, FIXTURE, 'ada@example.com', 'correct horse');
    // Book t1 10:00-11:30
    await request(port, '/reservations', {
      method: 'POST',
      headers: { ...authHeaders(token), 'Idempotency-Key': 'k-a' },
      body: JSON.stringify({
        restaurant_id: 'r_anker', table_id: 't1',
        starts_at_local: `${DATE}T10:00`, party_size: 4
      })
    });
    // Try to book t1 10:30-12:00 (overlaps)
    const res = await request(port, '/reservations', {
      method: 'POST',
      headers: { ...authHeaders(token), 'Idempotency-Key': 'k-b' },
      body: JSON.stringify({
        restaurant_id: 'r_anker', table_id: 't1',
        starts_at_local: `${DATE}T10:30`, party_size: 4
      })
    });
    assert.equal(res.status, 409);
    assert.equal(res.json().error.code, 'table_unavailable');
  } finally {
    await stopServer(server);
  }
});

test('POST /reservations: adjacent reservation (no overlap) succeeds', async () => {
  const { server } = createServer();
  const port = 9914;
  await startServer(server, port);
  try {
    const token = await setupAuth(port, FIXTURE, 'ada@example.com', 'correct horse');
    // Book t1 10:00-11:30
    await request(port, '/reservations', {
      method: 'POST',
      headers: { ...authHeaders(token), 'Idempotency-Key': 'k-c' },
      body: JSON.stringify({
        restaurant_id: 'r_anker', table_id: 't1',
        starts_at_local: `${DATE}T10:00`, party_size: 4
      })
    });
    // Book t1 11:30-13:00 (exactly adjacent, no overlap)
    const res = await request(port, '/reservations', {
      method: 'POST',
      headers: { ...authHeaders(token), 'Idempotency-Key': 'k-d' },
      body: JSON.stringify({
        restaurant_id: 'r_anker', table_id: 't1',
        starts_at_local: `${DATE}T11:30`, party_size: 4
      })
    });
    assert.equal(res.status, 201);
  } finally {
    await stopServer(server);
  }
});

test('GET /reservations returns caller\'s reservations', async () => {
  const { server } = createServer();
  const port = 9915;
  await startServer(server, port);
  try {
    const token = await setupAuth(port, FIXTURE, 'ada@example.com', 'correct horse');
    await request(port, '/reservations', {
      method: 'POST',
      headers: { ...authHeaders(token), 'Idempotency-Key': 'k-e' },
      body: JSON.stringify({
        restaurant_id: 'r_anker', table_id: 't1',
        starts_at_local: `${DATE}T10:00`, party_size: 4
      })
    });

    const res = await request(port, '/reservations', {
      headers: authHeaders(token)
    });
    assert.equal(res.status, 200);
    const body = res.json();
    assert.ok(Array.isArray(body.reservations));
    assert.equal(body.reservations.length, 1);
    assert.equal(body.reservations[0].reference, (await request(port, '/reservations', { headers: authHeaders(token) })).json().reservations[0].reference);
  } finally {
    await stopServer(server);
  }
});

test('GET /reservations/{reference} returns reservation', async () => {
  const { server } = createServer();
  const port = 9916;
  await startServer(server, port);
  try {
    const token = await setupAuth(port, FIXTURE, 'ada@example.com', 'correct horse');
    const res1 = await request(port, '/reservations', {
      method: 'POST',
      headers: { ...authHeaders(token), 'Idempotency-Key': 'k-f' },
      body: JSON.stringify({
        restaurant_id: 'r_anker', table_id: 't1',
        starts_at_local: `${DATE}T10:00`, party_size: 4
      })
    });
    const ref = res1.json().reference;

    const res2 = await request(port, `/reservations/${ref}`, {
      headers: authHeaders(token)
    });
    assert.equal(res2.status, 200);
    assert.equal(res2.json().reference, ref);
  } finally {
    await stopServer(server);
  }
});

test('GET /reservations/{reference} for other user returns 404', async () => {
  const { server } = createServer();
  const port = 9917;
  await startServer(server, port);
  try {
    const adaToken = await setupAuth(port, FIXTURE, 'ada@example.com', 'correct horse');
    const res1 = await request(port, '/reservations', {
      method: 'POST',
      headers: { ...authHeaders(adaToken), 'Idempotency-Key': 'k-g' },
      body: JSON.stringify({
        restaurant_id: 'r_anker', table_id: 't1',
        starts_at_local: `${DATE}T10:00`, party_size: 4
      })
    });
    const ref = res1.json().reference;

    // Bob logs in and tries to access Ada's reservation
    const bobRes = await login(port, 'bob@example.com', 'battery staple');
    const bobToken = bobRes.json().token;

    const res2 = await request(port, `/reservations/${ref}`, {
      headers: authHeaders(bobToken)
    });
    assert.equal(res2.status, 404);
  } finally {
    await stopServer(server);
  }
});

test('POST /reservations/{reference}/cancel returns 200', async () => {
  const { server } = createServer();
  const port = 9918;
  await startServer(server, port);
  try {
    const token = await setupAuth(port, FIXTURE, 'ada@example.com', 'correct horse');
    const res1 = await request(port, '/reservations', {
      method: 'POST',
      headers: { ...authHeaders(token), 'Idempotency-Key': 'k-h' },
      body: JSON.stringify({
        restaurant_id: 'r_anker', table_id: 't1',
        starts_at_local: `${DATE}T10:00`, party_size: 4
      })
    });
    const ref = res1.json().reference;

    const res2 = await request(port, `/reservations/${ref}/cancel`, {
      method: 'POST',
      headers: authHeaders(token)
    });
    assert.equal(res2.status, 200);
    assert.equal(res2.json().status, 'cancelled');

    // Cancel again should return 200
    const res3 = await request(port, `/reservations/${ref}/cancel`, {
      method: 'POST',
      headers: authHeaders(token)
    });
    assert.equal(res3.status, 200);
    assert.equal(res3.json().status, 'cancelled');
  } finally {
    await stopServer(server);
  }
});

test('POST /reservations/{reference}/cancel frees the table', async () => {
  const { server } = createServer();
  const port = 9919;
  await startServer(server, port);
  try {
    const token = await setupAuth(port, FIXTURE, 'ada@example.com', 'correct horse');
    // Book t1 10:00-11:30
    await request(port, '/reservations', {
      method: 'POST',
      headers: { ...authHeaders(token), 'Idempotency-Key': 'k-i' },
      body: JSON.stringify({
        restaurant_id: 'r_anker', table_id: 't1',
        starts_at_local: `${DATE}T10:00`, party_size: 4
      })
    });

    // Check t1 is booked at 10:30
    let avail = await request(port, `/availability?restaurant_id=r_anker&date=${DATE}&party_size=4`);
    let slot = avail.json().slots.find(s => s.starts_at_local === `${DATE}T10:30`);
    assert.ok(!slot.available_table_ids.includes('t1'));

    // Cancel
    const listRes = await request(port, '/reservations', { headers: authHeaders(token) });
    const ref = listRes.json().reservations[0].reference;
    await request(port, `/reservations/${ref}/cancel`, { method: 'POST', headers: authHeaders(token) });

    // Check t1 is now available at 10:30
    avail = await request(port, `/availability?restaurant_id=r_anker&date=${DATE}&party_size=4`);
    slot = avail.json().slots.find(s => s.starts_at_local === `${DATE}T10:30`);
    assert.ok(slot.available_table_ids.includes('t1'));
  } finally {
    await stopServer(server);
  }
});

test('PATCH /reservations/{reference} moves reservation', async () => {
  const { server } = createServer();
  const port = 9920;
  await startServer(server, port);
  try {
    const token = await setupAuth(port, FIXTURE, 'ada@example.com', 'correct horse');
    const res1 = await request(port, '/reservations', {
      method: 'POST',
      headers: { ...authHeaders(token), 'Idempotency-Key': 'k-j' },
      body: JSON.stringify({
        restaurant_id: 'r_anker', table_id: 't1',
        starts_at_local: `${DATE}T10:00`, party_size: 2
      })
    });
    const ref = res1.json().reference;

    const res2 = await request(port, `/reservations/${ref}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ starts_at_local: `${DATE}T11:00` })
    });
    assert.equal(res2.status, 200);
    assert.equal(res2.json().starts_at_local, `${DATE}T11:00`);
  } finally {
    await stopServer(server);
  }
});

test('PATCH /reservations/{reference} to unavailable table returns 409', async () => {
  const { server } = createServer();
  const port = 9921;
  await startServer(server, port);
  try {
    const token = await setupAuth(port, FIXTURE, 'ada@example.com', 'correct horse');
    const res1 = await request(port, '/reservations', {
      method: 'POST',
      headers: { ...authHeaders(token), 'Idempotency-Key': 'k-k' },
      body: JSON.stringify({
        restaurant_id: 'r_anker', table_id: 't1',
        starts_at_local: `${DATE}T10:00`, party_size: 4
      })
    });
    const ref = res1.json().reference;

    // Another booking at 11:00
    await request(port, '/reservations', {
      method: 'POST',
      headers: { ...authHeaders(token), 'Idempotency-Key': 'k-l' },
      body: JSON.stringify({
        restaurant_id: 'r_anker', table_id: 't1',
        starts_at_local: `${DATE}T11:00`, party_size: 4
      })
    });

    // Try to move first reservation to 11:00 -> conflict
    const res = await request(port, `/reservations/${ref}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ starts_at_local: `${DATE}T11:00` })
    });
    assert.equal(res.status, 409);
    assert.equal(res.json().error.code, 'table_unavailable');
  } finally {
    await stopServer(server);
  }
});
