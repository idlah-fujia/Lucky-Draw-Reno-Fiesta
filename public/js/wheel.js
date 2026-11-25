(function () {
  function mount(el) {
    return fetch('/wheel.svg', { cache: 'force-cache' }).then(function (res) {
      if (!res.ok) throw new Error('The wheel artwork did not load.');
      return res.text();
    }).then(function (svg) {
      el.innerHTML = svg;
    });
  }

  function markSold(wheel, slots, list) {
    var svg = wheel.querySelector('svg');
    if (!svg) return;
    var old = svg.querySelector('#sold');
    if (old) old.remove();
    if (!list || !list.length || !slots) return;
    var NS = 'http://www.w3.org/2000/svg';
    var g = document.createElementNS(NS, 'g');
    g.id = 'sold';
    var pt = function (deg) {
      var r = deg * Math.PI / 180;
      return (1500 + 1420 * Math.sin(r)).toFixed(1) + ' ' + (1500 - 1420 * Math.cos(r)).toFixed(1);
    };
    slots.forEach(function (key, i) {
      if (list.indexOf(key) < 0) return;
      var c = i * 11.25;
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', 'M1500 1500 L' + pt(c - 5.625) + ' A1420 1420 0 0 1 ' + pt(c + 5.625) + ' Z');
      p.setAttribute('fill', '#3a332e');
      p.setAttribute('fill-opacity', '.86');
      g.appendChild(p);
      var t = document.createElementNS(NS, 'text');
      t.textContent = 'FULLY REDEEMED';
      t.setAttribute('transform', 'rotate(' + c + ' 1500 1500) translate(1500 500) rotate(-90)');
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('dominant-baseline', 'middle');
      t.setAttribute('fill', '#FFD23F');
      t.setAttribute('stroke', '#1B0F33');
      t.setAttribute('stroke-width', '14');
      t.setAttribute('paint-order', 'stroke');
      t.setAttribute('font-size', '92');
      t.setAttribute('font-weight', '900');
      t.setAttribute('letter-spacing', '3');
      t.setAttribute('font-family', "'DM Sans', Arial, sans-serif");
      g.appendChild(t);
    });
    svg.appendChild(g);
  }

  function landOn(wheel, slot, animate) {
    return new Promise(function (resolve) {
      var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var angle = wheel._angle || 0;
      var jitter = (Math.random() - 0.5) * 7;
      var target = (360 - slot * 11.25 + jitter) % 360;
      var base = angle - (angle % 360);
      var turns = animate ? (reduce ? 1 : 8) : 0;
      var seconds = animate ? (reduce ? 0.4 : 6.2) : 0;
      var finalAngle = animate ? base + 360 * turns + target : target;
      wheel.style.transition = animate ? 'transform ' + seconds + 's cubic-bezier(.12,.7,.1,1)' : 'none';
      wheel.style.transform = 'rotate(' + finalAngle + 'deg)';
      wheel._angle = finalAngle;
      if (!animate) { resolve(); return; }
      var fired = false;
      var fin = function () { if (fired) return; fired = true; resolve(); };
      wheel.addEventListener('transitionend', fin, { once: true });
      setTimeout(fin, seconds * 1000 + 400);
    });
  }

  function reset(wheel) {
    wheel._angle = 0;
    wheel.style.transition = 'none';
    wheel.style.transform = 'rotate(0deg)';
  }

  window.SureWinWheel = { mount: mount, markSold: markSold, landOn: landOn, reset: reset };
})();
