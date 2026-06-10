/**
 * Menap DB v6.0 — sql.js SQLite en mémoire
 *
 * Stockage PRINCIPAL : File System Access API
 *   → Le navigateur lit ET écrit directement dans menap.db sur le disque de l'utilisateur.
 *   → Les données sont réellement dans le fichier, partageables entre appareils.
 *
 * Stockage HORS-LIGNE / Fallback : localStorage
 *   → Utilisé uniquement si l'API n'est pas disponible (Firefox, Safari)
 *     ou si l'utilisateur n'a pas encore sélectionné de fichier.
 *
 * Architecture MULTI-UTILISATEURS : toutes les données sont dans UN seul fichier db.
 * Chaque donnée est liée à un user_id.
 */

class MenapDB {
  constructor() {
    this.db           = null;
    this.SQL          = null;
    this.STORAGE_KEY  = 'menap_sqlite_offline'; /* localStorage = fallback hors-ligne */
    this.IDB_KEY      = 'menap_file_handle';    /* clé IndexedDB pour le FileSystemFileHandle */
    this.ready        = false;
    this._uid         = null;
    this._fileHandle  = null;   /* FileSystemFileHandle — null si API non dispo */
    this._saveTimer   = null;   /* debounce 400 ms */
    this._fsSupported = (typeof window !== 'undefined' && 'showOpenFilePicker' in window);
  }

