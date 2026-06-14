import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import {
    getFirestore, collection, doc,
    addDoc, deleteDoc, onSnapshot, updateDoc, getDoc, serverTimestamp, arrayUnion
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCcwCROOUnfk2Eeiok0s_LppiEo0xEG29o",
    authDomain: "mundus-12345.firebaseapp.com",
    projectId: "mundus-12345",
    storageBucket: "mundus-12345.firebasestorage.app",
    messagingSenderId: "740637759582",
    appId: "1:740637759582:web:b5068fcaca1d140f3afccf"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ── STATE ──
let currentLobbyId = null;
let myRole = null; // 'p1' | 'p2' | 'spectator'
let lobbyUnsub = null;
let historyActiveTab = 'p1';
let cachedLobbyData = null;

const $ = id => document.getElementById(id);

// ── HOME ──
const homePage = $('home');
const lobbyPage = $('lobby-page');
const lobbyNameInput = $('lobby-name-input');
const createBtn = $('create-btn');
const lobbyList = $('lobby-list');

// ── LOBBY ──
const lobbyTitle = $('lobby-title');
const spectatorBanner = $('spectator-banner');
const meHpEl = $('me-hp');
const opponentHpEl = $('opponent-hp');
const meControls = $('me-controls');
const meNameDisplay = $('me-name-display');
const opponentNameDisplay = $('opponent-name-display');
const opponentLabel = $('opponent-label');
const meAmountInput = $('me-amount');

// ── PAGES ──
function showPage(page) {
    homePage.classList.remove('active');
    lobbyPage.classList.remove('active');
    page.classList.add('active');
}

function fmt(n) {
    return Number(n).toLocaleString('fr-FR');
}

// ── LOBBY LIST ──
onSnapshot(collection(db, 'lobbies'), snap => {
    if (snap.empty) {
        lobbyList.innerHTML = '<div class="empty-state">Aucune partie. Créez-en une !</div>';
        return;
    }
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));
    items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    lobbyList.innerHTML = items.map(l => {
        const finished = l.status === 'finished';
        return `
      <div class="lobby-item" data-id="${l.id}">
        <div class="lobby-info">
          <div class="lobby-name">${esc(l.name)}</div>
          <div class="lobby-meta">${esc(l.p1Name || 'Joueur 1')} vs ${esc(l.p2Name || 'Joueur 2')}</div>
        </div>
        <span class="lobby-status ${finished ? 'finished' : 'ongoing'}">${finished ? 'Terminée' : 'En cours'}</span>
        <button class="btn-del" data-del="${l.id}">✕</button>
      </div>`;
    }).join('');
    $('lobby-list').scrollTop = $('lobby-list').scrollHeight;

    lobbyList.querySelectorAll('.lobby-item').forEach(el => {
        el.addEventListener('click', e => {
            if (e.target.closest('[data-del]')) return;
            openLobby(el.dataset.id);
        });
    });
    lobbyList.querySelectorAll('[data-del]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            currentLobbyId = btn.dataset.del;
            triggerDelete();
        });
    });
});

// ── CREATE ──
createBtn.addEventListener('click', async () => {
    const name = lobbyNameInput.value.trim();
    if (!name) return;
    createBtn.disabled = true;
    const ref = await addDoc(collection(db, 'lobbies'), {
        name,
        status: 'ongoing',
        p1Hp: 100000, p2Hp: 100000,
        p1Name: 'Joueur 1', p2Name: 'Joueur 2',
        p1History: [{ hp: 100000, delta: 0, ts: Date.now() }],
        p2History: [{ hp: 100000, delta: 0, ts: Date.now() }],
        createdAt: serverTimestamp()
    });
    lobbyNameInput.value = '';
    createBtn.disabled = false;
    openLobby(ref.id);
});
lobbyNameInput.addEventListener('keydown', e => { if (e.key === 'Enter') createBtn.click(); });

// ── OPEN LOBBY ──
function openLobby(id) {
    currentLobbyId = id;
    myRole = null;
    showRolePicker(id);
}

