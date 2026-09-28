'use strict';

const { hashPassword, verifyPassword, isStoredHash,
  genToken, genReservationId, genReference } = require('./auth');
const tz = require('./tz');

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS = new Set(['mon','tue','wed','thu','fri','sat','sun']);

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validInt(v, lo, hi) {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) return false;
  return true;
}

function validId(id) {
  return typeof id === 'string' && id.length >= 1 && id.length <= 64;
}

class ValidationError extends Error {
  constructor(code, status = 422) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function validateRestaurant(r) {
  if (!isPlainObject(r) || !validId(r.id)) return new ValidationError('validation_failed');
  if (typeof r.name !== 'string' || !r.name) return new ValidationError('validation_failed');
  if (!r.timezone || !Intl.supportedValuesOf('timeZone').includes(r.timezone)) return new ValidationError('validation_failed');
  if (!validInt(r.slot_minutes, 1, 1440)) return new ValidationError('validation_failed');
  if (!validInt(r.reservation_duration_minutes, 1, 1440)) return new ValidationError('validation_failed');
  if (!validInt(r.cancellation_cutoff_minutes, 0, 10080)) return new ValidationError('validation_failed');
  const seen = new Set();
  for (const t of (r.tables || [])) {
    if (!isPlainObject(t) || !validId(t.id) || seen.has(t.id)) return new ValidationError('validation_failed');
    seen.add(t.id);
    if (typeof t.label !== 'string') return new ValidationError('validation_failed');
    if (!validInt(t.capacity, 1, 100)) return new ValidationError('validation_failed');
  }
  const wds = new Set();
  for (const h of (r.opening_hours || [])) {
    if (!WEEKDAYS.has(h.weekday) || wds.has(h.weekday)) return new ValidationError('validation_failed');
    wds.add(h.weekday);
    if (!HHMM_RE.test(h.opens) || !HHMM_RE.test(h.closes)) return new ValidationError('validation_failed');
    if (h.closes <= h.opens) return new ValidationError('validation_failed');
  }
  return null;
}

function validateReservation(r, restById, strict) {
  if (!strict) return null;
  if (!isPlainObject(r)) return new ValidationError('validation_failed');
  if (!tz.validReference(r.reference)) return new ValidationError('validation_failed');
  if (!r.id || !validId(r.id)) return new ValidationError('validation_failed');
  if (!r.user_id || !validId(r.user_id)) return new ValidationError('validation_failed');
  if (!r.restaurant_id || !restById.has(r.restaurant_id)) return new ValidationError('validation_failed');
  if (r.table_id && !validId(r.table_id)) return new ValidationError('validation_failed');
  if (!r.starts_at_local || !/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.test(r.starts_at_local)) return new ValidationError('validation_failed');
  if (!validInt(r.party_size, 1, Infinity)) return new ValidationError('validation_failed');
  if (r.status && r.status !== 'confirmed' && r.status !== 'cancelled') return new ValidationError('validation_failed');
  return null;
}

function normalizeRestaurant(r) {
  const tables = (r.tables || []).map(t => ({ id: t.id, label: t.label, capacity: t.capacity }));
  return {
    id: r.id, name: r.name, fixture: r,
    timezone: r.timezone,
    slot_minutes: r.slot_minutes,
    reservation_duration_minutes: r.reservation_duration_minutes,
    cancellation_cutoff_minutes: r.cancellation_cutoff_minutes,
    opening_hours: r.opening_hours || [],
    tables,
    combinable: r.combinable || [],
    manager_user_ids: r.manager_user_ids || []
  };
}

function loadFixture(state, fixture) {
  if (!isPlainObject(fixture)) throw new ValidationError('malformed_request', 400);

  // Validate all users first
  const userIds = new Set();
  for (const u of (fixture.users || [])) {
    if (!isPlainObject(u)) throw new ValidationError('validation_failed');
    if (!u.id || !validId(u.id)) throw new ValidationError('validation_failed');
    if (userIds.has(u.id)) throw new ValidationError('validation_failed');
    userIds.add(u.id);
    if (!u.email || !EMAIL_RE.test(u.email)) throw new ValidationError('validation_failed');
    if (!u.password || typeof u.password !== 'string' || u.password.length < 8) throw new ValidationError('validation_failed');
  }

  // Validate all restaurants first
  const restById = new Map();
  for (const r of (fixture.restaurants || [])) {
    const v = validateRestaurant(r);
    if (v) throw v;
    if (restById.has(r.id)) throw new ValidationError('validation_failed');
    restById.set(r.id, r);
  }

  // Validate all reservations first
  for (const res of (fixture.reservations || [])) {
    const v = validateReservation(res, restById, true);
    if (v) throw v;
  }

  // All validation passed - clear and load
  state.clear();
  for (const u of (fixture.users || [])) {
    const hashed = isStoredHash(u.password) ? u.password : hashPassword(u.password);
    state.users.set(u.id, { id: u.id, email: u.email, password: hashed, display_name: u.display_name });
    state.emailIndex.set(u.email, u.id);
  }
  for (const r of (fixture.restaurants || [])) {
    const norm = normalizeRestaurant(r);
    state.restaurants.set(norm.id, norm);
    for (const t of norm.tables) state.tables.set(t.id, { id: t.id, resto: norm.id });
  }
  for (const res of (fixture.reservations || [])) {
    const rec = {
      id: res.id || genReservationId(),
      reference: res.reference,
      user_id: res.user_id,
      restaurant_id: res.restaurant_id,
      table_id: res.table_id || null,
      table_ids: res.table_ids || (res.table_id ? [res.table_id] : []),
      starts_at_local: res.starts_at_local,
      starts_at: res.starts_at,
      ends_at: res.ends_at,
      party_size: res.party_size,
      status: res.status || 'confirmed',
      created_at: res.created_at || res.starts_at,
      starts_at_instant: res.starts_at_instant,
      ends_at_instant: res.ends_at_instant
    };
    state.reservations.set(rec.reference, rec);
    state.reservationIds.set(rec.id, rec);
    state.references.add(rec.reference);
  }
  return null;
}

class State {
  constructor() {
    this.clear();
  }

