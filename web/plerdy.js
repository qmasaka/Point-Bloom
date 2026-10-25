// Plerdy: аналитика кликов и тепловые карты. Отдельный файл, а не встроенный скрипт: политика безопасности (CSP) не пускает встроенные скрипты.
(function (w, d) {
	if (w.__plerdyCode) return;
	w.__plerdyCode = 1;
	w._protocol = w.location.protocol == 'https:' ? 'https://' : 'http://';
	w._site_hash_code = '4149cb36dd0fff955e17ea5c23642a3a';
	w._suid = 82330;
	var s = d.createElement('script');
	s.async = true;
	s.referrerPolicy = 'strict-origin-when-cross-origin';
	s.src = 'https://a.plerdy.com/public/js/click/main.js?v=' + Math.random();
	d.head.appendChild(s);
})(window, document);
