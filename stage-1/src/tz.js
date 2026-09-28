'use strict';

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKDAY_LOOKUP = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };

const LOCAL_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RFC3339_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-])(\d{2}):(\d{2})$/;

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

let fmtCache = new Map();
function fmtFor(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    fmtCache.set(tz, f);
  }
  return f;
}

function partsFor(instant, tz) {
  const o = {};
  for (const p of fmtFor(tz).formatToParts(instant)) o[p.type] = p.value;
  return o;
}

// Offset (in minutes, + = east of UTC) of `tz` at absolute instant `instant`.
// Derived from wall parts vs. the instant so it never depends on the
// `timeZoneName` token shape ("GMT+02:00" vs "+02:00" vs named zones), which
// is not portable across ICU builds.
function offsetAt(instant, tz) {
  const o = partsFor(instant, tz);
  const wallMs = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute, +o.second);
  return (wallMs - instant) / 60000;
}

function wallParts(instant, tz) {
  const o = partsFor(instant, tz);
  return {
    Y: +o.year, Mo: +o.month, D: +o.day,
    hh: +o.hour, mm: +o.minute, ss: +o.second,
    off: offsetAt(instant, tz)
  };
}

function resolveWall(dateStr, timeStr, tz) {
  const dm = LOCAL_DATE_RE.exec(dateStr || '');
  if (!dm || !LOCAL_TIME_RE.test(`${dateStr || ''}T${timeStr || ''}`)) return { ok: false, bad: true };
  const y = +dm[1], mo = +dm[2], d = +dm[3];
  const tm = LOCAL_TIME_RE.exec(`${dateStr}T${timeStr}`);
  const h = +tm[4], mi = +tm[5];
  const utcGuess = Date.UTC(y, mo - 1, d, h, mi);
  const sampled = new Set();
  for (const k of [-240, -180, -120, -90, -60, -30, 0, 30, 60, 90, 120, 180, 240]) {
    sampled.add(offsetAt(utcGuess + k * 60000, tz));
  }
  const valid = [];
  for (const o of sampled) {
    const cand = utcGuess - o * 60000;
    const w = wallParts(cand, tz);
    if (w.hh === h && w.mm === mi && w.Y === y && w.Mo === mo && w.D === d && w.off === o) {
      valid.push({ instant: cand, off: o });
    }
  }
  if (valid.length === 0) return { ok: false, bad: false };
  valid.sort((a, b) => a.instant - b.instant);
  return { ok: true, instant: valid[0].instant, off: valid[0].off };
}

function formatInstant(instant, tz) {
  const w = wallParts(instant, tz);
  const sign = w.off >= 0 ? '+' : '-';
  const ao = Math.abs(w.off);
  return `${pad2(w.Y)}-${pad2(w.Mo)}-${pad2(w.D)}T${pad2(w.hh)}:${pad2(w.mm)}:${pad2(w.ss)}${sign}${pad2(Math.floor(ao / 60))}:${pad2(ao % 60)}`;
}

function hmFromInstant(instant, tz) {
  const w = wallParts(instant, tz);
  return `${pad2(w.hh)}:${pad2(w.mm)}`;
}

function weekdayOf(dateStr) {
  const m = LOCAL_DATE_RE.exec(dateStr || '');
  if (!m) return null;
  const js = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return WEEKDAYS[js.getUTCDay()];
}

function parseHhmm(str) {
  if (typeof str !== "string") return null;
  const m = /^([0-9]{2}):([0-9]{2})$/.exec(str);
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

function slotGrid(restaurant, dateStr) {
  const tz = restaurant.timezone;
  const step = restaurant.slot_minutes || 30;
  const dur = restaurant.reservation_duration_minutes || 90;
  const day = weekdayOf(dateStr);
  const entries = (restaurant.opening_hours || []).filter(h => h.weekday === day);
  const slots = [];
  const seen = new Set();
  for (const entry of entries) {
    const openMin = parseHhmm(entry.opens);
    const closeMin = parseHhmm(entry.closes);
    if (openMin == null || closeMin == null) continue;
    for (let m = openMin; m + dur <= closeMin; m += step) {
      const hh = pad2(Math.floor(m / 60));
      const mm = pad2(m % 60);
      const wall = `${hh}:${mm}`;
      if (seen.has(wall)) continue;
      const rs = resolveWall(dateStr, wall, tz);
      if (!rs.ok) continue;
      seen.add(wall);
      const endInstant = rs.instant + dur * 60000;
      slots.push({
        starts_at_local: `${dateStr}T${wall}`,
        starts_at: formatInstant(rs.instant, tz),
        starts_at_instant: rs.instant,
        ends_at_instant: endInstant,
        ends_at: formatInstant(endInstant, tz)
      });
    }
  }
  slots.sort((a, b) => a.starts_at_instant - b.starts_at_instant);
  return slots;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function isValidDate(dateStr) {
  const m = LOCAL_DATE_RE.exec(dateStr || '');
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  const js = new Date(Date.UTC(y, mo - 1, d));
  return js.getUTCFullYear() === y && js.getUTCMonth() + 1 === mo && js.getUTCDate() === d;
}

function parseRFC3339(s) {
  const m = RFC3339_RE.exec(s || '');
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], sec = +m[6];
  const sign = m[7] === '-' ? -1 : 1;
  const off = sign * (Number(m[8]) * 60 + Number(m[9]));
  return Date.UTC(y, mo - 1, d, h, mi, sec) - off * 60000;
}

const REFERENCE_RE = /^[A-Z0-9]{6,12}$/;
function validReference(ref) {
  return typeof ref === 'string' && REFERENCE_RE.test(ref);
}

const ID_RE = /^[\w.-]{1,64}$/;
function validId(id) {
  return typeof id === 'string' && ID_RE.test(id) && id.length <= 64;
}

module.exports = {
  WEEKDAYS, WEEKDAY_LOOKUP,
  offsetAt, wallParts, resolveWall, formatInstant, hmFromInstant,
  parseHhmm, slotGrid, weekdayOf, overlaps, isValidDate, parseRFC3339,
  validReference, validId, pad2
};
