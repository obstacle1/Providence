export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { title, artist } = req.body || {};
  if (!title) return res.status(400).json({ error: "title is required" });

  const query = `${title} ${artist || ""}`.trim();
  const encoded = encodeURIComponent(query);

  try {
    // Unsplash Source API - no key needed, returns redirect to real image
    // Generate 4 different seeds for variety
    const seeds = [1, 2, 3, 4];
    const urls = seeds.map(seed => 
      `https://source.unsplash.com/400x400/?${encoded}&sig=${seed}`
    );

    // Resolve the redirects to get actual image URLs
    const resolved = await Promise.all(urls.map(async (url) => {
      try {
        const r = await fetch(url, { redirect: "follow" });
        return r.url || url;
      } catch {
        return url;
      }
    }));

    return res.status(200).json({ urls: resolved });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
