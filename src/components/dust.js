/**
 * 地图舞台里的浮尘（DESIGN.md 7.6）。
 *
 * 只在这一处允许粒子：深色制图台上的一层极淡金点，缓慢上浮、随鼠标轻微偏移。
 * 纸面区不撒粒子——米纸上撒灰只会显脏。
 *
 * 参数上限写在规范里，改这里要回去改文档：数量按面积算、半径与不透明度有上限、
 * 视差幅度 ≤ 8px、分析态降到 40%、系统要求减少动态效果时根本不启动。
 */

const GOLD = "#C4A265";
const PER_AREA = 18000; // 每 18000 px² 一颗
const MAX_COUNT = 110;
const MAX_DRIFT = 12; // px/s
const PARALLAX = 8; // px
/** 约一成的点当作「近景」：稍大、稍暗、飘得慢，用来撑出景深 */
const NEAR_CHANCE = 0.12;

export function mountDust(stage) {
  if (!stage) return null;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reduce.matches) return null;

  const canvas = document.createElement("canvas");
  canvas.className = "atlas__dust";
  canvas.setAttribute("aria-hidden", "true");
  stage.append(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return null;
  }

  let width = 0;
  let height = 0;
  let dpr = 1;
  let particles = [];
  let raf = 0;
  let last = 0;
  let running = true;

  // 鼠标视差：目标位移与缓动后的当前位移
  let targetX = 0;
  let targetY = 0;
  let shiftX = 0;
  let shiftY = 0;

  function buildParticles() {
    const count = Math.min(MAX_COUNT, Math.round((width * height) / PER_AREA));
    particles = Array.from({ length: count }, () => spawn(true));
  }

  function spawn(anywhere = false) {
    const near = Math.random() < NEAR_CHANCE;
    return {
      x: Math.random() * width,
      // 初始化时铺满整层，之后回收的点从底部进来
      y: anywhere ? Math.random() * height : height + Math.random() * 20,
      r: (0.6 + Math.random() * 1.5) * (near ? 1.5 : 1),
      vy: (2 + Math.random() * (MAX_DRIFT - 2)) * (near ? 0.55 : 1),
      driftPhase: Math.random() * Math.PI * 2,
      driftFreq: 0.15 + Math.random() * 0.35,
      alpha: (0.12 + Math.random() * 0.4) * (near ? 0.8 : 1),
    };
  }

  function resize() {
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    width = rect.width;
    height = rect.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildParticles();
  }

  function draw(now) {
    if (!last) last = now;
    const dt = Math.min(0.05, (now - last) / 1000); // 切后台回来时别让点瞬移
    last = now;

    // 视差缓动
    shiftX += (targetX - shiftX) * Math.min(1, dt * 3);
    shiftY += (targetY - shiftY) * Math.min(1, dt * 3);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = GOLD;

    for (const p of particles) {
      p.y -= p.vy * dt;
      p.driftPhase += p.driftFreq * dt;
      if (p.y < -12) Object.assign(p, spawn(false));

      const x = p.x + Math.sin(p.driftPhase) * 6 + shiftX;
      const y = p.y + shiftY;
      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.arc(x, y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (running) raf = requestAnimationFrame(draw);
  }

  function start() {
    if (raf || reduce.matches) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(draw);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function onPointerMove(event) {
    const rect = stage.getBoundingClientRect();
    const nx = (event.clientX - rect.left) / rect.width - 0.5;
    const ny = (event.clientY - rect.top) / rect.height - 0.5;
    targetX = -nx * 2 * PARALLAX;
    targetY = -ny * 2 * PARALLAX;
  }

  function onPointerLeave() {
    targetX = 0;
    targetY = 0;
  }

  function onVisibility() {
    if (document.hidden) stop();
    else start();
  }

  function onReduceChange() {
    if (reduce.matches) {
      stop();
      canvas.style.display = "none";
    } else {
      canvas.style.display = "";
      resize();
      start();
    }
  }

  const observer = "ResizeObserver" in window ? new ResizeObserver(resize) : null;
  if (observer) observer.observe(stage);
  else window.addEventListener("resize", resize);

  stage.addEventListener("pointermove", onPointerMove, { passive: true });
  stage.addEventListener("pointerleave", onPointerLeave, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  reduce.addEventListener?.("change", onReduceChange);

  resize();
  start();

  return {
    /** 分析态时把整层压暗，别抢光路 */
    setDimmed(dimmed) {
      canvas.classList.toggle("is-dimmed", !!dimmed);
    },
    destroy() {
      stop();
      observer?.disconnect();
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      reduce.removeEventListener?.("change", onReduceChange);
      canvas.remove();
    },
  };
}
