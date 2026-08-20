const app = require('./app.json');

const mapsKey = process.env.EXPO_ANDROID_GOOGLE_MAPS_API_KEY;

if (mapsKey) {
  app.expo.android = {
    ...app.expo.android,
    config: {
      ...app.expo.android?.config,
      googleMaps: {
        ...app.expo.android?.config?.googleMaps,
        apiKey: mapsKey,
      },
    },
  };
}

module.exports = app;
