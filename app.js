/**
 * Menap app.js v2.1
 * Gestionnaire de budget achataire — logique principale
 */

/* ═══════════════════════════════════════════════
   ÉTAT GLOBAL
   ═══════════════════════════════════════════════ */
const state = {
  currentView: 'dashboard',       // 'dashboard' | 'budgets' | 'budget-detail'
  selectedYear: null,
  selectedMonth: null,
  selectedDay: null,
  currentBudgetId: null,
  currentItemId: null,
  editBudgetId: null,
  editItemId: null,
  currency: 'BIF',
  theme: 'light',
  calcTarget: null,               // input dans lequel insérer le résultat calculatrice
  calcExpr: '',
  scanStream: null,               // flux caméra actif
  scanTimeout: null,
  lang: null,                     // instance LangJS
  eventsInitialized: false,       // garde anti-doublon pour initEventListeners
};

/* ── Raccourci ── */
const $ = id => document.getElementById(id);

/* ═══════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════ */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function pad(n) { return String(n).padStart(2, '0'); }
function fmtDate(s) {
  if (!s) return '';
  const [y,m,d] = s.split('-');
  const months = (state.lang ? state.lang.arr('months') : null) ||
    ['Janv','Févr','Mars','Avr','Mai','Juin','Juil','Août','Sept','Oct','Nov','Déc'];
  return `${Number(d)} ${months[Number(m)-1]} ${y}`;
}
function fmtCur(n) {
  const c = state.currency || 'BIF';
  return `${Number(n||0).toLocaleString()} ${c}`;
}
function tr(key, params) {
  return state.lang ? state.lang.t(key, params) : key;
}
function escHtml(s) {
  return String(s||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ── Toast ── */
let _toastTimer = null;
function showToast(msg, type = 'info') {
  let toast = $('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.style.cssText = [
      'position:fixed','bottom:80px','left:50%','transform:translateX(-50%)',
      'padding:10px 20px','border-radius:20px','color:white',
      'font-size:13px','font-weight:700','z-index:15000',
      'box-shadow:0 4px 12px rgba(0,0,0,.3)',
      'max-width:calc(100vw - 40px)','text-align:center',
      'animation:toastIn .2s ease-out'
    ].join(';');
    document.body.appendChild(toast);
  }
  const colors = { success:'#10b981', error:'#f43f5e', info:'#1B4332', warning:'#f59e0b' };
  toast.style.background = colors[type] || colors.info;
  toast.textContent = msg;
  toast.style.display = 'block';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 3200);
}

/* ── Modals ── */
function openModal(id) {
  const m = $(id); if (!m) return;
  m.style.display = 'flex';
  m.classList.remove('hidden');
}
function closeModal(id) {
  const m = $(id); if (!m) return;
  m.style.display = 'none';
}
function closeCurrentModal() {
  document.querySelectorAll('.modal:not(.hidden)').forEach(m => { m.style.display = 'none'; });
}

/* ── Format ─ */
function calcEndDate(startDate, durationType, durationValue) {
  const d = new Date(startDate);
  const v = Number(durationValue) || 1;
  switch (durationType) {
    case 'day':   d.setDate(d.getDate() + v - 1); break;
    case 'week':  d.setDate(d.getDate() + v * 7 - 1); break;
    case 'month': d.setMonth(d.getMonth() + v); d.setDate(d.getDate() - 1); break;
    case 'year':  d.setFullYear(d.getFullYear() + v); d.setDate(d.getDate() - 1); break;
    default:      d.setMonth(d.getMonth() + 1); d.setDate(d.getDate() - 1);
  }
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function isCurrentUserManager() {
  if (typeof db.isCurrentUserManager === 'function') {
    return db.isCurrentUserManager();
  }
  /* Fallback défensif si méthode non disponible (cache navigateur ancien) */
  return true;
}

/* ═══════════════════════════════════════════════
   DÉMARRAGE
   ═══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  /* 1. Affiche le spinner */
  showLoading(true);

  /* 2. Initialise la DB sql.js (charge menap.db ou localStorage) */
  await db.init();

  /* 3. Initialise la langue selon l'utilisateur connecté (ou 'fr' par défaut) */
  const savedLang = db.getSetting('lang', 'fr');
  state.lang = new LangJS({
    languagePath: './lang/',
    defaultLanguage: savedLang,
    availableLanguages: ['fr','en','rn','rw'],
    persistKey: 'menap_lang'
  });
  await state.lang.init(savedLang);

  /* 4. Thème et devise */
  state.theme    = db.getSetting('theme',    'light');
  state.currency = db.getSetting('currency', 'BIF');
  applyTheme(state.theme);

  showLoading(false);

  /* 5. Redirige selon l'état de connexion */
  if (db.isLoggedIn()) {
    hideOnboarding();
    initDate();
    initEventListeners();
    showDashboard();
    updateSyncIndicator();
  } else {
    showOnboarding();
  }
});

function showLoading(visible) {
  const el = $('loading-overlay');
  if (el) el.style.display = visible ? 'flex' : 'none';
}

/* ═══════════════════════════════════════════════
   ONBOARDING
   ═══════════════════════════════════════════════ */
