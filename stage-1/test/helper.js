'use strict';

const http = require('http');
const { makeApp } = require('../src/app');

const FIXTURE = {
  users: [
    { id: 'u_ada', email: 'ada@example.com', password: 'correct horse', display_name: 'Ada' },
    { id: 'u_bob', email: 'bob@example.com', password: 'battery staple', display_name: 'Bob' }
  ],
  restaurants: [
    {
      id: 'r_anker',
      name: 'Zum Anker',
      timezone: 'Europe/Berlin',
      slot_minutes: 30,
      reservation_duration_minutes: 90,
      cancellation_cutoff_minutes: 60,
      tables: [
        { id: 't1', label: 'Tisch 1', capacity: 4 },
        { id: 't2', label: 'Tisch 2', capacity: 2 },
        { id: 't3', label: 'Tisch 3', capacity: 6 }
      ],
      opening_hours: [
        { weekday: 'mon', opens: '10:00', closes: '22:00' },
        { weekday: 'tue', opens: '10:00', closes: '22:00' },
        { weekday: 'wed', opens: '10:00', closes: '22:00' },
        { weekday: 'thu', opens: '10:00', closes: '22:00' },
        { weekday: 'fri', opens: '10:00', closes: '23:00' },
        { weekday: 'sat', opens: '12:00', closes: '23:00' },
        { weekday: 'sun', opens: '12:00', closes: '22:00' }
      ]
    },
    {
      id: 'r_ny',
      name: 'NYC Diner',
      timezone: 'America/New_York',
      slot_minutes: 30,
      reservation_duration_minutes: 60,
      cancellation_cutoff_minutes: 30,
      tables: [
        { id: 't1', label: 'Counter', capacity: 2 }
      ],
      opening_hours: [
        { weekday: 'mon', opens: '08:00', closes: '22:00' }
      ]
    },
    {
      id: 'r_utc',
      name: 'UTC Cafe',
      timezone: 'UTC',
      slot_minutes: 60,
      reservation_duration_minutes: 60,
      cancellation_cutoff_minutes: 60,
      tables: [
        { id: 't1', label: 'Table 1', capacity: 4 }
      ],
      opening_hours: [
        { weekday: 'mon', opens: '09:00', closes: '17:00' }
      ]
    }
  ],
  reservations: []
};

function createServer() {
  const { server, state } = makeApp();
  return { server, state };
}

function startServer(server, port) {
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve());
  });
}

function stopServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function request(port, path, opts = {}) {
  return new Promise((resolve, reject) => {
    const headers = Object.assign({}, opts.headers || {});
    if (opts.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
    }
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: opts.method || 'GET',
      headers
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: data,
          headers: res.headers,
          json: () => {
            if (!data) return null;
            try { return JSON.parse(data); } catch (e) { return null; }
          }
        });
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function resetState(port, fixture) {
  return request(port, '/_test/reset', {
    method: 'POST',
    body: JSON.stringify(fixture || FIXTURE)
  });
}

function login(port, email, password) {
  return request(port, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
}

function signup(port, email, password, displayName) {
  return request(port, '/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, display_name: displayName })
  });
}

function authHeaders(token) {
  return { Authorization: 'Bearer ' + token };
}

module.exports = {
  FIXTURE,
  createServer,
  startServer,
  stopServer,
  request,
  resetState,
  login,
  signup,
  authHeaders
};
