// Injected into the TOP page only. Draws a fake cursor, a highlight ring, a click ripple and a caption bar.
// Also blurs any ticket row that is not one of ours (privacy on a shared test server).
(() => {
  if (window.top !== window || window.__g) return;
  const css = `
  #__g_cursor{position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transition:transform .7s cubic-bezier(.22,.8,.3,1);}
  #__g_cursor svg{filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
  #__g_ring{position:fixed;z-index:2147483646;pointer-events:none;border:4px solid #e4572e;border-radius:14px;box-shadow:0 0 0 6px rgba(228,87,46,.18);opacity:0;transition:all .45s ease;}
  #__g_ring.on{opacity:1}
  #__g_badge{position:fixed;z-index:2147483647;pointer-events:none;background:#e4572e;color:#fff;font:700 16px/30px system-ui,sans-serif;width:30px;height:30px;border-radius:50%;text-align:center;opacity:0;transition:all .45s ease;}
  #__g_badge.on{opacity:1}
  .__g_ripple{position:fixed;z-index:2147483646;pointer-events:none;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;background:rgba(228,87,46,.55);animation:__g_r .6s ease-out forwards}
  @keyframes __g_r{to{transform:scale(4.5);opacity:0}}
  #__g_cap{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:2147483647;pointer-events:none;max-width:78%;background:rgba(20,24,31,.92);color:#fff;font:500 21px/1.35 system-ui,'Segoe UI',sans-serif;padding:14px 22px;border-radius:12px;opacity:0;transition:opacity .35s}
  #__g_cap.on{opacity:1}
  #__g_cap b{color:#ffb38a;font-weight:700;margin-right:8px}
  #__g_title{position:fixed;inset:0;z-index:2147483647;pointer-events:none;background:#14181f;color:#fff;display:none;align-items:center;justify-content:center;flex-direction:column;font-family:system-ui,'Segoe UI',sans-serif}
  #__g_title.on{display:flex}
  #__g_title h1{font-size:44px;margin:0 0 14px;font-weight:700}
  #__g_title p{font-size:22px;margin:0;color:#ffb38a}
  .__g_blur{filter:blur(14px) grayscale(1)!important;opacity:.55!important}
  .__g_hide{visibility:hidden!important}
  `;
  const add = () => {
    if (document.getElementById('__g_cursor')) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const c = document.createElement('div'); c.id = '__g_cursor';
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M3 2l7 19 2.6-7.4L20 11z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    c.style.transform = 'translate(700px,420px)';
    const r = document.createElement('div'); r.id = '__g_ring';
    const b = document.createElement('div'); b.id = '__g_badge';
    const cap = document.createElement('div'); cap.id = '__g_cap';
    const t = document.createElement('div'); t.id = '__g_title'; t.innerHTML = '<h1></h1><p></p>';
    document.body.append(r, b, cap, c, t);
  };
  const ready = (fn) => document.body ? fn() : document.addEventListener('DOMContentLoaded', fn);
  ready(add);
  const keep = () => (window.__keep || []);
  const blurPass = () => {
    if (!keep().length) return;
    document.querySelectorAll('a[href^="/tickets/c"], a[href^="/customers/c"]').forEach(a => {
      const row = a.closest('tr, li') || a;
      const ok = keep().some(k => row.textContent.includes(k));
      row.classList.toggle('__g_blur', !ok);
    });
  };
  const menuPass = () => {
    const mk = window.__menuKeep; if (!mk) return;
    document.querySelectorAll('[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox]').forEach(m => {
      m.classList.toggle('__g_blur', !mk.some(k => m.textContent.includes(k)));
    });
  };
  const numPass = () => {
    if (!window.__hideCounts) return;
    // Counters come from the shared test server and would mislead the client: hide them.
    document.querySelectorAll('a[href="/tickets"] span, a[href="/tickets"] div').forEach(e => { if (/^\d+\+?$/.test(e.textContent.trim())) e.classList.add('__g_hide'); });
    document.querySelectorAll('main *').forEach(e => { if (e.children.length === 0 && /^\d{2,}$/.test(e.textContent.trim())) e.classList.add('__g_hide'); });
    document.querySelectorAll('button[aria-label="Notifiche"] span').forEach(e => e.classList.add('__g_hide'));
    // Badges on header buttons ("9+") whatever their label: any small all-digit leaf inside a button outside main.
    document.querySelectorAll('header button *, nav button *, [role=banner] button *').forEach(e => { if (e.children.length === 0 && /^\d+\+?$/.test(e.textContent.trim())) e.classList.add('__g_hide'); });
  };
  setInterval(() => { blurPass(); menuPass(); numPass(); }, 150);
  window.__g = {
    move(x, y) { add(); document.getElementById('__g_cursor').style.transform = `translate(${x - 4}px,${y - 2}px)`; },
    ring(x, y, w, h, n) {
      add(); const r = document.getElementById('__g_ring'); const p = 8;
      Object.assign(r.style, { left: (x - p) + 'px', top: (y - p) + 'px', width: (w + 2 * p) + 'px', height: (h + 2 * p) + 'px' });
      r.classList.add('on');
      const b = document.getElementById('__g_badge');
      if (n) { b.textContent = n; Object.assign(b.style, { left: (x - p - 15) + 'px', top: (y - p - 15) + 'px' }); b.classList.add('on'); } else b.classList.remove('on');
    },
    unring() { document.getElementById('__g_ring')?.classList.remove('on'); document.getElementById('__g_badge')?.classList.remove('on'); },
    ripple(x, y) { const d = document.createElement('div'); d.className = '__g_ripple'; d.style.left = x + 'px'; d.style.top = y + 'px'; document.body.appendChild(d); setTimeout(() => d.remove(), 700); },
    caption(html) { add(); const c = document.getElementById('__g_cap'); if (!html) { c.classList.remove('on'); return; } c.innerHTML = html; c.classList.add('on'); },
    capHidden(h) { const c = document.getElementById('__g_cap'); if (c) c.style.visibility = h ? 'hidden' : 'visible'; },
    title(h, p) { add(); const t = document.getElementById('__g_title'); if (!h) { t.classList.remove('on'); return; } t.querySelector('h1').textContent = h; t.querySelector('p').textContent = p || ''; t.classList.add('on'); },
    cursorHidden(h) { const c = document.getElementById('__g_cursor'); if (c) c.style.visibility = h ? 'hidden' : 'visible'; },
  };
})();