  clear() {
    this.users = new Map();
    this.emailIndex = new Map();
    this.tokens = new Map();
    this.restaurants = new Map();
    this.tables = new Map();
    this.reservations = new Map();
    this.reservationIds = new Map();
    this.references = new Set();
    this.idem = new Map();
  }

  reset(fixture) {
    return loadFixture(this, fixture);
  }

  getUserByToken(token) {
    return token ? this.users.get(this.tokens.get(token)) : undefined;
  }

  getUserById(id) {
    return this.users.get(id);
  }

  getUserByEmail(email) {
    return this.users.get(this.emailIndex.get(email));
  }

  restaurantTable(rid, tableId) {
    const resto = this.restaurants.get(rid);
    if (!resto) return null;
    const t = resto.tables.find(t => t.id === tableId);
    return t ? { resto, table: t } : null;
  }

  tableOccupied(restaurantId, tableIds, startInstant, endInstant) {
    for (const r of this.reservations.values()) {
      if (r.restaurant_id !== restaurantId || r.status !== 'confirmed') continue;
      const rTables = r.table_ids || (r.table_id ? [r.table_id] : null);
      if (!rTables) continue;
      let overlap = false;
      for (const rt of rTables) {
        if (tableIds.has(rt)) { overlap = true; break; }
      }
      if (overlap && tz.overlaps(startInstant, endInstant, r.starts_at_instant, r.ends_at_instant)) return true;
    }
    return false;
  }

  createReference() {
    return genReference(this.references);
  }

  genId() {
    return genReservationId();
  }

