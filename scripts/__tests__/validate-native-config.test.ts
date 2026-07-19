import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateExpoNativePolicy,
  validateGeneratedAndroidManifest,
  validateGeneratedAndroidRootBuildGradle,
  validateGeneratedAndroidStyles,
} from '../validate-native-config.ts';

const validAppConfig = {
  expo: {
    android: {
      allowBackup: false,
      versionCode: 1,
      blockedPermissions: [
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
      ],
    },
    extra: {
      privacyPolicyUrl: 'https://sinanmertsenerr.github.io/YKSHazirlikTakvimi/privacy.html',
    },
    plugins: [
      './plugins/with-reanimated-worklets-release-lint-workaround',
      './plugins/with-splash-screen-api-guard',
      ['expo-notifications', { icon: './assets/images/notification-icon.png', color: '#4F46E5' }],
    ],
  },
};

const validManifest = `
<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">
  <uses-permission android:name="android.permission.INTERNET" />
  <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" tools:node="remove" />
  <application android:allowBackup="false" android:label="YKS Hazırlık">
    <meta-data android:name="com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/notification_icon" />
    <meta-data android:name="expo.modules.notifications.default_notification_icon" android:resource="@drawable/notification_icon" />
    <activity android:name="com.example.MainActivity" android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
      </intent-filter>
    </activity>
  </application>
</manifest>`;

const validRootBuildGradle = `
// @yks-reanimated-worklets-release-lint-workaround
def affectedLintProjects = [":react-native-reanimated", ":react-native-worklets"] as Set
subprojects { subproject ->
  if (affectedLintProjects.contains(subproject.path)) {
    subproject.tasks.configureEach { task ->
      if (task.name == "lintAnalyzeRelease") {
        task.enabled = false
      }
    }
  }
}`;

const validStyles = `
<resources xmlns:tools="http://schemas.android.com/tools">
  <style name="Theme.App.SplashScreen" parent="Theme.SplashScreen">
    <item name="android:windowSplashScreenBehavior" tools:targetApi="33">icon_preferred</item>
  </style>
</resources>`;

test('source and generated Android policies accept the approved release posture', () => {
  assert.doesNotThrow(() => validateExpoNativePolicy(validAppConfig));
  assert.doesNotThrow(() => validateGeneratedAndroidManifest(validManifest));
  assert.doesNotThrow(() => validateGeneratedAndroidRootBuildGradle(validRootBuildGradle));
  assert.doesNotThrow(() => validateGeneratedAndroidStyles(validStyles));
});

test('source policy requires backup disablement and every blocked permission', () => {
  assert.throws(
    () =>
      validateExpoNativePolicy({
        expo: {
          extra: validAppConfig.expo.extra,
          plugins: validAppConfig.expo.plugins,
          android: {
            ...validAppConfig.expo.android,
            allowBackup: true,
          },
        },
      }),
    /disable automatic backup/,
  );
  assert.throws(
    () =>
      validateExpoNativePolicy({
        expo: {
          extra: validAppConfig.expo.extra,
          plugins: validAppConfig.expo.plugins,
          android: {
            allowBackup: false,
            versionCode: 1,
            blockedPermissions: ['android.permission.SYSTEM_ALERT_WINDOW'],
          },
        },
      }),
    /READ_EXTERNAL_STORAGE/,
  );
});

test('source policy requires a public HTTPS privacy document', () => {
  assert.throws(
    () =>
      validateExpoNativePolicy({
        expo: {
          android: validAppConfig.expo.android,
          plugins: validAppConfig.expo.plugins,
          extra: {},
        },
      }),
    /privacyPolicyUrl/,
  );
  assert.throws(
    () =>
      validateExpoNativePolicy({
        expo: {
          android: validAppConfig.expo.android,
          plugins: validAppConfig.expo.plugins,
          extra: { privacyPolicyUrl: 'http://localhost/privacy.html' },
        },
      }),
    /public HTTPS document URL/,
  );
  assert.throws(
    () =>
      validateExpoNativePolicy({
        expo: {
          android: validAppConfig.expo.android,
          plugins: validAppConfig.expo.plugins,
          extra: { privacyPolicyUrl: 'https://example.com/' },
        },
      }),
    /public HTTPS document URL/,
  );
});

