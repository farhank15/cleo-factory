'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createServer, startServer, stopServer, request,
  resetState, login, authHeaders, FIXTURE
} = require('./helper');

const DATE = '2026-03-23';

test('50-way concurrency: same slot, exactly one wins, rest get 409', async () => {
  const { server } = createServer();
  const port = 9933;
  await startServer(server, port);
  try {
    await resetState(port, FIXTURE);
    const loginRes = await login(port, 'ada@example.com', 'correct horse');
    const token = loginRes.json().token;

    const headers = authHeaders(token);
    const body = JSON.stringify({
      restaurant_id: 'r_anker', table_id: 't1',
      starts_at_local: `${DATE}T10:00`, party_size: 4
    });

    const requests = [];
    for (let i = 0; i < 50; i++) {
      requests.push(request(port, '/reservations', {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': `burst-${i}` },
        body
      }));
    }
    const results = await Promise.all(requests);
    const statuses = results.map(r => r.status);
    const count201 = statuses.filter(s => s === 201).length;
    const count409 = statuses.filter(s => s === 409).length;
    const count5xx = statuses.filter(s => s >= 500).length;

    assert.equal(count201, 1, `expected exactly 1×201, got ${count201}`);
    assert.equal(count409, 49, `expected exactly 49×409, got ${count409}`);
    assert.equal(count5xx, 0, `expected 0×5xx, got ${count5xx}`);
  } finally {
    await stopServer(server);
  }
});

test('50-way concurrency: same idempotency key+body, one 201 rest 200', async () => {
  const { server } = createServer();
  const port = 9934;
  await startServer(server, port);
  try {
    await resetState(port, FIXTURE);
    const loginRes = await login(port, 'ada@example.com', 'correct horse');
    const token = loginRes.json().token;

    const body = JSON.stringify({
      restaurant_id: 'r_anker', table_id: 't2',
      starts_at_local: `${DATE}T10:00`, party_size: 2
    });

    const requests = [];
    for (let i = 0; i < 50; i++) {
      requests.push(request(port, '/reservations', {
        method: 'POST',
        headers: { ...authHeaders(token), 'Idempotency-Key': 'idem-burst' },
        body
      }));
    }
    const results = await Promise.all(requests);
    const statuses = results.map(r => r.status);
    const count201 = statuses.filter(s => s === 201).length;
    const count200 = statuses.filter(s => s === 200).length;
    const count5xx = statuses.filter(s => s >= 500).length;

    assert.equal(count201, 1, `expected exactly 1×201, got ${count201}`);
    assert.equal(count200, 49, `expected 49×200, got ${count200}`);
    assert.equal(count5xx, 0, `expected 0×5xx, got ${count5xx}`);
  } finally {
    await stopServer(server);
  }
});

test('50-way concurrency: all 5xx-free across different slots', async () => {
  const { server } = createServer();
  const port = 9935;
  await startServer(server, port);
  try {
    await resetState(port, FIXTURE);
    const loginRes = await login(port, 'ada@example.com', 'correct horse');
    const token = loginRes.json().token;

    const slots = ['10:00', '10:30', '11:00', '11:30', '12:00'];
    const requests = [];
    for (let i = 0; i < 50; i++) {
      const slot = slots[i % slots.length];
      requests.push(request(port, '/reservations', {
        method: 'POST',
        headers: { ...authHeaders(token), 'Idempotency-Key': `multi-${i}` },
        body: JSON.stringify({
          restaurant_id: 'r_ny', table_id: 't1',
          starts_at_local: `${DATE}T${slot}`, party_size: 2
        })
      }));
    }
    const results = await Promise.all(requests);
    const count5xx = results.filter(r => r.status >= 500).length;
    assert.equal(count5xx, 0, `expected 0×5xx, got ${count5xx}`);

    // Verify only 5 reservations created (one per slot, since they all share t1)
    const booked = results.filter(r => r.status === 201);
    assert.equal(booked.length, 5, `expected 5 bookings, got ${booked.length}`);
  } finally {
    await stopServer(server);
  }
});
