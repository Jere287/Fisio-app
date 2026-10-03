import { forwardRef, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text as RNText, TextInput, View, type TextInputProps, type TextProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { font, radius, space, useColors, type Colors } from '@/theme/tokens';

// ---------- Estructura ----------
export function Screen({ children, scroll = true, testID }: { children: ReactNode; scroll?: boolean; testID?: string }) {
  const c = useColors();
  const body = <View style={{ padding: space.lg, gap: space.lg, width: '100%', maxWidth: 760, alignSelf: 'center' }}>{children}</View>;
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: c.surface }} testID={testID}>
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: space.xl * 2 }}>{body}</ScrollView> : body}
    </SafeAreaView>
  );
}

export function Row({ children, style, gap = space.sm }: { children: ReactNode; style?: ViewStyle; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap, flexWrap: 'wrap' }, style]}>{children}</View>;
}

export function Stack({ children, gap = space.sm, style }: { children: ReactNode; gap?: number; style?: ViewStyle }) {
  return <View style={[{ gap }, style]}>{children}</View>;
}

// ---------- Texto ----------
type Variant = 'title' | 'h2' | 'body' | 'small' | 'tiny' | 'label';
export function Text({ variant = 'body', muted, color, style, ...rest }: TextProps & { variant?: Variant; muted?: boolean; color?: keyof Colors }) {
  const c = useColors();
  const v: Record<Variant, object> = {
    title: { fontSize: font.title, fontWeight: '800', letterSpacing: -0.3 },
    h2: { fontSize: font.h2, fontWeight: '700' },
    body: { fontSize: font.body, lineHeight: 21 },
    small: { fontSize: font.small, lineHeight: 18 },
    tiny: { fontSize: font.tiny, lineHeight: 16 },
    label: { fontSize: font.small, fontWeight: '600' },
  };
  return <RNText {...rest} style={[{ color: color ? c[color] : muted ? c.muted : c.ink }, v[variant], style]} />;
}

// ---------- Controles ----------
type ButtonKind = 'primary' | 'ghost' | 'line' | 'danger';
export function Button({ title, onPress, kind = 'primary', disabled, loading, small, testID, flex }: {
  title: string; onPress: () => void; kind?: ButtonKind; disabled?: boolean; loading?: boolean; small?: boolean; testID?: string; flex?: boolean;
}) {
  const c = useColors();
  const bg = { primary: c.brand, ghost: c.brandSoft, line: 'transparent', danger: c.danger }[kind];
  const fg = { primary: c.brandInk, ghost: c.brandText, line: c.ink, danger: '#FFFFFF' }[kind];
  const off = disabled || loading;
  return (
    <Pressable
      testID={testID} accessibilityRole="button" accessibilityState={{ disabled: !!off, busy: !!loading }} disabled={off} onPress={onPress}
      style={({ pressed }) => [{
        backgroundColor: bg, borderRadius: radius.md, paddingVertical: small ? 9 : 14, paddingHorizontal: small ? 12 : 16,
        alignItems: 'center', justifyContent: 'center', opacity: off ? 0.5 : pressed ? 0.85 : 1,
        borderWidth: kind === 'line' ? 1.5 : 0, borderColor: c.line, flex: flex ? 1 : undefined, minHeight: small ? 38 : 48,
      }]}>
      {loading ? <ActivityIndicator color={fg} /> : <RNText style={{ color: fg, fontWeight: '700', fontSize: small ? 13.5 : 15 }}>{title}</RNText>}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, testID }: { label: string; selected?: boolean; onPress?: () => void; testID?: string }) {
  const c = useColors();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ selected: !!selected }} onPress={onPress}
      style={{ borderRadius: radius.pill, borderWidth: 1.5, borderColor: selected ? c.brand : c.line, backgroundColor: selected ? c.brandSoft : c.card, paddingVertical: 7, paddingHorizontal: 12 }}>
      <RNText style={{ color: selected ? c.brandText : c.ink, fontWeight: '600', fontSize: 13 }}>{label}</RNText>
    </Pressable>
  );
}

