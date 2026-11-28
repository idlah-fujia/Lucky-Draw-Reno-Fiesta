/* Attract overlay for the kiosk spin page.
   IDLE_SECONDS matches the supplied idle screen. A tap hides it and does not
   reach the wheel. It stays away while a spin or a prize result is showing. */
(function () {
  var IDLE_SECONDS = 45;
  var root = document.getElementById('rf-idle');
  if (!root) return;

  var PRIZES = [
    { img: '/img/idle/iphone-18-pro-max.webp', fit: 'fill', tag: 'Grand prize', name: 'iPhone 18 Pro Max', note: 'Grand prize: iPhone 18 Pro Max or iPhone Duo' },
    { img: '/img/idle/iphone-duo.webp', fit: 'fit', tag: 'Grand prize', name: 'iPhone Duo', note: 'Grand prize: iPhone Duo or iPhone 18 Pro Max' },
    { img: '/img/idle/dyson-supersonic.webp', fit: 'fill', tag: 'Top prize', name: 'Dyson Supersonic', note: 'The hair dryer everyone wants' },
    { img: '/img/idle/car-vacuum.webp', fit: 'fill', tag: 'Top prize', name: 'Car vacuum', note: 'Handheld cordless vacuum for your car' },
    { img: '/img/idle/ikea.webp', fit: 'fit', tag: 'Vouchers', name: 'IKEA gift card', note: 'Furnish your new home' },
    { img: '/img/idle/fairprice.webp', fit: 'fit', tag: 'Vouchers', name: 'FairPrice vouchers', note: 'Stock up your new kitchen' },
    { img: '/img/idle/grab.webp', fit: 'fit', tag: 'Vouchers', name: 'Grab vouchers', note: 'For Ride, Food or Mart' }
  ];
  var TICKER = ['iPhone 18 Pro Max', 'iPhone Duo', 'Dyson Supersonic', 'Car vacuum', 'IKEA gift cards', 'FairPrice vouchers', 'Grab vouchers', 'Every spin wins!'];
  var SEGS = [
    ['$40', '#5B1E8C'], ['Grab', '#E6246E'], ['$100', '#FF7A1A'], ['IKEA', '#7B3FC4'], ['$60', '#E6246E'], ['Dyson', '#2A1150'],
    ['$80', '#FF7A1A'], ['FairPrice', '#5B1E8C'], ['$200', '#E6246E'], ['Grab', '#FF7A1A'], ['iPhone', '#C99700'], ['$40', '#7B3FC4']
  ];

  function $(id) { return document.getElementById(id); }

  var n = SEGS.length;
  var slice = 2 * Math.PI / n;
  var R = 100;
  var svg = '<circle r="108" fill="#2A1150"/><circle r="104" fill="none" stroke="#FFD23F" stroke-width="3"/>';
  SEGS.forEach(function (seg, i) {
    var label = seg[0];
    var col = seg[1];
    var a0 = i * slice - Math.PI / 2 - slice / 2;
    var a1 = a0 + slice;
    var p = function (t) { return (R * Math.cos(t)).toFixed(2) + ' ' + (R * Math.sin(t)).toFixed(2); };
    var mid = (a0 + a1) / 2 * 180 / Math.PI;
    var size = label.length > 6 ? 10 : label.length > 4 ? 12 : 15;
    svg += '<path d="M0 0L' + p(a0) + 'A' + R + ' ' + R + ' 0 0 1 ' + p(a1) + 'Z" fill="' + col + '" stroke="rgba(255,255,255,.35)" stroke-width=".8"/>';
    svg += '<text transform="rotate(' + mid + ') translate(66 0)" text-anchor="middle" dominant-baseline="central" fill="#fff" font-family="DM Sans" font-weight="900" font-size="' + size + '">' + label + '</text>';
  });
  svg += '<g class="bulbs">' + Array.from({ length: 24 }, function (_, i) {
    var t = i / 24 * 2 * Math.PI;
    return '<circle cx="' + (106 * Math.cos(t)).toFixed(2) + '" cy="' + (106 * Math.sin(t)).toFixed(2) + '" r="2.6" fill="#FFD23F"/>';
  }).join('') + '</g>';
  $('rf-wheel').innerHTML = svg;

  function tile(prize, index) {
    return '<img src="' + prize.img + '" alt="' + prize.name + '" class="' + prize.fit + (index ? '' : ' on') + '">';
  }
  $('rf-ph').innerHTML = PRIZES.map(tile).join('');
  $('rf-thumbs').innerHTML = PRIZES.map(tile).join('');
  var pImgs = $('rf-ph').querySelectorAll('img');
  var tImgs = $('rf-thumbs').querySelectorAll('img');
  var pi = 0;
  setInterval(function () {
    pImgs[pi].classList.remove('on');
    tImgs[pi].classList.remove('on');
    pi = (pi + 1) % PRIZES.length;
    pImgs[pi].classList.add('on');
    tImgs[pi].classList.add('on');
    $('rf-ptag').textContent = PRIZES[pi].tag;
    $('rf-pname').textContent = PRIZES[pi].name;
    $('rf-pnote').textContent = PRIZES[pi].note;
  }, 3800);

  var items = TICKER.map(function (text) { return '<i>' + text + '</i>'; }).join('');
  $('rf-track').innerHTML = items + items;

  var qr = $('rf-qr');
  function syncQr() {
    var pageQr = $('kioskQrImg');
    if (!pageQr || !qr) return;
    var src = pageQr.getAttribute('src');
    if (!src) {
      qr.hidden = true;
      return;
    }
    if (qr.getAttribute('src') !== src) qr.setAttribute('src', src);
    qr.hidden = false;
  }
  var pageQr = $('kioskQrImg');
  if (pageQr) {
    new MutationObserver(syncQr).observe(pageQr, { attributes: true, attributeFilter: ['src'] });
    pageQr.addEventListener('load', syncQr);
  }
  qr.onerror = function () { qr.hidden = true; };
  syncQr();

  var cv = $('rf-confetti');
  var cx = cv.getContext('2d');
  var COLS = ['#FFD23F', '#FF7A1A', '#E6246E', '#ffffff', '#9b5cf0'];
  var W = 0;
  var H = 0;
  var bits = [];
  function size() {
    W = cv.width = root.clientWidth;
    H = cv.height = root.clientHeight;
  }
  function mk(top) {
    return {
      x: Math.random() * W,
      y: top ? -20 : Math.random() * H,
      w: 6 + Math.random() * 8,
      h: 4 + Math.random() * 6,
      vy: 0.6 + Math.random() * 1.4,
      vx: -0.4 + Math.random() * 0.8,
      r: Math.random() * 6,
      vr: -0.05 + Math.random() * 0.1,
      c: COLS[Math.random() * COLS.length | 0]
    };
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(size).observe(root);
  else window.addEventListener('resize', size);
  size();
  bits = Array.from({ length: 70 }, function () { return mk(false); });
  var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function draw() {
    if (!root.classList.contains('off') && !still) {
      cx.clearRect(0, 0, W, H);
      for (var i = 0; i < bits.length; i++) {
        var b = bits[i];
        b.y += b.vy;
        b.x += b.vx + Math.sin(b.y / 40) * 0.3;
        b.r += b.vr;
        if (b.y > H + 20) {
          var next = mk(true);
          b.x = next.x; b.y = next.y; b.w = next.w; b.h = next.h;
          b.vy = next.vy; b.vx = next.vx; b.r = next.r; b.vr = next.vr; b.c = next.c;
        }
        cx.save();
        cx.translate(b.x, b.y);
        cx.rotate(b.r);
        cx.fillStyle = b.c;
        cx.globalAlpha = 0.85;
        cx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
        cx.restore();
      }
    }
    requestAnimationFrame(draw);
  }
  draw();

  // Standalone page (/idle). The spin page has no data-idle attribute, so the
  // overlay listeners below are unchanged.
  if (document.body.dataset.idle === 'page') {
    var eventSlug = new URLSearchParams(location.search).get('event') || '';
    var eventQuery = eventSlug ? '?event=' + encodeURIComponent(eventSlug) : '';
    if (qr) {
      qr.onerror = function () { qr.hidden = true; };
      qr.src = '/api/kiosk/qr.png?mount=events' + (eventSlug ? '&event=' + encodeURIComponent(eventSlug) : '');
      qr.hidden = false;
    }
    var spinUrl = '/events/spin' + eventQuery;
    root.addEventListener('click', function () {
      location.assign(spinUrl);
    });
    return;
  }

  var timer = null;
  var pressOnOverlay = false;
  function busy() {
    var mode = document.documentElement.dataset.kioskMode || '';
    if (mode === 'spinning' || mode === 'result') return true;
    var modal = $('modal');
    return !!(modal && modal.classList.contains('show'));
  }
  function setUnderlayInert(on) {
    var scroll = $('kioskScroll');
    if (scroll) scroll.inert = on;
  }
  function arm() {
    clearTimeout(timer);
    timer = setTimeout(show, IDLE_SECONDS * 1000);
  }
  function hide() {
    if (root.classList.contains('off')) return;
    root.classList.add('off');
    root.setAttribute('aria-hidden', 'true');
    arm();
  }
  function release() {
    setUnderlayInert(false);
    var input = $('codeInput');
    var kioskMode = document.documentElement.dataset.kioskMode || '';
    if (input && kioskMode === 'code' && input.offsetParent !== null) {
      try { input.focus({ preventScroll: true }); } catch (e) {}
    }
  }
  function show() {
    timer = null;
    if (busy()) {
      arm();
      return;
    }
    var active = document.activeElement;
    if (active && active !== document.body && typeof active.blur === 'function') {
      try { active.blur(); } catch (e) {}
    }
    root.classList.remove('off');
    root.removeAttribute('aria-hidden');
    setUnderlayInert(true);
  }
  function conceal() {
    clearTimeout(timer);
    timer = null;
    root.classList.add('off');
    root.setAttribute('aria-hidden', 'true');
    setUnderlayInert(false);
  }

  var clearPress = null;
  root.addEventListener('pointerdown', function () {
    if (root.classList.contains('off')) return;
    pressOnOverlay = true;
    clearTimeout(clearPress);
  }, true);
  // Hide on pointerup, but keep swallowing the click that follows. Setting
  // pointer-events:none before that click can retarget it onto Spin now.
  document.addEventListener('pointerup', function () {
    if (!pressOnOverlay) return;
    hide();
    clearTimeout(clearPress);
    clearPress = setTimeout(function () {
      pressOnOverlay = false;
      release();
    }, 500);
  }, true);
  document.addEventListener('pointercancel', function () {
    pressOnOverlay = false;
    clearTimeout(clearPress);
    release();
  }, true);
  document.addEventListener('click', function (event) {
    if (!pressOnOverlay) return;
    pressOnOverlay = false;
    clearTimeout(clearPress);
    event.preventDefault();
    event.stopPropagation();
    hide();
    release();
  }, true);

  document.addEventListener('keydown', function (event) {
    if (busy()) return;
    if (!root.classList.contains('off')) {
      event.preventDefault();
      event.stopPropagation();
      hide();
      release();
      return;
    }
    arm();
  }, true);
  ['pointerdown', 'touchstart'].forEach(function (type) {
    document.addEventListener(type, function () {
      if (root.classList.contains('off') && !busy()) arm();
    }, { passive: true });
  });

  function onState() {
    if (busy()) conceal();
    else if (root.classList.contains('off') && timer == null) arm();
  }
  var stateObserver = new MutationObserver(onState);
  stateObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-kiosk-mode'] });
  var modal = $('modal');
  if (modal) stateObserver.observe(modal, { attributes: true, attributeFilter: ['class'] });

  if (busy()) conceal();
  else {
    root.removeAttribute('aria-hidden');
    setUnderlayInert(true);
  }
})();
