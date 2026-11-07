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

    // Small-screen menu: close after choosing a link, on Escape and on a tap outside.
    var menu = document.querySelector('.nav-menu');
    if (menu) {
      menu.addEventListener('click', function (e) { if (e.target.closest('a')) menu.removeAttribute('open'); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && menu.open) { menu.removeAttribute('open'); menu.querySelector('summary').focus(); } });
      document.addEventListener('click', function (e) { if (menu.open && !menu.contains(e.target)) menu.removeAttribute('open'); });
    }

    var header = document.querySelector('.site-header');
    var onScroll = function () {
      header.classList.toggle('is-scrolled', window.scrollY > 4);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Point the main download button at the person's device and mark the matching card.
    var ua = navigator.userAgent;
    var platform = /Android/i.test(ua) ? 'and' : /Windows/i.test(ua) ? 'win' : /Macintosh|Mac OS X/i.test(ua) ? 'mac' : /Linux|X11/i.test(ua) ? 'lin' : '';
    var label = document.getElementById('dl-main-label');
    var dlMain = document.getElementById('dl-main');
    var direct = 'https://github.com/Lusan-sapkota/NoteSpark/releases/latest/download/';
    // Android and Windows have one file each. A Mac can't be told apart (Apple silicon or Intel) and Linux has several packages,
    // so those two buttons open the download section with their tab, where the visitor picks.
    if (dlMain && platform === 'and') dlMain.href = direct + 'NoteSpark-android.apk';
    if (dlMain && platform === 'win') dlMain.href = direct + 'NoteSpark-windows-x64.exe';
    if (dlMain && (platform === 'mac' || platform === 'lin')) { dlMain.href = '#get'; dlMain.removeAttribute('target'); dlMain.removeAttribute('rel'); }
    var names = { and: 'Android', win: 'Windows', mac: 'Mac', lin: 'Linux' };
    if (label && names[platform]) label.textContent = 'Download for ' + names[platform];

    // Download tabs: with JavaScript one panel shows at a time, starting with the visitor's device.
    var tabs = [].slice.call(document.querySelectorAll('[data-tab]'));
    function showTab(id, focus) {
      tabs.forEach(function (t) {
        var on = t.getAttribute('data-tab') === id;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        document.getElementById('panel-' + t.getAttribute('data-tab')).hidden = !on;
        if (on && focus) t.focus();
      });
    }
    if (tabs.length) {
      var start = /Android/i.test(ua) ? 'android' : /Windows/i.test(ua) ? 'windows' : /Mac/i.test(ua) ? 'macos' : 'linux';
      showTab(start);
      tabs.forEach(function (t, i) {
        t.addEventListener('click', function () { showTab(t.getAttribute('data-tab')); });
        t.addEventListener('keydown', function (e) {
          var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
          if (d) { e.preventDefault(); showTab(tabs[(i + d + tabs.length) % tabs.length].getAttribute('data-tab'), true); }
        });
      });
    }
    document.querySelectorAll('.copy').forEach(function (b) {
      b.addEventListener('click', function () {
        var text = b.previousElementSibling.textContent;
        (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () {
          b.textContent = 'Copied';
          setTimeout(function () { b.textContent = 'Copy'; }, 1800);
        }, function () { b.textContent = 'Press Ctrl+C'; });
      });
    });

    // A look inside: the step nearest the middle of the screen decides which screens show.
    var steps = [].slice.call(document.querySelectorAll('.step'));
    if (steps.length && 'IntersectionObserver' in window) {
      var layers = [].slice.call(document.querySelectorAll('.show .layers'));
      var showStep = function (i) {
        steps.forEach(function (st, n) { st.classList.toggle('is-on', n === i); });
        layers.forEach(function (box) {
          [].slice.call(box.children).forEach(function (l, n) {
            l.classList.toggle('is-on', n === i);
            l.setAttribute('aria-hidden', String(n !== i));
          });
        });
      };
      var stepIo = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) showStep(steps.indexOf(en.target)); });
      }, { rootMargin: '-45% 0px -45% 0px' });
      steps.forEach(function (st) { stepIo.observe(st); });
    }

    // Pause button for the hero loop (moving content needs one).
    var stage = document.querySelector('.hero-stage');
    var pause = document.getElementById('stage-pause');
    if (stage && pause) {
      pause.addEventListener('click', function () {
        var on = stage.classList.toggle('is-paused');
        pause.setAttribute('aria-pressed', String(on));
        pause.textContent = on ? 'Play animation' : 'Pause animation';
      });
    }

    // Tilt the devices toward the pointer (mouse only).
    var devices = document.getElementById('devices');
    if (devices && !calm && window.matchMedia('(pointer: fine)').matches) {
      devices.addEventListener('pointermove', function (e) {
        var r = devices.getBoundingClientRect();
        devices.style.setProperty('--rx', ((e.clientX - r.left) / r.width * 2 - 1).toFixed(2));
        devices.style.setProperty('--ry', ((e.clientY - r.top) / r.height * 2 - 1).toFixed(2));
      });
      devices.addEventListener('pointerleave', function () {
        devices.style.setProperty('--rx', 0);
        devices.style.setProperty('--ry', 0);
      });
    }

    // Fade sections in as they scroll into view.
    if (!calm && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
        });
      }, { rootMargin: '0px 0px -10% 0px' });
      document.querySelectorAll('.section-head, .groups .group, .band').forEach(function (el) {
        el.classList.add('will-reveal');
        io.observe(el);
      });
    }
  });
})();
