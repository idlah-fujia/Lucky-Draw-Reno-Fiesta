(function () {
  var form = document.getElementById('form');
  var err = document.getElementById('err');
  var boot = null;

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function slugFromLocation() {
    var path = location.pathname.match(/\/(?:e|after)\/([^/]+)/);
    if (path) return decodeURIComponent(path[1]);
    return new URLSearchParams(location.search).get('event');
  }
  function isOnSiteHome() {
    return location.pathname === '/events' || location.pathname === '/events/';
  }
  function setErr(message, which) {
    var primary = document.getElementById('err');
    var second = document.getElementById('err2');
    var target = which === 2 ? second : primary;
    if (primary) primary.textContent = target === primary ? (message || '') : '';
    if (second) second.textContent = target === second ? (message || '') : '';
    if (!target && err) err.textContent = message || '';
  }
  function eventLabel(event) {
    return event.edition ? event.name + ' · ' + event.edition : event.name;
  }

  function renderEvent(events, selected) {
    var slot = document.getElementById('eventSlot');
    var hidden = document.getElementById('eventSlug');
    var options = '<option value="">Choose an event</option>' + events.map(function (event) {
      return '<option value="' + esc(event.slug) + '">' + esc(eventLabel(event)) + '</option>';
    }).join('');
    slot.innerHTML = '<label class="fl"><span>Event</span><select id="eventPick" data-testid="event-pick" required>' + options + '</select></label>';
    var pick = document.getElementById('eventPick');
    var chosen = selected && events.some(function (event) { return event.slug === selected; }) ? selected : '';
    pick.value = chosen;
    hidden.value = chosen;
    renderDate(events.find(function (event) { return event.slug === chosen; }) || null);
    pick.addEventListener('change', function () {
      hidden.value = pick.value;
      var event = events.find(function (item) { return item.slug === pick.value; });
      renderDate(event || null);
    });
  }

  function addDay(iso) {
    var parts = iso.split('-').map(Number);
    var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  }

  function eventDays(event) {
    if (!event || !/^\d{4}-\d{2}-\d{2}$/.test(event.starts || '') || !/^\d{4}-\d{2}-\d{2}$/.test(event.ends || '')) return [];
    if (event.starts > event.ends) return [];
    var days = [];
    var cursor = event.starts;
    while (cursor <= event.ends && days.length < 400) {
      days.push(cursor);
      cursor = addDay(cursor);
    }
    return days;
  }

  function renderDate(event) {
    var slot = document.getElementById('dateSlot');
    if (!event) {
      slot.innerHTML = '<label class="fl"><span>Event date</span><select name="event_date" id="eventDate" data-testid="event-date" disabled><option value="">Choose an event first</option></select><div class="ed" id="ed" aria-live="polite"></div></label>';
      return;
    }
    var days = eventDays(event);
    var range = event.starts && event.ends ? (event.starts === event.ends ? event.starts : event.starts + ' to ' + event.ends) : '';
    if (days.length === 1) {
      slot.innerHTML = '<label class="fl"><span>Event date</span><input name="event_date" id="eventDate" data-testid="event-date" value="' + esc(days[0]) + '" readonly required>' +
        '<div class="ed" id="ed" aria-live="polite">Filled from the event' + (range ? ' · ' + esc(range) : '') + '</div></label>';
      return;
    }
    if (days.length > 1) {
      var today = boot && boot.today;
      var preferred = today && days.indexOf(today) >= 0 ? today : '';
      slot.innerHTML = '<label class="fl"><span>Event date</span><select name="event_date" id="eventDate" data-testid="event-date" required>' +
        '<option value="">Choose a day</option>' +
        days.map(function (day) { return '<option value="' + day + '">' + day + '</option>'; }).join('') +
        '</select><div class="ed" id="ed" aria-live="polite">This event runs ' + esc(range) + '. Choose the day.</div></label>';
      if (preferred) document.getElementById('eventDate').value = preferred;
      return;
    }
    slot.innerHTML = '<label class="fl"><span>Event date</span><select name="event_date" id="eventDate" disabled><option value="">No dates on this event</option></select><div class="ed" id="ed">This event has no dates in the config.</div></label>';
  }

  function localPhone(value) {
    var digits = String(value || '').replace(/\D/g, '');
    if (/^65[3689]/.test(digits) && digits.length >= 10) digits = digits.slice(2);
    return digits.slice(0, 8);
  }
  document.getElementById('homePhone').addEventListener('input', function () {
    this.value = localPhone(this.value);
  });
  document.getElementById('designerPhone').addEventListener('input', function () {
    this.value = localPhone(this.value);
  });
  var openTnc = document.getElementById('openTnc');
  if (openTnc) {
    openTnc.addEventListener('click', function () {
      var panel = document.getElementById('tnc');
      if (!panel) return;
      panel.open = true;
      var summary = panel.querySelector('summary');
      if (summary) summary.focus();
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }
  document.getElementById('proof').addEventListener('change', function () {
    var file = this.files[0];
    var box = document.getElementById('upBox');
    var label = document.getElementById('upT');
    if (!file) {
      box.classList.remove('has');
      label.innerHTML = '<b>Add file</b><small>1 photo or PDF · max 10 MB</small>';
      return;
    }
    box.classList.add('has');
    label.innerHTML = '<b>' + esc(file.name) + '</b><small>' + (file.size / 1048576).toFixed(1) + ' MB · tap to change</small>';
  });

  function markStep(n) {
    [1, 2, 3].forEach(function (i) {
      var el = document.getElementById('st' + i);
      if (!el) return;
      el.className = i < n ? 'step done' : i === n ? 'step on' : 'step';
      el.querySelector('i').textContent = i < n ? '✓' : String(i);
    });
  }

  function showStep(n) {
    document.getElementById('step1').hidden = n !== 1;
    document.getElementById('step2').hidden = n !== 2;
    document.getElementById('stepTitle').textContent = n === 2 ? 'Step 2 · Designer details' : 'Step 1 · Homeowner details';
    document.getElementById('stepSub').textContent = n === 2
      ? 'These are saved with the entry. The big screen will not ask for them again.'
      : 'You’ll get a code for the big screen. One spin per homeowner.';
    markStep(n);
    setErr('');
    document.getElementById('formCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function validateHomeowner() {
    var data = new FormData(form);
    var phone = String(data.get('homeowner_phone') || '');
    var file = document.getElementById('proof').files[0];
    if (!data.get('event_slug')) return 'Choose an event.';
    if (!data.get('event_date')) return 'Choose the event date.';
    if (String(data.get('homeowner_name') || '').trim().length < 2) return 'Enter the homeowner’s name.';
    if (!/^[89]\d{7}$/.test(phone)) return 'Enter a valid homeowner mobile (8 digits, starting with 8 or 9).';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(data.get('homeowner_email') || '').trim())) return 'Enter the homeowner’s email.';
    if (!file) return 'Upload the down payment receipt or signed contract.';
    if (file.size > 10 * 1048576) return 'Proof file must be under 10 MB.';
    if (!form.decl_contract.checked || !form.decl_genuine.checked || !form.decl_verify.checked) return 'Please tick all three declarations.';
    if (!form.tnc.checked) return 'Please agree to the terms and conditions.';
    return '';
  }

  function validateDesigner() {
    var data = new FormData(form);
    var phone = String(data.get('designer_phone') || '');
    if (String(data.get('designer_name') || '').trim().length < 2) return 'Enter the designer’s name.';
    if (!/^[3689]\d{7}$/.test(phone)) return 'Enter a valid designer mobile (8 digits, starting with 3, 6, 8 or 9).';
    if (phone === String(data.get('homeowner_phone') || '')) return 'The designer’s number must be different from the homeowner’s number.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(data.get('designer_email') || '').trim())) return 'Enter the designer’s email.';
    if (String(data.get('id_company') || '').trim().length < 2) return 'Enter the interior design company.';
    return '';
  }

  document.getElementById('nextStep').addEventListener('click', function () {
    var problem = validateHomeowner();
    if (problem) return setErr(problem, 1);
    showStep(2);
  });
  document.getElementById('backStep').addEventListener('click', function () {
    showStep(1);
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (document.getElementById('step2').hidden) {
      document.getElementById('nextStep').click();
      return;
    }
    var home = validateHomeowner();
    if (home) { showStep(1); return setErr(home, 1); }
    var designer = validateDesigner();
    if (designer) return setErr(designer, 2);
    var data = new FormData(form);
    var button = document.getElementById('go');
    button.disabled = true;
    button.textContent = 'Saving your entry…';
    data.append('mount', location.pathname.indexOf('/virtual') === 0 ? 'virtual' : 'events')
    var options = { method: 'POST', body: data };
    var signal = timeoutSignal(60000);
    if (signal) options.signal = signal;
    var pending;
    try {
      pending = fetch('/api/entries', options);
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending.then(function (res) {
        return res.json().catch(function () { return { error: 'Something went wrong.' }; }).then(function (json) {
          if (!res.ok) throw new Error(json.error || 'Something went wrong.');
          return json;
        });
      })
      .then(showCode)
      .catch(function (error) {
        var timedOut = error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        setErr(timedOut ? 'This is taking too long. Check your connection. If a code already arrived by email, don’t submit again.' : ((error && error.message) || 'Something went wrong.'), 2);
        button.disabled = false;
        button.textContent = 'Submit & get my spin code';
      });
  });

  function showCode(result) {
    markStep(3);
    document.getElementById('st3').className = 'step on';
    var emailNote = result.emailStatus === 'sent'
      ? 'We also emailed it to <b>' + esc(result.email) + '</b>.'
      : 'Email isn’t sending from this server yet, so the screenshot is what counts. Staff can look the code up if you lose it.';
    var after = result.mode === 'after_event';
    var spinHref = result.spinUrl || ((after ? '/virtual' : '/events') + '/spin?event=' + encodeURIComponent((result.event && result.event.slug) || '') + '&code=' + encodeURIComponent(result.code));
    document.getElementById('formCard').innerHTML =
      '<div class="done-card">' +
      '<img class="done-otter" src="/img/otter-6.webp" alt="">' +
      '<h2>Your spin code, ' + esc(result.firstName) + '</h2>' +
      '<div class="save-banner">Screenshot this page or write the code down before you leave.</div>' +
      '<div class="code-hero" data-testid="spin-code"><small>Spin code</small><b>' + esc(result.codeDisplay) + '</b></div>' +
      '<div class="next-steps">' +
      (after
        ? '<div><i>1</i><span>Save this code. ' + emailNote + '</span></div><div><i>2</i><span>Tap Spin now. The wheel opens on this phone with your code ready.</span></div>'
        : '<div><i>1</i><span>Save this code. ' + emailNote + '</span></div><div><i>2</i><span>Walk to the big screen at the event.</span></div><div><i>3</i><span>Type the code on the big screen. The wheel unlocks straight away, then you spin once.</span></div>') +
      '</div>' +
      '<div class="row-btns">' +
      (after ? '<a class="go" id="spinNow" data-testid="spin-now" href="' + esc(spinHref) + '">Spin now</a>' : '') +
      '<button class="btn-ghost" id="copyBtn" type="button">Copy code</button>' +
      '<a class="btn-wa" id="codeWa" target="_blank" rel="noopener">WhatsApp us</a></div>' +
      '<p class="sub" style="margin-top:12px">The code works once.</p>' +
      '</div>';
    document.getElementById('live').textContent = 'Your spin code is ' + result.codeDisplay;
    var wa = 'https://wa.me/' + (boot && boot.whatsapp ? boot.whatsapp : '6588949268') + '?text=' +
      encodeURIComponent('Hi IDLah, I need help with my Sure-Win Spin code ' + result.codeDisplay + '.');
    document.getElementById('codeWa').href = wa;
    document.getElementById('copyBtn').addEventListener('click', function () {
      var btn = this;
      navigator.clipboard.writeText(result.code).then(function () {
        btn.textContent = 'Copied';
      }).catch(function () { btn.textContent = result.code; });
    });
    document.getElementById('formCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showBlocked(message) {
    document.getElementById('formCard').innerHTML = '<h2>This link can’t be used</h2><p class="sub">' + esc(message) + '</p><p class="sub" style="margin-top:10px">Ask the IDLah booth, or <a id="waLink2" href="https://wa.me/6588949268">WhatsApp us</a>.</p>';
  }

  fetch('/api/bootstrap').then(function (res) { return res.json(); }).then(function (data) {
    boot = data;
    if (boot.whatsapp) document.getElementById('waLink').href = 'https://wa.me/' + boot.whatsapp;
    var slug = slugFromLocation();
    if (!slug && isOnSiteHome() && boot.liveSlug) slug = boot.liveSlug;
    if (!boot.events.length) return showBlocked('No event is open for spins right now.');
    if (!slug) {
      renderEvent(boot.events, '');
      return;
    }
    return fetch('/api/events/' + encodeURIComponent(slug)).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok) throw new Error(json.error || 'That event link is not recognised.');
        return json;
      });
    }).then(function (data) {
      if (!data.event.active) return showBlocked(eventLabel(data.event) + ' is not open for new entries.');
      renderEvent(boot.events, data.event.slug);
    });
  }).catch(function (error) {
    showBlocked(error.message || 'The form could not load. Check the connection and refresh.');
  });
})();