function showOnboarding() {
  const screen = $('onboarding-screen');
  if (screen) screen.classList.remove('hidden');
  /* Onglet : si aucun utilisateur n'existe encore → création, sinon → connexion */
  const hasUsers = db.hasAnyUser ? db.hasAnyUser() : !!db._row(`SELECT id FROM users LIMIT 1`);
  setOnboardTab(hasUsers ? 'login' : 'create');

  /* Sélecteur photo profil */
  const photoInput = $('profile-pic-input');
  if (photoInput && !photoInput._bound) {
    photoInput._bound = true;
    photoInput.addEventListener('change', e => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const p = $('profile-pic-preview');
        if (p) {
          p.innerHTML = `<img src="${ev.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
          p.dataset.photo = ev.target.result;
        }
      };
      reader.readAsDataURL(file);
    });
  }

  /* Boutons submit */
  const startBtn = $('setup-start-btn');
  if (startBtn && !startBtn._bound) { startBtn._bound = true; startBtn.addEventListener('click', handleCreateProfile); }

  const loginBtn = $('login-btn');
  if (loginBtn && !loginBtn._bound) { loginBtn._bound = true; loginBtn.addEventListener('click', handleLogin); }

  setupPasswordToggles();
}

function hideOnboarding() {
  const screen = $('onboarding-screen');
  if (screen) screen.classList.add('hidden');
}

function setOnboardTab(tab) {
  ['create','login'].forEach(t => {
    $(`tab-onboard-${t}`)?.classList.toggle('active', t===tab);
    $(`onboard-${t}-section`)?.classList.toggle('hidden', t!==tab);
  });
}

function setupPasswordToggles() {
  document.querySelectorAll('.toggle-pw-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.closest('.password-wrapper')?.querySelector('input');
      if (!input) return;
      const isText = input.type === 'text';
      input.type = isText ? 'password' : 'text';
      btn.innerHTML = isText ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>';
    });
  });
}

function handleCreateProfile() {
  const fn       = $('profile-first-name').value.trim();
  const ln       = $('profile-last-name').value.trim();
  const em       = $('profile-email').value.trim();
  const pw       = $('profile-password').value;
  const lang     = $('setup-lang-select').value;
  const currency = $('setup-currency-select').value;
  const photo    = $('profile-pic-preview')?.dataset.photo || '';

  if (!fn) { showToast(tr('errors.first_name_required'), 'error'); return; }
  if (!em) { showToast(tr('errors.email_required'),      'error'); return; }
  if (!pw || pw.length < 4) { showToast(tr('errors.password_short'), 'error'); return; }

  let uid;
  try {
    uid = db.createUser({ email: em, password: pw, first_name: fn, last_name: ln, photo, lang, currency });
  } catch (e) {
    if (e.message === 'email_exists') {
      showToast(tr('errors.email_exists') || 'Cet email est déjà utilisé.', 'error');
    } else {
      showToast(tr('errors.generic') || 'Erreur lors de la création du compte.', 'error');
    }
    return;
  }

  /* Connexion automatique après inscription */
  db.loginUser(em, pw);

  /* Ajouter l'utilisateur comme gestionnaire du ménage */
  db.addMember({ user_id: uid, first_name: fn, last_name: ln, email: em, photo, role: 'manager' });

  state.currency = currency;
  applyTheme('light');

  state.lang.setLanguage(lang).then(() => {
    $('lang-select')?.setAttribute('value', lang);
  });

  hideOnboarding();
  initDate();
  initEventListeners();
  showDashboard();
}

function handleLogin() {
  const em = $('login-email').value.trim();
  const pw = $('login-password').value;

  if (!em) { showToast(tr('errors.email_required'), 'error'); return; }
  if (!pw) { showToast(tr('errors.password_short'), 'error'); return; }

  try {
    db.loginUser(em, pw);
  } catch (e) {
    showToast(tr('login.error_invalid') || 'Email ou mot de passe incorrect.', 'error');
    return;
  }

  /* Applique les préférences de cet utilisateur */
  state.currency = db.getSetting('currency', 'BIF');
  state.theme    = db.getSetting('theme',    'light');
  applyTheme(state.theme);

  const lang = db.getSetting('lang', 'fr');
  state.lang.setLanguage(lang);

  hideOnboarding();
  initDate();
  initEventListeners();
  showDashboard();
}

/* ═══════════════════════════════════════════════
   DATE INITIALE
   ═══════════════════════════════════════════════ */
function initDate() {
  const d = new Date();
  state.selectedYear  = d.getFullYear();
  state.selectedMonth = d.getMonth() + 1;
  state.selectedDay   = d.getDate();
  updateHeaderDate();
}

function updateHeaderDate() {
  const months = state.lang?.arr('months') ||
    ['Janv','Févr','Mars','Avr','Mai','Juin','Juil','Août','Sept','Oct','Nov','Déc'];
  const el_y = $('header-year-selector');
  const el_m = $('header-month-selector');
  const el_d = $('header-day-selector');
  if (el_y) el_y.querySelector('span')
    ? (el_y.querySelector('span').textContent = state.selectedYear)
    : (el_y.innerHTML = `<i class="fas fa-calendar-alt"></i><span>${state.selectedYear}</span>`);
  if (el_m) el_m.querySelector('span')
    ? (el_m.querySelector('span').textContent = months[state.selectedMonth-1])
    : (el_m.innerHTML = `<span>${months[state.selectedMonth-1]}</span>`);
  if (el_d) el_d.querySelector('span')
    ? (el_d.querySelector('span').textContent = pad(state.selectedDay))
    : (el_d.innerHTML = `<span>${pad(state.selectedDay)}</span>`);
}

function currentDateStr() {
  return `${state.selectedYear}-${pad(state.selectedMonth)}-${pad(state.selectedDay)}`;
}

/* ═══════════════════════════════════════════════
   THÈME
   ═══════════════════════════════════════════════ */
function applyTheme(theme) {
  document.body.classList.toggle('dark-theme', theme === 'dark');
  state.theme = theme;
  const sel = $('theme-select');
  if (sel) sel.value = theme;
}

/* ═══════════════════════════════════════════════
   SYNC INDICATOR
   ═══════════════════════════════════════════════ */
function updateSyncIndicator() {
  const dot  = $('sync-dot');
  const text = $('sync-text');
  const online = navigator.onLine;
  if (dot) dot.className = 'sync-dot' + (online ? '' : ' offline');
  if (text) text.textContent = online ? tr('app.synced') : tr('app.offline');
}
window.addEventListener('online',  updateSyncIndicator);
window.addEventListener('offline', updateSyncIndicator);

/* ═══════════════════════════════════════════════
   DASHBOARD
   ═══════════════════════════════════════════════ */
function showDashboard() {
  state.currentView = 'dashboard';
  const mc = $('main-content');
  if (!mc) return;
  mc.innerHTML = '';
  renderDashboard();
}

function renderDashboard() {
  const dateStr = currentDateStr();
  const budgets = db.getBudgetsByDate(dateStr);
  const profile = db.getProfile();
  const fullName = `${profile.first_name||''} ${profile.last_name||''}`.trim() || 'Utilisateur';
  const mc = $('main-content');

  // Titre
  const months = state.lang?.arr('months') ||
    ['Janv','Févr','Mars','Avr','Mai','Juin','Juil','Août','Sept','Oct','Nov','Déc'];
  const dateDisplay = `${pad(state.selectedDay)} ${months[state.selectedMonth-1]} ${state.selectedYear}`;

  let html = `
    <div class="dashboard-view">
      <div class="viewing-date-banner">
        <span><i class="fas fa-calendar-check" style="margin-right:6px"></i>${dateDisplay}</span>
        <span>${budgets.length} budget${budgets.length !== 1 ? 's' : ''}</span>
      </div>`;

  /* Résumé personnel */
  let totalBudgeted = 0, totalSpent = 0;
  budgets.forEach(b => {
    const items = db.getItemsByBudget(b.id);
    items.forEach(it => { totalBudgeted += it.budgeted_amount; });
    totalSpent += db.getTotalSpentByBudget(b.id);
  });
  const remaining = totalBudgeted - totalSpent;
  const pct = totalBudgeted > 0 ? Math.min(100, Math.round(totalSpent / totalBudgeted * 100)) : 0;
  const progressClass = pct >= 90 ? 'danger' : pct >= 70 ? 'warning' : '';

  if (budgets.length > 0) {
    html += `
      <div class="summary-cards">
        <div class="metric-card">
          <div class="metric-header"><span>Budget total</span><i class="fas fa-wallet"></i></div>
          <div class="metric-value">${fmtCur(totalBudgeted)}</div>
          <div class="metric-label">Budgétisé</div>
        </div>
        <div class="metric-card ${pct >= 90 ? 'alert-card' : 'success-card'}">
          <div class="metric-header"><span>Reste</span><i class="fas fa-coins"></i></div>
          <div class="metric-value" style="color:${remaining < 0 ? 'var(--danger-color)' : 'var(--success-color)'}">${fmtCur(remaining)}</div>
          <div class="metric-label">Dépensé: ${fmtCur(totalSpent)}</div>
        </div>
      </div>
      <div class="budget-progress-bar" style="height:8px;margin-bottom:14px">
        <div class="budget-progress-fill ${progressClass}" style="width:${pct}%"></div>
      </div>`;
  }

  /* Budgets actifs */
  if (budgets.length === 0) {
    html += `
      <div class="empty-state">
        <div class="empty-state-icon"><i class="fas fa-wallet"></i></div>
        <div style="font-size:15px;font-weight:600;margin-bottom:4px">${tr('budget.no_active')}</div>
        <div style="font-size:13px">${tr('budget.create_hint')}</div>
      </div>`;
  } else {
    budgets.forEach(b => { html += renderBudgetCard(b, true); });
  }

  html += '</div>';
  mc.innerHTML = html;

  /* FAB */
  renderFab(() => openCreateBudgetModal());
}

function renderBudgetCard(b, compact = false) {
  const spent = db.getTotalSpentByBudget(b.id);
  const items = db.getItemsByBudget(b.id);
  const budgeted = items.reduce((s,i) => s+i.budgeted_amount, 0);
  const pct = budgeted > 0 ? Math.min(100, Math.round(spent / budgeted * 100)) : 0;
  const progressClass = pct >= 90 ? 'danger' : pct >= 70 ? 'warning' : '';
  const impBadge = b.is_imported ? `<span class="imported-badge"><i class="fas fa-file-import"></i> ${tr('backup.imported_marker')}</span>` : '';

  return `
    <div class="budget-card" onclick="openBudgetDetail(${b.id})">
      <div class="budget-card-header">
        <div class="budget-card-name">${escHtml(b.name)}</div>
        <div class="budget-card-actions">
          <button class="item-action-btn" onclick="event.stopPropagation();openEditBudgetModal(${b.id})" title="Modifier"><i class="fas fa-pen"></i></button>
          <button class="item-action-btn delete-btn" onclick="event.stopPropagation();deleteBudget(${b.id})" title="Supprimer"><i class="fas fa-trash"></i></button>
        </div>
      </div>
      ${impBadge}
      <div class="budget-card-date"><i class="fas fa-calendar" style="margin-right:4px;color:var(--primary-color)"></i>${fmtDate(b.start_date)} → ${fmtDate(b.end_date)}</div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px">
        <span style="color:var(--text-muted)">${items.length} achats</span>
        <span style="font-weight:700;color:${pct>=90?'var(--danger-color)':'var(--primary-color)'}">${fmtCur(spent)} / ${fmtCur(budgeted)}</span>
      </div>
      <div class="budget-progress-bar">
        <div class="budget-progress-fill ${progressClass}" style="width:${pct}%"></div>
      </div>
      <div style="text-align:right;font-size:11px;color:var(--text-muted);margin-top:4px">${pct}%</div>
    </div>`;
}

/* ═══════════════════════════════════════════════
   BUDGETS VIEW
   ═══════════════════════════════════════════════ */
function showBudgetsView() {
  state.currentView = 'budgets';
  const mc = $('main-content');
  if (!mc) return;
  const budgets = db.getBudgets();
  let html = '<div class="budgets-view">';
  if (budgets.length === 0) {
    html += `<div class="empty-state"><div class="empty-state-icon"><i class="fas fa-wallet"></i></div><div>${tr('budget.no_active')}</div><div style="font-size:13px;margin-top:4px">${tr('budget.create_hint')}</div></div>`;
  } else {
    budgets.forEach(b => { html += renderBudgetCard(b); });
  }
  html += '</div>';
  mc.innerHTML = html;
  renderFab(() => openCreateBudgetModal());
}

/* ═══════════════════════════════════════════════
   BUDGET DETAIL
   ═══════════════════════════════════════════════ */
function openBudgetDetail(budgetId) {
  state.currentView = 'budget-detail';
  state.currentBudgetId = budgetId;
  renderBudgetDetail();
}

function renderBudgetDetail() {
  const bid = state.currentBudgetId;
  const b = db.getBudget(bid);
  if (!b) { showDashboard(); return; }

  const items = db.getItemsByBudget(bid);
  const spent = db.getTotalSpentByBudget(bid);
  const budgeted = items.reduce((s,i) => s+i.budgeted_amount, 0);
  const remaining = budgeted - spent;
  const statuses = db.getPaymentStatuses(bid);
  const mc = $('main-content');

  let html = `
    <div>
      <!-- En-tête budget -->
      <div class="budget-detail-header">
        <div class="budget-detail-nav">
          <button class="back-btn" onclick="goBack()"><i class="fas fa-arrow-left"></i></button>
          <div class="budget-detail-title">${escHtml(b.name)}</div>
          <button class="item-action-btn" onclick="openEditBudgetModal(${bid})" title="Modifier" style="flex-shrink:0"><i class="fas fa-pen"></i></button>
          <button class="item-action-btn delete-btn" onclick="deleteBudget(${bid})" title="Supprimer" style="flex-shrink:0"><i class="fas fa-trash"></i></button>
        </div>
        ${b.is_imported ? `<span class="imported-badge"><i class="fas fa-file-import"></i> ${tr('backup.imported_marker')}</span>` : ''}
        <div class="budget-detail-meta"><i class="fas fa-calendar" style="margin-right:4px"></i>${fmtDate(b.start_date)} → ${fmtDate(b.end_date)}</div>
        <div class="budget-stats">
          <div class="stat-box"><div class="val">${fmtCur(budgeted)}</div><div class="lbl">Budgétisé</div></div>
          <div class="stat-box"><div class="val">${fmtCur(spent)}</div><div class="lbl">Dépensé</div></div>
          <div class="stat-box ${remaining < 0 ? 'danger' : ''}"><div class="val">${fmtCur(remaining)}</div><div class="lbl">Reste</div></div>
        </div>
      </div>`;

  /* Statuts paiement */
  if (statuses.length > 0) {
    html += `
      <div class="payment-status-section">
        <div class="section-header" style="margin-bottom:10px">
          <span class="section-title" style="font-size:13px"><i class="fas fa-check-double" style="margin-right:6px;color:var(--primary-color)"></i>Paiements membres</span>
        </div>
        ${statuses.map(s => `
          <div class="payment-row">
            <div class="payment-member-name">${escHtml(`${s.first_name||''} ${s.last_name||''}`.trim())}</div>
            <button class="payment-status-toggle ${s.is_paid ? 'paid' : ''}"
              onclick="togglePayment(${bid},${s.member_id},${s.is_paid ? 0 : 1})">
              ${s.is_paid ? '✓ Payé' : '○ Non payé'}
            </button>
          </div>`).join('')}
      </div>`;
  }

  /* Items */
  html += `
      <div class="items-section">
        <div class="section-header">
          <span class="section-title">${items.length} article${items.length !== 1 ? 's' : ''}</span>
          <button class="add-item-btn" onclick="openCreateItemModal(${bid})">
            <i class="fas fa-plus"></i> Ajouter
          </button>
        </div>`;

  if (items.length === 0) {
    html += `<div class="empty-state" style="padding:30px"><div class="empty-state-icon"><i class="fas fa-shopping-basket"></i></div><div>Aucun article</div></div>`;
  } else {
    items.forEach(it => { html += renderItemCard(it); });
  }
  html += '</div></div>';
  mc.innerHTML = html;
  renderFab(() => openCreateItemModal(bid));
}

function renderItemCard(it) {
  const spent = db.getTotalSpentByItem(it.id);
  const pct = it.budgeted_amount > 0 ? Math.min(100, Math.round(spent / it.budgeted_amount * 100)) : 0;
  const progClass = pct >= 90 ? 'danger' : pct >= 70 ? 'warning' : '';
  const purchases = db.getPurchasesByItem(it.id);

  return `
    <div class="food-item-card ${it.is_finished ? 'exhausted' : ''}">
      <div class="food-item-header">
        <div class="food-item-name">${escHtml(it.name)}</div>
        <div class="food-item-actions">
          <button class="item-action-btn" onclick="openPurchasesList(${it.id})" title="Achats"><i class="fas fa-list"></i></button>
          <button class="item-action-btn" onclick="openRefillModal(${it.id})" title="Réapprovisioner"><i class="fas fa-plus-circle"></i></button>
          <button class="item-action-btn delete-btn" onclick="deleteItem(${it.id})" title="Supprimer"><i class="fas fa-trash"></i></button>
        </div>
      </div>
      ${it.is_finished ? `<div class="exhaust-date-label"><i class="fas fa-check-circle" style="margin-right:4px"></i>Terminé le ${fmtDate(it.finished_date)}</div>` : ''}
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px">
        <span style="color:var(--text-muted)">${purchases.length} achat${purchases.length !== 1 ? 's' : ''}</span>
        <span style="font-weight:700">${fmtCur(spent)} / ${fmtCur(it.budgeted_amount)}</span>
      </div>
      <div class="budget-progress-bar">
        <div class="budget-progress-fill ${progClass}" style="width:${pct}%"></div>
      </div>
      ${it.budgeted_amount > 0 ? `<div style="text-align:right;font-size:11px;color:var(--text-muted);margin-top:3px">${pct}%</div>` : ''}
    </div>`;
}

function goBack() {
  if (state.currentView === 'budget-detail') {
    if (state.currentView === 'budget-detail' && state.prevView === 'budgets') {
      showBudgetsView();
    } else {
      showDashboard();
    }
  } else {
    showDashboard();
  }
}

/* ═══════════════════════════════════════════════
   FAB
   ═══════════════════════════════════════════════ */
function renderFab(onClick) {
  let fab = $('main-fab');
  if (!fab) {
    fab = document.createElement('button');
    fab.id = 'main-fab';
    fab.className = 'fab';
    fab.innerHTML = '<i class="fas fa-plus"></i>';
    document.body.appendChild(fab);
  }
  fab.onclick = onClick;
}

/* ═══════════════════════════════════════════════
   MODALS : BUDGET
   ═══════════════════════════════════════════════ */
function openCreateBudgetModal() {
  state.editBudgetId = null;
  $('budget-modal-title').textContent = tr('budget.create_title');
  $('budget-name').value = '';
  $('budget-start-date').value = currentDateStr();
  $('budget-duration-type').value = 'month';
  $('budget-duration-value').value = '1';
  $('save-budget-btn').textContent = tr('budget.save');
  openModal('budget-modal');
}

function openEditBudgetModal(id) {
  const b = db.getBudget(id);
  if (!b) return;
  state.editBudgetId = id;
  $('budget-modal-title').textContent = tr('budget.edit_title');
  $('budget-name').value = b.name;
  $('budget-start-date').value = b.start_date;
  $('budget-duration-type').value = b.duration_type || 'month';
  $('budget-duration-value').value = b.duration_value || 1;
  $('save-budget-btn').textContent = tr('budget.update');
  openModal('budget-modal');
}

function saveBudget() {
  const name  = $('budget-name').value.trim();
  const start = $('budget-start-date').value;
  const dtype = $('budget-duration-type').value;
  const dval  = $('budget-duration-value').value;

  if (!name) { showToast(tr('errors.budget_name_required'), 'error'); return; }
  if (!start) { showToast(tr('errors.budget_date_required'), 'error'); return; }

  const end = calcEndDate(start, dtype, dval);
  const data = { name, start_date:start, end_date:end, duration_type:dtype, duration_value:Number(dval)||1 };

  if (state.editBudgetId) {
    db.updateBudget(state.editBudgetId, data);
    showToast(tr('toast.budget_updated'), 'success');
  } else {
    const bid = db.createBudget(data);
    db.initPaymentStatusesForBudget(bid);
    showToast(tr('toast.budget_created'), 'success');
  }
  closeModal('budget-modal');
  state.currentView === 'budgets' ? showBudgetsView() : state.currentView === 'budget-detail' ? renderBudgetDetail() : showDashboard();
}

function deleteBudget(id) {
  if (!confirm(tr('budget.delete_confirm'))) return;
  db.deleteBudget(id);
  showToast(tr('toast.budget_deleted'), 'info');
  if (state.currentView === 'budget-detail' && state.currentBudgetId === id) showDashboard();
  else if (state.currentView === 'budgets') showBudgetsView();
  else showDashboard();
}

/* ═══════════════════════════════════════════════
   MODALS : ITEM
   ═══════════════════════════════════════════════ */
function openCreateItemModal(budgetId) {
  state.editItemId = null;
  state.currentBudgetId = budgetId;
  $('item-modal-title').textContent = tr('item.create_title');
  $('item-name').value = '';
  $('item-budgeted').value = '';
  $('item-suggestions').innerHTML = '';
  $('item-advisor').classList.add('hidden');
  $('save-item-btn').textContent = tr('item.save');
  openModal('item-modal');
  setTimeout(() => $('item-name')?.focus(), 200);
}

function renderItemSuggestions(query) {
  const container = $('item-suggestions');
  if (!container) return;
  if (!query || query.length < 1) { container.innerHTML = ''; return; }
  const all = db.getSuggestions();
  const q = query.toLowerCase();
  const matches = all.filter(s => s.toLowerCase().includes(q)).slice(0, 10);
  container.innerHTML = matches.map(s =>
    `<span class="suggestion-tag" onclick="selectItemSuggestion('${escHtml(s)}')">${escHtml(s)}</span>`
  ).join('');
}

function selectItemSuggestion(name) {
  const input = $('item-name');
  if (input) { input.value = name; $('item-suggestions').innerHTML = ''; checkItemAdvisor(name); }
}

function checkItemAdvisor(name) {
  const prev = db.getPreviousItemData(name);
  const advisor = $('item-advisor');
  if (!advisor) return;
  if (prev.length > 0) {
    const avgSpent = prev.reduce((s,r) => s + (r.spent||0), 0) / prev.length;
    advisor.textContent = `💡 Budget moyen pour "${name}": ${fmtCur(avgSpent)}`;
    advisor.classList.remove('hidden');
  } else {
    advisor.classList.add('hidden');
  }
}

function saveItem() {
  const name = $('item-name').value.trim();
  const budgeted = parseFloat($('item-budgeted').value) || 0;

  if (!name) { showToast(tr('errors.item_name_required'), 'error'); return; }

  db.createItem({ budget_id: state.currentBudgetId, name, budgeted_amount: budgeted });
  db.addSuggestion(name);
  showToast(tr('toast.item_added'), 'success');
  closeModal('item-modal');
  renderBudgetDetail();
}

function deleteItem(id) {
  if (!confirm(tr('item.delete_confirm'))) return;
  db.deleteItem(id);
  showToast(tr('toast.item_deleted'), 'info');
  renderBudgetDetail();
}

/* ═══════════════════════════════════════════════
   MODALS : ACHAT (PURCHASE)
   ═══════════════════════════════════════════════ */
function openRefillModal(itemId) {
  state.currentItemId = itemId;
  const it = db.getItem(itemId);
  if (!it) return;
  $('refill-item-name').textContent = it.name;
  $('refill-date').value = currentDateStr();
  $('refill-amount').value = '';
  $('refill-qty').value = '';
  $('refill-note').value = '';
  openModal('refill-modal');
  setTimeout(() => $('refill-amount')?.focus(), 200);
}

function saveRefill() {
  const date   = $('refill-date').value;
  const amount = parseFloat($('refill-amount').value);
  const qty    = $('refill-qty').value.trim();
  const note   = $('refill-note').value.trim();

  if (!date) { showToast(tr('errors.date_required'), 'error'); return; }
  if (isNaN(amount) || amount <= 0) { showToast(tr('errors.amount_invalid'), 'error'); return; }

  db.createPurchase({ item_id: state.currentItemId, date, amount, qty, note });
  showToast(tr('toast.purchase_saved'), 'success');
  closeModal('refill-modal');
  renderBudgetDetail();
}

function openPurchasesList(itemId) {
  state.currentItemId = itemId;
  const it = db.getItem(itemId);
  if (!it) return;
  $('purchases-list-title').textContent = it.name;
  renderPurchasesList();
  openModal('purchases-list-modal');
}

function renderPurchasesList() {
  const purchases = db.getPurchasesByItem(state.currentItemId);
  const container = $('purchases-list-body');
  if (!container) return;

  if (purchases.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:24px"><i class="fas fa-receipt" style="font-size:28px;color:var(--border-color)"></i><div style="font-size:13px;margin-top:8px">Aucun achat enregistré</div></div>`;
    return;
  }
  container.innerHTML = purchases.map(p => `
    <div class="purchase-row">
      <div class="purchase-left">
        <span class="purchase-ref">${fmtDate(p.date)}${p.qty ? ` — ${escHtml(p.qty)}` : ''}</span>
        ${p.note ? `<span class="purchase-sub">${escHtml(p.note)}</span>` : ''}
      </div>
      <div class="purchase-right">
        <span class="purchase-amt">${fmtCur(p.amount)}</span>
        <button class="purchase-del-btn" onclick="deletePurchase(${p.id})"><i class="fas fa-trash"></i></button>
      </div>
    </div>`).join('');
}

function deletePurchase(id) {
  if (!confirm(tr('purchase.delete_confirm'))) return;
  db.deletePurchase(id);
  showToast(tr('toast.purchase_deleted'), 'info');
  renderPurchasesList();
  renderBudgetDetail();
}

function togglePayment(budgetId, memberId, isPaid) {
  db.setPaymentStatus(budgetId, memberId, isPaid);
  renderBudgetDetail();
}

/* ═══════════════════════════════════════════════
   SÉLECTEUR DATE (Year→Month→Day auto-nav)
   ═══════════════════════════════════════════════ */
let _selTab = 'years';

function openSelectionModal() {
  populateDateSelectors();
  openModal('selection-modal');
}

function switchSelectionTab(tab) {
  _selTab = tab;
  $('sel-years-section')?.classList.toggle('active-section', tab === 'years');
  $('sel-months-section')?.classList.toggle('active-section', tab === 'months');
  $('sel-days-section')?.classList.toggle('active-section', tab === 'days');
  /* Mise à jour des onglets */
  document.querySelectorAll('#selection-modal .tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  /* Fil d'Ariane */
  updateDateBreadcrumb();
}

function updateDateBreadcrumb() {
  const bc = $('date-breadcrumb');
  if (!bc) return;
  const months = state.lang?.arr('months') ||
    ['Janv','Févr','Mars','Avr','Mai','Juin','Juil','Août','Sept','Oct','Nov','Déc'];
  let html = `<span onclick="switchSelectionTab('years')" class="${_selTab==='years'?'active':''}">${state.selectedYear}</span>`;
  if (_selTab !== 'years') {
    html += `<span class="sep">›</span><span onclick="switchSelectionTab('months')" class="${_selTab==='months'?'active':''}">${months[state.selectedMonth-1]}</span>`;
  }
  if (_selTab === 'days') {
    html += `<span class="sep">›</span><span class="active">${pad(state.selectedDay)}</span>`;
  }
  bc.innerHTML = html;
}

function populateDateSelectors() {
  /* Années */
  const yearGrid = $('year-grid');
  if (yearGrid) {
    const currentYear = new Date().getFullYear();
    let html = '';
    for (let y = currentYear - 3; y <= currentYear + 2; y++) {
      html += `<div class="year-item${y===state.selectedYear?' selected':''}" onclick="selectYear(${y})">${y}</div>`;
    }
    yearGrid.innerHTML = html;
  }
  /* Mois */
  const monthGrid = $('month-grid');
  if (monthGrid) {
    const months = state.lang?.arr('months') ||
      ['Janv','Févr','Mars','Avr','Mai','Juin','Juil','Août','Sept','Oct','Nov','Déc'];
    monthGrid.innerHTML = months.map((m,i) =>
      `<div class="month-item${(i+1)===state.selectedMonth?' selected':''}" onclick="selectMonth(${i+1})">${m}</div>`
    ).join('');
  }
  /* Jours */
  populateDayGrid();
  updateDateBreadcrumb();
}

function populateDayGrid() {
  const dayGrid = $('day-grid');
  if (!dayGrid) return;
  const daysInMonth = new Date(state.selectedYear, state.selectedMonth, 0).getDate();
  let html = '';
  for (let d = 1; d <= daysInMonth; d++) {
    html += `<div class="day-item${d===state.selectedDay?' selected':''}" onclick="selectDay(${d})">${d}</div>`;
  }
  dayGrid.innerHTML = html;
}

/* Sélection avec auto-navigation */
function selectYear(y) {
  state.selectedYear = y;
  updateHeaderDate();
  /* Auto-nav vers mois */
  populateDateSelectors();
  switchSelectionTab('months');
}

function selectMonth(m) {
  state.selectedMonth = m;
  /* Ajuste jour si dépassement */
  const daysInMonth = new Date(state.selectedYear, m, 0).getDate();
  if (state.selectedDay > daysInMonth) state.selectedDay = daysInMonth;
  updateHeaderDate();
  /* Auto-nav vers jours */
  populateDateSelectors();
  switchSelectionTab('days');
}

function selectDay(d) {
  state.selectedDay = d;
  updateHeaderDate();
  /* Ferme le modal et rafraîchit */
  closeModal('selection-modal');
  if (state.currentView === 'dashboard') renderDashboard();
  else if (state.currentView === 'budgets') showBudgetsView();
}

/* ═══════════════════════════════════════════════
   RECHERCHE
   ═══════════════════════════════════════════════ */
function performSearch(q) {
  const container = $('search-results');
  if (!container) return;
  if (!q || q.trim().length < 2) { container.innerHTML = ''; return; }

  const all = db.getBudgets();
  const results = [];
  const ql = q.toLowerCase();

  all.forEach(b => {
    if (b.name.toLowerCase().includes(ql)) {
      results.push({ type:'budget', label:b.name, sub:`${fmtDate(b.start_date)} → ${fmtDate(b.end_date)}`, budgetId:b.id });
    }
    const items = db.getItemsByBudget(b.id);
    items.forEach(it => {
      if (it.name.toLowerCase().includes(ql)) {
        results.push({ type:'item', label:it.name, sub:`Budget: ${b.name}`, budgetId:b.id, itemId:it.id });
      }
      const purchases = db.getPurchasesByItem(it.id);
      purchases.forEach(p => {
        if ((p.note||'').toLowerCase().includes(ql) || (p.qty||'').toLowerCase().includes(ql)) {
          results.push({ type:'purchase', label:`${it.name} — ${fmtCur(p.amount)}`, sub:`${fmtDate(p.date)} ${p.note||''}`, budgetId:b.id, itemId:it.id });
        }
      });
    });
  });

  if (results.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:24px">${tr('search.empty')}</div>`;
    return;
  }

  container.innerHTML = results.slice(0,30).map(r => `
    <div class="search-result-item" onclick="openSearchResult(${r.budgetId},${r.itemId||'null'})">
      <div class="result-ref"><i class="fas fa-${r.type==='budget'?'wallet':r.type==='item'?'shopping-basket':'receipt'}"></i>${escHtml(r.label)}</div>
      <div class="result-text">${escHtml(r.sub)}</div>
    </div>`).join('');
}

function openSearchResult(budgetId, itemId) {
  closeModal('search-modal');
  openBudgetDetail(budgetId);
  if (itemId) {
    setTimeout(() => openPurchasesList(itemId), 300);
  }
}

/* ═══════════════════════════════════════════════
   PARAMÈTRES
   ═══════════════════════════════════════════════ */
function updateSettingsProfile() {
  try {
    const p = db.getProfile();
    const fullName = `${p.first_name||''} ${p.last_name||''}`.trim() || 'Utilisateur';
    const nameEl  = $('settings-profile-name');  if (nameEl)  nameEl.textContent  = fullName;
    const emailEl = $('settings-profile-email'); if (emailEl) emailEl.textContent = p.email||'';
    if (p.photo) {
      const img = $('settings-profile-pic'), fb = $('settings-profile-pic-fallback');
      if (img) { img.src = p.photo; img.style.display = ''; }
      if (fb)  fb.style.display = 'none';
    }
    const dName  = $('drawer-profile-name');  if (dName)  dName.textContent  = fullName;
    const dEmail = $('drawer-profile-email'); if (dEmail) dEmail.textContent = p.email||'';
    if (p.photo) {
      const da = $('drawer-avatar'), df = $('drawer-avatar-fallback');
      if (da) { da.src = p.photo; da.style.display = ''; }
      if (df) df.style.display = 'none';
    }
    const badge = $('drawer-role-badge');
    if (badge) {
      badge.style.display = isCurrentUserManager() ? 'inline-block' : 'none';
    }
    const themeSelect    = $('theme-select');    if (themeSelect)    themeSelect.value    = db.getSetting('theme',    'light');
    const langSelect     = $('lang-select');     if (langSelect)     langSelect.value     = db.getSetting('lang',     'fr');
    const currSelect     = $('currency-select'); if (currSelect)     currSelect.value     = state.currency;
    const soundToggle    = $('sound-toggle');    if (soundToggle)    soundToggle.checked  = db.getSetting('sound',    '1') === '1';
  } catch (e) {
    console.error('updateSettingsProfile error:', e);
  }
}

/* ═══════════════════════════════════════════════
   MEMBRES
   ═══════════════════════════════════════════════ */
function openMembersModal() {
  try {
    renderMembersList();
    checkPrivilegeTransfer();
    openModal('members-modal');
  } catch (e) {
    console.error('openMembersModal error:', e);
    showToast('Erreur lors de l\'ouverture des membres.', 'error');
  }
}

function renderMembersList() {
  try {
    const members = db.getMembers();
    const list = $('members-list'), count = $('members-count');
    if (!list) return;
    if (count) count.textContent = members.length;
    if (members.length === 0) {
      list.innerHTML = `<div class="empty-state" style="padding:20px"><i class="fas fa-users" style="font-size:24px;color:var(--text-muted)"></i><div style="font-size:13px;margin-top:8px">${tr('members.none')}</div></div>`;
    } else {
      list.innerHTML = members.map(m => {
        const initials = (m.first_name?.[0]||'')+(m.last_name?.[0]||'');
        const name = `${m.first_name||''} ${m.last_name||''}`.trim()||'Membre';
        return `
          <div class="member-row">
            <div class="member-avatar">${m.photo ? `<img src="${escHtml(m.photo)}" alt="${escHtml(name)}">` : (initials || '<i class="fas fa-user"></i>')}</div>
            <div class="member-info">
              <div class="member-name">${escHtml(name)}</div>
              <div class="member-email">${escHtml(m.email||'')}</div>
            </div>
            <span class="member-role ${m.role==='manager'?'manager':'member'}">${m.role==='manager'?'👑 '+tr('members.manager'):tr('members.member')}</span>
            ${isCurrentUserManager() && m.role !== 'manager' ?
              `<button class="item-action-btn delete-btn" style="width:28px;height:28px;font-size:11px;flex-shrink:0" onclick="removeMember(${m.id})" title="${tr('members.remove')}"><i class="fas fa-user-minus"></i></button>` : ''}
          </div>`;
      }).join('');
    }

    const transferSection = $('privilege-transfer-section');
    if (transferSection) {
      if (isCurrentUserManager() && members.length > 1) {
        transferSection.style.display = 'block';
        const sel = $('transfer-target-select');
        sel.innerHTML = `<option value="">${tr('members.transfer_choose')}</option>`;
        members.filter(m => m.role !== 'manager').forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = `${m.first_name||''} ${m.last_name||''}`.trim();
          sel.appendChild(opt);
        });
      } else {
        transferSection.style.display = 'none';
      }
    }
  } catch (e) {
    console.error('renderMembersList error:', e);
  }
}

function removeMember(memberId) {
  if (!confirm(tr('members.remove_confirm'))) return;
  db.deleteMember(memberId);
  renderMembersList();
  showToast(tr('toast.member_removed'), 'info');
}

function checkPrivilegeTransfer() {
  const profile = db.getProfile();
  const myMember = db.getMemberByUserId(profile.user_id);
  const pending = db.getPendingTransferRequest();
  const approvalSection = $('transfer-approval-section');
  if (!approvalSection) return;
  if (pending && myMember && pending.to_member_id == myMember.id) {
    approvalSection.style.display = 'block';
    const from = db.getMemberById(pending.from_member_id);
    const fromName = from ? `${from.first_name} ${from.last_name}`.trim() : 'Le gestionnaire';
    $('transfer-approval-text').textContent = `${fromName} souhaite vous céder les privilèges de gestionnaire. Acceptez-vous?`;
    $('approve-transfer-btn').onclick = () => {
      db.resolveTransferRequest(pending.id, true);
      renderMembersList(); approvalSection.style.display = 'none';
      updateSettingsProfile();
      showToast(tr('toast.transfer_accepted'), 'success');
    };
    $('reject-transfer-btn').onclick = () => {
      db.resolveTransferRequest(pending.id, false);
      approvalSection.style.display = 'none';
      showToast(tr('toast.transfer_rejected'), 'info');
    };
  } else {
    approvalSection.style.display = 'none';
  }
}

/* ═══════════════════════════════════════════════
   EXPORT / IMPORT .menap
   ═══════════════════════════════════════════════ */
function openBackupModal() {
  renderMenapExportList();
  openModal('backup-modal');
}

function renderMenapExportList() {
  const container = $('menap-export-list');
  if (!container) return;
  const budgets = db.getBudgets();
  if (budgets.length === 0) {
    container.innerHTML = `<div style="font-size:13px;color:var(--text-muted);padding:8px 0">${tr('backup.no_budgets')}</div>`;
    return;
  }
  container.innerHTML = budgets.map(b => {
    const items = db.getItemsByBudget(b.id);
    const spent = db.getTotalSpentByBudget(b.id);
    return `
      <div class="menap-budget-row" onclick="this.querySelector('input').click()">
        <input type="checkbox" name="export-budget" value="${b.id}" onclick="event.stopPropagation()">
        <div class="menap-budget-info">
          <div class="menap-budget-name">${escHtml(b.name)}</div>
          <div class="menap-budget-meta">${fmtDate(b.start_date)} · ${items.length} articles · ${fmtCur(spent)}</div>
        </div>
      </div>`;
  }).join('');
}

function exportMenap() {
  const checked = [...document.querySelectorAll('input[name="export-budget"]:checked')];
  if (checked.length === 0) { showToast(tr('backup.export_none_selected'), 'error'); return; }
  const ids = checked.map(c => Number(c.value));
  const content = db.exportToMenap(ids);
  const blob = new Blob([content], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `menap_budgets_${today()}.menap`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(tr('backup.export_success'), 'success');
}

function triggerMenapImport() {
  $('menap-import-file-input')?.click();
}

function handleMenapImportFile(file) {
  if (!file) return;
  if (!file.name.endsWith('.menap')) { showToast(tr('backup.file_invalid'), 'error'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const parsed = db.parseMenap(e.target.result);
    if (!parsed.ok) { showToast(tr('backup.file_invalid'), 'error'); return; }
    if (!parsed.budgets || parsed.budgets.length === 0) { showToast(tr('backup.file_empty'), 'error'); return; }
    openMenapImportSelector(parsed.budgets);
  };
  reader.readAsText(file);
}

function openMenapImportSelector(budgets) {
  const container = $('menap-import-list');
  if (!container) return;
  container.innerHTML = budgets.map((b, idx) => {
    const items = b.items || [];
    const spent = items.reduce((s,it) => s + (it.purchases||[]).reduce((ps,p) => ps + (p.amount||0), 0), 0);
    const budgeted = items.reduce((s,it) => s + (it.budgeted_amount||0), 0);
    return `
      <div class="menap-budget-row" onclick="this.querySelector('input').click()">
        <input type="checkbox" name="import-budget" value="${idx}" onclick="event.stopPropagation()">
        <div class="menap-budget-info">
          <div class="menap-budget-name">${escHtml(b.name)}</div>
          <div class="menap-budget-meta">${fmtDate(b.start_date)} · ${items.length} articles · ${fmtCur(budgeted)}</div>
        </div>
      </div>`;
  }).join('');

  /* Stocke temporairement les budgets */
  window._pendingImportBudgets = budgets;
  openModal('menap-import-modal');
}

function confirmMenapImport() {
  const checked = [...document.querySelectorAll('input[name="import-budget"]:checked')];
  if (checked.length === 0) { showToast(tr('backup.import_none_selected'), 'error'); return; }
  const selected = checked.map(c => window._pendingImportBudgets[Number(c.value)]);
  db.importBudgetsFromMenap(selected);
  window._pendingImportBudgets = null;
  showToast(tr('backup.import_success'), 'success');
  closeModal('menap-import-modal');
  if (state.currentView === 'budgets') showBudgetsView();
  else showDashboard();
}

function selectAllExport(all) {
  document.querySelectorAll('input[name="export-budget"]').forEach(c => c.checked = all);
}
function selectAllImport(all) {
  document.querySelectorAll('input[name="import-budget"]').forEach(c => c.checked = all);
}

/* ── Sauvegarde complète .db ── */
function exportFullDB() {
  const buf = db.exportToBinary();
  const blob = new Blob([buf], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `menap_${today()}.db`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(tr('toast.db_exported'), 'success');
}

function triggerFullDBImport() {
  $('full-db-import-input')?.click();
}

function handleFullDBImport(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const ok = db.importFromBinary(e.target.result);
    if (ok) { showToast(tr('toast.data_restored'), 'success'); setTimeout(() => location.reload(), 1200); }
    else showToast(tr('backup.file_invalid'), 'error');
  };
  reader.readAsArrayBuffer(file);
}

/* ═══════════════════════════════════════════════
   SCANNER QR
   ═══════════════════════════════════════════════ */
async function startQRScanner() {
  const statusEl = $('qr-scan-status');
  if (statusEl) statusEl.textContent = tr('qr.hint');

  if (!navigator.mediaDevices?.getUserMedia) {
    showToast(tr('qr.no_camera'), 'error');
    return;
  }
  openModal('camera-qr-modal');

  /* Arrêt propre si déjà actif */
  stopCamera();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    state.scanStream = stream;
    const video = $('qr-camera-video');
    video.srcObject = stream;
    await video.play();
    scanLoop();
    /* Timeout 30s */
    state.scanTimeout = setTimeout(() => {
      if (statusEl) statusEl.textContent = tr('qr.timeout');
      stopCamera();
      closeModal('camera-qr-modal');
      showToast(tr('qr.timeout'), 'warning');
    }, 30000);
  } catch (err) {
    showToast(tr('qr.allow_camera'), 'error');
    closeModal('camera-qr-modal');
  }
}

function scanLoop() {
  const video  = $('qr-camera-video');
  const canvas = $('qr-camera-canvas');
  if (!video || !canvas || !state.scanStream) return;

  if (video.readyState < 2) {
    requestAnimationFrame(scanLoop);
    return;
  }

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const w = video.videoWidth  || 640;
  const h = video.videoHeight || 480;
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(video, 0, 0, w, h);

  let code = null;
  const imageData = ctx.getImageData(0, 0, w, h);

  /* Tentative normale */
  if (typeof jsQR !== 'undefined') {
    code = jsQR(imageData.data, w, h, { inversionAttempts: 'dontInvert' });
    /* Si non trouvé, essai inversé */
    if (!code) code = jsQR(imageData.data, w, h, { inversionAttempts: 'onlyInvert' });
    /* Si toujours non trouvé, essai avec contraste amélioré */
    if (!code) {
      const enhanced = enhanceContrast(imageData, ctx);
      code = jsQR(enhanced.data, w, h, { inversionAttempts: 'attemptBoth' });
    }
  }

  if (code && code.data) {
    const statusEl = $('qr-scan-status');
    if (statusEl) statusEl.textContent = tr('qr.detected') + ' ✓';
    clearTimeout(state.scanTimeout);
    stopCamera();
    closeModal('camera-qr-modal');
    handleQRScanned(code.data);
  } else {
    requestAnimationFrame(scanLoop);
  }
}

function enhanceContrast(imageData, ctx) {
  const data = new Uint8ClampedArray(imageData.data);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i+1], b = data[i+2];
    const gray = 0.299*r + 0.587*g + 0.114*b;
    const v = gray > 128 ? 255 : 0;
    data[i] = data[i+1] = data[i+2] = v;
  }
  return new ImageData(data, imageData.width, imageData.height);
}

