/**
 * Neteller Integration Module
 * Handles all Neteller payment operations
 */

const axios = require('axios');
const crypto = require('crypto');

class NetellerPayment {
  constructor() {
    this.apiUrl = process.env.NETELLER_API_URL || 'https://api.neteller.com';
    this.merchantEmail = process.env.NETELLER_MERCHANT_EMAIL;
    this.merchantId = process.env.NETELLER_MERCHANT_ID;
    this.apiPassword = process.env.NETELLER_API_PASSWORD;
    this.apiKey = process.env.NETELLER_API_KEY;
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
      console.error('Neteller Payment Error:', error);
      throw new Error('Failed to create Neteller payment');
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
      console.error('Neteller Transfer Error:', error);
      throw new Error('Failed to transfer funds via Neteller');
    }
  }

  /**
   * Get account balance
   */
  async getAccountBalance() {
    try {
      const payload = {
        action: 'account_balance',
        merchant_email: this.merchantEmail,
        merchant_id: this.merchantId,
      };

      payload.md5sig = this.generateSignature(payload);

      const response = await axios.post(
        `${this.apiUrl}/merchant/account`,
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
      console.error('Neteller Balance Error:', error);
      throw new Error('Failed to get account balance');
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
      console.error('Neteller Status Error:', error);
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

  /**
   * Withdraw funds
   */
  async withdrawFunds(withdrawData) {
    try {
      const payload = {
        action: 'withdraw',
        merchant_email: this.merchantEmail,
        merchant_id: this.merchantId,
        amount: withdrawData.amount,
        currency: withdrawData.currency || 'USD',
        customer_id: withdrawData.customerId,
        note: withdrawData.note || 'Withdrawal Request',
      };

      payload.md5sig = this.generateSignature(payload);

      const response = await axios.post(
        `${this.apiUrl}/merchant/withdraw`,
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
      console.error('Neteller Withdrawal Error:', error);
      throw new Error('Failed to process withdrawal');
    }
  }
}

module.exports = new NetellerPayment();
