export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { title, artist } = req.body || {};
  if (!title) return res.status(400).json({ error: "title is required" });

  const query = encodeURIComponent(`${title} ${artist || ""} on white background`.trim());

  try {
    // Use Bing Image Search scrape (no API key needed)
    const response = await fetch(
      `https://www.bing.com/images/search?q=${query}&form=HDRSC2&first=1&tsc=ImageHoverTitle`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        }
      }
    );

    const html = await response.text();

    // Extract image URLs from Bing's murl (media URL) fields
    const murlMatches = [...html.matchAll(/"murl":"([^"]+)"/g)];
    const urls = murlMatches
      .map(m => m[1])
      .filter(u => u && u.startsWith("http") && /\.(jpg|jpeg|png|webp)/i.test(u))
      .slice(0, 4);

    if (urls.length > 0) return res.status(200).json({ urls });

    // Fallback: extract from imgurl parameter
    const imgurlMatches = [...html.matchAll(/imgurl=([^&"]+)/g)];
    const fallbackUrls = imgurlMatches
      .map(m => decodeURIComponent(m[1]))
      .filter(u => u && u.startsWith("http") && /\.(jpg|jpeg|png|webp)/i.test(u))
      .slice(0, 4);

    return res.status(200).json({ urls: fallbackUrls });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
