export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "API key not configured" });
  }

  const { artist, medium, category } = req.body;
  if (!artist) {
    return res.status(400).json({ error: "artist is required" });
  }

  try {
    // Step 1: web search for auction results
    const searchRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{
          role: "user",
          content: `Search for recent auction results (2020–2025) for works by ${artist}${medium ? `, particularly ${medium}` : ""} works. Find 5–7 real hammer prices from Christie's, Sotheby's, Phillips, or Bonhams. List each result with: work title, year made, medium, sale price in USD, auction house, and sale date (YYYY-MM format). Also note the general market trend (rising/stable/declining) and what drives value for this artist.`,
        }],
      }),
    });

    const searchData = await searchRes.json();
    const searchText = (searchData.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (!searchText) throw new Error("No search results returned");

    // Step 2: convert to JSON
    const jsonRes = await fetch("https://api.anthropic.com/v1/messages", {
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
          content: `Convert the following auction research into a JSON object. Return ONLY the JSON — no explanation, no markdown, no code fences. Start with { and end with }.

Research:
${searchText}

Required JSON shape:
{
  "artist": "${artist}",
  "marketSummary": "2-3 sentence summary of market performance",
  "trend": "rising",
  "comparables": [
    { "title": "Work Title", "year": 1955, "medium": "Oil on canvas", "salePrice": 1200000, "auctionHouse": "Christie's", "saleDate": "2023-06" }
  ],
  "lowEstimate": 500000,
  "highEstimate": 2000000,
  "notes": "Key value drivers"
}

Rules: trend must be "rising", "stable", or "declining". salePrice in USD as a number. Return only the JSON object.`,
        }],
      }),
    });

    const jsonData = await jsonRes.json();
    const jsonText = (jsonData.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    // Parse JSON from response
    const cleaned = jsonText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    let parsed = null;
    try { parsed = JSON.parse(cleaned); } catch (_) {}
    if (!parsed) {
      const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}");
      if (s !== -1 && e > s) { try { parsed = JSON.parse(cleaned.slice(s, e + 1)); } catch (_) {} }
    }
    if (!parsed) throw new Error("Could not parse response");

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
