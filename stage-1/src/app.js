'use strict';

const http = require('http');
const crypto = require('crypto');
const { State, ValidationError } = require('./state');
const { hashPassword, verifyPassword, genToken } = require('./auth');
const tz = require('./tz');
const { isValidDate, resolveWall, formatInstant, slotGrid, overlaps, validReference } = tz;

const BODYLESS = new Set(['GET', 'DELETE', 'HEAD']);
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function statusCodeFor(code) {
  const m = {
    missing_idempotency_key: 400, malformed_request: 400, email_taken: 409,
    unauthenticated: 401, forbidden: 403, not_found: 404, idempotency_key_reuse: 409,
    validation_failed: 422, table_unavailable: 409, cutoff_passed: 409,
    reservation_cancelled: 409, combination_not_allowed: 422, party_exceeds_capacity: 422,
    not_on_slot_grid: 422, outside_opening_hours: 422, invalid_local_time: 422
  };
  return m[code] || 400;
}

function sendError(res, code, status) {
  const s = status || statusCodeFor(code);
  const json = JSON.stringify({ error: { code, message: code } });
  res.writeHead(s, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}
function send(res, status, body) {
  if (body === undefined) {
    res.writeHead(status, { 'Content-Length': '0' });
    res.end();
    return;
  }
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json)
  });
  res.end(json);
}

