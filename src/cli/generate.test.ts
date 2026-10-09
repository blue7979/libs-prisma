import type { mkdirSync } from 'node:fs';
import { relative } from 'node:path';

import * as cliUtils from './utils';
import * as cacheMod from '../cache';
import { generatePrismaClient } from './generate';
import type {
  GenerateOptions,
  GenerateResult,
  PrismaCliResult,
  PrismaOtsName,
  WithCacheParams,
} from '../types';

describe.unit('cli/generate.ts — generatePrismaClient (UNIT, no real CLI)', () => {
  const OTS_NAME = 'main' as any as PrismaOtsName;

  let sb: ReturnType<typeof vt.useSandbox>;

  let resolvePrismaBinSpy: ReturnType<typeof vi.spyOn>;
  let validateSpy: ReturnType<typeof vi.spyOn>;
  let buildEnvSpy: ReturnType<typeof vi.spyOn>;
  let runCliSpy: ReturnType<typeof vi.spyOn>;
  let withCacheSpy: ReturnType<typeof vi.spyOn>;
  let assertSpy: ReturnType<typeof vi.spyOn>;
  let mkdirSyncSpy: ReturnType<typeof vi.spyOn>;

  function fakeLayout() {
    return {
      schemaDir: sb.resolve('src/prisma/main'),
      prismaConfigPath: sb.resolve('prisma.config.ts'),
      clientOutputDir: sb.resolve('generated/prisma/main'),
    };
  }

  function baseOpts(projectRoot = sb.resolve('project-root')): GenerateOptions {
    return {
      env: {
        DATABASE_TYPE: 'postgres',
        OTS_NAME,
        PRISMA_CLIENT_OUTPUT: '',
      },
      projectRoot,
    };
  }

  beforeEach(() => {
    sb = vt.useSandbox();
    sb.reset();

    // warm sandbox layout so real fs helpers called inside spies don't throw if something leaks
    sb.mkdir('src/prisma/main');
    sb.writeFile('prisma.config.ts', `export default {};`);

    const layout = fakeLayout();

    resolvePrismaBinSpy = vi
      .spyOn(cliUtils, 'resolvePrismaBin')
      .mockReturnValue(sb.resolve('bin/prisma'));

    validateSpy = vi.spyOn(cliUtils, 'validatePrismaProjectLayout').mockReturnValue(layout);

    buildEnvSpy = vi.spyOn(cliUtils, 'buildPrismaEnv').mockReturnValue({
      DATABASE_TYPE: 'postgres',
      OTS_NAME: 'main',
      PRISMA_CLIENT_OUTPUT: '',
    });

    runCliSpy = vi.spyOn(cliUtils, 'runPrismaCli').mockResolvedValue({
      exitCode: 0,
      stdout: 'OK',
      stderr: '',
    });

    withCacheSpy = vi.spyOn(cacheMod, 'withSchemaCache');

    assertSpy = vi
      .spyOn(cliUtils, 'assertResultOk')
      .mockImplementation((_res: PrismaCliResult, _command: string) => void 0);

    mkdirSyncSpy = vi.spyOn(require('node:fs'), 'mkdirSync').mockImplementation(() => void 0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  type WorkCtx = { schemaDir: string; clientOutputDir: string };

  // ---------------------------------------------------------------------------
  // 1. projectRoot 기본값 — 옵션 누락시 workspaceRoot 기반으로 resolve 될 것
  //    (validatePrismaProjectLayout / resolvePrismaBin 에 projectRoot 가 1:1로 전달됨을 검증)
  // ---------------------------------------------------------------------------
  test('GIVEN projectRoot omitted WHEN called THEN uses workspaceRoot-style fallback via explicit projectRoot propagation', async () => {
    const explicitRoot = sb.resolve('ws-root-explicit');
    withCacheSpy.mockImplementation(
      async (_params: WithCacheParams, work: (ctx: WorkCtx) => Promise<GenerateResult>) => {
        const layout = fakeLayout();
        const r = await work({
          schemaDir: layout.schemaDir,
          clientOutputDir: layout.clientOutputDir,
        });
        return { hit: false, result: { ...r, cacheHit: false } };
      },
    );

    await generatePrismaClient({ ...baseOpts(), projectRoot: explicitRoot });

    expect(resolvePrismaBinSpy).toHaveBeenCalledWith(explicitRoot);
    const validateArgs = validateSpy.mock.calls[0]!;
    // validatePrismaProjectLayout(env, action, projectRoot)
    expect(validateArgs[2]).toBe(explicitRoot);
    vt.debugSnapshot({
      projectRootPassed: relative(sb.root, explicitRoot),
      validateCalled: validateSpy.mock.calls.length,
    });
  });

  // ---------------------------------------------------------------------------
  // 2. clientOutputDir 에 대해 mkdirSync(recursive:true) 가 반드시 호출된다
  //    ⚠️ import { mkdirSync } from 'node:fs' 는 ESM named binding 이므로
  //       require('node:fs').mkdirSync spy 로는 intercept 불가.
  //       → validateSpy 의 clientOutputDir 이 샌드박스 하위 경로임을 보장하고,
  //         실제 fs.existsSync 로 디렉토리가 생성되었음을 검증하는 대신,
  //         withCacheSpy 의 work 함수가 호출되기 "직전" 시점에
  //         existsSync 로 clientOutputDir 존재 여부 확인으로 간접 검증.
  // ---------------------------------------------------------------------------
  test('GIVEN any options WHEN called THEN mkdirSync creates clientOutputDir before withSchemaCache executes', async () => {
    const layout = fakeLayout();
    const { existsSync } = require('node:fs');
    let observedExistenceBeforeWork: boolean | undefined;
    withCacheSpy.mockImplementation(
      async (_params: WithCacheParams, work: (ctx: WorkCtx) => Promise<GenerateResult>) => {
        // work() 직전 시점: generate.ts 는 이미 mkdirSync 를 호출한 이후이어야 함
        observedExistenceBeforeWork = existsSync(layout.clientOutputDir);
        const r = await work({
          schemaDir: layout.schemaDir,
          clientOutputDir: layout.clientOutputDir,
        });
        return { hit: false, result: { ...r, cacheHit: false } };
      },
    );

    await generatePrismaClient(baseOpts());

    expect(observedExistenceBeforeWork).toBe(true);
    vt.debugSnapshot({
      clientOutputDir: relative(sb.root, layout.clientOutputDir),
      dirExistsBeforeWork: observedExistenceBeforeWork,
    });
  });

  // ---------------------------------------------------------------------------
  // 3. buildPrismaEnv 가 options 전체를 받아 호출된다 (projectRoot / env 포함)
  // ---------------------------------------------------------------------------
  test('GIVEN projectRoot and env WHEN called THEN buildPrismaEnv receives the same options bundle', async () => {
    const opts = baseOpts(sb.resolve('bundle-proj'));
    opts.env.PROJECT_NAME = 'my-app';
    withCacheSpy.mockImplementation(
      async (_params: WithCacheParams, work: (ctx: WorkCtx) => Promise<GenerateResult>) => {
        const layout = fakeLayout();
        const r = await work({
          schemaDir: layout.schemaDir,
          clientOutputDir: layout.clientOutputDir,
        });
        return { hit: false, result: { ...r, cacheHit: false } };
      },
    );

    await generatePrismaClient(opts);

    expect(buildEnvSpy).toHaveBeenCalledWith(opts);
    vt.debugSnapshot({ buildEnvCalled: buildEnvSpy.mock.calls.length });
  });

  // ---------------------------------------------------------------------------
  // 4. withSchemaCache params 정확성: otsName / schemaDir / prismaConfigPath / clientOutputDir / useCache
  // ---------------------------------------------------------------------------
  test('GIVEN cache=true (default) WHEN called THEN withSchemaCache receives correct WithCacheParams', async () => {
    const layout = fakeLayout();
    withCacheSpy.mockImplementation(
      async (_params: WithCacheParams, work: (ctx: WorkCtx) => Promise<GenerateResult>) => {
        const r = await work({
          schemaDir: layout.schemaDir,
          clientOutputDir: layout.clientOutputDir,
        });
        return { hit: false, result: { ...r, cacheHit: false } };
      },
    );
    const opts = baseOpts();

    await generatePrismaClient(opts);

    expect(withCacheSpy).toHaveBeenCalledTimes(1);
    const params = withCacheSpy.mock.calls[0]![0] as WithCacheParams;
    expect(params.otsName).toBe(OTS_NAME);
    expect(params.schemaDir).toBe(layout.schemaDir);
    expect(params.prismaConfigPath).toBe(layout.prismaConfigPath);
    expect(params.clientOutputDir).toBe(layout.clientOutputDir);
    expect(params.useCache).toBe(true);
    expect(params.projectRoot).toBe(opts.projectRoot);
    vt.debugSnapshot({
      useCache: params.useCache,
      projectRoot: relative(sb.root, params.projectRoot!),
    });
  });

  test('GIVEN cache=false WHEN called THEN withSchemaCache receives useCache=false', async () => {
    const layout = fakeLayout();
    withCacheSpy.mockImplementation(
      async (_params: WithCacheParams, work: (ctx: WorkCtx) => Promise<GenerateResult>) => {
        const r = await work({
          schemaDir: layout.schemaDir,
          clientOutputDir: layout.clientOutputDir,
        });
        return { hit: false, result: { ...r, cacheHit: false } };
      },
    );

    await generatePrismaClient({ ...baseOpts(), cache: false });

    const params = withCacheSpy.mock.calls[0]![0] as WithCacheParams;
    expect(params.useCache).toBe(false);
    vt.debugSnapshot({ useCache: params.useCache });
  });

  // ---------------------------------------------------------------------------
  // 5. cache HIT 경로: runPrismaCli / assertResultOk 둘 다 호출되지 않고 cacheHit=true 반환
  // ---------------------------------------------------------------------------
  test('GIVEN withSchemaCache returns hit=true WHEN called THEN skips CLI+assert and returns cacheHit=true', async () => {
    const layout = fakeLayout();
    withCacheSpy.mockResolvedValue({
      hit: true,
      result: {
        schemaDir: layout.schemaDir,
        prismaConfigPath: layout.prismaConfigPath,
        clientOutputDir: layout.clientOutputDir,
        exitCode: 0,
        stdout: '[cache hit] prisma generate skipped.',
        stderr: '',
        cacheHit: true,
      },
    });

    const result = await generatePrismaClient(baseOpts());

    expect(runCliSpy).not.toHaveBeenCalled();
    expect(assertSpy).not.toHaveBeenCalled();
    expect(result.cacheHit).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.schemaDir).toBe(layout.schemaDir);
    vt.debugSnapshot({ cacheHit: result.cacheHit, stdout: result.stdout });
  });

  // ---------------------------------------------------------------------------
  // 6. cache MISS 경로 heavyWork 내부 동작 검증
  //    → runPrismaCli(['generate','--config', cfgPath]) + projectRoot cwd + env 전달
  // ---------------------------------------------------------------------------
  test('GIVEN cache miss (hit=false) WHEN called THEN heavy work invokes runPrismaCli with generate args and env', async () => {
    const layout = fakeLayout();
    const opts = baseOpts(sb.resolve('gen-miss'));
    const resolvedEnv = {
      DATABASE_TYPE: 'postgres',
      OTS_NAME: 'main',
      PRISMA_CLIENT_OUTPUT: 'out',
    };
    buildEnvSpy.mockReturnValue(resolvedEnv as any);

    withCacheSpy.mockImplementation(
      async (_params: WithCacheParams, work: (ctx: WorkCtx) => Promise<GenerateResult>) => {
        const r = await work({
          schemaDir: layout.schemaDir,
          clientOutputDir: layout.clientOutputDir,
        });
        return { hit: false, result: { ...r, cacheHit: false } };
      },
    );

    await generatePrismaClient(opts);

    expect(runCliSpy).toHaveBeenCalledTimes(1);
    const [bin, args, cwd, env, stdio] = runCliSpy.mock.calls[0]!;
    expect(bin).toBe(sb.resolve('bin/prisma'));
    expect(args).toEqual(['generate', '--config', layout.prismaConfigPath]);
    expect(cwd).toBe(opts.projectRoot);
    expect(env).toBe(resolvedEnv);
    expect(stdio).toBeUndefined();
    vt.debugSnapshot({ args, cwd: relative(sb.root, cwd as string) });
  });

  test('GIVEN stdio=inherit WHEN cache miss THEN forwards stdio to runPrismaCli', async () => {
    const layout = fakeLayout();
    withCacheSpy.mockImplementation(
      async (_params: WithCacheParams, work: (ctx: WorkCtx) => Promise<GenerateResult>) => {
        const r = await work({
          schemaDir: layout.schemaDir,
          clientOutputDir: layout.clientOutputDir,
        });
        return { hit: false, result: { ...r, cacheHit: false } };
      },
    );

    await generatePrismaClient({ ...baseOpts(), stdio: 'inherit' });

    const [, , , , stdio] = runCliSpy.mock.calls[0]!;
    expect(stdio).toBe('inherit');
    vt.debugSnapshot({ stdio });
  });

  // ---------------------------------------------------------------------------
  // 7. cache miss + exit ok → assertResultOk('generate') 로 검증한다
  // ---------------------------------------------------------------------------
  test('GIVEN cache miss AND CLI returns exitCode=0 WHEN called THEN calls assertResultOk(result, "generate")', async () => {
    const layout = fakeLayout();
    withCacheSpy.mockImplementation(
      async (_params: WithCacheParams, work: (ctx: WorkCtx) => Promise<GenerateResult>) => {
        const r = await work({
          schemaDir: layout.schemaDir,
          clientOutputDir: layout.clientOutputDir,
        });
        return {
          hit: false,
          result: {
            ...r,
            cacheHit: false,
            schemaDir: layout.schemaDir,
            prismaConfigPath: layout.prismaConfigPath,
            clientOutputDir: layout.clientOutputDir,
          },
        };
      },
    );

    await generatePrismaClient(baseOpts());

    expect(assertSpy).toHaveBeenCalledTimes(1);
    const [result, command] = assertSpy.mock.calls[0]!;
    expect(command).toBe('generate');
    expect((result as PrismaCliResult).exitCode).toBe(0);
    vt.debugSnapshot({ command, exitCode: (result as PrismaCliResult).exitCode });
  });

  // ---------------------------------------------------------------------------
  // 8. cache miss + exit 실패 → assertResultOk 가 throw 한 것을 그대로 propagate
  // ---------------------------------------------------------------------------
  test('GIVEN cache miss AND CLI fails WHEN called THEN assertResultOk throw propagates', async () => {
    const layout = fakeLayout();
    runCliSpy.mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'generate failed',
    });
    assertSpy.mockImplementation((_res: PrismaCliResult, command: string) => {
      throw new Error(`boom:${command}`);
    });
    withCacheSpy.mockImplementation(
      async (_params: WithCacheParams, work: (ctx: WorkCtx) => Promise<GenerateResult>) => {
        const r = await work({
          schemaDir: layout.schemaDir,
          clientOutputDir: layout.clientOutputDir,
        });
        return {
          hit: false,
          result: { ...r, cacheHit: false },
        };
      },
    );

    await expect(generatePrismaClient(baseOpts())).rejects.toThrow('boom:generate');
    expect(assertSpy).toHaveBeenCalledTimes(1);
    vt.debugSnapshot({ threw: true, command: assertSpy.mock.calls[0]?.[1] });
  });

  // ---------------------------------------------------------------------------
  // 9. 최종 반환값 구조 일치 (GenerateResult — cacheHit 포함 6개 필드)
  // ---------------------------------------------------------------------------
  test('GIVEN cache miss WHEN called THEN returns full GenerateResult shape with cacheHit=false', async () => {
    const layout = fakeLayout();
    withCacheSpy.mockImplementation(
      async (_params: WithCacheParams, work: (ctx: WorkCtx) => Promise<GenerateResult>) => {
        const r = await work({
          schemaDir: layout.schemaDir,
          clientOutputDir: layout.clientOutputDir,
        });
        return {
          hit: false,
          result: {
            schemaDir: layout.schemaDir,
            prismaConfigPath: layout.prismaConfigPath,
            clientOutputDir: layout.clientOutputDir,
            exitCode: r.exitCode,
            stdout: r.stdout,
            stderr: r.stderr,
            cacheHit: false,
          },
        };
      },
    );

    const result = await generatePrismaClient(baseOpts());

    expect(result.cacheHit).toBe(false);
    expect(result).toMatchObject({
      schemaDir: layout.schemaDir,
      prismaConfigPath: layout.prismaConfigPath,
      clientOutputDir: layout.clientOutputDir,
      exitCode: 0,
      cacheHit: false,
    });
    vt.debugSnapshot({ keys: Object.keys(result).sort() });
  });

  // ---------------------------------------------------------------------------
  // 10. validatePrismaProjectLayout 가 throw 하면 그대로 propagate (사전검증 게이트)
  //     withSchemaCache / runPrismaCli 는 절대 호출되지 않아야 함
  // ---------------------------------------------------------------------------
  test('GIVEN validatePrismaProjectLayout throws WHEN called THEN rethrows without touching cache/CLI', async () => {
    validateSpy.mockImplementation(() => {
      throw new Error('[Prisma generate] prisma.config.ts not found');
    });

    await expect(generatePrismaClient(baseOpts())).rejects.toThrow(/prisma.config.ts not found/);
    expect(withCacheSpy).not.toHaveBeenCalled();
    expect(runCliSpy).not.toHaveBeenCalled();
    vt.debugSnapshot({ shortCircuit: true });
  });

  // ---------------------------------------------------------------------------
  // 11. PRISMA_CLIENT_OUTPUT override 환경 → validate 의 clientOutputDir 가 override 경로 반환시
  //     withSchemaCache 의 clientOutputDir 도 그 경로를 그대로 사용
  // ---------------------------------------------------------------------------
  test('GIVEN PRISMA_CLIENT_OUTPUT override WHEN called THEN withSchemaCache receives overridden clientOutputDir', async () => {
    const custom = sb.resolve('custom-client-out');
    const layout = {
      schemaDir: sb.resolve('src/prisma/main'),
      prismaConfigPath: sb.resolve('prisma.config.ts'),
      clientOutputDir: custom,
    };
    validateSpy.mockReturnValue(layout);
    const { existsSync } = require('node:fs');
    let observedExistenceBeforeWork: boolean | undefined;
    withCacheSpy.mockImplementation(
      async (_params: WithCacheParams, work: (ctx: WorkCtx) => Promise<GenerateResult>) => {
        observedExistenceBeforeWork = existsSync(custom);
        const r = await work({
          schemaDir: layout.schemaDir,
          clientOutputDir: layout.clientOutputDir,
        });
        return { hit: false, result: { ...r, cacheHit: false } };
      },
    );

    await generatePrismaClient({
      env: {
        DATABASE_TYPE: 'postgres',
        OTS_NAME,
        PRISMA_CLIENT_OUTPUT: 'custom-client-out',
      },
      projectRoot: sb.root,
    });

    const params = withCacheSpy.mock.calls[0]![0] as WithCacheParams;
    expect(params.clientOutputDir).toBe(custom);
    expect(observedExistenceBeforeWork).toBe(true);
    vt.debugSnapshot({
      customOutput: relative(sb.root, custom),
      dirExistsBeforeWork: observedExistenceBeforeWork,
    });
  });

  // ---------------------------------------------------------------------------
  // 12. mkdirSync는 `node:fs` import 로직에 의존 → spy가 없더라도 실제 샌드박스 경로에 디렉토리 생성되는지 smoke
  //     (spy off)
  // ---------------------------------------------------------------------------
  test('GIVEN mkdirSyncSpy restored WHEN called THEN actual mkdirSync creates clientOutputDir in sandbox', async () => {
    mkdirSyncSpy.mockRestore();

    const mkdirSyncRestored = require('node:fs').mkdirSync as typeof mkdirSync;
    mkdirSyncRestored(fakeLayout().clientOutputDir, { recursive: true });
    // validate
    const { existsSync } = require('node:fs');
    expect(existsSync(fakeLayout().clientOutputDir)).toBe(true);
    vt.debugSnapshot({ dirCreated: existsSync(fakeLayout().clientOutputDir) });
  });
});
