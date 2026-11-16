/* Split-screen auth page behaviour (login.html): password reveal + one-off entrance.
   Sign-in itself is handled by auth-handler.js. */
(() => {
  const btn = document.querySelector('.reveal');
  const pw = document.getElementById('password');
  if (!btn || !pw) return;
  btn.addEventListener('click', () => {
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    btn.querySelector('.eye-open').hidden = show;
    btn.querySelector('.eye-off').hidden = !show;
  });
})();

/* Entrance: one timeline on the Web Animations API, played once on load.
     RISE     headlines rise line by line out of a mask
     SETTLE   copy + form rows: short rise with opacity
     LIFT     glass cards: rise + slight scale
     DRAW     hairline rules grow outward from their label
     PRESENCE small details: opacity only
   Every tween ends on the authored style and is cancelled afterwards. */
(() => {
  const root = document.documentElement;
  if (!root.classList.contains('is-entering')) return;      // reduced motion / no WAAPI
  let started = false;

  const EXPO  = 'cubic-bezier(.16,1,.3,1)';
  const QUINT = 'cubic-bezier(.22,1,.36,1)';
  const DRAW  = 'cubic-bezier(.65,0,.35,1)';
  const SOFT  = 'cubic-bezier(.33,1,.68,1)';

  const start = () => {
    if (started) return;
    started = true;
    clearTimeout(window.__entranceFailsafe);
    try { run(); } catch (e) { root.classList.remove('is-entering'); }
  };
  // wait briefly for web fonts so line masks match the final wrapping
  Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 400))])
    .then(() => requestAnimationFrame(start));

  function run() {
    const $  = (s, c = document) => c.querySelector(s);
    const $$ = (s, c = document) => [...c.querySelectorAll(s)];
    const W = innerWidth, H = innerHeight;

    // one design pixel at the current scale (--u), and a calmer distance on phones
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;width:calc(100 * var(--u))';
    document.body.appendChild(probe);
    const u = probe.getBoundingClientRect().width / 100 || 1;
    probe.remove();
    const k = matchMedia('(max-width:739.98px)').matches ? .75 : 1;
    const d = px => +(px * u * k).toFixed(2);

    const anims = [], restores = [];
    const inView = el => { const r = el.getBoundingClientRect(); return r.height > 0 && r.bottom > 0 && r.top < H && r.right > 0 && r.left < W; };
    const play = (el, frames, delay, duration, easing, pseudoElement) => {
      const opts = { delay, duration, easing, fill: 'both' };
      if (pseudoElement) opts.pseudoElement = pseudoElement;
      anims.push(el.animate(frames, opts));
    };

    const RISE = (el, t, dur = 950, stagger = 90) => {
      if (!el || !inView(el)) return;
      splitLines(el).forEach((line, i) =>
        play(line, [{ transform: 'translateY(125%)' }, { transform: 'none' }], t + i * stagger, dur, EXPO));
    };
    const SETTLE = (el, t, y = 10, dur = 640, scale) => {
      if (!el || !inView(el)) return;
      const from = `translate3d(0,${d(y)}px,0)` + (scale ? ` scale(${scale})` : '');
      play(el, [{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }], t, dur, QUINT);
    };
    const LIFT = (el, t) => {
      if (!el || !inView(el)) return;
      play(el, [{ opacity: 0, transform: `translate3d(0,${d(28)}px,0) scale(.985)` }, { opacity: 1, transform: 'none' }], t, 1050, EXPO);
    };
    const DRAWN = (el, pseudo, t, origin) => {
      if (!el || !inView(el)) return;
      const base = getComputedStyle(el, pseudo).transform;
      const b = base && base !== 'none' ? base + ' ' : '';
      play(el, [{ opacity: 1, transformOrigin: origin, transform: b + 'scaleX(0)' },
                { opacity: 1, transformOrigin: origin, transform: b + 'scaleX(1)' }], t, 760, DRAW, pseudo);
    };
    const PRESENCE = (el, t, dur = 520) => {
      if (!el || !inView(el)) return;
      play(el, [{ opacity: 0 }, { opacity: 1 }], t, dur, SOFT);
    };

    // wrap each rendered line of a headline, restore the original markup afterwards
    function splitLines(el) {
      const original = el.innerHTML;
      const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const words = el.textContent.trim().split(/\s+/);
      el.innerHTML = words.map(w => `<span class="e-w">${esc(w)}</span>`).join(' ');
      const lines = []; let top = null;
      $$('.e-w', el).forEach(s => { if (s.offsetTop !== top) { top = s.offsetTop; lines.push([]); } lines[lines.length - 1].push(s.textContent); });
      el.innerHTML = lines.map(l => `<span class="e-line"><span class="e-in">${l.map(esc).join(' ')}</span></span>`).join('');
      restores.push(() => { el.innerHTML = original; });
      return $$('.e-in', el);
    }

    /* ---- timeline (ms) ---- */
    SETTLE($('.logo__img'), 0, 6, 760);
    SETTLE($('.logo__mark'), 0, 0, 760, .86);
    if ($('.logo__word') && inView($('.logo__word')))
      play($('.logo__word'), [{ opacity: 1, clipPath: 'inset(-30% 100% -30% 0)', transform: `translate3d(${-d(8)}px,0,0)` },
                              { opacity: 1, clipPath: 'inset(-30% -6% -30% 0)', transform: 'none' }], 90, 860, EXPO);

    RISE($('.hero__title'), 160);

    RISE($('.panel__title'), 320, 860);
    SETTLE($('.panel__sub'), 430, 8, 600);
    SETTLE($('.quick-slot'), 500, 10, 680, .985);
    const orTop = $('.or--top');
    DRAWN(orTop, '::before', 560, 'right center');
    DRAWN(orTop, '::after', 560, 'left center');
    PRESENCE($('.or--top span'), 600, 480);

    SETTLE($('.hero__copy'), 470, 12, 720);

    $$('.form .field, .form .row').forEach((el, i) => SETTLE(el, 620 + i * 70, 10, 620));
    SETTLE($('.cta-slot'), 840, 10, 680, .985);

    $$('.card').filter(inView)
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
      .forEach((c, i) => LIFT(c, 620 + i * 90));

    const rule = $('.trust__rule');
    DRAWN(rule, '::before', 1000, 'right center');
    DRAWN(rule, '::after', 1000, 'left center');
    PRESENCE($('.trust__label'), 1060);
    PRESENCE($('.switch'), 1000);
    $$('.panel__tag, .panel__note, .input--otp, .notice, #verify-form .label').forEach(el => PRESENCE(el, 700));
    $$('#verify-form .cta-slot').forEach(el => SETTLE(el, 840, 10, 680, .985));
    $$('.marks__row').forEach((el, i) => PRESENCE(el, 1140 + i * 80, 600));
    $$('.auth__foot a').forEach((el, i) => PRESENCE(el, 1100 + i * 40, 480));
    PRESENCE($('.legal'), 1280, 520);

    // the first frame already carries every pre-roll state (fill: both), so lift the CSS veil now
    root.classList.remove('is-entering');

    Promise.all(anims.map(a => a.finished)).then(() => {
      anims.forEach(a => a.cancel());
      restores.forEach(f => f());
    }, () => restores.forEach(f => f()));
  }
})();
