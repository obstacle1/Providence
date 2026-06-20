export default async function handler(req, res) {
  // Allow CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "API key not configured" });
  }

  const { artist, medium } = req.body || {};
  if (!artist) {
    return res.status(400).json({ error: "artist is required" });
  }

  try {
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        messages: [{
          role: "user",
          content: `You are an art market expert. Based on your knowledge, provide recent comparable auction sales (2018-2025) for works by ${artist}${medium ? ` in ${medium}` : ""}.

Return ONLY a raw JSON object. No markdown, no explanation, no code fences. Start with { and end with }.

{
  "artist": "${artist}",
  "marketSummary": "2-3 sentences on recent market performance",
  "trend": "rising",
  "comparables": [
    { "title": "Work Title", "year": 1955, "medium": "Oil on canvas", "salePrice": 1200000, "auctionHouse": "Christies", "saleDate": "2023-06" }
  ],
  "lowEstimate": 500000,
  "highEstimate": 2000000,
  "notes": "Key value drivers for this artist"
}

Include 5-6 realistic comparables. trend must be rising, stable, or declining. salePrice as integer USD.`,
        }],
      }),
    });

    const data = await apiRes.json();

    if (!apiRes.ok) {
      return res.status(500).json({ error: "Anthropic API error", details: data });
    }

    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    let parsed = null;
    try { parsed = JSON.parse(cleaned); } catch (_) {}
    if (!parsed) {
      const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}");
      if (s !== -1 && e > s) { try { parsed = JSON.parse(cleaned.slice(s, e + 1)); } catch (_) {} }
    }
    if (!parsed) {
      return res.status(500).json({ error: "Parse failed", raw: cleaned.slice(0, 300) });
    }

    return res.status(200).json(parsed);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
