require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

// Middleware
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static HTML files from /public
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/payment', require('./routes/payment'));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'merchant-dashboard' }));

// Catch-all: serve index.html for any unknown route (SPA behavior)
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 6000;
app.listen(PORT, () => {
  console.log(`\n🚀 Merchant Dashboard running on port ${PORT}`);
  console.log(`   Local: http://localhost:${PORT}`);
  console.log(`   Cashfree: ${process.env.CASHFREE_ENV || 'TEST'} mode\n`);
});