  /* ══════════════════════════════════════════════
     INITIALISATION
     ══════════════════════════════════════════════ */
  async init() {
    this.SQL = await initSqlJs({
      locateFile: f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.12.0/${f}`
    });

    if (this._fsSupported) {
      /* ── Tenter de restaurer le handle enregistré en IndexedDB ── */
      const saved = await this._idbGet(this.IDB_KEY);
      if (saved) {
        try {
          /* Vérifier que la permission est toujours accordée */
          const perm = await saved.queryPermission({ mode: 'readwrite' });
          if (perm === 'granted') {
            this._fileHandle = saved;
            this.db = await this._readFileHandle(saved);
          } else if (perm === 'prompt') {
            /* Demander à nouveau silencieusement — échouera sans geste utilisateur */
            const req = await saved.requestPermission({ mode: 'readwrite' }).catch(() => 'denied');
            if (req === 'granted') {
              this._fileHandle = saved;
              this.db = await this._readFileHandle(saved);
            }
          }
        } catch (_) {
          /* Handle invalide — sera redemandé plus tard */
          await this._idbDelete(this.IDB_KEY);
        }
      }

      if (!this.db) {
        /* Pas de handle valide → afficher la bannière de choix de fichier */
        this._showFileBanner();
        /* Charger depuis localStorage en attendant */
        this.db = await this._loadFromOfflineCache();
      }
    } else {
      /* API non disponible → fallback localStorage */
      this.db = await this._loadFromOfflineCache();
    }

    this._schema();
    this._defaultSuggestions();
    this._uid = this._rawGet('settings', 'current_user_id') || null;
    this._save();
    this.ready = true;
  }

  /* ── Lit le contenu d'un FileSystemFileHandle et retourne une Database ── */
  async _readFileHandle(handle) {
    const file = await handle.getFile();
    const buf  = await file.arrayBuffer();
    if (buf.byteLength < 16) {
      /* Fichier vide ou trop petit → nouvelle base */
      return new this.SQL.Database();
    }
    /* Vérifier magic bytes SQLite : 53 51 4c 69 74 65 20 66 6f 72 6d 61 74 20 33 00 */
    const magic = new Uint8Array(buf, 0, 16);
    const isSQLite = magic[0] === 0x53 && magic[1] === 0x51 && magic[2] === 0x4c;
    if (!isSQLite) throw new Error('Fichier invalide — pas un SQLite');
    console.log(`menap.db lu depuis le disque (${buf.byteLength} octets)`);
    return new this.SQL.Database(new Uint8Array(buf));
  }

  /* ── Demande à l'utilisateur de choisir OU créer menap.db ── */
  async pickFile() {
    try {
      let handle;
      try {
        /* Essayer d'ouvrir un fichier existant */
        [handle] = await window.showOpenFilePicker({
          types: [{ description: 'Base de données Menap', accept: { 'application/x-sqlite3': ['.db'] } }],
          multiple: false,
        });
      } catch (e) {
        if (e.name === 'AbortError') return false;
        /* Si pas trouvé → créer un nouveau fichier */
        handle = await window.showSaveFilePicker({
          suggestedName: 'menap.db',
          types: [{ description: 'Base de données Menap', accept: { 'application/x-sqlite3': ['.db'] } }],
        });
      }

      const perm = await handle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') { showToast('Permission refusée sur le fichier.', 'error'); return false; }

      /* Lire le contenu si le fichier existe déjà */
      let newDb;
      try   { newDb = await this._readFileHandle(handle); }
      catch (_) { newDb = new this.SQL.Database(); }

      this._fileHandle = handle;
      await this._idbSet(this.IDB_KEY, handle);

      /* Remplacer la DB en mémoire et migrer le schéma */
      this.db = newDb;
      this._schema();
      this._defaultSuggestions();
      this._uid = this._rawGet('settings', 'current_user_id') || null;

      /* Écrire immédiatement le fichier (initialise s'il est vide) */
      await this._writeFileHandle();
      this._hideFileBanner();

      showToast('Fichier menap.db sélectionné ✓', 'success');
      return true;
    } catch (e) {
      console.error('pickFile error:', e);
      showToast('Erreur lors du choix du fichier.', 'error');
      return false;
    }
  }

  /* ── Écrit la DB en mémoire dans le fichier sur le disque ── */
  async _writeFileHandle() {
    if (!this._fileHandle) return;
    try {
      const data = this.db.export();
      const writable = await this._fileHandle.createWritable();
      await writable.write(data);
      await writable.close();
    } catch (e) {
      console.warn('Écriture fichier échouée:', e.message);
      this._fileHandle = null; /* Permission révoquée → basculer sur localStorage */
    }
  }

  /* ── Charge depuis localStorage (cache hors-ligne) ── */
  async _loadFromOfflineCache() {
    const saved = localStorage.getItem(this.STORAGE_KEY);
    if (saved) {
      try {
        const db = new this.SQL.Database(this._b64ToArr(saved));
        console.log('DB chargée depuis localStorage (mode hors-ligne)');
        return db;
      } catch (_) {
        localStorage.removeItem(this.STORAGE_KEY);
      }
    }
    /* Dernier recours : data/menap.db servi statiquement */
    return this._loadFromStaticFile();
  }

  /* ── Charge depuis data/menap.db servi statiquement (premier lancement) ── */
  async _loadFromStaticFile() {
    try {
      const resp = await fetch('./data/menap.db?v=6', { cache: 'no-store' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      console.log('menap.db chargé depuis data/ (initialisation)');
      return new this.SQL.Database(new Uint8Array(buf));
    } catch (e) {
      console.warn('data/menap.db introuvable, nouvelle base vide:', e.message);
      return new this.SQL.Database();
    }
  }

  /* ══════════════════════════════════════════════
     BANNIÈRE "CHOISIR UN FICHIER"
     ══════════════════════════════════════════════ */
  _showFileBanner() {
    if ($('menap-file-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'menap-file-banner';
    banner.style.cssText = [
      'position:fixed','top:0','left:0','right:0','z-index:20000',
      'background:#1B4332','color:#fff','padding:10px 16px',
      'display:flex','align-items:center','justify-content:space-between',
      'gap:12px','font-size:13px','box-shadow:0 2px 8px rgba(0,0,0,.3)'
    ].join(';');
    banner.innerHTML = `
      <span>📂 <strong>Choisissez votre fichier menap.db</strong> pour enregistrer vos données sur le disque.</span>
      <button id="menap-pick-btn" style="background:#E07A5F;color:#fff;border:none;border-radius:8px;padding:6px 14px;font-weight:700;cursor:pointer;white-space:nowrap">
        Choisir le fichier
      </button>`;
    document.body.prepend(banner);
    $('menap-pick-btn').addEventListener('click', async () => {
      const ok = await this.pickFile();
      if (ok) {
        /* Recharger l'état de l'app après sélection */
        if (this.isLoggedIn()) {
          if (typeof renderDashboard === 'function') renderDashboard();
          if (typeof updateSettingsProfile === 'function') updateSettingsProfile();
        }
      }
    });
  }

  _hideFileBanner() {
    $('menap-file-banner')?.remove();
  }

  /* ══════════════════════════════════════════════
     SCHÉMA MULTI-UTILISATEURS
     ══════════════════════════════════════════════ */
  _schema() {
    this.db.run(`
      /* Paramètres globaux de l'app */
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT
      );

      /* Table des utilisateurs — TOUS les comptes du même appareil */
      CREATE TABLE IF NOT EXISTS users (
        id         TEXT PRIMARY KEY,
        email      TEXT UNIQUE NOT NULL,
        password   TEXT NOT NULL,
        first_name TEXT DEFAULT '',
        last_name  TEXT DEFAULT '',
        photo      TEXT DEFAULT '',
        lang       TEXT DEFAULT 'fr',
        currency   TEXT DEFAULT 'BIF',
        theme      TEXT DEFAULT 'light',
        sound      TEXT DEFAULT '1',
        created_at TEXT
      );

      /* Budgets — filtrés par user_id */
      CREATE TABLE IF NOT EXISTS budgets (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id        TEXT NOT NULL,
        name           TEXT NOT NULL,
        start_date     TEXT NOT NULL,
        end_date       TEXT NOT NULL,
        duration_type  TEXT DEFAULT 'month',
        duration_value INTEGER DEFAULT 1,
        is_imported    INTEGER DEFAULT 0,
        created_at     TEXT
      );

      /* Articles — filtrés par user_id */
      CREATE TABLE IF NOT EXISTS items (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        budget_id        INTEGER NOT NULL,
        user_id          TEXT NOT NULL,
        name             TEXT NOT NULL,
        budgeted_amount  REAL DEFAULT 0,
        is_finished      INTEGER DEFAULT 0,
        finished_date    TEXT
      );

      /* Achats — filtrés par user_id */
      CREATE TABLE IF NOT EXISTS purchases (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id  INTEGER NOT NULL,
        user_id  TEXT NOT NULL,
        date     TEXT NOT NULL,
        amount   REAL DEFAULT 0,
        qty      TEXT DEFAULT '',
        note     TEXT DEFAULT ''
      );

      /* Suggestions alimentaires partagées entre tous */
      CREATE TABLE IF NOT EXISTS food_suggestions (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
      );

      /* Membres du ménage — filtrés par user_id (gestionnaire) */
      CREATE TABLE IF NOT EXISTS members (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_uid  TEXT NOT NULL,
        user_id    TEXT DEFAULT '',
        first_name TEXT DEFAULT '',
        last_name  TEXT DEFAULT '',
        email      TEXT DEFAULT '',
        photo      TEXT DEFAULT '',
        role       TEXT DEFAULT 'member',
        joined_at  TEXT
      );

      /* Statuts de paiement — filtrés par owner_uid */
      CREATE TABLE IF NOT EXISTS payment_statuses (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_uid TEXT NOT NULL,
        budget_id INTEGER NOT NULL,
        member_id INTEGER NOT NULL,
        is_paid   INTEGER DEFAULT 0,
        UNIQUE(owner_uid, budget_id, member_id)
      );

      /* Requêtes de transfert de privilège */
      CREATE TABLE IF NOT EXISTS transfer_requests (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_uid      TEXT NOT NULL,
        from_member_id INTEGER,
        to_member_id   INTEGER NOT NULL,
        status         TEXT DEFAULT 'pending',
        created_at     TEXT
      );
    `);

    /* Migrations silencieuses (compat bases antérieures) */
    const migs = [
      `ALTER TABLE users ADD COLUMN lang TEXT DEFAULT 'fr'`,
      `ALTER TABLE users ADD COLUMN currency TEXT DEFAULT 'BIF'`,
      `ALTER TABLE users ADD COLUMN theme TEXT DEFAULT 'light'`,
      `ALTER TABLE users ADD COLUMN sound TEXT DEFAULT '1'`,
      `ALTER TABLE budgets ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE budgets ADD COLUMN is_imported INTEGER DEFAULT 0`,
      `ALTER TABLE items ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE purchases ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE members ADD COLUMN owner_uid TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE payment_statuses ADD COLUMN owner_uid TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE transfer_requests ADD COLUMN owner_uid TEXT NOT NULL DEFAULT ''`,
    ];
    migs.forEach(sql => { try { this.db.run(sql); } catch (_) {} });
  }

  /* ══════════════════════════════════════════════
     SUGGESTIONS PAR DÉFAUT
     ══════════════════════════════════════════════ */
  _defaultSuggestions() {
    const list = [
      'Riz','Huile','Sucre','Sel','Farine','Haricots','Pommes de terre','Tomates',
      'Oignons','Ail','Lait','Oeufs','Pain','Pâtes','Maïs','Sorgho','Manioc',
      'Bananes','Poisson','Poulet','Viande','Savon','Eau','Café','Thé',
      'Beurre','Margarine','Lentilles','Soja','Arachides',
      'Carotte','Chou','Épinards','Piment','Gingembre',
      'Avocat','Mangue','Papaye','Ananas','Orange',
      'Feuilles de manioc','Haricots verts','Igname','Patate douce',
      'Charbon de bois','Allumettes','Lessive','Liquide vaisselle',
      'Ibijumba','Ibishyimbo','Uburo','Amasaka','Ingano','Amavuta'
    ];
    const stmt = this.db.prepare(`INSERT OR IGNORE INTO food_suggestions (name) VALUES (?)`);
    list.forEach(n => stmt.run([n]));
    stmt.free();
  }

  /* ══════════════════════════════════════════════
     PERSISTANCE
     ══════════════════════════════════════════════ */

  /**
   * Sauvegarde la DB :
   *  1. Fichier menap.db sur le disque (File System Access API) si disponible
   *  2. localStorage en parallèle (fallback hors-ligne / navigateurs sans API)
   * Debounce 400 ms pour regrouper les écritures fréquentes.
   */
  _save() {
    /* 1. Toujours mettre à jour le cache localStorage (fallback) */
    try {
      ['menap_sqlite_v4','menap_sqlite_v3','menap_sqlite_v2','menap_sqlite_v1']
        .forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
      localStorage.setItem(this.STORAGE_KEY, this._arrToB64(this.db.export()));
    } catch (e) {
      console.warn('localStorage:', e.message);
    }

    /* 2. Écrire dans le fichier sur disque (debounce 400 ms) */
    if (this._fileHandle) {
      if (this._saveTimer) clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => this._writeFileHandle(), 400);
    }
  }

  /* ══════════════════════════════════════════════
     HELPERS INDEXEDDB (stockage du FileHandle)
     ══════════════════════════════════════════════ */

  _idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('menap_fs', 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore('handles');
      req.onsuccess  = e => resolve(e.target.result);
      req.onerror    = e => reject(e.target.error);
    });
  }

  async _idbGet(key) {
    try {
      const db  = await this._idbOpen();
      const tx  = db.transaction('handles', 'readonly');
      return await new Promise((res, rej) => {
        const r = tx.objectStore('handles').get(key);
        r.onsuccess = () => res(r.result);
        r.onerror   = () => rej(r.error);
      });
    } catch (_) { return null; }
  }

  async _idbSet(key, value) {
    try {
      const db = await this._idbOpen();
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(value, key);
    } catch (_) {}
  }

  async _idbDelete(key) {
    try {
      const db = await this._idbOpen();
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').delete(key);
    } catch (_) {}
  }

  /* ══════════════════════════════════════════════
     AUTHENTIFICATION MULTI-UTILISATEURS
     ══════════════════════════════════════════════ */

  /**
   * Crée un nouveau compte utilisateur dans la base partagée.
   * @returns {string} user_id généré
   * @throws {Error} si l'email est déjà utilisé
   */
  createUser({ email, password, first_name, last_name, photo, lang, currency }) {
    /* Vérifie unicité email */
    const existing = this._row(`SELECT id FROM users WHERE LOWER(email)=LOWER(?)`, [email]);
    if (existing) throw new Error('email_exists');

    const uid = this._genId();
    this.db.run(
      `INSERT INTO users (id,email,password,first_name,last_name,photo,lang,currency,theme,sound,created_at)
       VALUES (?,?,?,?,?,?,?,?,'light','1',?)`,
      [uid, email.toLowerCase().trim(), password,
       first_name||'', last_name||'', photo||'',
       lang||'fr', currency||'BIF',
       new Date().toISOString().slice(0,10)]
    );
    this._save();
    return uid;
  }

  /**
   * Authentifie un utilisateur par email + mot de passe.
   * @returns {object} profil utilisateur
   * @throws {Error} si identifiants invalides
   */
  loginUser(email, password) {
    const user = this._row(
      `SELECT * FROM users WHERE LOWER(email)=LOWER(?) AND password=?`,
      [email.trim(), password]
    );
    if (!user) throw new Error('invalid_credentials');

    /* Enregistre la session courante */
    this._uid = user.id;
    this.db.run(
      `INSERT OR REPLACE INTO settings (key,value) VALUES ('current_user_id',?)`,
      [user.id]
    );
    this._save();
    return user;
  }

  /** Déconnecte l'utilisateur courant (conserve les données) */
  logout() {
    this._uid = null;
    this.db.run(`DELETE FROM settings WHERE key='current_user_id'`);
    this._save();
  }

  isLoggedIn() {
    return !!this._uid;
  }

  currentUserId() {
    return this._uid;
  }

  /* ══════════════════════════════════════════════
     PROFIL DE L'UTILISATEUR COURANT
     ══════════════════════════════════════════════ */
  getProfile() {
    if (!this._uid) return { user_id:'', first_name:'', last_name:'', email:'', photo:'' };
    const u = this._row(`SELECT * FROM users WHERE id=?`, [this._uid]);
    return u ? { ...u, user_id: u.id } : { user_id:'', first_name:'', last_name:'', email:'', photo:'' };
  }

  saveProfile({ first_name, last_name, photo }) {
    if (!this._uid) return;
    this.db.run(
      `UPDATE users SET first_name=?,last_name=?,photo=? WHERE id=?`,
      [first_name||'', last_name||'', photo||'', this._uid]
    );
    this._save();
  }

  /* ══════════════════════════════════════════════
     PARAMÈTRES PAR UTILISATEUR
     (stockés dans la table users, colonne par colonne)
     ══════════════════════════════════════════════ */
  getSetting(key, def = '') {
    /* Paramètres globaux dans la table settings */
    if (['app_version','schema_version'].includes(key)) {
      return this._rawGet('settings', key) || def;
    }
    /* Paramètres utilisateur stockés dans users */
    if (!this._uid) return def;
    const allowed = ['lang','currency','theme','sound'];
    if (allowed.includes(key)) {
      const res = this.db.exec(`SELECT ${key} FROM users WHERE id=?`, [this._uid]);
      return (res.length && res[0].values.length) ? (res[0].values[0][0] ?? def) : def;
    }
    return def;
  }

  setSetting(key, value) {
    const allowed = ['lang','currency','theme','sound'];
    if (allowed.includes(key) && this._uid) {
      this.db.run(`UPDATE users SET ${key}=? WHERE id=?`, [String(value), this._uid]);
    } else {
      this.db.run(`INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)`, [key, String(value)]);
    }
    this._save();
  }

  _rawGet(table, key) {
    const res = this.db.exec(`SELECT value FROM ${table} WHERE key=?`, [key]);
    return (res.length && res[0].values.length) ? res[0].values[0][0] : null;
  }

  /* ══════════════════════════════════════════════
     BUDGETS (filtrés par user_id)
     ══════════════════════════════════════════════ */
  getBudgets() {
    return this._rows(
      `SELECT * FROM budgets WHERE user_id=? ORDER BY start_date DESC`,
      [this._uid]
    );
  }

  getBudget(id) {
    return this._row(`SELECT * FROM budgets WHERE id=? AND user_id=?`, [id, this._uid]);
  }

  getBudgetsByDate(dateStr) {
    return this._rows(
      `SELECT * FROM budgets WHERE user_id=? AND start_date<=? AND end_date>=? ORDER BY start_date DESC`,
      [this._uid, dateStr, dateStr]
    );
  }

  createBudget(data) {
    this.db.run(
      `INSERT INTO budgets (user_id,name,start_date,end_date,duration_type,duration_value,is_imported,created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [this._uid, data.name, data.start_date, data.end_date,
       data.duration_type||'month', data.duration_value||1, data.is_imported||0,
       new Date().toISOString().slice(0,10)]
    );
    this._save();
    return this.db.exec(`SELECT last_insert_rowid() as id`)[0].values[0][0];
  }

