import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { session } from './session';

type Status = 'loading' | 'signedOut' | 'signedIn';
const AuthContext = createContext<{ status: Status; signOut: () => Promise<void> }>({ status: 'loading', signOut: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const qc = useQueryClient();

  useEffect(() => {
    const off = session.onChange(signedIn => {
      setStatus(signedIn ? 'signedIn' : 'signedOut');
      if (!signedIn) qc.clear(); // no dejar datos de salud en memoria al cerrar sesión
    });
    // Al abrir la app, intenta recuperar la sesión con el refresh token guardado.
    session.refresh().then(ok => setStatus(ok ? 'signedIn' : 'signedOut')).catch(() => setStatus('signedOut'));
    return off;
  }, [qc]);

  return <AuthContext.Provider value={{ status, signOut: () => session.clear() }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
