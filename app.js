/**
 * Menap App V2.0
 */

// ─── État global ───
const state = {
  currentView: 'dashboard',
  currentDate: new Date(),
  currentBudgetId: null,
  currentItemId: null,
  editBudgetId: null,
  cameraStream: null,
  cameraScanMode: null,
  cameraScanInterval: null,
  lang: null,
  currency: 'BIF',
  theme: 'light',
  calcTarget: null
};

// ─── Devises ───
const CURRENCY_SYMBOLS = { BIF: 'FBu', RWF: 'FRw', EUR: '€', USD: '$' };
const MONTHS_FR = ['Janv','Févr','Mars','Avr','Mai','Juin','Juil','Août','Sept','Oct','Nov','Déc'];

// ─── Utilitaires ───
const $ = id => document.getElementById(id);
const fmt = n => {
  const sym = CURRENCY_SYMBOLS[state.currency] || state.currency;
  return `${(parseFloat(n)||0).toLocaleString('fr-FR',{maximumFractionDigits:0})} ${sym}`;
};
const today = () => new Date().toISOString().split('T')[0];
const pad = n => String(n).padStart(2,'0');
const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const escHtml = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const escAttr = s => String(s||'').replace(/'/g,"\\'");

function calcEndDate(start, type, val) {
  const d = new Date(start); const v = parseInt(val)||1;
  if (type==='day') d.setDate(d.getDate()+v);
  else if (type==='week') d.setDate(d.getDate()+v*7);
  else if (type==='month') d.setMonth(d.getMonth()+v);
  else if (type==='year') d.setFullYear(d.getFullYear()+v);
  d.setDate(d.getDate()-1);
  return d.toISOString().split('T')[0];
}

// ─── Toast ───
function showToast(msg, type='info') {
  const el = document.createElement('div');
  el.textContent = msg;
  const bg = type==='error'?'#f43f5e':type==='success'?'#10b981':'#0d9488';
  el.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:${bg};color:white;padding:10px 20px;border-radius:20px;font-weight:700;font-size:14px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.3);white-space:nowrap;animation:toastIn .2s ease-out;pointer-events:none;max-width:90vw;text-align:center`;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 3000);
  playSound(type);
}

function showLoading(show, text='Chargement...') {
  const el = $('loading'); el.style.display = show ? 'flex' : 'none';
  const t = $('loading-text'); if (t) t.textContent = text;
}

// ─── Effets Sonores et Notifications ───
function playSound(type) {
  if (db.getSetting('sound', '1') !== '1') return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (!ctx) return;
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    const now = ctx.currentTime;
    
    if (type === 'success') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(659.25, now + 0.1); // E5
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } else if (type === 'error') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, now);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.start(now);
      osc.stop(now + 0.4);
    } else if (type === 'delete') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.exponentialRampToValueAtTime(100, now + 0.2);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (type === 'notification') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880, now + 0.12); // A5
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    }
  } catch (e) {
    console.warn('Web Audio error:', e);
  }
}

function sendLocalNotification(title, body) {
  if (db.getSetting('notifications', '0') === '1' && Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body: body,
        icon: 'favicon.png'
      });
      playSound('notification');
    } catch (e) {
      console.warn('Local notification error:', e);
    }
  }
}

// ─── Polling adhésion et Compléter Profil ───
let joinPollTimer = null;
function startJoinPoll(joinUserId) {
  if (joinPollTimer) clearInterval(joinPollTimer);
  joinPollTimer = setInterval(async () => {
    if (!navigator.onLine) return;
    try {
      const resp = await fetch('api.php', { cache: 'no-store' });
      if (resp.ok && resp.status !== 204) {
        const buf = await resp.arrayBuffer();
        if (buf.byteLength > 100) {
          db.db = new db.SQL.Database(new Uint8Array(buf));
          const member = db.getMemberByUserId(joinUserId);
          if (member) {
            clearInterval(joinPollTimer);
            joinPollTimer = null;
            closeModal('join-request-modal');
            showToast('Demande acceptée par le gérant !', 'success');
            
            localStorage.setItem('menap_current_user_id', joinUserId);
            localStorage.removeItem('menap_pending_join_uid');
            
            openCompleteProfileModal(joinUserId);
          }
        }
      }
    } catch (e) {
      console.warn('Error polling join request status:', e);
    }
  }, 4000);
}

function stopJoinPoll() {
  if (joinPollTimer) {
    clearInterval(joinPollTimer);
    joinPollTimer = null;
  }
}

function openCompleteProfileModal(userId) {
  $('complete-first-name').value = '';
  $('complete-last-name').value = '';
  $('complete-email').value = '';
  $('complete-password').value = '';
  const preview = $('complete-pic-preview');
  if (preview) {
    preview.dataset.photo = '';
    preview.innerHTML = `<i class="fas fa-user" style="font-size:20px;color:var(--text-muted)"></i>`;
  }
  openModal('complete-profile-modal');
}

function saveCompleteProfile() {
  const userId = localStorage.getItem('menap_current_user_id');
  if (!userId) {
    showToast('Session non valide. Recommencez la demande.', 'error');
    closeModal('complete-profile-modal');
    showOnboarding();
    return;
  }
  const fn = $('complete-first-name').value.trim();
  const ln = $('complete-last-name').value.trim();
  const em = $('complete-email').value.trim();
  const pw = $('complete-password').value;
  const photo = $('complete-pic-preview')?.dataset.photo || '';
  
  if (!fn) { showToast('Prénom requis', 'error'); return; }
  if (!em) { showToast('Email requis', 'error'); return; }
  if (!pw || pw.length < 4) { showToast('Mot de passe trop court (min. 4 caractères)', 'error'); return; }
  
  db.saveProfile({
    user_id: userId,
    first_name: fn,
    last_name: ln,
    email: em,
    password: pw,
    photo: photo
  });
  
  db.setSetting('initialized', '1');
  db.setSetting('theme', 'light');
  loadSettings();
  hideOnboarding();
  updateSettingsProfile();
  updateHeaderDate();
  renderDashboard();
  
  closeModal('complete-profile-modal');
  showToast(`Compte complété ! Bienvenue ${fn} !`, 'success');
  db.startPolling(15000);
}

// ─── Toggle password ───
function togglePw(inputId, btn) {
  const input = $(inputId);
  input.type = input.type==='password' ? 'text' : 'password';
  btn.querySelector('i').className = input.type==='password' ? 'fas fa-eye' : 'fas fa-eye-slash';
}

// ─── QR Code ───
function generateQR(containerId, text, size=220) {
  const container = $(containerId);
  if (!container) return;
  container.innerHTML = '';
  if (!text || !window.QRCode) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px">QRCode.js non chargé</div>';
    return;
  }
  try {
    new QRCode(container, {
      text, width: size, height: size,
      colorDark: '#1f2937', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.L
    });
    setTimeout(() => {
      const img = container.querySelector('img');
      const canvas = container.querySelector('canvas');
      const s = `display:block!important;width:${size}px!important;height:${size}px!important;max-width:100%`;
      if (img) img.style.cssText = s;
      if (canvas) canvas.style.cssText = s;
    }, 80);
  } catch(e) {
    container.innerHTML = `<div style="color:red;font-size:12px;padding:10px">Erreur QR: ${e.message}</div>`;
  }
}

function getQRDataUrl(containerId) {
  const c = $(containerId);
  if (!c) return null;
  const canvas = c.querySelector('canvas');
  const img = c.querySelector('img');
  if (canvas) return canvas.toDataURL('image/png');
  if (img) return img.src;
  return null;
}

function downloadQR(containerId, filename='menap-qr.png') {
  const url = getQRDataUrl(containerId);
  if (!url) { showToast('QR non disponible','error'); return; }
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
}

function generateAuthQR(containerId) {
  const p = db.getProfile();
  // Payload léger (errorCorrectionLevel L = faible densité)
  const data = JSON.stringify({ _m:3, fn:p.first_name, ln:p.last_name, em:p.email, pw:p.password, la: db.getSetting('lang','fr'), cu: db.getSetting('currency','BIF'), th: db.getSetting('theme','light') });
  generateQR(containerId, data, 220);
}

function generateInviteQR(containerId) {
  const p = db.getProfile();
  const data = JSON.stringify({
    _t: 'invite',
    uid: p.user_id,   // uid du gestionnaire invitant
    mid: p.user_id,
    mn: `${p.first_name} ${p.last_name}`.trim(),
    me: p.email,
    at: Date.now()
  });
  generateQR(containerId, data, 220);
}

// ─── Caméra QR Scanner ───
function startCameraQRScan(mode) {
  state.cameraScanMode = mode;
  openModal('camera-qr-modal');
  const st = $('camera-qr-status');
  if (st) st.textContent = '';
  startCamera();
}

async function startCamera() {
  const st = $('camera-qr-status');
  // Essayer caméra arrière, puis avant, puis sans contrainte
  const constraints = [
    { video: { facingMode: { ideal: 'environment' }, width:{ideal:640}, height:{ideal:480} } },
    { video: { facingMode: 'user', width:{ideal:640}, height:{ideal:480} } },
    { video: true }
  ];
  let stream = null;
  let lastErr = '';
  for (const c of constraints) {
    try {
      stream = await navigator.mediaDevices.getUserMedia(c);
      break;
    } catch(e) {
      lastErr = e.name + ': ' + e.message;
    }
  }
  if (!stream) {
    if (st) {
      st.textContent = 'Caméra non accessible — ' + lastErr;
      st.style.color = 'var(--danger-color)';
    }
    return;
  }
  try {
    const video = $('qr-camera-video');
    state.cameraStream = stream;
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.setAttribute('autoplay', '');
    video.setAttribute('muted', '');
    await video.play();
    if (st) { st.textContent = 'Pointez la caméra vers un QR code…'; st.style.color = ''; }
    startQRScanLoop();
  } catch(err) {
    if (st) { st.textContent = 'Erreur vidéo: ' + err.message; st.style.color = 'var(--danger-color)'; }
  }
}

function startQRScanLoop() {
  const video  = $('qr-camera-video');
  const canvas = $('qr-camera-canvas');
  const ctx    = canvas.getContext('2d');
  let lastData = null;
  let debounce = 0;

  state.cameraScanInterval = setInterval(() => {
    // Attendre que la vidéo soit prête ET ait des dimensions valides
    if (video.readyState < video.HAVE_CURRENT_DATA) return;
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return;

    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);

    const imageData = ctx.getImageData(0, 0, w, h);
    if (!window.jsQR) return;

    // attemptBoth = détecte codes clairs ET sombres (meilleure compatibilité)
    const code = jsQR(imageData.data, w, h, { inversionAttempts: 'attemptBoth' });
    if (!code) return;

    // Anti-rebond : ignorer le même code pendant 1,5 s
    const now = Date.now();
    if (code.data === lastData && now - debounce < 1500) return;
    lastData = code.data;
    debounce = now;

    const st = $('camera-qr-status');
    if (st) { st.textContent = '✓ QR détecté !'; st.style.color = 'var(--primary-color)'; }

    stopCamera();
    handleQRScanned(code.data);
  }, 150); // 150 ms = ~6 fps — suffisant et économique
}

function stopCamera() {
  if (state.cameraScanInterval) { clearInterval(state.cameraScanInterval); state.cameraScanInterval = null; }
  if (state.cameraStream) { state.cameraStream.getTracks().forEach(t=>t.stop()); state.cameraStream = null; }
  const v = $('qr-camera-video');
  if (v) v.srcObject = null;
}

async function scanQRFromFile(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width; canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
        const imageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        if (window.jsQR) { const code = jsQR(imageData.data, imageData.width, imageData.height); resolve(code ? code.data : null); }
        else resolve(null);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function handleQRScanned(data) {
  closeModal('camera-qr-modal');
  const wasOnboard = state.cameraScanMode === 'onboard';
  const scanMode = state.cameraScanMode;
  state.cameraScanMode = null;

  try {
    const obj = JSON.parse(data);

    // QR Join Request (scanné par le gérant pour ajouter un membre)
    if (obj._t === 'join_request' && obj.uid) {
      if (!isCurrentUserManager()) {
        showToast('Seul le gérant peut ajouter un nouveau membre au ménage.', 'error');
        return;
      }
      const exists = db.getMemberByUserId(obj.uid);
      if (exists) {
        showToast('Ce membre fait déjà partie du ménage ou sa demande est en cours.', 'info');
        return;
      }
      db.addMember({
        user_id: obj.uid,
        first_name: 'Nouveau',
        last_name: 'Membre',
        role: 'member'
      });
      showToast('Nouveau membre ajouté au ménage ! En attente de ses informations.', 'success');
      renderMembersList();
      return;
    }

    // QR Auth (re-connexion avec profil complet)
    if (obj._m === 3 && obj.em) {
      loginFromQR(obj);
      return;
    }

    // QR Invitation ménage
    if (obj._t === 'invite' && (obj.mid || obj.uid)) {
      // Si on vient de l'onboarding, d'abord vérifier qu'on a un profil local
      if (wasOnboard) {
        const p = db.getProfile();
        if (!p || !p.first_name) {
          showToast('Créez d\'abord votre profil avant de rejoindre un ménage.', 'error');
          showOnboarding();
          return;
        }
      }
      handleJoinHousehold(obj);
      // Si on venait de l'onboarding, aller au dashboard après avoir rejoint
      if (wasOnboard) {
        db.setSetting('initialized','1');
        hideOnboarding();
        updateSettingsProfile();
        updateHeaderDate();
        renderDashboard();
      }
      return;
    }

    // Ancien format .dem intégré dans QR
    if (obj.type === 'menap_auth' && obj.dem) {
      const res = db.importFromDem(obj.dem);
      if (res && res.ok) {
        showToast('Données restaurées depuis le QR !','success');
        hideOnboarding();
        updateSettingsProfile();
        updateHeaderDate();
        renderDashboard();
      } else {
        showToast('QR invalide','error');
      }
      return;
    }

    showToast('Format QR non reconnu','error');

  } catch(e) {
    // Tenter comme contenu .menap direct
    if (data.length > 50) {
      const res = db.importFromDem(data);
      if (res && res.ok) {
        showToast('Données restaurées !','success');
        hideOnboarding();
        updateSettingsProfile();
        updateHeaderDate();
        renderDashboard();
      } else {
        showToast('Format QR non reconnu','error');
      }
    } else {
      showToast('QR non reconnu','error');
    }
  }
}

function loginFromQR(obj) {
  // Enregistrer le profil depuis le QR dans menap.db (push vers serveur via _save)
  db.saveProfile({ user_id: obj.uid || (obj.em+'_'+Date.now()), first_name: obj.fn||'', last_name: obj.ln||'', email: obj.em, password: obj.pw||'' });
  if (obj.la) db.setSetting('lang', obj.la);
  if (obj.cu) db.setSetting('currency', obj.cu);
  if (obj.th) db.setSetting('theme', obj.th);
  db.setSetting('initialized', '1');
  showToast(`Bienvenue ${obj.fn||''}!`, 'success');
  // Aller au dashboard sans rechargement (données déjà en mémoire)
  hideOnboarding();
  updateSettingsProfile();
  updateHeaderDate();
  renderDashboard();
  loadSettings();
}

function handleJoinHousehold(inviteData) {
  const profile = db.getProfile();

  // Règle : un gestionnaire ne peut pas rejoindre un autre ménage
  if (isCurrentUserManager()) {
    showToast('Un gestionnaire ne peut pas rejoindre un autre ménage. Transférez vos droits d\'abord.', 'error');
    return;
  }

  // Règle : le ménage ne peut avoir qu'un seul gestionnaire
  const existingManagers = db.getMembers().filter(m => m.role === 'manager');
  if (existingManagers.length >= 1) {
    // Vérifier que le gestionnaire invitant correspond bien à celui déjà enregistré
    const alreadyKnown = existingManagers.find(m => m.user_id === inviteData.uid || m.user_id === inviteData.mid);
    if (!alreadyKnown) {
      showToast('Ce ménage a déjà un gestionnaire. Deux gestionnaires ne peuvent pas cohabiter.', 'error');
      return;
    }
  }

  // Ajouter le gestionnaire invitant s'il n'est pas encore enregistré
  const existMgr = db.getMemberByUserId(inviteData.uid || inviteData.mid);
  if (!existMgr) {
    db.addMember({
      user_id: inviteData.uid || inviteData.mid,
      first_name: (inviteData.mn||'Gestionnaire').split(' ')[0],
      last_name: (inviteData.mn||'').split(' ').slice(1).join(' '),
      email: inviteData.me||'',
      role: 'manager'
    });
  }

  // S'ajouter comme membre
  if (profile.user_id && !db.getMemberByUserId(profile.user_id)) {
    db.addMember({
      user_id: profile.user_id,
      first_name: profile.first_name,
      last_name: profile.last_name,
      email: profile.email,
      photo: profile.photo,
      role: 'member'
    });
    showToast(`Vous avez rejoint le ménage de ${inviteData.mn||'ce gestionnaire'}!`, 'success');
  } else {
    showToast('Vous êtes déjà dans ce ménage','info');
  }
  openMembersModal();
}

// ─── Modals ───
const modalStack = [];

function openModal(id) {
  const el = $(id);
  if (!el) return;
  el.style.display = 'flex';
  el.classList.add('show');
  if (!modalStack.includes(id)) modalStack.push(id);
  history.pushState(null, '', location.pathname);
}

function closeModal(id) {
  const el = $(id);
  if (!el) return;
  el.style.display = 'none';
  el.classList.remove('show');
  const idx = modalStack.lastIndexOf(id);
  if (idx >= 0) modalStack.splice(idx, 1);
  if (id === 'camera-qr-modal') stopCamera();
}

function closeTopModal() {
  if (!modalStack.length) return false;
  closeModal(modalStack[modalStack.length-1]);
  return true;
}

window.addEventListener('popstate', e => {
  e.preventDefault();
  if (closeTopModal()) { history.pushState(null,'',location.pathname); return; }
  if (state.currentView==='budget-detail') { history.pushState(null,'',location.pathname); showBudgetsView(); return; }
  if (state.currentView==='budgets') { history.pushState(null,'',location.pathname); showDashboard(); return; }
});
history.pushState(null,'',location.pathname);

// ─── Thème ───
function applyTheme(theme) {
  state.theme = theme;
  document.body.className = theme==='dark' ? 'dark-theme' : 'light-theme';
  const sel = $('theme-select'); if (sel) sel.value = theme;
}

// ─── Vues ───
function showDashboard() {
  state.currentView = 'dashboard';
  state.currentBudgetId = null;
  renderDashboard();
  history.pushState(null,'',location.pathname);
}

function showBudgetsView() {
  state.currentView = 'budgets';
  state.currentBudgetId = null;
  renderBudgets();
  history.pushState(null,'',location.pathname);
}

function showBudgetDetail(budgetId) {
  state.currentView = 'budget-detail';
  state.currentBudgetId = budgetId;
  renderBudgetDetail(budgetId);
  history.pushState(null,'',location.pathname);
}

function goBack() {
  if (!closeTopModal()) {
    if (state.currentView==='budget-detail') showBudgetsView();
    else if (state.currentView==='budgets') showDashboard();
  }
}

// ─── Header date ───
function updateHeaderDate() {
  const d = state.currentDate;
  const yEl = $('current-year'), mEl = $('current-month'), dEl = $('current-day');
  if (yEl) yEl.textContent = d.getFullYear();
  if (mEl) mEl.textContent = pad(d.getMonth()+1);
  if (dEl) dEl.textContent = pad(d.getDate());
}

// ─── Dashboard ───
function renderDashboard() {
  const content = $('main-content');
  const d = state.currentDate, ds = dateStr(d);
  const budgets = db.getBudgetsByDate(ds);
  const memberCount = db.getMemberCount();

  let personalSpent = 0;
  if (memberCount > 0) {
    db.getBudgets().forEach(b => { personalSpent += db.getTotalSpentByBudget(b.id) / memberCount; });
  }

  let html = `<div class="dashboard-view">
    <div class="viewing-date-banner">
      <span><i class="fas fa-calendar-alt" style="margin-right:8px"></i>${MONTHS_FR[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}</span>
      <span style="font-size:12px;opacity:.8">${budgets.length} budget(s) actif(s)</span>
    </div>`;

  if (memberCount > 0) {
    html += `<div class="personal-spent-card">
      <div class="icon"><i class="fas fa-user-circle"></i></div>
      <div class="info">
        <div class="label">Ma contribution totale</div>
        <div class="amount">${fmt(personalSpent)}</div>
      </div>
    </div>`;
  }

  if (budgets.length === 0) {
    html += `<div class="empty-state">
      <div class="empty-state-icon"><i class="fas fa-folder-open"></i></div>
      <div style="font-weight:700">Aucun budget actif pour cette date</div>
      <div style="font-size:13px">Appuyez sur + pour créer un budget</div>
    </div>`;
  } else {
    let totalBudgeted=0, totalSpent=0, exhaustedCount=0;
    budgets.forEach(b => {
      db.getItemsByBudget(b.id).forEach(i => { totalBudgeted += i.budgeted_amount; if(i.is_finished) exhaustedCount++; });
      totalSpent += db.getTotalSpentByBudget(b.id);
    });
    const spentPct = totalBudgeted > 0 ? Math.min(100,(totalSpent/totalBudgeted)*100) : 0;
    const remaining = totalBudgeted - totalSpent;

    html += `<div class="summary-cards">
      <div class="metric-card success-card">
        <div class="metric-header"><span>Dépensé</span><i class="fas fa-wallet"></i></div>
        <div class="metric-value">${fmt(totalSpent)}</div>
        <div class="metric-label">sur ${fmt(totalBudgeted)}</div>
      </div>
      <div class="metric-card ${remaining<0?'alert-card':''}">
        <div class="metric-header"><span>Restant</span><i class="fas fa-piggy-bank"></i></div>
        <div class="metric-value">${fmt(remaining)}</div>
        <div class="metric-label">${spentPct.toFixed(0)}% utilisé</div>
      </div>
    </div>`;

    if (exhaustedCount > 0) {
      html += `<div class="warning-banner">
        <i class="fas fa-exclamation-triangle"></i>
        <div><div class="warning-banner-title">${exhaustedCount} achat(s) épuisé(s) tôt!</div><div>Vérifiez vos budgets</div></div>
      </div>`;
    }

    html += `<div class="progress-container">
      <div class="progress-label-row"><span>Progression des dépenses</span><span>${spentPct.toFixed(0)}%</span></div>
      <div class="progress-track"><div class="progress-fill ${spentPct>90?'danger':'primary'}" style="width:${spentPct}%"></div></div>
    </div>`;

    html += `<div class="section-title"><span>Budgets Actifs</span><span style="font-size:13px;color:var(--text-muted)">${budgets.length}</span></div>`;
    budgets.forEach(b => { html += renderBudgetCard(b); });
  }

  html += `</div><button class="fab" onclick="openCreateBudgetModal()"><i class="fas fa-plus"></i></button>`;
  content.innerHTML = html;
}

function renderBudgetCard(b) {
  const start=new Date(b.start_date), end=new Date(b.end_date), now=new Date();
  const totalDays = Math.max(1, Math.ceil((end-start)/86400000)+1);
  const elapsed = Math.max(0, Math.ceil((now-start)/86400000));
  const daysLeft = Math.max(0, Math.ceil((end-now)/86400000));
  const timePct = Math.min(100,(elapsed/totalDays)*100);
  const items = db.getItemsByBudget(b.id);
  const totalBudgeted = items.reduce((s,i)=>s+i.budgeted_amount, 0);
  const totalSpent = db.getTotalSpentByBudget(b.id);
  const spentPct = totalBudgeted > 0 ? Math.min(100,(totalSpent/totalBudgeted)*100) : 0;
  const exhausted = items.filter(i=>i.is_finished).length;
  const memberCount = db.getMemberCount();
  const perMember = memberCount > 1 ? totalSpent/memberCount : null;
  const fmtDate = d => `${d.getDate()} ${MONTHS_FR[d.getMonth()]}`;

  return `<div class="budget-card" onclick="showBudgetDetail(${b.id})">
    <div class="budget-card-header">
      <div>
        <div class="budget-card-title">${escHtml(b.name)}</div>
        <div class="budget-card-dates">${fmtDate(start)} → ${fmtDate(end)}</div>
      </div>
      <span class="badge ${daysLeft===0?'danger':daysLeft<7?'warning':'active'}">${daysLeft===0?'Terminé':daysLeft+'j rest.'}</span>
    </div>
    <div class="progress-container">
      <div class="progress-label-row"><span>Temps</span><span>${timePct.toFixed(0)}%</span></div>
      <div class="progress-track"><div class="progress-fill primary" style="width:${timePct}%"></div></div>
    </div>
    <div class="progress-container">
      <div class="progress-label-row"><span>Dépenses</span><span>${fmt(totalSpent)} / ${fmt(totalBudgeted)}</span></div>
      <div class="progress-track"><div class="progress-fill ${spentPct>90?'danger':'success'}" style="width:${spentPct}%"></div></div>
    </div>
    ${exhausted>0?`<div style="font-size:12px;color:var(--danger-color);font-weight:700;margin-top:6px"><i class="fas fa-exclamation-circle"></i> ${exhausted} achat(s) épuisé(s)</div>`:''}
    ${perMember!==null?`<div style="font-size:12px;color:var(--text-muted);margin-top:6px"><i class="fas fa-user"></i> Part/membre: <b>${fmt(perMember)}</b></div>`:''}
  </div>`;
}

// ─── Budgets List ───
function renderBudgets() {
  const content = $('main-content');
  const budgets = db.getBudgets();
  let html = `<div class="budget-detail-view">
    <div class="section-title"><span>Tous les Budgets</span><span style="font-size:13px;color:var(--text-muted)">${budgets.length}</span></div>`;
  if (budgets.length === 0) {
    html += `<div class="empty-state"><div class="empty-state-icon"><i class="fas fa-folder-open"></i></div><div style="font-weight:700">Aucun budget créé</div><div style="font-size:13px">Appuyez + pour commencer</div></div>`;
  } else {
    budgets.forEach(b => { html += renderBudgetCard(b); });
  }
  html += `</div><button class="fab" onclick="openCreateBudgetModal()"><i class="fas fa-plus"></i></button>`;
  content.innerHTML = html;
}

// ─── Budget Detail ───
function renderBudgetDetail(budgetId) {
  const content = $('main-content');
  const b = db.getBudget(budgetId);
  if (!b) { showDashboard(); return; }
  const start=new Date(b.start_date), end=new Date(b.end_date), now=new Date();
  const totalDays = Math.max(1, Math.ceil((end-start)/86400000)+1);
  const elapsed = Math.max(0, Math.ceil((now-start)/86400000));
  const timePct = Math.min(100,(elapsed/totalDays)*100);
  const daysLeft = Math.max(0, Math.ceil((end-now)/86400000));
  const items = db.getItemsByBudget(budgetId);
  const totalBudgeted = items.reduce((s,i)=>s+i.budgeted_amount, 0);
  const totalSpent = db.getTotalSpentByBudget(budgetId);
  const spentPct = totalBudgeted > 0 ? Math.min(100,(totalSpent/totalBudgeted)*100) : 0;
  const exhaustedItems = items.filter(i=>i.is_finished);
  const memberCount = db.getMemberCount() || 1;
  const perMember = totalSpent / memberCount;
  const DUR = { day:'Jour(s)', week:'Semaine(s)', month:'Mois', year:'Année(s)' };

  let html = `<div class="budget-detail-view">
    <div class="back-btn-container">
      <button class="back-btn" onclick="goBack()"><i class="fas fa-arrow-left"></i> Retour</button>
    </div>
    <div class="budget-detail-header-card">
      <div class="budget-detail-title-row">
        <span class="budget-detail-title">${escHtml(b.name)}</span>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="budget-duration-badge">${b.duration_value} ${DUR[b.duration_type]||b.duration_type}</span>
          <button class="item-action-btn" onclick="openEditBudgetModal(${b.id})" title="Modifier"><i class="fas fa-pencil-alt"></i></button>
          <button class="item-action-btn delete-btn" onclick="confirmDeleteBudget(${b.id})" title="Supprimer"><i class="fas fa-trash-alt"></i></button>
        </div>
      </div>
      <div class="progress-container">
        <div class="progress-label-row"><span>Temps</span><span>${timePct.toFixed(0)}% · ${daysLeft===0?'Terminé':daysLeft+' j restants'}</span></div>
        <div class="progress-track"><div class="progress-fill primary" style="width:${timePct}%"></div></div>
      </div>
      <div class="progress-container">
        <div class="progress-label-row"><span>Dépenses</span><span>${spentPct.toFixed(0)}%</span></div>
        <div class="progress-track"><div class="progress-fill ${spentPct>90?'danger':'success'}" style="width:${spentPct}%"></div></div>
      </div>
      <div class="budget-stats-grid">
        <div class="budget-stat-item"><span class="budget-stat-label">Budgétisé</span><span class="budget-stat-val">${fmt(totalBudgeted)}</span></div>
        <div class="budget-stat-item"><span class="budget-stat-label">Dépensé</span><span class="budget-stat-val" style="color:var(--primary-color)">${fmt(totalSpent)}</span></div>
        <div class="budget-stat-item"><span class="budget-stat-label">${totalSpent>totalBudgeted?'Dépassé':'Restant'}</span><span class="budget-stat-val" style="color:${totalSpent>totalBudgeted?'var(--danger-color)':'var(--success-color)'}">${fmt(Math.abs(totalBudgeted-totalSpent))}</span></div>
      </div>
    </div>`;

  if (exhaustedItems.length > 0) {
    html += `<div class="warning-banner"><i class="fas fa-exclamation-triangle"></i><div>
      <div class="warning-banner-title">${exhaustedItems.length} achat(s) épuisé(s) tôt!</div>
      <div style="font-size:12px">${exhaustedItems.map(i=>escHtml(i.name)).join(', ')}</div>
    </div></div>`;
  }

  // Contributions membres
  html += renderMembersContributions(budgetId, totalSpent, memberCount, perMember);

  // Achats
  html += `<div class="section-title">
    <span>Achats (${items.length})</span>
    <button class="backup-btn" style="width:auto;padding:6px 14px;font-size:13px;border-radius:20px" onclick="openCreateItemModal(${b.id})">
      <i class="fas fa-plus"></i> Ajouter
    </button>
  </div>`;

  if (items.length === 0) {
    html += `<div class="empty-state"><div class="empty-state-icon"><i class="fas fa-empty-alt"></i></div><div style="font-weight:700">Aucun achat ajouté</div></div>`;
  } else {
    html += `<div class="food-items-container">`;
    items.forEach(item => { html += renderItemCard(item, budgetId); });
    html += `</div>`;
  }

  // Récapitulatif
  html += `<div class="budget-members-section" style="margin-top:20px">
    <h3><i class="fas fa-calculator"></i> Récapitulatif Budget</h3>
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-color)">
      <span style="font-weight:600">Total Budgétisé</span><span>${fmt(totalBudgeted)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-color)">
      <span style="font-weight:600">Total Dépensé</span><span style="color:var(--primary-color);font-weight:700">${fmt(totalSpent)}</span>
    </div>
    ${memberCount>1?`<div style="display:flex;justify-content:space-between;padding:8px 0;font-size:14px">
      <span style="font-weight:600">Part / membre (${memberCount})</span>
      <span style="color:var(--accent-color);font-weight:700">${fmt(perMember)}</span>
    </div>`:''}
  </div></div>`;

  html += `<button class="fab" onclick="openCreateItemModal(${b.id})"><i class="fas fa-plus"></i></button>`;
  content.innerHTML = html;
}

function renderMembersContributions(budgetId, totalSpent, memberCount, perMember) {
  db.initPaymentStatusesForBudget(budgetId);
  const statuses = db.getPaymentStatuses(budgetId);
  const isMgr = isCurrentUserManager();
  if (statuses.length === 0) return '';

  let html = `<div class="budget-members-section">
    <h3><i class="fas fa-users"></i> Contributions des Membres</h3>`;
  statuses.forEach(s => {
    const name = `${escHtml(s.first_name||'')} ${escHtml(s.last_name||'')}`.trim() || 'Membre';
    const paid = s.is_paid == 1;
    html += `<div class="member-payment-row">
      <div class="member-payment-name">${name}</div>
      <div class="member-payment-amount">${fmt(perMember)}</div>
      ${isMgr
        ? `<button class="payment-status-btn ${paid?'paid':'unpaid'} can-toggle" onclick="togglePayment(${budgetId},${s.member_id},${paid?0:1})">${paid?'✓ Payé':'✗ Non payé'}</button>`
        : `<span class="payment-status-btn ${paid?'paid':'unpaid'}">${paid?'✓ Payé':'✗ Non payé'}</span>`
      }
    </div>`;
  });
  html += `</div>`;
  return html;
}

function togglePayment(budgetId, memberId, newState) {
  db.setPaymentStatus(budgetId, memberId, newState);
  renderBudgetDetail(budgetId);
}

function isCurrentUserManager() {
  const profile = db.getProfile();
  if (!profile || !profile.user_id) return false;
  const member = db.getMemberByUserId(profile.user_id);
  if (!member) return false;
  return member.role === 'manager';
}

// ─── Item Card ───
function renderItemCard(item, budgetId) {
  const spent = db.getTotalSpentByItem(item.id);
  const pct = item.budgeted_amount > 0 ? Math.min(100,(spent/item.budgeted_amount)*100) : 0;
  return `<div class="food-item-card ${item.is_finished?'exhausted':''}">
    <div class="food-item-header">
      <span class="food-item-name">${escHtml(item.name)}</span>
      <div class="food-item-actions">
        <button class="item-action-btn" title="Ajouter achat" onclick="openCreatePurchaseModal(${item.id})"><i class="fas fa-plus"></i></button>
        <button class="item-action-btn" title="Liste achats" onclick="openPurchasesListModal(${item.id})"><i class="fas fa-list"></i></button>
        <button class="item-action-btn" title="Réappro" onclick="openRefillModal(${item.id})"><i class="fas fa-fill-drip"></i></button>
        <button class="item-action-btn delete-btn" title="Supprimer" onclick="confirmDeleteItem(${item.id})"><i class="fas fa-trash-alt"></i></button>
      </div>
    </div>
    <div class="progress-container">
      <div class="progress-label-row">
        <span>Dépensé: ${fmt(spent)}</span><span>Budget: ${fmt(item.budgeted_amount)}</span>
      </div>
      <div class="progress-track"><div class="progress-fill ${pct>90?'danger':'success'}" style="width:${pct}%"></div></div>
    </div>
    ${item.is_finished
      ? `<div class="exhaust-date-label"><i class="fas fa-ban"></i> Épuisé le: ${item.finished_date||''}</div>
         <button class="item-action-btn" style="font-size:12px;width:auto;padding:4px 10px;height:auto;margin-top:6px" onclick="db.unmarkItemFinished(${item.id});renderBudgetDetail(${budgetId})"><i class="fas fa-undo"></i> Rétablir</button>`
      : `<button class="item-action-btn" style="font-size:12px;width:auto;padding:4px 10px;height:auto;margin-top:6px" onclick="markItemExhausted(${item.id},${budgetId})"><i class="fas fa-ban"></i> Marquer épuisé</button>`
    }
  </div>`;
}

function markItemExhausted(itemId, budgetId) {
  db.markItemFinished(itemId, today());
  db.addSuggestion(db.getItem(itemId)?.name || '');
  renderBudgetDetail(budgetId);
}

// ─── Budget Modals ───
function openCreateBudgetModal() {
  state.editBudgetId = null;
  $('budget-modal-title').textContent = 'Créer un Budget';
  $('save-budget-btn').textContent = 'Créer le Budget';
  $('budget-name').value = '';
  $('budget-start-date').value = today();
  $('budget-duration-type').value = 'month';
  $('budget-duration-val').value = '1';
  openModal('budget-modal');
}

function openEditBudgetModal(id) {
  const b = db.getBudget(id);
  if (!b) return;
  state.editBudgetId = id;
  $('budget-modal-title').textContent = 'Modifier le Budget';
  $('save-budget-btn').textContent = 'Mettre à jour';
  $('budget-name').value = b.name;
  $('budget-start-date').value = b.start_date;
  $('budget-duration-type').value = b.duration_type;
  $('budget-duration-val').value = b.duration_value;
  openModal('budget-modal');
}

function saveBudget() {
  const name = $('budget-name').value.trim();
  const startDate = $('budget-start-date').value;
  const durationType = $('budget-duration-type').value;
  const durationValue = parseInt($('budget-duration-val').value)||1;
  if (!name) { showToast('Nom du budget requis','error'); return; }
  if (!startDate) { showToast('Date de début requise','error'); return; }
  const endDate = calcEndDate(startDate, durationType, durationValue);
  const data = { name, start_date:startDate, end_date:endDate, duration_type:durationType, duration_value:durationValue };
  if (state.editBudgetId) {
    db.updateBudget(state.editBudgetId, data);
    showToast('Budget mis à jour!','success');
    closeModal('budget-modal');
    renderBudgetDetail(state.editBudgetId);
  } else {
    const newId = db.createBudget(data);
    db.initPaymentStatusesForBudget(newId);
    showToast('Budget créé!','success');
    closeModal('budget-modal');
    // Retour au dashboard et affichage immédiat du nouveau budget
    showDashboard();
  }
}

function confirmDeleteBudget(id) {
  const b = db.getBudget(id);
  if (!b) return;
  if (confirm(`Supprimer "${b.name}" et tout son contenu?`)) {
    db.deleteBudget(id);
    playSound('delete');
    showToast('Budget supprimé','info');
    showDashboard();
  }
}

// ─── Item Modals ───
function openCreateItemModal(budgetId) {
  state.currentBudgetId = budgetId;
  state.currentItemId = null;
  $('item-name').value = '';
  $('item-budgeted').value = '';
  $('item-advisor-tip').classList.add('hidden');
  renderItemSuggestions('');
  openModal('item-modal');
}

function renderItemSuggestions(filter) {
  const suggestions = db.getSuggestions();
  const container = $('item-suggestions');
  const filtered = filter ? suggestions.filter(s=>s.toLowerCase().includes(filter.toLowerCase())).slice(0,8) : suggestions.slice(0,12);
  container.innerHTML = filtered.map(s => `<span class="suggestion-tag" onclick="selectItemSuggestion('${escAttr(s)}')">${escHtml(s)}</span>`).join('');
}

function selectItemSuggestion(name) {
  $('item-name').value = name;
  checkItemAdvisor(name);
}

function checkItemAdvisor(name) {
  if (!name) return;
  const prev = db.getPreviousItemData(name).filter(p=>p.is_finished);
  if (prev.length > 0) {
    const suggested = Math.ceil((prev[0].spent||0) * 1.1);
    const tip = $('item-advisor-tip');
    tip.innerHTML = `<i class="fas fa-lightbulb"></i> Conseil: "${escHtml(name)}" s'est épuisé lors du dernier budget. Suggestion: ${fmt(suggested)}`;
    tip.classList.remove('hidden');
    if (!$('item-budgeted').value) $('item-budgeted').value = suggested;
  } else {
    $('item-advisor-tip').classList.add('hidden');
  }
}

