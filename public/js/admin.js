(function () {
  var CREATE_EVENT_LABEL = 'Create Event';
  var state = { entries: [], events: [], liveSlug: '', session: null, led: null, ledPosition: 'top-center', showAll: false, showAllEvents: false };
  var POS_LABELS = [
    ['top-left', 'Top left'], ['top-center', 'Top centre'], ['top-right', 'Top right'],
    ['bottom-left', 'Bottom left'], ['bottom-center', 'Bottom centre'], ['bottom-right', 'Bottom right']
  ];
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
      body: JSON.stringify({
        email: document.getElementById('email').value,
        password: document.getElementById('password').value
      })
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
  document.getElementById('createEventBtn').textContent = CREATE_EVENT_LABEL;
  document.getElementById('showAllBtn').addEventListener('click', function () {
    state.showAll = !state.showAll;
    renderTable();
  });
  document.getElementById('createEventBtn').addEventListener('click', function () {
    document.getElementById('createEventForm').hidden = false;
    document.getElementById('newEventName').focus();
  });
  document.getElementById('cancelEventBtn').addEventListener('click', function () {
    document.getElementById('createEventForm').hidden = true;
    document.getElementById('newEventErr').textContent = '';
  });
  document.getElementById('createEventForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = document.getElementById('newEventErr');
    err.textContent = '';
    var starts = document.getElementById('newEventStart').value;
    var ends = document.getElementById('newEventEnd').value;
    if (starts && ends && ends < starts) {
      err.textContent = 'The end date can’t be before the start date.';
      return;
    }
    api('/api/admin/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('newEventName').value,
        starts: starts,
        ends: ends
      })
    }).then(function (created) {
      document.getElementById('createEventForm').reset();
      document.getElementById('createEventForm').hidden = true;
      var box = document.getElementById('newEventResult');
      box.hidden = false;
      box.innerHTML = '<div class="event-qr"><img alt="QR for ' + esc(created.event.name) + '" src="/api/admin/qr/' + encodeURIComponent(created.event.slug) + '">' +
        '<div><b>' + esc(created.event.name) + '</b>' +
        '<p class="sub">Created. The QR is centred and uses the usual size.</p>' +
        '<p><a href="' + esc(created.spinUrl) + '">' + esc(versionLabel('event_day')) + ' big screen</a></p>' +
        '<p class="break-url">' + esc(created.formUrl) + '</p>' +
        '<p><a href="' + esc(created.virtualSpinUrl) + '">' + esc(versionLabel('after_event')) + ' big screen</a></p>' +
        '<p class="break-url">' + esc(created.virtualFormUrl) + '</p></div></div>';
      return load();
    }).catch(function (error) { err.textContent = error.message; });
  });
  document.getElementById('addStaffBtn').addEventListener('click', function () {
    document.getElementById('accountForm').hidden = false;
    document.getElementById('accName').focus();
  });
  document.getElementById('cancelStaffBtn').addEventListener('click', function () {
    document.getElementById('accountForm').hidden = true;
    document.getElementById('accErr').textContent = '';
  });
  ['q', 'eventFilter', 'versionFilter', 'statusFilter'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', renderTable);
  });
  document.getElementById('oddsEvent').addEventListener('change', loadOdds);
  document.getElementById('ledEvent').addEventListener('change', loadLed);
  document.getElementById('ledUnit').addEventListener('change', function () {
    applySizeBounds(this.value, null);
    paintLed();
  });
  document.getElementById('ledSize').addEventListener('input', paintLed);
  document.getElementById('ledPos').innerHTML = POS_LABELS.map(function (item) {
    return '<button type="button" data-pos="' + item[0] + '">' + item[1] + '</button>';
  }).join('');
  document.getElementById('ledPos').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    state.ledPosition = btn.dataset.pos;
    paintLed();
  });
  document.getElementById('ledSave').addEventListener('click', function () {
    var button = this;
    var err = document.getElementById('ledErr');
    err.textContent = '';
    button.disabled = true;
    api('/api/admin/kiosk-qr', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event: document.getElementById('ledEvent').value,
        size: Number(document.getElementById('ledSize').value),
        unit: document.getElementById('ledUnit').value,
        position: state.ledPosition
      })
    }).then(function () {
      return loadLed();
    }).then(function () {
      document.getElementById('ledMeta').textContent = 'Saved. The LED screen picks this up within about 20 seconds, or on the next reset.';
    }).catch(function (error) {
      err.textContent = error.message;
    }).finally(function () { button.disabled = false; });
  });

  function banner() {
    var el = document.getElementById('storeBanner');
    var line = document.getElementById('storeLine');
    if (!state.session) return;
    if (state.session.storage === 'sheets') {
      el.className = 'banner sheets';
      el.textContent = 'Entries are being written to the Google Sheet. Proof files: ' + state.session.files + '. Email: ' + state.session.mail + '.';
    } else {
      el.className = 'banner local';
      el.textContent = 'Google Sheets is not connected, so entries are in the spreadsheet file data/entries.csv on this server. Connect a sheet with the steps in the README when you’re ready. Email: ' + mailLabel(state.session.mail) + '.';
    }
    line.textContent = 'Status moves from submitted → spun → verified. Void blocks a code from spinning.';
  }

  function load() {
    var admin = state.session && state.session.role === 'admin';
    var jobs = [api('/api/admin/entries')];
    if (admin) jobs.push(api('/api/admin/outbox'));
    return Promise.all(jobs).then(function (parts) {
      state.entries = parts[0].entries;
      state.events = parts[0].events;
      state.liveSlug = parts[0].liveSlug || '';
      state.hosts = parts[0].hosts || state.hosts;
      fillFilters();
      banner();
      applyRole();
      renderEventQrs();
      renderTable();
      if (!admin) return;
      renderQrs();
      renderOutbox(parts[1]);
      return Promise.all([loadOdds(), loadAccounts()]);
    });
  }

  function applyRole() {
    var admin = state.session && state.session.role === 'admin';
    document.querySelectorAll('[data-admin-only]').forEach(function (el) { el.hidden = !admin; });
    var who = document.getElementById('who');
    if (who && state.session) {
      who.textContent = state.session.name + ' · ' + (admin ? 'Admin' : 'Staff') + ' · ' + state.session.email;
    }
  }

  function applySizeBounds(unit, value) {
    var limits = (state.led && state.led.limits) || { percent: [16, 70], px: [160, 900] };
    var range = unit === 'px' ? limits.px : limits.percent;
    var slider = document.getElementById('ledSize');
    slider.min = String(range[0]);
    slider.max = String(range[1]);
    slider.step = unit === 'px' ? '10' : '1';
    var next = value == null ? Number(slider.value) : Number(value);
    if (!Number.isFinite(next)) next = range[0];
    if (next < range[0]) next = range[0];
    if (next > range[1]) next = range[1];
    slider.value = String(next);
  }

  function paintLed() {
    var unit = document.getElementById('ledUnit').value;
    var size = document.getElementById('ledSize').value;
    document.getElementById('ledSizeLabel').textContent = unit === 'px' ? size + ' px' : size + '%';
    document.querySelectorAll('#ledPos button').forEach(function (btn) {
      btn.classList.toggle('on', btn.dataset.pos === state.ledPosition);
    });
    var screen = document.getElementById('ledScreen');
    var side = state.ledPosition.indexOf('left') >= 0 ? 'left' : state.ledPosition.indexOf('right') >= 0 ? 'right' : 'center';
    screen.className = 'led-screen ' + side + (state.ledPosition.indexOf('bottom') === 0 ? ' bottom' : '');
    var preview = unit === 'px' ? Math.max(18, Math.min(78, (Number(size) / 900) * 78)) + '%' : Math.max(18, Math.min(78, Number(size))) + '%';
    screen.style.setProperty('--preview-size', preview);
    var event = document.getElementById('ledEvent').value || (state.events[0] && state.events[0].slug) || '';
    var img = document.getElementById('ledPreviewImg');
    if (event) {
      var src = '/api/kiosk/qr.png?event=' + encodeURIComponent(event);
      if (img.getAttribute('src') !== src) img.src = src;
    }
  }

  function loadLed() {
    var event = document.getElementById('ledEvent').value;
    return api('/api/admin/kiosk-qr' + (event ? '?event=' + encodeURIComponent(event) : '')).then(function (data) {
      state.led = data;
      var select = document.getElementById('ledEvent');
      var keep = event || (data.event && data.event.slug) || '';
      select.innerHTML = '<option value="">All events (default)</option>' + data.events.map(function (item) {
        return '<option value="' + esc(item.slug) + '">' + esc(item.name + (item.edition ? ' · ' + item.edition : '')) + '</option>';
      }).join('');
      select.value = keep;
      var shown = data.saved || data.resolved;
      document.getElementById('ledUnit').value = shown.unit === 'px' ? 'px' : 'percent';
      applySizeBounds(shown.unit === 'px' ? 'px' : 'percent', shown.size);
      state.ledPosition = shown.position || 'top-center';
      paintLed();
      var where = data.saved
        ? 'Saved for ' + (data.event ? data.event.name : 'every event') + '.'
        : 'Nothing saved for this choice yet. The screen is using the ' + data.resolved.source + ' setting.';
      document.getElementById('ledMeta').textContent = where + ' Env default is ' + data.env.size + (data.env.unit === 'px' ? 'px' : '%') + ', ' + data.env.position + '.';
    });
  }

  function fillFilters() {
    var eventFilter = document.getElementById('eventFilter');
    var odds = document.getElementById('oddsEvent');
    var current = eventFilter.value;
    var oddsCurrent = odds.value;
    var options = '<option value="">All events</option>' + state.events.map(function (event) {
      return '<option value="' + esc(event.slug) + '">' + esc(event.name + (event.edition ? ' · ' + event.edition : '') + (event.archived ? ' (archived)' : '')) + '</option>';
    }).join('');
    eventFilter.innerHTML = options;
    odds.innerHTML = state.events.filter(function (event) { return !event.archived; }).map(function (event) {
      return '<option value="' + esc(event.slug) + '">' + esc(event.name) + '</option>';
    }).join('');
    eventFilter.value = current;
    if (oddsCurrent) odds.value = oddsCurrent;
    var version = document.getElementById('versionFilter');
    var versionCurrent = version.value;
    version.innerHTML = '<option value="">All versions</option>' +
      '<option value="event_day">' + esc(versionLabel('event_day')) + '</option>' +
      '<option value="after_event">' + esc(versionLabel('after_event')) + '</option>';
    version.value = versionCurrent;
  }

  function hostFor(mode) {
    var hosts = state.hosts || { event_day: '/events', after_event: '/virtual' };
    if (mode === 'event_day') return hosts.event_day;
    if (mode === 'after_event') return hosts.after_event;
    return '';
  }
  function versionLabel(mode) {
    var base = hostFor(mode);
    if (!base) return '—';
    try {
      var url = new URL(base, 'https://spin.local');
      var path = url.pathname.replace(/\/$/, '');
      if (!path || url.host === 'spin.local') return path || base;
      return url.host + path;
    } catch (e) { return base; }
  }
  function versionLink(mode, path) {
    var base = hostFor(mode);
    return base ? base.replace(/\/$/, '') + path : path;
  }

  function filtered() {
    var q = document.getElementById('q').value.trim().toLowerCase();
    var event = document.getElementById('eventFilter').value;
    var version = document.getElementById('versionFilter').value;
    var status = document.getElementById('statusFilter').value;
    return state.entries.filter(function (row) {
      if (event && row.event_slug !== event) return false;
      if (version && row.site_mode !== version) return false;
      if (status && row.status !== status) return false;
      if (!q) return true;
      var hay = [row.homeowner_name, row.homeowner_phone, row.homeowner_email, row.code, row.id_company, row.designer_name, row.prize_label].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function scoped() {
    var event = document.getElementById('eventFilter').value;
    var version = document.getElementById('versionFilter').value;
    return state.entries.filter(function (row) {
      if (event && row.event_slug !== event) return false;
      if (version && row.site_mode !== version) return false;
      return true;
    });
  }

  function tileCounts(rows) {
    var counts = { total: rows.length, submitted: 0, spam: 0, verified: 0, voided: 0, iphone: 0 };
    rows.forEach(function (row) {
      var isSpam = row.status === 'spam' || !!row.spam_at;
      var isVoid = row.status === 'voided' || !!row.voided_at;
      if (row.code && !isSpam && !isVoid) counts.submitted += 1;
      if (isSpam) counts.spam += 1;
      if (row.verified_at) counts.verified += 1;
      if (isVoid) counts.voided += 1;
      if (row.prize_id === 'IPHONE' && !isVoid) counts.iphone += 1;
    });
    return counts;
  }

  function renderTable() {
    var rows = filtered();
    var shown = state.showAll ? rows : rows.slice(0, 10);
    var body = document.getElementById('rows');
    document.getElementById('empty').hidden = state.entries.length !== 0;
    var counts = tileCounts(scoped());
    document.getElementById('stats').innerHTML = [
      ['Total entries', counts.total, ''],
      ['Active', counts.submitted, 'Not spam or voided'],
      ['Spam', counts.spam, ''],
      ['Verified', counts.verified, ''],
      ['Voided', counts.voided, ''],
      ['iPhones won', counts.iphone, '']
    ].map(function (item) {
      return '<div class="stat" data-testid="stat-' + item[0].toLowerCase().replace(/\s+/g, '-') + '"><b>' + item[1] + '</b><span>' + item[0] + '</span>' +
        (item[2] ? '<small>' + item[2] + '</small>' : '') + '</div>';
    }).join('');
    var more = document.getElementById('showAllBtn');
    more.hidden = rows.length <= 10;
    more.textContent = state.showAll ? 'Show less' : 'Show All';
    var count = document.getElementById('entryCount');
    if (count) count.textContent = rows.length ? 'Showing ' + shown.length + ' of ' + rows.length + ' entries' : '';
    rows = shown;
    body.innerHTML = rows.map(function (row) {
      var actions = '';
      var admin = state.session && state.session.role === 'admin';
      if (row.status !== 'voided' && row.status !== 'verified' && row.status !== 'spam') actions += '<button class="mini ok" data-act="verify" data-id="' + row.id + '">Verify</button> ';
      if (admin && row.status !== 'voided' && row.status !== 'spam') actions += '<button class="mini danger" data-act="void" data-id="' + row.id + '">Void</button>';
      if (admin && row.status === 'voided') actions += '<button class="mini" data-act="undo-void" data-id="' + row.id + '">Undo void</button>';
      if (admin && row.status !== 'spam' && row.status !== 'voided') actions += '<button class="mini" data-act="spam" data-id="' + row.id + '">Mark as spam</button> ';
      if (admin && row.status === 'spam') actions += '<button class="mini" data-act="undo-spam" data-id="' + row.id + '">Undo spam</button>';
      var shortVersion = row.site_mode === 'after_event' ? '/virtual' : row.site_mode === 'event_day' ? '/events' : '—';
      return '<tr class="entry-row">' +
        '<td data-label="When">' + esc(when(row.created_at)) + '</td>' +
        '<td data-label="Version" data-testid="row-version">' + (hostFor(row.site_mode) ? '<a href="' + esc(hostFor(row.site_mode)) + '">' + esc(shortVersion) + '</a>' : '—') + '</td>' +
        '<td data-label="Event">' + esc(row.event_name) + '</td>' +
        '<td data-label="Homeowner"><b>' + esc(row.homeowner_name) + '</b><br>' + esc(row.homeowner_phone) + '<br>' + esc(row.homeowner_email) + '</td>' +
        '<td data-label="Designer" data-testid="row-designer"><b>' + esc(row.designer_name || '—') + '</b><br>' + esc(row.designer_phone || '') + '<br>' + esc(row.id_company || '') + '</td>' +
        '<td data-label="Code"><b data-testid="row-code">' + esc(row.code) + '</b></td>' +
        '<td data-label="Status"><span class="pill ' + esc(row.status) + '" data-testid="row-status">' + esc(row.status === 'duplicate' ? 'Duplicate pair' : row.status) + '</span></td>' +
        '<td data-label="Prize">' + esc(row.prize_label || '—') + '</td>' +
        '<td data-label="Proof">' + (row.proof_link ? '<a href="' + esc(row.proof_link) + '" target="_blank" rel="noopener">Open file</a>' : '—') + '</td>' +
        '<td data-label="Actions" class="row-actions">' + actions + ' <button class="mini" data-act="toggle" data-id="' + row.id + '">Details</button></td>' +
        '</tr>' +
        '<tr class="detail" id="detail-' + row.id + '" hidden><td colspan="10">' + detail(row) + '</td></tr>';
    }).join('');
  }

  function detail(row) {
    return '<b>Designer.</b> ' + esc(row.designer_name || '—') + ' · ' + esc(row.designer_phone || '') + ' · ' + esc(row.designer_email || '') +
      ' · ' + esc(row.id_company || '') +
      '<br><b>Event date.</b> ' + esc(row.event_date) +
      ' · <b>Code email.</b> ' + esc(row.code_email_status || '—') +
      ' · <b>Result email.</b> ' + esc(row.result_email_status || '—') +
      '<br><b>Created.</b> ' + esc(when(row.created_at)) +
      ' · <b>Designer saved.</b> ' + esc(when(row.designer_saved_at) || '—') +
      ' · <b>Spun.</b> ' + esc(when(row.spun_at) || '—') +
      ' · <b>Verified.</b> ' + esc(when(row.verified_at) || '—') + (row.verified_by ? ' by ' + esc(row.verified_by) : '') +
      ' · <b>Voided.</b> ' + esc(when(row.voided_at) || '—') + (row.voided_by ? ' by ' + esc(row.voided_by) : '') +
      ' · <b>Spam.</b> ' + esc(when(row.spam_at) || '—') + (row.spam_by ? ' by ' + esc(row.spam_by) : '') +
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
    if (btn.dataset.act === 'spam' && !confirm('Mark this entry as spam? It will not count as submitted.')) return;
    btn.disabled = true;
    api('/api/admin/entries/' + id, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: btn.dataset.act })
    }).then(load).catch(function (error) { alert(error.message); btn.disabled = false; });
  });

  function eventDates(event) {
    if (event.rangeLabel) return event.rangeLabel;
    return formatEventRange(event.starts, event.ends);
  }

  function formatEventRange(starts, ends) {
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function parts(iso) {
      var bits = String(iso || '').split('-');
      if (bits.length !== 3) return null;
      return { year: Number(bits[0]), month: Number(bits[1]), day: Number(bits[2]) };
    }
    var from = parts(starts);
    if (!from) return '';
    var to = parts(ends || starts) || from;
    var month = months[from.month - 1] || '';
    var endMonth = months[to.month - 1] || '';
    if (from.year === to.year && from.month === to.month && from.day === to.day) return from.day + ' ' + month + ' ' + from.year;
    if (from.year === to.year && from.month === to.month) return from.day + '-' + to.day + ' ' + month + ' ' + from.year;
    if (from.year === to.year) return from.day + ' ' + month + '–' + to.day + ' ' + endMonth + ' ' + from.year;
    return from.day + ' ' + month + ' ' + from.year + '–' + to.day + ' ' + endMonth + ' ' + to.year;
  }

  function renderEventQrs() {
    var host = document.getElementById('eventQrList');
    var admin = state.session && state.session.role === 'admin';
    var live = state.events.filter(function (event) { return event.slug === state.liveSlug; })[0] || null;
    var others = state.events.filter(function (event) { return (!live || event.slug !== live.slug) && !event.archived; });
    var archived = state.events.filter(function (event) { return event.archived && (!live || event.slug !== live.slug); });
    var afterUrl = (hostFor('after_event') || '/virtual').replace(/\/$/, '');
    var liveCard = '';
    if (live) {
      var onSpin = versionLink('event_day', '/spin');
      var onForm = (hostFor('event_day') || '/events').replace(/\/$/, '');
      liveCard = '<div class="event-qr live" data-testid="event-qr-row"><img alt="On-site QR for ' + esc(live.name) + '" src="/api/admin/qr/on-site">' +
        '<div><b>' + esc(live.name) + (live.edition ? ' · ' + esc(live.edition) : '') + '</b> <span class="live-now" data-testid="live-event">LIVE NOW</span>' +
        '<p class="sub">' + esc(eventDates(live)) + '</p>' +
        '<p><b>On-site.</b> <a href="' + esc(onSpin) + '">Big screen</a> · <a href="' + esc(onForm) + '">Phone form</a></p>' +
        '<p class="break-url">' + esc(onForm) + '</p></div></div>';
    }
    var designer = '<div class="event-qr designer-link" data-testid="after-event-link">' +
      '<img alt="QR for the after-event form" src="/api/admin/qr/after-event">' +
      '<div><b>After-event link (for designers)</b>' +
      '<p class="sub">One link for every event. Send this to interior designers.</p>' +
      '<p class="break-url" data-testid="after-event-url">' + esc(afterUrl) + '</p>' +
      '<p><button class="mini" type="button" id="copyAfterEvent" data-url="' + esc(afterUrl) + '">Copy link</button></p></div></div>';
    var compact = '';
    if (others.length || archived.length) {
      var setBtn = admin && others.length ? '<button class="mini" type="button" id="setOtherLive">Set as live</button>' : '';
      var picker = others.length
        ? '<label class="fl"><span>Other events</span><select id="otherEventPick" aria-label="Other events">' +
          others.map(function (event) {
            var when = eventDates(event);
            return '<option value="' + esc(event.slug) + '">' + esc(event.name + (event.edition ? ' · ' + event.edition : '') + (when ? ' · ' + when : '')) + '</option>';
          }).join('') +
          '</select></label>'
        : '';
      function line(event, hidden) {
        var action = '';
        if (admin && !hidden) action += '<button class="mini" type="button" data-live="' + esc(event.slug) + '">Set as live</button>';
        if (admin) action += '<button class="mini" type="button" data-archive="' + esc(event.slug) + '" data-archived="' + (hidden ? 'no' : 'yes') + '">' + (hidden ? 'Unarchive' : 'Archive') + '</button>';
        return '<div class="event-line"><b>' + esc(event.name) + (event.edition ? ' · ' + esc(event.edition) : '') + (hidden ? ' · archived' : '') + '</b><span>' + esc(eventDates(event)) + '</span><span class="event-line-actions">' + action + '</span></div>';
      }
      compact = '<div class="other-events" data-testid="other-events">' + picker +
        '<span class="other-actions">' + setBtn +
        '<button class="mini" type="button" id="showAllEvents" data-testid="show-all-events">' + (state.showAllEvents ? 'Hide events' : 'Show all events') + '</button></span>' +
        '<div id="allEvents"' + (state.showAllEvents ? '' : ' hidden') + '>' +
        others.map(function (event) { return line(event, false); }).join('') +
        archived.map(function (event) { return line(event, true); }).join('') +
        '</div></div>';
    }
    host.innerHTML = liveCard + designer + compact;
  }

  document.getElementById('eventQrList').addEventListener('click', function (e) {
    if (e.target.id === 'showAllEvents') {
      state.showAllEvents = !state.showAllEvents;
      renderEventQrs();
      return;
    }
    if (e.target.id === 'setOtherLive') {
      var pick = document.getElementById('otherEventPick');
      if (!pick || !pick.value) return;
      var chosen = pick.value;
      state.liveSlug = chosen;
      renderEventQrs();
      api('/api/admin/live', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: chosen })
      }).then(load).catch(function (error) { alert(error.message); });
      return;
    }
    if (e.target.id === 'copyAfterEvent') {
      var url = e.target.getAttribute('data-url') || '';
      var button = e.target;
      navigator.clipboard.writeText(url).then(function () {
        button.textContent = 'Copied';
      }).catch(function () { button.textContent = url; });
      return;
    }
    var archiveBtn = e.target.closest('button[data-archive]');
    if (archiveBtn) {
      archiveBtn.disabled = true;
      api('/api/admin/events/archive', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: archiveBtn.dataset.archive, archived: archiveBtn.dataset.archived !== 'no' })
      }).then(load).catch(function (error) { alert(error.message); archiveBtn.disabled = false; });
      return;
    }
    var btn = e.target.closest('button[data-live]');
    if (!btn) return;
    btn.disabled = true;
    state.liveSlug = btn.dataset.live;
    renderEventQrs();
    api('/api/admin/live', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: btn.dataset.live })
    }).then(load).catch(function (error) { alert(error.message); btn.disabled = false; });
  });

  function renderQrs() {
    var host = document.getElementById('qrs');
    host.innerHTML = state.events.map(function (event) {
      var slug = encodeURIComponent(event.slug);
      var onForm = versionLink('event_day', '/e/' + slug);
      return '<div class="qr-card"><div class="qr-ph"><img alt="On-site QR for ' + esc(event.name) + '" loading="lazy" decoding="async" src="/api/admin/qr/' + slug + '?mount=events" onload="this.parentNode.classList.add(\'ready\')"><span>Loading QR</span></div>' +
        '<div><b>' + esc(event.name) + (event.edition ? ' · ' + esc(event.edition) : '') + '</b>' +
        '<p class="sub">' + (event.active ? 'Open for entries' : 'Not open') + (eventDates(event) ? ' · ' + esc(eventDates(event)) : '') + '</p>' +
        '<p><b>On-site.</b> ' + esc(onForm) + '</p>' +
        '<p><a href="/api/admin/qr/' + slug + '?mount=events" download="spin-' + esc(event.slug) + '.png">Download PNG</a></p></div></div>';
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

  function mailLabel(mode) {
    if (mode === 'resend') return 'Resend';
    if (mode === 'smtp') return 'Gmail SMTP';
    if (mode === 'gmail') return 'Gmail API';
    return 'not configured — messages stay in the outbox below';
  }
  function renderOutbox(data) {
    var modeLine = {
      resend: 'Resend is on. Recent messages:',
      smtp: 'Gmail SMTP is on (smtp.gmail.com). Recent messages:',
      gmail: 'Gmail API is on. Recent messages:',
      log: 'No email transport is configured. These messages were saved here instead of being sent:'
    };
    document.getElementById('mailMode').textContent = modeLine[data.mode] || modeLine.log;
    var host = document.getElementById('outbox');
    if (!data.records.length) { host.innerHTML = '<p class="sub">No messages yet.</p>'; return; }
    host.innerHTML = data.records.map(function (record) {
      return '<details><summary><b>' + esc(record.status) + '</b> · ' + esc(when(record.at)) + ' · ' + esc(record.to) + ' · ' + esc(record.subject) + '</summary><pre style="white-space:pre-wrap;font:inherit;margin-top:8px">' + esc(record.text) + (record.error ? '\n\n' + esc(record.error) : '') + '</pre></details>';
    }).join('');
  }

  function loadAccounts() {
    return api('/api/admin/users').then(function (data) {
      var host = document.getElementById('accountList');
      host.innerHTML = data.users.map(function (user) {
        return '<div class="account-line" data-testid="account-row"><b>' + esc(user.name) + '</b>' +
          '<span>' + esc(user.email) + '</span>' +
          '<span class="role">' + esc(user.role) + '</span>' +
          '<span class="acts"><button class="mini" type="button" data-user="' + user.id + '" data-user-act="role" data-role="' + (user.role === 'admin' ? 'staff' : 'admin') + '">Make ' + (user.role === 'admin' ? 'staff' : 'admin') + '</button>' +
          '<button class="mini" type="button" data-user="' + user.id + '" data-user-act="password">Reset password</button>' +
          '<button class="mini danger" type="button" data-user="' + user.id + '" data-user-act="delete">Remove</button></span></div>';
      }).join('');
    });
  }

  var mailTestForm = document.getElementById('mailTestForm');
  if (mailTestForm) mailTestForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var button = document.getElementById('mailTestBtn');
    var result = document.getElementById('mailTestResult');
    result.textContent = 'Sending…';
    button.disabled = true;
    api('/api/admin/email-test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: document.getElementById('mailTestTo').value })
    }).then(function (data) {
      var line = data.status === 'sent' ? 'Sent' : (data.status === 'logged' ? 'Saved in the outbox (nothing was emailed)' : 'Not sent');
      result.textContent = line + ' via ' + mailLabel(data.mode) + (data.error ? '. ' + data.error : '.');
      return api('/api/admin/outbox').then(renderOutbox);
    }).catch(function (error) {
      result.textContent = error.message;
    }).finally(function () { button.disabled = false; });
  });

  document.getElementById('accountForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = document.getElementById('accErr');
    err.textContent = '';
    api('/api/admin/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('accName').value,
        email: document.getElementById('accEmail').value,
        role: document.getElementById('accRole').value,
        password: document.getElementById('accPassword').value
      })
    }).then(function () {
      document.getElementById('accountForm').reset();
      document.getElementById('accountForm').hidden = true;
      return loadAccounts();
    }).catch(function (error) { err.textContent = error.message; });
  });
  document.getElementById('accountList').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    var id = btn.dataset.user;
    var act = btn.dataset.userAct;
    var body = { action: act };
    if (act === 'role') body.role = btn.dataset.role;
    if (act === 'password') {
      var password = window.prompt('New password (at least 8 characters)');
      if (!password) return;
      body.password = password;
    }
    if (act === 'delete' && !window.confirm('Remove this account?')) return;
    api('/api/admin/users/' + id, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(loadAccounts).catch(function (error) { alert(error.message); });
  });

  api('/api/admin/session').then(function (session) {
    state.session = session;
    showApp();
    return load();
  }).catch(function () { showLogin(); });
})();