function stopCamera() {
  clearTimeout(state.scanTimeout);
  if (state.scanStream) {
    state.scanStream.getTracks().forEach(t => t.stop());
    state.scanStream = null;
  }
  const video = $('qr-camera-video');
  if (video) { video.srcObject = null; }
}

async function scanQRFromFile(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        if (typeof jsQR !== 'undefined') {
          const code = jsQR(imageData.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
          resolve(code ? code.data : null);
        } else { resolve(null); }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function handleQRScanned(data) {
  if (!data) return;
  try {
    const parsed = JSON.parse(data);
    /* QR d'invitation de ménage */
    if (parsed._menap_invite) {
      handleInviteQR(parsed);
      return;
    }
  } catch (e) {}
  showToast(tr('toast.qr_format_unknown'), 'warning');
}

function handleInviteQR(inviteData) {
  const profile = db.getProfile();
  const existing = db.getMemberByUserId(profile.user_id);
  if (existing) { showToast(tr('toast.already_member'), 'info'); return; }
  db.addMember({
    user_id:    profile.user_id,
    first_name: profile.first_name,
    last_name:  profile.last_name,
    email:      profile.email,
    photo:      profile.photo,
    role:       'member'
  });
  showToast(tr('toast.household_joined'), 'success');
  renderMembersList();
}

/* ─── QR d'invitation ─── */
function generateInviteQR(canvasId) {
  const canvas = $(canvasId);
  if (!canvas || typeof QRCode === 'undefined') return;
  const profile = db.getProfile();
  const payload = JSON.stringify({
    _menap_invite: true,
    inviter: `${profile.first_name} ${profile.last_name}`.trim()
  });
  const wrapper = canvas.parentElement;
  wrapper.innerHTML = '';
  new QRCode(wrapper, { text: payload, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
}

function downloadQR(containerId, filename) {
  const canvas = $(`${containerId}-container`)?.querySelector('canvas') || $(`${containerId}-container`)?.querySelector('img');
  if (!canvas) { showToast('QR non généré', 'warning'); return; }
  const url = canvas.tagName === 'CANVAS' ? canvas.toDataURL() : canvas.src;
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
}

/* ═══════════════════════════════════════════════
   PARTAGE
   ═══════════════════════════════════════════════ */
function shareApp() {
  const url = window.location.origin + window.location.pathname;
  if (navigator.share) {
    navigator.share({ title:'Menap - Budget Achataire', text:'Gérez votre budget achataire familial!', url }).catch(()=>{});
  } else {
    navigator.clipboard?.writeText(url)
      .then(() => showToast(tr('toast.link_copied'), 'success'))
      .catch(() => showToast('Partagez: '+url, 'info'));
  }
}

/* ═══════════════════════════════════════════════
   DÉCONNEXION
   ═══════════════════════════════════════════════ */
function handleLogout() {
  db.logout();
  showToast(tr('toast.logged_out'), 'success');
  setTimeout(() => location.reload(), 800);
}

/* ═══════════════════════════════════════════════
   CALCULATRICE
   ═══════════════════════════════════════════════ */
function initCalculator() {
  const display = $('calc-display');
  const preview = $('calc-preview');
  if (!display) return;

  function calcEval(expr) {
    try {
      const sanitized = expr.replace(/[^0-9+\-*/.()%]/g, '');
      if (!sanitized) return '';
      const result = Function('"use strict"; return (' + sanitized + ')')();
      return isFinite(result) ? Math.round(result * 100) / 100 : 'Err';
    } catch (e) { return 'Err'; }
  }

  function updateCalc(val) {
    display.value = val;
    if (val && val !== 'Err' && !/[+\-*/]$/.test(val)) {
      const res = calcEval(val);
      preview.textContent = res !== '' && res !== val ? '= ' + res : '';
    } else { preview.textContent = ''; }
  }

  document.querySelectorAll('.calc-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.val;
      const cur = display.value;
      if (!v) return;
      if (v === 'C') { updateCalc(''); return; }
      if (v === '←') { updateCalc(cur.slice(0,-1)); return; }
      if (v === '=') {
        const res = calcEval(cur);
        if (res !== 'Err' && res !== '') updateCalc(String(res));
        return;
      }
      if (v === '%') { const n = parseFloat(cur); if (!isNaN(n)) updateCalc(String(n/100)); return; }
      if (v === '±') { const n = parseFloat(cur); if (!isNaN(n)) updateCalc(String(-n)); return; }
      updateCalc(cur + v);
    });
  });

  $('calc-copy-btn')?.addEventListener('click', () => {
    const res = calcEval(display.value);
    if (res && res !== 'Err') {
      navigator.clipboard?.writeText(String(res)).then(() => showToast(tr('toast.calc_copied'), 'success'));
    }
  });

  $('calc-insert-btn')?.addEventListener('click', () => {
    const res = calcEval(display.value);
    if (res && res !== 'Err' && state.calcTarget) {
      state.calcTarget.value = String(res);
      $('calculator-modal').style.display = 'none';
    }
  });
}

/* Rend le modal calculatrice draggable */
function makeDraggable(modal, handle) {
  if (!modal || !handle) return;
  let dragging = false, ox = 0, oy = 0;
  handle.addEventListener('pointerdown', e => {
    dragging = true; handle.setPointerCapture(e.pointerId);
    const rect = modal.getBoundingClientRect();
    ox = e.clientX - rect.left; oy = e.clientY - rect.top;
    modal.style.position = 'fixed';
  });
  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    modal.style.left = `${e.clientX - ox}px`;
    modal.style.top  = `${e.clientY - oy}px`;
  });
  handle.addEventListener('pointerup', () => { dragging = false; });
}

