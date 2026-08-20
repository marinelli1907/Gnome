const app = require('./app.json');

const mapsKey = process.env.EXPO_ANDROID_GOOGLE_MAPS_API_KEY;
const buildProfile = process.env.EAS_BUILD_PROFILE;
const buildPlatform = process.env.EAS_BUILD_PLATFORM;
const isProductionBuild = buildProfile === 'production';
const isAndroidBuild = buildPlatform === 'android';
const platformUnknownInEas = process.env.EAS_BUILD === 'true' && !buildPlatform;
const mustHaveAndroidMapsKey = isProductionBuild && (isAndroidBuild || platformUnknownInEas);

if (!mapsKey && mustHaveAndroidMapsKey) {
  throw new Error(
    'Missing EXPO_ANDROID_GOOGLE_MAPS_API_KEY. Production Android builds must set this EAS environment variable so android.config.googleMaps.apiKey is present.',
  );
}

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
