# Colby Okazaki — Portfolio

**Live site: [colby-okazaki.github.io/portfolio](https://colby-okazaki.github.io/portfolio/)**

My personal portfolio, built as a 3D board game. A voxel car drives around a looping road of coloured spaces as you scroll, stopping at a sign for each section: Experience, Projects, Skills and Contact. The content sits on game cards over the board, and the resume opens in an in-page viewer instead of downloading.

## How it works

- **The board** (`world.js`) is a [three.js](https://threejs.org/) scene. The car's place on the road follows the scroll position, and the rest of the scene is positioned from the car, so it looks the same whichever way you scroll. A Pause button holds the board still while the page scrolls on its own. For visitors with reduced motion turned on, the background animation stops and the car moves with the scroll without easing.
- **The models** (car, houses, trees, windmill, dice and so on) are made in Blender by `blender/build_models.py` and exported to `models/world.glb`.
- **The resume** is rendered on the page with [PDF.js](https://mozilla.github.io/pdf.js/).
- **Project pages** in `projects/` give each project more detail, linked from its card. They share `projects/project.css`.

Plain HTML, CSS and JavaScript, with no build step. three.js and PDF.js load from a CDN.

## Run locally

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765. The page has to be served over HTTP, not opened as a file, because the board loads `world.js` as a module and fetches the model file.

## Updating

- **Resume:** replace `resume.pdf` with the new PDF, keeping the same name.
- **Projects:** edit the cards in the `#projects` section of `index.html` and the matching page in `projects/`.
- **Screenshots:** project images live in `images/`. `images/preview.jpg` is the link preview shown when the site is shared.
- **Models:** edit `blender/build_models.py`, then rebuild `models/world.glb`:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --python blender/build_models.py
```