function saveItem() {
  const name = $('item-name').value.trim();
  const budgeted = parseFloat($('item-budgeted').value)||0;
  if (!name) { showToast("Nom de l'achat requis",'error'); return; }
  db.createItem({ budget_id:state.currentBudgetId, name, budgeted_amount:budgeted });
  db.addSuggestion(name);
  showToast('Achat ajouté!','success');
  closeModal('item-modal');
  renderBudgetDetail(state.currentBudgetId);
}

function confirmDeleteItem(id) {
  const item = db.getItem(id);
  if (!item) return;
  if (confirm(`Supprimer "${item.name}" et tous ses achats?`)) {
    const budgetId = item.budget_id;
    db.deleteItem(id);
    playSound('delete');
    showToast('Achat supprimé','info');
    renderBudgetDetail(budgetId);
  }
}

// ─── Purchase Modals ───
function openCreatePurchaseModal(itemId) {
  state.currentItemId = itemId;
  $('purchase-date').value = today();
  $('purchase-amount').value = '';
  $('purchase-qty').value = '';
  $('purchase-note').value = '';
  openModal('purchase-modal');
}

function savePurchase() {
  const date = $('purchase-date').value;
  const amount = parseFloat($('purchase-amount').value)||0;
  const qty = $('purchase-qty').value.trim();
  const note = $('purchase-note').value.trim();
  if (!date) { showToast('Date requise','error'); return; }
  if (amount <= 0) { showToast('Montant invalide','error'); return; }
  db.createPurchase({ item_id:state.currentItemId, date, amount, qty, note });
  showToast('Achat enregistré!','success');
  closeModal('purchase-modal');
  if (state.currentBudgetId) renderBudgetDetail(state.currentBudgetId);
}

