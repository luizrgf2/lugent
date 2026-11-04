/* Starfield — a very dark sky with slowly twinkling stars.
 *
 * Painted on a fixed canvas behind everything (z-index -1), so the page keeps
 * its own background: headers, cards and code blocks are opaque surfaces and
 * the text contrast is the same with or without the stars. Every star stays
 * under 0.62 alpha for exactly that reason; they are decoration, not light.
 *
 * Cost control:
 *   - one canvas, one rAF loop, ~30fps cap, paused while the tab is hidden
 *   - density scales with the viewport, hard-capped at 240 stars
 *   - prefers-reduced-motion: a single static frame, no loop, no twinkling
 */
(function () {
  var canvas = document.getElementById("stars");
  if (!canvas || !canvas.getContext) return;

  var ctx = canvas.getContext("2d", { alpha: true });
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  var TINTS = [
    "255,255,255",   // most stars: plain white
    "255,255,255",
    "255,255,255",
    "210,255,236",   // a few lean toward the accent green
    "255,238,205",   // and the amber
  ];

  var w = 0, h = 0, dpr = 1;
  var stars = [];      // flat: {x,y,r,a,phase,speed,tint}
  var glow = null;     // pre-rendered sprite for the bright ones
  var raf = 0, running = false, last = 0;

  function makeGlow() {
    var size = 64;
    var c = document.createElement("canvas");
    c.width = c.height = size;
    var g = c.getContext("2d");
    var grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(255,255,255,0.85)");
    grad.addColorStop(0.25, "rgba(255,255,255,0.22)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    g.fill();
    return c;
  }

  function seed() {
    var area = w * h;
    var count = Math.round(area / 11000);
    count = Math.max(60, Math.min(240, count));

    stars = [];
    for (var i = 0; i < count; i++) {
      var big = i % 29 === 0;               // roughly one in 29 gets a soft glow
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: big ? 0.9 + Math.random() * 0.7 : 0.35 + Math.random() * 0.55,
        a: big ? 0.24 + Math.random() * 0.12 : 0.12 + Math.random() * 0.20,
        phase: Math.random() * Math.PI * 2,
        speed: 0.18 + Math.random() * 0.55,   // radians per second: slow
        tint: TINTS[Math.floor(Math.random() * TINTS.length)],
        big: big,
      });
    }
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function draw(t) {
    ctx.clearRect(0, 0, w, h);

    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      // twinkle: a slow sine between 30% and 100% of the star's own alpha
      var k = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
      var alpha = s.a * k;

      if (s.big && glow) {
        var size = s.r * 26;
        ctx.globalAlpha = alpha * 0.55;
        ctx.drawImage(glow, s.x - size / 2, s.y - size / 2, size, size);
      }

      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgb(" + s.tint + ")";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }

  function loop(now) {
    if (!running) return;
    // ~30fps: twinkling this slow does not need 60
    if (!last || now - last >= 1000 / 30) {
      last = now;
      draw(now / 1000);
    }
    raf = requestAnimationFrame(loop);
  }

  function start() {
    if (running || reduce.matches) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  // a static frame: reduced motion, and the instant before the loop starts
  function paintStatic() {
    draw(1234);
  }

  function boot() {
    glow = glow || makeGlow();
    resize();
    if (reduce.matches) { stop(); paintStatic(); }
    else start();
  }

  var resizeTimer = 0;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var wasRunning = running;
      stop();
      resize();
      if (reduce.matches || !wasRunning) paintStatic();
      else start();
    }, 150);
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop();
    else if (!reduce.matches) start();
    else paintStatic();
  });

  if (reduce.addEventListener) {
    reduce.addEventListener("change", function () {
      if (reduce.matches) { stop(); paintStatic(); }
      else start();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
