const express = require('express');
const router = express.Router();
const pool = require('../../database/db');
const { authenticateToken } = require('../middleware/auth');
const paypal = require('../paypal');
const { v4: uuidv4 } = require('uuid');

// إنشاء عملية دفع
router.post('/create-payment', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.user;
    const { amount, currency = 'USD', description, investmentId } = req.body;

    const returnUrl = `${process.env.REACT_APP_API_URL}/api/paypal/execute?investmentId=${investmentId}`;
    const cancelUrl = `${process.env.REACT_APP_API_URL}/api/paypal/cancel`;

    const payment = await paypal.createPayment(
      amount,
      currency,
      returnUrl,
      cancelUrl,
      description
    );

    // حفظ معرف الدفع في قاعدة البيانات
    const transactionId = uuidv4();
    await pool.query(
      `INSERT INTO transactions (id, user_id, transaction_type, amount, currency, status, payment_method, external_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [transactionId, userId, 'payment', amount, currency, 'pending', 'paypal', payment.id]
    );

    // الحصول على رابط الموافقة
    const approvalUrl = payment.links.find(link => link.rel === 'approval_url');

    res.json({
      paymentId: payment.id,
      approvalUrl: approvalUrl.href,
      transactionId
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create payment' });
  }
});

// تنفيذ الدفع
router.get('/execute', async (req, res) => {
  try {
    const { paymentId, PayerID, investmentId } = req.query;

    if (!paymentId || !PayerID) {
      return res.status(400).json({ error: 'Missing payment or payer ID' });
    }

    // تنفيذ الدفع
    const executedPayment = await paypal.executePayment(paymentId, PayerID);

    if (executedPayment.state !== 'approved') {
      return res.status(400).json({ error: 'Payment not approved' });
    }

    // تحديث حالة المعاملة
    await pool.query(
      `UPDATE transactions SET status = $1, completed_at = NOW() WHERE external_id = $2`,
      ['completed', paymentId]
    );

    // تحديث حالة الاستثمار
    if (investmentId) {
      await pool.query(
        `UPDATE investments SET status = $1 WHERE id = $2`,
        ['confirmed', investmentId]
      );
    }

    // إعادة التوجيه إلى صفحة النجاح
    res.redirect(`${process.env.REACT_APP_API_URL}/payment-success?paymentId=${paymentId}`);
  } catch (error) {
    console.error(error);
    res.redirect(`${process.env.REACT_APP_API_URL}/payment-failed`);
  }
});

// إلغاء الدفع
router.get('/cancel', (req, res) => {
  res.redirect(`${process.env.REACT_APP_API_URL}/payment-cancelled`);
});

// Webhook للإشعارات
router.post('/webhook', express.json(), async (req, res) => {
  try {
    const event = req.body;

    console.log('PayPal webhook event:', event.event_type);

    switch (event.event_type) {
      case 'PAYMENT.SALE.COMPLETED':
        // معالجة إكمال الدفع
        console.log('Payment completed:', event.resource.id);
        break;

      case 'PAYMENT.SALE.DENIED':
        // معالجة رفض الدفع
        console.log('Payment denied:', event.resource.id);
        break;

      case 'PAYMENT.SALE.REFUNDED':
        // معالجة استرجاع الدفع
        console.log('Payment refunded:', event.resource.id);
        break;

      default:
        console.log('Unhandled event type:', event.event_type);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// الحصول على تفاصيل الدفع
router.get('/details/:paymentId', authenticateToken, async (req, res) => {
  try {
    const { paymentId } = req.params;

    const payment = await paypal.getPaymentDetails(paymentId);

    res.json(payment);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch payment details' });
  }
});

module.exports = router;
