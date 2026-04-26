const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

const API_BASE = 'https://porn-api.com/api/v1/public';
const HENTAI_BASE = 'https://hentaiocean.com';

// ===== Porn API Proxy =====
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

// ===== Hentai: RSS List =====
// GET /hentai/list?page=1&limit=20&genre=Milf
app.get('/hentai/list', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const genre = (req.query.genre || '').toLowerCase().trim();

    // Fetch RSS
    const rssRes = await fetch(`${HENTAI_BASE}/rss.xml`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!rssRes.ok) throw new Error(`RSS fetch failed: ${rssRes.status}`);
    const rssText = await rssRes.text();

    // Parse RSS items
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(rssText)) !== null) {
      const block = match[1];
      const get = (tag) => {
        const m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
        return m ? (m[1] || m[2] || '').trim() : '';
      };

      const link   = get('link');
      const title  = get('title');
      const pubDate = get('pubDate');

      // Extract slug from link: https://hentaiocean.com/watch/my-mother-1
      const slugMatch = link.match(/\/watch\/([^/?\s]+)/);
      if (!slugMatch) continue;
      const slug = slugMatch[1];

      // Extract genres from categories
      const genres = [];
      const catRegex = /<category><!\[CDATA\[(.*?)\]\]><\/category>/g;
      let catMatch;
      while ((catMatch = catRegex.exec(block)) !== null) {
        genres.push(catMatch[1].trim());
      }

      // Genre filter
      if (genre && !genres.map(g => g.toLowerCase()).includes(genre)) continue;

      // Extract cover from enclosure or media
      const enclosure = block.match(/<enclosure[^>]+url="([^"]+)"/);
      const cover = enclosure ? enclosure[1] : `${HENTAI_BASE}/thumbnail/${slug}.webp`;

      items.push({ slug, title, pubDate, genres, cover, link });
    }

    // Paginate
    const total      = items.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const safePage   = Math.min(page, totalPages);
    const start      = (safePage - 1) * limit;
    const pageItems  = items.slice(start, start + limit);

    res.json({
      data: {
        data: pageItems,
        total,
        page: safePage,
        totalPages,
      }
    });
  } catch (err) {
    console.error('Hentai list error:', err);
    res.status(500).json({ error: 'Failed to fetch hentai list', message: err.message });
  }
});

// ===== Hentai: Detail by slug =====
// GET /hentai/:slug
app.get('/hentai/:slug', async (req, res) => {
  try {
    const { slug } = req.params;

    const apiRes = await fetch(`${HENTAI_BASE}/api?action=hentai&slug=${slug}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!apiRes.ok) throw new Error(`Hentai API failed: ${apiRes.status}`);
    const json = await apiRes.json();

    const info   = (json.info || [])[0] || {};
    const genres = (json.genres || []).map(g => g.genre);

    res.json({
      data: {
        slug,
        title:       info.videoname    || slug,
        description: info.description  || '',
        releaseDate: info.releasedate  || '',
        uploadDate:  info.uploaddate   || '',
        cover:       info.coverimg
          ? `${HENTAI_BASE}/assets/cover/${info.coverimg}`
          : `${HENTAI_BASE}/thumbnail/${slug}.webp`,
        thumbnail:   `${HENTAI_BASE}/thumbnail/${slug}.webp`,
        embedUrl:    `${HENTAI_BASE}/embed/${slug}`,
        genres,
        status:      info.status,
      }
    });
  } catch (err) {
    console.error('Hentai detail error:', err);
    res.status(500).json({ error: 'Failed to fetch hentai detail', message: err.message });
  }
});

// ===== Hentai: Genres list =====
// GET /hentai/genres
app.get('/hentai/genres', async (req, res) => {
  try {
    const rssRes = await fetch(`${HENTAI_BASE}/rss.xml`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const rssText = await rssRes.text();

    const genreSet = new Set();
    const catRegex = /<category><!\[CDATA\[(.*?)\]\]><\/category>/g;
    let m;
    while ((m = catRegex.exec(rssText)) !== null) {
      if (m[1].trim()) genreSet.add(m[1].trim());
    }

    res.json({ data: { genres: [...genreSet].sort() } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch genres', message: err.message });
  }
});

// ===== Health =====
app.get('/health', (req, res) => res.json({
  status: 'OK',
  key_configured: !!API_KEY,
}));

app.listen(PORT, () => {
  console.log(`Proxy running on http://localhost:${PORT}`);
});