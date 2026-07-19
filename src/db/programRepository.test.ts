type MockFileState = {
  exists: boolean;
  bytes: Uint8Array;
  text: string;
};

const mockFileStates = new Map<string, MockFileState>();
const mockCopyFile = jest.fn();
const mockDigest = jest.fn();
const mockOpenDatabaseAsync = jest.fn();
const mockAssetFromModule = jest.fn();
const mockGetActivePackLocation = jest.fn();
const mockInvalidateDownloadedPackVersion = jest.fn();
const mockReloadActiveContent = jest.fn();
let mockContentRevision = 0;

function mockFileUri(...parts: unknown[]): string {
  const joined = parts
    .map((part) =>
      typeof part === 'string'
        ? part
        : part && typeof part === 'object' && 'uri' in part
          ? String(part.uri)
          : String(part),
    )
    .join('/');
  const schemeEnd = joined.indexOf('://');
  if (schemeEnd < 0) return joined.replace(/\/+/g, '/');
  return `${joined.slice(0, schemeEnd + 3)}${joined.slice(schemeEnd + 3).replace(/\/+/g, '/')}`;
}

function setMockFile(uri: string, bytes: Uint8Array, text = ''): void {
  mockFileStates.set(uri, { exists: true, bytes, text });
}

jest.mock('expo-sqlite', () => ({
  // Android exposes this as an absolute path, while expo-file-system expects a file URI.
  defaultDatabaseDirectory: '/sqlite',
  openDatabaseAsync: (...args: unknown[]) => mockOpenDatabaseAsync(...args),
}));

jest.mock('expo-asset', () => ({
  Asset: { fromModule: (...args: unknown[]) => mockAssetFromModule(...args) },
}));

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digest: (...args: unknown[]) => mockDigest(...args),
}));

jest.mock('expo-file-system', () => ({
  File: class MockFile {
    uri: string;

    constructor(...parts: unknown[]) {
      this.uri = mockFileUri(...parts);
    }

    get name() {
      return this.uri.split('/').at(-1) ?? '';
    }

    get exists() {
      return mockFileStates.get(this.uri)?.exists ?? false;
    }

    get size() {
      return mockFileStates.get(this.uri)?.bytes.byteLength ?? 0;
    }

    async bytes() {
      return mockFileStates.get(this.uri)?.bytes ?? new Uint8Array();
    }

    async text() {
      const state = mockFileStates.get(this.uri);
      return state?.text || Buffer.from(state?.bytes ?? []).toString('utf8');
    }

    create() {
      mockFileStates.set(this.uri, { exists: true, bytes: new Uint8Array(), text: '' });
    }

    write(content: string | Uint8Array) {
      const bytes =
        typeof content === 'string' ? new Uint8Array(Buffer.from(content, 'utf8')) : content;
      mockFileStates.set(this.uri, {
        exists: true,
        bytes,
        text: typeof content === 'string' ? content : '',
      });
    }

    delete() {
      mockFileStates.delete(this.uri);
    }

    async copy(destination: { uri: string }) {
      const source = mockFileStates.get(this.uri);
      if (!source) throw new Error(`Missing mock source file: ${this.uri}`);
      mockCopyFile(this.uri, destination.uri);
      mockFileStates.set(destination.uri, {
        exists: true,
        bytes: new Uint8Array(source.bytes),
        text: source.text,
      });
    }
  },
}));

jest.mock('@/data/packUpdater', () => ({
  getActivePackLocation: (...args: unknown[]) => mockGetActivePackLocation(...args),
  invalidateDownloadedPackVersion: (...args: unknown[]) =>
    mockInvalidateDownloadedPackVersion(...args),
}));

jest.mock('@/data/content', () => {
  const schemas = jest.requireActual<typeof import('../../scripts/lib/content-schemas')>(
    '../../scripts/lib/content-schemas',
  );
  const useContentRevisionStore = Object.assign(
    (selector: (state: { revision: number }) => unknown) =>
      selector({ revision: mockContentRevision }),
    { getState: () => ({ revision: mockContentRevision }) },
  );
  return {
    programsPack: { programs: [] },
    programsPackSchema: schemas.programsFixtureSchema,
    reloadActiveContent: (...args: unknown[]) => mockReloadActiveContent(...args),
    useContentRevisionStore,
  };
});

