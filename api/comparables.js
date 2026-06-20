export default async function handler(req, res) {
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

  const HEADERS = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "web-search-2025-03-05",
  };

  try {
    // Step 1: search
    const searchRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{
          role: "user",
          content: `Search for recent auction results (2020-2025) for works by ${artist}${medium ? `, particularly ${medium}` : ""}. Find 5-7 real hammer prices from Christie's, Sotheby's, Phillips, or Bonhams. List each result with: work title, year made, medium, sale price in USD, auction house, and sale date (YYYY-MM format). Note the market trend (rising/stable/declining) and what drives value for this artist.`,
        }],
      }),
    });

    const searchData = await searchRes.json();

    if (!searchRes.ok) {
      return res.status(500).json({ error: `Search API error: ${JSON.stringify(searchData)}` });
    }

    const searchText = (searchData.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (!searchText) {
      return res.status(500).json({ error: "No text in search response" });
    }

    // Step 2: extract JSON
    const jsonRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        messages: [{
          role: "user",
          content: `Convert this auction research into a JSON object. Return ONLY raw JSON, no markdown, no explanation. Start with { end with }.

Research:
${searchText}

Shape:
{
  "artist": "${artist}",
  "marketSummary": "2-3 sentences on market performance",
  "trend": "rising",
  "comparables": [
    { "title": "Work Title", "year": 1955, "medium": "Oil on canvas", "salePrice": 1200000, "auctionHouse": "Christies", "saleDate": "2023-06" }
  ],
  "lowEstimate": 500000,
  "highEstimate": 2000000,
  "notes": "Key value drivers"
}

trend must be rising, stable, or declining. salePrice as USD number. Return only JSON.`,
        }],
      }),
    });

    const jsonData = await jsonRes.json();

    if (!jsonRes.ok) {
      return res.status(500).json({ error: `JSON API error: ${JSON.stringify(jsonData)}` });
    }

    const jsonText = (jsonData.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const cleaned = jsonText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    let parsed = null;
    try { parsed = JSON.parse(cleaned); } catch (_) {}
    if (!parsed) {
      const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}");
      if (s !== -1 && e > s) { try { parsed = JSON.parse(cleaned.slice(s, e + 1)); } catch (_) {} }
    }
    if (!parsed) {
      return res.status(500).json({ error: "Could not parse JSON", raw: cleaned.slice(0, 200) });
    }

    return res.status(200).json(parsed);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
