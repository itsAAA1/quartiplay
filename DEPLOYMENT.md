# دليل النشر السريع - منصة Quartiplay

## 🚀 النشر المحلي (Local)

### المتطلبات:
- Node.js 18+
- PostgreSQL 12+
- npm أو yarn

### الخطوات:

1. **استنساخ المستودع**
```bash
git clone <repository-url>
cd quartiplay
```

2. **إعداد متغيرات البيئة**
```bash
cp .env.example .env
# عدّل .env بمعلومات قاعدة البيانات والمفاتيح
```

3. **تثبيت المكتبات**
```bash
npm install
cd client && npm install
cd ..
```

4. **إنشاء قاعدة البيانات**
```bash
psql -U postgres -d quartiplay -f database/migrations.sql
```

5. **تشغيل الخادم**
```bash
npm start
```

6. **تشغيل الواجهة الأمامية (في نافذة أخرى)**
```bash
cd client
npm run dev
```

---

## 🐳 النشر مع Docker

### المتطلبات:
- Docker
- Docker Compose

### الخطوات:

1. **إعداد متغيرات البيئة**
```bash
cp .env.example .env
# عدّل .env بمعلومات المفاتيح
```

2. **بدء الخدمات**
```bash
docker-compose up -d
```

3. **التحقق من الخدمات**
```bash
docker-compose ps
```

4. **عرض السجلات**
```bash
docker-compose logs -f
```

5. **إيقاف الخدمات**
```bash
docker-compose down
```

---

## ☁️ النشر على الإنترنت

### الخيار 1: Heroku

1. **تثبيت Heroku CLI**
```bash
npm install -g heroku
heroku login
```

2. **إنشاء تطبيق**
```bash
heroku create quartiplay
```

3. **إضافة متغيرات البيئة**
```bash
heroku config:set JWT_SECRET=your_secret
heroku config:set PAYPAL_CLIENT_ID=your_client_id
heroku config:set PAYPAL_CLIENT_SECRET=your_secret
# ... إضافة المتغيرات الأخرى
```

4. **النشر**
```bash
git push heroku main
```

---

### الخيار 2: Railway

1. **اذهب إلى railway.app**
2. **اختر "New Project"**
3. **اختر "Deploy from GitHub"**
4. **اختر المستودع**
5. **أضف متغيرات البيئة**
6. **انقر "Deploy"**

---

### الخيار 3: Render

1. **اذهب إلى render.com**
2. **اختر "New Web Service"**
3. **اختر المستودع من GitHub**
4. **أضف متغيرات البيئة**
5. **انقر "Create Web Service"**

---

### الخيار 4: DigitalOcean App Platform

1. **اذهب إلى cloud.digitalocean.com**
2. **اختر "Apps"**
3. **اختر "Create App"**
4. **اختر المستودع من GitHub**
5. **أضف متغيرات البيئة**
6. **انقر "Deploy"**

---

## 🔒 الأمان

### قبل النشر:

1. **تحديث متغيرات البيئة**
   - غيّر `JWT_SECRET`
   - غيّر `SESSION_SECRET`
   - أضف مفاتيح PayPal الحقيقية
   - أضف مفاتيح Stripe الحقيقية

2. **تفعيل HTTPS**
   - استخدم Let's Encrypt
   - استخدم CloudFlare

3. **تفعيل جدار الحماية**
   - حد من عدد الطلبات
   - حد من حجم الطلبات
   - حد من عناوين IP

4. **تفعيل المراقبة**
   - استخدم Sentry للأخطاء
   - استخدم DataDog للأداء
   - استخدم LogRocket للجلسات

---

## 📊 المراقبة

### الصحة:
```bash
curl http://localhost:3000/health
```

### السجلات:
```bash
docker-compose logs -f server
docker-compose logs -f client
docker-compose logs -f postgres
```

### الأداء:
```bash
docker stats
```

---

## 🔄 التحديثات

### تحديث الكود:
```bash
git pull origin main
docker-compose up -d --build
```

### تحديث قاعدة البيانات:
```bash
docker-compose exec postgres psql -U postgres -d quartiplay -f /database/migrations.sql
```

---

## 🆘 استكشاف الأخطاء

### المشكلة: قاعدة البيانات لا تتصل
```bash
docker-compose logs postgres
docker-compose restart postgres
```

### المشكلة: الخادم لا يبدأ
```bash
docker-compose logs server
docker-compose restart server
```

### المشكلة: الواجهة الأمامية لا تحمل
```bash
docker-compose logs client
docker-compose restart client
```

---

## 📝 ملاحظات مهمة

- تأكد من أن جميع متغيرات البيئة مضبوطة بشكل صحيح
- استخدم HTTPS في الإنتاج
- استخدم قاعدة بيانات منفصلة للإنتاج
- استخدم CDN للملفات الثابتة
- استخدم نسخ احتياطية يومية
- استخدم المراقبة والتنبيهات

---

## 🎯 الخطوات التالية

1. اختبر التطبيق محلياً
2. انشر على بيئة التطوير
3. اختبر على بيئة التطوير
4. انشر على بيئة الإنتاج
5. راقب الأداء والأخطاء
6. حسّن بناءً على البيانات

---

للمساعدة: support@quartiplay.com
