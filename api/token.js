export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'Missing HEYGEN_API_KEY env var' });
  try {
    const r = await fetch('https://api.heygen.com/v1/streaming.create_token', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: 'Failed to create token', detail: data });
    return res.status(200).json(data); // { token: "..." }
  } catch (e) {
    return res.status(500).json({ error: 'Server error', detail: String(e) });
  }
}
