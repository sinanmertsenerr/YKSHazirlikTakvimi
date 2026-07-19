import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const FORBIDDEN_ANDROID_PERMISSIONS = [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
] as const;

const LOCAL_OR_PRIVATE_HOST =
  /^(?:localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/i;
const NOTIFICATION_ICON_PATH = './assets/images/notification-icon.png';
const NOTIFICATION_ICON_RESOURCE = '@drawable/notification_icon';
const NOTIFICATION_ICON_METADATA = [
  'com.google.firebase.messaging.default_notification_icon',
  'expo.modules.notifications.default_notification_icon',
] as const;
const REANIMATED_WORKLETS_LINT_PLUGIN =
  './plugins/with-reanimated-worklets-release-lint-workaround';
const REANIMATED_WORKLETS_LINT_MARKER = '// @yks-reanimated-worklets-release-lint-workaround';
const SPLASH_API_GUARD_PLUGIN = './plugins/with-splash-screen-api-guard';

async function readLimitedText(path: string, label: string): Promise<string> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > 2 * 1024 * 1024) {
    throw new Error(`${label} has an invalid size.`);
  }
  return readFile(path, 'utf8');
}

function validatePublicPrivacyPolicyUrl(value: unknown): void {
  if (typeof value !== 'string' || value.length > 2048) {
    throw new Error('Expo config must declare a public privacyPolicyUrl.');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Expo privacyPolicyUrl must be a valid URL.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    LOCAL_OR_PRIVATE_HOST.test(url.hostname) ||
    url.pathname === '/'
  ) {
    throw new Error('Expo privacyPolicyUrl must be a public HTTPS document URL.');
  }
}

function validateExpoPlugins(value: unknown): void {
  if (!Array.isArray(value)) {
    throw new Error('Expo config must declare plugins.');
  }
  const notifications = value.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-notifications',
  );
  const notificationOptions = Array.isArray(notifications) ? notifications[1] : null;
  if (
    !notificationOptions ||
    typeof notificationOptions !== 'object' ||
    Array.isArray(notificationOptions)
  ) {
    throw new Error('Expo notifications plugin must declare release options.');
  }
  if (Reflect.get(notificationOptions, 'icon') !== NOTIFICATION_ICON_PATH) {
    throw new Error(`Expo notifications plugin must use ${NOTIFICATION_ICON_PATH}.`);
  }
  if (
    !value.some(
      (plugin) =>
        plugin === REANIMATED_WORKLETS_LINT_PLUGIN ||
        (Array.isArray(plugin) && plugin[0] === REANIMATED_WORKLETS_LINT_PLUGIN),
    )
  ) {
    throw new Error(`Expo config must apply ${REANIMATED_WORKLETS_LINT_PLUGIN}.`);
  }
  if (
    !value.some(
      (plugin) =>
        plugin === SPLASH_API_GUARD_PLUGIN ||
        (Array.isArray(plugin) && plugin[0] === SPLASH_API_GUARD_PLUGIN),
    )
  ) {
    throw new Error(`Expo config must apply ${SPLASH_API_GUARD_PLUGIN}.`);
  }
}

export function validateExpoNativePolicy(document: unknown): void {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('app.json must contain an object.');
  }
  const expo = Reflect.get(document, 'expo');
  const android = expo && typeof expo === 'object' ? Reflect.get(expo, 'android') : null;
  if (!android || typeof android !== 'object' || Array.isArray(android)) {
    throw new Error('app.json must contain expo.android.');
  }
  const extra = Reflect.get(expo, 'extra');
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) {
    throw new Error('app.json must contain expo.extra.');
  }
  validatePublicPrivacyPolicyUrl(Reflect.get(extra, 'privacyPolicyUrl'));
  validateExpoPlugins(Reflect.get(expo, 'plugins'));
  const versionCode = Reflect.get(android, 'versionCode');
  if (!Number.isInteger(versionCode) || Number(versionCode) < 1) {
    throw new Error('Expo Android policy must declare a positive integer versionCode.');
  }
  if (Reflect.get(android, 'allowBackup') !== false) {
    throw new Error('Expo Android policy must disable automatic backup.');
  }
  const blocked = Reflect.get(android, 'blockedPermissions');
  if (!Array.isArray(blocked)) {
    throw new Error('Expo Android policy must declare blockedPermissions.');
  }
  for (const permission of FORBIDDEN_ANDROID_PERMISSIONS) {
    if (!blocked.includes(permission)) {
      throw new Error(`Expo Android policy must block ${permission}.`);
    }
  }
}