function openPurchasesListModal(itemId) {
  state.currentItemId = itemId;
  const purchases = db.getPurchasesByItem(itemId);
  const list = $('purchases-modal-list');
  if (purchases.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i class="fas fa-receipt"></i></div><div>Aucun achat enregistré</div></div>';
  } else {
    list.innerHTML = purchases.map(p => `
      <div class="purchase-row">
        <div class="purchase-left">
          <span class="purchase-ref">${p.date}${p.qty?' · '+escHtml(p.qty):''}</span>
          ${p.note?`<span class="purchase-sub">${escHtml(p.note)}</span>`:''}
        </div>
        <div class="purchase-right">
          <span class="purchase-amt">${fmt(p.amount)}</span>
          <button class="purchase-del-btn" onclick="deletePurchaseFromList(${p.id},${itemId})"><i class="fas fa-trash"></i></button>
        </div>
      </div>`).join('');
  }
  openModal('purchases-list-modal');
}

function deletePurchaseFromList(purchaseId, itemId) {
  if (confirm('Supprimer cet achat?')) {
    db.deletePurchase(purchaseId);
    playSound('delete');
    openPurchasesListModal(itemId);
    if (state.currentBudgetId) renderBudgetDetail(state.currentBudgetId);
  }
}

// ─── Refill Modal ───
function openRefillModal(itemId) {
  state.currentItemId = itemId;
  $('refill-amount').value = '';
  $('refill-qty').value = '';
  $('refill-note').value = 'Réappro.';
  openModal('refill-modal');
}