async function showRolePicker(id) {
    const snap = await getDoc(doc(db, 'lobbies', id));
    if (!snap.exists()) return;
    const data = snap.data();
    $('role-p1-sub').textContent = 'Joueur 1 - ' + fmt(data.p1Hp) + ' PV';
    $('role-p2-sub').textContent = 'Joueur 2 - ' + fmt(data.p2Hp) + ' PV';
    $('modal-role').style.display = 'flex';
    $('role-p1').childNodes[0].textContent = data.p1Name || 'Joueur 1';
    $('role-p2').childNodes[0].textContent = data.p2Name || 'Joueur 2';
}

function pickRole(role) {
    myRole = role;
    $('modal-role').style.display = 'none';
    enterLobby();
}

$('modal-role').addEventListener('click', e => {
  if (e.target === $('modal-role')) $('modal-role').style.display = 'none';
});

$('role-close').addEventListener('click', () => {
  $('modal-role').style.display = 'none';
});

$('role-p1').addEventListener('click', () => pickRole('p1'));
$('role-p2').addEventListener('click', () => pickRole('p2'));
$('role-spectator').addEventListener('click', () => pickRole('spectator'));

// ── ENTER LOBBY ──
function enterLobby() {
    showPage(lobbyPage);
    spectatorBanner.style.display = myRole === 'spectator' ? 'block' : 'none';
    meControls.style.display = myRole === 'spectator' ? 'none' : 'flex';

    if (lobbyUnsub) lobbyUnsub();
    lobbyUnsub = onSnapshot(doc(db, 'lobbies', currentLobbyId), snap => {
        if (!snap.exists()) { leaveLobby(); return; }
        cachedLobbyData = snap.data();
        renderLobby(cachedLobbyData);
        if ($('history-panel').classList.contains('open')) renderHistoryList();
    });
}

function renderLobby(data) {
    lobbyTitle.textContent = data.name;

    let myHp, oppHp, myName, oppName;
    if (myRole === 'p1' || myRole === 'spectator') {
        myHp = data.p1Hp; oppHp = data.p2Hp;
        myName = data.p1Name; oppName = data.p2Name;
    } else {
        myHp = data.p2Hp; oppHp = data.p1Hp;
        myName = data.p2Name; oppName = data.p1Name;
    }

    meHpEl.textContent = fmt(myHp);
    opponentHpEl.textContent = fmt(oppHp);
    meNameDisplay.textContent = myName || (myRole === 'p2' ? 'Joueur 2' : 'Joueur 1');
    opponentNameDisplay.textContent = oppName || (myRole === 'p2' ? 'Joueur 1' : 'Joueur 2');

    meHpEl.classList.toggle('dead', myHp <= 0);
    opponentHpEl.classList.toggle('dead', oppHp <= 0);
    $('zone-me').classList.toggle('dead', myHp <= 0);
    $('zone-opponent').classList.toggle('dead', oppHp <= 0);
}

// ── HP BUTTONS ──
$('btn-add').addEventListener('click', () => changeHp(+1));
$('btn-sub').addEventListener('click', () => changeHp(-1));

async function changeHp(sign) {
    if (!currentLobbyId || myRole === 'spectator') return;
    const amt = Math.max(1, parseInt(meAmountInput.value) || 500);
    const snap = await getDoc(doc(db, 'lobbies', currentLobbyId));
    if (!snap.exists()) return;
    const data = snap.data();

    const field = myRole === 'p1' ? 'p1Hp' : 'p2Hp';
    const histField = myRole === 'p1' ? 'p1History' : 'p2History';
    const delta = sign * amt;
    const newHp = Math.max(0, (data[field] || 0) + delta);
    const oppField = myRole === 'p1' ? 'p2Hp' : 'p1Hp';

    const update = {
        [field]: newHp,
        [histField]: arrayUnion({ hp: newHp, delta, ts: Date.now() }),
        status: (newHp <= 0 || (data[oppField] || 0) <= 0) ? 'finished' : 'ongoing'
    };
    await updateDoc(doc(db, 'lobbies', currentLobbyId), update);
}

// ── NAME EDIT ──
meNameDisplay.addEventListener('click', () => {
    if (myRole === 'spectator') return;
    $('edit-name-input').value = meNameDisplay.textContent;
    $('modal-name').style.display = 'flex';
    setTimeout(() => $('edit-name-input').focus(), 50);
});