test('source policy requires the approved notification small icon', () => {
  assert.throws(
    () =>
      validateExpoNativePolicy({
        expo: {
          ...validAppConfig.expo,
          plugins: [['expo-notifications', { color: '#4F46E5' }]],
        },
      }),
    /notification-icon\.png/,
  );
});

test('source policy requires versionCode and the scoped Reanimated/Worklets plugin', () => {
  assert.throws(
    () =>
      validateExpoNativePolicy({
        expo: {
          ...validAppConfig.expo,
          android: { ...validAppConfig.expo.android, versionCode: 0 },
        },
      }),
    /positive integer versionCode/,
  );
  assert.throws(
    () =>
      validateExpoNativePolicy({
        expo: {
          ...validAppConfig.expo,
          plugins: validAppConfig.expo.plugins.filter(
            (plugin) => plugin !== './plugins/with-reanimated-worklets-release-lint-workaround',
          ),
        },
      }),
    /with-reanimated-worklets-release-lint-workaround/,
  );
  assert.throws(
    () =>
      validateExpoNativePolicy({
        expo: {
          ...validAppConfig.expo,
          plugins: validAppConfig.expo.plugins.filter(
            (plugin) => plugin !== './plugins/with-splash-screen-api-guard',
          ),
        },
      }),
    /with-splash-screen-api-guard/,
  );
});

test('generated root build policy rejects missing or broadened Reanimated/Worklets lint workarounds', () => {
  assert.throws(
    () => validateGeneratedAndroidRootBuildGradle('subprojects {}'),
    /one Reanimated\/Worklets lint workaround/,
  );
  assert.throws(
    () =>
      validateGeneratedAndroidRootBuildGradle(
        validRootBuildGradle.replace(':react-native-worklets', ':all-libraries'),
      ),
    /only Reanimated and Worklets projects/,
  );
  assert.throws(
    () =>
      validateGeneratedAndroidRootBuildGradle(
        validRootBuildGradle.replace('lintAnalyzeRelease', 'lintRelease'),
      ),
    /only lintAnalyzeRelease/,
  );
  assert.throws(
    () =>
      validateGeneratedAndroidRootBuildGradle(
        `${validRootBuildGradle}\nsubprojects { project -> project.tasks.configureEach { task -> if (task.name == "lintAnalyzeRelease") task.enabled = false } }`,
      ),
    /broader lintAnalyzeRelease override/,
  );
});

test('generated styles require the Android 13 splash behavior API guard', () => {
  assert.throws(
    () => validateGeneratedAndroidStyles(validStyles.replace(' tools:targetApi="33"', '')),
    /windowSplashScreenBehavior/,
  );
});

test('generated policy rejects backups, broad permissions, cleartext, debug builds, and missing notification metadata', () => {
  assert.throws(
    () =>
      validateGeneratedAndroidManifest(
        validManifest.replace('allowBackup="false"', 'allowBackup="true"'),
      ),
    /allowBackup/,
  );
  assert.throws(
    () =>
      validateGeneratedAndroidManifest(
        validManifest.replace(
          '<uses-permission android:name="android.permission.INTERNET" />',
          '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />',
        ),
      ),
    /WRITE_EXTERNAL_STORAGE/,
  );
  assert.throws(
    () =>
      validateGeneratedAndroidManifest(
        validManifest.replace(
          'android:allowBackup="false"',
          'android:allowBackup="false" android:usesCleartextTraffic="true"',
        ),
      ),
    /cleartext/,
  );
  assert.throws(
    () =>
      validateGeneratedAndroidManifest(
        validManifest.replace(
          'android:allowBackup="false"',
          'android:allowBackup="false" android:debuggable="true"',
        ),
      ),
    /debuggable/,
  );
  assert.throws(
    () =>
      validateGeneratedAndroidManifest(
        validManifest.replace(
          '    <meta-data android:name="expo.modules.notifications.default_notification_icon" android:resource="@drawable/notification_icon" />\n',
          '',
        ),
      ),
    /expo\.modules\.notifications\.default_notification_icon/,
  );
});
