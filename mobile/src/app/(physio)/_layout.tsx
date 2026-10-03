import { Tabs } from 'expo-router/tabs';
import { useColors } from '@/theme/tokens';
import { CalendarIcon, UserIcon, WalletIcon } from '@/ui/icons';

export default function PhysioTabs() {
  const c = useColors();
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: c.brandText, tabBarInactiveTintColor: c.muted, tabBarStyle: { backgroundColor: c.card, borderTopColor: c.line } }}>
      <Tabs.Screen name="agenda" options={{ title: 'Agenda', tabBarIcon: ({ color }) => <CalendarIcon color={color} /> }} />
      <Tabs.Screen name="earnings" options={{ title: 'Ganancias', tabBarIcon: ({ color }) => <WalletIcon color={color} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Perfil', tabBarIcon: ({ color }) => <UserIcon color={color} /> }} />
    </Tabs>
  );
}
