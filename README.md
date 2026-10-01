# Fuzzy Buddy

A soft, furry 3D character built with Three.js (r128). Drag to spin it around; its eyes follow the cursor.

## Run

Open `index.html` directly in a browser, or serve the folder:

```bash
npx serve .        # or: python3 -m http.server 8000
```

Three.js is bundled in `vendor/`, so it works offline. No build step.

## Structure

```
index.html        page shell
css/style.css     full-screen white canvas, mobile safe areas
js/main.js        character, fur shader, interaction
vendor/three.min.js
```

## Controls

- Drag left/right: spin 360° (release while moving to let it coast)
- Drag up/down: raise or lower the camera
- Arrow keys: spin and tilt

## Tuning (js/main.js)

- Fur look: `furred(bodyGeo, { len, shells, density, slant })` — `len` is fur length, `shells` is smoothness (lower it for older phones).
- Fur color: `ALBEDO` and `RIM`.
- Spin feel: the `rotV` damping in `step()` (`Math.exp(-dt * 2.2)`).
- Body shape: `ctrl` holds the silhouette traced from the reference image.
# fuzzy-buddy
