// Thèmes visuels. Couleurs en hexadécimal sRGB.
export const THEMES = {
  bois: {
    id: 'bois',
    label: 'Bois classique',
    squareStyle: 'wood',
    light: [0xe8cfa0, 0xc9a26a],   // érable
    dark: [0x6b3f22, 0x3a1f10],    // noyer
    frameStyle: 'wood',
    frameLight: 0x4a2a16,
    frameDark: 0x24120a,
    frameSide: 0x2a170c,
    inlay: '#d9b56a',
    whitePiece: { color: 0xf1e3c4, grainA: 0xeadcbc, grainB: 0xcdb58c, roughness: 0.34 },
    blackPiece: { color: 0x2a1a12, grainA: 0x2e1d14, grainB: 0x120a06, roughness: 0.26 },
  },
  marbre: {
    id: 'marbre',
    label: 'Marbre et ébène',
    squareStyle: 'marble',
    light: [0xf2efe9, 0x9a948c],
    dark: [0x1d2420, 0x56645c],
    frameStyle: 'wood',
    frameLight: 0x231712,
    frameDark: 0x0c0806,
    frameSide: 0x120c09,
    inlay: '#cfae62',
    whitePiece: { color: 0xf4efe6, grainA: 0xfaf7f1, grainB: 0xe0d9cc, roughness: 0.22 },
    blackPiece: { color: 0x15100d, grainA: 0x1a1410, grainB: 0x050403, roughness: 0.2 },
  },
};
