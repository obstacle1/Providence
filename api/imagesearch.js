export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = "AIzaSyDxVnDt_0M40HZhWEr6e7eF05Vvp95UUxk";
  const cx = "e7403bad2277c459a";

  const { title, artist } = req.body || {};
  if (!title) return res.status(400).json({ error: "title is required" });

  const query = `${title} ${artist || ""} on white background`.trim();

  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}&searchType=image&num=4&imgSize=large&safe=active`;
    const apiRes = await fetch(url);
    const data = await apiRes.json();

    // Return full response for debugging
    if (!apiRes.ok) return res.status(200).json({ urls: [], debug: data });

    const urls = (data.items || []).map(item => item.link).filter(u => u && u.startsWith("http")).slice(0, 4);

    return res.status(200).json({ urls, debug: { total: data.searchInformation?.totalResults, itemCount: data.items?.length } });
  } catch (err) {
    return res.status(200).json({ urls: [], debug: { error: err.message } });
  }
}
