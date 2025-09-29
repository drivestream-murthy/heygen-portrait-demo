# Avatar Gen — Server Build Only

Run with a local server (loads /config/*.json).

## Run
- Python: `python -m http.server 5500` → http://localhost:5500/
- VS Code: Open with Live Server

## Edit
- `config/content.json` → modules (use **script** for speech content)
- `config/links.json` → top-right links

Includes 30s idle timeout + 10s confirm, and a browser **TTS fallback** (no credits). Replace `window.AvatarBridge` in `js/app.js` with HeyGen Streaming to use credits.
