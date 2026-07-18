import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const FORBIDDEN_ANDROID_PERMISSIONS = [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
] as const;

async function readLimitedText(path: string, label: string): Promise<string> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > 2 * 1024 * 1024) {
    throw new Error(`${label} has an invalid size.`);
  }
  return readFile(path, 'utf8');
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

export async function validateNativeConfig(options: {
  appConfigPath: string;
  androidManifestPath: string;
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
}

function parseOptions(args: string[]): { appConfigPath: string; androidManifestPath: string } {
  let appConfigPath = resolve(process.cwd(), 'app.json');
  let androidManifestPath = resolve(process.cwd(), 'android/app/src/main/AndroidManifest.xml');
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === '--app-config' && value) appConfigPath = resolve(value);
    else if (argument === '--android-manifest' && value) androidManifestPath = resolve(value);
    else throw new Error(`Unknown or incomplete argument: ${argument ?? '<empty>'}`);
    index += 1;
  }
  return { appConfigPath, androidManifestPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let options: ReturnType<typeof parseOptions>;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    options = { appConfigPath: '', androidManifestPath: '' };
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
