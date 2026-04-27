const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json());

const API_BASE     = "https://porn-api.com/api/v1/public";
const HENTAI_BASE  = "https://hentaiocean.com";
const JAVGURU_BASE = "https://jav.guru";
const JAVDB_BASE   = "https://javdb.com";

// ============================================================
// SHARED FETCH HELPER
// ============================================================
async function fetchHtml(url, extraHeaders = {}) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      ...extraHeaders,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.text();
}

// ============================================================
// PORN API PROXY
// ============================================================
app.all("/api/*path", async (req, res) => {
  try {
    const pathParts = req.params.path;
    const path = Array.isArray(pathParts) ? pathParts.join("/") : pathParts || "";
    const queryString = new URLSearchParams(req.query).toString();
    const finalUrl = queryString ? `${API_BASE}/${path}?${queryString}` : `${API_BASE}/${path}`;
    const fetchOptions = {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": API_KEY,
        "ngrok-skip-browser-warning": "true",
      },
    };
    if (["POST", "PUT", "PATCH"].includes(req.method))
      fetchOptions.body = JSON.stringify(req.body);
    const response = await fetch(finalUrl, fetchOptions);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: "Proxy internal error", message: err.message });
  }
});

// ============================================================
// HENTAI ENDPOINTS
// ============================================================
app.get("/hentai/list", async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const genre = (req.query.genre || "").toLowerCase().trim();
    const rssText = await fetchHtml(`${HENTAI_BASE}/rss.xml`);
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(rssText)) !== null) {
      const block = match[1];
      const get = (tag) => {
        const m = block.match(
          new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`),
        );
        return m ? (m[1] || m[2] || "").trim() : "";
      };
      const link    = get("link");
      const title   = get("title");
      const pubDate = get("pubDate");
      const slugMatch = link.match(/\/watch\/([^/?s]+)/);
      if (!slugMatch) continue;
      const slug = slugMatch[1];
      const genres = [];
      const catRegex = /<category><!\[CDATA\[(.*?)\]\]><\/category>/g;
      let catMatch;
      while ((catMatch = catRegex.exec(block)) !== null)
        genres.push(catMatch[1].trim());
      if (genre && !genres.map((g) => g.toLowerCase()).includes(genre)) continue;
      const enclosure = block.match(/<enclosure[^>]+url="([^"]+)"/);
      const cover = enclosure ? enclosure[1] : `${HENTAI_BASE}/thumbnail/${slug}.webp`;
      items.push({ slug, title, pubDate, genres, cover, link });
    }
    const total      = items.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const safePage   = Math.min(page, totalPages);
    res.json({
      data: {
        data: items.slice((safePage - 1) * limit, safePage * limit),
        total,
        page: safePage,
        totalPages,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch hentai list", message: err.message });
  }
});

app.get("/hentai/genres", async (req, res) => {
  try {
    const rssText = await fetchHtml(`${HENTAI_BASE}/rss.xml`);
    const genreSet = new Set();
    const catRegex = /<category><!\[CDATA\[(.*?)\]\]><\/category>/g;
    let m;
    while ((m = catRegex.exec(rssText)) !== null)
      if (m[1].trim()) genreSet.add(m[1].trim());
    res.json({ data: { genres: [...genreSet].sort() } });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch genres", message: err.message });
  }
});

app.get("/hentai/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const apiRes = await fetch(`${HENTAI_BASE}/api?action=hentai&slug=${slug}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!apiRes.ok) throw new Error(`Hentai API failed: ${apiRes.status}`);
    const json   = await apiRes.json();
    const info   = (json.info || [])[0] || {};
    const genres = (json.genres || []).map((g) => g.genre);
    res.json({
      data: {
        slug,
        title:       info.videoname || slug,
        description: info.description || "",
        releaseDate: info.releasedate || "",
        uploadDate:  info.uploaddate || "",
        cover: info.coverimg
          ? `${HENTAI_BASE}/assets/cover/${info.coverimg}`
          : `${HENTAI_BASE}/thumbnail/${slug}.webp`,
        thumbnail: `${HENTAI_BASE}/thumbnail/${slug}.webp`,
        embedUrl:  `${HENTAI_BASE}/embed/${slug}`,
        genres,
        status: info.status,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch hentai detail", message: err.message });
  }
});

// ============================================================
// JAV ENDPOINTS
// ============================================================

// ── RSS Parser (jav.guru) ───────────────────────────────────
function parseJavGuruRss(rssText) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(rssText)) !== null) {
    const block = match[1];
    const getTag = (tag) => {
      const m = block.match(
        new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`),
      );
      return m ? (m[1] || m[2] || "").trim() : "";
    };
    const link    = getTag("link");
    const title   = getTag("title");
    const pubDate = getTag("pubDate");
    const desc    = getTag("description");

    const slugMatch = link.match(/jav\.guru\/\d+\/([^/]+)\/?$/);
    if (!slugMatch) continue;
    const slug = slugMatch[1];

    const codeMatch = slug.match(/^([a-z]+-\d+)/i);
    if (!codeMatch) continue;
    const code = codeMatch[1].toUpperCase();

    const thumbMatch = desc.match(/<img[^>]+src="([^"]+)"/i);
    const thumbnail  = thumbMatch ? thumbMatch[1] : "";

    const genres = [];
    const catRegex = /<category><!\[CDATA\[(.*?)\]\]><\/category>/g;
    let catMatch;
    while ((catMatch = catRegex.exec(block)) !== null)
      if (catMatch[1].trim()) genres.push(catMatch[1].trim());

    items.push({ code, slug, title, pubDate, thumbnail, genres, link });
  }
  return items;
}

// ── JavDB Scraper ───────────────────────────────────────────
async function scrapeJavDB(code) {
  // Step 1: search untuk dapat URL detail page
  const searchHtml = await fetchHtml(
    `${JAVDB_BASE}/search?q=${encodeURIComponent(code)}&f=all`,
    {
      Referer: "https://javdb.com/",
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
      Cookie: "over18=1",
    },
  );

  // Ambil hasil pertama
  const firstResult = searchHtml.match(/href="(\/v\/[a-zA-Z0-9]+)"/);
  if (!firstResult) return null;

  const detailUrl = `${JAVDB_BASE}${firstResult[1]}`;
  const html = await fetchHtml(detailUrl, {
    Referer: "https://javdb.com/",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    Cookie: "over18=1",
  });

  // Verify kode ada di halaman
  if (!html.toUpperCase().includes(code.toUpperCase())) return null;

  // Cover
  const coverMatch =
    html.match(/<img[^>]+class="[^"]*video-cover[^"]*"[^>]+src="([^"]+)"/i) ||
    html.match(/property="og:image"[^>]+content="([^"]+)"/i) ||
    html.match(/content="([^"]+)"[^>]+property="og:image"/i);
  const coverUrl = coverMatch ? coverMatch[1] : "";

  // Title
  const titleMatch =
    html.match(/property="og:title"[^>]+content="([^"]+)"/i) ||
    html.match(/content="([^"]+)"[^>]+property="og:title"/i);
  const fullTitle = titleMatch ? titleMatch[1].trim() : "";
  const title = fullTitle
    .replace(new RegExp(code, "i"), "")
    .replace(/^[-\s]+/, "")
    .trim();

  // Helper ambil value dari panel info
  const getPanel = (label) => {
    const r = new RegExp(
      `${label}[^<]*<\\/strong>[\\s\\S]*?<span[^>]*>([\\s\\S]*?)<\\/span>`,
      "i",
    );
    const m = html.match(r);
    if (!m) return "";
    return m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  };

  const premiered = getPanel("發行日期|Release Date|上映日期") || "";
  const duration  = getPanel("時長|Duration|时长") || "";
  const director  = getPanel("導演|Director|导演") || "";
  const studio    = getPanel("片商|Studio|maker") || "";

  // Actors
  const actorMatches = [
    ...html.matchAll(/class="actor"[^>]*>[\s\S]*?<strong[^>]*>([\s\S]*?)<\/strong>/gi),
  ];
  const actors = actorMatches
    .map((m) => m[1].replace(/<[^>]+>/g, "").trim())
    .filter(Boolean)
    .join(", ");

  // Tags
  const tagMatches = [...html.matchAll(/class="[^"]*tag[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)];
  const tags = tagMatches
    .map((m) => m[1].replace(/<[^>]+>/g, "").trim())
    .filter((t) => t && t.length < 40)
    .slice(0, 10)
    .join(", ");

  // Preview thumbs
  const thumbMatches = [
    ...html.matchAll(/class="[^"]*preview-images[^"]*"[\s\S]*?src="([^"]+)"/gi),
  ];
  const thumbs = thumbMatches.map((m) => m[1]).filter(Boolean);

  if (!coverUrl && !title) return null;

  return { code: code.toUpperCase(), title, coverUrl, premiered, duration, actors, tags, director, studio, thumbs };
}

// GET /jav/list
app.get("/jav/list", async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const genre = (req.query.genre || "").toLowerCase().trim();
    const sort  = req.query.sort || "newest";

    const rssText = await fetchHtml(`${JAVGURU_BASE}/feed/`);
    let items = parseJavGuruRss(rssText);

    if (genre)
      items = items.filter((i) =>
        i.genres.map((g) => g.toLowerCase()).includes(genre),
      );
    if (sort === "oldest")
      items.sort((a, b) => new Date(a.pubDate) - new Date(b.pubDate));

    const total      = items.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const safePage   = Math.min(page, totalPages);
    res.json({
      data: {
        data: items.slice((safePage - 1) * limit, safePage * limit),
        total,
        page: safePage,
        totalPages,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch JAV list", message: err.message });
  }
});

// GET /jav/genres
app.get("/jav/genres", async (req, res) => {
  try {
    const rssText = await fetchHtml(`${JAVGURU_BASE}/feed/`);
    const items   = parseJavGuruRss(rssText);
    const genreSet = new Set();
    items.forEach((i) => i.genres.forEach((g) => genreSet.add(g)));
    res.json({ data: { genres: [...genreSet].sort() } });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch JAV genres", message: err.message });
  }
});

// GET /jav/detail/:code
app.get("/jav/detail/:code", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    let data = null;

    // Source 1: JavDB
    try {
      data = await scrapeJavDB(code);
    } catch (e) {
      console.warn(`[javdb] failed for ${code}:`, e.message);
    }

    // Fallback: minimal dari RSS jav.guru
    if (!data) {
      try {
        const rssText = await fetchHtml(`${JAVGURU_BASE}/feed/`);
        const items   = parseJavGuruRss(rssText);
        const found   = items.find((i) => i.code === code);
        if (found) {
          data = {
            code,
            title:     found.title,
            coverUrl:  found.thumbnail,
            premiered: found.pubDate ? new Date(found.pubDate).toISOString().split("T")[0] : "",
            duration:  "",
            actors:    "",
            tags:      found.genres.join(", "),
            director:  "",
            studio:    "",
            thumbs:    [],
          };
        }
      } catch (e) {
        console.warn(`[rss fallback] failed:`, e.message);
      }
    }

    if (!data) return res.status(404).json({ error: "JAV not found", code });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch JAV detail", message: err.message });
  }
});

// GET /jav/search?q=SSIS-392
app.get("/jav/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim().toUpperCase();
    if (!q) return res.status(400).json({ error: "Query q is required" });

    let data = null;
    try {
      data = await scrapeJavDB(q);
    } catch (e) {
      console.warn(`[javdb search] failed for ${q}:`, e.message);
    }

    if (!data) return res.status(404).json({ error: "JAV not found", code: q });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: "Search failed", message: err.message });
  }
});

// DEBUG — hapus setelah selesai
app.get("/debug/javdb/:code", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const searchHtml = await fetchHtml(
      `${JAVDB_BASE}/search?q=${encodeURIComponent(code)}&f=all`,
      {
        Referer: "https://javdb.com/",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
        Cookie: "over18=1",
      }
    );
    const firstResult = searchHtml.match(/href="(\/v\/[a-zA-Z0-9]+)"/);
    res.json({
      htmlLength: searchHtml.length,
      firstResult: firstResult ? firstResult[1] : null,
      snippet: searchHtml.slice(0, 500),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// HEALTH
// ============================================================
app.get("/health", (req, res) =>
  res.json({ status: "OK", key_configured: !!API_KEY }),
);

app.listen(PORT, () =>
  console.log(`Proxy running on http://localhost:${PORT}`),
);