# Quartiplay Deployment Guide

## ✅ GitHub Repository
- URL: https://github.com/itsAAA1/quartiplay
- Status: Ready for deployment

## 🚀 Render Backend Deployment

### Quick Start:
1. Visit: https://dashboard.render.com/new/web
2. Select: "Build and deploy from a Git repository"
3. Connect GitHub and select: itsAAA1/quartiplay
4. Configure:
   - **Name**: quartiplay-backend
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free
5. Click "Create Web Service"

### Environment Variables (add in Render dashboard):
```
NODE_ENV=production
DATABASE_URL=postgresql://user:password@host:5432/quartiplay
JWT_SECRET=your_jwt_secret_key_here
PAYPAL_CLIENT_ID=your_paypal_client_id
PAYPAL_CLIENT_SECRET=your_paypal_secret
STRIPE_SECRET_KEY=your_stripe_secret_key
TAP_SECRET_KEY=your_tap_secret_key
SKRILL_API_KEY=your_skrill_api_key
NETELLER_API_KEY=your_neteller_api_key
WISE_API_KEY=your_wise_api_key
```

**Expected URL**: `https://quartiplay-backend.onrender.com`

---

## 🎨 Vercel Frontend Deployment

### Quick Start:
1. Visit: https://vercel.com/new
2. Click "Import Git Repository"
3. Select: itsAAA1/quartiplay
4. Configure:
   - **Framework**: React
   - **Root Directory**: `client`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. Click "Deploy"

### Environment Variables (add in Vercel dashboard):
```
VITE_API_URL=https://quartiplay-backend.onrender.com
```

**Expected URL**: `https://quartiplay.vercel.app`

---

## 📊 Final URLs

| Component | URL |
|-----------|-----|
| GitHub Repository | https://github.com/itsAAA1/quartiplay |
| Backend (Render) | https://quartiplay-backend.onrender.com |
| Frontend (Vercel) | https://quartiplay.vercel.app |

---

## ⏱️ Deployment Time
- Render: ~5-10 minutes
- Vercel: ~3-5 minutes
- **Total**: ~10-15 minutes

---

## 🔧 Troubleshooting

### Backend won't start?
- Check environment variables are set correctly
- Check database connection string
- View logs in Render dashboard

### Frontend shows blank page?
- Check VITE_API_URL is correct
- Check browser console for errors
- Verify backend is running

### Payment integration not working?
- Verify all payment API keys are set
- Check payment provider dashboards
- Review error logs

---

## ✨ Project Features

✅ Investment Platform
✅ User Authentication
✅ Portfolio Management
✅ Payment Integration (PayPal, Stripe, Tap, Skrill, Neteller, Wise)
✅ Real-time Updates
✅ Admin Dashboard
✅ Analytics & Reporting

---

**Status**: Ready for deployment! 🚀
