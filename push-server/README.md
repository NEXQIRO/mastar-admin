# NP Admin Push Server (অ্যাপ বন্ধ থাকলেও নোটিফিকেশন)

## ১) Firebase এ
1. Project settings → **Cloud Messaging** → **Web Push certificates** → **Generate key pair**।
2. ওই Key pair (লম্বা কোড) `admin.html` এর `FCM_VAPID_KEY = ''` এর ভেতরে বসান।
3. Realtime Database → Rules এ নতুন `database.rules.json` পাবলিশ করুন।
4. Project settings → **Service accounts** → **Generate new private key** (JSON ফাইল নামান)।

## ২) Render এ
1. এই `push-server` ফোল্ডারটা GitHub রিপোতে দিন (বা আলাদা রিপো)।
2. Render → New → **Web Service** (অথবা Background Worker), Build: `npm install`, Start: `npm start`।
3. Environment variables:
   - `FIREBASE_SERVICE_ACCOUNT` = সার্ভিস অ্যাকাউন্ট JSON ফাইলের পুরো লেখা
   - `FIREBASE_DATABASE_URL` = আপনার Realtime Database URL (না দিলে project_id থেকে ধরে নেবে)
4. ⚠ Render ফ্রি Web Service ১৫ মিনিট কেউ না ডাকলে ঘুমিয়ে যায়, তখন নোটিফিকেশন আসে না।
   তাই Starter (পেইড) নিন, অথবা UptimeRobot দিয়ে প্রতি ৫ মিনিটে সার্ভিসের লিংকে পিং করুন।

## ৩) অ্যাডমিনের ফোনে
1. `admin.html` লিংক খুলে **📲 অ্যাপ ইনস্টল করুন** চাপুন।
2. ইনস্টল করা অ্যাপ খুলে **🔔 নোটিফিকেশন চালু করুন** চাপুন, Allow দিন।
3. iPhone এ শুধু ইনস্টল করা (Home Screen) অ্যাপে নোটিফিকেশন কাজ করে (iOS 16.4+)।
