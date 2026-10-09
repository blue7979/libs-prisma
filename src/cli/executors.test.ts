import * as cliUtils from './utils';
import * as cacheMod from '../cache';
import { generatePrismaClient } from './generate';
import { pushPrismaSchema } from './push';
import type {
  GenerateOptions,
  GenerateResult,
  PrismaAction,
  PrismaCliResult,
  PrismaEnv,
  PrismaProjectLayoutContext,
  PushOptions,
  WithCacheParams,
} from '../types';

describe.component('Prisma CLI executors (generate + push)', () => {
  let sb: ReturnType<typeof vt.useSandbox>;

  let resolvePrismaBinSpy: ReturnType<typeof vi.spyOn>;
  let validateSpy: ReturnType<typeof vi.spyOn>;
  let buildEnvSpy: ReturnType<typeof vi.spyOn>;
  let runCliSpy: ReturnType<typeof vi.spyOn>;
  let withCacheSpy: ReturnType<typeof vi.spyOn>;
  let assertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sb = vt.useSandbox();
    sb.reset();

    sb.mkdir('src/prisma/main');
    sb.writeFile('prisma.config.ts', `export default {};`);
    sb.mkdir('generated/prisma/main');

    resolvePrismaBinSpy = vi
      .spyOn(cliUtils, 'resolvePrismaBin')
      .mockReturnValue(sb.resolve('fake-prisma-bin'));
    validateSpy = vi.spyOn(cliUtils, 'validatePrismaProjectLayout').mockImplementation(
      (): PrismaProjectLayoutContext => ({
        schemaDir: sb.resolve('src/prisma/main'),
        prismaConfigPath: sb.resolve('prisma.config.ts'),
        clientOutputDir: sb.resolve('generated/prisma/main'),
      }),
    );
    buildEnvSpy = vi.spyOn(cliUtils, 'buildPrismaEnv').mockReturnValue({
      DATABASE_TYPE: 'postgres',
      OTS_NAME: 'main',
    } as PrismaEnv & NodeJS.ProcessEnv);
    runCliSpy = vi.spyOn(cliUtils, 'runPrismaCli').mockResolvedValue({
      exitCode: 0,
      stdout: 'generated successfully',
      stderr: '',
    });
    withCacheSpy = vi.spyOn(cacheMod, 'withSchemaCache');
    assertSpy = vi
      .spyOn(cliUtils, 'assertResultOk')
      .mockImplementation((_res: PrismaCliResult, _command: string) => void 0);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // generatePrismaClient
  // ===========================================================================
  describe('generatePrismaClient', () => {
    type CacheWorkCtx = { schemaDir: string; clientOutputDir: string };

    function baseOpts(): GenerateOptions {
      return {
        env: {
          DATABASE_TYPE: 'postgres',
          OTS_NAME: 'main' as any,
          PRISMA_CLIENT_OUTPUT: '',
        },
        projectRoot: sb.resolve('fake-root-gen'),
      };
    }

    test('WHEN called THEN always calls resolvePrismaBin and validatePrismaProjectLayout first', async () => {
      withCacheSpy.mockImplementation(
        async (_opts: WithCacheParams, work: (ctx: CacheWorkCtx) => Promise<GenerateResult>) => {
          const r = await work({
            schemaDir: sb.resolve('src/prisma/main'),
            clientOutputDir: sb.resolve('generated/prisma/main'),
          });
          return {
            hit: false,
            result: {
              ...r,
              cacheHit: false,
              schemaDir: '',
              prismaConfigPath: '',
              clientOutputDir: '',
            } as any,
          };
        },
      );

      await generatePrismaClient({ ...baseOpts() });

      expect(resolvePrismaBinSpy).toHaveBeenCalledWith(sb.resolve('fake-root-gen'));
      expect(validateSpy).toHaveBeenCalledTimes(1);
      vt.debugSnapshot({
        resolveBinCalled: resolvePrismaBinSpy.mock.calls.length,
        validateCalled: validateSpy.mock.calls.length,
      });
    });

    test('GIVEN cache=true (default) AND withSchemaCache returns hit=true (cache HIT) THEN runPrismaCli is NOT called, assertResultOk is NOT called, returns cacheHit=true', async () => {
      withCacheSpy.mockImplementation(
        async (_opts: WithCacheParams, _work: (ctx: CacheWorkCtx) => Promise<GenerateResult>) => {
          return {
            hit: true,
            result: {
              exitCode: 0,
              stdout: 'cache hit',
              stderr: '',
              cacheHit: true,
              schemaDir: '',
              prismaConfigPath: '',
              clientOutputDir: '',
            },
          };
        },
      );

      const result = await generatePrismaClient({ ...baseOpts() });

      expect(runCliSpy).not.toHaveBeenCalled();
      expect(assertSpy).not.toHaveBeenCalled();
      expect(result.cacheHit).toBe(true);
      vt.debugSnapshot({
        cacheHit: result.cacheHit,
        cliCalled: runCliSpy.mock.calls.length,
        assertCalled: assertSpy.mock.calls.length,
      });
    });

    test('GIVEN useCache=true but cache MISS (hit=false) THEN heavy work invokes runPrismaCli and assertResultOk is called', async () => {
      withCacheSpy.mockImplementation(
        async (_opts: WithCacheParams, work: (ctx: CacheWorkCtx) => Promise<GenerateResult>) => {
          const r = await work({
            schemaDir: sb.resolve('src/prisma/main'),
            clientOutputDir: sb.resolve('generated/prisma/main'),
          });
          return {
            hit: false,
            result: {
              ...r,
              cacheHit: false,
              schemaDir: '',
              prismaConfigPath: '',
              clientOutputDir: '',
            } as any,
          };
        },
      );

      const result = await generatePrismaClient({ ...baseOpts() });

      expect(runCliSpy).toHaveBeenCalledTimes(1);
      const [bin, args, _cwd, _env, stdio] = runCliSpy.mock.calls[0]!;
      expect(bin).toBe(sb.resolve('fake-prisma-bin'));
      expect(args).toEqual(['generate', '--config', sb.resolve('prisma.config.ts')]);
      expect(stdio).toBeUndefined();
      expect(assertSpy).toHaveBeenCalledWith(expect.objectContaining({ exitCode: 0 }), 'generate');
      expect(result.cacheHit).toBe(false);
      vt.debugSnapshot({
        cliArgs: args,
        cacheHit: result.cacheHit,
        assertCommand: assertSpy.mock.calls[0]?.[1],
      });
    });

    test('GIVEN cache=false WHEN called THEN withSchemaCache receives useCache=false (bypass)', async () => {
      withCacheSpy.mockImplementation(
        async (_opts: WithCacheParams, work: (ctx: CacheWorkCtx) => Promise<GenerateResult>) => {
          const r = await work({
            schemaDir: sb.resolve('src/prisma/main'),
            clientOutputDir: sb.resolve('generated/prisma/main'),
          });
          return {
            hit: false,
            result: {
              ...r,
              cacheHit: false,
              schemaDir: '',
              prismaConfigPath: '',
              clientOutputDir: '',
            } as any,
          };
        },
      );

      await generatePrismaClient({ ...baseOpts(), cache: false });

      const passedOptions = withCacheSpy.mock.calls[0]?.[0];
      expect(passedOptions?.useCache).toBe(false);
      vt.debugSnapshot({ bypassCache: passedOptions?.useCache });
    });

    test('GIVEN stdio=inherit WHEN called THEN heavy work forwards stdio to runPrismaCli', async () => {
      withCacheSpy.mockImplementation(
        async (_opts: WithCacheParams, work: (ctx: CacheWorkCtx) => Promise<GenerateResult>) => {
          const r = await work({
            schemaDir: sb.resolve('src/prisma/main'),
            clientOutputDir: sb.resolve('generated/prisma/main'),
          });
          return {
            hit: false,
            result: {
              ...r,
              cacheHit: false,
              schemaDir: '',
              prismaConfigPath: '',
              clientOutputDir: '',
            } as any,
          };
        },
      );

      await generatePrismaClient({ ...baseOpts(), stdio: 'inherit' });

      const runCall = runCliSpy.mock.calls[0]!;
      expect(runCall[4]).toBe('inherit');
      vt.debugSnapshot({ stdio: runCall[4] });
    });
  });

  // ===========================================================================
  // pushPrismaSchema
  // ===========================================================================
  describe('pushPrismaSchema', () => {
    function baseOpts(): PushOptions {
      return {
        env: {
          DATABASE_TYPE: 'postgres',
          OTS_NAME: 'main' as any,
          PRISMA_CLIENT_OUTPUT: '',
        },
        projectRoot: sb.resolve('fake-root-push'),
      };
    }

    test('WHEN called with defaults THEN args = [db, push, --config, cfgPath] (no force flags)', async () => {
      const result = await pushPrismaSchema(baseOpts());

      expect(runCliSpy).toHaveBeenCalledTimes(1);
      const [, args] = runCliSpy.mock.calls[0]!;
      expect(args).toEqual(['db', 'push', '--config', sb.resolve('prisma.config.ts')]);
      expect(assertSpy).toHaveBeenCalledWith(expect.any(Object), 'db push');
      expect(result).toHaveProperty('exitCode', 0);
      vt.debugSnapshot({ args });
    });

    test('GIVEN forceReset=true + acceptDataLoss=true WHEN called THEN both CLI flags appended', async () => {
      await pushPrismaSchema({ ...baseOpts(), forceReset: true, acceptDataLoss: true });

      const [, args] = runCliSpy.mock.calls[0]!;
      expect(args).toContain('--force-reset');
      expect(args).toContain('--accept-data-loss');
      const forceIdx = args.indexOf('--force-reset');
      const acceptIdx = args.indexOf('--accept-data-loss');
      expect(forceIdx).toBeGreaterThan(0);
      expect(acceptIdx).toBeGreaterThan(0);
      vt.debugSnapshot({ args });
    });

    test('GIVEN dbUrl override WHEN called THEN --url flag is appended with provided value', async () => {
      await pushPrismaSchema({ ...baseOpts(), dbUrl: 'postgresql://x:y@z:5432/db' });

      const [, args] = runCliSpy.mock.calls[0]!;
      expect(args).toContain('--url');
      const urlArg = args[args.indexOf('--url') + 1];
      expect(urlArg).toBe('postgresql://x:y@z:5432/db');
      vt.debugSnapshot({ args });
    });

    test('WHEN runPrismaCli returns non-zero THEN assertResultOk is still called and propagates throw', async () => {
      runCliSpy.mockResolvedValueOnce({
        exitCode: 13,
        stdout: '',
        stderr: 'schema parse error',
      });
      assertSpy.mockImplementation((res: PrismaCliResult, command: PrismaAction) => {
        if (res.exitCode !== 0) {
          throw new Error(`Prisma ${command} failed`);
        }
      });

      await expect(pushPrismaSchema(baseOpts())).rejects.toThrow(/db push failed/);
      expect(assertSpy).toHaveBeenCalledTimes(1);
      vt.debugSnapshot({ throws: true, exitCode: 13 });
    });

    test('WHEN buildPrismaEnv returns extended env THEN runPrismaCli receives that env object', async () => {
      buildEnvSpy.mockReturnValue({
        DATABASE_TYPE: 'postgres',
        OTS_NAME: 'main',
        PRISMA_CLIENT_OUTPUT: 'custom/out',
        PROJECT_NAME: 'apps-api',
      });

      await pushPrismaSchema(baseOpts());

      const [, , , envPassed] = runCliSpy.mock.calls[0]!;
      expect(envPassed).toEqual({
        DATABASE_TYPE: 'postgres',
        OTS_NAME: 'main',
        PRISMA_CLIENT_OUTPUT: 'custom/out',
        PROJECT_NAME: 'apps-api',
      });
      vt.debugSnapshot({ envKeys: Object.keys(envPassed as any).sort() });
    });
  });
});
