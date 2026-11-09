/* ════════════════════════════════
   ANIMACIONES — Editorial fluido
   Reveals al hacer scroll, navbar, parallax y franja
   ════════════════════════════════ */
(function () {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Reveals al entrar en pantalla ──
  let observer = null;

  function activarReveals() {
    const nodos = document.querySelectorAll('[data-reveal]:not(.is-visible)');
    if (!nodos.length) return;

    if (reduce || !('IntersectionObserver' in window)) {
      nodos.forEach(n => n.classList.add('is-visible'));
      return;
    }

    if (!observer) {
      observer = new IntersectionObserver((entradas) => {
        entradas.forEach(e => {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible');
            observer.unobserve(e.target);
          }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    }

    nodos.forEach(n => observer.observe(n));
  }

  window.activarReveals = activarReveals;

  // ── Navbar con borde al hacer scroll + parallax del hero ──
  function onScroll() {
    const y = window.scrollY || 0;
    document.documentElement.classList.toggle('is-scrolled', y > 20);

    if (!reduce) {
      const media = document.querySelector('.hero-media');
      if (media && y < 900) {
        media.style.transform = `translateY(${Math.min(y * 0.06, 40)}px)`;
      }
    }
  }

  // ── Franja en movimiento ──
  function pintarMarquee() {
    const track = document.getElementById('marqueeTrack');
    if (!track) return;

    const esKohell = location.pathname.indexOf('/kohell') === 0;
    const marca = esKohell ? 'KOHELL' : 'INFINITY';
    const items = [
      'Nueva colección',
      'Envíos a todo el país',
      marca + ' Group',
      'Catálogo 2026',
      'Precios al por mayor'
    ];

    const bloque = items.map(t => `<span>${t}</span><span><b>·</b></span>`).join('');
    track.innerHTML = bloque + bloque;
  }

  document.addEventListener('DOMContentLoaded', () => {
    pintarMarquee();
    activarReveals();
    onScroll();

    window.addEventListener('scroll', onScroll, { passive: true });

    // Reinicia los reveals cuando se renderizan productos nuevos
    const grid = document.getElementById('productos');
    if (grid && 'MutationObserver' in window) {
      new MutationObserver(() => activarReveals()).observe(grid, { childList: true });
    }
  });
})();
