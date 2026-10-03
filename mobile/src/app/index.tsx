import { Redirect } from 'expo-router';
import { useMe } from '@/api/queries';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorState, Loading, Screen } from '@/ui';

// Puerta de entrada: decide a dónde va cada persona según su sesión, su rol y su verificación.
export default function Gate() {
  const { status } = useAuth();
  const me = useMe();
  if (status === 'loading') return <Screen><Loading /></Screen>;
  if (status === 'signedOut') return <Redirect href="/login" />;
  if (me.isPending) return <Screen><Loading /></Screen>;
  if (me.isError) return <Screen><ErrorState error={me.error} onRetry={() => me.refetch()} /></Screen>;
  const { user, physio } = me.data;
  if (user.role === 'physio' || physio?.status === 'approved') return <Redirect href="/(physio)/agenda" />;
  if (['none', 'rejected', 'pending'].includes(user.kyc_status)) return <Redirect href="/verify-identity" />;
  return <Redirect href="/(patient)/explore" />;
}
