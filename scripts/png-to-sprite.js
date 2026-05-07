/**
 * Converts pixel-art PNG sprites into the inline SVG format used by GopherEden.
 *
 * Usage:
 *   node scripts/png-to-sprite.js <input.png> [output.svg]
 *   node scripts/png-to-sprite.js <input-dir/>  [output-dir/]
 *
 * Examples:
 *   # Convert a single file
 *   node scripts/png-to-sprite.js media/source/gopher-normal-1.png media/pets/chaos/gopher-normal-1.svg
 *
 *   # Convert an entire folder (keeps filenames, changes extension)
 *   node scripts/png-to-sprite.js media/source/chaos/  media/pets/chaos/
 *
 * Pixels with alpha < 64 are treated as transparent and skipped.
 */

const fs   = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

function pngToSvg(pngPath) {
  const data = fs.readFileSync(pngPath);
  const png  = PNG.sync.read(data);
  const { width, height } = png;

  const rects = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (width * y + x) * 4;
      const a = png.data[i + 3];
      if (a < 64) continue;

      const r   = png.data[i].toString(16).padStart(2, '0');
      const g   = png.data[i + 1].toString(16).padStart(2, '0');
      const b   = png.data[i + 2].toString(16).padStart(2, '0');
      rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="#${r}${g}${b}"/>`);
    }
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">`,
    ...rects,
    '</svg>',
  ].join('\n');
}

function convertFile(inputPng, outputSvg) {
  const svg = pngToSvg(inputPng);
  fs.mkdirSync(path.dirname(outputSvg), { recursive: true });
  fs.writeFileSync(outputSvg, svg, 'utf8');
  console.log(`✓  ${path.relative(process.cwd(), outputSvg)}`);
}

function convertDir(inputDir, outputDir) {
  const files = fs.readdirSync(inputDir).filter(f => f.toLowerCase().endsWith('.png'));
  if (files.length === 0) {
    console.error(`No PNG files found in ${inputDir}`);
    process.exit(1);
  }
  for (const file of files) {
    const svgName = file.replace(/\.png$/i, '.svg');
    convertFile(path.join(inputDir, file), path.join(outputDir, svgName));
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
const [,, input, output] = process.argv;

if (!input) {
  console.error('Usage: node scripts/png-to-sprite.js <input.png|dir/> [output.svg|dir/]');
  process.exit(1);
}

const inputStat = fs.statSync(input);

if (inputStat.isDirectory()) {
  const outDir = output || input;
  convertDir(input, outDir);
} else {
  const outSvg = output || input.replace(/\.png$/i, '.svg');
  convertFile(input, outSvg);
}
