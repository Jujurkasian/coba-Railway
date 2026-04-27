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

const API_BASE = "https://porn-api.com/api/v1/public";
const HENTAI_BASE = "https://hentaiocean.com";
const AVDB_BASE = "https://avdbapi.com/api.php/provide/vod";

// ============================================================
// SHARED FETCH HELPER
// ============================================================
async function fetchHtml(url, extraHeaders = {}) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      ...extraHeaders,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.text();
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

// ============================================================
// AVDB API HELPER
// ============================================================

// type_id: 1=Censored, 2=Uncensored, 3=Uncensored Leaked,
//          4=Amateur, 5=Chinese AV, 6=Hentai, 7=English Subtitle
const AVDB_TYPES = {
  censored: 1,
  uncensored: 2,
  "uncensored-leaked": 3,
  amateur: 4,
  "chinese-av": 5,
  hentai: 6,
  "english-subtitle": 7,
};

function normalizeItem(item) {
  const code = item.movie_code || item.slug || "";
  const slug =
    item.slug || (item.movie_code || "").toLowerCase().replace(/ /g, "-");
  const embedUrl = item.episodes?.server_data?.Full?.link_embed || "";

  return {
    id: item.id,
    code: code,
    title: item.name || item.origin_name || "",
    slug: slug,
    type: item.type_name || "",
    poster_url: item.poster_url || `https://upload18.cc/v/${slug}/poster.jpg`,
    thumb_url:
      item.thumb_url ||
      `https://fourhoi.com/${(item.movie_code || item.slug || "").toLowerCase().replace(/_/g, "-")}/cover-n.jpg`,
    actors: (item.actor || []).filter((a) => a !== "Updating").join(", "),
    director: (item.director || []).filter((d) => d !== "Updating").join(", "),
    categories: item.category || [],
    quality: item.quality || "",
    duration: item.time || "",
    year: item.year || "",
    description: (item.description || "").replace(/<[^>]+>/g, "").trim(),
    pubDate: item.vod_pubdate || item.created_at || "",
    embedUrl,
  };
}

// ============================================================
// PORN API PROXY
// ============================================================
app.all("/api/*path", async (req, res) => {
  try {
    const pathParts = req.params.path;
    const path = Array.isArray(pathParts)
      ? pathParts.join("/")
      : pathParts || "";
    const queryString = new URLSearchParams(req.query).toString();
    const finalUrl = queryString
      ? `${API_BASE}/${path}?${queryString}`
      : `${API_BASE}/${path}`;
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
    res
      .status(500)
      .json({ error: "Proxy internal error", message: err.message });
  }
});

// ============================================================
// HENTAI ENDPOINTS
// ============================================================
app.get("/hentai/list", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
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
          new RegExp(
            `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,
          ),
        );
        return m ? (m[1] || m[2] || "").trim() : "";
      };
      const link = get("link");
      const title = get("title");
      const pubDate = get("pubDate");
      const slugMatch = link.match(/\/watch\/([^/?]+)/);
      if (!slugMatch) continue;
      const slug = slugMatch[1];
      const genres = [];
      const catRegex = /<category><!\[CDATA\[(.*?)\]\]><\/category>/g;
      let catMatch;
      while ((catMatch = catRegex.exec(block)) !== null)
        genres.push(catMatch[1].trim());
      if (genre && !genres.map((g) => g.toLowerCase()).includes(genre))
        continue;
      const enclosure = block.match(/<enclosure[^>]+url="([^"]+)"/);
      const cover = enclosure
        ? enclosure[1]
        : `${HENTAI_BASE}/thumbnail/${slug}.webp`;
      items.push({ slug, title, pubDate, genres, cover, link });
    }
    const total = items.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const safePage = Math.min(page, totalPages);
    res.json({
      data: {
        data: items.slice((safePage - 1) * limit, safePage * limit),
        total,
        page: safePage,
        totalPages,
      },
    });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to fetch hentai list", message: err.message });
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
    res
      .status(500)
      .json({ error: "Failed to fetch genres", message: err.message });
  }
});

app.get("/hentai/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const apiRes = await fetch(
      `${HENTAI_BASE}/api?action=hentai&slug=${slug}`,
      {
        headers: { "User-Agent": "Mozilla/5.0" },
      },
    );
    if (!apiRes.ok) throw new Error(`Hentai API failed: ${apiRes.status}`);
    const json = await apiRes.json();
    const info = (json.info || [])[0] || {};
    const genres = (json.genres || []).map((g) => g.genre);
    res.json({
      data: {
        slug,
        title: info.videoname || slug,
        description: info.description || "",
        releaseDate: info.releasedate || "",
        uploadDate: info.uploaddate || "",
        cover: info.coverimg
          ? `${HENTAI_BASE}/assets/cover/${info.coverimg}`
          : `${HENTAI_BASE}/thumbnail/${slug}.webp`,
        thumbnail: `${HENTAI_BASE}/thumbnail/${slug}.webp`,
        embedUrl: `${HENTAI_BASE}/embed/${slug}`,
        genres,
        status: info.status,
      },
    });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to fetch hentai detail", message: err.message });
  }
});

// ============================================================
// JAV ENDPOINTS — powered by avdbapi.com
// ============================================================

// GET /jav/list?page=1&limit=20&type=censored
app.get("/jav/list", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const type = (req.query.type || "").toLowerCase().trim();
    const genre = (req.query.genre || "").toLowerCase().trim();

    const typeId = AVDB_TYPES[type] || "";
    const avdbUrl = typeId
      ? `${AVDB_BASE}?ac=list&t=${typeId}&pg=${page}`
      : `${AVDB_BASE}?ac=list&pg=${page}`;

    const json = await fetchJson(avdbUrl);
    let items = (json.list || []).map(normalizeItem);

    // Filter kategori manual kalau ada query genre
    if (genre) {
      items = items.filter(
        (i) =>
          i.categories.some((c) => c.toLowerCase().includes(genre)) ||
          i.type.toLowerCase().includes(genre),
      );
    }

    const total = json.total || items.length;
    const totalPages = json.pagecount || Math.ceil(total / limit) || 1;
    const sliced = items.slice(0, limit);

    res.json({ data: { data: sliced, total, page, totalPages } });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to fetch JAV list", message: err.message });
  }
});

// GET /jav/genres
app.get("/jav/genres", async (req, res) => {
  try {
    const json = await fetchJson(`${AVDB_BASE}?ac=list&pg=1`);
    const classes = json.class || [];
    const genres = classes.map((c) => c.type_name);
    res.json({ data: { genres } });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to fetch JAV genres", message: err.message });
  }
});

// GET /jav/detail/:code
app.get("/jav/detail/:code", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const json = await fetchJson(
      `${AVDB_BASE}?ac=detail&wd=${encodeURIComponent(code)}`,
    );
    const list = json.list || [];

    if (!list.length)
      return res.status(404).json({ error: "JAV not found", code });

    const exact =
      list.find(
        (i) =>
          (i.movie_code || "").toUpperCase() === code ||
          (i.slug || "").toUpperCase() === code.toLowerCase(),
      ) || list[0];

    const primary = normalizeItem(exact);
    const variants = list.map(normalizeItem);

    // Enrich dengan r18
    try {
      const contentId = code
        .toLowerCase()
        .replace(/-(\d+)$/, (_, n) => n.padStart(5, "0"));
      const r18 = await fetchJson(
        `https://r18.dev/videos/vod/movies/detail/-/dvd_id=${contentId}/json`,
      );
      if (r18.images?.jacket_image?.large2) {
        primary.thumb_url = r18.images.jacket_image.large2;
        primary.poster_url = r18.images.jacket_image.large2;
      }
      if (r18.sample?.high) primary.sample_url = r18.sample.high;
    } catch (_) {}

    res.json({ data: { ...primary, variants } });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to fetch JAV detail", message: err.message });
  }
});
// GET /jav/search?q=SSIS-392
app.get("/jav/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "Query q is required" });

    const json = await fetchJson(
      `${AVDB_BASE}?ac=detail&wd=${encodeURIComponent(q)}`,
    );
    const list = json.list || [];

    if (!list.length)
      return res.status(404).json({ error: "JAV not found", code: q });

    const primary = normalizeItem(list[0]);
    const variants = list.map(normalizeItem);

    res.json({ data: { ...primary, variants } });
  } catch (err) {
    res.status(500).json({ error: "Search failed", message: err.message });
  }
});

