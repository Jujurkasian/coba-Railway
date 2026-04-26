const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 3000;

const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

const API_BASE = 'https://porn-api.com/api/v1/public';

app.all('/api/*path', async (req, res) => {
  try {
    const pathParts = req.params.path;
    const path = Array.isArray(pathParts) ? pathParts.join('/') : pathParts || '';

    const queryString = new URLSearchParams(req.query).toString();
    const finalUrl = queryString
      ? `${API_BASE}/${path}?${queryString}`
      : `${API_BASE}/${path}`;

    const fetchOptions = {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'ngrok-skip-browser-warning': 'true',
      },
    };

    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(finalUrl, fetchOptions);
    const data = await response.json();

    res.status(response.status).json(data);
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Proxy internal error', message: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'OK', key_configured: !!API_KEY }));

app.listen(PORT, () => {
  console.log(`Proxy running on http://localhost:${PORT}`);
});