  updateBudget(id, data) {
    this.db.run(
      `UPDATE budgets SET name=?,start_date=?,end_date=?,duration_type=?,duration_value=?
       WHERE id=? AND user_id=?`,
      [data.name, data.start_date, data.end_date, data.duration_type, data.duration_value,
       id, this._uid]
    );
    this._save();
  }

  deleteBudget(id) {
    const its = this.getItemsByBudget(id);
    its.forEach(it => this.db.run(`DELETE FROM purchases WHERE item_id=? AND user_id=?`, [it.id, this._uid]));
    this.db.run(`DELETE FROM items   WHERE budget_id=? AND user_id=?`, [id, this._uid]);
    this.db.run(`DELETE FROM payment_statuses WHERE budget_id=? AND owner_uid=?`, [id, this._uid]);
    this.db.run(`DELETE FROM budgets WHERE id=? AND user_id=?`, [id, this._uid]);
    this._save();
  }

  /* ══════════════════════════════════════════════
     ITEMS (filtrés par user_id)
     ══════════════════════════════════════════════ */
  getItemsByBudget(budgetId) {
    return this._rows(
      `SELECT * FROM items WHERE budget_id=? AND user_id=? ORDER BY id`,
      [budgetId, this._uid]
    );
  }

  getItem(id) {
    return this._row(`SELECT * FROM items WHERE id=? AND user_id=?`, [id, this._uid]);
  }

