import { useEffect, useState } from 'react';

// Hora actual como estado: el render se mantiene puro y la pantalla se actualiza sola cada `everyMs`
// (por ejemplo, para habilitar «Mi fisio no llegó» cuando pasan los 20 minutos de gracia).
export function useNow(everyMs = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