$('edit-name-save').addEventListener('click', async () => {
    const name = $('edit-name-input').value.trim();
    if (!name || !currentLobbyId) { $('modal-name').style.display = 'none'; return; }
    const field = myRole === 'p1' ? 'p1Name' : 'p2Name';
    await updateDoc(doc(db, 'lobbies', currentLobbyId), { [field]: name });
    $('modal-name').style.display = 'none';
});
$('edit-name-cancel').addEventListener('click', () => { $('modal-name').style.display = 'none'; });
$('edit-name-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('edit-name-save').click(); });

// ── HISTORY ──
function openHistory(tab) {
    historyActiveTab = tab;
    updateHistoryTabs();
    renderHistoryList();
    $('history-panel').classList.add('open');
    $('history-overlay').classList.add('open');
}

function updateHistoryTabs() {
    $('tab-p1').classList.toggle('active', historyActiveTab === 'p1');
    $('tab-p2').classList.toggle('active', historyActiveTab === 'p2');
    if (cachedLobbyData) {
        $('tab-p1').textContent = cachedLobbyData.p1Name || 'Joueur 1';
        $('tab-p2').textContent = cachedLobbyData.p2Name || 'Joueur 2';
    }
}

function renderHistoryList() {
    if (!cachedLobbyData) return;
    const entries = (cachedLobbyData[historyActiveTab === 'p1' ? 'p1History' : 'p2History'] || []).slice();
    if (!entries.length) {
        $('history-list').innerHTML = '<div class="history-empty">Aucun historique</div>';
        return;
    }
    const list = $('history-list');
    list.innerHTML = entries.map((e, i) => {
        const isFirst = i === 0;
        const deltaHtml = isFirst
            ? '<span class="history-delta" style="color:var(--muted)">Départ</span>'
            : e.delta > 0
                ? `<span class="history-delta pos">+${fmt(e.delta)}</span>`
                : `<span class="history-delta neg">${fmt(e.delta)}</span>`;
        const time = new Date(e.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        return `<div class="history-entry">
      <span class="history-hp">${fmt(e.hp)}</span>
      ${deltaHtml}
      <span class="history-time">${time}</span>
    </div>`;
    }).join('');
}

function closeHistory() {
    $('history-panel').classList.remove('open');
    $('history-overlay').classList.remove('open');
}

$('history-btn-me').addEventListener('click', () => {
    historyActiveTab = myRole === 'p2' ? 'p2' : 'p1';
    openHistory(historyActiveTab);
});
$('history-btn-opponent').addEventListener('click', () => {
    historyActiveTab = myRole === 'p2' ? 'p1' : 'p2';
    openHistory(historyActiveTab);
});
$('tab-p1').addEventListener('click', () => { historyActiveTab = 'p1'; updateHistoryTabs(); renderHistoryList(); });
$('tab-p2').addEventListener('click', () => { historyActiveTab = 'p2'; updateHistoryTabs(); renderHistoryList(); });
$('history-close').addEventListener('click', closeHistory);
$('history-overlay').addEventListener('click', closeHistory);

// ── DELETE ──
async function triggerDelete() {
    const snap = await getDoc(doc(db, 'lobbies', currentLobbyId));
    if (!snap.exists()) return;
    if (snap.data().status === 'finished') {
        $('modal-confirm-delete').style.display = 'flex';
    } else {
        $('modal-warn-delete').style.display = 'flex';
    }
}

$('delete-lobby-btn').addEventListener('click', triggerDelete);

$('warn-delete-yes').addEventListener('click', () => {
    $('modal-warn-delete').style.display = 'none';
    $('modal-confirm-delete').style.display = 'flex';
});
$('warn-delete-no').addEventListener('click', () => { $('modal-warn-delete').style.display = 'none'; });

$('confirm-delete-yes').addEventListener('click', async () => {
    await deleteDoc(doc(db, 'lobbies', currentLobbyId));
    $('modal-confirm-delete').style.display = 'none';
    leaveLobby();
});
$('confirm-delete-no').addEventListener('click', () => { $('modal-confirm-delete').style.display = 'none'; });

// ── BACK ──
$('back-btn').addEventListener('click', leaveLobby);
function leaveLobby() {
    if (lobbyUnsub) { lobbyUnsub(); lobbyUnsub = null; }
    closeHistory();
    currentLobbyId = null;
    myRole = null;
    cachedLobbyData = null;
    showPage(homePage);
}

function esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
