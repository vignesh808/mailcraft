import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, addDoc, query, orderBy, limit, getDocs, deleteDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDOg1gHgirlQzgBtm3pi2z0Pg8k0GoYkTw",
  authDomain: "mailcraft-a693a.firebaseapp.com",
  projectId: "mailcraft-a693a",
  storageBucket: "mailcraft-a693a.firebasestorage.app",
  messagingSenderId: "387529543581",
  appId: "1:387529543581:web:d4ddc406cadbea9462e974",
  measurementId: "G-HW4LESVRF9"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

window._auth = auth;
window._db   = db;

// ── Dropdown (defined first so it's available everywhere) ───────
window.closeDropdown = function() {
  document.getElementById('user-dropdown')?.classList.remove('open');
};

// ── Google Sign In ──────────────────────────────────────────────
document.getElementById('google-login-btn').addEventListener('click', async () => {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    console.error('Login error:', err);
    showToast('Login failed. Please try again.');
  }
});

// ── Auth State ──────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (user) {
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('app-page').style.display   = 'block';

    document.getElementById('user-avatar').src = user.photoURL || '';
    document.getElementById('user-name').textContent = user.displayName?.split(' ')[0] || 'User';

    const userRef  = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      await setDoc(userRef, {
        email: user.email,
        name: user.displayName,
        isPro: false,
        usageCount: 0,
        createdAt: serverTimestamp()
      });
    }

    window._currentUser = user;
    window._userRef     = userRef;

    await loadUserData();
  } else {
    document.getElementById('login-page').style.display = 'flex';
    document.getElementById('app-page').style.display   = 'none';
    window._currentUser = null;
  }
});

// ── Load User Data ──────────────────────────────────────────────
async function loadUserData() {
  const userSnap = await getDoc(window._userRef);
  const data = userSnap.data();
  window._userData = data;
  updateUsageBadge(data);
  await loadHistory();
}

function updateUsageBadge(data) {
  const badge = document.getElementById('usage-badge');
  if (!badge) return;
  if (data.isPro) {
    badge.textContent = '✦ Pro — unlimited';
    badge.classList.add('pro');
  } else {
    const left = Math.max(0, 5 - (data.usageCount || 0));
    badge.textContent = `${left} free email${left !== 1 ? 's' : ''} left`;
    badge.classList.toggle('low', left <= 1);
  }
}

window.updateUsageBadgeFromData = updateUsageBadge;

// ── Save Email to History ───────────────────────────────────────
window.saveEmailToHistory = async function(subject, body, prospect, company, tone) {
  if (!window._currentUser) return;
  const histRef = collection(db, 'users', window._currentUser.uid, 'emails');
  await addDoc(histRef, {
    subject, body, prospect, company, tone,
    createdAt: serverTimestamp()
  });
  await loadHistory();
};

// ── Load History ────────────────────────────────────────────────
async function loadHistory() {
  if (!window._currentUser) return;
  const histRef  = collection(db, 'users', window._currentUser.uid, 'emails');
  const q        = query(histRef, orderBy('createdAt', 'desc'), limit(20));
  const snap     = await getDocs(q);
  const grid     = document.getElementById('history-grid');
  const empty    = document.getElementById('history-empty');
  const clearBtn = document.getElementById('clear-btn');

  grid.querySelectorAll('.history-card').forEach(c => c.remove());

  if (snap.empty) {
    empty.style.display    = 'block';
    clearBtn.style.display = 'none';
    return;
  }

  empty.style.display    = 'none';
  clearBtn.style.display = 'inline-block';

  snap.forEach(docSnap => {
    const d    = docSnap.data();
    const card = document.createElement('div');
    card.className = 'history-card';
    const date = d.createdAt?.toDate
      ? d.createdAt.toDate().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
      : '';
    card.innerHTML = `
      <div class="hc-meta">${d.prospect || ''} · ${d.company || ''} <span class="hc-tone">${d.tone || ''}</span></div>
      <div class="hc-subject">${d.subject || ''}</div>
      <div class="hc-body">${(d.body || '').slice(0, 120)}...</div>
      <div class="hc-footer">
        <span class="hc-date">${date}</span>
        <button class="hc-copy" onclick="copyHistoryEmail('${docSnap.id}')">Copy</button>
      </div>
    `;
    card.dataset.id      = docSnap.id;
    card.dataset.subject = d.subject || '';
    card.dataset.body    = d.body    || '';
    grid.appendChild(card);
  });

  window._historyDocs = {};
  snap.forEach(d => { window._historyDocs[d.id] = d.data(); });
}

window.copyHistoryEmail = function(id) {
  const d = window._historyDocs?.[id];
  if (!d) return;
  navigator.clipboard.writeText(`Subject: ${d.subject}\n\n${d.body}`)
    .then(() => showToast('Email copied!'));
};

// ── Clear History ───────────────────────────────────────────────
window.clearHistory = async function() {
  if (!window._currentUser || !confirm('Clear all email history?')) return;
  const histRef = collection(db, 'users', window._currentUser.uid, 'emails');
  const snap    = await getDocs(histRef);
  await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
  await loadHistory();
  showToast('History cleared.');
};

// ── Increment Usage ─────────────────────────────────────────────
window.incrementUsageInDB = async function() {
  if (!window._currentUser || !window._userRef) return;
  const snap     = await getDoc(window._userRef);
  const data     = snap.data();
  const newCount = (data.usageCount || 0) + 1;
  await updateDoc(window._userRef, { usageCount: newCount });
  window._userData = { ...data, usageCount: newCount };
  updateUsageBadge(window._userData);
  return newCount;
};

// ── Check Limit ─────────────────────────────────────────────────
window.checkUsageLimit = async function() {
  if (!window._userRef) return false;
  const snap = await getDoc(window._userRef);
  const data = snap.data();
  window._userData = data;
  if (data.isPro) return true;
  return (data.usageCount || 0) < 5;
};

// ── Logout ──────────────────────────────────────────────────────
window.logout = async function() {
  await signOut(auth);
  closeDropdown();
};

// ── User Menu Dropdown ──────────────────────────────────────────
document.getElementById('user-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('user-dropdown').classList.toggle('open');
});

document.addEventListener('click', closeDropdown);
