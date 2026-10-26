/* Full screen on a desktop tool page (docs/specs/site-redesign-spec.md,
   3.5). The head (_chrome.FS_HEAD) restores the mode before the first
   paint and loads this at once in a tab that chose it; anywhere else it
   loads on the first click of the control (.tp-fs, shown from 960 px),
   which the head then replays here.

   A layout mode, not the Fullscreen API: it never asks the browser for
   anything. html[data-fs="on"] lets css/chrome.css set aside everything but
   the tool and the switcher. Exit full screen or Escape brings the page
   back. The choice holds for the tab (sessionStorage), so the switcher
   moves between the tools in it. The logo and Home leave the tools, and the
   mode with them. */
(function () {
  var d = document;
  var root = d.documentElement;
  var KEY = 'scalita-fs';

  function store(on) {
    try {
      if (on) sessionStorage.setItem(KEY, '1');
      else sessionStorage.removeItem(KEY);
    } catch (e) {}
  }

  function start() {
    var go = d.querySelector('.tp-fs');
    var exit = d.querySelector('.site-fs-exit');
    if (!go || !exit) return;
    var isOn = function () { return root.getAttribute('data-fs') === 'on'; };
    var leave = function () {
      root.removeAttribute('data-fs');
      store(false);
      go.focus();
    };
    go.addEventListener('click', function () {
      root.setAttribute('data-fs', 'on');
      store(true);
      window.scrollTo(0, 0);
      exit.focus();
    });
    exit.addEventListener('click', leave);
    d.addEventListener('keydown', function (e) {
      // a tool that handles Escape itself prevents the default
      if (e.key === 'Escape' && isOn() && !e.defaultPrevented) leave();
    });
    d.addEventListener('click', function (e) {
      if (isOn() && e.target.closest('.site-logo, .seg--home')) store(false);
    });
  }

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start);
  else start();
})();
