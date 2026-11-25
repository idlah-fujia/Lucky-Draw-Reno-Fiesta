(function () {
  var state = { entries: [], events: [], session: null };
  var loginView = document.getElementById('loginView');
  var appView = document.getElementById('appView');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function when(iso) {
    if (!iso) return '';
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return new Intl.DateTimeFormat('en-SG', {
      timeZone: 'Asia/Singapore', year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date);
  }
  function api(path, options) {
    return fetch(path, options || {}).then(function (res) {
      var type = res.headers.get('content-type') || '';
      var parse = type.indexOf('json') >= 0 ? res.json() : res.text();
      return parse.then(function (body) {
        if (res.status === 401 && path !== '/api/admin/login') { showLogin(); throw new Error('Sign in again.'); }
        if (!res.ok) throw new Error((body && body.error) || 'Request failed');
        return body;
      });
    });
  }

  function showLogin() {
    loginView.hidden = false;
    appView.hidden = true;
  }
  function showApp() {
    loginView.hidden = true;
    appView.hidden = false;
  }

  document.getElementById('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = document.getElementById('loginErr');
    err.textContent = '';
    api('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: document.getElementById('password').value })
    }).then(function (session) {
      state.session = session;
      showApp();
      return load();
    }).catch(function (error) { err.textContent = error.message; });
  });
  document.getElementById('logoutBtn').addEventListener('click', function () {
    fetch('/api/admin/logout', { method: 'POST' }).finally(function () { state.session = null; showLogin(); });
  });
  document.getElementById('reloadBtn').addEventListener('click', load);
  ['q', 'eventFilter', 'statusFilter'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', renderTable);
  });
  document.getElementById('oddsEvent').addEventListener('change', loadOdds);

  function banner() {
    var el = document.getElementById('storeBanner');
    var line = document.getElementById('storeLine');
    if (!state.session) return;
    if (state.session.storage === 'sheets') {
      el.className = 'banner sheets';
      el.textContent = 'Entries are being written to the Google Sheet. Proof files: ' + state.session.files + '. Email: ' + state.session.email + '.';
    } else {
      el.className = 'banner local';
      el.textContent = 'Google Sheets is not connected, so entries are in the spreadsheet file data/entries.csv on this server. Connect a sheet with the steps in the README when you’re ready. Email: ' + (state.session.email === 'resend' ? 'Resend' : 'not configured — messages stay in the outbox below') + '.';
    }
    line.textContent = 'Status moves from submitted → spun → verified. Void blocks a code from spinning.';
  }

  function load() {
    return Promise.all([
      api('/api/admin/entries'),
      api('/api/admin/outbox')
    ]).then(function (parts) {
      state.entries = parts[0].entries;
      state.events = parts[0].events;
      fillFilters();
      banner();
      renderTable();
      renderQrs();
      renderOutbox(parts[1]);
      return loadOdds();
    });
  }

  function fillFilters() {
    var eventFilter = document.getElementById('eventFilter');
    var odds = document.getElementById('oddsEvent');
    var current = eventFilter.value;
    var oddsCurrent = odds.value;
    var options = '<option value="">All events</option>' + state.events.map(function (event) {
      return '<option value="' + esc(event.slug) + '">' + esc(event.name + (event.edition ? ' · ' + event.edition : '')) + '</option>';
    }).join('');
    eventFilter.innerHTML = options;
    odds.innerHTML = state.events.map(function (event) {
      return '<option value="' + esc(event.slug) + '">' + esc(event.name) + '</option>';
    }).join('');
    eventFilter.value = current;
    if (oddsCurrent) odds.value = oddsCurrent;
  }

  function filtered() {
    var q = document.getElementById('q').value.trim().toLowerCase();
    var event = document.getElementById('eventFilter').value;
    var status = document.getElementById('statusFilter').value;
    return state.entries.filter(function (row) {
      if (event && row.event_slug !== event) return false;
      if (status && row.status !== status) return false;
      if (!q) return true;
      var hay = [row.homeowner_name, row.homeowner_phone, row.homeowner_email, row.code, row.id_company, row.designer_name, row.prize_label, row.delivery_address].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function renderTable() {
    var rows = filtered();
    var body = document.getElementById('rows');
    document.getElementById('empty').hidden = state.entries.length !== 0;
    var counts = { submitted: 0, spun: 0, verified: 0, voided: 0, iphone: 0 };
    state.entries.forEach(function (row) {
      counts[row.status] = (counts[row.status] || 0) + 1;
      if (row.prize_id === 'IPHONE' && row.status !== 'voided') counts.iphone += 1;
    });
    document.getElementById('stats').innerHTML = [
      ['Entries', state.entries.length],
      ['Submitted', counts.submitted || 0],
      ['Spun', counts.spun || 0],
      ['Verified', counts.verified || 0],
      ['Voided', counts.voided || 0],
      ['iPhones won', counts.iphone]
    ].map(function (item) { return '<div class="stat"><b>' + item[1] + '</b><span>' + item[0] + '</span></div>'; }).join('');
    body.innerHTML = rows.map(function (row) {
      var actions = '';
      if (row.status !== 'voided' && row.status !== 'verified') actions += '<button class="mini ok" data-act="verify" data-id="' + row.id + '">Verify</button> ';
      if (row.status !== 'voided') actions += '<button class="mini danger" data-act="void" data-id="' + row.id + '">Void</button>';
      if (row.status === 'voided') actions += '<button class="mini" data-act="undo-void" data-id="' + row.id + '">Undo void</button>';
      return '<tr>' +
        '<td>' + esc(when(row.created_at)) + '</td>' +
        '<td>' + esc(row.event_name) + '</td>' +
        '<td><b>' + esc(row.homeowner_name) + '</b><br>' + esc(row.homeowner_phone) + '<br>' + esc(row.homeowner_email) + '</td>' +
        '<td><b data-testid="row-code">' + esc(row.code) + '</b></td>' +
        '<td><span class="pill ' + esc(row.status) + '">' + esc(row.status) + '</span></td>' +
        '<td>' + esc(row.prize_label || '—') + '</td>' +
        '<td>' + (row.proof_link ? '<a href="' + esc(row.proof_link) + '" target="_blank" rel="noopener">Open file</a>' : '—') + '</td>' +
        '<td>' + actions + ' <button class="mini" data-act="toggle" data-id="' + row.id + '">Details</button></td>' +
        '</tr>' +
        '<tr class="detail" id="detail-' + row.id + '" hidden><td colspan="8">' + detail(row) + '</td></tr>';
    }).join('');
  }

  function detail(row) {
    return '<b>Designer.</b> ' + esc(row.designer_name || '—') + ' · ' + esc(row.designer_phone || '') + ' · ' + esc(row.designer_email || '') +
      ' · ' + esc(row.id_company || '') +
      '<br><b>Prize delivery address.</b> ' + esc(row.delivery_address) +
      '<br><b>Attended.</b> ' + esc(row.event_date) +
      ' · <b>Code email.</b> ' + esc(row.code_email_status || '—') +
      ' · <b>Result email.</b> ' + esc(row.result_email_status || '—') +
      '<br><b>Created.</b> ' + esc(when(row.created_at)) +
      ' · <b>Designer saved.</b> ' + esc(when(row.designer_saved_at) || '—') +
      ' · <b>Spun.</b> ' + esc(when(row.spun_at) || '—') +
      ' · <b>Verified.</b> ' + esc(when(row.verified_at) || '—') +
      ' · <b>Voided.</b> ' + esc(when(row.voided_at) || '—') +
      '<br><b>Declarations.</b> contract ' + esc(row.decl_contract) + ', genuine ' + esc(row.decl_genuine) + ', verify ' + esc(row.decl_verify) + ', terms ' + esc(row.decl_tnc) +
      '<br><b>File.</b> ' + esc(row.proof_filename) + ' · ' + esc(row.proof_mime) + ' · ' + esc(row.proof_bytes) + ' bytes';
  }

  document.getElementById('rows').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    var id = btn.dataset.id;
    if (btn.dataset.act === 'toggle') {
      var row = document.getElementById('detail-' + id);
      row.hidden = !row.hidden;
      return;
    }
    if (btn.dataset.act === 'void' && !confirm('Void this entry? The code will not spin, and a voided iPhone can be won again.')) return;
    btn.disabled = true;
    api('/api/admin/entries/' + id, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: btn.dataset.act })
    }).then(load).catch(function (error) { alert(error.message); btn.disabled = false; });
  });

  function renderQrs() {
    var host = document.getElementById('qrs');
    host.innerHTML = state.events.map(function (event) {
      var url = location.origin + '/e/' + event.slug;
      return '<div class="qr-card"><img alt="QR for ' + esc(event.name) + '" src="/api/admin/qr/' + encodeURIComponent(event.slug) + '">' +
        '<div><b>' + esc(event.name) + (event.edition ? ' · ' + esc(event.edition) : '') + '</b>' +
        '<p class="sub">' + (event.active ? 'Open for entries' : 'Not open') + (event.starts ? ' · ' + esc(event.starts) + ' to ' + esc(event.ends) : '') + '</p>' +
        '<p style="font-weight:800;word-break:break-all">' + esc(url) + '</p>' +
        '<p><a href="/api/admin/qr/' + encodeURIComponent(event.slug) + '" download="spin-' + esc(event.slug) + '.png">Download PNG</a></p></div></div>';
    }).join('');
  }

  function loadOdds() {
    var slug = document.getElementById('oddsEvent').value;
    return api('/api/admin/odds' + (slug ? '?event=' + encodeURIComponent(slug) : '')).then(function (data) {
      var sold = (data.soldOut || []).indexOf('IPHONE') >= 0 ? ' The iPhone is fully redeemed for this event.' : '';
      document.getElementById('odds').innerHTML = '<tr><th>Prize</th><th>Slices</th><th>Chance</th></tr>' +
        data.odds.map(function (row) {
          var chance = row.available ? row.percent + '% · 1 in ' + row.oneIn : 'Off the wheel';
          return '<tr><td>' + esc(row.label) + (row.oncePerEvent ? ' · once' : '') + '</td><td>' + row.slices + '</td><td>' + esc(chance) + '</td></tr>';
        }).join('') + '<tr><td colspan="3">' + esc(sold) + '</td></tr>';
    });
  }

  function renderOutbox(data) {
    document.getElementById('mailMode').textContent = data.mode === 'resend'
      ? 'Resend is on. Recent messages:'
      : 'Resend is not configured. These messages were saved here instead of being sent:';
    var host = document.getElementById('outbox');
    if (!data.records.length) { host.innerHTML = '<p class="sub">No messages yet.</p>'; return; }
    host.innerHTML = data.records.map(function (record) {
      return '<details><summary><b>' + esc(record.status) + '</b> · ' + esc(when(record.at)) + ' · ' + esc(record.to) + ' · ' + esc(record.subject) + '</summary><pre style="white-space:pre-wrap;font:inherit;margin-top:8px">' + esc(record.text) + (record.error ? '\n\n' + esc(record.error) : '') + '</pre></details>';
    }).join('');
  }

  api('/api/admin/session').then(function (session) {
    state.session = session;
    showApp();
    return load();
  }).catch(function () { showLogin(); });
})();
