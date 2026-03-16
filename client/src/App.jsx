import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';
import './index.css';

// Pages
import Login from './pages/Login';
import Register from './pages/Register';
import InvestorDashboard from './pages/InvestorDashboard';
import CompanyDashboard from './pages/CompanyDashboard';
import AdminDashboard from './pages/AdminDashboard';
import Opportunities from './pages/Opportunities';
import OpportunityDetail from './pages/OpportunityDetail';
import Profile from './pages/Profile';
import Wallet from './pages/Wallet';

// Components
import Navigation from './components/Navigation';
import ProtectedRoute from './components/ProtectedRoute';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(localStorage.getItem('token'));

  useEffect(() => {
    if (token) {
      verifyToken();
    } else {
      setLoading(false);
    }
  }, [token]);

  const verifyToken = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/auth/verify`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUser(response.data.user);
    } catch (error) {
      console.error('Token verification failed:', error);
      localStorage.removeItem('token');
      setToken(null);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = (newToken, userData) => {
    localStorage.setItem('token', newToken);
    setToken(newToken);
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  };

  if (loading) {
    return (
      <div className="container" style={{ textAlign: 'center', paddingTop: '2rem' }}>
        <div className="loader"></div>
        <p>جاري التحميل...</p>
      </div>
    );
  }

  return (
    <Router>
      {user && <Navigation user={user} onLogout={handleLogout} />}
      <Routes>
        <Route path="/login" element={<Login onLogin={handleLogin} />} />
        <Route path="/register" element={<Register onRegister={handleLogin} />} />
        
        <Route path="/" element={user ? <Navigate to="/dashboard" /> : <Navigate to="/login" />} />
        
        <Route path="/opportunities" element={<Opportunities token={token} />} />
        <Route path="/opportunities/:id" element={<OpportunityDetail token={token} />} />
        
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute user={user}>
              {user?.user_type === 'investor' && <InvestorDashboard token={token} />}
              {user?.user_type === 'company' && <CompanyDashboard token={token} />}
              {user?.user_type === 'admin' && <AdminDashboard token={token} />}
            </ProtectedRoute>
          }
        />
        
        <Route
          path="/profile"
          element={
            <ProtectedRoute user={user}>
              <Profile token={token} user={user} />
            </ProtectedRoute>
          }
        />
        
        <Route
          path="/wallet"
          element={
            <ProtectedRoute user={user}>
              <Wallet token={token} />
            </ProtectedRoute>
          }
        />
      </Routes>
    </Router>
  );
}

export default App;
