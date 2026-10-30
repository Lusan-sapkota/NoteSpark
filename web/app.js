// Theme (light, dark or the device's), remembered in localStorage, and the header's tonal fill once scrolled.
(function () {
  var root = document.documentElement;
  var darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

  function savedPreference() {
    try {
      return localStorage.getItem('themePreference') || 'system';
    } catch (e) {
      return 'system';
    }
  }

  function applyTheme(pref) {
    var dark = pref === 'dark' || (pref === 'system' && darkQuery.matches);
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.setAttribute('data-theme-pref', pref);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#12140d' : '#fbfaee');
    document.querySelectorAll('[data-theme-option]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-theme-option') === pref));
    });
  }

  darkQuery.addEventListener('change', function () {
    if (savedPreference() === 'system') applyTheme('system');
  });

  document.addEventListener('DOMContentLoaded', function () {
    applyTheme(savedPreference());
    document.querySelectorAll('[data-theme-option]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var pref = btn.getAttribute('data-theme-option');
        try {
          localStorage.setItem('themePreference', pref);
        } catch (e) {}
        applyTheme(pref);
      });
    });

    var header = document.querySelector('.site-header');
    var onScroll = function () {
      header.classList.toggle('is-scrolled', window.scrollY > 4);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  });
})();
