export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'Missing HEYGEN_API_KEY env var' });

  try {
    const r = await fetch('https://api.heygen.com/v1/streaming.create_token', {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey } // ← IMPORTANT: HeyGen expects X-Api-Key
    });
    const body = await r.json().catch(() => ({}));

    if (!r.ok) {
      // bubble up HeyGen’s error so you can see it at /api/token
      return res.status(r.status).json(body);
    }

    // Docs show token under data.token; handle both shapes just in case.
    const token = body?.data?.token || body?.token;
    if (!token) {
      return res.status(502).json({ error: 'Token missing in HeyGen response', raw: body });
    }
    return res.status(200).json({ token });
  } catch (e) {
    return res.status(500).json({ error: 'Server error', detail: String(e) });
  }
}
