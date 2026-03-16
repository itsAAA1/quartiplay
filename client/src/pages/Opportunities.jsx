import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function Opportunities({ token }) {
  const [opportunities, setOpportunities] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchOpportunities();
  }, [filter]);

  const fetchOpportunities = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/opportunities`, {
        params: { funding_type: filter || undefined }
      });
      setOpportunities(response.data);
    } catch (error) {
      console.error('Failed to fetch opportunities:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="loader"></div>;
  }

  return (
    <div className="container" style={{ paddingTop: '2rem' }}>
      <h1>فرص الاستثمار</h1>

      <div style={{ marginBottom: '2rem' }}>
        <label htmlFor="filter">تصفية حسب نوع التمويل:</label>
        <select
          id="filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">الكل</option>
          <option value="0%">0% - بدون عائد</option>
          <option value="20%">20% - عائد 20%</option>
          <option value="flexible">مرن</option>
        </select>
      </div>

      <div className="grid grid-2">
        {opportunities.map(opp => (
          <div key={opp.id} className="card">
            <h3>{opp.title}</h3>
            <p>{opp.description?.substring(0, 100)}...</p>
            <p><strong>الشركة:</strong> {opp.company_name}</p>
            <p><strong>نوع التمويل:</strong> {opp.funding_type}</p>
            <p><strong>الهدف:</strong> ${opp.target_amount.toFixed(2)}</p>
            <p><strong>المجموع:</strong> ${opp.current_amount.toFixed(2)}</p>
            <div style={{
              width: '100%',
              height: '10px',
              backgroundColor: '#333',
              borderRadius: '5px',
              marginBottom: '1rem',
              overflow: 'hidden'
            }}>
              <div style={{
                width: `${(opp.current_amount / opp.target_amount) * 100}%`,
                height: '100%',
                backgroundColor: '#D4AF37'
              }}></div>
            </div>
            <p><strong>المستثمرون:</strong> {opp.investor_count}</p>
            <Link to={`/opportunities/${opp.id}`} className="btn btn-primary">
              عرض التفاصيل
            </Link>
          </div>
        ))}
      </div>

      {opportunities.length === 0 && (
        <p style={{ textAlign: 'center', marginTop: '2rem' }}>لا توجد فرص متاحة حالياً</p>
      )}
    </div>
  );
}

export default Opportunities;
