// URL de la API. En desarrollo: EXPO_PUBLIC_API_URL=http://<tu-ip>:3000 npx expo start
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
