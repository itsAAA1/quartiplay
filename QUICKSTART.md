# البدء السريع - منصة Quartiplay

## ⚡ البدء في 5 دقائق

### 1️⃣ استنساخ المشروع
```bash
git clone <repository-url>
cd quartiplay
```

### 2️⃣ إعداد البيئة
```bash
cp .env.example .env
```

### 3️⃣ تثبيت المكتبات
```bash
npm install
```

### 4️⃣ تشغيل مع Docker
```bash
docker-compose up -d
```

### 5️⃣ الوصول للتطبيق
- **الخادم**: http://localhost:3000
- **الواجهة الأمامية**: http://localhost:5173
- **قاعدة البيانات**: localhost:5432

---

## 📋 المتطلبات

- Docker و Docker Compose (أسهل)
- أو: Node.js 18+ و PostgreSQL 12+

---

## 🔑 المفاتيح المطلوبة

في ملف `.env`:

```
PAYPAL_CLIENT_ID=your_paypal_client_id
PAYPAL_CLIENT_SECRET=your_paypal_client_secret
JWT_SECRET=your_jwt_secret
```

---

## ✅ الفحص

```bash
# الخادم
curl http://localhost:3000/health

# قاعدة البيانات
docker-compose exec postgres psql -U postgres -d quartiplay -c "SELECT COUNT(*) FROM users;"
```

---

## 🚀 الخطوات التالية

1. أنشئ حساب مستثمر
2. أنشئ حساب شركة
3. أنشئ فرصة استثمارية
4. ابدأ الاستثمار
5. تتبع العوائد

---

## 📚 الموارد

- [دليل النشر الكامل](./DEPLOYMENT.md)
- [README](./README.md)
- [API Documentation](./API.md)

---

للمساعدة: support@quartiplay.com
