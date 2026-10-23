// WCAG 2.x contrast checker for the theme tokens. Run: node scripts/contrast.mjs
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const themes = {
  dark: {
    bg: '#0b1613', surface: '#12251f', surface2: '#19342b', text: '#E3D9D5', muted: '#A9B9B2',
    primary: '#376D5F', onPrimary: '#F4EEEA', link: '#7CC4AF', accent: '#E0958A', accentSolid: '#91453B', onAccent: '#F4EEEA',
  },
  light: {
    bg: '#EEE7E3', surface: '#F7F3F0', surface2: '#E3D9D5', text: '#2A1612', muted: '#6E5449',
    primary: '#22443B', onPrimary: '#F7F3F0', link: '#22443B', accent: '#91453B', accentSolid: '#91453B', onAccent: '#F7F3F0',
  },
};
const pairs = [
  ['text', 'bg', 4.5], ['text', 'surface', 4.5], ['text', 'surface2', 4.5],
  ['muted', 'bg', 4.5], ['muted', 'surface', 4.5], ['muted', 'surface2', 4.5],
  ['onPrimary', 'primary', 4.5], ['link', 'bg', 4.5], ['link', 'surface', 4.5],
  ['accent', 'bg', 4.5], ['accent', 'surface', 4.5], ['accent', 'surface2', 4.5], ['onAccent', 'accentSolid', 4.5],
  ['primary', 'bg', 3],
];
let fail = 0;
for (const [name, t] of Object.entries(themes)) {
  for (const [fg, bg, min] of pairs) {
    const r = ratio(t[fg], t[bg]);
    const ok = r >= min;
    if (!ok) fail++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(5)} ${fg.padEnd(9)} on ${bg.padEnd(8)} ${r.toFixed(2)} (min ${min})`);
  }
}
process.exit(fail ? 1 : 0);