const SHA256_ZERO = '0'.repeat(64);

const downloadedLocation = (version: string, bytes = 128) => ({
  source: 'downloaded' as const,
  version,
  directory: { uri: `downloaded/${version}` },
  manifest: {
    files: {
      programs: { path: 'programs.db', sha256: SHA256_ZERO, bytes },
    },
  },
});

function validDatabase(rows: unknown[] = []) {
  return {
    getFirstAsync: jest.fn(async (sql: string) =>
      sql.startsWith('PRAGMA') ? { quick_check: 'ok' } : { value: '2' },
    ),
    getAllAsync: jest.fn(async (..._args: unknown[]) => rows),
    closeAsync: jest.fn(async () => undefined),
  };
}

function loadRepository(): typeof import('./programRepository') {
  return require('./programRepository') as typeof import('./programRepository');
}

describe('program database runtime lifecycle', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockFileStates.clear();
    mockContentRevision = 0;
    mockDigest.mockResolvedValue(new Uint8Array(32).buffer);
    mockInvalidateDownloadedPackVersion.mockResolvedValue(undefined);
    mockReloadActiveContent.mockResolvedValue(true);
  });

  it('invalidates a corrupt downloaded database and retries once with the rollback pack', async () => {
    const corruptLocation = downloadedLocation('2026.07.2');
    const rollbackLocation = downloadedLocation('2026.07.1');
    setMockFile('downloaded/2026.07.2/programs.db', new Uint8Array(128));
    setMockFile('downloaded/2026.07.1/programs.db', new Uint8Array(128));

    const closeCorrupt = jest.fn(async () => undefined);
    const corruptDatabase = {
      getFirstAsync: jest.fn(async () => ({ quick_check: 'database disk image is malformed' })),
      getAllAsync: jest.fn(async () => []),
      closeAsync: closeCorrupt,
    };
    const rollbackDatabase = validDatabase();
    mockOpenDatabaseAsync
      .mockResolvedValueOnce(corruptDatabase)
      .mockResolvedValueOnce(rollbackDatabase);
    mockGetActivePackLocation
      .mockResolvedValueOnce(corruptLocation)
      .mockResolvedValueOnce(rollbackLocation);

    const { queryProgramPage } = loadRepository();
    await expect(
      queryProgramPage({ scoreType: 'say', language: 'tr', limit: 10, offset: 0 }),
    ).resolves.toEqual({ programs: [], hasMore: false });

    expect(mockInvalidateDownloadedPackVersion).toHaveBeenCalledWith('2026.07.2');
    expect(mockReloadActiveContent).toHaveBeenCalledTimes(1);
    expect(mockOpenDatabaseAsync).toHaveBeenCalledTimes(2);
    expect(closeCorrupt).toHaveBeenCalledTimes(1);
    expect(rollbackDatabase.getAllAsync).toHaveBeenCalledTimes(1);
  });

  it('degrades to the legacy walk-back query when the pack lacks the sort column', async () => {
    const location = downloadedLocation('2026.07.5');
    setMockFile('downloaded/2026.07.5/programs.db', new Uint8Array(128));
    const database = validDatabase();
    const getAllAsync = jest
      .fn<Promise<unknown[]>, unknown[]>()
      .mockRejectedValueOnce(new Error('no such column: latest_min_rank_sort'))
      .mockResolvedValueOnce([]);
    database.getAllAsync = getAllAsync;
    mockGetActivePackLocation.mockResolvedValue(location);
    mockOpenDatabaseAsync.mockResolvedValue(database);

    const { queryProgramPage } = loadRepository();
    await expect(
      queryProgramPage({ scoreType: 'say', language: 'tr', limit: 10, offset: 0 }),
    ).resolves.toEqual({ programs: [], hasMore: false });

    // Two list attempts on the SAME connection — new ORDER BY, then the legacy shape.
    // The pack itself is healthy, so it must NOT be invalidated or reopened.
    expect(getAllAsync).toHaveBeenCalledTimes(2);
    expect(String(getAllAsync.mock.calls[0]?.[0])).toContain('latest_min_rank_sort');
    expect(String(getAllAsync.mock.calls[1]?.[0])).toContain('latest.min_rank IS NULL');
    expect(mockInvalidateDownloadedPackVersion).not.toHaveBeenCalled();
    expect(mockOpenDatabaseAsync).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the pack lacks ix_program_sort', 'no such index: ix_program_sort'],
    ['the SQLite planner rejects the forced index', 'no query solution'],
  ])('degrades to the legacy walk-back query when %s', async (_scenario, message) => {
    const location = downloadedLocation('2026.07.6');
    setMockFile('downloaded/2026.07.6/programs.db', new Uint8Array(128));
    const database = validDatabase();
    const getAllAsync = jest
      .fn<Promise<unknown[]>, unknown[]>()
      .mockRejectedValueOnce(new Error(message))
      .mockResolvedValueOnce([]);
    database.getAllAsync = getAllAsync;
    mockGetActivePackLocation.mockResolvedValue(location);
    mockOpenDatabaseAsync.mockResolvedValue(database);

    const { queryProgramPage } = loadRepository();
    await expect(
      queryProgramPage({ scoreType: 'say', language: 'tr', limit: 10, offset: 0 }),
    ).resolves.toEqual({ programs: [], hasMore: false });

    expect(getAllAsync).toHaveBeenCalledTimes(2);
    expect(String(getAllAsync.mock.calls[0]?.[0])).toContain('INDEXED BY ix_program_sort');
    expect(String(getAllAsync.mock.calls[1]?.[0])).toContain('latest.min_rank IS NULL');
    expect(mockInvalidateDownloadedPackVersion).not.toHaveBeenCalled();
    expect(mockOpenDatabaseAsync).toHaveBeenCalledTimes(1);
  });

  it('caches the active location and shares the prewarmed connection across queries', async () => {
    const location = downloadedLocation('2026.07.3');
    setMockFile('downloaded/2026.07.3/programs.db', new Uint8Array(128));
    const database = validDatabase();
    mockGetActivePackLocation.mockResolvedValue(location);
    mockOpenDatabaseAsync.mockResolvedValue(database);

    const { prewarmProgramDatabase, queryProgramPage } = loadRepository();
    await prewarmProgramDatabase();
    await queryProgramPage({ scoreType: 'say', language: 'tr', limit: 10, offset: 0 });
    await queryProgramPage({ scoreType: 'ea', language: 'tr', limit: 10, offset: 0 });

    expect(mockGetActivePackLocation).toHaveBeenCalledTimes(1);
    expect(mockOpenDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(database.getFirstAsync).toHaveBeenCalledTimes(2);
  });

  it('resolves a new active database after the content revision changes', async () => {
    const firstLocation = downloadedLocation('2026.07.3');
    const secondLocation = downloadedLocation('2026.07.4');
    setMockFile('downloaded/2026.07.3/programs.db', new Uint8Array(128));
    setMockFile('downloaded/2026.07.4/programs.db', new Uint8Array(128));
    mockGetActivePackLocation
      .mockResolvedValueOnce(firstLocation)
      .mockResolvedValueOnce(secondLocation);
    mockOpenDatabaseAsync
      .mockResolvedValueOnce(validDatabase())
      .mockResolvedValueOnce(validDatabase());

    const { queryProgramPage } = loadRepository();
    await queryProgramPage({ scoreType: 'say', language: 'tr', limit: 10, offset: 0 });
    mockContentRevision = 1;
    await queryProgramPage({ scoreType: 'say', language: 'tr', limit: 10, offset: 0 });

    expect(mockGetActivePackLocation).toHaveBeenCalledTimes(2);
    expect(mockOpenDatabaseAsync).toHaveBeenCalledTimes(2);
  });

  it('persists quick_check success and skips it after a JavaScript relaunch', async () => {
    const location = downloadedLocation('2026.07.3');
    setMockFile('downloaded/2026.07.3/programs.db', new Uint8Array(128));
    const firstDatabase = validDatabase();
    const secondDatabase = validDatabase();
    mockGetActivePackLocation.mockResolvedValue(location);
    mockOpenDatabaseAsync
      .mockResolvedValueOnce(firstDatabase)
      .mockResolvedValueOnce(secondDatabase);

    const firstRepository = loadRepository();
    await firstRepository.prewarmProgramDatabase();

    jest.resetModules();
    const secondRepository = loadRepository();
    await secondRepository.prewarmProgramDatabase();

    const quickChecks = [
      ...firstDatabase.getFirstAsync.mock.calls,
      ...secondDatabase.getFirstAsync.mock.calls,
    ]
      .map(([sql]) => String(sql))
      .filter((sql) => sql.startsWith('PRAGMA quick_check'));
    expect(quickChecks).toHaveLength(1);
    expect(secondDatabase.getFirstAsync).toHaveBeenCalledWith(
      "SELECT value FROM pack_metadata WHERE key = 'schemaVersion' LIMIT 1",
    );
  });

  it('copies bundled SQLite by manifest identity and validates its SHA-256 and size', async () => {
    const descriptor = { path: 'programs.db', sha256: SHA256_ZERO, bytes: 4 };
    const downloadAsync = jest.fn(async () => undefined);
    mockGetActivePackLocation.mockResolvedValue({
      source: 'bundled',
      version: '2026.07.4',
      directory: null,
      manifest: { files: { programs: descriptor } },
    });
    mockAssetFromModule.mockReturnValue({
      downloadAsync,
      localUri: 'asset/programs.db',
      hash: 'ignored-asset-hash',
    });
    setMockFile('asset/programs.db', new Uint8Array([1, 2, 3, 4]));
    setMockFile(
      `file:///sqlite/yks-programs-bundled-${SHA256_ZERO}-4.db`,
      new Uint8Array([9, 9, 9]),
    );
    const database = validDatabase();
    mockOpenDatabaseAsync.mockResolvedValue(database);

    const { prewarmProgramDatabase } = loadRepository();
    await prewarmProgramDatabase();

    const expectedName = `yks-programs-bundled-${SHA256_ZERO}-4.db`;
    expect(downloadAsync).toHaveBeenCalledTimes(1);
    expect(mockCopyFile).toHaveBeenCalledWith(
      'asset/programs.db',
      `file:///sqlite/${expectedName}`,
    );
    expect(mockDigest).toHaveBeenCalledTimes(1);
    expect(mockOpenDatabaseAsync).toHaveBeenCalledWith(
      expectedName,
      { useNewConnection: true },
      '/sqlite',
    );
    expect(
      [...mockFileStates.keys()].some((uri) =>
        uri.includes(`yks-programs-validated-bundled-2026.07.4-${SHA256_ZERO}-4.json`),
      ),
    ).toBe(true);
  });

  it('reads the bundled asset through a file:// URI when Android reports a bare path', async () => {
    // Release builds resolve Asset.localUri to /data/user/0/<pkg>/cache/ExponentAsset-*.db.
    // Passing that bare path to expo-file-system's File throws "URI is not absolute", which
    // aborted the copy and left the Programs screen empty on device.
    const descriptor = { path: 'programs.db', sha256: SHA256_ZERO, bytes: 4 };
    const barePath = '/data/user/0/com.sinanmertsener.ykshazirlik/cache/ExponentAsset-abc.db';
    mockGetActivePackLocation.mockResolvedValue({
      source: 'bundled',
      version: '2026.07.4',
      directory: null,
      manifest: { files: { programs: descriptor } },
    });
    mockAssetFromModule.mockReturnValue({
      downloadAsync: jest.fn(async () => undefined),
      localUri: barePath,
      hash: 'ignored-asset-hash',
    });
    setMockFile(`file://${barePath}`, new Uint8Array([1, 2, 3, 4]));
    mockOpenDatabaseAsync.mockResolvedValue(validDatabase());

    const { prewarmProgramDatabase } = loadRepository();
    await prewarmProgramDatabase();

    expect(mockCopyFile).toHaveBeenCalledWith(
      `file://${barePath}`,
      `file:///sqlite/yks-programs-bundled-${SHA256_ZERO}-4.db`,
    );
  });
});
