import { Tabs } from 'expo-router/tabs';
import { useColors } from '@/theme/tokens';
import { CalendarIcon, HeartIcon, SearchIcon, UserIcon } from '@/ui/icons';

export default function PatientTabs() {
  const c = useColors();
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: c.brandText, tabBarInactiveTintColor: c.muted, tabBarStyle: { backgroundColor: c.card, borderTopColor: c.line } }}>
      <Tabs.Screen name="explore" options={{ title: 'Explorar', tabBarIcon: ({ color }) => <SearchIcon color={color} /> }} />
      <Tabs.Screen name="bookings" options={{ title: 'Citas', tabBarIcon: ({ color }) => <CalendarIcon color={color} /> }} />
      <Tabs.Screen name="treatment" options={{ title: 'Tratamiento', tabBarIcon: ({ color }) => <HeartIcon color={color} /> }} />
      <Tabs.Screen name="account" options={{ title: 'Cuenta', tabBarIcon: ({ color }) => <UserIcon color={color} /> }} />
    </Tabs>
  );
}
