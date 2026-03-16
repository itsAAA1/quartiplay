import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function AdminDashboard({ token }) {
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAdminData();
  }, []);

  const fetchAdminData = async () => {
    try {
      const [statsRes, usersRes, transRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/admin/stats`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`${API_BASE_URL}/api/admin/users`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`${API_BASE_URL}/api/admin/transactions`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      setStats(statsRes.data);
      setUsers(usersRes.data);
      setTransactions(transRes.data);
    } catch (error) {
      console.error('Failed to fetch admin data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="loader"></div>;
  }

  return (
    <div className="container" style={{ paddingTop: '2rem' }}>
      <h1>لوحة التحكم - الإدارة</h1>

      <div className="grid grid-4" style={{ marginBottom: '2rem' }}>
        <div className="card">
          <h3 style={{ color: '#D4AF37' }}>إجمالي المستخدمين</h3>
          <p style={{ fontSize: '1.5rem', color: '#D4AF37' }}>
            {stats?.total_users || 0}
          </p>
        </div>
        <div className="card">
          <h3 style={{ color: '#D4AF37' }}>المستثمرون</h3>
          <p style={{ fontSize: '1.5rem', color: '#D4AF37' }}>
            {stats?.total_investors || 0}
          </p>
        </div>
        <div className="card">
          <h3 style={{ color: '#D4AF37' }}>الشركات</h3>
          <p style={{ fontSize: '1.5rem', color: '#D4AF37' }}>
            {stats?.total_companies || 0}
          </p>
        </div>
        <div className="card">
          <h3 style={{ color: '#D4AF37' }}>إجمالي الاستثمارات</h3>
          <p style={{ fontSize: '1.5rem', color: '#D4AF37' }}>
            ${stats?.total_invested?.toFixed(2) || '0.00'}
          </p>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>المستخدمون الأخيرون</h2>
          {users.length === 0 ? (
            <p>لا يوجد مستخدمون</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>البريد الإلكتروني</th>
                  <th>النوع</th>
                  <th>التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {users.slice(0, 10).map(user => (
                  <tr key={user.id}>
                    <td>{user.full_name}</td>
                    <td>{user.email}</td>
                    <td>{user.user_type}</td>
                    <td>{new Date(user.created_at).toLocaleDateString('ar-SA')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h2>المعاملات الأخيرة</h2>
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
                {transactions.slice(0, 10).map(trans => (
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
    </div>
  );
}

export default AdminDashboard;
