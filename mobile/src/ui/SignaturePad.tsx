import { useEffect, useMemo, useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { radius, useColors } from '@/theme/tokens';
import { Button, Row, Text } from './index';

const W = 600, H = 200;
const STROKE = '#14243A';

export const toSvg = (paths: string[]) =>
  paths.length ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${paths.map(d => `<path d="${d}" stroke="${STROKE}" stroke-width="4" fill="none" stroke-linecap="round"/>`).join('')}</svg>` : null;

// Firma con el dedo. Se envía como SVG (trazo vectorial): pesa poco y no necesita librerías nativas extra.
// `onChange` recibe la firma al terminar cada trazo (o null si se borra); conviene pasar una función estable.
export function SignaturePad({ onChange }: { onChange: (svg: string | null) => void }) {
  const c = useColors();
  const [paths, setPaths] = useState<string[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [size, setSize] = useState({ w: 1, h: 1 });

  const responder = useMemo(() => {
    const point = (x: number, y: number) => `${Math.round((x / size.w) * W)} ${Math.round((y / size.h) * H)}`;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: e => { setDrawing(true); setPaths(ps => [...ps, `M${point(e.nativeEvent.locationX, e.nativeEvent.locationY)}`]); },
      onPanResponderMove: e => setPaths(ps => (ps.length ? [...ps.slice(0, -1), `${ps[ps.length - 1]} L${point(e.nativeEvent.locationX, e.nativeEvent.locationY)}`] : ps)),
      onPanResponderRelease: () => setDrawing(false),
      onPanResponderTerminate: () => setDrawing(false),
    });
  }, [size]);

  // Se notifica al soltar el dedo, no en cada punto, para no re-renderizar el formulario mientras se dibuja.
  useEffect(() => { if (!drawing) onChange(toSvg(paths)); }, [drawing, paths, onChange]);

  return (
    <View style={{ gap: 8 }}>
      <View testID="signature-pad" {...responder.panHandlers}
        onLayout={e => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        style={{ aspectRatio: 3, backgroundColor: '#FFFFFF', borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.line, overflow: 'hidden' }}>
        <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} pointerEvents="none">
          {paths.map((d, i) => <Path key={i} d={d} stroke={STROKE} strokeWidth={4} fill="none" strokeLinecap="round" />)}
        </Svg>
      </View>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="tiny" muted>Firma con el dedo dentro del recuadro.</Text>
        <Button small kind="line" title="Borrar" onPress={() => setPaths([])} />
      </Row>
    </View>
  );
}
