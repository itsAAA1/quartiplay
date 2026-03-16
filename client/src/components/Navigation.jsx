import React from 'react';
import { Link, useNavigate } from 'react-router-dom';

function Navigation({ user, onLogout }) {
  const navigate = useNavigate();

  const handleLogout = () => {
    onLogout();
    navigate('/login');
  };

  return (
    <nav>
      <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Link to="/" style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#D4AF37' }}>
          Quartiplay
        </Link>
        
        <ul style={{ display: 'flex', gap: '2rem', listStyle: 'none' }}>
          <li><Link to="/dashboard">لوحة التحكم</Link></li>
          <li><Link to="/opportunities">الفرص</Link></li>
          <li><Link to="/wallet">المحفظة</Link></li>
          <li><Link to="/profile">الملف الشخصي</Link></li>
          <li>
            <span style={{ marginRight: '1rem' }}>
              {user?.full_name}
            </span>
            <button
              onClick={handleLogout}
              className="btn btn-secondary"
              style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}
            >
              تسجيل الخروج
            </button>
          </li>
        </ul>
      </div>
    </nav>
  );
}

export default Navigation;