  getTotalSpentByBudget(budgetId) {
    const res = this.db.exec(
      `SELECT COALESCE(SUM(p.amount),0) FROM purchases p
       JOIN items i ON p.item_id=i.id
       WHERE i.budget_id=? AND i.user_id=? AND p.user_id=?`,
      [budgetId, this._uid, this._uid]
    );
    return res.length ? (res[0].values[0][0] || 0) : 0;
  }

  getTotalSpentByItem(itemId) {
    const res = this.db.exec(
      `SELECT COALESCE(SUM(amount),0) FROM purchases WHERE item_id=? AND user_id=?`,
      [itemId, this._uid]
    );
    return res.length ? (res[0].values[0][0] || 0) : 0;
  }

  createItem(data) {
    this.db.run(
      `INSERT INTO items (budget_id,user_id,name,budgeted_amount) VALUES (?,?,?,?)`,
      [data.budget_id, this._uid, data.name, data.budgeted_amount||0]
    );
    this._save();
    return this.db.exec(`SELECT last_insert_rowid() as id`)[0].values[0][0];
  }

  deleteItem(id) {
    this.db.run(`DELETE FROM purchases WHERE item_id=? AND user_id=?`, [id, this._uid]);
    this.db.run(`DELETE FROM items     WHERE id=?      AND user_id=?`, [id, this._uid]);
    this._save();
  }