/* ═══════════════════════════════════════════════
   BINDINGS ÉVÉNEMENTS PRINCIPAUX
   ═══════════════════════════════════════════════ */
function initEventListeners() {
  /* Garde anti-doublon : n'enregistre les listeners qu'une seule fois */
  if (state.eventsInitialized) return;
  state.eventsInitialized = true;

  /* ─ Drawer ─ */
  $('menu-btn')?.addEventListener('click', () => { $('drawer').classList.add('open'); $('drawer-overlay').classList.add('show'); });
  $('drawer-overlay')?.addEventListener('click', closeDrawer);
  function closeDrawer() { $('drawer').classList.remove('open'); $('drawer-overlay').classList.remove('show'); }

  const navItems = {
    'nav-dashboard': () => { closeDrawer(); showDashboard(); },
    'nav-budgets':   () => { closeDrawer(); showBudgetsView(); },
    'nav-members':   () => { closeDrawer(); openMembersModal(); },
    'nav-search':    () => { closeDrawer(); openModal('search-modal'); setTimeout(() => $('search-input')?.focus(), 200); },
    'nav-backup':    () => { closeDrawer(); openBackupModal(); },
    'nav-share':     () => { closeDrawer(); shareApp(); },
    'nav-settings':  () => { closeDrawer(); updateSettingsProfile(); openModal('settings-modal'); },
    'nav-info':      () => { closeDrawer(); openModal('contact-modal'); },
    'nav-logout':    () => { closeDrawer(); openModal('logout-modal'); }
  };
  Object.entries(navItems).forEach(([id, fn]) => { $(id)?.addEventListener('click', fn); });

  /* ─ Header ─ */
  $('search-btn')?.addEventListener('click', () => { openModal('search-modal'); setTimeout(() => $('search-input')?.focus(), 200); });
  $('header-calc-btn')?.addEventListener('click', () => {
    const c = $('calculator-modal');
    if (c.style.display === 'flex') c.style.display = 'none';
    else { c.style.display = 'flex'; }
  });

  /* ─ Date ─ */
  $('header-year-selector')?.addEventListener('click', () => { openSelectionModal(); switchSelectionTab('years'); });
  $('header-month-selector')?.addEventListener('click', () => { openSelectionModal(); switchSelectionTab('months'); });
  $('header-day-selector')?.addEventListener('click', () => { openSelectionModal(); switchSelectionTab('days'); });

  /* ─ Close buttons ─ */
  const closeMap = {
    'close-search':              'search-modal',
    'close-settings':            'settings-modal',
    'close-contact':             'contact-modal',
    'close-budget-modal':        'budget-modal',
    'close-item-modal':          'item-modal',
    'close-refill-modal':        'refill-modal',
    'close-purchases-list-modal':'purchases-list-modal',
    'close-logout-modal':        'logout-modal',
    'close-backup-modal':        'backup-modal',
    'close-members-modal':       'members-modal',
    'close-camera-qr':           'camera-qr-modal',
    'close-menap-import-modal':  'menap-import-modal',
    'close-modal':               'selection-modal'
  };
  Object.entries(closeMap).forEach(([btnId, modalId]) => {
    $(btnId)?.addEventListener('click', () => {
      if (modalId === 'camera-qr-modal') stopCamera();
      closeModal(modalId);
    });
  });

  $('close-calculator-modal')?.addEventListener('click', () => { $('calculator-modal').style.display = 'none'; });
  $('stop-camera-btn')?.addEventListener('click', () => { stopCamera(); closeModal('camera-qr-modal'); });

  /* ─ Recherche ─ */
  $('search-input')?.addEventListener('input', e => performSearch(e.target.value));

  /* ─ Paramètres ─ */
  $('theme-select')?.addEventListener('change', e => { applyTheme(e.target.value); db.setSetting('theme', e.target.value); });
  $('lang-select')?.addEventListener('change', e => { db.setSetting('lang', e.target.value); state.lang?.setLanguage(e.target.value).then(() => updateHeaderDate()); });
  $('currency-select')?.addEventListener('change', e => { state.currency = e.target.value; db.setSetting('currency', e.target.value); renderDashboard(); });
  $('sound-toggle')?.addEventListener('change', e => db.setSetting('sound', e.target.checked ? '1' : '0'));

  /* ─ Membres ─ */
  $('generate-invite-qr-btn')?.addEventListener('click', () => { $('invite-qr-container').classList.remove('hidden'); generateInviteQR('invite-qrcode'); });
  $('scan-join-btn')?.addEventListener('click', startQRScanner);
  $('transfer-privilege-btn')?.addEventListener('click', () => {
    const targetId = $('transfer-target-select')?.value;
    if (!targetId) { showToast(tr('errors.choose_member'), 'error'); return; }
    const profile = db.getProfile();
    const myMember = db.getMemberByUserId(profile.user_id);
    db.createTransferRequest(myMember?.id || null, parseInt(targetId));
    showToast(tr('toast.transfer_sent'), 'success');
  });

  /* ─ Budget ─ */
  $('save-budget-btn')?.addEventListener('click', saveBudget);

  /* ─ Item ─ */
  $('item-name')?.addEventListener('input', e => {
    renderItemSuggestions(e.target.value);
    if (e.target.value.length > 2) checkItemAdvisor(e.target.value);
  });
  $('save-item-btn')?.addEventListener('click', saveItem);

  /* ─ Achat ─ */
  $('save-refill-btn')?.addEventListener('click', saveRefill);

  /* ─ Calculatrice focus ─ */
  ['refill-amount','item-budgeted'].forEach(inputId => {
    $(inputId)?.addEventListener('focus', e => { state.calcTarget = e.target; });
  });

  /* ─ Export / Import .menap ─ */
  $('export-menap-btn')?.addEventListener('click', exportMenap);
  $('import-menap-btn')?.addEventListener('click', triggerMenapImport);
  $('menap-import-file-input')?.addEventListener('change', e => handleMenapImportFile(e.target.files[0]));
  $('confirm-menap-import-btn')?.addEventListener('click', confirmMenapImport);
  $('export-all-select')?.addEventListener('click', () => selectAllExport(true));
  $('export-none-select')?.addEventListener('click', () => selectAllExport(false));
  $('import-all-select')?.addEventListener('click', () => selectAllImport(true));
  $('import-none-select')?.addEventListener('click', () => selectAllImport(false));

  /* ─ Export / Import DB complète ─ */
  $('export-db-btn')?.addEventListener('click', exportFullDB);
  $('import-db-btn')?.addEventListener('click', triggerFullDBImport);
  $('full-db-import-input')?.addEventListener('change', e => handleFullDBImport(e.target.files[0]));

  /* ─ Logout ─ */
  $('logout-export-btn')?.addEventListener('click', () => {
    const budgets = db.getBudgets();
    if (budgets.length > 0) {
      const ids = budgets.map(b => b.id);
      const content = db.exportToMenap(ids);
      const blob = new Blob([content], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `menap_sauvegarde_${today()}.menap`; a.click();
      URL.revokeObjectURL(url);
    }
  });
  $('logout-confirm-btn')?.addEventListener('click', () => { closeModal('logout-modal'); handleLogout(); });
  $('logout-cancel-btn')?.addEventListener('click', () => closeModal('logout-modal'));

  /* ─ Partage ─ */
  $('share-app-btn')?.addEventListener('click', shareApp);

  /* ─ Photo profil ─ */
  $('settings-change-photo')?.addEventListener('click', () => $('settings-photo-input')?.click());
  $('settings-photo-input')?.addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const profile = db.getProfile();
      db.saveProfile({ first_name: profile.first_name, last_name: profile.last_name, photo: ev.target.result });
      updateSettingsProfile();
    };
    reader.readAsDataURL(file);
  });

  /* ─ Calculatrice ─ */
  initCalculator();
  makeDraggable($('calculator-modal'), $('calculator-modal')?.querySelector('.modal-header'));

  /* ─ Visibilité onglets sélection date ─ */
  document.querySelectorAll('#selection-modal .tab').forEach(tab => {
    tab.addEventListener('click', () => switchSelectionTab(tab.dataset.tab));
  });
}
