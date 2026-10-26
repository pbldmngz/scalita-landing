/* The chrome's script, every page, defer (tool/templates/_chrome.py writes
   what it reads). Nothing here is needed to read or move around: it adds
   the language menu's Escape and click-outside, the phones' menu, the
   language bar and the tool pages' folds. Its words come from the page. */
(function () {
  var d = document;
  var KEY = 'scalita-lang-choice';

  function remember(value) {
    try { localStorage.setItem(KEY, value); } catch (e) {}
  }

  // The language menu: <details> opens itself; Escape and clicking away.
  var lang = d.querySelector('.lang-menu');
  if (lang) {
    d.addEventListener('click', function (e) {
      if (lang.open && !lang.contains(e.target)) lang.open = false;
    });
    lang.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && lang.open) {
        lang.open = false;
        lang.querySelector('summary').focus();
      }
    });
    // chosen on purpose: the bar never offers another
    lang.addEventListener('click', function (e) {
      var a = e.target.closest('a[hreflang]');
      if (a) remember(a.getAttribute('hreflang'));
    });
  }

  // The phones' menu (landing pages)
  var toggle = d.querySelector('.site-menu__toggle');
  var menu = d.getElementById('nav-menu');
  if (toggle && menu) {
    var label = toggle.getAttribute('aria-label');
    var isOpen = function () { return toggle.getAttribute('aria-expanded') === 'true'; };
    var set = function (open) {
      menu.classList.toggle('site-menu--open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? toggle.getAttribute('data-label-close') : label);
    };
    toggle.addEventListener('click', function () { set(!isOpen()); });
    menu.addEventListener('click', function (e) {
      if (e.target.closest('a')) set(false);
    });
    d.addEventListener('click', function (e) {
      if (isOpen() && !menu.contains(e.target) && !toggle.contains(e.target)) set(false);
    });
    d.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) {
        set(false);
        toggle.focus();
      }
    });
  }

  // A tool page's reference blocks: accordions on phones, the first open
  // and the one a link points at; prose wider, all open, headings out of
  // the tab order.
  var folds = d.querySelectorAll('details[data-fold]');
  if (folds.length && window.matchMedia) {
    var phone = window.matchMedia('(max-width: 599.98px)'); // the stylesheets' phone width
    var lay = function () {
      var aim = d.getElementById(location.hash.slice(1));
      for (var i = 0; i < folds.length; i++) {
        var head = folds[i].querySelector('summary');
        folds[i].open = !phone.matches || folds[i].getAttribute('data-fold') !== 'shut' || !!(aim && folds[i].contains(aim));
        if (phone.matches) head.removeAttribute('tabindex');
        else head.setAttribute('tabindex', '-1');
      }
    };
    lay();
    if (phone.addEventListener) phone.addEventListener('change', lay);
    for (var f = 0; f < folds.length; f++) {
      folds[f].addEventListener('toggle', function () {
        if (!phone.matches && !this.open) this.open = true;
      });
    }
  }

  // The language bar: the browser prefers another language this page is
  // in, so it is offered, in that language. Never a redirect; closing it or
  // choosing in the menu is remembered.
  var said = {};
  var words = d.getElementById('site-langs');
  try { said = words ? JSON.parse(words.textContent) : {}; } catch (e) { said = {}; }
  var chosen = null;
  try { chosen = localStorage.getItem(KEY); } catch (e) { chosen = 'unknown'; }
  var own = d.documentElement.lang.toLowerCase().split('-')[0];
  var have = {};
  var alts = d.querySelectorAll('link[rel="alternate"][hreflang]');
  for (var h = 0; h < alts.length; h++) {
    var tag = alts[h].getAttribute('hreflang');
    var primary = tag.toLowerCase().split('-')[0];
    if (tag !== 'x-default' && !have[primary]) {
      have[primary] = { tag: tag, href: new URL(alts[h].href).pathname };
    }
  }
  var wants = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
  var offer = null;
  for (var w = 0; !chosen && w < wants.length; w++) {
    var want = String(wants[w]).toLowerCase().split('-')[0];
    if (want === own) break;
    if (have[want] && said[want]) {
      offer = have[want];
      offer.text = said[want];
      break;
    }
  }
  if (offer) {
    var bar = d.createElement('div');
    bar.className = 'lang-bar';
    bar.setAttribute('data-nosnippet', '');
    bar.lang = offer.tag;
    var line = d.createElement('p');
    var go = d.createElement('a');
    go.href = offer.href;
    go.hreflang = offer.tag;
    go.textContent = offer.text.text;
    go.addEventListener('click', function () { remember(offer.tag); });
    line.appendChild(go);
    var shut = d.createElement('button');
    shut.type = 'button';
    shut.className = 'lang-bar__close';
    shut.setAttribute('aria-label', offer.text.close);
    shut.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    shut.addEventListener('click', function () {
      bar.parentNode.removeChild(bar);
      remember(d.documentElement.lang);
    });
    bar.appendChild(line);
    bar.appendChild(shut);
    d.body.appendChild(bar);
  }
})();
