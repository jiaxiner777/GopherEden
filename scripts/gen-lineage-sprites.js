/**
 * Generates pixel-art SVG sprites for concurrency, protocols, and chaos lineages
 * by applying color mappings to the primitives sprite data and adding lineage extras.
 */

const fs = require('fs');
const path = require('path');

// ─── Source frames (read all 6 from primitives) ───────────────────────────────
const PRIM_DIR = path.join(__dirname, '../media/pets/primitives');
const frames = {
  'normal-1':  fs.readFileSync(path.join(PRIM_DIR, 'gopher-normal-1.svg'), 'utf8'),
  'normal-2':  fs.readFileSync(path.join(PRIM_DIR, 'gopher-normal-2.svg'), 'utf8'),
  'working-1': fs.readFileSync(path.join(PRIM_DIR, 'gopher-working-1.svg'), 'utf8'),
  'working-2': fs.readFileSync(path.join(PRIM_DIR, 'gopher-working-2.svg'), 'utf8'),
  'alert-1':   fs.readFileSync(path.join(PRIM_DIR, 'gopher-alert-1.svg'), 'utf8'),
  'alert-2':   fs.readFileSync(path.join(PRIM_DIR, 'gopher-alert-2.svg'), 'utf8'),
};

// ─── Color maps ───────────────────────────────────────────────────────────────
// Primitives colors (from → to):
//  #8ad6c3  leaf/ear accessory
//  #6f9dcb  body primary (darker blue)
//  #8ebde9  body secondary (lighter blue)
//  #c5e2ff  body highlight (very light blue)
//  #2d405c  dark outline

const lineageColorMaps = {
  concurrency: {
    '#8ad6c3': '#f5e642',  // mint leaf → yellow hair spikes
    '#6f9dcb': '#2d80d8',  // body primary → bright blue
    '#8ebde9': '#5aaff5',  // body light → bright light blue
    '#c5e2ff': '#a0d4ff',  // body highlight → bright highlight
    '#2d405c': '#1a2c40',  // outline → deeper dark
  },
  protocols: {
    '#8ad6c3': '#556677',  // mint leaf → gray-blue (no leaf accessory on protocols)
    '#6f9dcb': '#7a8fa4',  // body → muted blue-gray
    '#8ebde9': '#9ab0c4',  // body light → lighter muted
    '#c5e2ff': '#c4d6e4',  // body highlight → pale gray-blue
    '#2d405c': '#334455',  // outline → similar neutral dark
  },
  chaos: {
    '#8ad6c3': '#d44ab0',  // mint leaf → magenta hair
    '#6f9dcb': '#4e1f6e',  // body → deep purple
    '#8ebde9': '#7a3a9a',  // body light → medium purple
    '#c5e2ff': '#b07acc',  // body highlight → light purple
    '#2d405c': '#1e0a2e',  // outline → very dark purple
  },
};

// ─── Lineage-specific extra pixels ────────────────────────────────────────────
// These are added AFTER the base color-swap to give each lineage a unique touch.

/**
 * Returns extra SVG rect elements for each lineage.
 * @param {string} lineage
 * @param {string} frameKey  e.g. 'normal-1'
 */
function getExtras(lineage, frameKey) {
  const rects = [];
  function r(x, y, fill) {
    rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`);
  }

  if (lineage === 'concurrency') {
    // Headphone left cup (cyan) at left side
    r(6, 10, '#00ccff'); r(6, 11, '#00ccff'); r(6, 12, '#00ccff');
    r(7, 9, '#00ccff');  r(7, 13, '#00ccff');
    // Headphone right cup
    r(25, 10, '#00ccff'); r(25, 11, '#00ccff'); r(25, 12, '#00ccff');
    r(24, 9, '#00ccff');  r(24, 13, '#00ccff');
    // Headphone band (thin arc at top)
    r(8, 7, '#1a2c40'); r(9, 6, '#1a2c40'); r(10, 5, '#1a2c40');
    r(22, 7, '#1a2c40'); r(23, 6, '#1a2c40'); r(22, 5, '#1a2c40');
    // For working frames, add speed streak
    if (frameKey.startsWith('working')) {
      r(26, 14, '#00ccff'); r(27, 14, '#00ccff');
      r(26, 15, '#00ccff');
    }
  }

  if (lineage === 'protocols') {
    // Glasses: left lens rim (dark frame around eye zone at y=13-15, x=10-13)
    r(10, 12, '#334455'); r(13, 12, '#334455');
    r(10, 15, '#334455'); r(13, 15, '#334455');
    // Right lens
    r(18, 12, '#334455'); r(21, 12, '#334455');
    r(18, 15, '#334455'); r(21, 15, '#334455');
    // Glasses bridge connector
    r(14, 13, '#334455'); r(15, 13, '#334455'); r(16, 13, '#334455'); r(17, 13, '#334455');
    // Bowtie at neck (y=17, center)
    r(13, 17, '#6688aa'); r(14, 17, '#6688aa'); r(15, 17, '#aaccdd');
    r(16, 17, '#aaccdd'); r(17, 17, '#6688aa'); r(18, 17, '#6688aa');
  }

  if (lineage === 'chaos') {
    // Extra wild hair spikes (asymmetric)
    r(10, 3, '#d44ab0'); r(11, 2, '#d44ab0'); r(10, 1, '#d44ab0');
    r(22, 2, '#d44ab0'); r(23, 3, '#d44ab0');
    r(9, 4, '#ee66cc'); r(24, 4, '#ee66cc');
    // Glitch pixels (scattered in body area)
    r(14, 15, '#ff3399'); r(18, 12, '#44ffcc');
    r(16, 19, '#ff3399'); r(11, 22, '#44ffcc');
    // Purple glow outline at side for working
    if (frameKey.startsWith('working')) {
      r(5, 14, '#d44ab0'); r(5, 15, '#d44ab0');
      r(26, 14, '#d44ab0');
    }
  }

  return rects.join('\n');
}

// ─── Apply color map to SVG source ────────────────────────────────────────────
function applyColorMap(svgSrc, colorMap) {
  let result = svgSrc;
  // Sort by length descending to avoid partial replacements
  const entries = Object.entries(colorMap).sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of entries) {
    // Replace all occurrences of the hex color in fill attributes (case-insensitive)
    const escaped = from.replace(/#/g, '#');
    result = result.split(`fill="${from}"`).join(`fill="${to}"`);
    // Also handle uppercase
    result = result.split(`fill="${from.toUpperCase()}"`).join(`fill="${to}"`);
  }
  return result;
}

// ─── Main generation ──────────────────────────────────────────────────────────
const MEDIA_DIR = path.join(__dirname, '../media/pets');

for (const [lineage, colorMap] of Object.entries(lineageColorMaps)) {
  const outDir = path.join(MEDIA_DIR, lineage);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  for (const [frameKey, srcSvg] of Object.entries(frames)) {
    // Apply color substitution
    let svg = applyColorMap(srcSvg, colorMap);

    // Insert extras before closing </svg>
    const extras = getExtras(lineage, frameKey);
    if (extras) {
      svg = svg.replace('</svg>', extras + '\n</svg>');
    }

    const outFile = path.join(outDir, `gopher-${frameKey}.svg`);
    fs.writeFileSync(outFile, svg, 'utf8');
    console.log(`✓  ${lineage}/gopher-${frameKey}.svg`);
  }
}

console.log('\nDone! Generated 18 sprite files.');
