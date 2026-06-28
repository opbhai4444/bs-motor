const I18n = (() => {
  let translations = {};
  let currentLang = localStorage.getItem('bsm_lang') || 'en';

  async function load(lang) {
    const res = await fetch(`/locales/${lang}.json`);
    translations = await res.json();
    currentLang = lang;
    localStorage.setItem('bsm_lang', lang);
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (translations[key]) el.textContent = translations[key];
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
      const key = el.getAttribute('data-i18n-ph');
      if (translations[key]) el.placeholder = translations[key];
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      if (translations[key]) el.title = translations[key];
    });
    document.documentElement.lang = lang;
  }

  function t(key) { return translations[key] || key; }
  function getLang() { return currentLang; }

  async function toggle() {
    await load(currentLang === 'en' ? 'hi' : 'en');
    const btn = document.getElementById('lang-toggle');
    if (btn) btn.textContent = currentLang === 'en' ? 'हिंदी' : 'English';
  }

  async function init() {
    await load(currentLang);
    const btn = document.getElementById('lang-toggle');
    if (btn) {
      btn.textContent = currentLang === 'en' ? 'हिंदी' : 'English';
      btn.addEventListener('click', toggle);
    }
  }

  return { init, t, getLang, load };
})();