app.get("/jav/thumb", async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).send("url required");

    const imgRes = await fetch(url, {
      headers: {
        Referer: "https://upload18.cc/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);

    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    const buffer = await imgRes.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).send("Image fetch failed");
  }
});

app.get("/proxy/image", async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).send("url required");

    let domain;
    try {
      domain = new URL(url).hostname;
    } catch (e) {
      return res.status(400).send("Invalid URL: " + e.message);
    }

    const refererMap = {
      "upload18.cc": "https://upload18.cc/",
      "hentaiocean.com": "https://hentaiocean.com/",
      "fourhoi.com": "https://fourhoi.com/",
      "i0.wp.com": "https://hentaiocean.com/",
      "i1.wp.com": "https://hentaiocean.com/",
      "i2.wp.com": "https://hentaiocean.com/",
    };
    const referer = refererMap[domain] || `https://${domain}/`;

    const imgRes = await fetch(url, {
      headers: {
        Referer: referer,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });

    if (!imgRes.ok)
      return res.status(imgRes.status).send(`Upstream error: ${imgRes.status}`);

    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Access-Control-Allow-Origin", "*");
    const buffer = await imgRes.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).send("Image fetch failed: " + err.message);
  }
});

app.get("/jav/test-thumb", async (req, res) => {
  const r = await fetch("https://fourhoi.com/ssis-392/cover-n.jpg");
  res.json({
    status: r.status,
    headers: Object.fromEntries(r.headers.entries()),
  });
});

// GET /jav/r18?code=SSIS-392
app.get("/jav/r18", async (req, res) => {
  try {
    const code = (req.query.code || "").trim();
    if (!code) return res.status(400).json({ error: "code required" });

    // Convert SSIS-392 → ssis00392
    const contentId = code
      .toLowerCase()
      .replace(/-(\d+)$/, (_, n) => n.padStart(5, "0"));

    const json = await fetchJson(
      `https://r18.dev/videos/vod/movies/detail/-/dvd_id=${contentId}/json`,
    );

    res.json({
      data: {
        code,
        title: json.title || "",
        thumb_url: json.images?.jacket_image?.large2 || "",
        poster_url: json.images?.jacket_image?.large2 || "",
        actors: (json.actresses || []).map((a) => a.name).join(", "),
        director: json.director || "",
        categories: (json.categories || []).map((c) => c.name),
        duration: json.runtime_minutes ? `${json.runtime_minutes} min` : "",
        year: json.release_date?.split("-")[0] || "",
        pubDate: json.release_date || "",
        sample_url: json.sample?.high || "",
        label: json.label?.name || "",
        series: json.series?.name || "",
      },
    });
  } catch (err) {
    res.status(500).json({ error: "R18 fetch failed", message: err.message });
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
