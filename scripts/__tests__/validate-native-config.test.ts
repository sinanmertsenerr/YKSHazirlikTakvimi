import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateExpoNativePolicy,
  validateGeneratedAndroidManifest,
} from '../validate-native-config.ts';

const validAppConfig = {
  expo: {
    android: {
      allowBackup: false,
      blockedPermissions: [
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
      ],
    },
  },
};

const validManifest = `
<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">
  <uses-permission android:name="android.permission.INTERNET" />
  <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" tools:node="remove" />
  <application android:allowBackup="false" android:label="YKS Hazırlık">
    <activity android:name="com.example.MainActivity" android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
      </intent-filter>
    </activity>
  </application>
</manifest>`;

test('source and generated Android policies accept the approved release posture', () => {
  assert.doesNotThrow(() => validateExpoNativePolicy(validAppConfig));
  assert.doesNotThrow(() => validateGeneratedAndroidManifest(validManifest));
});

test('source policy requires backup disablement and every blocked permission', () => {
  assert.throws(
    () =>
      validateExpoNativePolicy({
        expo: {
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
          android: {
            allowBackup: false,
            blockedPermissions: ['android.permission.SYSTEM_ALERT_WINDOW'],
          },
        },
      }),
    /READ_EXTERNAL_STORAGE/,
  );
});

test('generated policy rejects backups, broad permissions, cleartext, and debug builds', () => {
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
});