export function validateGeneratedAndroidManifest(manifest: string): void {
  const application = /<application\b[^>]*>/s.exec(manifest)?.[0];
  if (!application) throw new Error('Generated Android manifest has no application element.');
  if (!/android:allowBackup="false"/.test(application)) {
    throw new Error('Generated Android manifest must set android:allowBackup="false".');
  }
  if (/android:usesCleartextTraffic="true"/.test(application)) {
    throw new Error('Generated release manifest must not enable cleartext traffic.');
  }
  if (/android:debuggable="true"/.test(application)) {
    throw new Error('Generated release manifest must not be debuggable.');
  }
  for (const metadataName of NOTIFICATION_ICON_METADATA) {
    const escapedName = metadataName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedResource = NOTIFICATION_ICON_RESOURCE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const metadata = new RegExp(
      `<meta-data\\b(?=[^>]*android:name="${escapedName}")(?=[^>]*android:resource="${escapedResource}")[^>]*>`,
      's',
    );
    if (!metadata.test(manifest)) {
      throw new Error(`Generated Android manifest must configure ${metadataName}.`);
    }
  }
  for (const permission of FORBIDDEN_ANDROID_PERMISSIONS) {
    const escaped = permission.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const declarations =
      manifest.match(
        new RegExp(`<uses-permission(?:-sdk-23)?\\b[^>]*android:name="${escaped}"[^>]*>`, 'gs'),
      ) ?? [];
    if (declarations.some((declaration) => !/tools:node="remove"/.test(declaration))) {
      throw new Error(`Generated Android manifest still requests ${permission}.`);
    }
  }
  const mainActivity = /<activity\b[^>]*android:name="[^"]*MainActivity"[^>]*>/s.exec(
    manifest,
  )?.[0];
  if (!mainActivity || !/android:exported="true"/.test(mainActivity)) {
    throw new Error('Generated MainActivity must be explicitly exported for its launcher intent.');
  }
}

export function validateGeneratedAndroidStyles(styles: string): void {
  const guardedBehavior =
    /<item\b(?=[^>]*name="android:windowSplashScreenBehavior")(?=[^>]*tools:targetApi="33")[^>]*>\s*icon_preferred\s*<\/item>/s;
  if (!guardedBehavior.test(styles)) {
    throw new Error(
      'Generated Android styles must guard windowSplashScreenBehavior with tools:targetApi="33".',
    );
  }
}

export function validateGeneratedAndroidRootBuildGradle(buildGradle: string): void {
  if (buildGradle.split(REANIMATED_WORKLETS_LINT_MARKER).length !== 2) {
    throw new Error(
      'Generated Android root build.gradle must contain one Reanimated/Worklets lint workaround.',
    );
  }
  if (
    !buildGradle.includes(
      'def affectedLintProjects = [":react-native-reanimated", ":react-native-worklets"] as Set',
    ) ||
    !/affectedLintProjects\.contains\(subproject\.path\)/.test(buildGradle)
  ) {
    throw new Error('Lint workaround must target only Reanimated and Worklets projects.');
  }
  if (!/task\.name == ["']lintAnalyzeRelease["']/.test(buildGradle)) {
    throw new Error('Reanimated/Worklets lint workaround must target only lintAnalyzeRelease.');
  }
  if ((buildGradle.match(/task\.name\s*==\s*["']lintAnalyzeRelease["']/g) ?? []).length !== 1) {
    throw new Error(
      'Generated Android root build.gradle contains a broader lintAnalyzeRelease override.',
    );
  }
  if ((buildGradle.match(/task\.enabled\s*=\s*false/g) ?? []).length !== 1) {
    throw new Error(
      'Reanimated/Worklets lint workaround must contain one scoped task disablement.',
    );
  }
}

export async function validateNativeConfig(options: {
  appConfigPath: string;
  androidManifestPath: string;
  androidRootBuildGradlePath: string;
  androidStylesPath: string;
}): Promise<void> {
  const appConfigText = await readLimitedText(options.appConfigPath, 'app.json');
  let appConfig: unknown;
  try {
    appConfig = JSON.parse(appConfigText) as unknown;
  } catch {
    throw new Error('app.json is not valid JSON.');
  }
  validateExpoNativePolicy(appConfig);
  validateGeneratedAndroidManifest(
    await readLimitedText(options.androidManifestPath, 'Generated Android manifest'),
  );
  validateGeneratedAndroidRootBuildGradle(
    await readLimitedText(
      options.androidRootBuildGradlePath,
      'Generated Android root build.gradle',
    ),
  );
  validateGeneratedAndroidStyles(
    await readLimitedText(options.androidStylesPath, 'Generated Android styles'),
  );
}

function parseOptions(args: string[]): {
  appConfigPath: string;
  androidManifestPath: string;
  androidRootBuildGradlePath: string;
  androidStylesPath: string;
} {
  let appConfigPath = resolve(process.cwd(), 'app.json');
  let androidManifestPath = resolve(process.cwd(), 'android/app/src/main/AndroidManifest.xml');
  let androidRootBuildGradlePath = resolve(process.cwd(), 'android/build.gradle');
  let androidStylesPath = resolve(process.cwd(), 'android/app/src/main/res/values/styles.xml');
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === '--app-config' && value) appConfigPath = resolve(value);
    else if (argument === '--android-manifest' && value) androidManifestPath = resolve(value);
    else if (argument === '--android-root-build-gradle' && value) {
      androidRootBuildGradlePath = resolve(value);
    } else if (argument === '--android-styles' && value) androidStylesPath = resolve(value);
    else throw new Error(`Unknown or incomplete argument: ${argument ?? '<empty>'}`);
    index += 1;
  }
  return { appConfigPath, androidManifestPath, androidRootBuildGradlePath, androidStylesPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let options: ReturnType<typeof parseOptions>;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    options = {
      appConfigPath: '',
      androidManifestPath: '',
      androidRootBuildGradlePath: '',
      androidStylesPath: '',
    };
  }
  if (process.exitCode !== 1) {
    validateNativeConfig(options)
      .then(() => console.log('Validated Expo Android backup, permission, and release policy.'))
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
  }
}