function saveRefill() {
  const amount = parseFloat($('refill-amount').value)||0;
  const qty = $('refill-qty').value.trim();
  const note = $('refill-note').value.trim();
  if (amount <= 0) { showToast('Montant invalide','error'); return; }
  db.createPurchase({ item_id:state.currentItemId, date:today(), amount, qty, note:note||'Réappro.' });
  const item = db.getItem(state.currentItemId);
  if (item && item.is_finished) db.unmarkItemFinished(state.currentItemId);
  showToast('Stock achaté!','success');
  closeModal('refill-modal');
  if (state.currentBudgetId) renderBudgetDetail(state.currentBudgetId);
}

// ─── Calculatrice ───
let calcExpression = '0', calcPreviewVal = '0';

function pressCalc(key) {
  if (key==='C') { calcExpression='0'; calcPreviewVal='0'; }
  else if (key==='Backspace') { calcExpression = calcExpression.length>1 ? calcExpression.slice(0,-1) : '0'; }
  else if (key==='=') {
    try {
      const r = Function('"use strict";return ('+calcExpression+')')();
      calcPreviewVal = r.toString(); calcExpression = r.toString();
    } catch(e) { calcPreviewVal = 'Erreur'; }
  } else {
    if (calcExpression==='0' && !'+-*/('.includes(key)) calcExpression = key;
    else calcExpression += key;
    try { calcPreviewVal = Function('"use strict";return ('+calcExpression+')')().toString(); }
    catch(e) { calcPreviewVal = calcExpression; }
  }
  const display = $('calc-display'), preview = $('calc-preview');
  if (display) display.value = calcExpression;
  if (preview) preview.textContent = parseFloat(calcPreviewVal) ? parseFloat(calcPreviewVal).toLocaleString('fr-FR') : calcPreviewVal;
}

