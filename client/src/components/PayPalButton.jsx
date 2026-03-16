import React, { useEffect } from 'react';
import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function PayPalButton({ amount, description, investmentId, token, onSuccess, onError }) {
  useEffect(() => {
    // تحميل سكريبت PayPal
    const script = document.createElement('script');
    script.src = `https://www.paypal.com/sdk/js?client-id=${process.env.REACT_APP_PAYPAL_CLIENT_ID}`;
    script.async = true;
    script.onload = () => {
      if (window.paypal) {
        renderPayPalButton();
      }
    };
    document.body.appendChild(script);

    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  const renderPayPalButton = () => {
    if (!window.paypal) return;

    window.paypal.Buttons({
      createOrder: async (data, actions) => {
        try {
          const response = await axios.post(
            `${API_BASE_URL}/api/paypal/create-payment`,
            {
              amount,
              currency: 'USD',
              description,
              investmentId
            },
            {
              headers: { Authorization: `Bearer ${token}` }
            }
          );

          return response.data.paymentId;
        } catch (error) {
          console.error('Failed to create order:', error);
          onError?.(error);
          throw error;
        }
      },

      onApprove: async (data, actions) => {
        try {
          // تنفيذ الدفع
          const response = await axios.get(
            `${API_BASE_URL}/api/paypal/execute`,
            {
              params: {
                paymentId: data.orderID,
                PayerID: data.payerID,
                investmentId
              }
            }
          );

          onSuccess?.(response.data);
        } catch (error) {
          console.error('Failed to approve payment:', error);
          onError?.(error);
        }
      },

      onError: (err) => {
        console.error('PayPal error:', err);
        onError?.(err);
      },

      onCancel: () => {
        console.log('Payment cancelled');
        onError?.(new Error('Payment cancelled'));
      }
    }).render('#paypal-button-container');
  };

  return <div id="paypal-button-container"></div>;
}

export default PayPalButton;
