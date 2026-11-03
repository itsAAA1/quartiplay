const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || '*',
  credentials: true
}));
app.use(morgan('combined'));
// Stripe verifies signatures against the exact raw bytes. Mount before JSON parsing.
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/investors', require('./routes/investors'));
app.use('/api/companies', require('./routes/companies'));
app.use('/api/opportunities', require('./routes/opportunities'));
app.use('/api/investments', require('./routes/investments'));
app.use('/api/payments', require('./routes/payments'));
// Third-party money-moving integrations are NOT mounted until their authentication,
// provider signatures, database schemas, refunds and audit/reconciliation paths
// have been reviewed and independently integration tested.
// Legacy modules remain in the repository for separate remediation. Do not expose them.
// app.use('/api/paypal', require('./routes/paypal'));
// app.use('/api/skrill-neteller', require('./routes/skrill-neteller'));
// app.use('/api/wise', require('./routes/wise'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/admin', require('./routes/admin'));

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error Handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: {
      message: err.message,
      status: err.status || 500
    }
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start the listener only in the executable entry point. Unit tests can import
// app and bind an ephemeral loopback port without opening an external service.
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log('Quartiplay API listening on configured port');
    console.log('External Wise / Skrill / Neteller / PayPal transfer routes are disabled pending safety review');
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = app;
