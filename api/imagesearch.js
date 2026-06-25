export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { title, artist } = req.body || {};
  if (!title) return res.status(400).json({ error: "title is required" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key not configured" });

  const query = `${title} ${artist || ""}`.trim();

  try {
    // Use Gemini with Google Search grounding to find real image URLs
    const prompt = `Search Google Images for: "${query} on white background"

I need exactly 4 direct image URLs (ending in .jpg, .jpeg, .png, or .webp) showing this object on a white or clean neutral background. Prefer auction house (Christie's, Sotheby's, Phillips, Bonhams), manufacturer press photos, or museum catalog images.

Return ONLY a JSON array of 4 direct image URLs. No explanation, no markdown.
["url1","url2","url3","url4"]`;

    const apiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ googleSearch: {} }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 600 },
        }),
      }
    );

    const data = await apiRes.json();

    // Extract image URLs from grounding metadata if available
    const groundingChunks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const groundingUrls = groundingChunks
      .map(c => c?.web?.uri || "")
      .filter(u => u && /\.(jpg|jpeg|png|webp)/i.test(u))
      .slice(0, 4);

    if (groundingUrls.length >= 2) {
      return res.status(200).json({ urls: groundingUrls });
    }

    // Fall back to text response parsing
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const match = text.match(/\[[\s\S]*?\]/);
    let urls = [];
    if (match) {
      try { urls = JSON.parse(match[0]); } catch (_) {}
    }
    urls = urls.filter(u => typeof u === "string" && u.startsWith("http") && /\.(jpg|jpeg|png|webp)/i.test(u)).slice(0, 4);

    if (urls.length > 0) return res.status(200).json({ urls });

    // Last resort: Wikimedia Commons API for known collectibles/art
    const wikiQuery = encodeURIComponent(query);
    const wikiRes = await fetch(
      `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${wikiQuery}&gsrnamespace=6&prop=imageinfo&iiprop=url&format=json&gsrlimit=4&origin=*`
    );
    const wikiData = await wikiRes.json();
    const wikiUrls = Object.values(wikiData?.query?.pages || {})
      .map(p => p?.imageinfo?.[0]?.url)
      .filter(u => u && /\.(jpg|jpeg|png|webp)/i.test(u))
      .slice(0, 4);

    if (wikiUrls.length > 0) return res.status(200).json({ urls: wikiUrls });

    return res.status(200).json({ urls: [], message: "No images found" });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
