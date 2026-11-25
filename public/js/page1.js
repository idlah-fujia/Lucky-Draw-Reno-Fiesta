(function () {
  var form = document.getElementById('form');
  var err = document.getElementById('err');
  var boot = null;
  var locked = null;

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function slugFromLocation() {
    var path = location.pathname.match(/^\/e\/([^/]+)/);
    if (path) return decodeURIComponent(path[1]);
    return new URLSearchParams(location.search).get('event');
  }
  function setErr(message) {
    err.textContent = message || '';
  }
  function eventLabel(event) {
    return event.edition ? event.name + ' · ' + event.edition : event.name;
  }

  function renderEvent(events) {
    var slot = document.getElementById('eventSlot');
    var hidden = document.getElementById('eventSlug');
    if (locked) {
      hidden.value = locked.slug;
      slot.innerHTML = '<div class="event-lock"><small>Event attended</small><b>' + esc(eventLabel(locked)) + '</b></div>';
      applyWindow(locked);
      return;
    }
    var options = events.map(function (event) {
      return '<option value="' + esc(event.slug) + '">' + esc(eventLabel(event)) + '</option>';
    }).join('');
    slot.innerHTML = '<label class="fl"><span>Event attended</span><select id="eventPick">' + options + '</select></label>';
    var pick = document.getElementById('eventPick');
    hidden.value = pick.value;
    applyWindow(events.find(function (event) { return event.slug === pick.value; }));
    pick.addEventListener('change', function () {
      hidden.value = pick.value;
      var event = events.find(function (item) { return item.slug === pick.value; });
      applyWindow(event);
      refreshSold(pick.value);
    });
  }

  function applyWindow(event) {
    var input = document.getElementById('eventDate');
    var note = document.getElementById('ed');
    if (!event) { note.textContent = ''; return; }
    if (boot && boot.today) input.max = boot.today;
    if (event.starts) input.min = event.starts;
    if (event.ends && (!boot || event.ends < boot.today)) input.max = event.ends;
    if (!input.value && boot && boot.today >= (event.starts || '') && boot.today <= (event.ends || '9999')) {
      input.value = boot.today;
    }
    note.textContent = event.starts ? 'Event dates: ' + event.starts + ' to ' + event.ends : '';
  }

  function refreshSold(slug) {
    if (!slug || !window.SureWinWheel) return;
    fetch('/api/events/' + encodeURIComponent(slug)).then(function (res) { return res.json(); }).then(function (data) {
      if (boot) SureWinWheel.markSold(document.getElementById('wheel'), boot.slots, data.soldOut || []);
    }).catch(function () {});
  }

  document.getElementById('homePhone').addEventListener('input', function () {
    this.value = this.value.replace(/\D/g, '').slice(0, 8);
  });
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

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    setErr('');
    var data = new FormData(form);
    var phone = String(data.get('homeowner_phone') || '');
    var file = document.getElementById('proof').files[0];
    if (!data.get('event_slug')) return setErr('Choose the event you attended.');
    if (!data.get('event_date')) return setErr('Enter the date you attended.');
    if (String(data.get('homeowner_name') || '').trim().length < 2) return setErr('Enter the homeowner’s name.');
    if (!/^[89]\d{7}$/.test(phone)) return setErr('Enter a valid homeowner mobile (8 digits, starting with 8 or 9).');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(data.get('homeowner_email') || '').trim())) return setErr('Enter the homeowner’s email.');
    if (String(data.get('delivery_address') || '').trim().length < 8) return setErr('Enter the prize delivery address.');
    if (!file) return setErr('Upload the down payment receipt or signed contract.');
    if (file.size > 10 * 1048576) return setErr('Proof file must be under 10 MB.');
    if (!form.decl_contract.checked || !form.decl_genuine.checked || !form.decl_verify.checked) return setErr('Please tick all three declarations.');
    if (!form.tnc.checked) return setErr('Please agree to the terms and conditions.');
    var button = document.getElementById('go');
    button.disabled = true;
    button.textContent = 'Saving your entry…';
    fetch('/api/entries', { method: 'POST', body: data, signal: AbortSignal.timeout(60000) })
      .then(function (res) {
        return res.json().catch(function () { return { error: 'Something went wrong.' }; }).then(function (json) {
          if (!res.ok) throw new Error(json.error || 'Something went wrong.');
          return json;
        });
      })
      .then(showCode)
      .catch(function (error) {
        setErr(error.name === 'TimeoutError' ? 'This is taking too long. Check your connection. If a code already arrived by email, don’t submit again.' : error.message);
        button.disabled = false;
        button.textContent = 'Get my spin code →';
      });
  });

  function showCode(result) {
    document.getElementById('st1').className = 'step done';
    document.getElementById('st1').querySelector('i').textContent = '✓';
    document.getElementById('st2').className = 'step on';
    var emailNote = result.emailStatus === 'sent'
      ? 'We also emailed it to <b>' + esc(result.email) + '</b>.'
      : 'Email isn’t sending from this server yet, so the screenshot is what counts. Staff can look the code up if you lose it.';
    document.getElementById('formCard').innerHTML =
      '<div class="done-card">' +
      '<img class="done-otter" src="/img/otter-6.webp" alt="">' +
      '<h2>Your spin code, ' + esc(result.firstName) + '</h2>' +
      '<div class="save-banner">Screenshot this page or write the code down before you leave.</div>' +
      '<div class="code-hero" data-testid="spin-code"><small>Spin code</small><b>' + esc(result.codeDisplay) + '</b></div>' +
      '<div class="next-steps">' +
      '<div><i>1</i><span>Save this code. ' + emailNote + '</span></div>' +
      '<div><i>2</i><span>Walk to the big screen at the event.</span></div>' +
      '<div><i>3</i><span>Type the code. Your interior designer enters their details, then you spin once.</span></div>' +
      '</div>' +
      '<div class="row-btns"><button class="btn-ghost" id="copyBtn" type="button">Copy code</button>' +
      '<a class="btn-wa" id="codeWa" target="_blank" rel="noopener">WhatsApp us</a></div>' +
      '<p class="sub" style="margin-top:12px">The code works once. Don’t share it until you’re at the wheel.</p>' +
      '</div>';
    document.getElementById('lock').innerHTML = '<div><b>🎟️</b>See you at the big screen</div>';
    document.getElementById('stageNote').textContent = 'Code ' + result.codeDisplay + ' · one spin on the LED screen.';
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

  Promise.all([
    fetch('/api/bootstrap').then(function (res) { return res.json(); }),
    SureWinWheel.mount(document.getElementById('wheel'))
  ]).then(function (parts) {
    boot = parts[0];
    if (boot.whatsapp) document.getElementById('waLink').href = 'https://wa.me/' + boot.whatsapp;
    var slug = slugFromLocation();
    if (!slug) {
      if (!boot.events.length) return showBlocked('No event is open for spins right now.');
      renderEvent(boot.events);
      refreshSold(document.getElementById('eventSlug').value);
      return;
    }
    return fetch('/api/events/' + encodeURIComponent(slug)).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok) throw new Error(json.error || 'That event link is not recognised.');
        return json;
      });
    }).then(function (data) {
      if (!data.event.active) return showBlocked(eventLabel(data.event) + ' is not open for new entries.');
      locked = data.event;
      renderEvent(boot.events);
      SureWinWheel.markSold(document.getElementById('wheel'), boot.slots, data.soldOut || []);
    });
  }).catch(function (error) {
    showBlocked(error.message || 'The form could not load. Check the connection and refresh.');
  });
})();
