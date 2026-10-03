import { useColorScheme } from 'react-native';

// Paleta «Sereno» del prototipo: azul suave que transmite calma; textos azules más oscuros para el contraste.
const light = {
  bg: '#F1F6FB', surface: '#F8FBFE', card: '#FFFFFF', ink: '#1F2F43', muted: '#5C6E83', line: '#DCE6F0',
  brand: '#40739F', brandText: '#2D5A82', brandSoft: '#E4EEF7', brandInk: '#FFFFFF',
  accent: '#D9932B', accentSoft: '#FBEED8',
  ok: '#2B7A4B', okSoft: '#DDF0E3', warn: '#A86A12', warnSoft: '#FBEED5', danger: '#C2412D', dangerSoft: '#F8E1DC',
};
const dark: typeof light = {
  bg: '#0D131B', surface: '#121A24', card: '#18222E', ink: '#E3EAF2', muted: '#9AABBD', line: '#27354A',
  brand: '#93B8DA', brandText: '#A9C8E5', brandSoft: '#1E3247', brandInk: '#0A1622',
  accent: '#F0B357', accentSoft: '#3A2C14',
  ok: '#5CC28A', okSoft: '#173826', warn: '#E3A94C', warnSoft: '#3A2D14', danger: '#F07C66', dangerSoft: '#3E1F19',
};
export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { sm: 10, md: 14, lg: 18, pill: 999 } as const;
export const font = { title: 24, h2: 18, body: 15, small: 13, tiny: 11.5 } as const;
