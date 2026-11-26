(function () {
  var ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var onVirtualSpin = location.pathname.indexOf('/virtual') === 0;
  if (onVirtualSpin) {
    var hint = document.getElementById('eventHint');
    if (hint) hint.textContent = 'Enter the code from your spin link';
  }
  var wheel = document.getElementById('wheel');
  var panel = document.getElementById('panel');
  var spinBtn = document.getElementById('spinBtn');
  var stage = document.getElementById('stage');
  var lock = document.getElementById('lock');
  var note = document.getElementById('stageNote');
  var modal = document.getElementById('modal');
  var boot = { slots: [], kioskResetSeconds: 120, invalidResetSeconds: 12, idleResetSeconds: 90, whatsapp: '6588949268' };
  var screenEvent = new URLSearchParams(location.search).get('event') || '';
  var presetRaw = new URLSearchParams(location.search).get('code') || '';
  if (presetRaw) document.body.classList.add('spin-prefilled');
  var qrPosition = 'top-center';
  var mode = 'code';
  var code = '';
  var entry = null;
  var sold = [];
  var muted = false;
  var spinning = false;
  var resetTimer = null;
  var idleTimer = null;
  var countLeft = 0;
  var AC = null;

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(id) { return document.getElementById(id); }

  function ac() {
    if (muted) return null;
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; } }
    if (AC && AC.state === 'suspended') AC.resume();
    return AC;
  }
  function tone(ctx, f, t0, dur, type, vol, f2) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function tick() { var ctx = ac(); if (!ctx) return; tone(ctx, 1500, ctx.currentTime, 0.045, 'triangle', 0.22, 500); }
  function fanfare() {
    var ctx = ac(); if (!ctx) return;
    var t = ctx.currentTime + 0.05;
    [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) { tone(ctx, f, t + i * 0.11, 0.22, 'triangle', 0.25); });
    [523.25, 659.25, 783.99, 1046.5].forEach(function (f) { tone(ctx, f, t + 0.48, 0.9, 'sine', 0.12); });
  }
  function tickLoop() {
    var last = null, acc = 0;
    (function frame() {
      var m = getComputedStyle(wheel).transform;
      if (m && m !== 'none') {
        var v = m.split('(')[1].split(',');
        var a = Math.atan2(+v[1], +v[0]) * 180 / Math.PI;
        if (last !== null) {
          var d = a - last;
          if (d < -180) d += 360;
          if (d > 180) d -= 360;
          acc += Math.abs(d);
          if (acc >= 11.25) { acc %= 11.25; tick(); }
        }
        last = a;
      }
      if (spinning) requestAnimationFrame(frame);
    })();
  }
  function confetti() {
    var c = document.createElement('div');
    c.className = 'confetti';
    var cols = ['#FFD23F', '#FF7A1A', '#E6246E', '#8B2BE2', '#19B36B', '#fff'];
    for (var i = 0; i < 90; i++) {
      var p = document.createElement('i');
      p.style.left = Math.random() * 100 + 'vw';
      p.style.background = cols[i % cols.length];
      p.style.animationDuration = (2.2 + Math.random() * 1.8) + 's';
      p.style.animationDelay = Math.random() * 0.4 + 's';
      p.style.setProperty('--dx', (Math.random() * 200 - 100) + 'px');
      p.style.setProperty('--r', Math.random() * 720 + 'deg');
      c.appendChild(p);
    }
    document.body.appendChild(c);
    setTimeout(function () { c.remove(); }, 4800);
  }

  function clearTimers() {
    clearTimeout(resetTimer);
    clearTimeout(idleTimer);
    resetTimer = null;
  }
  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = null;
    // The result pop-up uses kioskResetSeconds (2 minutes). The shorter idle
    // timer must not dismiss that pop-up, including after a tap on the screen.
    if (mode === 'spinning' || mode === 'result') return;
    idleTimer = setTimeout(resetAll, (boot.idleResetSeconds || 90) * 1000);
  }
  function closingClock(seconds) {
    var whole = Math.max(0, Math.floor(Number(seconds) || 0));
    var minutes = Math.floor(whole / 60);
    var rest = whole % 60;
    return minutes + ':' + (rest < 10 ? '0' : '') + rest;
  }
  function startCountdown(seconds, label, el, asClock) {
    clearTimeout(resetTimer);
    countLeft = seconds;
    var step = function () {
      if (el) el.textContent = label + ' ' + (asClock ? closingClock(countLeft) : countLeft + 's');
      if (countLeft <= 0) { resetAll(); return; }
      countLeft -= 1;
      resetTimer = setTimeout(step, 1000);
    };
    step();
  }

  function setLock(text) {
    lock.style.opacity = '';
    lock.innerHTML = '<div>' + text + '</div>';
    stage.classList.remove('unlocked');
  }
  function unlockWheel() {
    stage.classList.add('unlocked');
    lock.innerHTML = '';
  }
  function setSpin(ready, label) {
    spinBtn.disabled = !ready;
    spinBtn.className = ready ? 'spin-btn ready' : 'spin-btn';
    spinBtn.textContent = label;
  }

  function api(path, body) {
    var payload = body || {}
    if (path.indexOf('/api/spin/') === 0) {
      payload = Object.assign({}, payload)
      payload.mount = location.pathname.indexOf('/virtual') === 0 ? 'virtual' : 'events'
      if (payload.mount === 'virtual') delete payload.event
    }
    var options = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    };
    var signal = timeoutSignal(20000);
    if (signal) options.signal = signal;
    var pending;
    try {
      pending = fetch(path, options);
    } catch (error) {
      return Promise.reject(error);
    }
    return pending.then(function (res) {
      return res.json().catch(function () { return { error: 'Something went wrong.' }; }).then(function (json) {
        if (!res.ok) {
          var error = new Error(json.error || 'Something went wrong.');
          error.status = res.status;
          throw error;
        }
        return json;
      });
    });
  }

  function layoutLed() {
    var vw = window.innerWidth || document.documentElement.clientWidth || 1080;
    var vh = window.innerHeight || document.documentElement.clientHeight || 1920;
    var img = $('kioskQrImg');
    var box = document.querySelector('.wheel-box');
    if (!box) return;
    var portrait = vh >= vw;
    var qr = portrait ? Math.min(vw * 0.34, vh * 0.18) : Math.min(vh * 0.22, vw * 0.22);
    qr = Math.round(Math.max(72, qr));
    function paintQr(px) {
      if (!img) return;
      img.style.width = px + 'px';
      img.style.height = px + 'px';
      img.style.maxWidth = 'none';
      img.style.maxHeight = 'none';
      img.style.objectFit = 'contain';
    }
    paintQr(qr);
    box.style.width = '1px';
    box.style.height = '1px';
    var side = document.querySelector('.led-side');
    var btn = $('spinBtn');
    var noteEl = $('stageNote');
    var sideBottom = side ? side.getBoundingClientRect().bottom : vh * 0.35;
    var tail = (btn ? btn.offsetHeight : 48) + (noteEl ? noteEl.offsetHeight : 20) + 28;
    var remain = vh - sideBottom - tail;
    var want = Math.round(vw * (portrait ? 0.85 : 0.6));
    if (portrait && remain < want) {
      var nextQr = Math.max(72, Math.round(qr - (want - remain)));
      paintQr(nextQr);
      sideBottom = side ? side.getBoundingClientRect().bottom : sideBottom;
      remain = vh - sideBottom - tail;
    }
    var size = Math.round(Math.max(120, Math.min(want, remain)));
    if (!portrait) {
      var stage = document.querySelector('.kiosk-stage');
      var stageRoom = stage ? Math.min(stage.clientWidth, stage.clientHeight) : vh * 0.6;
      var usedTail = (btn ? btn.offsetHeight : 48) + (noteEl ? noteEl.offsetHeight : 20) + 16;
      size = Math.round(Math.max(160, Math.min(stageRoom - usedTail, vh * 0.72)));
    }
    box.style.width = size + 'px';
    box.style.height = size + 'px';
    box.style.maxWidth = 'none';
    box.style.maxHeight = 'none';
  }

  function renderCode() {
    mode = 'code';
    code = '';
    entry = null;
    modal.classList.remove('show');
    setLock('<b>🔒</b>Enter a spin code to unlock');
    setSpin(false, 'Spin locked');
    note.textContent = 'One spin per code. Every spin wins.';
    panel.innerHTML =
      '<div class="kiosk-title">Enter your spin code</div>' +
      '<p class="kiosk-sub">' + (onVirtualSpin ? '8 characters from your spin link. No O, 0, I, 1 or L.' : '8 characters from the homeowner’s phone. No O, 0, I, 1 or L.') + '</p>' +
      '<div class="code-row">' +
      '<input id="codeInput" class="code-entry" data-testid="code-input" type="text" inputmode="text" maxlength="24" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" aria-label="Spin code" autofocus>' +
      '<button class="go" id="checkBtn" type="button" data-testid="check-code">Check code</button>' +
      '</div>' +
      '<div class="err" id="panelErr" role="alert"></div>';
    var input = $('codeInput');
    input.addEventListener('input', function () { applyCodeInput(input); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submitCode(); }
    });
    $('checkBtn').addEventListener('click', submitCode);
    input.focus({ preventScroll: true });
    armIdle();
    layoutLed();
  }

  function applyCodeInput(input) {
    var raw = String(input.value || '').toUpperCase().replace(/[\s-]/g, '');
    var next = '';
    var skipped = '';
    for (var i = 0; i < raw.length; i++) {
      var ch = raw.charAt(i);
      if (ALPHABET.indexOf(ch) >= 0) {
        if (next.length < 8) next += ch;
      } else if (/[A-Z0-9]/.test(ch)) skipped = ch;
    }
    if (input.value !== next) input.value = next;
    code = next;
    if ($('panelErr')) {
      $('panelErr').textContent = skipped ? '“' + skipped + '” isn’t used. Codes skip O, 0, I, 1 and L.' : '';
    }
    if (skipped) {
      panel.classList.remove('shake');
      void panel.offsetWidth;
      panel.classList.add('shake');
    }
    armIdle();
  }

  function submitCode() {
    if (code.length !== 8) {
      $('panelErr').textContent = 'Enter all 8 characters.';
      return;
    }
    $('checkBtn').disabled = true;
    $('checkBtn').textContent = 'Checking…';
    api('/api/spin/lookup', { code: code, event: screenEvent }).then(function (view) {
      sold = view.soldOut || [];
      SureWinWheel.markSold(wheel, boot.slots, sold);
      entry = view;
      if (view.state === 'voided') return showProblem('This code has been voided', 'Please see the IDLah booth. This spin can’t be used.', false);
      if (view.state === 'spam') return showProblem('This code can’t be used', 'Please see the IDLah booth.', false);
      if (view.state === 'spun') return showAlready(view);
      if (view.state === 'needs_designer') {
        return showProblem('Designer details missing', 'This code has no interior designer on it, so it can’t spin. Please see the IDLah booth.', true);
      }
      if (view.state === 'ready' && view.canContinue === true) return showReady(view);
      showProblem('Code not accepted', 'The server did not confirm this code. Please try again.', true);
    }).catch(function (error) {
      var timedOut = error && (error.name === 'AbortError' || error.name === 'TimeoutError');
      var title = error && error.status === 404 ? 'Code not recognised' : (timedOut ? 'Taking too long' : 'Check that code');
      var message = timedOut
        ? 'This is taking too long. Check the connection and try again.'
        : ((error && error.message) || 'Something went wrong.');
      try {
        showProblem(title, message, !!(error && (error.status === 404 || error.status === 400 || error.status === 409)));
      } catch (again) {
        var btn = $('checkBtn');
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Check code';
        }
        if ($('panelErr')) $('panelErr').textContent = message;
      }
    });
  }

  function showProblem(title, message, countdown) {
    mode = 'error';
    setLock('<b>!</b>Code not accepted');
    setSpin(false, 'Spin locked');
    panel.innerHTML =
      '<div class="bad-card" data-testid="code-error"><h3>' + esc(title) + '</h3><p>' + esc(message) + '</p>' +
      (code ? '<p style="margin-top:8px;font-weight:900;letter-spacing:.12em">' + esc(code) + '</p>' : '') +
      '</div><button class="go" id="againBtn" type="button" style="margin-top:16px">Try again</button>' +
      '<div class="count" id="panelCount"></div>';
    $('againBtn').addEventListener('click', resetAll);
    if (countdown) startCountdown(boot.invalidResetSeconds || 12, 'Back to the start in', $('panelCount'));
    else armIdle();
  }

  function showReady(view) {
    mode = 'ready';
    entry = view;
    clearTimers();
    unlockWheel();
    setSpin(true, 'Spin now');
    note.textContent = '1 spin only. Every spin wins.';
    var who = view.designer ? esc(view.designer.name) + ' · ' + esc(view.designer.company) : '';
    panel.innerHTML =
      '<div class="ready-copy" data-testid="wheel-unlocked"><img class="done-otter" src="/img/otter-6.webp" alt="">' +
      '<div class="verified"><div>Wheel unlocked for <b>' + esc(view.firstName) + '</b>' +
      (who ? '<br>' + who : '') + '</div></div>' +
      '<div class="kiosk-title" style="margin-top:16px">Press Spin now</div>' +
      '<p class="kiosk-sub">The button is under the wheel. One spin, then the screen resets for the next homeowner.</p></div>';
    armIdle();
  }

  function showAlready(view) {
    mode = 'result';
    entry = view;
    setSpin(false, 'Spin used');
    note.textContent = 'This code has already been used.';
    unlockWheel();
    panel.innerHTML = '<div class="ready-copy"><div class="kiosk-title">Already used</div><p class="kiosk-sub">This code won ' + esc(view.result.label) + '. No second spin.</p></div>';
    SureWinWheel.landOn(wheel, view.result.slot, false).then(function () {
      openResult(view, true);
    });
  }

  function openResult(view, already) {
    mode = 'result';
    clearTimers();
    $('resKicker').textContent = already
      ? 'Already used'
      : (view.firstName ? 'Congratulations, ' + view.firstName + '!' : 'Congratulations!');
    var label = view.result.label || '';
    $('resTitle').textContent = already
      ? 'This code won ' + (label.charAt(0) === '$' ? 'a ' : 'the ') + label
      : 'You won ' + (label.charAt(0) === '$' ? 'a ' : 'the ') + label + '!';
    $('resBrand').textContent = view.result.brand || '';
    $('resBody').textContent = already
      ? 'No second spin. The prize is already saved against this code.'
      : (view.emailStatus === 'sent'
        ? 'Your prize is confirmed and recorded, and we’ve emailed you and your interior designer the details. Please check your email for instructions on how to claim it.'
        : 'Your prize is confirmed and recorded. Screenshot this pop-up. Email isn’t sending from this server yet.');
    modal.classList.add('show');
    if (!already) { fanfare(); confetti(); }
    startCountdown(boot.kioskResetSeconds || 120, 'Closing in', $('count'), true);
  }

  function doSpin() {
    if (spinning || mode !== 'ready' || !entry) return;
    spinning = true;
    mode = 'spinning';
    clearTimers();
    setSpin(false, 'Spinning…');
    ac();
    api('/api/spin/go', { code: code, event: screenEvent }).then(function (view) {
      sold = view.soldOut || sold;
      SureWinWheel.markSold(wheel, boot.slots, sold);
      entry = view;
      tickLoop();
      return SureWinWheel.landOn(wheel, view.result.slot, !view.already).then(function () {
        spinning = false;
        setSpin(false, 'Spin used');
        openResult(view, !!view.already);
      });
    }).catch(function (error) {
      spinning = false;
      mode = 'ready';
      setSpin(true, 'Spin now');
      note.textContent = error.message;
      armIdle();
    });
  }

  function applyKioskQr(data) {
    var host = $('kioskQr');
    var img = $('kioskQrImg');
    var caption = $('kioskQrCaption');
    if (!host || !data || !data.event) return;
    if (!screenEvent) screenEvent = data.event.slug;
    var qr = data.qr || {};
    qrPosition = qr.position || 'top-center';
    host.dataset.position = qrPosition;
    var qrSize = qr.unit === 'px' ? (qr.size + 'px') : ((qr.size || 16) + 'vw');
    host.style.setProperty('--qr-size', qrSize);
    var column = document.querySelector('.led-column');
    if (column) column.style.setProperty('--qr-size', qrSize);
    var src = '/api/kiosk/qr.png?event=' + encodeURIComponent(data.event.slug) + '&mount=' + (location.pathname.indexOf('/virtual') === 0 ? 'virtual' : 'events');
    if (img.getAttribute('src') !== src) img.src = src;
    img.alt = 'QR code to register for ' + (data.event.name || 'this event');
    if (caption) caption.textContent = 'Scan to register for your spin';
    if (img) img.onload = layoutLed;
    layoutLed();
  }

  function loadKioskQr() {
    var mount = location.pathname.indexOf('/virtual') === 0 ? 'virtual' : 'events';
    var query = '?mount=' + mount + (screenEvent ? '&event=' + encodeURIComponent(screenEvent) : '');
    return fetch('/api/kiosk/display' + query, { cache: 'no-store' }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.error || 'Registration QR is not ready.');
        applyKioskQr(data);
      });
    }).catch(function (error) {
      var caption = $('kioskQrCaption');
      if (caption) caption.textContent = error.message || 'Registration QR is not ready.';
    });
  }

  function scrollToQr() {
    var scroll = $('kioskScroll');
    var host = $('kioskQr');
    if (!scroll) return;
    if (qrPosition.indexOf('bottom') === 0 && host) host.scrollIntoView({ block: 'end' });
    else scroll.scrollTop = 0;
  }

  function resetAll() {
    spinning = false;
    clearTimers();
    document.querySelectorAll('.confetti').forEach(function (node) { node.remove(); });
    modal.classList.remove('show');
    SureWinWheel.reset(wheel);
    code = '';
    entry = null;
    refreshSold().then(function () {
      renderCode();
      scrollToQr();
    }).catch(function () {});
  }

  function refreshSold() {
    if (!screenEvent) return Promise.resolve();
    return fetch('/api/events/' + encodeURIComponent(screenEvent), { cache: 'no-store' }).then(function (res) {
      return res.json();
    }).then(function (data) {
      if (!data.event) throw new Error(data.error || 'This screen’s event link is not recognised.');
      $('eventLabel').innerHTML = esc(data.event.name) + '<small>' + esc(data.event.edition || 'Sure-Win Spin') + (onVirtualSpin ? ' · spin on this phone' : ' · big screen') + '</small>';
      sold = data.soldOut || [];
      SureWinWheel.markSold(wheel, boot.slots, sold);
    }).catch(function (error) {
      panel.innerHTML = '<div class="bad-card"><h3>Screen not ready</h3><p>' + esc(error.message) + '</p></div>';
      throw error;
    });
  }

  document.addEventListener('pointerdown', function () { ac(); armIdle(); }, { passive: true });
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!el || !el.matches || el.id === 'codeInput') return;
    if (!el.matches('input[type="text"], textarea')) return;
    var upper = String(el.value || '').toUpperCase();
    if (el.value !== upper) {
      var pos = el.selectionStart;
      el.value = upper;
      if (typeof el.setSelectionRange === 'function' && pos != null) el.setSelectionRange(pos, pos);
    }
  });
  spinBtn.addEventListener('click', doSpin);
  $('nextBtn').addEventListener('click', resetAll);
  $('muteBtn').addEventListener('click', function () {
    muted = !muted;
    this.textContent = muted ? 'Sound off' : 'Sound on';
    this.setAttribute('aria-pressed', muted ? 'true' : 'false');
    if (!muted) ac();
  });
  $('fullBtn').addEventListener('click', function () {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(function () {});
    else document.exitFullscreen();
  });

  function wake() {
    if (!navigator.wakeLock) return;
    navigator.wakeLock.request('screen').catch(function () {});
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') wake();
  });
  window.addEventListener('resize', layoutLed);
  window.addEventListener('orientationchange', layoutLed);
  layoutLed();
  setInterval(function () { fetch('/api/health', { cache: 'no-store' }).catch(function () {}); }, 45000);
  setInterval(loadKioskQr, 20000);

  Promise.all([
    fetch('/api/bootstrap').then(function (res) { return res.json(); }),
    SureWinWheel.mount(wheel)
  ]).then(function (parts) {
    boot = parts[0];
    if (boot.whatsapp) $('waLink').href = 'https://wa.me/' + boot.whatsapp;
    wake();
    return loadKioskQr();
  }).then(refreshSold).then(function () {
    if (presetRaw) return openPreset(presetRaw);
    renderCode();
    scrollToQr();
    layoutLed();
  }).catch(function () { layoutLed(); });

  function openPreset(raw) {
    var compact = String(raw || '').toUpperCase().replace(/[\s-]/g, '');
    var bad = compact.split('').some(function (ch) { return ALPHABET.indexOf(ch) < 0; });
    code = compact.split('').filter(function (ch) {
      return ALPHABET.indexOf(ch) >= 0;
    }).join('').slice(0, 8);
    if (bad || code.length !== 8) {
      document.documentElement.classList.remove('spin-prefilled');
      document.body.classList.remove('spin-prefilled');
      renderCode();
      var input = $('codeInput');
      if (input) input.value = compact.slice(0, 24);
      if ($('panelErr')) $('panelErr').textContent = 'Check the code: 8 characters, no O, 0, I, 1 or L';
      return;
    }
    return api('/api/spin/lookup', { code: code, event: screenEvent }).then(function (view) {
      sold = view.soldOut || [];
      SureWinWheel.markSold(wheel, boot.slots, sold);
      entry = view;
      if (view.state === 'ready' && view.canContinue === true) return showReady(view);
      document.documentElement.classList.remove('spin-prefilled');
      document.body.classList.remove('spin-prefilled');
      if (view.state === 'voided') return showProblem('This code has been voided', 'Please see the IDLah booth. This spin can’t be used.', false);
      if (view.state === 'spam') return showProblem('This code can’t be used', 'Please see the IDLah booth.', false);
      if (view.state === 'spun') return showAlready(view);
      showProblem('Code not accepted', view.state === 'needs_designer'
        ? 'This code has no interior designer on it, so it can’t spin.'
        : 'The server did not confirm this code. Please try again.', true);
    }).catch(function (error) {
      document.documentElement.classList.remove('spin-prefilled');
      document.body.classList.remove('spin-prefilled');
      showProblem(error.status === 404 ? 'Code not recognised' : 'Check that code', error.message, true);
    });
  }
})();
