import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function Profile({ token, user }) {
  const [profile, setProfile] = useState(null);
  const [formData, setFormData] = useState({});
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      let endpoint = '';
      if (user.user_type === 'investor') {
        endpoint = '/api/investors/profile';
      } else if (user.user_type === 'company') {
        endpoint = '/api/companies/profile';
      }

      const response = await axios.get(`${API_BASE_URL}${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setProfile(response.data);
      setFormData(response.data);
    } catch (err) {
      setError('فشل تحميل الملف الشخصي');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    try {
      let endpoint = '';
      if (user.user_type === 'investor') {
        endpoint = '/api/investors/profile';
      } else if (user.user_type === 'company') {
        endpoint = '/api/companies/profile';
      }

      await axios.put(
        `${API_BASE_URL}${endpoint}`,
        formData,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setSuccess('تم تحديث الملف الشخصي بنجاح');
    } catch (err) {
      setError(err.response?.data?.error || 'فشل تحديث الملف الشخصي');
    }
  };

  if (loading) {
    return <div className="loader"></div>;
  }

  return (
    <div className="container" style={{ maxWidth: '600px', paddingTop: '2rem' }}>
      <h1>الملف الشخصي</h1>

      {success && <div className="alert alert-success">{success}</div>}
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card">
        <form onSubmit={handleSubmit}>
          <div>
            <label htmlFor="full_name">الاسم الكامل</label>
            <input
              type="text"
              id="full_name"
              name="full_name"
              value={formData.full_name || ''}
              onChange={handleChange}
              disabled
            />
          </div>

          <div>
            <label htmlFor="email">البريد الإلكتروني</label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email || ''}
              onChange={handleChange}
              disabled
            />
          </div>

          {user.user_type === 'investor' && (
            <>
              <div>
                <label htmlFor="country">الدولة</label>
                <input
                  type="text"
                  id="country"
                  name="country"
                  value={formData.country || ''}
                  onChange={handleChange}
                />
              </div>

              <div>
                <label htmlFor="city">المدينة</label>
                <input
                  type="text"
                  id="city"
                  name="city"
                  value={formData.city || ''}
                  onChange={handleChange}
                />
              </div>

              <div>
                <label htmlFor="preferred_investment_type">نوع الاستثمار المفضل</label>
                <input
                  type="text"
                  id="preferred_investment_type"
                  name="preferred_investment_type"
                  value={formData.preferred_investment_type || ''}
                  onChange={handleChange}
                />
              </div>
            </>
          )}

          {user.user_type === 'company' && (
            <>
              <div>
                <label htmlFor="company_name">اسم الشركة</label>
                <input
                  type="text"
                  id="company_name"
                  name="company_name"
                  value={formData.company_name || ''}
                  onChange={handleChange}
                />
              </div>

              <div>
                <label htmlFor="company_description">وصف الشركة</label>
                <textarea
                  id="company_description"
                  name="company_description"
                  value={formData.company_description || ''}
                  onChange={handleChange}
                  rows="4"
                />
              </div>

              <div>
                <label htmlFor="industry">الصناعة</label>
                <input
                  type="text"
                  id="industry"
                  name="industry"
                  value={formData.industry || ''}
                  onChange={handleChange}
                />
              </div>

              <div>
                <label htmlFor="founded_year">سنة التأسيس</label>
                <input
                  type="number"
                  id="founded_year"
                  name="founded_year"
                  value={formData.founded_year || ''}
                  onChange={handleChange}
                />
              </div>
            </>
          )}

          <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
            حفظ التغييرات
          </button>
        </form>
      </div>
    </div>
  );
}

export default Profile;
