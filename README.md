# MovieBox (Morphe Edition) for Samsung Tizen TV (TizenBrew)

A complete Samsung Tizen TV port of the popular **MovieBox (Morphe VIP Edition)** streaming experience, built as a native [TizenBrew](https://github.com/reisxd/TizenBrew) `"app"` module with a local background Node.js service (`service/service.js`) for CORS-free stream proxying, header spoofing, ad-blocking, multi-server 1080p stream resolution, and Arabic & English subtitle integration.

---

## Features

- **10-Foot Television Interface (MovieBox Morphe Design)**:
  - Dark cinema aesthetic (`#08080C`) with signature Morphe VIP Gold/Amber (`#FFB800`) and Crimson (`#E50914`) accents.
  - Full D-pad spatial navigation with high-visibility glowing focus states designed specifically for Samsung Smart TV remotes.
- **Hero Spotlight & Curated Feeds**:
  - Live **Morphe Spotlight** hero banner showcasing the #1 trending title with backdrop art, IMDb ratings, and 1-click instant playback.
  - Curated horizontal rows: 🔥 *Trending Today*, 🍿 *Popular Movies*, 📺 *Binge-Worthy TV Series*, 💥 *Action*, 🚀 *Sci-Fi*, 🎌 *Anime & Animation*, and 🕒 *Continue Watching*.
- **Full TV Series & Episodes Drawer**:
  - Season tabs (`Season 1`, `Season 2`, ...) and horizontal episode cards with episode titles, release dates, and instant server selection.
- **True 1080p Full HD Playback Engine**:
  - Built-in hardware-accelerated HLS/DASH video player (`hls.js` + `dash.js` + HTML5 video).
  - Automatically locks to **1080p FHD** (highest manifest level) upon stream load rather than defaulting to 720p.
- **Multi-Server VIP Streaming**:
  - ⚡ **VIP Server 1 (FastStream 1080p)**: Direct multi-audio HLS.
  - ⚡ **VIP Server 2 (VidLink Pro 1080p)**: High-speed cloud player.
  - ⚡ **VIP Server 3 (VidSrc Cloud)**: Multi-source backup.
  - ⚡ **VIP Server 4 (AutoEmbed VIP)**: Multi-language audio and captions.
- **Automatic Arabic & English Subtitles**:
  - Integrated OpenSubtitles engine that automatically queries and renders matching Arabic (`ara`) and English (`eng`) subtitles with live sync.
- **On-Screen TV Keyboard**:
  - Clean on-screen TV keypad with auto-complete search as you type.
- **Watchlist & Continue Watching**:
  - Remembers your exact playback position across sessions.

---

## Remote Control Guide

| Button on Remote | Screen / Mode | Action |
| :--- | :--- | :--- |
| **D-Pad (Arrows)** | UI / Menus | Navigate cards, buttons, tabs, and keyboard |
| **OK / Enter** | UI / Menus | Open detail, select episode, trigger search |
| **D-Pad Left / Right** | Video Player | Fast seek backward / forward (±10s) |
| **D-Pad Up / Down** | Video Player | Show / Toggle Player Controls & OSD |
| **Media Play / Pause** | Video Player | Play / Pause video |
| **Return / Back** | Anywhere | Close modal, exit player, or focus top navigation |
| **Red (`ColorF0Red`)** | Anywhere | Jump directly to **Search** |
| **Blue (`ColorF3Blue`)** | Anywhere | Jump directly to **My Watchlist** |
| **Green (`ColorF1Green`)** | In-App Browser | Toggle Virtual Pointer on/off |

---

## Installation via TizenBrew

1. Open **TizenBrew** on your Samsung TV.
2. Navigate to **Module Manager** → **Add Module**.
3. Enter your GitHub repository path:
   ```text
   gh/iHosam/moviebox-tizenbrew
   ```
4. Click **Install**. TizenBrew fetches `package.json` and registers MovieBox with its background proxy service and TV remote keybindings.
5. Launch **MovieBox** from your TizenBrew home screen!

---

## Local Testing (PC Browser + Node.js)

You can run and preview the app locally before pushing updates to GitHub:

```bash
# 1. Start the background service (port 8087)
node service/service.js

# 2. Serve the app directory on any HTTP port
npx serve app -l 8080
```
Open `http://localhost:8080` in Chrome and use your keyboard Arrow keys, Enter, and Escape to navigate.
