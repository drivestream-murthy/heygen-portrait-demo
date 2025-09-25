export default function handler(req, res) {
  const k = process.env.HEYGEN_API_KEY || "";
  res.json({ present: !!k, length: k.length, startsWith: k.slice(0,4) });
}
