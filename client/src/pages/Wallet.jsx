import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function Wallet({ token }) {
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchWalletData();
  }, []);

  const fetchWalletData = async () => {
    try {
      const [walletRes, transRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/wallet/balance`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`${API_BASE_URL}/api/wallet/transactions`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      setWallet(walletRes.data);
      setTransactions(transRes.data);
    } catch (err) {
      setError('فشل تحميل بيانات المحفظة');
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async (e) => {
    e.preventDefault();
    setError('');

    try {
      await axios.post(
        `${API_BASE_URL}/api/wallet/withdraw`,
        { amount: parseFloat(withdrawAmount) },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setWithdrawAmount('');
      fetchWalletData();
    } catch (err) {
      setError(err.response?.data?.error || 'فشل السحب');
    }
  };

  if (loading) {
    return <div className="loader"></div>;
  }

  return (
    <div className="container" style={{ paddingTop: '2rem' }}>
      <h1>المحفظة</h1>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="grid grid-2">
        <div className="card">
          <h2>رصيد المحفظة</h2>
          <p style={{ fontSize: '2rem', color: '#D4AF37' }}>
            ${wallet?.balance?.toFixed(2) || '0.00'}
          </p>
          <p>إجمالي الإيداعات: ${wallet?.total_deposits?.toFixed(2) || '0.00'}</p>
          <p>إجمالي السحوبات: ${wallet?.total_withdrawals?.toFixed(2) || '0.00'}</p>
        </div>

        <div className="card">
          <h2>سحب الأموال</h2>
          <form onSubmit={handleWithdraw}>
            <label htmlFor="amount">المبلغ</label>
            <input
              type="number"
              id="amount"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              min="0"
              step="0.01"
              required
            />
            <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
              سحب
            </button>
          </form>
        </div>
      </div>

      <div className="card" style={{ marginTop: '2rem' }}>
        <h2>سجل المعاملات</h2>
        {transactions.length === 0 ? (
          <p>لا توجد معاملات</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>النوع</th>
                <th>المبلغ</th>
                <th>الحالة</th>
                <th>التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map(trans => (
                <tr key={trans.id}>
                  <td>{trans.transaction_type}</td>
                  <td>${trans.amount.toFixed(2)}</td>
                  <td>{trans.status}</td>
                  <td>{new Date(trans.created_at).toLocaleDateString('ar-SA')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default Wallet;
