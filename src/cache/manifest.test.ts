import { relative } from 'node:path';

import * as cliUtils from '../cli/utils';
import { PRISMA } from '../constants';
import { collectSchemaFiles, isSchemaCached, writeManifest, withSchemaCache } from './manifest';
import type { PrismaOtsName } from '../types';

describe.component('manifest cache module', () => {
  const OTS = 'test-ots' as any as PrismaOtsName;

  let sb: ReturnType<typeof vt.useSandbox>;
  let isOutputIntactSpy: ReturnType<typeof vi.spyOn>;
  let getManifestPathSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sb = vt.useSandbox();
    sb.reset();

    isOutputIntactSpy = vi.spyOn(cliUtils, 'isOutputIntact');
    getManifestPathSpy = vi
      .spyOn(cliUtils, 'getManifestPath')
      .mockImplementation((ots) =>
        sb.resolve(`mf-${ots satisfies PrismaOtsName}-${PRISMA.CACHE_MANIFEST_FILENAME}`),
      );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // collectSchemaFiles
  // ---------------------------------------------------------------------------
  describe('collectSchemaFiles', () => {
    test('GIVEN schema dir with 3 prisma files WHEN called THEN returns size/mtime record exactly for .prisma files only', () => {
      sb.writeFile('schema.prisma', 'datasource db { provider = "postgres" }');
      sb.writeFile('users.prisma', 'model User { id Int }');
      sb.writeFile('notes.txt', 'should be ignored');

      const out = collectSchemaFiles(sb.root);

      expect(Object.keys(out).sort()).toEqual(['schema.prisma', 'users.prisma']);
      for (const k of Object.keys(out)) {
        const st = sb.stat(k);
        expect(out[k].size).toBe(st!.size);
        expect(out[k].mtimeMs).toBe(st!.mtimeMs);
      }
      vt.debugSnapshot(Object.keys(out));
    });

    test('GIVEN empty schema dir WHEN called THEN returns empty object (no crash)', () => {
      const out = collectSchemaFiles(sb.root);
      expect(out).toEqual({});
      vt.debugSnapshot(out);
    });
  });

  // ---------------------------------------------------------------------------
  // writeManifest + atomic read/write internal helpers via writeManifest/read round-trip
  // ---------------------------------------------------------------------------
  describe('atomic manifest write/read', () => {
    test('GIVEN schema files WHEN writeManifest THEN manifest file created with correct JSON shape and can be parsed', () => {
      sb.writeFile('schema.prisma', 'generator client { provider = "prisma-client-js" }');

      writeManifest(OTS, sb.root, sb.root);

      const manifestAbs = getManifestPathSpy.mock.results[0]?.value satisfies string;
      const manifestRel = relative(sb.root, manifestAbs);
      const raw = sb.readFile(manifestRel, 'utf-8');
      const parsed = JSON.parse(raw);

      expect(parsed.version).toBe(PRISMA.CACHE_MANIFEST_VERSION);
      expect(parsed.schemaDir).toBe(sb.root);
      expect(parsed.generatedAt).toEqual(expect.any(String));
      expect(Object.keys(parsed.schemaFiles)).toEqual(['schema.prisma']);
      vt.debugSnapshot({ version: parsed.version, schemaKeys: Object.keys(parsed.schemaFiles) });
    });

    test('GIVEN manifest dir does not exist WHEN writeManifest THEN mkdirs parent dirs (recursive mkdir)', () => {
      const manifestFilename = `mf-deep-${PRISMA.CACHE_MANIFEST_FILENAME}`;
      getManifestPathSpy.mockReturnValue(sb.resolve(`deeply/nested/${manifestFilename}`));

      sb.writeFile('s.prisma', '//empty');

      expect(() => writeManifest(OTS, sb.root, sb.root)).not.toThrow();
      expect(sb.exists(`deeply/nested/${manifestFilename}`)).toBe(true);
      vt.debugSnapshot({
        manifestCreated: true,
        expectedPath: `deeply/nested/${manifestFilename}`,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // isSchemaCached
  // ---------------------------------------------------------------------------
  describe('isSchemaCached', () => {
    function warmManifest(): void {
      isOutputIntactSpy.mockReturnValue(true);
      sb.writeFile('a.prisma', '// a');
      sb.writeFile('b.prisma', '// b');
      writeManifest(OTS, sb.root, sb.root);
    }

    test('CASE 1: GIVEN output is NOT intact (missing files) THEN returns false, does not even open manifest', () => {
      warmManifest();
      isOutputIntactSpy.mockReturnValue(false);

      const result = isSchemaCached(OTS, sb.root, sb.root, sb.root);
      expect(result).toBe(false);
      vt.debugSnapshot(result);
    });

    test('CASE 2: GIVEN output intact but no manifest file exists THEN returns false', () => {
      isOutputIntactSpy.mockReturnValue(true);
      const result = isSchemaCached(OTS, sb.root, sb.root, sb.root);
      expect(result).toBe(false);
      vt.debugSnapshot(result);
    });

    test('CASE 3: GIVEN manifest has wrong version THEN returns false', () => {
      warmManifest();
      const manifestAbs = getManifestPathSpy.mock.results.at(-1)?.value satisfies string;
      const manifestRel = relative(sb.root, manifestAbs);
      const broken = JSON.parse(sb.readFile(manifestRel, 'utf-8'));
      broken.version = 999;
      sb.writeFile(manifestRel, JSON.stringify(broken));

      const result = isSchemaCached(OTS, sb.root, sb.root, sb.root);
      expect(result).toBe(false);
      vt.debugSnapshot(result);
    });

    test('CASE 4: GIVEN schema files fingerprint changed (mtime/size) THEN returns false', () => {
      warmManifest();
      sb.writeFile('a.prisma', '// a (modified — longer content)');

      const result = isSchemaCached(OTS, sb.root, sb.root, sb.root);
      expect(result).toBe(false);
      vt.debugSnapshot(result);
    });

    test('CASE 5: GIVEN a new schema file was added AND manifest is stale THEN returns false', () => {
      warmManifest();
      sb.writeFile('c.prisma', '// brand new model');

      const result = isSchemaCached(OTS, sb.root, sb.root, sb.root);
      expect(result).toBe(false);
      vt.debugSnapshot(result);
    });

    test('CASE 6 (HAPPY): GIVEN output intact + correct version + fingerprints all match THEN returns true (cache HIT)', () => {
      warmManifest();

      const result = isSchemaCached(OTS, sb.root, sb.root, sb.root);
      expect(result).toBe(true);
      vt.debugSnapshot(result);
    });
  });

  // ---------------------------------------------------------------------------
  // withSchemaCache
  // ---------------------------------------------------------------------------
  describe('withSchemaCache', () => {
    test('GIVEN useCache=true AND cache hit THEN heavyWork is NEVER called and returns hit:true with cacheHit=true', async () => {
      isOutputIntactSpy.mockReturnValue(true);
      sb.writeFile('s.prisma', '//');
      writeManifest(OTS, sb.root, sb.root);

      const heavy = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });

      const result = await withSchemaCache(
        {
          otsName: OTS,
          schemaDir: sb.root,
          prismaConfigPath: sb.resolve('prisma.config.ts'),
          clientOutputDir: sb.root,
          projectRoot: sb.root,
          useCache: true,
        },
        heavy,
      );

      expect(heavy).not.toHaveBeenCalled();
      expect(result.hit).toBe(true);
      expect(result.result.cacheHit).toBe(true);
      expect(result.result.exitCode).toBe(0);
      expect(result.result.stdout).toContain('cache hit');
      vt.debugSnapshot({ hit: result.hit, exitCode: result.result.exitCode });
    });

    test('GIVEN useCache=false THEN heavyWork is ALWAYS called even if cache would hit (cache bypass)', async () => {
      isOutputIntactSpy.mockReturnValue(true);
      sb.writeFile('s.prisma', '//');
      writeManifest(OTS, sb.root, sb.root);

      const heavy = vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'generated', stderr: '' });

      await withSchemaCache(
        {
          otsName: OTS,
          schemaDir: sb.root,
          prismaConfigPath: sb.resolve('prisma.config.ts'),
          clientOutputDir: sb.root,
          projectRoot: sb.root,
          useCache: false,
        },
        heavy,
      );

      expect(heavy).toHaveBeenCalledTimes(1);
      vt.debugSnapshot({ heavyCallCount: heavy.mock.calls.length });
    });

    test('GIVEN cache miss AND heavyWork exits 0 THEN manifest is written with NEW fingerprints', async () => {
      isOutputIntactSpy.mockReturnValue(true);
      sb.writeFile('fresh.prisma', 'model Fresh { id Int }');
      const beforeCount = sb.list('.').length;

      const heavy = vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' });

      const res = await withSchemaCache(
        {
          otsName: OTS,
          schemaDir: sb.root,
          prismaConfigPath: sb.resolve('prisma.config.ts'),
          clientOutputDir: sb.root,
          projectRoot: sb.root,
          useCache: true,
        },
        heavy,
      );

      expect(res.hit).toBe(false);
      expect(res.result.cacheHit).toBe(false);
      expect(heavy).toHaveBeenCalledTimes(1);
      const afterCount = sb.list('.').length;
      expect(afterCount).toBeGreaterThan(beforeCount);
      vt.debugSnapshot({ hit: res.hit, filesBefore: beforeCount, filesAfter: afterCount });
    });

    test('GIVEN heavyWork returns non-zero exit THEN manifest is NOT persisted (no false positive on next run)', async () => {
      isOutputIntactSpy.mockReturnValue(true);
      sb.writeFile('bad.prisma', 'broken syntax //');
      const before = sb.list('.').length;

      const heavy = vi
        .fn()
        .mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'prisma generate failed' });

      await withSchemaCache(
        {
          otsName: OTS,
          schemaDir: sb.root,
          prismaConfigPath: sb.resolve('prisma.config.ts'),
          clientOutputDir: sb.root,
          projectRoot: sb.root,
          useCache: true,
        },
        heavy,
      );
      const after = sb.list('.').length;

      expect(after).toEqual(before);
      vt.debugSnapshot({ filesChanged: before !== after });
    });

    test('GIVEN heavyWork ctx THEN receives resolved {schemaDir, clientOutputDir} from params', async () => {
      isOutputIntactSpy.mockReturnValue(false);
      const heavy = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });

      await withSchemaCache(
        {
          otsName: OTS,
          schemaDir: sb.root,
          prismaConfigPath: sb.resolve('prisma.config.ts'),
          clientOutputDir: sb.root,
          projectRoot: sb.root,
          useCache: true,
        },
        heavy,
      );

      expect(heavy).toHaveBeenCalledWith({
        schemaDir: sb.root,
        clientOutputDir: sb.root,
      });
      const rawCtx = heavy.mock.calls[0]?.[0];
      vt.debugSnapshot({
        schemaDir: rawCtx?.schemaDir ? relative(sb.root, rawCtx.schemaDir) : '',
        clientOutputDir: rawCtx?.clientOutputDir ? relative(sb.root, rawCtx.clientOutputDir) : '',
      });
    });
  });
});
