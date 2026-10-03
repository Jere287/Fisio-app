import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// En iOS/Android el refresh token va al llavero cifrado del sistema (Keychain / Keystore).
// En web (solo para pruebas y demos) se usa localStorage.
const web = Platform.OS === 'web';

export const secureStorage = {
  async get(key: string): Promise<string | null> {
    if (web) { try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; } }
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (web) { try { globalThis.localStorage?.setItem(key, value); } catch { /* sin almacenamiento */ } return; }
    await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  },
  async remove(key: string): Promise<void> {
    if (web) { try { globalThis.localStorage?.removeItem(key); } catch { /* sin almacenamiento */ } return; }
    await SecureStore.deleteItemAsync(key);
  },
};
