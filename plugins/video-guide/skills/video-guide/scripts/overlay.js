// Injected into the TOP page only. Draws what must move WITH the page when the camera zooms:
// the cursor, the highlight ring + spotlight, the step badge, the click ripple, the title cards.
// The caption bar is NOT drawn here: assemble.js composites it after the zoom, so a zoom can
// never crop it. Also blurs list rows that are not ours (privacy on a shared test server).
(() => {
  if (window.top !== window || window.__g) return;
  const O = Object.assign({ accent: '#e4572e', spotlight: true }, window.__gOpts || {});
  const A = O.accent;
  const css = `
  #__g_cursor{position:fixed;left:0;top:0;width:30px;height:30px;z-index:2147483647;pointer-events:none;will-change:transform}
  #__g_cursor svg{display:block;transform-origin:6px 4px;transition:transform .11s ease-out;filter:drop-shadow(0 3px 4px rgba(0,0,0,.38))}
  #__g_cursor.down svg{transform:scale(.8)}
  #__g_ring{position:fixed;z-index:2147483645;pointer-events:none;border:2.5px solid ${A};border-radius:12px;opacity:0;transform:scale(1.05);
    box-shadow:0 0 0 5px ${A}29,0 10px 34px ${A}38,0 0 0 200vmax rgba(12,16,24,0);
    transition:left .5s cubic-bezier(.65,0,.35,1),top .5s cubic-bezier(.65,0,.35,1),width .5s cubic-bezier(.65,0,.35,1),height .5s cubic-bezier(.65,0,.35,1),opacity .35s ease,transform .45s cubic-bezier(.2,.9,.3,1.2),box-shadow .5s ease}
  #__g_ring.jump{transition:opacity .35s ease,transform .45s cubic-bezier(.2,.9,.3,1.2),box-shadow .5s ease}
  #__g_ring.on{opacity:1;transform:scale(1)}
  #__g_ring.on.spot{box-shadow:0 0 0 5px ${A}29,0 10px 34px ${A}38,0 0 0 200vmax rgba(12,16,24,.3)}
  #__g_badge{position:fixed;z-index:2147483646;pointer-events:none;background:${A};color:#fff;font:700 15px/30px system-ui,'Segoe UI',sans-serif;width:30px;height:30px;border-radius:50%;text-align:center;opacity:0;transform:scale(0);box-shadow:0 0 0 3px #fff,0 4px 12px rgba(0,0,0,.28)}
  #__g_badge.on{opacity:1;transform:scale(1);animation:__g_pop .5s cubic-bezier(.2,.9,.3,1.4) both}
  @keyframes __g_pop{0%{transform:scale(0);opacity:0}60%{transform:scale(1.18);opacity:1}100%{transform:scale(1);opacity:1}}
  .__g_ripple{position:fixed;z-index:2147483646;pointer-events:none;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:${A}80;animation:__g_r .65s cubic-bezier(.2,.7,.3,1) forwards}
  .__g_ripple.ring{background:none;border:2px solid ${A};animation-duration:.85s}
  @keyframes __g_r{from{transform:scale(.4);opacity:1}to{transform:scale(4.2);opacity:0}}
  #__g_title{position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:hidden;display:none;align-items:center;justify-content:center;flex-direction:column;text-align:center;
    background:radial-gradient(120% 90% at 50% 110%,#232c3d 0%,#141a26 55%,#0d111a 100%);color:#fff;font-family:system-ui,'Segoe UI',sans-serif}
  #__g_title.on{display:flex}
  #__g_title i{position:absolute;width:70vmax;height:70vmax;border-radius:50%;opacity:.5;background:radial-gradient(circle,${A}55 0%,${A}00 62%);animation:__g_drift 9s ease-in-out infinite alternate}
  #__g_title i.a{left:-25vmax;top:-30vmax}
  #__g_title i.b{right:-28vmax;bottom:-34vmax;background:radial-gradient(circle,#5b8cff44 0%,#5b8cff00 62%);animation-duration:11s;animation-direction:alternate-reverse}
  @keyframes __g_drift{from{transform:translate(0,0) scale(1)}to{transform:translate(9vmax,6vmax) scale(1.18)}}
  #__g_title .k{position:relative;font-size:15px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:${A};background:${A}1f;border:1px solid ${A}66;padding:7px 16px 7px 18px;border-radius:99px;margin-bottom:22px}
  #__g_title .k:empty{display:none}
  #__g_title h1{position:relative;font-size:52px;line-height:1.12;letter-spacing:-.02em;margin:0;font-weight:750;max-width:84%}
  #__g_title h1.long{font-size:38px}
  #__g_title .l{position:relative;width:76px;height:4px;border-radius:4px;background:${A};margin:24px 0 20px;transform-origin:center}
  #__g_title p{position:relative;font-size:22px;margin:0;color:#c8d0dd;max-width:76%}
  #__g_title.on .k{animation:__g_up .6s .25s cubic-bezier(.2,.8,.2,1) both}
  #__g_title.on h1{animation:__g_up .7s .35s cubic-bezier(.2,.8,.2,1) both}
  #__g_title.on .l{animation:__g_grow .6s .6s cubic-bezier(.2,.8,.2,1) both}
  #__g_title.on p{animation:__g_up .7s .7s cubic-bezier(.2,.8,.2,1) both}
  @keyframes __g_up{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}
  @keyframes __g_grow{from{opacity:0;transform:scaleX(0)}to{opacity:1;transform:none}}
  #__g_flash{position:fixed;inset:0;z-index:2147483647;pointer-events:none;background:#f0f;display:none}
  .__g_blur{filter:blur(14px) grayscale(1)!important;opacity:.55!important}
  .__g_hide{visibility:hidden!important}
  `;
  // The cursor position survives a navigation (same origin), so it does not jump back to the middle.
  let pos = { x: 700, y: 420 };
  try { const s = JSON.parse(sessionStorage.getItem('__g_pos')); if (s) pos = s; } catch (e) { /* storage blocked: start in the middle */ }
  let raf = 0;
  const el = (id) => document.getElementById(id);
  const place = () => { const c = el('__g_cursor'); if (c) c.style.transform = `translate(${pos.x - 6}px,${pos.y - 4}px)`; };
  const add = () => {
    if (!document.body || el('__g_cursor')) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const mk = (id, html) => { const d = document.createElement('div'); d.id = id; if (html) d.innerHTML = html; return d; };
    const c = mk('__g_cursor', '<svg width="30" height="30" viewBox="0 0 30 30"><path d="M6 4l0 19.5 5.2-4.6 3.5 8 3.6-1.6-3.5-7.9 7-.5z" fill="#15181d" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/></svg>');
    document.body.append(mk('__g_ring'), mk('__g_badge'), c, mk('__g_title', '<i class="a"></i><i class="b"></i><div class="k"></div><h1></h1><div class="l"></div><p></p>'), mk('__g_flash'));
    place();
  };
  const ready = (fn) => (document.body ? fn() : document.addEventListener('DOMContentLoaded', fn));
  ready(add);

  const keep = () => (window.__keep || []);
  const blurPass = () => {
    if (!keep().length) return;
    document.querySelectorAll('a[href^="/tickets/c"], a[href^="/customers/c"]').forEach((a) => {
      const row = a.closest('tr, li') || a;
      row.classList.toggle('__g_blur', !keep().some((k) => row.textContent.includes(k)));
    });
  };
  const menuPass = () => {
    const mk = window.__menuKeep; if (!mk) return;
    document.querySelectorAll('[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox]').forEach((m) => {
      m.classList.toggle('__g_blur', !mk.some((k) => m.textContent.includes(k)));
    });
  };
  const numPass = () => {
    if (!window.__hideCounts) return;
    // Counters come from the shared test server and would mislead the viewer: hide them.
    document.querySelectorAll('a[href="/tickets"] span, a[href="/tickets"] div').forEach((e) => { if (/^\d+\+?$/.test(e.textContent.trim())) e.classList.add('__g_hide'); });
    document.querySelectorAll('main *').forEach((e) => { if (e.children.length === 0 && /^\d{2,}$/.test(e.textContent.trim())) e.classList.add('__g_hide'); });
    document.querySelectorAll('button[aria-label="Notifiche"] span').forEach((e) => e.classList.add('__g_hide'));
    // Badges on header buttons ("9+") whatever their label: any small all-digit leaf inside a button outside main.
    document.querySelectorAll('header button *, nav button *, [role=banner] button *').forEach((e) => { if (e.children.length === 0 && /^\d+\+?$/.test(e.textContent.trim())) e.classList.add('__g_hide'); });
  };
  setInterval(() => { blurPass(); menuPass(); numPass(); }, 150);

  const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2); // cubic in-out: slow, fast, slow
  window.__g = {
    // Glide along a gentle arc with natural acceleration. Returns how long it takes (ms) so the
    // recorder can wait for it. A straight, constant-speed move is what makes a cursor look robotic.
    move(x, y, ms) {
      add(); cancelAnimationFrame(raf);
      const a = { ...pos }; const dx = x - a.x; const dy = y - a.y; const dist = Math.hypot(dx, dy);
      const T = ms != null ? ms : Math.max(420, Math.min(1150, 320 + dist * 0.95));
      if (dist < 2 || T < 30) { pos = { x, y }; place(); return 0; }
      // Control point pushed sideways: the bend is proportional to the distance, always arching upward.
      const bend = Math.min(90, dist * 0.16) * (dx >= 0 ? -1 : 1);
      const cx = a.x + dx / 2 + (-dy / dist) * bend; const cy = a.y + dy / 2 + (dx / dist) * bend;
      const t0 = performance.now();
      const step = (now) => {
        const u = Math.min(1, (now - t0) / T); const e = ease(u); const m = 1 - e;
        pos = { x: m * m * a.x + 2 * m * e * cx + e * e * x, y: m * m * a.y + 2 * m * e * cy + e * e * y };
        place();
        if (u < 1) raf = requestAnimationFrame(step);
        else { try { sessionStorage.setItem('__g_pos', JSON.stringify(pos)); } catch (err) { /* not persisted */ } }
      };
      raf = requestAnimationFrame(step);
      return T;
    },
    // Press: the cursor squishes, a dot and a ring spread from the click point.
    press(x, y) {
      add(); const c = el('__g_cursor'); c.classList.add('down'); setTimeout(() => c.classList.remove('down'), 170);
      for (const cls of ['', ' ring']) { const d = document.createElement('div'); d.className = '__g_ripple' + cls; d.style.left = x + 'px'; d.style.top = y + 'px'; document.body.appendChild(d); setTimeout(() => d.remove(), 900); }
    },
    ripple(x, y) { this.press(x, y); },
    ring(x, y, w, h, n, spot) {
      add(); const r = el('__g_ring'); const p = 7;
      r.classList.toggle('jump', !r.classList.contains('on')); // first appearance: fade in place, do not fly in from the last target
      Object.assign(r.style, { left: (x - p) + 'px', top: (y - p) + 'px', width: (w + 2 * p) + 'px', height: (h + 2 * p) + 'px' });
      r.classList.toggle('spot', spot == null ? !!O.spotlight : !!spot);
      r.classList.add('on');
      const b = el('__g_badge');
      b.classList.remove('on');
      if (n) { b.textContent = n; Object.assign(b.style, { left: (x - p - 14) + 'px', top: (y - p - 14) + 'px' }); void b.offsetWidth; b.classList.add('on'); }
    },
    unring() { el('__g_ring')?.classList.remove('on'); el('__g_badge')?.classList.remove('on'); },
    // Full-screen title card. It appears at once: the cross-fade to and from it is done in the edit.
    title(h, p, kicker) {
      add(); const t = el('__g_title'); if (!h) { t.classList.remove('on'); return; }
      t.querySelector('.k').textContent = kicker || '';
      const h1 = t.querySelector('h1'); h1.textContent = h; h1.classList.toggle('long', h.length > 30);
      t.querySelector('p').textContent = p || '';
      t.classList.remove('on'); void t.offsetWidth; t.classList.add('on');
    },
    // One magenta frame burst: assemble.js finds it in the recording to line up its clock with ours.
    flash(on) { add(); el('__g_flash').style.display = on ? 'block' : 'none'; return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))); },
    // Eased scroll (a wheel jump looks like a cut). Returns its duration in ms.
    scroll(dy, ms) {
      const T = ms != null ? ms : Math.max(500, Math.min(1400, Math.abs(dy) * 1.1)); const y0 = window.scrollY; const t0 = performance.now();
      const step = (now) => { const u = Math.min(1, (now - t0) / T); window.scrollTo(0, y0 + dy * ease(u)); if (u < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step); return T;
    },
    cursorHidden(h) { const c = el('__g_cursor'); if (c) c.style.visibility = h ? 'hidden' : 'visible'; },
    // Kept so older scenarios do not break: captions are composited by assemble.js now.
    caption() {}, capHidden() {},
  };
})();
