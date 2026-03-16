/**
 * Skrill Integration Module
 * Handles all Skrill payment operations
 */

const axios = require('axios');
const crypto = require('crypto');

class SkrillPayment {
  constructor() {
    this.apiUrl = process.env.SKRILL_API_URL || 'https://api.skrill.com';
    this.merchantEmail = process.env.SKRILL_MERCHANT_EMAIL;
    this.merchantId = process.env.SKRILL_MERCHANT_ID;
    this.apiPassword = process.env.SKRILL_API_PASSWORD;
    this.apiKey = process.env.SKRILL_API_KEY;
  }

  /**
   * Create a payment session
   */
  async createPayment(paymentData) {
    try {
      const payload = {
        merchant_email: this.merchantEmail,
        merchant_id: this.merchantId,
        transaction_id: paymentData.transactionId,
        amount: paymentData.amount,
        currency: paymentData.currency || 'USD',
        customer_email: paymentData.customerEmail,
        customer_name: paymentData.customerName,
        language: 'en',
        return_url: paymentData.returnUrl,
        cancel_url: paymentData.cancelUrl,
        status_url: paymentData.statusUrl,
        logo_url: paymentData.logoUrl,
        prepare_only: 0,
        payment_methods: 'ACC,WLT,VSA,VMA,MSC,AMX,DIN,JCB,MAE',
      };

      // Generate signature
      payload.md5sig = this.generateSignature(payload);

      const response = await axios.post(`${this.apiUrl}/payment`, payload);
      return response.data;
    } catch (error) {
      console.error('Skrill Payment Error:', error);
      throw new Error('Failed to create Skrill payment');
    }
  }

  /**
   * Transfer funds to user
   */
  async transferFunds(transferData) {
    try {
      const payload = {
        action: 'transfer',
        merchant_email: this.merchantEmail,
        merchant_id: this.merchantId,
        to_email: transferData.toEmail,
        amount: transferData.amount,
        currency: transferData.currency || 'USD',
        customer_id: transferData.customerId,
        note: transferData.note || 'Investment Return',
      };

      // Generate signature
      payload.md5sig = this.generateSignature(payload);

      const response = await axios.post(
        `${this.apiUrl}/merchant/transfer`,
        payload,
        {
          auth: {
            username: this.merchantEmail,
            password: this.apiPassword,
          },
        }
      );

      return response.data;
    } catch (error) {
      console.error('Skrill Transfer Error:', error);
      throw new Error('Failed to transfer funds via Skrill');
    }
  }

  /**
   * Get transaction status
   */
  async getTransactionStatus(transactionId) {
    try {
      const payload = {
        action: 'transaction_details',
        merchant_email: this.merchantEmail,
        merchant_id: this.merchantId,
        transaction_id: transactionId,
      };

      payload.md5sig = this.generateSignature(payload);

      const response = await axios.post(
        `${this.apiUrl}/merchant/transaction`,
        payload,
        {
          auth: {
            username: this.merchantEmail,
            password: this.apiPassword,
          },
        }
      );

      return response.data;
    } catch (error) {
      console.error('Skrill Status Error:', error);
      throw new Error('Failed to get transaction status');
    }
  }

  /**
   * Generate MD5 signature
   */
  generateSignature(data) {
    const sortedKeys = Object.keys(data)
      .filter(key => key !== 'md5sig')
      .sort();

    let signatureString = '';
    sortedKeys.forEach(key => {
      signatureString += data[key];
    });

    signatureString += this.apiPassword;

    return crypto.createHash('md5').update(signatureString).digest('hex');
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(data, signature) {
    const payload = `${data.merchant_id}${data.transaction_id}${data.mb_amount}${data.mb_currency}${data.mb_status}${this.apiPassword}`;
    const expectedSignature = crypto
      .createHash('md5')
      .update(payload)
      .digest('hex');

    return signature === expectedSignature;
  }

  /**
   * Process webhook notification
   */
  processWebhook(webhookData) {
    const { mb_transaction_id, mb_status, mb_amount, mb_currency, mb_customer_id } = webhookData;

    const statusMap = {
      '0': 'pending',
      '1': 'processed',
      '2': 'failed',
      '-1': 'cancelled',
      '-2': 'refunded',
    };

    return {
      transactionId: mb_transaction_id,
      status: statusMap[mb_status] || 'unknown',
      amount: mb_amount,
      currency: mb_currency,
      customerId: mb_customer_id,
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = new SkrillPayment();