  markItemFinished(id, date) {
    this.db.run(
      `UPDATE items SET is_finished=1,finished_date=? WHERE id=? AND user_id=?`,
      [date, id, this._uid]
    );
    this._save();
  }

  unmarkItemFinished(id) {
    this.db.run(
      `UPDATE items SET is_finished=0,finished_date=NULL WHERE id=? AND user_id=?`,
      [id, this._uid]
    );
    this._save();
  }

  getPreviousItemData(name) {
    return this._rows(
      `SELECT i.*,
        (SELECT COALESCE(SUM(amount),0) FROM purchases WHERE item_id=i.id AND user_id=?) as spent
       FROM items i
       WHERE LOWER(i.name)=LOWER(?) AND i.user_id=?
       ORDER BY i.id DESC LIMIT 5`,
      [this._uid, name, this._uid]
    );
  }

  /* ══════════════════════════════════════════════
     ACHATS (filtrés par user_id)
     ══════════════════════════════════════════════ */
  getPurchasesByItem(itemId) {
    return this._rows(
      `SELECT * FROM purchases WHERE item_id=? AND user_id=? ORDER BY date DESC,id DESC`,
      [itemId, this._uid]
    );
  }

  createPurchase(data) {
    this.db.run(
      `INSERT INTO purchases (item_id,user_id,date,amount,qty,note) VALUES (?,?,?,?,?,?)`,
      [data.item_id, this._uid, data.date, data.amount, data.qty||'', data.note||'']
    );
    this._save();
  }

