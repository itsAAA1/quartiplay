const axios = require('axios');

const PAYPAL_API_BASE = process.env.PAYPAL_MODE === 'sandbox'
  ? 'https://api.sandbox.paypal.com'
  : 'https://api.paypal.com';

// الحصول على access token من PayPal
async function getAccessToken() {
  try {
    const auth = Buffer.from(
      `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
    ).toString('base64');

    const response = await axios.post(
      `${PAYPAL_API_BASE}/v1/oauth2/token`,
      'grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    return response.data.access_token;
  } catch (error) {
    console.error('Failed to get PayPal access token:', error);
    throw error;
  }
}

// إنشاء عملية دفع
async function createPayment(amount, currency, returnUrl, cancelUrl, description) {
  try {
    const accessToken = await getAccessToken();

    const payload = {
      intent: 'sale',
      payer: {
        payment_method: 'paypal'
      },
      transactions: [
        {
          amount: {
            total: amount.toFixed(2),
            currency: currency,
            details: {
              subtotal: amount.toFixed(2)
            }
          },
          description: description,
          invoice_number: `INV-${Date.now()}`
        }
      ],
      redirect_urls: {
        return_url: returnUrl,
        cancel_url: cancelUrl
      }
    };

    const response = await axios.post(
      `${PAYPAL_API_BASE}/v1/payments/payment`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error('Failed to create PayPal payment:', error);
    throw error;
  }
}

// تنفيذ عملية الدفع
async function executePayment(paymentId, payerId) {
  try {
    const accessToken = await getAccessToken();

    const response = await axios.post(
      `${PAYPAL_API_BASE}/v1/payments/payment/${paymentId}/execute`,
      { payer_id: payerId },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error('Failed to execute PayPal payment:', error);
    throw error;
  }
}

// الحصول على تفاصيل الدفع
async function getPaymentDetails(paymentId) {
  try {
    const accessToken = await getAccessToken();

    const response = await axios.get(
      `${PAYPAL_API_BASE}/v1/payments/payment/${paymentId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error('Failed to get PayPal payment details:', error);
    throw error;
  }
}

// إنشاء عملية دفع متكررة (اشتراك)
async function createBillingPlan(name, description, amount, currency, interval, frequency) {
  try {
    const accessToken = await getAccessToken();

    const payload = {
      name: name,
      description: description,
      type: 'REGULAR',
      payment_definitions: [
        {
          name: name,
          type: 'REGULAR',
          payment_frequency: interval,
          frequency_interval: frequency.toString(),
          amount: {
            value: amount.toFixed(2),
            currency: currency
          }
        }
      ],
      merchant_preferences: {
        setup_fee: {
          value: '0',
          currency: currency
        },
        return_url: `${process.env.REACT_APP_API_URL}/api/paypal/subscribe/return`,
        cancel_url: `${process.env.REACT_APP_API_URL}/api/paypal/subscribe/cancel`,
        notify_url: `${process.env.REACT_APP_API_URL}/api/paypal/webhook`,
        max_fail_attempts: '3',
        initial_fail_amount_action: 'CANCEL'
      }
    };

    const response = await axios.post(
      `${PAYPAL_API_BASE}/v1/payments/billing-plans/`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error('Failed to create billing plan:', error);
    throw error;
  }
}

// تفعيل خطة الفواتير
async function activateBillingPlan(planId) {
  try {
    const accessToken = await getAccessToken();

    await axios.patch(
      `${PAYPAL_API_BASE}/v1/payments/billing-plans/${planId}`,
      [
        {
          op: 'replace',
          path: '/',
          value: {
            state: 'ACTIVE'
          }
        }
      ],
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return { success: true };
  } catch (error) {
    console.error('Failed to activate billing plan:', error);
    throw error;
  }
}

module.exports = {
  getAccessToken,
  createPayment,
  executePayment,
  getPaymentDetails,
  createBillingPlan,
  activateBillingPlan
};
