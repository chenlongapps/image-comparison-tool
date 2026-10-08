<h1 align="center">Image Comparison Tool</h1>

<p align="center">A minimal, desktop-focused tool for comparing images, animations, and videos side by side.</p>

<p align="center">
  <a href="https://github.com/chenlongapps/image-comparison-tool/actions/workflows/nextjs.yml"><img alt="GitHub Pages deployment" src="https://img.shields.io/github/actions/workflow/status/chenlongapps/image-comparison-tool/nextjs.yml?style=flat-square&amp;branch=main&amp;label=deploy" /></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-yellow?style=flat-square" /></a>
</p>

<p align="center">
  <strong>English</strong> | <a href="README.zh-CN.md">简体中文</a><br />
  <a href="https://chenlongapps.github.io/image-comparison-tool/">Live Demo</a> | <a href="https://image-compare.chenlong716.dpdns.org/">Mirror</a>
</p>

[![Image Comparison Tool preview](image.png)](https://chenlongapps.github.io/image-comparison-tool/)

---

## Features

- Compare images, GIF, APNG, animated WebP, and videos in any combination.
- Linked zoom and pan, with independent views for alignment when unlocked.
- Playback and timeline controls for animations and videos.
- Drag-and-drop, file picker, and clipboard paste.
- Local processing in your browser — no file uploads to a server.
- Automatic dark mode and English / 简体中文 interface.

## Usage

Drop a file onto each panel, click to select, or paste with `Ctrl+V` / `Cmd+V`.

| Action | Control |
| --- | --- |
| Pan | Drag or two-finger swipe; arrow keys in image-only mode |
| Zoom | Mouse wheel, pinch, or `+` / `−` buttons (0.1×–10×) |
| Play / pause | Playback button or `Space` |
| Seek | Timeline or `←` / `→` in 0.5-second steps |
| Reset / clear | Reset restores the view and pauses at the start; Clear removes both files |

Use the lock button to link both panels or control them independently. Linked playback shares play/pause and seeks by the same percentage of each file's duration, not absolute time. Speed, loop counts, and natural endings remain independent.

<details>
<summary>Animation and clipboard notes</summary>

- Animations load paused on the first frame; single-frame animations behave like static images. Each timeline represents one loop.
- Paste fills an empty panel first, otherwise replaces the left panel. Animation is preserved only when the clipboard provides the original file; a bitmap is treated as a static image.
- Animation frames are decoded on demand, limited to 4 million pixels and 4096 pixels per side. Labels show original dimensions. Seeking may take a moment, and downsampling reduces fine detail. Decode failures keep the previously loaded media.
- Video mute affects only that panel.

</details>

## Development

Recommended: Node.js 22 LTS (22.12+ within the 22.x series) and npm. Built with Next.js, React, and TypeScript.

```bash
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000).

Checks, build, and production preview:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
npm start
```

Production builds export static files to `out/`, including the animated WebP decoder. For a subpath such as GitHub Pages:

```bash
NEXT_PUBLIC_BASE_PATH=/image-comparison-tool npm run build
```

See the [GitHub Pages workflow](.github/workflows/nextjs.yml) for deployment.

## License

[MIT](LICENSE)
