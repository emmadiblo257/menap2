/**
 * LangJS v2.1 — Gestionnaire de langue pour Menap
 * Chargement asynchrone des fichiers JSON de traduction
 * Prise en charge des attributs: translate, translate-placeholder, translate-title, translate-aria
 */

class LangJS {
  constructor(config = {}) {
    this.config = {
      languagePath: config.languagePath || './lang/',
      defaultLanguage: config.defaultLanguage || 'fr',
      persistKey: config.persistKey || 'menap_lang',
      fallbackLanguage: config.fallbackLanguage || 'fr',
      availableLanguages: config.availableLanguages || ['fr', 'en', 'rn', 'rw'],
      debug: config.debug || false
    };
    this.currentLanguage = null;
    this.dict = {};
    this._cache = new Map();
    this._observers = [];
  }

  /* ── Initialisation ── */
  async init(forceLang) {
    const lang = forceLang || this._stored() || this._browser() || this.config.defaultLanguage;
    await this.setLanguage(lang);
    this._observeDOM();
  }

  /* ── Chargement et application d'une langue ── */
  async setLanguage(lang) {
    if (!this.config.availableLanguages.includes(lang)) {
      lang = this.config.fallbackLanguage;
    }
    try {
      const r = await fetch(`${this.config.languagePath}${lang}.json?v=${Date.now()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      this.dict = await r.json();
      this.currentLanguage = lang;
      this._cache.clear();
      this._store(lang);
      document.documentElement.lang = lang;
      this._translatePage();
      this._log(`Langue: ${lang}`);
      return true;
    } catch (e) {
      this._log(`Erreur chargement '${lang}': ${e.message}`, 'warn');
      if (lang !== this.config.fallbackLanguage) {
        return this.setLanguage(this.config.fallbackLanguage);
      }
      return false;
    }
  }

  /* ── Traduction d'une clé (notation pointée) ── */
  t(key, params = {}) {
    const ck = key + JSON.stringify(params);
    if (this._cache.has(ck)) return this._cache.get(ck);
    let val = this.dict;
    for (const k of key.split('.')) {
      val = (val && typeof val === 'object' && k in val) ? val[k] : null;
      if (val === null) { this._log(`Clé manquante: ${key}`, 'warn'); return key; }
    }
    if (typeof val === 'string' && Object.keys(params).length) {
      val = val.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
    }
    this._cache.set(ck, val);
    return val;
  }

  /* ── Tableaux (ex: mois) ── */
  arr(key) {
    const val = this.t(key);
    return Array.isArray(val) ? val : [];
  }

  /* ── Traduction de toute la page ── */
  _translatePage() {
    /* Textes */
    document.querySelectorAll('[translate]').forEach(el => {
      const key = el.getAttribute('translate');
      if (!key) return;
      const val = this.t(key);
      if (typeof val === 'string') {
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.value = val;
        else el.textContent = val;
      }
    });
    /* Placeholders */
    document.querySelectorAll('[translate-placeholder]').forEach(el => {
      const key = el.getAttribute('translate-placeholder');
      if (key) el.placeholder = this.t(key);
    });
    /* Titres (tooltip) */
    document.querySelectorAll('[translate-title]').forEach(el => {
      const key = el.getAttribute('translate-title');
      if (key) el.title = this.t(key);
    });
    /* Aria-label */
    document.querySelectorAll('[translate-aria]').forEach(el => {
      const key = el.getAttribute('translate-aria');
      if (key) el.setAttribute('aria-label', this.t(key));
    });
  }

  /* ── Traduit un élément et ses enfants (pour contenu ajouté dynamiquement) ── */
  translateElement(el) {
    if (!el || !el.querySelectorAll) return;
    ['translate','translate-placeholder','translate-title','translate-aria'].forEach(attr => {
      el.querySelectorAll(`[${attr}]`).forEach(child => {
        const key = child.getAttribute(attr);
        if (!key) return;
        const val = this.t(key);
        if (attr === 'translate') {
          if (child.tagName === 'INPUT' || child.tagName === 'TEXTAREA') child.value = val;
          else child.textContent = val;
        } else if (attr === 'translate-placeholder') child.placeholder = val;
        else if (attr === 'translate-title') child.title = val;
        else if (attr === 'translate-aria') child.setAttribute('aria-label', val);
      });
    });
  }

  /* ── Observation des mutations DOM ── */
  _observeDOM() {
    const obs = new MutationObserver(muts => {
      muts.forEach(m => {
        m.addedNodes.forEach(n => {
          if (n.nodeType === 1) this.translateElement(n);
        });
      });
    });
    obs.observe(document.body, { childList: true, subtree: true });
    this._observers.push(obs);
  }

  getCurrentLanguage() { return this.currentLanguage; }
  getAvailableLanguages() { return [...this.config.availableLanguages]; }

  _stored() {
    try { return localStorage.getItem(this.config.persistKey); } catch (e) { return null; }
  }

  _store(lang) {
    try { localStorage.setItem(this.config.persistKey, lang); } catch (e) {}
  }

  _browser() {
    const bl = (navigator.language || navigator.userLanguage || '').toLowerCase();
    return this.config.availableLanguages.find(l => bl.startsWith(l)) || null;
  }

  _log(msg, type = 'log') {
    if (this.config.debug) console[type](`[LangJS] ${msg}`);
  }

  destroy() {
    this._observers.forEach(o => o.disconnect());
    this._observers = [];
    this._cache.clear();
  }
}

/* Export */
if (typeof module !== 'undefined' && module.exports) module.exports = LangJS;
if (typeof window !== 'undefined') window.LangJS = LangJS;
