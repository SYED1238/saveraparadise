# Luxury Editorial Poster Intro Component (Taste Paradise)

This folder contains the complete, pixel-perfect, 60fps luxury editorial poster intro animation created for Savera Paradise, kept completely separate as requested.

## Assets Included:
1. `intro.html`: Complete HTML overlay markup with SVG cream honeycomb canvas, dark green sash, Bebas Neue glassmorphism headline with specular light sweep, geometric monogram badge, 4 food plate wrappers with 3D drop shadows, editorial price callouts, and auto-dismiss/click handlers.
2. `intro.css`: All styles and GPU hardware-accelerated animations (`inflow-top-dish`, `inflow-mid-left`, `inflow-mid-right`, `inflow-bottom-hero`, `glass-shine-sweep`, `hover-float-*`).
3. Dish Cutout Images: Stored in `/public/images/intro/` (`plate-biryani.webp`, `plate-bbq.webp`, `plate-seafood.webp`, `plate-kebab.webp`).

## How to Re-enable anytime:
1. In `index.html`, add the stylesheet inside `<head>`:
   ```html
   <link rel="stylesheet" href="/components/luxury-intro/intro.css">
   ```
2. Insert the markup from `intro.html` right after `<body>` in `index.html`.
3. Done!