function openCalculatorForField(fieldId) {
  state.calcTarget = fieldId;
  const calc = $('calculator-modal');
  calc.style.display = 'flex';
}

function insertCalcValue() {
  const val = parseFloat(calcPreviewVal);
  if (isNaN(val)) { showToast('Valeur invalide','error'); return; }
  if (state.calcTarget) {
    const field = $(state.calcTarget);
    if (field) { field.value = val; field.dispatchEvent(new Event('input')); }
    const calc = $('calculator-modal');
    calc.style.display = 'none';
    state.calcTarget = null;
  } else {
    navigator.clipboard?.writeText(val.toString())
      .then(()=>showToast('Montant copié: '+val,'success'))
      .catch(()=>showToast('Montant: '+val,'info'));
  }
}

function initCalculatorDrag() {
  const modal = $('calculator-modal'), header = $('calculator-drag-header');
  if (!modal || !header) return;
  let isDragging=false, startX, startY, startLeft, startTop;
  const drag = (clientX, clientY) => {
    if (!isDragging) return;
    modal.style.left = (startLeft + clientX - startX)+'px';
    modal.style.top = (startTop + clientY - startY)+'px';
    modal.style.right = 'auto'; modal.style.transform = 'none';
  };
  header.addEventListener('mousedown', e => {
    isDragging=true; startX=e.clientX; startY=e.clientY;
    const r=modal.getBoundingClientRect(); startLeft=r.left; startTop=r.top; e.preventDefault();
  });
  document.addEventListener('mousemove', e => drag(e.clientX, e.clientY));
  document.addEventListener('mouseup', ()=>{ isDragging=false; });
  header.addEventListener('touchstart', e => {
    isDragging=true; const t=e.touches[0]; startX=t.clientX; startY=t.clientY;
    const r=modal.getBoundingClientRect(); startLeft=r.left; startTop=r.top;
  }, {passive:true});
  document.addEventListener('touchmove', e => { if(isDragging){const t=e.touches[0];drag(t.clientX,t.clientY);} }, {passive:true});
  document.addEventListener('touchend', ()=>{ isDragging=false; });
}

// ─── Date Sélecteur ───
function openSelectionModal() {
  populateSelectionGrids();
  openModal('selection-modal');
}

function populateSelectionGrids() {
  const d = state.currentDate;
  const currentYear = new Date().getFullYear();

  const yearGrid = $('year-grid');
  yearGrid.innerHTML = '';
  for (let y=currentYear-3; y<=currentYear+2; y++) {
    const el = document.createElement('div');
    el.className = 'year-item' + (y===d.getFullYear()?' selected':'');
    el.textContent = y;
    el.onclick = () => {
      state.currentDate.setFullYear(y);
      updateHeaderDate();
      populateSelectionGrids();
      if (state.currentView==='dashboard') renderDashboard();
      // Auto-avancer vers les mois
      switchSelectionTab('months');
    };
    yearGrid.appendChild(el);
  }

  const monthGrid = $('month-grid');
  monthGrid.innerHTML = '';
  MONTHS_FR.forEach((m, i) => {
    const el = document.createElement('div');
    el.className = 'month-item' + (i===d.getMonth()?' selected':'');
    el.textContent = m;
    el.onclick = () => {
      state.currentDate.setMonth(i);
      updateHeaderDate();
      populateSelectionGrids();
      if (state.currentView==='dashboard') renderDashboard();
      // Auto-avancer vers les jours
      switchSelectionTab('days');
    };
    monthGrid.appendChild(el);
  });

  const daysInMonth = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
  const dayGrid = $('day-grid');
  dayGrid.innerHTML = '';
  for (let day=1; day<=daysInMonth; day++) {
    const el = document.createElement('div');
    el.className = 'day-item' + (day===d.getDate()?' selected':'');
    el.textContent = day;
    el.onclick = () => {
      state.currentDate.setDate(day);
      updateHeaderDate();
      populateSelectionGrids();
      if (state.currentView==='dashboard') renderDashboard();
      // Fermer le modal après sélection du jour
      closeModal('selection-modal');
    };
    dayGrid.appendChild(el);
  }
}

