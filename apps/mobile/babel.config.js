module.exports = function babelConfig(api) {
  const isProduction = api.env('production');
  return {
    presets: ['babel-preset-expo'],
    plugins: isProduction ? ['./babel/strip-console'] : [],
  };
};
