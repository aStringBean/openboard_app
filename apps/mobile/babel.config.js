module.exports = (api) => {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    /* Reanimated 4 gets its worklet transform from react-native-worklets. */
    plugins: ["react-native-worklets/plugin"],
  };
};