function switchSelectionTab(tabName) {
  document.querySelectorAll('#selection-modal .tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('#selection-modal .tab-content').forEach(c=>c.classList.remove('active-content'));
  const tab = document.querySelector(`#selection-modal .tab[data-tab="${tabName}"]`);
  if (tab) tab.classList.add('active');
  const map = { years:'year-grid-container', months:'month-grid-container', days:'day-grid-container' };
  const container = $(map[tabName]);
  if (container) container.classList.add('active-content');
}

// ─── Recherche ───
function performSearch(query) {
  const container = $('search-results');
  if (!query) { container.innerHTML=''; return; }
  query = query.toLowerCase();
  const results = [];
  db.getBudgets().forEach(b => {
    if (b.name.toLowerCase().includes(query)) results.push({ type:'budget', id:b.id, ref:b.name, text:`Budget · ${b.start_date} → ${b.end_date}` });
    db.getItemsByBudget(b.id).forEach(i => {
      if (i.name.toLowerCase().includes(query)) results.push({ type:'item', id:i.id, budgetId:b.id, ref:i.name, text:`Achat dans "${b.name}"` });
    });
  });
  if (results.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:30px">Aucun résultat</div>'; return;
  }
  container.innerHTML = results.map(r => `
    <div class="search-result-item" onclick="handleSearchResult('${r.type}',${r.id},${r.budgetId||0})">
      <div class="result-ref"><i class="fas fa-${r.type==='budget'?'folder':'empty-alt'}"></i> ${escHtml(r.ref)}</div>
      <div class="result-text">${escHtml(r.text)}</div>
    </div>`).join('');
}

function handleSearchResult(type, id, budgetId) {
  closeModal('search-modal');
  if (type==='budget') showBudgetDetail(id);
  else if (type==='item' && budgetId) showBudgetDetail(budgetId);
}

// ─── Paramètres ───
function loadSettings() {
  const theme = db.getSetting('theme','light');
  const currency = db.getSetting('currency','BIF');
  state.currency = currency;
  applyTheme(theme);
  const sel = $('theme-select'); if(sel) sel.value = theme;
  const lSel = $('lang-select'); if(lSel) lSel.value = db.getSetting('lang','fr');
  const cSel = $('currency-select'); if(cSel) cSel.value = currency;
  const snd = $('sound-toggle'); if(snd) snd.checked = db.getSetting('sound','1')==='1';
  
  const notify = $('notification-toggle');
  if (notify) {
    notify.checked = db.getSetting('notifications', '0') === '1' && Notification.permission === 'granted';
  }
}

function updateSettingsProfile() {
  const p = db.getProfile();
  const fullName = `${p.first_name} ${p.last_name}`.trim() || 'Utilisateur';
  const nameEl = $('settings-profile-name'); if(nameEl) nameEl.textContent = fullName;
  const emailEl = $('settings-profile-email'); if(emailEl) emailEl.textContent = p.email||'';
  if (p.photo) {
    const img = $('settings-profile-pic'), fb = $('settings-profile-pic-fallback');
    if(img){img.src=p.photo;img.style.display=''}
    if(fb) fb.style.display='none';
  }
  const dName = $('drawer-profile-name'); if(dName) dName.textContent = fullName;
  const dEmail = $('drawer-profile-email'); if(dEmail) dEmail.textContent = p.email||'';
  if (p.photo) {
    const da = $('drawer-avatar'), df = $('drawer-avatar-fallback');
    if(da){da.src=p.photo;da.style.display=''}
    if(df) df.style.display='none';
  }
  const badge = $('drawer-role-badge');
  if (badge) {
    const member = db.getMemberByUserId(p.user_id);
    badge.style.display = (member && member.role==='manager') ? 'inline-block' : 'none';
  }
}

// ─── Membres Modal ───
function openMembersModal() {
  renderMembersList();
  checkPrivilegeTransfer();
  openModal('members-modal');
}

function renderMembersList() {
  const members = db.getMembers();
  const list = $('members-list'), count = $('members-count');
  if (count) count.textContent = members.length;
  if (members.length === 0) {
    list.innerHTML = '<div class="empty-state" style="padding:20px"><i class="fas fa-users" style="font-size:24px;color:var(--text-muted)"></i><div style="font-size:13px">Aucun membre dans le ménage</div></div>';
  } else {
    list.innerHTML = members.map(m => {
      const initials = (m.first_name?.[0]||'')+(m.last_name?.[0]||'');
      const name = `${m.first_name||''} ${m.last_name||''}`.trim()||'Membre';
      return `<div class="member-row">
        <div class="member-avatar">
          ${m.photo?`<img src="${escHtml(m.photo)}" alt="${escHtml(name)}" style="width:100%;height:100%;object-fit:cover">`:(initials||'<i class="fas fa-user"></i>')}
        </div>
        <div class="member-info">
          <div class="member-name">${escHtml(name)}</div>
          <div class="member-email">${escHtml(m.email||'')}</div>
        </div>
        <span class="member-role ${m.role==='manager'?'manager':'member'}">${m.role==='manager'?'👑 Gérant':'Membre'}</span>
        ${isCurrentUserManager()&&m.role!=='manager'?`<button class="item-action-btn delete-btn" style="width:28px;height:28px;font-size:11px;flex-shrink:0" onclick="removeMember(${m.id})" title="Retirer"><i class="fas fa-user-minus"></i></button>`:''}
      </div>`;
    }).join('');
  }

  // Section invitation gérant vs membre
  const inviteSection = $('members-invite-section');
  if (inviteSection) {
    if (isCurrentUserManager()) {
      inviteSection.style.display = 'block';
      const scanBtn = inviteSection.querySelector('button[onclick*="startCameraQRScan"]');
      if (scanBtn) {
        scanBtn.setAttribute('onclick', "startCameraQRScan('add_member')");
        scanBtn.innerHTML = '<i class="fas fa-camera"></i> Scanner le QR d\'un nouveau membre';
      }
    } else {
      inviteSection.style.display = 'none';
    }
  }

  // Section transfert
  const transferSection = $('privilege-transfer-section');
  if (transferSection) {
    if (isCurrentUserManager() && members.length > 1) {
      transferSection.style.display = 'block';
      const sel = $('transfer-target-select');
      sel.innerHTML = '<option value="">-- Choisir un membre --</option>';
      members.filter(m=>m.role!=='manager').forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = `${m.first_name||''} ${m.last_name||''}`.trim();
        sel.appendChild(opt);
      });
    } else {
      transferSection.style.display = 'none';
    }
  }
}

function removeMember(memberId) {
  if (!isCurrentUserManager()) {
    showToast('Seul le gérant peut retirer des membres du ménage.', 'error');
    return;
  }
  if (confirm('Retirer ce membre du ménage?')) {
    db.deleteMember(memberId);
    playSound('delete');
    renderMembersList();
    showToast('Membre retiré','info');
  }
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
      renderMembersList(); approvalSection.style.display='none';
      updateSettingsProfile();
      showToast('Vous êtes maintenant gestionnaire!','success');
    };
    $('reject-transfer-btn').onclick = () => {
      db.resolveTransferRequest(pending.id, false);
      approvalSection.style.display = 'none';
      showToast('Demande refusée','info');
    };
  } else {
    approvalSection.style.display = 'none';
  }
}

// ─── Export .menap avec sélection de budgets ───
let _importParsedData = null; // données parsées du fichier importé

function openBackupModal() {
  openModal('backup-modal');
  refreshExportBudgetList();
}

function refreshExportBudgetList() {
  const container = $('export-budget-list');
  if (!container) return;
  const budgets = db.getBudgets();
  if (budgets.length === 0) {
    container.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:10px;text-align:center">Aucun budget disponible</div>';
    return;
  }
  container.innerHTML = budgets.map(b => {
    const items = db.getItemsByBudget(b.id);
    const total = items.reduce((s, i) => s + (i.budgeted_amount || 0), 0);
    return `<label class="budget-select-row" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;background:var(--card-bg);border:1.5px solid var(--border-color);cursor:pointer">
      <input type="checkbox" class="export-budget-cb" data-id="${b.id}" checked style="width:18px;height:18px;cursor:pointer;accent-color:var(--primary-color)">
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${b.name}</div>
        <div style="font-size:11px;color:var(--text-muted)">${b.start_date} → ${b.end_date} · ${items.length} article(s) · ${fmt(total)}</div>
      </div>
    </label>`;
  }).join('');
}

