import { useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiError } from '@/api/client';
import { AuthProvider } from '@/auth/AuthProvider';
import { useColors } from '@/theme/tokens';

export default function RootLayout() {
  const c = useColors();
  const [qc] = useState(() => new QueryClient({
    defaultOptions: {
      // No se reintentan errores del cliente (4xx): repetirlos no los arregla.
      queries: { retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2, staleTime: 15000 },
    },
  }));
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerTintColor: c.brandText, headerStyle: { backgroundColor: c.surface }, contentStyle: { backgroundColor: c.surface }, headerBackTitle: 'Atrás' }}>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="verify-identity" options={{ title: 'Verifica tu identidad' }} />
            <Stack.Screen name="(patient)" options={{ headerShown: false }} />
            <Stack.Screen name="(physio)" options={{ headerShown: false }} />
            <Stack.Screen name="physio/[id]" options={{ title: 'Especialista' }} />
            <Stack.Screen name="book" options={{ title: 'Reservar' }} />
            <Stack.Screen name="booking/[id]" options={{ title: 'Tu cita' }} />
          </Stack>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