function readBody(req) {
  return new Promise(resolve => {
    let chunks = []; let len = 0; const limit = 10 * 1024 * 1024;
    req.on('data', c => { len += c.length; if (len <= limit) chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}
function parseBody(raw) {
  if (!raw || !raw.trim()) throw new ValidationError('malformed_request', 400);
  let v;
  try { v = JSON.parse(raw); } catch (e) { throw new ValidationError('malformed_request', 400); }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new ValidationError('malformed_request', 400);
  return v;
}
function tryJson(raw) {
  if (!raw || !raw.trim()) return null;
  try { return JSON.parse(raw); } catch (e) { return undefined; }
}

function canonical(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonical).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
}

function idemKey(userId, path, key) { return `${userId}::${path}::${String(key)}`; }

function authUser(req, state) {
  const hdr = req.headers.authorization;
  if (!hdr || !hdr.startsWith('Bearer ')) return null;
  const token = hdr.slice(7).trim();
  if (!token) return null;
  return state.getUserByToken(token) || null;
}

function parseQuery(u) {
  const url = new URL(u, 'http://127.0.0.1');
  const o = {};
  for (const [k, v] of url.searchParams) o[k] = v;
  return o;
}

function partySizeValue(v) {
  if (typeof v === 'string' || typeof v === 'boolean') return { code: 'validation_failed', status: 422 };
  if (typeof v === 'number') {
    return (Number.isInteger(v) && v >= 1) ? { value: v } : { code: 'validation_failed', status: 422 };
  }
  return { code: 'validation_failed', status: 422 };
}

function resolveStartsAt(startsAtLocal, resto) {
  if (typeof startsAtLocal !== 'string') return { err: { code: 'malformed_request', status: 400 } };
  const m = LOCAL_RE.exec(startsAtLocal);
  if (!m) return { err: { code: 'validation_failed', status: 422 } };
  const [, Y, Mo, D, h, mi] = m;
  if (!isValidDate(`${Y}-${Mo}-${D}`)) return { err: { code: 'validation_failed', status: 422 } };
  const rs = resolveWall(`${Y}-${Mo}-${D}`, `${h}:${mi}`, resto.timezone);
  if (!rs.ok) return { err: { code: 'invalid_local_time', status: 422 } };

  const hours = resto.opening_hours.filter(en => en.weekday === tz.weekdayOf(`${Y}-${Mo}-${D}`));
  let inHours = false;
  for (const en of hours) {
    const o = resolveWall(`${Y}-${Mo}-${D}`, en.opens, resto.timezone);
    const c = resolveWall(`${Y}-${Mo}-${D}`, en.closes, resto.timezone);
    if (o.ok && c.ok && rs.instant >= o.instant &&
        rs.instant + resto.reservation_duration_minutes * 60000 <= c.instant) { inHours = true; break; }
  }
  if (!inHours) return { err: { code: 'outside_opening_hours', status: 422 } };

  const grid = slotGrid(resto, `${Y}-${Mo}-${D}`);
  if (!grid.some(g => g.starts_at_instant === rs.instant)) return { err: { code: 'not_on_slot_grid', status: 422 } };

  return { ok: true, instant: rs.instant, offset: rs.off, startsAt: formatInstant(rs.instant, resto.timezone) };
}

function overlapBooked(state, restaurantId, tableIds, startInstant, endInstant, excludeRefs) {
  const set = new Set(tableIds); excludeRefs = excludeRefs || new Set();
  for (const r of state.reservations.values()) {
    if (excludeRefs.has(r.reference)) continue;
    if (r.restaurant_id !== restaurantId || r.status !== 'confirmed') continue;
    const rTables = r.table_ids || (r.table_id ? [r.table_id] : null);
    if (!rTables) continue;
    let any = false;
    for (const rt of rTables) if (set.has(rt)) { any = true; break; }
    if (any && overlaps(startInstant, endInstant, r.starts_at_instant, r.ends_at_instant)) return true;
  }
  return false;
}

function reservationResponse(r, resto) {
  return {
    reservation_id: r.id, reference: r.reference, restaurant_id: r.restaurant_id,
    table_id: r.table_id, party_size: r.party_size, status: r.status,
    starts_at_local: r.starts_at_local, starts_at: r.starts_at, ends_at: r.ends_at,
    created_at: r.created_at
  };
}

function genUserId() {
  return 'u_' + crypto.randomBytes(6).toString('hex');
}
function nowISO() {
  return formatInstant(Date.now(), 'UTC');
}

function makeApp(state) {
  state = state || new State();

  function isPublic(method, url) {
    const u = url.split('?')[0];
    if (u === '/health') return true;
    if (u === '/_test/reset' && method === 'POST') return true;
    if (u === '/_test/export' && method === 'GET') return true;
    if (u === '/_test/import' && method === 'POST') return true;
    if (u === '/auth/signup' && method === 'POST') return true;
    if (u === '/auth/login' && method === 'POST') return true;
    if (u === '/restaurants' && method === 'GET') return true;
    if (/^\/restaurants\/[^/]+$/.test(u) && method === 'GET') return true;
    if (u === '/availability' && method === 'GET') return true;
    return false;
  }

  const server = http.createServer(async (req, res) => {
    try { await handle(req, res); }
    catch (e) {
      if (e instanceof ValidationError) return sendError(res, e.code, e.status);
      console.error('REQERR', req.method, req.url, e && e.stack || e);
      sendError(res, 'internal_error', 500);
    }
  });
  server.on('clientError', () => {});
  return { server, state };

  async function handle(req, res) {
    const method = req.method;
    const parsed = new URL(req.url, 'http://127.0.0.1');
    const url = parsed.pathname;
    const raw = BODYLESS.has(method) ? null : await readBody(req);

    if (url === '/health') return send(res, 200, { status: 'ok' });
    if (url === '/_test/export') return send(res, 200, state.export());
    if (url === '/_test/reset') return handleReset(res, raw);
    if (url === '/_test/import') return handleImport(res, raw);
    if (url === '/auth/signup') return handleSignup(res, raw);
    if (url === '/auth/login') return handleLogin(res, raw);
    if (url === '/restaurants') return handleRestaurantsList(res);
    const rm = /^\/restaurants\/([^/]+)$/.exec(url);
    if (rm) return handleRestaurant(res, rm[1]);
    if (url === '/availability') return handleAvailability(req, res, parsed);

    const user = isPublic(method, req.url) ? null : authUser(req, state);
    if (user === null) return sendError(res, 'unauthenticated', 401);

    if (url === '/reservations' && method === 'POST') return handleCreateReservation(res, req, state, user, raw);
    if (url === '/reservations' && method === 'GET') return handleListReservations(res, user);
    const rv = /^\/reservations\/([^/]+)$/.exec(url);
    if (rv) {
      if (method === 'GET') return handleGetReservation(res, state, user, rv[1]);
      if (method === 'PATCH') return handlePatchReservation(res, raw, state, user, rv[1]);
    }
    const c = /^\/reservations\/([^/]+)\/cancel$/.exec(url);
    if (c && method === 'POST') return handleCancelReservation(res, state, user, c[1]);
    if (url === '/reservation-moves' && method === 'POST') return handleReservationMoves(res, req, state, user, raw);

    sendError(res, 'not_found', 404);

    function handleReset(res, raw) {
      const fixture = tryJson(raw);
      if (fixture === undefined) return sendError(res, 'malformed_request', 400);
      if (fixture === null || typeof fixture !== 'object' || Array.isArray(fixture)) return sendError(res, 'malformed_request', 400);
      try { state.reset(fixture); return send(res, 204, undefined); }
      catch (e) {
        if (e instanceof ValidationError) return sendError(res, e.code, e.status);
        console.error(e); return sendError(res, 'internal_error', 500);
      }
    }

    function handleImport(res, raw) {
      const body = tryJson(raw);
      if (body === undefined) return sendError(res, 'malformed_request', 400);
      if (!body || body.track !== 'tablekeeper' || body.format_version !== 1 || !body.state || typeof body.state !== 'object') return sendError(res, 'validation_failed', 422);
      try { state.importState(body); return send(res, 204, undefined); }
      catch (e) {
        if (e instanceof ValidationError) return sendError(res, e.code, e.status);
        console.error(e); return sendError(res, 'internal_error', 500);
      }
    }

    function handleSignup(res, raw) {
      let body;
      try { body = parseBody(raw); } catch (e) { return sendError(res, e.code, e.status); }
      const email = body.email, password = body.password, name = body.display_name;
      if (typeof email !== 'string' || typeof password !== 'string') return sendError(res, 'malformed_request', 400);
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return sendError(res, 'validation_failed', 422);
      if (!password || password.length < 8) return sendError(res, 'validation_failed', 422);
      if (state.getUserByEmail(email)) return sendError(res, 'email_taken', 409);
      const id = genUserId();
      const rec = { id, email, password: hashPassword(password), display_name: name || '' };
      state.users.set(id, rec); state.emailIndex.set(email, id);
      const token = genToken(); state.tokens.set(token, id);
      return send(res, 201, { user_id: id, display_name: rec.display_name, token });
    }

    function handleLogin(res, raw) {
      let body;
      try { body = parseBody(raw); } catch (e) { return sendError(res, e.code, e.status); }
      const email = body.email, password = body.password;
      if (typeof email !== 'string' || typeof password !== 'string') return sendError(res, 'malformed_request', 400);
      const user = state.getUserByEmail(email);
      if (!user || !verifyPassword(password, user.password)) return sendError(res, 'unauthenticated', 401);
      const token = genToken();
      state.tokens.set(token, user.id);
      return send(res, 200, { user_id: user.id, display_name: user.display_name, token });
    }

    function handleRestaurantsList(res) {
      const list = [];
      for (const r of state.restaurants.values()) list.push({ id: r.id, name: r.name, timezone: r.timezone });
      return send(res, 200, { restaurants: list });
    }
    function handleRestaurant(res, id) {
      const r = state.restaurants.get(id);
      if (!r) return sendError(res, 'not_found', 404);
      return send(res, 200, JSON.parse(JSON.stringify(r.fixture)));
    }

    function handleAvailability(req, res, parsed) {
      const q = parseQuery(req.url);
      if (q.restaurant_id === undefined || q.date === undefined || q.party_size === undefined) return sendError(res, 'validation_failed', 422);
      const resto = state.restaurants.get(q.restaurant_id);
      if (!resto) return sendError(res, 'not_found', 404);
      if (!isValidDate(q.date)) return sendError(res, 'validation_failed', 422);
      if (!/^\d+$/.test(q.party_size)) return sendError(res, 'validation_failed', 422);
      const party = parseInt(q.party_size, 10);
      if (party < 1) return sendError(res, 'validation_failed', 422);
      const grid = slotGrid(resto, q.date);
      const slots = grid.map(g => {
        const av = resto.tables.filter(t => t.capacity >= party &&
          !overlapBooked(state, resto.id, [t.id], g.starts_at_instant, g.ends_at_instant, null)).map(t => t.id);
        return { starts_at_local: g.starts_at_local, starts_at: g.starts_at, available_table_ids: av };
      });
      return send(res, 200, { restaurant_id: q.restaurant_id, date: q.date, timezone: resto.timezone, slots });
    }

    function handleCreateReservation(res, req, state, user, raw) {
      let body;
      try { body = parseBody(raw); } catch (e) { return sendError(res, e.code, e.status); }
      const key = req.headers['idempotency-key'];
      if (key === undefined || key === null || String(key) === '') return sendError(res, 'missing_idempotency_key', 400);
      if (typeof key !== 'string' || key.length > 255) return sendError(res, 'validation_failed', 422);

      const bodyCanon = canonical(JSON.parse(JSON.stringify(body)));
      const ikey = idemKey(user.id, 'POST /reservations', key);
      const existing = state.idem.get(ikey);
      if (existing) {
        if (existing.body === bodyCanon) return send(res, 200, existing.response);
        return sendError(res, 'idempotency_key_reuse', 409);
      }

      const result = buildReservation(state, user, body);
      if (!result.ok) return sendError(res, result.code, result.status);
      state.idem.set(ikey, { body: bodyCanon, status: 201, response: result.resp });
      return send(res, 201, result.resp);
    }

    function handleReservationMoves(res, req, state, user, raw) {
      let body;
      try { body = parseBody(raw); } catch (e) { return sendError(res, e.code, e.status); }
      const key = req.headers['idempotency-key'];
      if (key === undefined || key === null || String(key) === '') return sendError(res, 'missing_idempotency_key', 400);
      if (typeof key !== 'string' || key.length > 255) return sendError(res, 'validation_failed', 422);

      const bodyCanon = canonical(JSON.parse(JSON.stringify(body)));
      const ikey = idemKey(user.id, 'POST /reservation-moves', key);
      const existing = state.idem.get(ikey);
      if (existing) {
        if (existing.body === bodyCanon) return send(res, 200, existing.response);
        return sendError(res, 'idempotency_key_reuse', 409);
      }

      const result = executeMoves(state, user, body);
      if (!result.ok) return sendError(res, result.code, result.status);
      state.idem.set(ikey, { body: bodyCanon, status: 201, response: result.resp });
      return send(res, 201, result.resp);
    }

    function buildReservation(state, user, body) {
      const { restaurant_id, table_id, starts_at_local, party_size } = body;

      // Required field check
      if (restaurant_id === undefined || table_id === undefined ||
          starts_at_local === undefined || party_size === undefined) {
        return { ok: false, code: 'validation_failed', status: 422 };
      }

      const resto = state.restaurants.get(restaurant_id);
      if (!resto) return { ok: false, code: 'not_found', status: 404 };
      if (typeof table_id !== 'string') return { ok: false, code: 'not_found', status: 404 };
      const tinfo = resto.tables.find(t => t.id === table_id);
      if (!tinfo) return { ok: false, code: 'not_found', status: 404 };

      const ps = partySizeValue(party_size);
      if (!('value' in ps)) return { ok: false, code: ps.code, status: ps.status };
      if (ps.value > tinfo.capacity) return { ok: false, code: 'party_exceeds_capacity', status: 422 };

      const rs = resolveStartsAt(starts_at_local, resto);
      if (!rs.ok) return { ok: false, code: rs.err.code, status: rs.err.status };

      const endInstant = rs.instant + resto.reservation_duration_minutes * 60000;
      if (overlapBooked(state, resto.id, [tinfo.id], rs.instant, endInstant, null)) {
        return { ok: false, code: 'table_unavailable', status: 409 };
      }

      const ref = state.createReference();
      const rid = state.genId();
      const created = nowISO();
      const startsAt = formatInstant(rs.instant, resto.timezone);
      const endsAt = formatInstant(endInstant, resto.timezone);
      const rec = {
        id: rid, reference: ref, user_id: user.id, restaurant_id: resto.id,
        table_id: tinfo.id, table_ids: [tinfo.id],
        starts_at_local: starts_at_local, starts_at: startsAt, starts_at_instant: rs.instant,
        ends_at: endsAt, ends_at_instant: endInstant,
        party_size: ps.value, status: 'confirmed', created_at: created
      };
      state.reservations.set(ref, rec);
      state.reservationIds.set(rid, rec);
      state.references.add(ref);
      return { ok: true, resp: reservationResponse(rec, resto) };
    }

    function executeMoves(state, user, body) {
      const moves = body.moves;
      if (!Array.isArray(moves) || moves.length < 1 || moves.length > 8) {
        return { ok: false, code: 'validation_failed', status: 422 };
      }
      for (const m of moves) {
        if (typeof m !== 'object' || m === null) return { ok: false, code: 'validation_failed', status: 422 };
      }
      const refs = moves.map(m => m.reference);
      if (new Set(refs).size !== refs.length) return { ok: false, code: 'validation_failed', status: 422 };

      let firstResto = null;
      const plans = [];
      for (const m of moves) {
        const r = state.reservations.get(m.reference);
        if (!r || r.user_id !== user.id) return { ok: false, code: 'not_found', status: 404 };
        const resto = state.restaurants.get(r.restaurant_id);
        if (!resto) return { ok: false, code: 'not_found', status: 404 };
        if (!firstResto) firstResto = resto;
        else if (firstResto.id !== resto.id) return { ok: false, code: 'validation_failed', status: 422 };

        if (r.status === 'cancelled') return { ok: false, code: 'reservation_cancelled', status: 409 };
        if (Date.now() >= r.starts_at_instant - resto.cancellation_cutoff_minutes * 60000) {
          return { ok: false, code: 'cutoff_passed', status: 409 };
        }

        let tableId = m.table_id !== undefined ? m.table_id : r.table_id;
        let startsAtLocal = m.starts_at_local !== undefined ? m.starts_at_local : r.starts_at_local;
        let party = m.party_size !== undefined ? m.party_size : r.party_size;

        if (typeof tableId !== 'string') return { ok: false, code: 'not_found', status: 404 };
        const tinfo = resto.tables.find(t => t.id === tableId);
        if (!tinfo) return { ok: false, code: 'not_found', status: 404 };

        const ps = partySizeValue(party);
        if (!('value' in ps)) return { ok: false, code: ps.code, status: ps.status };
        if (ps.value > tinfo.capacity) return { ok: false, code: 'party_exceeds_capacity', status: 422 };

        const rs = resolveStartsAt(startsAtLocal, resto);
        if (!rs.ok) return { ok: false, code: rs.err.code, status: rs.err.status };

        const endInstant = rs.instant + resto.reservation_duration_minutes * 60000;
        plans.push({
          r, resto, tinfo, ps: ps.value,
          startsAtLocal, startsAt: formatInstant(rs.instant, resto.timezone),
          endsAt: formatInstant(endInstant, resto.timezone),
          instant: rs.instant, end: endInstant
        });
      }

      const exclude = new Set(moves.map(m => m.reference));
      for (const p of plans) {
        if (overlapBooked(state, p.resto.id, [p.tinfo.id], p.instant, p.end, exclude)) {
          return { ok: false, code: 'table_unavailable', status: 409 };
        }
      }
      for (let i = 0; i < plans.length; i++) {
        for (let j = i + 1; j < plans.length; j++) {
          const a = plans[i], b = plans[j];
          if (a.tinfo.id === b.tinfo.id) {
            if (overlaps(a.instant, a.end, b.instant, b.end)) {
              return { ok: false, code: 'table_unavailable', status: 409 };
            }
          }
        }
      }

      // Commit all changes atomically
      for (const p of plans) {
        p.r.table_id = p.tinfo.id;
        p.r.table_ids = [p.tinfo.id];
        p.r.party_size = p.ps;
        p.r.starts_at_local = p.startsAtLocal;
        p.r.starts_at = p.startsAt;
        p.r.ends_at = p.endsAt;
        p.r.starts_at_instant = p.instant;
        p.r.ends_at_instant = p.end;
      }

      const resp = {
        reservations: moves.map(m => {
          const r = state.reservations.get(m.reference);
          return reservationResponse(r, state.restaurants.get(r.restaurant_id));
        })
      };
      return { ok: true, resp };
    }

    function handleListReservations(res, user) {
      const mine = [];
      for (const r of state.reservations.values()) if (r.user_id === user.id) mine.push(r);
      mine.sort((a, b) => b.starts_at_instant - a.starts_at_instant);
      return send(res, 200, { reservations: mine.map(r => reservationResponse(r, state.restaurants.get(r.restaurant_id))) });
    }
    function handleGetReservation(res, state, user, reference) {
      if (!validReference(reference)) return sendError(res, 'not_found', 404);
      const r = state.reservations.get(reference);
      if (!r || r.user_id !== user.id) return sendError(res, 'not_found', 404);
      return send(res, 200, reservationResponse(r, state.restaurants.get(r.restaurant_id)));
    }
    function handleCancelReservation(res, state, user, reference) {
      if (!validReference(reference)) return sendError(res, 'not_found', 404);
      const r = state.reservations.get(reference);
      if (!r || r.user_id !== user.id) return sendError(res, 'not_found', 404);
      const resto = state.restaurants.get(r.restaurant_id);
      if (r.status === 'cancelled') return send(res, 200, reservationResponse(r, resto));
      if (Date.now() >= r.starts_at_instant - resto.cancellation_cutoff_minutes * 60000) return sendError(res, 'cutoff_passed', 409);
      r.status = 'cancelled';
      return send(res, 200, reservationResponse(r, resto));
    }
    function handlePatchReservation(res, raw, state, user, reference) {
      if (!validReference(reference)) return sendError(res, 'not_found', 404);
      let body;
      try { body = parseBody(raw); } catch (e) { return sendError(res, e.code, e.status); }
      const r = state.reservations.get(reference);
      if (!r || r.user_id !== user.id) return sendError(res, 'not_found', 404);
      const resto = state.restaurants.get(r.restaurant_id);
      if (r.status === 'cancelled') return sendError(res, 'reservation_cancelled', 409);
      if (Date.now() >= r.starts_at_instant - resto.cancellation_cutoff_minutes * 60000) return sendError(res, 'cutoff_passed', 409);
      const result = patchReservation(state, r, resto, body);
      if (!result.ok) return sendError(res, result.code, result.status);
      return send(res, 200, reservationResponse(r, resto));
    }

    function patchReservation(state, r, resto, body) {
      let tableId = body.table_id !== undefined ? body.table_id : r.table_id;
      let startsAtLocal = body.starts_at_local !== undefined ? body.starts_at_local : r.starts_at_local;
      let party = body.party_size !== undefined ? body.party_size : r.party_size;

      if (typeof tableId !== 'string') return { ok: false, code: 'not_found', status: 404 };
      const tinfo = resto.tables.find(t => t.id === tableId);
      if (!tinfo) return { ok: false, code: 'not_found', status: 404 };

      const ps = partySizeValue(party);
      if (!('value' in ps)) return { ok: false, code: ps.code, status: ps.status };
      if (ps.value > tinfo.capacity) return { ok: false, code: 'party_exceeds_capacity', status: 422 };

      if (typeof startsAtLocal !== 'string') return { ok: false, code: 'validation_failed', status: 422 };
      const rs = resolveStartsAt(startsAtLocal, resto);
      if (!rs.ok) return { ok: false, code: rs.err.code, status: rs.err.status };

      const endInstant = rs.instant + resto.reservation_duration_minutes * 60000;
      const exclude = new Set([r.reference]);
      if (overlapBooked(state, resto.id, [tinfo.id], rs.instant, endInstant, exclude)) {
        return { ok: false, code: 'table_unavailable', status: 409 };
      }

      r.table_id = tinfo.id; r.table_ids = [tinfo.id];
      r.starts_at_local = startsAtLocal;
      r.starts_at = formatInstant(rs.instant, resto.timezone);
      r.ends_at = formatInstant(endInstant, resto.timezone);
      r.starts_at_instant = rs.instant;
      r.ends_at_instant = endInstant;
      r.party_size = ps.value;
      return { ok: true };
    }
  }
}

module.exports = { makeApp, State, ValidationError };
