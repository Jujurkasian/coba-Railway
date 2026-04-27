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
const JAVGURU_BASE = "https://jav.guru";
const FREEJAVBT_BASE = "https://freejavbt.com/zh";

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
      const slugMatch = link.match(/\/watch\/([^/?s]+)/);
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
      { headers: { "User-Agent": "Mozilla/5.0" } },
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
// JAV ENDPOINTS
// ============================================================

// ── RSS Parser ──────────────────────────────────────────────
function parseJavGuruRss(rssText) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(rssText)) !== null) {
    const block = match[1];
    const getTag = (tag) => {
      const m = block.match(
        new RegExp(
          `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,
        ),
      );
      return m ? (m[1] || m[2] || "").trim() : "";
    };
    const link = getTag("link");
    const title = getTag("title");
    const pubDate = getTag("pubDate");
    const desc = getTag("description");

    // slug dari URL: https://jav.guru/123456/ssis-392-something/
    const slugMatch = link.match(/jav\.guru\/\d+\/([^/]+)\/?$/);
    if (!slugMatch) continue;
    const slug = slugMatch[1];

    // kode JAV dari slug
    const codeMatch = slug.match(/^([a-z]+-\d+)/i);
    if (!codeMatch) continue;
    const code = codeMatch[1].toUpperCase();

    // thumbnail dari description img
    const thumbMatch = desc.match(/<img[^>]+src="([^"]+)"/i);
    const thumbnail = thumbMatch ? thumbMatch[1] : "";

    // genres dari categories
    const genres = [];
    const catRegex = /<category><!\[CDATA\[(.*?)\]\]><\/category>/g;
    let catMatch;
    while ((catMatch = catRegex.exec(block)) !== null)
      if (catMatch[1].trim()) genres.push(catMatch[1].trim());

    items.push({ code, slug, title, pubDate, thumbnail, genres, link });
  }
  return items;
}

// ── FreeJavBT Scraper ───────────────────────────────────────
function extractBetween(text, start, end) {
  const s = text.indexOf(start);
  if (s === -1) return "";
  const after = text.slice(s + start.length);
  const e = after.indexOf(end);
  return (e === -1 ? after : after.slice(0, e)).trim();
}

function extractAllMeta(html, property) {
  const results = [];
  const r1 = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    "gi",
  );
  const r2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    "gi",
  );
  let m;
  while ((m = r1.exec(html)) !== null) results.push(m[1].trim());
  while ((m = r2.exec(html)) !== null) results.push(m[1].trim());
  return [...new Set(results)];
}

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scrapeFreeJavBT(html, code) {
  const codeUpper = code.toUpperCase();
  if (!html.toUpperCase().includes(codeUpper)) return null;

  const coverUrl = extractAllMeta(html, "og:image").find((u) => u) || "";
  const descriptions = extractAllMeta(html, "description");
  const desc =
    descriptions.find(
      (d) => d.includes("影片番号为") || d.includes("影片名是"),
    ) || "";
  const ogTitle =
    extractAllMeta(html, "og:title").find((t) =>
      t.toUpperCase().includes(codeUpper),
    ) || "";

  const title =
    extractBetween(desc, "影片名是", "，") ||
    extractBetween(desc, "影片名是", "。") ||
    ogTitle
      .replace(codeUpper, "")
      .replace(code, "")
      .replace(/[-\s]+$/, "")
      .trim() ||
    "";

  const premiered =
    extractBetween(desc, "发佈日期为", "，") ||
    extractBetween(desc, "发佈日期为", "。") ||
    (() => {
      const m = html.match(/(\d{4}-\d{2}-\d{2})/);
      return m ? m[1] : "";
    })();

  const duration =
    extractBetween(desc, "影片时长", "，") ||
    extractBetween(desc, "影片时长", "。") ||
    "";
  const actors = (
    extractBetween(desc, "主演女优是", "，") ||
    extractBetween(desc, "主演女优是", "。") ||
    ""
  ).replace(/、/g, ", ");
  const tags = (
    extractBetween(desc, "主题为", "。") ||
    extractBetween(desc, "主题为", "，") ||
    ""
  ).replace(/、/g, ", ");

  const dirMatch = html.match(
    /class="[^"]*director[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
  );
  const director = dirMatch ? stripHtml(dirMatch[1]) : "";

  const studioMatch = html.match(
    /class="[^"]*maker[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
  );
  const studio = studioMatch ? stripHtml(studioMatch[1]) : "";

  const thumbs = [];
  const thumbRegex = /data-fancybox="gallery"[^>]+href="([^"]+)"/gi;
  let tm;
  while ((tm = thumbRegex.exec(html)) !== null) thumbs.push(tm[1]);

  if (!title && !coverUrl) return null;
  if (!premiered && !duration && !director && !actors && !tags) return null;

  return {
    code: codeUpper,
    title,
    coverUrl,
    premiered,
    duration,
    actors,
    tags,
    director,
    studio,
    thumbs,
  };
}

// GET /jav/list?page=1&limit=20&genre=milf&sort=newest
app.get("/jav/list", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const genre = (req.query.genre || "").toLowerCase().trim();
    const sort = req.query.sort || "newest";

    const rssText = await fetchHtml(`${JAVGURU_BASE}/feed/`);
    let items = parseJavGuruRss(rssText);

    if (genre)
      items = items.filter((i) =>
        i.genres.map((g) => g.toLowerCase()).includes(genre),
      );
    if (sort === "oldest")
      items.sort((a, b) => new Date(a.pubDate) - new Date(b.pubDate));

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
      .json({ error: "Failed to fetch JAV list", message: err.message });
  }
});

// GET /jav/genres
app.get("/jav/genres", async (req, res) => {
  try {
    const rssText = await fetchHtml(`${JAVGURU_BASE}/feed/`);
    const items = parseJavGuruRss(rssText);
    const genreSet = new Set();
    items.forEach((i) => i.genres.forEach((g) => genreSet.add(g)));
    res.json({ data: { genres: [...genreSet].sort() } });
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

    let data = null;

    // Source 1: freejavbt
    try {
      const html = await fetchHtml(`${FREEJAVBT_BASE}/${code}`, {
        Referer: "https://freejavbt.com/",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      });
      data = scrapeFreeJavBT(html, code);
    } catch (e) {
      console.warn(`[freejavbt] failed for ${code}:`, e.message);
    }

    // Fallback: minimal data dari RSS jav.guru
    if (!data) {
      try {
        const rssText = await fetchHtml(`${JAVGURU_BASE}/feed/`);
        const items = parseJavGuruRss(rssText);
        const found = items.find((i) => i.code === code);
        if (found) {
          data = {
            code,
            title: found.title,
            coverUrl: found.thumbnail,
            premiered: found.pubDate
              ? new Date(found.pubDate).toISOString().split("T")[0]
              : "",
            duration: "",
            actors: "",
            tags: found.genres.join(", "),
            director: "",
            studio: "",
            thumbs: [],
          };
        }
      } catch (e) {
        console.warn(`[javguru rss fallback] failed:`, e.message);
      }
    }

    if (!data) return res.status(404).json({ error: "JAV not found", code });
    res.json({ data });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to fetch JAV detail", message: err.message });
  }
});

// GET /jav/search?q=SSIS-392
app.get("/jav/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim().toUpperCase();
    if (!q) return res.status(400).json({ error: "Query q is required" });

    let data = null;

    try {
      const html = await fetchHtml(`${FREEJAVBT_BASE}/${q}`, {
        Referer: "https://freejavbt.com/",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      });
      data = scrapeFreeJavBT(html, q);
    } catch (e) {
      console.warn(`[freejavbt search] failed for ${q}:`, e.message);
    }

    if (!data) return res.status(404).json({ error: "JAV not found", code: q });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: "Search failed", message: err.message });
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
