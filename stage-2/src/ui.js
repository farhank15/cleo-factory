'use strict';

const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
  background: #faf7f2; color: #2d2b28; line-height: 1.5;
  padding: 2rem; max-width: 720px; margin: 0 auto;
}
@media (min-width: 768px) { body { padding: 2rem 3rem; } }
header { margin-bottom: 1.5rem; }
nav {
  display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
}
nav a { text-decoration: none; color: #8b3a2e; font-weight: 700; font-size: 1.25rem; }
nav span[data-testid="current-user"] { font-weight: 500; color: #5a4a42; }
nav button[data-testid="logout-button"] {
  margin-left: auto; background: #f4e9e4; color: #8b3a2e; border: 1px solid #e0cbc5;
  padding: 0.4rem 0.8rem; border-radius: 6px; cursor: pointer; font-size: 0.9rem;
}
nav button[data-testid="logout-button"]:hover { background: #e9d5cf; }
nav .separator { color: #ddd; margin: 0 0.5rem; }
.error {
  background: #fde3e3; border: 1px solid #f5b1b1; color: #8b2e2e;
  padding: 0.6rem 1rem; border-radius: 6px; margin: 0.5rem 0;
}
.form-row { margin-bottom: 0.75rem; }
.form-row label {
  display: block; font-size: 0.85rem; margin-bottom: 0.25rem; color: #5a4a42;
}
.form-row input, .form-row select {
  width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #d4c5bf;
  border-radius: 6px; font-size: 1rem;
}
.form-row input:focus, .form-row select:focus { outline: 2px solid #8b3a2e; outline-offset: 1px; }
.btn-primary {
  background: #8b3a2e; color: #fff; border: none; padding: 0.6rem 1.2rem;
  border-radius: 6px; font-size: 1rem; cursor: pointer; font-weight: 600;
}
.btn-primary:hover { background: #733126; }
.btn-primary:disabled { background: #c9b8b0; cursor: default; }
.btn-secondary {
  background: #f4e9e4; color: #8b3a2e; border: 1px solid #e0cbc5;
  padding: 0.5rem 1rem; border-radius: 6px; font-size: 0.9rem; cursor: pointer;
}
.btn-secondary:hover { background: #e9d5cf; }
.search-form { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 1rem; }
.search-form > div { flex: 1; min-width: 100px; }
.search-form button { flex-shrink: 0; }
.grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(60px, 1fr));
  gap: 4px; margin-bottom: 1rem;
}
.slot-cell {
  aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
  border: 1px solid #ddd; border-radius: 6px; font-size: 0.8rem;
  background: #fff; cursor: default;
}
.slot-cell.available { background: #e8f7f0; border-color: #4caf50; cursor: pointer; }
.slot-cell.available:hover { background: #d4f0e3; }
.slot-cell.unavailable { background: #fce8e6; border-color: #f5b1b1; cursor: not-allowed; }
.no-slots { padding: 1rem; text-align: center; color: #888; }
.booking-section, .confirmation-section { margin-top: 1rem; }
.booking-summary { font-weight: 600; margin-bottom: 0.5rem; color: #5a4a42; }
.booking-party-size { width: 60px; padding: 0.3rem; margin-bottom: 0.5rem; }
.confirmation { background: #e8f7f0; border: 1px solid #2e7d32; border-radius: 8px; padding: 1rem; }
.confirmation-reference { font-size: 1.5rem; font-weight: 700; color: #1b5e20; letter-spacing: 1px; }
.confirmation-details { margin-top: 0.5rem; color: #5a4a42; }
.reservation-detail { background: #f4e9e4; border-radius: 8px; padding: 1rem; margin-top: 0.5rem; }
.reservation-status { font-weight: 600; text-transform: capitalize; }
.h1-title { font-size: 1.5rem; color: #8b3a2e; margin-bottom: 1rem; }
@media (max-width: 600px) {
  body { padding: 1rem; }
  .search-form { flex-direction: column; }
  .grid { grid-template-columns: repeat(3, 1fr); }
}
`;

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' :
    c === '"' ? '&quot;' : '&#39;');
}

function navHtml() {
  return `<nav>
  <a href="/">Tablekeeper</a>
  <span data-testid="current-user"></span>
  <span class="separator" style="display:none">|</span>
  <button data-testid="logout-button" style="display:none">Logout</button>
</nav>`;
}

const JS = String.raw`(function() {
  'use strict';
  const TK_TOKEN = 'tablekeeper_token';
  const TK_NAME = 'tablekeeper_display_name';

  function getToken() { return localStorage.getItem(TK_TOKEN); }
  function setToken(t, n) { localStorage.setItem(TK_TOKEN, t); localStorage.setItem(TK_NAME, n || ''); }
  function clearToken() { localStorage.removeItem(TK_TOKEN); localStorage.removeItem(TK_NAME); }
  function authHeaders() { const t = getToken(); return t ? {'Authorization': 'Bearer ' + t} : {}; }

  function removeEl(sel) { const el = document.querySelector(sel); if (el) el.remove(); }

  function updateNav() {
    removeEl('span[data-testid="current-user"]');
    removeEl('button[data-testid="logout-button"]');
    removeEl('span.separator');
    const nav = document.querySelector('nav');
    if (!nav || !getToken()) return;

    const name = localStorage.getItem(TK_NAME) || '';
    const sep = document.createElement('span');
    sep.className = 'separator';
    sep.textContent = '|';
    sep.style.display = 'inline';
    nav.appendChild(sep);

    const u = document.createElement('span');
    u.setAttribute('data-testid', 'current-user');
    u.textContent = name;
    nav.appendChild(u);

    const lb = document.createElement('button');
    lb.setAttribute('data-testid', 'logout-button');
    lb.textContent = 'Logout';
    lb.style.display = 'inline';
    lb.addEventListener('click', function() {
      clearToken();
      removeEl('span[data-testid="current-user"]');
      removeEl('button[data-testid="logout-button"]');
      removeEl('span.separator');
    });
    nav.appendChild(lb);
  }

  // ---- Auth forms ----

  function handleSignup(e) {
    e.preventDefault();
    removeEl('[data-testid="auth-error"]');
    const form = e.target;
    const email = form.querySelector('[data-testid="signup-email"]').value;
    const password = form.querySelector('[data-testid="signup-password"]').value;
    const name = form.querySelector('[data-testid="signup-display-name"]').value;
    fetch('/auth/signup', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email: email, password: password, display_name: name})
    })
    .then(r => r.json())
    .then(data => {
      if (data.token) { setToken(data.token, data.display_name); updateNav(); }
      else { showAuthError(data.error && data.error.message || 'Signup failed'); }
    })
    .catch(() => showAuthError('Network error'));
  }

  function handleLogin(e) {
    e.preventDefault();
    removeEl('[data-testid="auth-error"]');
    const form = e.target;
    const email = form.querySelector('[data-testid="login-email"]').value;
    const password = form.querySelector('[data-testid="login-password"]').value;
    fetch('/auth/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email: email, password: password})
    })
    .then(r => r.json())
    .then(data => {
      if (data.token) { setToken(data.token, data.display_name); updateNav(); }
      else { showAuthError(data.error && data.error.message || 'Login failed'); }
    })
    .catch(() => showAuthError('Network error'));
  }

  function showAuthError(message) {
    removeEl('[data-testid="auth-error"]');
    const el = document.createElement('div');
    el.setAttribute('data-testid', 'auth-error');
    el.className = 'error';
    el.textContent = message;
    const form = document.querySelector('form');
    if (form) form.parentNode.insertBefore(el, form.nextSibling);
    else document.body.appendChild(el);
  }

  // ---- Search ----

  let searchCounter = 0;
  let currentKey = null;
  let currentBody = null;
  let currentResto = null;

  function handleSearch(e) {
    e.preventDefault();
    const form = e.target;
    const restaurant = form.querySelector('[data-testid="restaurant-select"]').value;
    const date = form.querySelector('[data-testid="date-input"]').value;
    const partySize = parseInt(form.querySelector('[data-testid="party-size-input"]').value, 10);
    const myReq = ++searchCounter;

    const grid = document.getElementById('availability-grid');
    const noSlots = document.getElementById('no-slots');
    grid.style.display = 'none';
    noSlots.style.display = 'none';
    grid.innerHTML = '';

    fetch('/availability?restaurant_id=' + encodeURIComponent(restaurant) +
          '&date=' + encodeURIComponent(date) + '&party_size=' + partySize,
          { headers: authHeaders() })
    .then(r => r.json())
    .then(data => { if (myReq === searchCounter) renderGrid(data, partySize); })
    .catch(() => { if (myReq === searchCounter) console.error('search failed'); });
  }

  function renderGrid(data, partySize) {
    const grid = document.getElementById('availability-grid');
    const noSlots = document.getElementById('no-slots');
    grid.innerHTML = '';

    const slots = data.slots || [];
    if (slots.length === 0) {
      noSlots.style.display = 'block';
      grid.style.display = 'none';
      return;
    }

    noSlots.style.display = 'none';
    grid.style.display = 'grid';

    ensureRestaurant(data.restaurant_id).then(resto => {
      if (!resto) { grid.style.display='none'; noSlots.textContent='Restaurant data unavailable.'; noSlots.style.display='block'; return; }
      const restoCopy = JSON.parse(JSON.stringify(resto));
      for (const slot of slots) {
        const time = slot.starts_at_local.split('T')[1];
        const availTables = new Set(slot.available_table_ids || []);
        const availOptions = slot.available_options || [];
        const pairSet = new Set();
        for (const o of availOptions) {
          if (o.table_ids.length === 2) pairSet.add(o.table_ids.join('+'));
        }
        for (const t of restoCopy.tables) {
          const cell = document.createElement('div');
          cell.setAttribute('data-testid', 'slot-' + t.id + '-' + time);
          cell.className = 'slot-cell';
          const isAvail = availTables.has(t.id);
          cell.dataset.available = isAvail ? 'true' : 'false';
          cell.textContent = t.label;
          if (isAvail) {
            cell.classList.add('available');
            cell.addEventListener('click', () => openBooking([t.id], slot, restoCopy, partySize));
          } else {
            cell.classList.add('unavailable');
          }
          grid.appendChild(cell);
        }
        const combinable = restoCopy.combinable || [];
        for (const pair of combinable) {
          const [ta, tb] = pair;
          const pairKey = pair.join('+');
          const cell = document.createElement('div');
          cell.setAttribute('data-testid', 'slot-' + pairKey + '-' + time);
          cell.className = 'slot-cell';
          const isAvail = pairSet.has(pairKey);
          cell.dataset.available = isAvail ? 'true' : 'false';
          const la = restoCopy.tables.find(x => x.id === ta);
          const lb = restoCopy.tables.find(x => x.id === tb);
          cell.textContent = (la ? la.label : ta) + '+' + (lb ? lb.label : tb);
          if (isAvail) {
            cell.classList.add('available');
            cell.addEventListener('click', () => openBooking([ta, tb], slot, restoCopy, partySize));
          } else {
            cell.classList.add('unavailable');
          }
          grid.appendChild(cell);
        }
      }
    });
  }

  const restoCache = {};
  function ensureRestaurant(rid) {
    if (restoCache[rid]) return Promise.resolve(restoCache[rid]);
    return fetch('/restaurants/' + encodeURIComponent(rid))
      .then(r => { if (!r.ok) return null; return r.json(); })
      .then(data => { if (data) restoCache[rid] = data; return data; })
      .catch(() => null);
  }

  // ---- Booking ----

  function openBooking(tableIds, slot, resto, partySize) {
    removeEl('[data-testid="booking-uncertain"]');
    removeEl('[data-testid="booking-error"]');
    removeEl('[data-testid="confirmation"]');

    if (!getToken()) {
      showAuthError('You must be signed in to book a table. <a href="/login">Log in</a>');
      return;
    }

    currentKey = crypto.randomUUID();
    currentBody = { restaurant_id: resto.id, table_ids: tableIds, starts_at_local: slot.starts_at_local, party_size: partySize };
    currentResto = resto;

    const labels = tableIds.map(id => resto.tables.find(t => t.id === id) || {label: id}).map(t => t.label).join(' + ');
    const time = slot.starts_at_local.split('T')[1];
    const summary = labels + ', ' + time;

    const area = document.getElementById('booking-area');
    area.innerHTML = '<div data-testid="booking-form" class="booking-section">' +
      '<div data-testid="booking-summary" class="booking-summary">' + escHtml(summary) + '</div>' +
      '<div><label for="bk-ps">Party size</label>' +
      '<input type="number" id="bk-ps" data-testid="booking-party-size" value="' + partySize + '" min="1"></div>' +
      '<button type="button" data-testid="booking-submit" class="btn-primary">Book</button>' +
      '</div>';

    area.querySelector('[data-testid="booking-party-size"]').addEventListener('change', function() {
      currentKey = crypto.randomUUID();
      currentBody.party_size = parseInt(this.value, 10);
      removeEl('[data-testid="confirmation"]');
      removeEl('[data-testid="booking-error"]');
      removeEl('[data-testid="booking-uncertain"]');
    });

    area.querySelector('[data-testid="booking-submit"]').addEventListener('click', submitBooking);
  }

  function submitBooking() {
    const btn = document.querySelector('[data-testid="booking-submit"]');
    btn.disabled = true;
    btn.textContent = 'Booking…';
    removeEl('[data-testid="booking-error"]');
    removeEl('[data-testid="booking-uncertain"]');

    const body = JSON.parse(JSON.stringify(currentBody));
    const hdrs = Object.assign({'Content-Type': 'application/json'}, authHeaders());
    hdrs['Idempotency-Key'] = currentKey;

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      showUncertain();
      setTimeout(retryBooking, 500);
    }, 5000);

    fetch('/reservations', { method: 'POST', headers: hdrs, body: JSON.stringify(body) })
    .then(resp => {
      if (settled) return;
      clearTimeout(timer);
      settled = true;
      btn.disabled = false;
      btn.textContent = 'Book';
      if (resp.ok) {
        resp.json().then(showConfirmation).catch(() => {});
      } else {
        resp.json().then(err => {
          if (err.error && err.error.code === 'table_unavailable') {
            showBookingError('The table is no longer available. The availability grid has been updated.');
            triggerSearch();
          } else {
            showBookingError(err.error && err.error.message || 'Booking failed');
          }
        }).catch(() => showBookingError('Booking failed'));
      }
    })
    .catch(() => {
      if (settled) return;
      clearTimeout(timer);
      settled = true;
      btn.disabled = false;
      btn.textContent = 'Book';
      showUncertain();
      setTimeout(retryBooking, 500);
    });
  }

  function retryBooking() {
    const btn = document.querySelector('[data-testid="booking-submit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Retrying…'; }
    removeEl('[data-testid="booking-uncertain"]');
    const body = JSON.parse(JSON.stringify(currentBody));
    const hdrs = Object.assign({'Content-Type': 'application/json'}, authHeaders());
    hdrs['Idempotency-Key'] = currentKey;

    fetch('/reservations', { method: 'POST', headers: hdrs, body: JSON.stringify(body) })
    .then(resp => {
      if (btn) { btn.disabled = false; btn.textContent = 'Book'; }
      if (resp.ok) { resp.json().then(showConfirmation).catch(() => {}); }
      else {
        resp.json().then(err => {
          if (err.error && err.error.code === 'table_unavailable') {
            showBookingError('The table is no longer available. The availability grid has been updated.');
            triggerSearch();
          } else {
            showBookingError(err.error && err.error.message || 'Booking failed');
          }
        }).catch(() => showBookingError('Booking failed'));
      }
    })
    .catch(() => {
      if (btn) { btn.disabled = false; btn.textContent = 'Book'; }
      showUncertain();
      setTimeout(retryBooking, 2000);
    });
  }

  function showBookingError(message) {
    removeEl('[data-testid="booking-uncertain"]');
    removeEl('[data-testid="confirmation"]');
    let el = document.querySelector('[data-testid="booking-error"]');
    if (!el) {
      el = document.createElement('div');
      el.setAttribute('data-testid', 'booking-error');
      el.className = 'error';
      document.getElementById('booking-area').insertBefore(el, document.getElementById('booking-area').firstChild);
    }
    el.innerHTML = message;
    el.style.display = 'block';
  }

  function showUncertain() {
    removeEl('[data-testid="booking-error"]');
    removeEl('[data-testid="confirmation"]');
    let el = document.querySelector('[data-testid="booking-uncertain"]');
    if (!el) {
      el = document.createElement('div');
      el.setAttribute('data-testid', 'booking-uncertain');
      el.className = 'error';
      el.style.background = '#e8e8f5';
      el.style.borderColor = '#b1b1d4';
      el.style.color = '#2e2e5e';
      document.getElementById('booking-area').insertBefore(el, document.getElementById('booking-area').firstChild);
    }
    el.textContent = 'Your booking is being processed…';
    el.style.display = 'block';
  }

  function showConfirmation(data) {
    removeEl('[data-testid="booking-error"]');
    removeEl('[data-testid="booking-uncertain"]');

    let el = document.querySelector('[data-testid="confirmation"]');
    if (!el) {
      el = document.createElement('div');
      el.setAttribute('data-testid', 'confirmation');
      el.className = 'confirmation-section';
      document.getElementById('booking-area').appendChild(el);
    }
    el.style.display = 'block';

    const resto = currentResto || {};
    const tableLabels = (data.table_ids || []).map(id => {
      const t = resto.tables && resto.tables.find(x => x.id === id);
      return t ? t.label : id;
    }).join(' + ');
    const time = data.starts_at_local ? data.starts_at_local.split('T')[1] : '';
    const restoName = resto.name || data.restaurant_id;

    let details = restoName + ' • ' + tableLabels + ' • ' + time;
    el.innerHTML = '<div class="confirmation">' +
      '<div data-testid="confirmation-reference" class="confirmation-reference">' + escHtml(data.reference) + '</div>' +
      '<div data-testid="confirmation-details" class="confirmation-details">' + escHtml(details) + '</div>' +
      '</div>';
    if (data.table_ids && data.table_ids.length > 1) {
      const ct = document.createElement('div');
      ct.setAttribute('data-testid', 'confirmation-tables');
      ct.textContent = 'Tables: ' + tableLabels;
      el.appendChild(ct);
    }
  }

  function triggerSearch() {
    const form = document.getElementById('search-form');
    if (form) form.dispatchEvent(new Event('submit'));
  }

  // ---- Lookup ----

  function handleLookup(e) {
    e.preventDefault();
    const form = e.target;
    const ref = form.querySelector('[data-testid="lookup-reference-input"]').value.trim().toUpperCase();
    removeEl('[data-testid="reservation-error"]');
    const detail = document.getElementById('reservation-detail');
    detail.style.display = 'none';
    detail.innerHTML = '';
    removeEl('[data-testid="reservation-cancel-button"]');

    fetch('/reservations/' + encodeURIComponent(ref), { headers: authHeaders() })
    .then(resp => {
      if (resp.status === 404) { showLookupError('Reservation ' + ref + ' was not found.'); }
      else if (resp.status === 401) { showLookupError('You must be signed in to look up a reservation.'); }
      else if (!resp.ok) {
        resp.json().then(err => showLookupError(err.error && err.error.message || 'Lookup failed'))
          .catch(() => showLookupError('Lookup failed'));
      } else {
        resp.json().then(showReservation).catch(() => showLookupError('Lookup failed'));
      }
    })
    .catch(() => showLookupError('Network error'));
  }

  function showLookupError(message) {
    let el = document.querySelector('[data-testid="reservation-error"]');
    if (!el) {
      el = document.createElement('div');
      el.setAttribute('data-testid', 'reservation-error');
      el.className = 'error';
      document.querySelector('main').appendChild(el);
    }
    el.textContent = message;
    el.style.display = 'block';
  }

  function showReservation(data) {
    removeEl('[data-testid="reservation-error"]');
    removeEl('[data-testid="reservation-cancel-button"]');
    const detail = document.getElementById('reservation-detail');
    detail.style.display = 'block';

    let tableText;
    if (data.table_ids && data.table_ids.length > 1) {
      tableText = 'Tables: ' + data.table_ids.join(', ');
    } else if (data.table_id) {
      tableText = 'Table: ' + data.table_id;
    } else {
      tableText = 'Table: ' + (data.table_ids ? data.table_ids.join(', ') : '');
    }

    detail.innerHTML = '<div data-testid="reservation-status" class="reservation-status">' +
      escHtml(data.status) + '</div>' +
      '<div>' + escHtml(data.restaurant_id || '') + ' • ' + escHtml(tableText) +
      ' • ' + escHtml(data.starts_at_local || '') + '</div>';

    if (data.table_ids && data.table_ids.length > 1) {
      const rt = document.createElement('div');
      rt.setAttribute('data-testid', 'reservation-tables');
      rt.textContent = 'Tables: ' + data.table_ids.join(', ');
      detail.appendChild(rt);
    }

    if (data.status !== 'cancelled') {
      const cb = document.createElement('button');
      cb.setAttribute('data-testid', 'reservation-cancel-button');
      cb.textContent = 'Cancel';
      cb.className = 'btn-secondary';
      cb.style.marginTop = '0.5rem';
      cb.addEventListener('click', () => cancelReservation(data.reference));
      detail.appendChild(cb);
    }
  }

  function cancelReservation(reference) {
    if (!confirm('Cancel this reservation?')) return;
    const btn = document.querySelector('[data-testid="reservation-cancel-button"]');
    if (btn) btn.disabled = true;

    fetch('/reservations/' + encodeURIComponent(reference) + '/cancel', {
      method: 'POST', headers: authHeaders()
    })
    .then(resp => {
      if (btn) btn.disabled = false;
      if (resp.ok) {
        resp.json().then(data => {
          const s = document.querySelector('[data-testid="reservation-status"]');
          if (s) s.textContent = data.status;
          removeEl('[data-testid="reservation-cancel-button"]');
          triggerSearch();
        });
      } else {
        resp.json().then(err => showLookupError(err.error && err.error.message || 'Cancel failed'))
          .catch(() => showLookupError('Cancel failed'));
      }
    })
    .catch(() => { if (btn) btn.disabled = false; });
  }

  // ---- Init ----

  updateNav();

  const route = document.body.getAttribute('data-route');

  if (route === 'signup') {
    const f = document.getElementById('signup-form');
    if (f) f.addEventListener('submit', handleSignup);
  } else if (route === 'login') {
    const f = document.getElementById('login-form');
    if (f) f.addEventListener('submit', handleLogin);
  } else if (route === 'search') {
    const f = document.getElementById('search-form');
    if (f) f.addEventListener('submit', handleSearch);
  } else if (route === 'lookup') {
    const f = document.getElementById('lookup-form');
    if (f) f.addEventListener('submit', handleLookup);
  }
})();
`;

const { State, ValidationError } = require('./state');

function searchPage(state) {
  const restaurants = (state && state.restaurants) || [];
  let options = '';
  for (const r of restaurants) {
    options += `<option value="${escHtml(r.id)}">${escHtml(r.name)}</option>`;
  }
  const today = new Date().toISOString().split('T')[0];
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tablekeeper</title>
  <style>${CSS}</style>
</head>
<body data-route="search">
  ${navHtml()}
  <main>
    <h1 class="h1-title">Find a table</h1>
    <form id="search-form" class="search-form" autocomplete="off">
      <div class="form-row">
        <label for="restaurant-select">Restaurant</label>
        <select id="restaurant-select" data-testid="restaurant-select">${options}</select>
      </div>
      <div class="form-row">
        <label for="date-input">Date</label>
        <input type="date" id="date-input" data-testid="date-input" value="${today}">
      </div>
      <div class="form-row">
        <label for="party-size-input">Party size</label>
        <input type="number" id="party-size-input" data-testid="party-size-input" value="4" min="1">
      </div>
      <div class="form-row" style="align-self:flex-end">
        <button type="submit" data-testid="search-button" class="btn-primary">Search</button>
      </div>
    </form>
    <div id="availability-grid" data-testid="availability-grid" class="grid" style="display:none;"></div>
    <div id="no-slots" data-testid="no-slots" class="no-slots" style="display:none">No tables available for this day.</div>
    <div id="booking-area"></div>
  </main>
  <script>${JS}</script>
</body>
</html>`;
}

function signupPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tablekeeper — Sign up</title>
  <style>${CSS}</style>
</head>
<body data-route="signup">
  ${navHtml()}
  <main>
    <h1 class="h1-title">Create your account</h1>
    <form id="signup-form" autocomplete="off">
      <div class="form-row">
        <label for="signup-email">Email</label>
        <input type="email" id="signup-email" data-testid="signup-email" autocomplete="new-password">
      </div>
      <div class="form-row">
        <label for="signup-password">Password (min 8 characters)</label>
        <input type="password" id="signup-password" data-testid="signup-password" autocomplete="new-password">
      </div>
      <div class="form-row">
        <label for="signup-display-name">Display name</label>
        <input type="text" id="signup-display-name" data-testid="signup-display-name">
      </div>
      <button type="submit" data-testid="signup-submit" class="btn-primary">Sign up</button>
    </form>
  </main>
  <script>${JS}</script>
</body>
</html>`;
}

function loginPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tablekeeper — Login</title>
  <style>${CSS}</style>
</head>
<body data-route="login">
  ${navHtml()}
  <main>
    <h1 class="h1-title">Welcome back</h1>
    <form id="login-form" autocomplete="off">
      <div class="form-row">
        <label for="login-email">Email</label>
        <input type="email" id="login-email" data-testid="login-email" autocomplete="new-password">
      </div>
      <div class="form-row">
        <label for="login-password">Password</label>
        <input type="password" id="login-password" data-testid="login-password" autocomplete="new-password">
      </div>
      <button type="submit" data-testid="login-submit" class="btn-primary">Log in</button>
    </form>
  </main>
  <script>${JS}</script>
</body>
</html>`;
}

function lookupPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tablekeeper — Reservation lookup</title>
  <style>${CSS}</style>
</head>
<body data-route="lookup">
  ${navHtml()}
  <main>
    <h1 class="h1-title">Find your reservation</h1>
    <form id="lookup-form" autocomplete="off">
      <div class="form-row">
        <label for="lookup-reference-input">Reference</label>
        <input type="text" id="lookup-reference-input" data-testid="lookup-reference-input"
               placeholder="e.g. K3P7QW" maxlength="12">
      </div>
      <button type="submit" data-testid="lookup-submit" class="btn-primary">Look up</button>
    </form>
    <div id="reservation-detail" data-testid="reservation-detail" class="reservation-detail" style="display:none"></div>
  </main>
  <script>${JS}</script>
</body>
</html>`;
}

module.exports = { searchPage, signupPage, loginPage, lookupPage, CSS };
