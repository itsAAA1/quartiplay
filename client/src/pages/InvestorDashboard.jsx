import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function InvestorDashboard({ token }) {
  const [stats, setStats] = useState(null);
  const [investments, setInvestments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const [statsRes, investmentsRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/investors/dashboard`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`${API_BASE_URL}/api/investors/investments`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      setStats(statsRes.data);
      setInvestments(investmentsRes.data);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="loader"></div>;
  }

  return (
    <div className="container" style={{ paddingTop: '2rem' }}>
      <h1>لوحة التحكم - المستثمر</h1>

      <div className="grid grid-4" style={{ marginBottom: '2rem' }}>
        <div className="card">
          <h3 style={{ color: '#D4AF37' }}>إجمالي الاستثمارات</h3>
          <p style={{ fontSize: '1.5rem', color: '#D4AF37' }}>
            ${stats?.total_invested?.toFixed(2) || '0.00'}
          </p>
        </div>
        <div className="card">
          <h3 style={{ color: '#D4AF37' }}>إجمالي العوائد</h3>
          <p style={{ fontSize: '1.5rem', color: '#D4AF37' }}>
            ${stats?.total_returns?.toFixed(2) || '0.00'}
          </p>
        </div>
        <div className="card">
          <h3 style={{ color: '#D4AF37' }}>رصيد المحفظة</h3>
          <p style={{ fontSize: '1.5rem', color: '#D4AF37' }}>
            ${stats?.wallet_balance?.toFixed(2) || '0.00'}
          </p>
        </div>
        <div className="card">
          <h3 style={{ color: '#D4AF37' }}>الاستثمارات النشطة</h3>
          <p style={{ fontSize: '1.5rem', color: '#D4AF37' }}>
            {stats?.active_investments || 0}
          </p>
        </div>
      </div>

      <div className="card">
        <h2>استثماراتي</h2>
        {investments.length === 0 ? (
          <p>لا توجد استثمارات حالياً</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>المشروع</th>
                <th>الشركة</th>
                <th>المبلغ</th>
                <th>الحالة</th>
                <th>التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {investments.map(inv => (
                <tr key={inv.id}>
                  <td>{inv.title}</td>
                  <td>{inv.company_name}</td>
                  <td>${inv.amount.toFixed(2)}</td>
                  <td>{inv.status}</td>
                  <td>{new Date(inv.investment_date).toLocaleDateString('ar-SA')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Link to="/opportunities" className="btn btn-primary" style={{ marginTop: '2rem' }}>
        استكشف فرص جديدة
      </Link>
    </div>
  );
}

export default InvestorDashboard;
