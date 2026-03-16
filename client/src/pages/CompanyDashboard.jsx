import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function CompanyDashboard({ token }) {
  const [stats, setStats] = useState(null);
  const [opportunities, setOpportunities] = useState([]);
  const [investors, setInvestors] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const [statsRes, oppRes, invRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/companies/dashboard`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`${API_BASE_URL}/api/companies/opportunities`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`${API_BASE_URL}/api/companies/investors`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      setStats(statsRes.data);
      setOpportunities(oppRes.data);
      setInvestors(invRes.data);
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
      <h1>لوحة التحكم - الشركة</h1>

      <div className="grid grid-4" style={{ marginBottom: '2rem' }}>
        <div className="card">
          <h3 style={{ color: '#D4AF37' }}>إجمالي التمويل</h3>
          <p style={{ fontSize: '1.5rem', color: '#D4AF37' }}>
            ${stats?.total_raised?.toFixed(2) || '0.00'}
          </p>
        </div>
        <div className="card">
          <h3 style={{ color: '#D4AF37' }}>عدد المستثمرين</h3>
          <p style={{ fontSize: '1.5rem', color: '#D4AF37' }}>
            {stats?.total_investors || 0}
          </p>
        </div>
        <div className="card">
          <h3 style={{ color: '#D4AF37' }}>الفرص النشطة</h3>
          <p style={{ fontSize: '1.5rem', color: '#D4AF37' }}>
            {stats?.active_opportunities || 0}
          </p>
        </div>
        <div className="card">
          <h3 style={{ color: '#D4AF37' }}>العوائد المدفوعة</h3>
          <p style={{ fontSize: '1.5rem', color: '#D4AF37' }}>
            ${stats?.total_returns_paid?.toFixed(2) || '0.00'}
          </p>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>فرصي الاستثمارية</h2>
          {opportunities.length === 0 ? (
            <p>لا توجد فرص حالياً</p>
          ) : (
            <ul style={{ listStyle: 'none' }}>
              {opportunities.map(opp => (
                <li key={opp.id} style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid #333' }}>
                  <h4>{opp.title}</h4>
                  <p>الهدف: ${opp.target_amount.toFixed(2)}</p>
                  <p>المجموع: ${opp.current_amount.toFixed(2)}</p>
                  <p>النسبة: {((opp.current_amount / opp.target_amount) * 100).toFixed(0)}%</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2>المستثمرون</h2>
          {investors.length === 0 ? (
            <p>لا يوجد مستثمرون حالياً</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>المبلغ</th>
                </tr>
              </thead>
              <tbody>
                {investors.map(inv => (
                  <tr key={inv.id}>
                    <td>{inv.full_name}</td>
                    <td>${inv.total_invested.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Link to="/opportunities" className="btn btn-primary" style={{ marginTop: '2rem' }}>
        إنشاء فرصة جديدة
      </Link>
    </div>
  );
}

export default CompanyDashboard;
