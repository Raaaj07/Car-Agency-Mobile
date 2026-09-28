const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// This is a native-only app — React Navigation + @rnmapbox/maps have no
// working web build here (RealMapView relies entirely on native Mapbox
// APIs), so there's nothing to gain from Metro attempting to bundle for
// web, and doing so is what fails on mapbox-gl's CSS import.
config.resolver.platforms = ['ios', 'android'];

module.exports = config;