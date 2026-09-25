'use strict';
const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
require('./db'); // initialise schema + default owner
const { loadUser } = require('./auth');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Behind a hosting proxy (Render, Railway…) set TRUST_PROXY=1 so client IPs and HTTPS are detected.
  const tp = process.env.TRUST_PROXY;
  app.set('trust proxy', tp ? (/^\d+$/.test(tp) ? Number(tp) : tp) : 'loopback');

  app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(loadUser);

  // CSRF defence: state-changing API calls must come from our own pages (JSON / same-origin header).
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('X-Requested-With') !== 'cakery') return res.status(403).json({ error: 'Invalid request origin' });
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/users', require('./routes/users'));
  app.use('/api/items', require('./routes/items'));
  app.use('/api/production', require('./routes/production'));
  app.use('/api/closings', require('./routes/closing'));
  app.use('/api/expenses', require('./routes/expenses'));
  app.use('/api/vendors', require('./routes/vendors'));
  app.use('/api/orders', require('./routes/orders'));
  app.use('/api', require('./routes/reports'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  app.use('/vendor/chart.js', express.static(path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist'), { maxAge: '7d' }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 15 MB)' : err.message });
    }
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong on the server' : err.message });
  });
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => console.log(`[cakery] Running at http://localhost:${port}`));
}

module.exports = { createApp };
