const { withAndroidStyles } = require('expo/config-plugins');

const TARGET_STYLE = 'Theme.App.SplashScreen';
const TARGET_ITEM = 'android:windowSplashScreenBehavior';

module.exports = function withSplashScreenApiGuard(config) {
  return withAndroidStyles(config, (modConfig) => {
    const resources = modConfig.modResults.resources;
    const style = resources.style?.find((entry) => entry.$?.name === TARGET_STYLE);
    const item = style?.item?.find((entry) => entry.$?.name === TARGET_ITEM);
    if (!item) {
      throw new Error(`Expo splash screen did not generate ${TARGET_ITEM}.`);
    }

    resources.$ = {
      ...resources.$,
      'xmlns:tools': resources.$?.['xmlns:tools'] ?? 'http://schemas.android.com/tools',
    };
    item.$ = { ...item.$, 'tools:targetApi': '33' };
    return modConfig;
  });
};