  export() {
    const users = [];
    for (const u of this.users.values()) users.push({ id: u.id, email: u.email, password_hash: u.password, display_name: u.display_name });
    const tokens = [];
    for (const [tok, uid] of this.tokens) tokens.push({ token: tok, user_id: uid });
    const restaurants = [];
    for (const r of this.restaurants.values()) restaurants.push(r.fixture);
    const reservations = [];
    for (const r of this.reservations.values()) {
      reservations.push({
        id: r.id, reference: r.reference, user_id: r.user_id, restaurant_id: r.restaurant_id,
        table_id: r.table_id, table_ids: r.table_ids, starts_at_local: r.starts_at_local,
        starts_at: r.starts_at, ends_at: r.ends_at, party_size: r.party_size, status: r.status,
        created_at: r.created_at,
        starts_at_instant: r.starts_at_instant, ends_at_instant: r.ends_at_instant
      });
    }
    const idem = [];
    for (const [key, rec] of this.idem.entries()) idem.push({ key, body: rec.body, status: rec.status, response: rec.response });
    return { track: 'tablekeeper', format_version: 1, state: { users, tokens, restaurants, reservations, idem } };
  }

  importState(obj) {
    if (!isPlainObject(obj) || obj.track !== 'tablekeeper' || obj.format_version !== 1 ||
        !isPlainObject(obj.state)) throw new ValidationError('validation_failed');

    const s = obj.state;
    const users = Array.isArray(s.users) ? s.users : [];
    const tokens = Array.isArray(s.tokens) ? s.tokens : [];
    const restaurants = Array.isArray(s.restaurants) ? s.restaurants : [];
    const reservations = Array.isArray(s.reservations) ? s.reservations : [];
    const idemIn = Array.isArray(s.idem) ? s.idem : [];

    // Validate before clearing
    const userIds = new Set();
    for (const u of users) {
      if (!isPlainObject(u) || !validId(u.id)) throw new ValidationError('validation_failed');
      if (userIds.has(u.id)) throw new ValidationError('validation_failed');
      userIds.add(u.id);
      if (typeof u.email !== 'string' || !EMAIL_RE.test(u.email)) throw new ValidationError('validation_failed');
    }
    const restById = new Map();
    for (const r of restaurants) {
      const v = validateRestaurant(r);
      if (v) throw v;
      if (restById.has(r.id)) throw new ValidationError('validation_failed');
      restById.set(r.id, r);
    }
    for (const res of reservations) {
      const v = validateReservation(res, restById, true);
      if (v) throw v;
    }

    this.clear();
    for (const u of users) {
      const ph = u.password_hash && isStoredHash(u.password_hash) ? u.password_hash :
                 u.password && isStoredHash(u.password) ? u.password : hashPassword(u.password || 'x');
      this.users.set(u.id, { id: u.id, email: u.email, password: ph, display_name: u.display_name });
      this.emailIndex.set(u.email, u.id);
    }
    for (const t of (tokens || [])) {
      if (t && typeof t.token === 'string' && typeof t.user_id === 'string' && userIds.has(t.user_id)) {
        this.tokens.set(t.token, t.user_id);
      }
    }
    for (const r of restaurants) {
      const norm = normalizeRestaurant(r);
      this.restaurants.set(norm.id, norm);
      for (const t of norm.tables) this.tables.set(t.id, { id: t.id, resto: norm.id });
    }
    for (const res of reservations) {
      const rec = {
        id: res.id || genReservationId(),
        reference: res.reference,
        user_id: res.user_id,
        restaurant_id: res.restaurant_id,
        table_id: res.table_id || null,
        table_ids: res.table_ids || (res.table_id ? [res.table_id] : []),
        starts_at_local: res.starts_at_local,
        starts_at: res.starts_at,
        ends_at: res.ends_at,
        party_size: res.party_size,
        status: res.status || 'confirmed',
        created_at: res.created_at || res.starts_at,
        starts_at_instant: res.starts_at_instant,
        ends_at_instant: res.ends_at_instant
      };
      this.reservations.set(rec.reference, rec);
      this.reservationIds.set(rec.id, rec);
      this.references.add(rec.reference);
    }
    for (const d of idemIn) {
      if (d && typeof d.key === 'string' && isPlainObject(d.body) && isPlainObject(d.response)) {
        this.idem.set(d.key, { body: d.body, status: d.status, response: d.response });
      }
    }
  }
}

module.exports = { State, ValidationError, loadFixture, normalizeRestaurant, validId, EMAIL_RE, HHMM_RE, isPlainObject };