  deletePurchase(id) {
    this.db.run(`DELETE FROM purchases WHERE id=? AND user_id=?`, [id, this._uid]);
    this._save();
  }

  /* ══════════════════════════════════════════════
     SUGGESTIONS (partagées entre tous les users)
     ══════════════════════════════════════════════ */
  getSuggestions() {
    return this._rows(`SELECT name FROM food_suggestions ORDER BY name`).map(r => r.name);
  }

  addSuggestion(name) {
    if (!name || name.length < 2) return;
    try { this.db.run(`INSERT OR IGNORE INTO food_suggestions (name) VALUES (?)`, [name]); this._save(); } catch (_) {}
  }

  /* ══════════════════════════════════════════════
     MEMBRES DU MÉNAGE (filtrés par owner_uid)
     ══════════════════════════════════════════════ */
  getMembers() {
    return this._rows(
      `SELECT * FROM members WHERE owner_uid=? ORDER BY role DESC,first_name`,
      [this._uid]
    );
  }

  getMemberCount() {
    return this.getMembers().length;
  }

  getMemberByUserId(userId) {
    return this._row(
      `SELECT * FROM members WHERE user_id=? AND owner_uid=?`,
      [userId, this._uid]
    );
  }

  getMemberById(id) {
    return this._row(
      `SELECT * FROM members WHERE id=? AND owner_uid=?`,
      [id, this._uid]
    );
  }

