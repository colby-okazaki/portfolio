# Colby Okazaki — Portfolio

**Live site: [colby-okazaki.github.io/portfolio](https://colby-okazaki.github.io/portfolio/)**

My personal portfolio site: a 3D board-game world where a voxel car drives a lap of a looping path of coloured spaces as you scroll, past signs for each section, with the content on game cards and an in-page resume viewer.

Built with plain HTML, CSS and JavaScript ([three.js](https://threejs.org/) for the board in `world.js`, [PDF.js](https://mozilla.github.io/pdf.js/) for the resume). No build step.

The voxel models (car, houses, trees, windmill, dice and so on) are generated in Blender by `blender/build_models.py` and exported to `models/world.glb`. To change a model, edit the script and re-run it:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --python blender/build_models.py
```

## Run locally

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765.

## Updating

- **Resume:** replace `resume.pdf` with the new PDF (keep the same name).
- **Projects:** edit the cards in the `#projects` section of `index.html`.
