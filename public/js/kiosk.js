(function () {
  var ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var ROWS = ['ABCDEFGH', 'JKMNPQRS', 'TUVWXYZ', '23456789'];
  var wheel = document.getElementById('wheel');
  var panel = document.getElementById('panel');
  var spinBtn = document.getElementById('spinBtn');
  var stage = document.getElementById('stage');
  var lock = document.getElementById('lock');
  var note = document.getElementById('stageNote');
  var modal = document.getElementById('modal');
  var boot = { slots: [], kioskResetSeconds: 25, invalidResetSeconds: 12, idleResetSeconds: 90, whatsapp: '6588949268' };
  var screenEvent = new URLSearchParams(location.search).get('event') || '';
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
  var focused = null;
  var caps = true;

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
    if (mode === 'spinning' || mode === 'result') return;
    idleTimer = setTimeout(resetAll, (boot.idleResetSeconds || 90) * 1000);
  }
  function startCountdown(seconds, label, el) {
    clearTimeout(resetTimer);
    countLeft = seconds;
    var step = function () {
      if (el) el.textContent = label + ' ' + countLeft + 's';
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
    return fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    }).then(function (res) {
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
      '<p class="kiosk-sub">8 characters from the homeowner’s phone. No O, 0, I, 1 or L.</p>' +
      '<div class="boxes" id="boxes" data-testid="code-boxes"></div>' +
      '<div class="err" id="panelErr" role="alert"></div>' +
      '<div class="keypad"><div class="keys" id="keys"></div>' +
      '<button class="go" id="checkBtn" type="button" data-testid="check-code">Check code</button></div>';
    drawBoxes();
    var keys = $('keys');
    keys.innerHTML = ROWS.map(function (row) {
      return '<div class="row" style="grid-template-columns:repeat(' + row.length + ',1fr)">' + row.split('').map(function (ch) {
        return '<button type="button" data-key="' + ch + '">' + ch + '</button>';
      }).join('') + '</div>';
    }).join('') + '<div class="row" style="grid-template-columns:1fr 1fr"><button type="button" data-act="clear">Clear</button><button type="button" data-act="back">Delete</button></div>';
    keys.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      ac();
      if (btn.dataset.key) pushCode(btn.dataset.key);
      if (btn.dataset.act === 'back') pushCode('back');
      if (btn.dataset.act === 'clear') { code = ''; drawBoxes(); $('panelErr').textContent = ''; }
    });
    $('checkBtn').addEventListener('click', submitCode);
    armIdle();
  }

  function drawBoxes() {
    var boxes = $('boxes');
    if (!boxes) return;
    boxes.innerHTML = '';
    for (var i = 0; i < 8; i++) {
      var cell = document.createElement('i');
      cell.textContent = code[i] || '';
      if (i === code.length) cell.className = 'on';
      boxes.appendChild(cell);
    }
  }
  function pushCode(ch) {
    $('panelErr') && ($('panelErr').textContent = '');
    if (ch === 'back') code = code.slice(0, -1);
    else if (code.length < 8 && ALPHABET.indexOf(ch) >= 0) code += ch;
    else if (ch && ALPHABET.indexOf(ch) < 0 && /[A-Z0-9]/.test(ch)) {
      panel.classList.remove('shake');
      void panel.offsetWidth;
      panel.classList.add('shake');
      if ($('panelErr')) $('panelErr').textContent = '“' + ch + '” isn’t used. Codes skip O, 0, I, 1 and L.';
    }
    drawBoxes();
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
      if (view.state === 'spun') return showAlready(view);
      if (view.canContinue !== true) return showProblem('Code not accepted', 'The server did not confirm this code. Please try again.', true);
      if (view.state === 'ready') return showReady(view);
      if (view.state === 'needs_designer') return showDesigner(view);
      showProblem('Code not accepted', 'The server did not confirm this code. Please try again.', true);
    }).catch(function (error) {
      showProblem(error.status === 404 ? 'Code not recognised' : 'Check that code', error.message, error.status === 404 || error.status === 400 || error.status === 409);
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

  function showDesigner(view) {
    mode = 'designer';
    clearTimers();
    unlockWheel();
    setSpin(false, 'Spin locked');
    note.textContent = 'The wheel unlocks after the interior designer’s details are saved.';
    panel.innerHTML =
      '<div class="verified" data-testid="code-verified"><img src="/img/otter-6.webp" alt="" width="64" height="64"><div>Code verified for <b>' + esc(view.firstName) + '</b><br>Interior designer, enter your details.</div></div>' +
      '<form id="designerForm" class="f">' +
      '<label class="fl"><span>Designer name</span><input name="designer_name" data-pad="text" autocomplete="name" required></label>' +
      '<label class="fl"><span>Designer mobile</span><div class="ph"><b>+65</b><input name="designer_phone" data-pad="num" inputmode="numeric" maxlength="8" required></div></label>' +
      '<label class="fl"><span>Designer email</span><input name="designer_email" data-pad="email" inputmode="email" autocomplete="email" required></label>' +
      '<label class="fl"><span>Interior design company</span><input name="id_company" data-pad="text" autocomplete="organization" required></label>' +
      '<div class="err" id="panelErr"></div>' +
      '<button class="go" type="submit" data-testid="save-designer">Save &amp; unlock the wheel</button>' +
      '</form><div id="osk"></div>';
    var form = $('designerForm');
    form.addEventListener('focusin', function (e) {
      if (e.target.matches('input')) {
        focused = e.target;
        renderKeyboard(e.target.dataset.pad || 'text');
      }
    });
    form.designer_phone.addEventListener('input', function () {
      this.value = this.value.replace(/\D/g, '').slice(0, 8);
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = 'Saving…';
      api('/api/spin/designer', {
        code: code,
        event: screenEvent,
        designer_name: form.designer_name.value,
        designer_phone: form.designer_phone.value,
        designer_email: form.designer_email.value,
        id_company: form.id_company.value
      }).then(function (next) {
        if (!next || next.canContinue !== true) {
          showProblem('Code not accepted', 'The server did not confirm this code. Please try again.', true);
          return;
        }
        sold = next.soldOut || sold;
        SureWinWheel.markSold(wheel, boot.slots, sold);
        showReady(next);
      }).catch(function (error) {
        $('panelErr').textContent = error.message;
        button.disabled = false;
        button.textContent = 'Save & unlock the wheel';
      });
    });
    armIdle();
  }

  function renderKeyboard(kind) {
    var host = $('osk');
    if (!host) return;
    if (kind !== 'text') caps = false;
    var rows;
    if (kind === 'num') {
      rows = [
        ['1', '2', '3'],
        ['4', '5', '6'],
        ['7', '8', '9'],
        ['clear', '0', 'back']
      ];
    } else if (kind === 'email') {
      rows = [
        'qwertyuiop',
        'asdfghjkl',
        'zxcvbnm',
        ['@', '.', '-', '_', 'back']
      ];
    } else {
      rows = [
        'qwertyuiop',
        'asdfghjkl',
        ['caps', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'back'],
        ['space']
      ];
    }
    host.innerHTML = '<div class="osk">' + rows.map(function (row) {
      var chars = typeof row === 'string' ? row.split('') : row;
      return '<div class="row" style="grid-template-columns:repeat(' + chars.length + ',1fr)">' + chars.map(function (ch) {
        var label = ch === 'back' ? '⌫' : ch === 'space' ? 'space' : ch === 'caps' ? (caps ? 'ABC' : 'abc') : ch === 'clear' ? 'Clear' : (caps && ch.length === 1 && /[a-z]/.test(ch) ? ch.toUpperCase() : ch);
        return '<button type="button" data-k="' + ch + '">' + label + '</button>';
      }).join('') + '</div>';
    }).join('') + '</div>';
    host.onclick = function (e) {
      var btn = e.target.closest('button');
      if (!btn || !focused) return;
      var key = btn.dataset.k;
      if (key === 'caps') { caps = !caps; renderKeyboard(kind); return; }
      if (key === 'back') focused.value = focused.value.slice(0, -1);
      else if (key === 'clear') focused.value = '';
      else if (key === 'space') focused.value += ' ';
      else focused.value += (caps && key.length === 1 && /[a-z]/.test(key) ? key.toUpperCase() : key);
      if (focused.name === 'designer_phone') focused.value = focused.value.replace(/\D/g, '').slice(0, 8);
      focused.dispatchEvent(new Event('input', { bubbles: true }));
      armIdle();
    };
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
    $('resKicker').textContent = already ? 'Already used' : 'Congratulations' + (view.firstName ? ', ' + view.firstName : '');
    var label = view.result.label || '';
    $('resTitle').textContent = already
      ? 'This code won ' + (label.charAt(0) === '$' ? 'a ' : 'the ') + label
      : 'You won ' + (label.charAt(0) === '$' ? 'a ' : 'the ') + label + '!';
    $('resBrand').textContent = view.result.brand || '';
    var mailed = view.emailStatus === 'sent' ? 'We emailed the homeowner and the designer. ' : '';
    $('resBody').textContent = already
      ? 'No second spin. The prize is already saved against this code.'
      : 'Saved. ' + mailed + 'The prize goes to the designer within 2 weeks.';
    modal.classList.add('show');
    if (!already) { fanfare(); confetti(); }
    startCountdown(boot.kioskResetSeconds || 25, 'Next homeowner in', $('count'));
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

  function resetAll() {
    spinning = false;
    clearTimers();
    document.querySelectorAll('.confetti').forEach(function (node) { node.remove(); });
    modal.classList.remove('show');
    SureWinWheel.reset(wheel);
    code = '';
    entry = null;
    refreshSold().then(renderCode).catch(function () {});
  }

  function refreshSold() {
    if (!screenEvent) return Promise.resolve();
    return fetch('/api/events/' + encodeURIComponent(screenEvent), { cache: 'no-store' }).then(function (res) {
      return res.json();
    }).then(function (data) {
      if (!data.event) throw new Error(data.error || 'This screen’s event link is not recognised.');
      $('eventLabel').innerHTML = esc(data.event.name) + '<small>' + esc(data.event.edition || 'Sure-Win Spin') + ' · big screen</small>';
      sold = data.soldOut || [];
      SureWinWheel.markSold(wheel, boot.slots, sold);
    }).catch(function (error) {
      panel.innerHTML = '<div class="bad-card"><h3>Screen not ready</h3><p>' + esc(error.message) + '</p></div>';
      throw error;
    });
  }

  document.addEventListener('pointerdown', function () { ac(); armIdle(); }, { passive: true });
  document.addEventListener('keydown', function (e) {
    if (mode !== 'code') return;
    if (e.target && e.target.matches && e.target.matches('input, textarea')) return;
    if (e.key === 'Backspace') { pushCode('back'); e.preventDefault(); }
    else if (e.key === 'Enter') submitCode();
    else if (e.key && e.key.length === 1) pushCode(e.key.toUpperCase());
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
  setInterval(function () { fetch('/api/health', { cache: 'no-store' }).catch(function () {}); }, 45000);

  Promise.all([
    fetch('/api/bootstrap').then(function (res) { return res.json(); }),
    SureWinWheel.mount(wheel)
  ]).then(function (parts) {
    boot = parts[0];
    if (boot.whatsapp) $('waLink').href = 'https://wa.me/' + boot.whatsapp;
    wake();
    return refreshSold();
  }).then(renderCode).catch(function () {});
})();
