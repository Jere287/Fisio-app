import type { ColorValue } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

// Íconos de las pestañas, dibujados en SVG (sin librerías de íconos).
type P = { color: ColorValue; size?: number };
const base = (size: number, color: ColorValue) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const });

export const SearchIcon = ({ color, size = 24 }: P) => <Svg {...base(size, color)}><Circle cx={11} cy={11} r={6.5} /><Path d="M20 20l-4.2-4.2" /></Svg>;
export const CalendarIcon = ({ color, size = 24 }: P) => <Svg {...base(size, color)}><Rect x={3.5} y={5} width={17} height={15.5} rx={2} /><Path d="M3.5 10h17M8 3v4M16 3v4" /></Svg>;
export const HeartIcon = ({ color, size = 24 }: P) => <Svg {...base(size, color)}><Path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 3c0 5.4-7.5 10-7.5 10z" /></Svg>;
export const UserIcon = ({ color, size = 24 }: P) => <Svg {...base(size, color)}><Circle cx={12} cy={8} r={4} /><Path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></Svg>;
export const WalletIcon = ({ color, size = 24 }: P) => <Svg {...base(size, color)}><Rect x={3} y={6} width={18} height={14} rx={2} /><Path d="M3 10h18M16 15h2" /></Svg>;
export const InboxIcon = ({ color, size = 24 }: P) => <Svg {...base(size, color)}><Path d="M3 13l3-8h12l3 8v6H3z" /><Path d="M3 13h5l1 2h6l1-2h5" /></Svg>;