export const Field = forwardRef<TextInput, TextInputProps & { label: string; hint?: string; error?: string | null }>(function Field({ label, hint, error, style, ...rest }, ref) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label">{label}</Text>
      <TextInput ref={ref} placeholderTextColor={c.muted} accessibilityLabel={label} {...rest}
        style={[{ borderWidth: 1.5, borderColor: error ? c.danger : c.line, backgroundColor: c.card, color: c.ink, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 }, rest.multiline && { minHeight: 90, textAlignVertical: 'top' }, style]} />
      {error ? <Text variant="tiny" color="danger">{error}</Text> : hint ? <Text variant="tiny" muted>{hint}</Text> : null}
    </View>
  );
});

// ---------- Contenedores ----------
export function Card({ children, style, onPress, testID, tone }: { children: ReactNode; style?: ViewStyle; onPress?: () => void; testID?: string; tone?: 'brand' | 'warn' | 'danger' }) {
  const c = useColors();
  const border = tone === 'brand' ? c.brand : tone === 'warn' ? c.warn : tone === 'danger' ? c.danger : c.line;
  const base: ViewStyle = { backgroundColor: c.card, borderRadius: radius.lg, borderWidth: tone ? 1.5 : 1, borderColor: border, padding: space.md + 2, gap: space.sm };
  if (onPress) return <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [base, { opacity: pressed ? 0.9 : 1 }, style]}>{children}</Pressable>;
  return <View testID={testID} style={[base, style]}>{children}</View>;
}

export function Badge({ label, tone = 'ok', testID }: { label: string; tone?: 'ok' | 'warn' | 'danger' | 'brand'; testID?: string }) {
  const c = useColors();
  const map = { ok: [c.okSoft, c.ok], warn: [c.warnSoft, c.warn], danger: [c.dangerSoft, c.danger], brand: [c.brandSoft, c.brandText] } as const;
  const [bg, fg] = map[tone];
  return <View testID={testID} style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' }}><RNText style={{ color: fg, fontWeight: '700', fontSize: 11.5 }}>{label}</RNText></View>;
}

export function Notice({ children, tone = 'brand', testID }: { children: ReactNode; tone?: 'brand' | 'warn' | 'danger' | 'ok'; testID?: string }) {
  const c = useColors();
  const bg = { brand: c.brandSoft, warn: c.warnSoft, danger: c.dangerSoft, ok: c.okSoft }[tone];
  return <View testID={testID} accessibilityRole="alert" style={{ backgroundColor: bg, borderRadius: radius.md, padding: space.md }}>{typeof children === 'string' ? <Text variant="small">{children}</Text> : children}</View>;
}

export function Avatar({ name, size = 48, color }: { name?: string | null; size?: number; color?: string }) {
  const c = useColors();
  const initials = (name ?? '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color ?? c.brand, alignItems: 'center', justifyContent: 'center' }}><RNText style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.34 }}>{initials}</RNText></View>;
}

export function Loading() {
  const c = useColors();
  return <View style={{ padding: space.xl, alignItems: 'center' }}><ActivityIndicator color={c.brand} /></View>;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : 'Algo salió mal.';
  return <Notice tone="danger"><Stack><Text variant="small">{msg}</Text>{onRetry ? <Button small kind="line" title="Reintentar" onPress={onRetry} /> : null}</Stack></Notice>;
}

export function Empty({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <View style={{ alignItems: 'center', padding: space.xl, gap: space.sm }}><Text variant="h2" style={{ textAlign: 'center' }}>{title}</Text>{subtitle ? <Text muted style={{ textAlign: 'center' }}>{subtitle}</Text> : null}{action}</View>;
}

export const styles = StyleSheet.create({ divider: { height: StyleSheet.hairlineWidth, alignSelf: 'stretch' } });
