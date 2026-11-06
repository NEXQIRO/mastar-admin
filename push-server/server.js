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

// Render এর জন্য হেলথ চেক
http.createServer((q, r) => { r.writeHead(200); r.end('NP push server ok'); })
  .listen(process.env.PORT || 3000);
