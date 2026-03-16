import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useParams, useNavigate } from 'react-router-dom';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function OpportunityDetail({ token }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [opportunity, setOpportunity] = useState(null);
  const [investAmount, setInvestAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    fetchOpportunity();
  }, [id]);

  const fetchOpportunity = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/opportunities/${id}`);
      setOpportunity(response.data);
    } catch (err) {
      setError('فشل تحميل تفاصيل الفرصة');
    } finally {
      setLoading(false);
    }
  };

  const handleInvest = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!token) {
      navigate('/login');
      return;
    }

    try {
      await axios.post(
        `${API_BASE_URL}/api/investments`,
        { opportunity_id: id, amount: parseFloat(investAmount) },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setSuccess('تم الاستثمار بنجاح!');
      setInvestAmount('');
      fetchOpportunity();
    } catch (err) {
      setError(err.response?.data?.error || 'فشل الاستثمار');
    }
  };

  if (loading) {
    return <div className="loader"></div>;
  }

  if (!opportunity) {
    return <div className="container"><p>الفرصة غير موجودة</p></div>;
  }

  const progress = (opportunity.current_amount / opportunity.target_amount) * 100;

  return (
    <div className="container" style={{ paddingTop: '2rem' }}>
      <button onClick={() => navigate('/opportunities')} className="btn btn-secondary" style={{ marginBottom: '1rem' }}>
        ← العودة
      </button>

      <div className="grid grid-2">
        <div>
          <h1>{opportunity.title}</h1>
          <p><strong>الشركة:</strong> {opportunity.company_name}</p>
          <p><strong>الوصف:</strong></p>
          <p>{opportunity.description}</p>
          
          <div style={{ marginTop: '2rem' }}>
            <h3>تفاصيل الفرصة</h3>
            <p><strong>نوع التمويل:</strong> {opportunity.funding_type}</p>
            <p><strong>الحد الأدنى للاستثمار:</strong> ${opportunity.min_investment.toFixed(2)}</p>
            <p><strong>الحد الأقصى للاستثمار:</strong> ${opportunity.max_investment.toFixed(2)}</p>
            <p><strong>مدة الاستثمار:</strong> {opportunity.duration_months} شهر</p>
            <p><strong>معدل العائد:</strong> {opportunity.return_rate}%</p>
            <p><strong>عدد المستثمرين:</strong> {opportunity.investor_count}</p>
          </div>
        </div>

        <div className="card">
          <h2>الاستثمار الآن</h2>
          
          {error && <div className="alert alert-danger">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}

          <div style={{ marginBottom: '1.5rem' }}>
            <h4>التمويل المجموع</h4>
            <p style={{ fontSize: '1.5rem', color: '#D4AF37' }}>
              ${opportunity.current_amount.toFixed(2)} / ${opportunity.target_amount.toFixed(2)}
            </p>
            <div style={{
              width: '100%',
              height: '20px',
              backgroundColor: '#333',
              borderRadius: '5px',
              overflow: 'hidden',
              marginBottom: '0.5rem'
            }}>
              <div style={{
                width: `${Math.min(progress, 100)}%`,
                height: '100%',
                backgroundColor: '#D4AF37'
              }}></div>
            </div>
            <p>{progress.toFixed(0)}% مكتمل</p>
          </div>

          <form onSubmit={handleInvest}>
            <label htmlFor="amount">مبلغ الاستثمار</label>
            <input
              type="number"
              id="amount"
              value={investAmount}
              onChange={(e) => setInvestAmount(e.target.value)}
              min={opportunity.min_investment}
              max={opportunity.max_investment}
              step="0.01"
              required
            />
            
            <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
              استثمر الآن
            </button>
          </form>

          {!token && (
            <p style={{ textAlign: 'center', color: '#ff9800' }}>
              يجب تسجيل الدخول للاستثمار
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default OpportunityDetail;
