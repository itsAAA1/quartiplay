# منصة Quartiplay - النشر المجاني الكامل

## الخطوة 1: إنشاء حسابات مجانية

### 1.1 Render (استضافة مجانية)
- اذهب إلى https://render.com
- سجل حساب جديد (مجاني)
- ربط حسابك على GitHub

### 1.2 Railway (قاعدة بيانات مجانية)
- اذهب إلى https://railway.app
- سجل حساب جديد (مجاني)
- ربط حسابك على GitHub

### 1.3 Freenom (نطاق مجاني)
- اذهب إلى https://www.freenom.com
- سجل حساب جديد
- اختر نطاق مجاني (.tk, .ml, .ga)
- مثال: quartiplay.tk

---

## الخطوة 2: إعداد GitHub

```bash
# 1. إنشاء مستودع جديد على GitHub
# اذهب إلى https://github.com/new
# أنشئ مستودع باسم "quartiplay"

# 2. رفع الكود
cd /home/ubuntu/quartiplay
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/quartiplay.git
git push -u origin main
```

---

## الخطوة 3: نشر الخادم على Render

### 3.1 إنشاء Web Service
1. اذهب إلى Render Dashboard
2. اضغط "New +" → "Web Service"
3. اختر مستودع GitHub "quartiplay"
4. ملء البيانات:
   - **Name**: quartiplay-server
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server/index.js`
   - **Plan**: Free

### 3.2 إضافة متغيرات البيئة
```
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:password@db:5432/quartiplay
JWT_SECRET=your_jwt_secret_key
PAYPAL_CLIENT_ID=your_paypal_client_id
PAYPAL_CLIENT_SECRET=your_paypal_secret
PAYPAL_MODE=sandbox
PAYPAL_MERCHANT_ID=9MB8UE8YP5NJJ
PAYPAL_EMAIL=abdullateef_404@hotmail.com
SKRILL_API_URL=https://api.skrill.com
SKRILL_MERCHANT_EMAIL=abdullateef_404@hotmail.com
NETELLER_API_URL=https://api.neteller.com
NETELLER_MERCHANT_EMAIL=abdullateef_404@hotmail.com
WISE_API_URL=https://api.wise.com
```

---

## الخطوة 4: نشر قاعدة البيانات على Railway

### 4.1 إنشاء PostgreSQL Database
1. اذهب إلى Railway Dashboard
2. اضغط "New Project"
3. اختر "Provision PostgreSQL"
4. اختر "Free" plan

### 4.2 الحصول على Connection String
1. انسخ `DATABASE_URL`
2. أضفها في متغيرات Render

### 4.3 إنشاء الجداول
```bash
# استخدم psql أو أي أداة أخرى
psql $DATABASE_URL < database/migrations.sql
```

---

## الخطوة 5: نشر الواجهة الأمامية على Vercel

### 5.1 إنشاء Vercel Project
1. اذهب إلى https://vercel.com
2. اضغط "New Project"
3. اختر مستودع GitHub "quartiplay"
4. اختر "client" كـ root directory

### 5.2 إضافة متغيرات البيئة
```
REACT_APP_API_URL=https://quartiplay-server.onrender.com
REACT_APP_PAYPAL_CLIENT_ID=your_paypal_client_id
```

### 5.3 النشر
- اضغط "Deploy"
- انتظر الانتهاء
- ستحصل على رابط مثل: quartiplay.vercel.app

---

## الخطوة 6: ربط النطاق المجاني

### 6.1 في Freenom
1. اذهب إلى "My Domains"
2. اختر النطاق الذي أنشأته
3. اذهب إلى "Management Tools" → "Nameservers"
4. غير الـ Nameservers إلى:
   - `ns1.vercel-dns.com`
   - `ns2.vercel-dns.com`

### 6.2 في Vercel
1. اذهب إلى Project Settings
2. اختر "Domains"
3. أضف النطاق المجاني
4. انتظر التحقق (15-30 دقيقة)

---

## الخطوة 7: تفعيل HTTPS

### 7.1 في Render
- HTTPS مفعل افتراضياً
- الرابط: https://quartiplay-server.onrender.com

### 7.2 في Vercel
- HTTPS مفعل افتراضياً
- الرابط: https://quartiplay.tk

---

## الخطوة 8: اختبار المنصة

```bash
# اختبر الخادم
curl https://quartiplay-server.onrender.com/health

# اختبر الواجهة الأمامية
# افتح https://quartiplay.tk في المتصفح
```

---

## الملخص النهائي

```
✅ الخادم: https://quartiplay-server.onrender.com
✅ الواجهة: https://quartiplay.tk
✅ قاعدة البيانات: PostgreSQL على Railway
✅ النطاق: مجاني من Freenom
✅ كل شي مجاني 100%
```

---

## ملاحظات مهمة

1. **الخطة المجانية محدودة:**
   - Render: تنام بعد 15 دقيقة عدم استخدام
   - Railway: 5 دولار شهري مجاني ثم مدفوع
   - Vercel: مجاني للأبد

2. **للإنتاج الحقيقي:**
   - استخدم خطط مدفوعة
   - أضف CDN
   - أضف Monitoring

3. **الأمان:**
   - غير كل كلمات السر
   - استخدم متغيرات البيئة
   - فعّل HTTPS

---

## الدعم

إذا واجهت مشكلة:
1. تحقق من logs في Render
2. تحقق من Database Connection
3. تحقق من Environment Variables
4. تحقق من CORS Settings

---

**المنصة جاهزة للإطلاق!** 🚀
