/**
 * Wise Integration Module
 * Handles international money transfers and currency conversions
 */

const axios = require('axios');

class WiseTransfer {
  constructor() {
    this.apiUrl = process.env.WISE_API_URL || 'https://api.wise.com';
    this.apiToken = process.env.WISE_API_TOKEN;
    this.profileId = process.env.WISE_PROFILE_ID;
  }

  /**
   * Create a transfer quote
   */
  async createQuote(quoteData) {
    try {
      const payload = {
        sourceCurrency: quoteData.sourceCurrency || 'USD',
        targetCurrency: quoteData.targetCurrency || 'SAR',
        sourceAmount: quoteData.sourceAmount,
        profile: this.profileId,
      };

      const response = await axios.post(`${this.apiUrl}/v3/quotes`, payload, {
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
      });

      return response.data;
    } catch (error) {
      console.error('Wise Quote Error:', error);
      throw new Error('Failed to create transfer quote');
    }
  }

  /**
   * Create a transfer
   */
  async createTransfer(transferData) {
    try {
      const payload = {
        targetAccount: transferData.targetAccountId,
        quoteUuid: transferData.quoteId,
        customerTransactionId: transferData.transactionId,
        details: {
          reference: transferData.reference || 'Investment Return',
          transferPurpose: 'INVESTMENT',
          transferPurposeSubTransferPurpose: 'INVESTMENT_INCOME',
        },
      };

      const response = await axios.post(`${this.apiUrl}/v1/transfers`, payload, {
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
      });

      return response.data;
    } catch (error) {
      console.error('Wise Transfer Error:', error);
      throw new Error('Failed to create transfer');
    }
  }

  /**
   * Fund a transfer
   */
  async fundTransfer(transferId, fundData) {
    try {
      const payload = {
        type: fundData.type || 'BALANCE',
      };

      const response = await axios.post(
        `${this.apiUrl}/v3/transfers/${transferId}/payments`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data;
    } catch (error) {
      console.error('Wise Fund Error:', error);
      throw new Error('Failed to fund transfer');
    }
  }

  /**
   * Get transfer status
   */
  async getTransferStatus(transferId) {
    try {
      const response = await axios.get(`${this.apiUrl}/v1/transfers/${transferId}`, {
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
        },
      });

      return response.data;
    } catch (error) {
      console.error('Wise Status Error:', error);
      throw new Error('Failed to get transfer status');
    }
  }

  /**
   * Get exchange rate
   */
  async getExchangeRate(sourceCurrency, targetCurrency) {
    try {
      const response = await axios.get(`${this.apiUrl}/v3/rates`, {
        params: {
          source: sourceCurrency,
          target: targetCurrency,
        },
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
        },
      });

      return response.data;
    } catch (error) {
      console.error('Wise Rate Error:', error);
      throw new Error('Failed to get exchange rate');
    }
  }

  /**
   * Create recipient account
   */
  async createRecipientAccount(accountData) {
    try {
      const payload = {
        currency: accountData.currency || 'SAR',
        type: accountData.type || 'iban',
        profile: this.profileId,
        accountHolderName: accountData.accountHolderName,
        details: {
          iban: accountData.iban,
        },
      };

      const response = await axios.post(
        `${this.apiUrl}/v1/accounts`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data;
    } catch (error) {
      console.error('Wise Account Error:', error);
      throw new Error('Failed to create recipient account');
    }
  }

  /**
   * Get account balance
   */
  async getAccountBalance() {
    try {
      const response = await axios.get(
        `${this.apiUrl}/v4/profiles/${this.profileId}/balances`,
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      console.error('Wise Balance Error:', error);
      throw new Error('Failed to get account balance');
    }
  }

  /**
   * Get transfer fees
   */
  async getTransferFees(sourceCurrency, targetCurrency, amount) {
    try {
      const response = await axios.get(`${this.apiUrl}/v1/transfer-fees`, {
        params: {
          source: sourceCurrency,
          target: targetCurrency,
          amount: amount,
        },
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
        },
      });

      return response.data;
    } catch (error) {
      console.error('Wise Fees Error:', error);
      throw new Error('Failed to get transfer fees');
    }
  }

  /**
   * Cancel transfer
   */
  async cancelTransfer(transferId) {
    try {
      const response = await axios.put(
        `${this.apiUrl}/v1/transfers/${transferId}/cancel`,
        {},
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      console.error('Wise Cancel Error:', error);
      throw new Error('Failed to cancel transfer');
    }
  }

  /**
   * Process webhook notification
   */
  processWebhook(webhookData) {
    const { transferId, status, amount, currency } = webhookData;

    const statusMap = {
      'incoming_payment_waiting': 'pending',
      'processing': 'processing',
      'funds_converted': 'converted',
      'outgoing_payment_sent': 'completed',
      'bounced_back': 'failed',
      'cancelled': 'cancelled',
    };

    return {
      transferId,
      status: statusMap[status] || 'unknown',
      amount,
      currency,
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = new WiseTransfer();
