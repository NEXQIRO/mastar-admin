// NP Admin Push Server
// নতুন ডিপোজিট/উইথড্র রিকোয়েস্ট এলে সব অ্যাডমিনের ফোনে (অ্যাপ বন্ধ থাকলেও) পুশ নোটিফিকেশন পাঠায়।
const admin = require('firebase-admin');
const http = require('http');

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
if (!sa.project_id) { console.error('FIREBASE_SERVICE_ACCOUNT env সেট করা নেই'); process.exit(1); }

admin.initializeApp({
  credential: admin.credential.cert(sa),
  databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${sa.project_id}-default-rtdb.firebaseio.com`
});
const db = admin.database();
const seen = new Set();

async function allTokens() {
  const snap = await db.ref('adminFcmTokens').once('value');
  const list = [];
  snap.forEach(u => { u.forEach(t => { list.push({ uid: u.key, token: t.key }); }); });
  return list;
}

async function send(kind, id, r) {
  const list = await allTokens();
  if (!list.length) return;
  const isDep = kind === 'deposit';
  const data = {
    title: isDep ? '📥 নতুন ডিপোজিট রিকোয়েস্ট' : '📤 নতুন উইথড্র রিকোয়েস্ট',
    body: `${r.userName || 'ইউজার'} — ৳${r.amount || 0}`,
    tag: 'req-' + id,
    view: 'view-wallet'
  };
  const res = await admin.messaging().sendEachForMulticast({
    tokens: list.map(x => x.token),
    data,
    webpush: { headers: { Urgency: 'high', TTL: '86400' } },
    android: { priority: 'high' }
  });
  // অচল টোকেন মুছে ফেলা
  const dead = [];
  res.responses.forEach((x, i) => {
    if (!x.success && x.error && /registration-token-not-registered|invalid-argument|invalid-registration-token/.test(x.error.code || '')) dead.push(list[i]);
  });
  await Promise.all(dead.map(d => db.ref(`adminFcmTokens/${d.uid}/${d.token}`).remove().catch(() => {})));
  console.log(`[${kind}] ${id}: sent ${res.successCount}/${list.length}`);
}

function watch(path, kind) {
  const ref = db.ref(path);
  ref.once('value').then(s => {
    s.forEach(c => { seen.add(path + '/' + c.key); });           // আগের রিকোয়েস্টে পুশ যাবে না
    ref.on('child_added', snap => {
      const key = path + '/' + snap.key;
      if (seen.has(key)) return;
      seen.add(key);
      const r = snap.val() || {};
      if (String(r.status || '').toLowerCase() !== 'pending') return;
      send(kind, snap.key, r).catch(e => console.error('send error:', e.message));
    });
    console.log('watching', path);
  });
}

watch('depositRequests', 'deposit');
watch('withdrawalRequests', 'withdrawal');

// ===== Deposit Promotion & Bonus (সার্ভার-সাইড, অ্যাটমিক) =====
// অ্যাডমিন ডিপোজিট Approve করলে বোনাস একবারই যোগ হয়; প্রথম গেম সেশনের ১০ মিনিট পর টার্নওভার সক্রিয় হয়।
const PROMO_DELAY = 10 * 60 * 1000;
const inc = (n) => admin.database.ServerValue.increment(n);
const nz = (v) => Number(v) || 0;
const promoBusy = new Set();
const userWatch = {};
let claims = {};

async function processPromo(depId, dep, recover) {
  if (!dep || !dep.promoId || String(dep.status || '').toLowerCase() !== 'approved') return;
  const resume = recover && dep.promoState === 'Processing';
  if (dep.promoState && !resume) return;
  if (promoBusy.has(depId)) return;
  promoBusy.add(depId);
  try {
    if (!resume) {
      const lk = await db.ref(`depositRequests/${depId}/promoState`).transaction(c => (c === null ? 'Processing' : undefined));
      if (!lk.committed) return;
    }
    const [pS, uS] = await Promise.all([db.ref('depositPromotions/' + dep.promoId).once('value'), db.ref('users/' + dep.uid).once('value')]);
    const p = pS.val(), u = uS.val() || {};
    const amt = nz(dep.amount), at = nz(dep.createdAt);
    const bonus = p ? (p.bonusType === 'fixed' ? nz(p.bonusValue) : Math.round(amt * nz(p.bonusValue) / 100)) : 0;
    let why = '';
    if (!p) why = 'অফার পাওয়া যায়নি';
    else if (p.active !== true) why = 'অফার নিষ্ক্রিয়';
    else if ((p.startAt && at < nz(p.startAt)) || (p.endAt && at > nz(p.endAt))) why = 'অফারের সময়সীমার বাইরে';
    else if (amt < nz(p.minDeposit) || amt > nz(p.maxDeposit)) why = 'ডিপোজিট সীমার বাইরে';
    else if (u.adminUid && p.adminOff && p.adminOff[u.adminUid] === true) why = 'অ্যাডমিন অফারটি বন্ধ রেখেছেন';
    else if (nz(dep.bonusAmount) > 0) why = 'পুরোনো বোনাস ইতিমধ্যে যুক্ত';
    else if (bonus <= 0) why = 'বোনাস ০';
    if (why) {
      await db.ref(`depositRequests/${depId}`).update({ promoState: 'Invalid', promoNote: why });
      console.log(`[promo] ${depId}: invalid (${why})`);
      return;
    }
    const turnover = Math.round((amt + bonus) * nz(p.turnoverMultiplier));
    const key = db.ref('transactions').push().key;
    const bal = nz(u.balance);
    await db.ref().update({
      [`users/${dep.uid}/balance`]: inc(bonus),
      [`users/${dep.uid}/bonusBalance`]: inc(bonus),
      [`transactions/${key}`]: {
        trxId: key, uid: dep.uid, type: 'PROMO_BONUS', amount: bonus, depositId: depId, promoId: dep.promoId,
        beforeBal: bal, afterBal: bal + bonus, date: new Date().toLocaleString('bn-BD'),
        timestamp: admin.database.ServerValue.TIMESTAMP, note: `${p.name} — ডিপোজিট বোনাস (টার্নওভার ৳${turnover})`
      },
      [`promoTurnover/${dep.uid}/${depId}`]: {
        promoId: dep.promoId, promoName: p.name, deposit: amt, bonus, turnover, done: 0, status: 'pending',
        createdAt: admin.database.ServerValue.TIMESTAMP
      },
      [`depositRequests/${depId}/promoBonus`]: bonus,
      [`depositRequests/${depId}/promoTurnover`]: turnover,
      [`depositRequests/${depId}/promoState`]: 'Credited'
    });
    console.log(`[promo] ${depId}: +৳${bonus}, turnover ৳${turnover}`);
  } catch (e) {
    console.error('promo error:', depId, e.message);
  } finally {
    promoBusy.delete(depId);
  }
}

async function activateClaim(uid, id) {
  const k = uid + '/' + id;
  if (promoBusy.has('a:' + k)) return;
  promoBusy.add('a:' + k);
  try {
    const ref = db.ref(`promoTurnover/${k}`);
    const t = await ref.child('status').transaction(c => ((c === 'pending' || c === 'activating') ? 'activating' : undefined));
    if (!t.committed) return;
    const c = (await ref.once('value')).val() || {};
    const u = (await db.ref('users/' + uid).once('value')).val() || {};
    const cur = nz(u.turnoverDone !== undefined ? u.turnoverDone : u.turnoverCompleted);
    // আগের সব শর্ত (পুরোনো + আগের প্রোমো) পূরণের পর থেকে এই প্রোমোর টার্নওভার গোনা শুরু হবে
    const base = Math.max(cur, nz(u.turnoverRequired));
    await db.ref().update({
      [`promoTurnover/${k}/status`]: 'active',
      [`promoTurnover/${k}/baseDone`]: base,
      [`promoTurnover/${k}/activatedAt`]: admin.database.ServerValue.TIMESTAMP,
      [`users/${uid}/turnoverRequired`]: inc(nz(c.turnover))
    });
    console.log(`[promo] activated ${k}`);
  } catch (e) {
    console.error('activate error:', e.message);
  } finally {
    promoBusy.delete('a:' + k);
  }
}

function evalUser(uid, u) {
  const cur = nz(u.turnoverDone !== undefined ? u.turnoverDone : u.turnoverCompleted);
  Object.values(claims).filter(c => c.uid === uid && c.status === 'active').forEach(c => {
    const t = nz(c.turnover), d = Math.min(t, Math.max(0, cur - nz(c.baseDone)));
    if (d === nz(c.done) && d < t) return;
    const up = { [`promoTurnover/${uid}/${c.id}/done`]: d };
    if (d >= t) { up[`promoTurnover/${uid}/${c.id}/status`] = 'completed'; up[`promoTurnover/${uid}/${c.id}/completedAt`] = admin.database.ServerValue.TIMESTAMP; }
    db.ref().update(up).catch(e => console.error('progress error:', e.message));
  });
}

function syncClaims(snap) {
  const all = snap.val() || {};
  claims = {};
  Object.keys(all).forEach(uid => Object.keys(all[uid] || {}).forEach(id => { claims[uid + '/' + id] = Object.assign({}, all[uid][id], { uid, id }); }));
  const need = new Set(Object.values(claims).filter(c => c.status === 'active').map(c => c.uid));
  need.forEach(uid => {
    if (!userWatch[uid]) { userWatch[uid] = db.ref('users/' + uid); userWatch[uid].on('value', s => evalUser(uid, s.val() || {})); }
  });
  Object.keys(userWatch).forEach(uid => { if (!need.has(uid)) { userWatch[uid].off(); delete userWatch[uid]; } });
  Object.values(claims).forEach(c => { if (c.status === 'activating') activateClaim(c.uid, c.id); });
}

function onSession(s) {
  if (!s || !s.uid) return;
  const ts = nz(s.startServerAt) || nz(s.startTime) || Date.now();
  Object.values(claims).filter(c => c.uid === s.uid && c.status === 'pending' && !c.activateAt && ts >= nz(c.createdAt) - 1000).forEach(c => {
    db.ref(`promoTurnover/${c.uid}/${c.id}`).transaction(x => ((x && x.status === 'pending' && !x.activateAt) ? Object.assign({}, x, { firstGameAt: ts, activateAt: ts + PROMO_DELAY }) : undefined))
      .catch(e => console.error('timer error:', e.message));
  });
}

db.ref('promoTurnover').on('value', syncClaims);
db.ref('game_sessions').orderByChild('startTime').startAt(Date.now() - 60000).on('child_added', s => onSession(s.val()));
db.ref('depositRequests').on('child_changed', s => { processPromo(s.key, s.val() || {}, false); });
db.ref('depositRequests').limitToLast(300).once('value').then(s => {
  s.forEach(c => { const v = c.val() || {}; if (v.promoId) processPromo(c.key, v, true); });
});
setInterval(() => {
  const n = Date.now();
  Object.values(claims).forEach(c => { if (c.status === 'pending' && c.activateAt && n >= nz(c.activateAt)) activateClaim(c.uid, c.id); });
}, 15000);

// Render এর জন্য হেলথ চেক
http.createServer((q, r) => { r.writeHead(200); r.end('NP push server ok'); })
  .listen(process.env.PORT || 3000);
