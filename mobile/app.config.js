// Configuración dinámica: toma app.json y agrega lo que depende de variables de entorno.
// GOOGLE_MAPS_ANDROID_KEY: llave de Google Maps para la app publicada en Android (en Expo Go no hace falta).
// En iPhone se usa Apple Maps, que no necesita llave.
module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...(config.plugins ?? []),
    ['react-native-maps', { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_KEY }],
  ],
});
