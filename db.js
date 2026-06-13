/**
 * Menap DB v4.1 — SQLite via sql.js, stockage exclusif api.php sigra.xo.je
 */
class MenapDB {
  constructor() {
    this.db = null;
    this.SQL = null;
    this.API_URL = 'https://sigra.xo.je/menap/api.php';
    this.ready = false;
    this._syncPending = false;
    this._uploading = false;
    this._syncTimer = null;
    this._pollTimer = null;
  }

  async init() {
    this.SQL = await initSqlJs({ locateFile: f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.12.0/${f}` });

    // Charger depuis le serveur — source UNIQUE
    let loaded = false;
    try {
      const resp = await fetch(this.API_URL, { cache: 'no-store', mode: 'cors' });
      if (resp.ok && resp.status !== 204) {
        const buf = await resp.arrayBuffer();
        if (buf.byteLength > 100) {
          this.db = new this.SQL.Database(new Uint8Array(buf));
          loaded = true;
        }
      }
    } catch(e) { console.warn('Init depuis serveur impossible:', e.message); }

    if (!loaded) this.db = new this.SQL.Database();

    this._schema();
    this._defaultSuggestions();
    this.ready = true;
  }

  _schema() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS profile (
        id INTEGER PRIMARY KEY DEFAULT 1,
        user_id TEXT DEFAULT '',
        first_name TEXT DEFAULT '',
        last_name TEXT DEFAULT '',
        email TEXT DEFAULT '',
        password TEXT DEFAULT '',
        photo TEXT DEFAULT '',
        lang TEXT DEFAULT 'fr',
        currency TEXT DEFAULT 'BIF',
        theme TEXT DEFAULT 'light'
      );
      CREATE TABLE IF NOT EXISTS budgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        duration_type TEXT DEFAULT 'month',
        duration_value INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (date('now'))
      );
      CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        budget_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        budgeted_amount REAL DEFAULT 0,
        is_finished INTEGER DEFAULT 0,
        finished_date TEXT DEFAULT NULL
      );
      CREATE TABLE IF NOT EXISTS purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        amount REAL DEFAULT 0,
        qty TEXT DEFAULT '',
        note TEXT DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS food_suggestions (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT UNIQUE DEFAULT '',
        first_name TEXT DEFAULT '',
        last_name TEXT DEFAULT '',
        email TEXT DEFAULT '',
        password TEXT DEFAULT '',
        photo TEXT DEFAULT '',
        role TEXT DEFAULT 'member',
        joined_at TEXT DEFAULT (date('now'))
      );
      CREATE TABLE IF NOT EXISTS payment_statuses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        budget_id INTEGER NOT NULL,
        member_id INTEGER NOT NULL,
        is_paid INTEGER DEFAULT 0,
        UNIQUE(budget_id, member_id)
      );
      CREATE TABLE IF NOT EXISTS transfer_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_member_id INTEGER,
        to_member_id INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    // Migrations
    try { this.db.run(`ALTER TABLE profile ADD COLUMN password TEXT DEFAULT ''`); } catch(e) {}
    try { this.db.run(`ALTER TABLE profile ADD COLUMN user_id TEXT DEFAULT ''`); } catch(e) {}
    try { this.db.run(`ALTER TABLE members ADD COLUMN password TEXT DEFAULT ''`); } catch(e) {}
    try { this.db.run(`ALTER TABLE members ADD COLUMN email TEXT DEFAULT ''`); } catch(e) {}
  }

  _defaultSuggestions() {
    const items = ['Riz','Huile','Sucre','Sel','Farine','Haricots','Pommes de terre','Tomates','Oignons','Ail','Lait','Oeufs','Pain','Pâtes','Maïs','Sorgho','Manioc','Bananes','Poisson','Poulet','Viande','Savon','Eau','Café','Thé','Beurre','Margarine','Lentilles','Soja','Arachides'];
    const stmt = this.db.prepare(`INSERT OR IGNORE INTO food_suggestions (name) VALUES (?)`);
    items.forEach(n => stmt.run([n]));
    stmt.free();
  }

  _save() { this._syncToServer(); }

  // ─── Profile (gestionnaire principal) ───
  getProfile() {
    const res = this.db.exec(`SELECT * FROM profile WHERE id=1`);
    if (!res.length || !res[0].values.length)
      return { user_id:'', first_name:'', last_name:'', email:'', password:'', photo:'' };
    const cols = res[0].columns, row = res[0].values[0];
    return Object.fromEntries(cols.map((c,i) => [c, row[i]]));
  }

  saveProfile(data) {
    const existing = this.getProfile();
    if (existing.first_name && existing.first_name !== '') {
      this.db.run(`UPDATE profile SET user_id=?,first_name=?,last_name=?,email=?,password=?,photo=? WHERE id=1`,
        [data.user_id||'',data.first_name||'',data.last_name||'',data.email||'',data.password||'',data.photo||'']);
    } else {
      this.db.run(`INSERT OR REPLACE INTO profile (id,user_id,first_name,last_name,email,password,photo) VALUES (1,?,?,?,?,?,?)`,
        [data.user_id||'',data.first_name||'',data.last_name||'',data.email||'',data.password||'',data.photo||'']);
    }
    this._save();
  }

  // Vérifie email+mdp dans profile (gestionnaire legacy)
  verifyPassword(email, password) {
    const p = this.getProfile();
    return p.email === email && p.password === password;
  }

  // ─── Multi-profils : utilisateur courant ───
  // Stocké en mémoire seulement (session locale)
  _currentUserId = null;

  setCurrentUser(userId) { this._currentUserId = userId; }

  getCurrentUser() {
    if (!this._currentUserId) return null;
    return this.getMemberByUserId(this._currentUserId);
  }

  isCurrentUserManager() {
    const u = this.getCurrentUser();
    return u && u.role === 'manager';
  }

  // ─── Settings ───
  getSetting(key, def = '') {
    const res = this.db.exec(`SELECT value FROM settings WHERE key=?`, [key]);
    return (res.length && res[0].values.length) ? res[0].values[0][0] : def;
  }

  setSetting(key, value) {
    this.db.run(`INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)`, [key, String(value)]);
    this._save();
  }

  // ─── Budgets ───
  getBudgets() { return this._rows(`SELECT * FROM budgets ORDER BY start_date DESC`); }
  getBudget(id) { return this._row(`SELECT * FROM budgets WHERE id=?`, [id]); }
  getBudgetsByDate(dateStr) {
    return this._rows(`SELECT * FROM budgets WHERE start_date<=? AND end_date>=? ORDER BY start_date DESC`, [dateStr, dateStr]);
  }

  createBudget(data) {
    this.db.run(`INSERT INTO budgets (name,start_date,end_date,duration_type,duration_value) VALUES (?,?,?,?,?)`,
      [data.name, data.start_date, data.end_date, data.duration_type||'month', data.duration_value||1]);
    this._save();
    return this.db.exec(`SELECT last_insert_rowid() as id`)[0].values[0][0];
  }

  updateBudget(id, data) {
    this.db.run(`UPDATE budgets SET name=?,start_date=?,end_date=?,duration_type=?,duration_value=? WHERE id=?`,
      [data.name, data.start_date, data.end_date, data.duration_type, data.duration_value, id]);
    this._save();
  }

  deleteBudget(id) {
    const items = this.getItemsByBudget(id);
    items.forEach(it => this.db.run(`DELETE FROM purchases WHERE item_id=?`, [it.id]));
    this.db.run(`DELETE FROM items WHERE budget_id=?`, [id]);
    this.db.run(`DELETE FROM payment_statuses WHERE budget_id=?`, [id]);
    this.db.run(`DELETE FROM budgets WHERE id=?`, [id]);
    this._save();
  }

  // ─── Items ───
  getItemsByBudget(budgetId) { return this._rows(`SELECT * FROM items WHERE budget_id=? ORDER BY id`, [budgetId]); }
  getItem(id) { return this._row(`SELECT * FROM items WHERE id=?`, [id]); }

  getTotalSpentByBudget(budgetId) {
    const res = this.db.exec(`SELECT COALESCE(SUM(p.amount),0) FROM purchases p JOIN items i ON p.item_id=i.id WHERE i.budget_id=?`, [budgetId]);
    return res.length ? (res[0].values[0][0] || 0) : 0;
  }

  getTotalSpentByItem(itemId) {
    const res = this.db.exec(`SELECT COALESCE(SUM(amount),0) FROM purchases WHERE item_id=?`, [itemId]);
    return res.length ? (res[0].values[0][0] || 0) : 0;
  }

  createItem(data) {
    this.db.run(`INSERT INTO items (budget_id,name,budgeted_amount) VALUES (?,?,?)`,
      [data.budget_id, data.name, data.budgeted_amount||0]);
    this._save();
    return this.db.exec(`SELECT last_insert_rowid() as id`)[0].values[0][0];
  }

  deleteItem(id) {
    this.db.run(`DELETE FROM purchases WHERE item_id=?`, [id]);
    this.db.run(`DELETE FROM items WHERE id=?`, [id]);
    this._save();
  }

  markItemFinished(id, date) {
    this.db.run(`UPDATE items SET is_finished=1,finished_date=? WHERE id=?`, [date, id]);
    this._save();
  }

  unmarkItemFinished(id) {
    this.db.run(`UPDATE items SET is_finished=0,finished_date=NULL WHERE id=?`, [id]);
    this._save();
  }

  getPreviousItemData(name) {
    return this._rows(`SELECT i.*,(SELECT COALESCE(SUM(amount),0) FROM purchases WHERE item_id=i.id) as spent FROM items i WHERE LOWER(i.name)=LOWER(?) ORDER BY i.id DESC LIMIT 5`, [name]);
  }

  // ─── Purchases ───
  getPurchasesByItem(itemId) { return this._rows(`SELECT * FROM purchases WHERE item_id=? ORDER BY date DESC,id DESC`, [itemId]); }

  createPurchase(data) {
    this.db.run(`INSERT INTO purchases (item_id,date,amount,qty,note) VALUES (?,?,?,?,?)`,
      [data.item_id, data.date, data.amount, data.qty||'', data.note||'']);
    this._save();
  }

  deletePurchase(id) {
    this.db.run(`DELETE FROM purchases WHERE id=?`, [id]);
    this._save();
  }

  // ─── Suggestions ───
  getSuggestions() { return this._rows(`SELECT name FROM food_suggestions ORDER BY name`).map(r => r.name); }

  addSuggestion(name) {
    if (!name || name.length < 2) return;
    try { this.db.run(`INSERT OR IGNORE INTO food_suggestions (name) VALUES (?)`, [name]); this._save(); } catch(e) {}
  }

  // ─── Members ───
  getMembers() { return this._rows(`SELECT * FROM members ORDER BY role DESC, first_name`); }
  getMemberCount() { return this._rows(`SELECT * FROM members`).length; }
  getMember(id) { return this._row(`SELECT * FROM members WHERE id=?`, [id]); }
  getMemberByUserId(userId) { return this._row(`SELECT * FROM members WHERE user_id=?`, [userId]); }
  getMemberById(id) { return this._row(`SELECT * FROM members WHERE id=?`, [id]); }
  getManagerMember() { return this._row(`SELECT * FROM members WHERE role='manager' LIMIT 1`); }
  hasManager() { return !!this.getManagerMember(); }

  addMember(data) {
    // Vérifier unicité user_id si fourni
    if (data.user_id) {
      const existing = this.getMemberByUserId(data.user_id);
      if (existing) return existing.id;
    }
    this.db.run(
      `INSERT INTO members (user_id,first_name,last_name,email,password,photo,role) VALUES (?,?,?,?,?,?,?)`,
      [data.user_id||'', data.first_name||'', data.last_name||'', data.email||'', data.password||'', data.photo||'', data.role||'member']
    );
    this._save();
    return this.db.exec(`SELECT last_insert_rowid() as id`)[0].values[0][0];
  }

  updateMember(id, data) {
    const existing = this.getMember(id);
    if (!existing) return;
    this.db.run(
      `UPDATE members SET first_name=?,last_name=?,email=?,password=?,photo=?,role=? WHERE id=?`,
      [data.first_name||existing.first_name, data.last_name||existing.last_name,
       data.email||existing.email, data.password||existing.password,
       data.photo !== undefined ? data.photo : existing.photo,
       data.role||existing.role, id]
    );
    this._save();
  }

  updateMemberRole(id, role) {
    this.db.run(`UPDATE members SET role=? WHERE id=?`, [role, id]);
    this._save();
  }

  deleteMember(id) {
    this.db.run(`DELETE FROM members WHERE id=?`, [id]);
    this.db.run(`DELETE FROM payment_statuses WHERE member_id=?`, [id]);
    this._save();
  }

  // Vérifier le mot de passe d'un membre (par user_id)
  verifyMemberPassword(userId, password) {
    const m = this.getMemberByUserId(userId);
    return m && m.password === password;
  }

  // ─── Payment Statuses ───
  initPaymentStatusesForBudget(budgetId) {
    const members = this.getMembers();
    members.forEach(m => {
      try { this.db.run(`INSERT OR IGNORE INTO payment_statuses (budget_id,member_id,is_paid) VALUES (?,?,0)`, [budgetId, m.id]); } catch(e) {}
    });
    this._save();
  }

  getPaymentStatuses(budgetId) {
    return this._rows(`SELECT ps.*,m.first_name,m.last_name,m.role FROM payment_statuses ps JOIN members m ON ps.member_id=m.id WHERE ps.budget_id=?`, [budgetId]);
  }

  setPaymentStatus(budgetId, memberId, isPaid) {
    this.db.run(`INSERT OR REPLACE INTO payment_statuses (budget_id,member_id,is_paid) VALUES (?,?,?)`, [budgetId, memberId, isPaid]);
    this._save();
  }

  // ─── Transfer Requests ───
  createTransferRequest(fromMemberId, toMemberId) {
    this.db.run(`UPDATE transfer_requests SET status='cancelled' WHERE status='pending'`);
    this.db.run(`INSERT INTO transfer_requests (from_member_id,to_member_id,status) VALUES (?,?,'pending')`, [fromMemberId, toMemberId]);
    this._save();
  }

  getPendingTransferRequest() {
    return this._row(`SELECT * FROM transfer_requests WHERE status='pending' ORDER BY id DESC LIMIT 1`);
  }

  resolveTransferRequest(requestId, accepted) {
    if (accepted) {
      const req = this._row(`SELECT * FROM transfer_requests WHERE id=?`, [requestId]);
      if (req) {
        this.db.run(`UPDATE members SET role='member' WHERE role='manager'`);
        this.db.run(`UPDATE members SET role='manager' WHERE id=?`, [req.to_member_id]);
      }
    }
    this.db.run(`UPDATE transfer_requests SET status=? WHERE id=?`, [accepted ? 'accepted' : 'rejected', requestId]);
    this._save();
  }

  // ─── Modifier profil membre courant ───
  updateProfileFull({ first_name, last_name, email, old_password, new_password, photo }) {
    const user = this.getCurrentUser();
    if (!user) throw new Error('not_logged_in');
    if (new_password) {
      if (!old_password) throw new Error('old_password_required');
      if (user.password !== old_password) throw new Error('wrong_password');
      if (new_password.length < 4) throw new Error('password_short');
    }
    const fn = first_name || user.first_name;
    const ln = last_name !== undefined ? last_name : user.last_name;
    const em = email || user.email;
    const ph = photo !== undefined ? photo : user.photo;
    const pw = new_password || user.password;
    this.db.run(`UPDATE members SET first_name=?,last_name=?,email=?,photo=?,password=? WHERE user_id=?`,
      [fn, ln, em, ph, pw, user.user_id]);
    // Sync profile table si gestionnaire
    if (user.role === 'manager') {
      this.db.run(`UPDATE profile SET first_name=?,last_name=?,email=?,photo=?,password=? WHERE id=1`,
        [fn, ln, em, ph, pw]);
    }
    this._save();
  }

  deleteCurrentUser() { this.clearAll(); }

  // ─── Export / Import .menap ───
  exportToMenap(budgetIds = null) {
    const profile = this.getProfile();
    const allBudgets = this.getBudgets();
    const toExport = budgetIds ? allBudgets.filter(b => budgetIds.includes(b.id)) : allBudgets;
    const budgets = toExport.map(b => ({
      ...b, items: this.getItemsByBudget(b.id).map(it => ({ ...it, purchases: this.getPurchasesByItem(it.id) }))
    }));
    const data = JSON.stringify({
      _menap: 4, profile, settings: {
        theme: this.getSetting('theme','light'), lang: this.getSetting('lang','fr'),
        currency: this.getSetting('currency','BIF'), sound: this.getSetting('sound','1')
      },
      budgets, members: this.getMembers(), foodSuggestions: this.getSuggestions()
    });
    let enc = '';
    for (let i = 0; i < data.length; i++) enc += String.fromCharCode(data.charCodeAt(i) ^ 42);
    return btoa(unescape(encodeURIComponent(enc)));
  }

  parseMenapFile(content) {
    try {
      let str = content;
      try {
        const decoded = decodeURIComponent(escape(atob(str.trim())));
        let dec = '';
        for (let i = 0; i < decoded.length; i++) dec += String.fromCharCode(decoded.charCodeAt(i) ^ 42);
        str = dec;
      } catch(e) {}
      const data = JSON.parse(str);
      return data._menap ? data : null;
    } catch(e) { return null; }
  }

  importFromMenap(content, budgetIndices = null) {
    try {
      const data = this.parseMenapFile(content);
      if (!data) return { ok: false, imported: 0, skipped: 0 };
      if (budgetIndices !== null && data.budgets) {
        data.budgets = data.budgets.filter((_, i) => budgetIndices.includes(i));
      }
      const result = this._applyDemData(data);
      return { ok: true, imported: result.imported, skipped: result.skipped };
    } catch(e) {
      console.error('importFromMenap error', e);
      return { ok: false, imported: 0, skipped: 0 };
    }
  }

  exportToDem() { return this.exportToMenap(); }
  importFromDem(content) { return this.importFromMenap(content); }

  // ─── Synchronisation api.php ───
  _syncToServer() {
    if (!navigator.onLine) return;
    this._syncPending = true;
    clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(() => this._doSync(), 600);
    if (window._onSyncStateChange) window._onSyncStateChange();
  }

  async _doSync() {
    if (this._uploading) return;
    this._uploading = true;
    this._syncPending = false;
    if (window._onSyncStateChange) window._onSyncStateChange();
    try {
      const bin = this.db.export();
      const resp = await fetch(this.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        mode: 'cors',
        body: bin
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
    } catch(e) {
      console.warn('Sync upload error:', e.message);
    } finally {
      this._uploading = false;
      if (window._onSyncStateChange) window._onSyncStateChange();
    }
  }

  startPolling(intervalMs = 15000) {
    this.stopPolling();
    let lastTs = 0;
    this._pollTimer = setInterval(async () => {
      if (!navigator.onLine || this._uploading || this._syncPending) return;
      try {
        const vResp = await fetch(this.API_URL + '?action=version', { cache: 'no-store', mode: 'cors' });
        if (!vResp.ok) return;
        const vJson = await vResp.json();
        if (vJson.ts <= lastTs) return;
        lastTs = vJson.ts;
        const resp = await fetch(this.API_URL, { cache: 'no-store', mode: 'cors' });
        if (!resp.ok || resp.status === 204) return;
        const buf = await resp.arrayBuffer();
        if (buf.byteLength < 100) return;
        this.db = new this.SQL.Database(new Uint8Array(buf));
        if (window._onSyncStateChange) window._onSyncStateChange();
        if (window._onRemoteChange) window._onRemoteChange();
      } catch(e) {}
    }, intervalMs);
    if (window._onSyncStateChange) window._onSyncStateChange();
  }

  stopPolling() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
  }

  _applyDemData(data) {
    let imported = 0, skipped = 0;
    if (data.profile) this.saveProfile(data.profile);
    if (data.settings) {
      Object.entries(data.settings).forEach(([k,v]) =>
        this.db.run(`INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)`, [k, String(v)]));
    }
    if (data.budgets) {
      data.budgets.forEach(b => {
        const exists = this._row(`SELECT id FROM budgets WHERE name=? AND start_date=? AND end_date=?`, [b.name, b.start_date, b.end_date]);
        if (exists) { skipped++; return; }
        this.db.run(`INSERT INTO budgets (name,start_date,end_date,duration_type,duration_value) VALUES (?,?,?,?,?)`,
          [b.name, b.start_date, b.end_date, b.duration_type||'month', b.duration_value||1]);
        const bid = this.db.exec(`SELECT last_insert_rowid() as id`)[0].values[0][0];
        if (b.items) b.items.forEach(it => {
          this.db.run(`INSERT OR IGNORE INTO items (budget_id,name,budgeted_amount,is_finished,finished_date) VALUES (?,?,?,?,?)`,
            [bid, it.name, it.budgeted_amount||0, it.is_finished||0, it.finished_date||null]);
          const iid = this.db.exec(`SELECT last_insert_rowid() as id`)[0].values[0][0];
          if (it.purchases) it.purchases.forEach(p =>
            this.db.run(`INSERT OR IGNORE INTO purchases (item_id,date,amount,qty,note) VALUES (?,?,?,?,?)`,
              [iid, p.date, p.amount, p.qty||'', p.note||'']));
        });
        imported++;
      });
    }
    if (data.members) {
      data.members.forEach(m =>
        this.db.run(`INSERT OR IGNORE INTO members (user_id,first_name,last_name,email,password,photo,role) VALUES (?,?,?,?,?,?,?)`,
          [m.user_id||'', m.first_name||'', m.last_name||'', m.email||'', m.password||'', m.photo||'', m.role||'member']));
    }
    if (data.foodSuggestions) {
      data.foodSuggestions.forEach(n => { try { this.db.run(`INSERT OR IGNORE INTO food_suggestions (name) VALUES (?)`, [n]); } catch(e) {} });
    }
    this._save();
    return { imported, skipped };
  }

  exportToBinary() { return this.db.export(); }

  clearAll() {
    ['profile','settings','budgets','items','purchases','members','payment_statuses','transfer_requests']
      .forEach(t => this.db.run(`DELETE FROM ${t}`));
    this._save();
    try { localStorage.clear(); } catch(e) {}
  }

  _rows(sql, params = []) {
    try {
      const res = this.db.exec(sql, params);
      if (!res.length) return [];
      const cols = res[0].columns;
      return res[0].values.map(row => Object.fromEntries(cols.map((c,i) => [c, row[i]])));
    } catch(e) { console.error('DB query error', e, sql); return []; }
  }

  _row(sql, params = []) {
    const rows = this._rows(sql, params);
    return rows.length ? rows[0] : null;
  }
}

const db = new MenapDB();