  addMember(data) {
    this.db.run(
      `INSERT OR IGNORE INTO members
         (owner_uid,user_id,first_name,last_name,email,photo,role,joined_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [this._uid, data.user_id||'',
       data.first_name||'', data.last_name||'',
       data.email||'', data.photo||'',
       data.role||'member',
       new Date().toISOString().slice(0,10)]
    );
    this._save();
    return this.db.exec(`SELECT last_insert_rowid() as id`)[0].values[0][0];
  }

  updateMemberRole(id, role) {
    this.db.run(
      `UPDATE members SET role=? WHERE id=? AND owner_uid=?`,
      [role, id, this._uid]
    );
    this._save();
  }

  deleteMember(id) {
    this.db.run(`DELETE FROM payment_statuses WHERE member_id=? AND owner_uid=?`, [id, this._uid]);
    this.db.run(`DELETE FROM members          WHERE id=?        AND owner_uid=?`, [id, this._uid]);
    this._save();
  }

  /* ══════════════════════════════════════════════
     STATUTS PAIEMENT (filtrés par owner_uid)
     ══════════════════════════════════════════════ */
  initPaymentStatusesForBudget(budgetId) {
    this.getMembers().forEach(m => {
      try {
        this.db.run(
          `INSERT OR IGNORE INTO payment_statuses (owner_uid,budget_id,member_id,is_paid)
           VALUES (?,?,?,0)`,
          [this._uid, budgetId, m.id]
        );
      } catch (_) {}
    });
    this._save();
  }

  getPaymentStatuses(budgetId) {
    return this._rows(
      `SELECT ps.*,m.first_name,m.last_name,m.role
       FROM payment_statuses ps
       JOIN members m ON ps.member_id=m.id
       WHERE ps.budget_id=? AND ps.owner_uid=?`,
      [budgetId, this._uid]
    );
  }

  setPaymentStatus(budgetId, memberId, isPaid) {
    this.db.run(
      `INSERT OR REPLACE INTO payment_statuses (owner_uid,budget_id,member_id,is_paid)
       VALUES (?,?,?,?)`,
      [this._uid, budgetId, memberId, isPaid]
    );
    this._save();
  }

  /* ══════════════════════════════════════════════
     TRANSFERT DE PRIVILÈGE
     ══════════════════════════════════════════════ */
  createTransferRequest(fromMemberId, toMemberId) {
    this.db.run(
      `UPDATE transfer_requests SET status='cancelled' WHERE status='pending' AND owner_uid=?`,
      [this._uid]
    );
    this.db.run(
      `INSERT INTO transfer_requests (owner_uid,from_member_id,to_member_id,status,created_at)
       VALUES (?,?,?,'pending',?)`,
      [this._uid, fromMemberId, toMemberId, new Date().toISOString()]
    );
    this._save();
  }

  getPendingTransferRequest() {
    return this._row(
      `SELECT * FROM transfer_requests WHERE status='pending' AND owner_uid=? ORDER BY id DESC LIMIT 1`,
      [this._uid]
    );
  }

  resolveTransferRequest(requestId, accepted) {
    if (accepted) {
      const req = this._row(`SELECT * FROM transfer_requests WHERE id=?`, [requestId]);
      if (req) {
        this.db.run(`UPDATE members SET role='member'  WHERE role='manager' AND owner_uid=?`, [this._uid]);
        this.db.run(`UPDATE members SET role='manager' WHERE id=?           AND owner_uid=?`, [req.to_member_id, this._uid]);
      }
    }
    this.db.run(
      `UPDATE transfer_requests SET status=? WHERE id=?`,
      [accepted ? 'accepted' : 'rejected', requestId]
    );
    this._save();
  }

  /* ══════════════════════════════════════════════
     EXPORT / IMPORT .menap (budgets de l'utilisateur courant)
     ══════════════════════════════════════════════ */
  exportToMenap(budgetIds) {
    const budgets = budgetIds.map(bid => {
      const b = this.getBudget(bid);
      if (!b) return null;
      const items = this.getItemsByBudget(bid).map(it => ({
        ...it, purchases: this.getPurchasesByItem(it.id)
      }));
      return { ...b, items };
    }).filter(Boolean);

    const payload = JSON.stringify({ _menap: 4, budgets });
    let enc = '';
    for (let i = 0; i < payload.length; i++) enc += String.fromCharCode(payload.charCodeAt(i) ^ 42);
    return btoa(unescape(encodeURIComponent(enc)));
  }

  parseMenap(content) {
    try {
      let str = content;
      try {
        const dec0 = decodeURIComponent(escape(atob(str)));
        let dec = '';
        for (let i = 0; i < dec0.length; i++) dec += String.fromCharCode(dec0.charCodeAt(i) ^ 42);
        str = dec;
      } catch (_) {}
      const data = JSON.parse(str);
      if (!data._menap || !Array.isArray(data.budgets)) return { ok: false, error: 'invalid' };
      return { ok: true, budgets: data.budgets };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  importBudgetsFromMenap(budgets) {
    budgets.forEach(b => {
      const bid = this.createBudget({
        name: b.name, start_date: b.start_date, end_date: b.end_date,
        duration_type: b.duration_type||'month', duration_value: b.duration_value||1,
        is_imported: 1
      });
      (b.items || []).forEach(it => {
        const iid = this.createItem({ budget_id: bid, name: it.name, budgeted_amount: it.budgeted_amount||0 });
        if (it.is_finished) this.markItemFinished(iid, it.finished_date);
        (it.purchases || []).forEach(p => {
          this.createPurchase({ item_id: iid, date: p.date, amount: p.amount||0, qty: p.qty||'', note: p.note||'' });
        });
      });
    });
  }

  /* ══════════════════════════════════════════════
     EXPORT / IMPORT BINAIRE COMPLET (.db)
     ══════════════════════════════════════════════ */
  exportToBinary() {
    return this.db.export();
  }

  importFromBinary(arrayBuffer) {
    try {
      this.db = new this.SQL.Database(new Uint8Array(arrayBuffer));
      this._schema();
      this._uid = this._rawGet('settings', 'current_user_id') || null;
      this._save();
      return true;
    } catch (e) {
      console.error('importFromBinary error', e);
      return false;
    }
  }

  /* ══════════════════════════════════════════════
     SUPPRESSION DU COMPTE COURANT
     ══════════════════════════════════════════════ */
  deleteCurrentUser() {
    if (!this._uid) return;
    const uid = this._uid;
    /* Supprime toutes les données liées */
    this._rows(`SELECT id FROM budgets WHERE user_id=?`, [uid])
      .forEach(b => {
        this._rows(`SELECT id FROM items WHERE budget_id=? AND user_id=?`, [b.id, uid])
          .forEach(it => this.db.run(`DELETE FROM purchases WHERE item_id=? AND user_id=?`, [it.id, uid]));
        this.db.run(`DELETE FROM items WHERE budget_id=? AND user_id=?`, [b.id, uid]);
        this.db.run(`DELETE FROM payment_statuses WHERE budget_id=? AND owner_uid=?`, [b.id, uid]);
      });
    this.db.run(`DELETE FROM budgets              WHERE user_id=?`,   [uid]);
    this.db.run(`DELETE FROM members              WHERE owner_uid=?`, [uid]);
    this.db.run(`DELETE FROM transfer_requests    WHERE owner_uid=?`, [uid]);
    this.db.run(`DELETE FROM users                WHERE id=?`,        [uid]);
    this.logout();
  }

  /* ══════════════════════════════════════════════
     HELPERS
     ══════════════════════════════════════════════ */

  /**
   * Vérifie si l'utilisateur courant est gestionnaire.
   * Retourne true si aucun membre enregistré (= seul utilisateur = gestionnaire de fait).
   */
  isCurrentUserManager() {
    if (!this._uid) return true;
    try {
      const profile = this.getProfile();
      const member  = this.getMemberByUserId(profile.user_id || this._uid);
      return !member || member.role === 'manager';
    } catch (e) {
      console.warn('isCurrentUserManager error:', e);
      return true;
    }
  }

  /** Vérifie si au moins un utilisateur existe dans la base */
  hasAnyUser() {
    try {
      return !!this._row(`SELECT id FROM users LIMIT 1`);
    } catch (e) { return false; }
  }

  _genId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  _rows(sql, params = []) {
    try {
      const res = this.db.exec(sql, params);
      if (!res.length) return [];
      return res[0].values.map(row =>
        Object.fromEntries(res[0].columns.map((c, i) => [c, row[i]]))
      );
    } catch (e) {
      console.error('DB _rows error:', e.message, '|', sql);
      return [];
    }
  }

  _row(sql, params = []) {
    const rows = this._rows(sql, params);
    return rows.length ? rows[0] : null;
  }

  _arrToB64(arr) {
    let binary = '';
    const bytes = new Uint8Array(arr);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  _b64ToArr(base64) {
    const binary = atob(base64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
}

/* Instance globale — remplace l'ancienne MenapDB */
const db = new MenapDB();
