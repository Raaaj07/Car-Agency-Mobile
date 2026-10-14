const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// This is a native-only app — React Navigation + @rnmapbox/maps have no
// working web build here (RealMapView relies entirely on native Mapbox
// APIs), so there's nothing to gain from Metro attempting to bundle for
// web, and doing so is what fails on mapbox-gl's CSS import.
config.resolver.platforms = ['ios', 'android'];

// Metro spawns one transform worker per CPU core by default, and each one
// loads its own copy of the Babel/React Native toolchain. On a machine that is
// short on RAM/page file that made several workers die at once with
// "Zone Allocation failed - process out of memory" at ~13% of the first
// bundle. Fewer workers = far lower peak memory (a little slower cold start).
config.maxWorkers = 2;

module.exports = config;