function exportMenap() {
  const checkboxes = document.querySelectorAll('.export-budget-cb:checked');
  if (checkboxes.length === 0) { showToast('Sélectionnez au moins un budget','error'); return; }
  const ids = Array.from(checkboxes).map(cb => parseInt(cb.dataset.id));
  const content = db.exportToMenap(ids);
  const blob = new Blob([content], { type:'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=`menap_backup_${today()}.menap`; a.click();
  URL.revokeObjectURL(url);
  showToast(`${ids.length} budget(s) exporté(s)!`, 'success');
}

// Alias pour compatibilité
function exportDem() { exportMenap(); }

// ─── Import .menap avec aperçu et sélection ───
async function handleImportFile(file) {
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext==='menap'||ext==='dem'||ext==='sem') {
    const reader = new FileReader();
    reader.onload = e => showImportPreview(e.target.result);
    reader.readAsText(file);
  } else if (/^image\//.test(file.type)) {
    const qrData = await scanQRFromFile(file);
    if (qrData) handleQRScanned(qrData);
    else showToast('Aucun QR détecté dans cette image','error');
  } else {
    showToast('Format non reconnu (.menap ou image QR)','error');
  }
}

function showImportPreview(content) {
  const data = db.parseMenapFile(content);
  if (!data) { showToast('Fichier .menap invalide ou corrompu','error'); return; }
  _importParsedData = { content, data };

  const preview = $('import-preview');
  const listEl  = $('import-budget-list');
  if (!preview || !listEl) return;

  const budgets = data.budgets || [];
  if (budgets.length === 0) {
    listEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:10px;text-align:center">Aucun budget dans ce fichier</div>';
    preview.style.display = 'block';
    return;
  }

  listEl.innerHTML = budgets.map((b, i) => {
    const items = b.items || [];
    const total = items.reduce((s, it) => s + (it.budgeted_amount || 0), 0);
    const purchases = items.reduce((s, it) => s + (it.purchases ? it.purchases.length : 0), 0);
    // Vérifier si ce budget existe déjà localement
    const isDuplicate = db.getBudgets().some(
      existing => existing.name === b.name && existing.start_date === b.start_date && existing.end_date === b.end_date
    );
    return `<label class="budget-select-row" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;background:var(--card-bg);border:1.5px solid ${isDuplicate ? 'var(--danger-color)' : 'var(--border-color)'};cursor:pointer;opacity:${isDuplicate ? '0.65' : '1'}">
      <input type="checkbox" class="import-budget-cb" data-index="${i}" ${isDuplicate ? '' : 'checked'} style="width:18px;height:18px;cursor:pointer;accent-color:var(--primary-color)">
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${b.name}${isDuplicate ? ' <span style="font-size:10px;color:var(--danger-color);font-weight:600">⚠ Déjà existant</span>' : ''}</div>
        <div style="font-size:11px;color:var(--text-muted)">${b.start_date} → ${b.end_date}</div>
        <div style="font-size:11px;color:var(--text-muted)">${items.length} article(s) · ${purchases} achat(s) · Budgété: ${fmt(total)}</div>
      </div>
    </label>`;
  }).join('');

  preview.style.display = 'block';
  showToast(`${budgets.length} budget(s) trouvé(s) dans le fichier`, 'info');
}

function confirmImport() {
  if (!_importParsedData) return;
  const checkboxes = document.querySelectorAll('.import-budget-cb:checked');
  if (checkboxes.length === 0) { showToast('Sélectionnez au moins un budget','error'); return; }
  const indices = Array.from(checkboxes).map(cb => parseInt(cb.dataset.index));
  const result = db.importFromMenap(_importParsedData.content, indices);
  if (result.ok) {
    if (result.imported === 0 && result.skipped > 0) {
      showToast(`Tous les budgets existent déjà (${result.skipped} ignoré(s))`, 'info');
    } else if (result.skipped > 0) {
      showToast(`${result.imported} importé(s), ${result.skipped} doublon(s) ignoré(s)`, 'success');
    } else {
      showToast(`${result.imported} budget(s) importé(s) avec succès!`, 'success');
    }
    _importParsedData = null;
    $('import-preview').style.display = 'none';
    setTimeout(() => { renderDashboard(); closeModal('backup-modal'); }, 900);
  } else {
    showToast('Erreur lors de l\'importation','error');
  }
}

function exportSQLiteDB() {
  const buf = db.exportToBinary();
  const blob = new Blob([buf], { type:'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=`menap_${today()}.db`; a.click();
  URL.revokeObjectURL(url);
  showToast('Base SQLite exportée!','success');
}

// ─── Indicateur de synchronisation ───
function updateSyncIndicator() {
  const dot  = $('sync-dot');
  const text = $('sync-text');
  const online = navigator.onLine;
  const polling = !!db._pollTimer;

  if (dot) {
    if (!online) {
      dot.className = 'sync-dot offline';
    } else if (db._uploading || db._syncPending) {
      dot.className = 'sync-dot syncing';
    } else if (polling) {
      dot.className = 'sync-dot realtime';
    } else {
      dot.className = 'sync-dot';
    }
  }
  if (text) {
    if (!online)            text.textContent = 'Hors-ligne';
    else if (db._uploading) text.textContent = 'Synchronisation…';
    else if (db._syncPending) text.textContent = 'En attente…';
    else if (polling)       text.textContent = 'En ligne ●';
    else                    text.textContent = 'Synchronisé';
  }
}
window.addEventListener('online',  updateSyncIndicator);
window.addEventListener('offline', updateSyncIndicator);
window._onSyncStateChange = updateSyncIndicator;

// ─── Modification de profil ───
function openEditProfile() {
  const profile = db.getProfile();
  if (!profile) return;
  $('edit-profile-first-name').value  = profile.first_name || '';
  $('edit-profile-last-name').value   = profile.last_name  || '';
  $('edit-profile-email').value       = profile.email      || '';
  $('edit-profile-old-pw').value      = '';
  $('edit-profile-new-pw').value      = '';
  $('edit-profile-new-pw2').value     = '';
  const preview = $('edit-profile-pic-preview');
  if (preview) {
    preview.dataset.photo = '';
    preview.innerHTML = profile.photo
      ? `<img src="${profile.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      : `<i class="fas fa-user" style="font-size:28px;color:var(--primary-color)"></i>`;
  }
  const section = $('edit-profile-section');
  if (section) {
    section.style.display = section.style.display === 'none' ? 'block' : 'none';
  }
}

function saveEditProfile() {
  const fn  = $('edit-profile-first-name').value.trim();
  const ln  = $('edit-profile-last-name').value.trim();
  const em  = $('edit-profile-email').value.trim();
  const oldPw = $('edit-profile-old-pw').value;
  const newPw = $('edit-profile-new-pw').value;
  const newPw2 = $('edit-profile-new-pw2').value;
  const photo = $('edit-profile-pic-preview')?.dataset.photo || undefined;

  if (!fn) { showToast('Prénom requis','error'); return; }
  if (newPw && newPw !== newPw2) { showToast('Les mots de passe ne correspondent pas','error'); return; }

  try {
    db.updateProfileFull({ first_name: fn, last_name: ln, email: em,
      old_password: oldPw || undefined, new_password: newPw || undefined, photo });
    showToast('Profil mis à jour!','success');
    updateSettingsProfile();
    const section = $('edit-profile-section');
    if (section) section.style.display = 'none';
  } catch(e) {
    if (e.message === 'email_exists')    showToast('Cet email est déjà utilisé','error');
    else if (e.message === 'wrong_password') showToast('Ancien mot de passe incorrect','error');
    else if (e.message === 'password_short') showToast('Nouveau mot de passe trop court (min 4 caractères)','error');
    else showToast('Erreur: ' + e.message,'error');
  }
}

// ─── Partager ───
function shareApp() {
  const url = window.location.origin + window.location.pathname;
  if (navigator.share) {
    navigator.share({ title:'Menap - Budget Achataire', text:'Gérez votre budget achataire familial!', url }).catch(()=>{});
  } else {
    navigator.clipboard?.writeText(url).then(()=>showToast('Lien copié!','success')).catch(()=>showToast('Partagez: '+url,'info'));
  }
}

// ─── Onboarding ───
function showOnboarding() {
  const screen = $('onboarding-screen');
  if (screen) screen.classList.remove('hidden');
  // Si un profil existe déjà dans menap.db (chargé depuis le serveur),
  // pré-remplir l'email et basculer sur l'onglet Connexion
  const p = db.getProfile();
  if (p && p.email) {
    const emailField = $('login-email');
    if (emailField) emailField.value = p.email;
    const hint = $('login-profile-hint');
    if (hint) {
      hint.textContent = `Compte trouvé : ${p.first_name} ${p.last_name}`.trim();
      hint.style.display = 'block';
    }
    $('tab-onboard-login')?.click();
  }
}

function hideOnboarding() {
  const screen = $('onboarding-screen');
  if (screen) screen.classList.add('hidden');
}

// ─── Bindings Event ───
function initEventListeners() {
  // Drawer
  $('menu-btn').addEventListener('click', ()=>{ $('drawer').classList.add('open'); $('overlay').classList.add('show'); });
  $('overlay').addEventListener('click', closeDrawer);
  function closeDrawer() { $('drawer').classList.remove('open'); $('overlay').classList.remove('show'); }

  const navItems = {
    'nav-dashboard': () => { closeDrawer(); showDashboard(); },
    'nav-budgets': () => { closeDrawer(); showBudgetsView(); },
    'nav-members': () => { closeDrawer(); openMembersModal(); },
    'nav-search': () => { closeDrawer(); openModal('search-modal'); setTimeout(()=>$('search-input').focus(),200); },
    'nav-backup': () => { closeDrawer(); openBackupModal(); },
    'nav-share': () => { closeDrawer(); shareApp(); },
    'nav-settings': () => { closeDrawer(); updateSettingsProfile(); openModal('settings-modal'); },
    'nav-info': () => { closeDrawer(); openModal('contact-modal'); },
    'nav-logout': () => { closeDrawer(); openModal('logout-modal'); }
  };
  Object.entries(navItems).forEach(([id, fn]) => { const el=$(id); if(el) el.addEventListener('click',fn); });

  // Header
  $('search-btn').addEventListener('click', ()=>{ openModal('search-modal'); setTimeout(()=>$('search-input').focus(),200); });
  $('header-calc-btn').addEventListener('click', ()=>{
    const c = $('calculator-modal');
    c.style.display = c.style.display==='flex' ? 'none' : 'flex';
  });

  // Date selectors
  $('header-year-selector').addEventListener('click', ()=>{ openSelectionModal(); switchSelectionTab('years'); });
  $('header-month-selector').addEventListener('click', ()=>{ openSelectionModal(); switchSelectionTab('months'); });
  $('header-day-selector').addEventListener('click', ()=>{ openSelectionModal(); switchSelectionTab('days'); });

  // Selection modal tabs
  document.querySelectorAll('#selection-modal .tab').forEach(tab => {
    tab.addEventListener('click', ()=>switchSelectionTab(tab.dataset.tab));
  });
  $('close-modal').addEventListener('click', ()=>closeModal('selection-modal'));

  // Close buttons
  const closeMaps = {
    'close-search':'search-modal','close-settings':'settings-modal','close-contact':'contact-modal',
    'close-budget-modal':'budget-modal','close-item-modal':'item-modal','close-purchase-modal':'purchase-modal',
    'close-purchases-list-modal':'purchases-list-modal','close-refill-modal':'refill-modal',
    'close-logout-modal':'logout-modal','close-backup-modal':'backup-modal',
    'close-members-modal':'members-modal','close-camera-qr':'camera-qr-modal'
  };
  Object.entries(closeMaps).forEach(([btnId, modalId]) => {
    const btn=$(btnId); if(!btn) return;
    btn.addEventListener('click', ()=>closeModal(modalId));
  });
  const calcClose = $('close-calculator-modal');
  if (calcClose) calcClose.addEventListener('click', ()=>{ $('calculator-modal').style.display='none'; });

  $('stop-camera-btn').addEventListener('click', ()=>{ stopCamera(); closeModal('camera-qr-modal'); });

  // Recherche
  $('search-input').addEventListener('input', e=>performSearch(e.target.value));

  // Paramètres
  $('theme-select').addEventListener('change', e=>{ db.setSetting('theme',e.target.value); applyTheme(e.target.value); });
  $('lang-select').addEventListener('change', e=>{ db.setSetting('lang',e.target.value); state.lang?.setLanguage(e.target.value); });
  $('currency-select').addEventListener('change', e=>{ state.currency=e.target.value; db.setSetting('currency',e.target.value); if(state.currentView==='dashboard') renderDashboard(); });
  $('sound-toggle').addEventListener('change', e=>db.setSetting('sound',e.target.checked?'1':'0'));

  // QR Paramètres
  $('generate-qr-btn')?.addEventListener('click', ()=>{ $('settings-qr-container').classList.remove('hidden'); generateInviteQR('qrcode'); });
  $('download-qr-btn')?.addEventListener('click', ()=>downloadQR('qrcode','menap-invite-qr.png'));

  // Modification de profil
  $('edit-profile-btn')?.addEventListener('click', openEditProfile);
  $('save-edit-profile-btn')?.addEventListener('click', saveEditProfile);
  $('cancel-edit-profile-btn')?.addEventListener('click', ()=>{ const s=$('edit-profile-section'); if(s) s.style.display='none'; });
  $('edit-profile-pic-btn')?.addEventListener('click', ()=>$('edit-profile-pic-input')?.click());
  $('edit-profile-pic-input')?.addEventListener('change', e=>{
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const p = $('edit-profile-pic-preview');
      if (p) { p.innerHTML=`<img src="${ev.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`; p.dataset.photo=ev.target.result; }
    };
    reader.readAsDataURL(file);
  });

  // Supprimer compte
  $('delete-account-btn')?.addEventListener('click', ()=>{
    if (!confirm('Supprimer définitivement votre compte et toutes vos données ? Action irréversible.')) return;
    if (!confirm('Dernière confirmation : toutes les données seront supprimées.')) return;
    db.deleteCurrentUser();
    showToast('Compte supprimé.','info');
    setTimeout(()=>location.reload(),800);
  });

  // Membres
  $('generate-invite-qr-btn').addEventListener('click', ()=>{ $('invite-qr-container').classList.remove('hidden'); generateInviteQR('invite-qrcode'); });
  $('download-invite-qr-btn').addEventListener('click', ()=>downloadQR('invite-qrcode','menap-invite-qr.png'));
  $('transfer-privilege-btn').addEventListener('click', ()=>{
    const targetId = $('transfer-target-select').value;
    if (!targetId) { showToast('Choisissez un membre','error'); return; }
    const profile = db.getProfile();
    const myMember = db.getMemberByUserId(profile.user_id);
    db.createTransferRequest(myMember?.id||null, parseInt(targetId));
    showToast("Demande envoyée! En attente d'approbation.",'success');
  });

  // Budget
  $('save-budget-btn').addEventListener('click', saveBudget);

  // Item
  $('item-name').addEventListener('input', e=>{ renderItemSuggestions(e.target.value); if(e.target.value.length>2) checkItemAdvisor(e.target.value); });
  $('save-item-btn').addEventListener('click', saveItem);

  // Purchase
  $('save-purchase-btn').addEventListener('click', savePurchase);
  $('save-refill-btn').addEventListener('click', saveRefill);

  $('export-btn')?.addEventListener('click', exportMenap);
  $('export-db-btn')?.addEventListener('click', exportSQLiteDB);
  $('export-select-all')?.addEventListener('click', ()=>{ document.querySelectorAll('.export-budget-cb').forEach(cb=>cb.checked=true); });
  $('export-select-none')?.addEventListener('click', ()=>{ document.querySelectorAll('.export-budget-cb').forEach(cb=>cb.checked=false); });
  $('import-btn-trigger')?.addEventListener('click', ()=>{ $('import-preview').style.display='none'; $('import-file-input').click(); });
  $('import-file-input')?.addEventListener('change', e=>{ if(e.target.files[0]) handleImportFile(e.target.files[0]); e.target.value=''; });
  $('import-select-all')?.addEventListener('click', ()=>{ document.querySelectorAll('.import-budget-cb').forEach(cb=>cb.checked=true); });
  $('import-select-none')?.addEventListener('click', ()=>{ document.querySelectorAll('.import-budget-cb').forEach(cb=>cb.checked=false); });
  $('import-confirm-btn')?.addEventListener('click', confirmImport);

  // Logout — export .menap
  $('logout-export-dem')?.addEventListener('click', exportMenap);
  $('logout-confirm-btn')?.addEventListener('click', ()=>{ db.clearAll(); location.reload(); });

  // ─── Onboarding Tabs (2 onglets seulement : Créer + Connexion) ───
  $('tab-onboard-create')?.addEventListener('click', ()=> setOnboardTab('create'));
  $('tab-onboard-login')?.addEventListener('click',  ()=> setOnboardTab('login'));

  function setOnboardTab(tab) {
    ['create','login'].forEach(t => {
      $(`tab-onboard-${t}`)?.classList.toggle('active', t===tab);
      $(`onboard-${t}-section`)?.classList.toggle('hidden', t!==tab);
    });
  }

  // Photo profil
  $('profile-pic-input').addEventListener('change', e=>{
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const p = $('profile-pic-preview');
      p.innerHTML = `<img src="${ev.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
      p.dataset.photo = ev.target.result;
    };
    reader.readAsDataURL(file);
  });

  // Créer profil
  $('setup-start-btn').addEventListener('click', ()=>{
    const fn = $('profile-first-name').value.trim();
    const ln = $('profile-last-name').value.trim();
    const em = $('profile-email').value.trim();
    const pw = $('profile-password').value;
    const lang = $('setup-lang-select').value;
    const currency = $('setup-currency-select').value;
    const photo = $('profile-pic-preview').dataset.photo||'';

    if (!fn) { showToast('Prénom requis','error'); return; }
    if (!em) { showToast('Email requis','error'); return; }
    if (!pw || pw.length < 4) { showToast('Mot de passe trop court (min. 4 caractères)','error'); return; }

    const userId = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36));
    db.saveProfile({ user_id:userId, first_name:fn, last_name:ln, email:em, password:pw, photo, role:'manager' });
    db.setSetting('lang', lang);
    db.setSetting('currency', currency);
    db.setSetting('theme', 'light');
    db.setSetting('initialized', '1');
    state.currency = currency;

    state.lang?.setLanguage(lang);
    hideOnboarding();
    updateSettingsProfile();
    updateHeaderDate();
    renderDashboard();
    showToast(`Bienvenue ${fn}!`,'success');
  });

  // Connexion email+mdp
  $('login-btn').addEventListener('click', ()=>{
    const em = $('login-email').value.trim();
    const pw = $('login-password').value;
    if (!em || !pw) { showToast('Email et mot de passe requis','error'); return; }
    if (db.verifyPassword(em, pw)) {
      db.setSetting('initialized','1');
      hideOnboarding();
      updateSettingsProfile();
      updateHeaderDate();
      renderDashboard();
      const p = db.getProfile();
      showToast(`Bienvenue ${p.first_name}!`,'success');
    } else {
      showToast('Identifiants incorrects ou aucun compte trouvé sur le serveur.','error');
    }
  });

  // Rejoindre le ménage (QR adhésion)
  $('onboard-join-btn')?.addEventListener('click', () => {
    let joinUserId = localStorage.getItem('menap_pending_join_uid');
    if (!joinUserId) {
      joinUserId = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36));
      localStorage.setItem('menap_pending_join_uid', joinUserId);
    }
    const payload = JSON.stringify({
      _t: 'join_request',
      uid: joinUserId
    });
    generateQR('join-request-qrcode', payload, 220);
    openModal('join-request-modal');
    startJoinPoll(joinUserId);
  });

  $('cancel-join-request-btn')?.addEventListener('click', () => {
    stopJoinPoll();
    closeModal('join-request-modal');
  });
  $('close-join-request-modal')?.addEventListener('click', () => {
    stopJoinPoll();
    closeModal('join-request-modal');
  });

  // Compléter profil
  $('complete-profile-save-btn')?.addEventListener('click', saveCompleteProfile);
  $('complete-pic-input')?.addEventListener('change', e => {
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const p = $('complete-pic-preview');
      if (p) {
        p.innerHTML = `<img src="${ev.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
        p.dataset.photo = ev.target.result;
      }
    };
    reader.readAsDataURL(file);
  });

  // Toggle notifications
  $('notification-toggle')?.addEventListener('change', async e => {
    if (e.target.checked) {
      if ('Notification' in window) {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          db.setSetting('notifications', '1');
          showToast('Notifications activées !', 'success');
        } else {
          db.setSetting('notifications', '0');
          e.target.checked = false;
          showToast('Permission refusée pour les notifications', 'error');
        }
      } else {
        db.setSetting('notifications', '0');
        e.target.checked = false;
        showToast('Votre navigateur ne supporte pas les notifications', 'error');
      }
    } else {
      db.setSetting('notifications', '0');
      showToast('Notifications désactivées', 'info');
    }
  });
} // fin initEventListeners
async function initApp() {
  showLoading(true, 'Demarrage...');
  try {
    await db.init();

    const savedLang = db.getSetting('lang','fr');
    state.lang = new LangJS({
      languagePath: 'lang/',
      defaultLanguage: savedLang,
      availableLanguages: ['fr','rw','rn','en'],
      onLanguageChange: lang => {
        db.setSetting('lang', lang);
        const sel=$('lang-select'); if(sel) sel.value=lang;
        const ss=$('setup-lang-select'); if(ss) ss.value=lang;
      }
    });
    await state.lang.init();

    loadSettings();
    initCalculatorDrag();
    initEventListeners();

    // Source unique = menap.db sur le serveur : si un profil y est, on va au dashboard
    const serverProfile = db.getProfile();
    const hasProfile = serverProfile && serverProfile.first_name && serverProfile.first_name.trim() !== '';
    if (!hasProfile) {
      showLoading(false);
      showOnboarding();
      return;
    }
    // Synchroniser le flag initialized si nécessaire (migration)
    if (db.getSetting('initialized','0') !== '1') db.setSetting('initialized','1');

    updateSettingsProfile();
    updateHeaderDate();
    renderDashboard();
    checkPrivilegeTransfer();

    // Démarrer polling api.php
    window._onRemoteChange = () => {
      if (state.currentView === 'dashboard') renderDashboard();
      updateSettingsProfile();
      updateSyncIndicator();
      sendLocalNotification("Menap - Mise à jour", "Les données du ménage ont été mises à jour par un autre membre.");
    };
    db.startPolling(15000);
    updateSyncIndicator();

  } catch(err) {
    console.error('App init error:', err);
    showToast('Erreur d\'initialisation: '+err.message,'error');
  } finally {
    showLoading(false);
  }
}

document.addEventListener('DOMContentLoaded', initApp);

/**
 * MenapDB v3.0 - Couche SQLite via sql.js
 * Persistance: localStorage (base64) + export .db binaire
 */
