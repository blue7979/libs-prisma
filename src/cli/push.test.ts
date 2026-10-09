import { relative } from 'node:path';

import { pushPrismaSchema } from './push';
import * as cliUtils from './utils';
import type { PrismaAction, PrismaCliResult, PrismaOtsName, PushOptions } from '../types';

describe.unit('cli/push.ts — pushPrismaSchema (UNIT, no real CLI/DB)', () => {
  const OTS_NAME = 'main' as any as PrismaOtsName;

  let sb: ReturnType<typeof vt.useSandbox>;

  let resolvePrismaBinSpy: ReturnType<typeof vi.spyOn>;
  let validateSpy: ReturnType<typeof vi.spyOn>;
  let buildEnvSpy: ReturnType<typeof vi.spyOn>;
  let runCliSpy: ReturnType<typeof vi.spyOn>;
  let assertSpy: ReturnType<typeof vi.spyOn>;

  function fakeLayout() {
    return {
      schemaDir: sb.resolve('src/prisma/main'),
      prismaConfigPath: sb.resolve('prisma.config.ts'),
      clientOutputDir: sb.resolve('generated/prisma/main'),
    };
  }

  function baseOpts(projectRoot = sb.resolve('project-root')): PushOptions {
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

    // Warm sandbox so any accidental real existsSync doesn't bail oddly
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
      stdout: 'The database is already in sync',
      stderr: '',
    });

    assertSpy = vi
      .spyOn(cliUtils, 'assertResultOk')
      .mockImplementation((_res: PrismaCliResult, _command: string) => void 0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // 1. projectRoot 전달 정확성 — resolvePrismaBin / validatePrismaProjectLayout 1:1
  // ---------------------------------------------------------------------------
  test('GIVEN projectRoot WHEN called THEN resolvePrismaBin AND validate both receive it exactly', async () => {
    const root = sb.resolve('push-root-a');
    await pushPrismaSchema(baseOpts(root));

    expect(resolvePrismaBinSpy).toHaveBeenCalledWith(root);
    expect(validateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ OTS_NAME, DATABASE_TYPE: 'postgres' }),
      'db push',
      root,
    );
    vt.debugSnapshot({ projectRoot: relative(sb.root, root) });
  });

  // ---------------------------------------------------------------------------
  // 2. 기본 push args = [db, push, --config, cfgPath] (force/url 없음)
  // ---------------------------------------------------------------------------
  test('GIVEN default options WHEN called THEN invokes runPrismaCli with [db push --config cfgPath]', async () => {
    const layout = fakeLayout();
    const opts = baseOpts();

    await pushPrismaSchema(opts);

    expect(runCliSpy).toHaveBeenCalledTimes(1);
    const [bin, args, cwd, env, stdio] = runCliSpy.mock.calls[0]!;
    expect(bin).toBe(sb.resolve('bin/prisma'));
    expect(args).toEqual(['db', 'push', '--config', layout.prismaConfigPath]);
    expect(cwd).toBe(opts.projectRoot);
    expect(env).toEqual({ DATABASE_TYPE: 'postgres', OTS_NAME: 'main', PRISMA_CLIENT_OUTPUT: '' });
    expect(stdio).toBeUndefined();
    vt.debugSnapshot({ args });
  });

  // ---------------------------------------------------------------------------
  // 3. Prisma 6+ 규약: --skip-generate 플래그는 절대 args에 포함되어서는 안된다
  // ---------------------------------------------------------------------------
  test('REGRESSION: GIVEN any combination of options WHEN called THEN --skip-generate is NEVER appended (Prisma 6+ removed)', async () => {
    const variations: PushOptions[] = [
      baseOpts(),
      { ...baseOpts(), forceReset: true },
      { ...baseOpts(), forceReset: true, acceptDataLoss: true },
      { ...baseOpts(), dbUrl: 'postgres://u:p@h/db' },
      { ...baseOpts(), forceReset: true, acceptDataLoss: true, dbUrl: 'postgres://u:p@h/db' },
    ];

    for (const opts of variations) {
      await pushPrismaSchema(opts);
    }

    const allArgs = runCliSpy.mock.calls.flatMap((call) => call[1] as string[]);
    expect(allArgs).not.toContain('--skip-generate');
    expect(allArgs).not.toContain('skip-generate');
    vt.debugSnapshot({ calls: runCliSpy.mock.calls.length, allArgsCount: allArgs.length });
  });

  // ---------------------------------------------------------------------------
  // 4. forceReset → --force-reset 추가
  // ---------------------------------------------------------------------------
  test('GIVEN forceReset=true WHEN called THEN appends --force-reset flag', async () => {
    await pushPrismaSchema({ ...baseOpts(), forceReset: true });

    const [, args] = runCliSpy.mock.calls[0]!;
    expect(args).toContain('--force-reset');
    vt.debugSnapshot({ args });
  });

  // ---------------------------------------------------------------------------
  // 5. acceptDataLoss 단독: 추가되지만 force-reset 은 자동으로 안붙음 (각 flag 독립)
  // ---------------------------------------------------------------------------
  test('GIVEN acceptDataLoss=true but forceReset=false WHEN called THEN only --accept-data-loss appended (independent flags)', async () => {
    await pushPrismaSchema({ ...baseOpts(), acceptDataLoss: true });

    const [, args] = runCliSpy.mock.calls[0]!;
    expect(args).toContain('--accept-data-loss');
    expect(args).not.toContain('--force-reset');
    vt.debugSnapshot({ args });
  });

  // ---------------------------------------------------------------------------
  // 6. forceReset + acceptDataLoss 둘 다 → 두 플래그 모두 args 에 존재
  // ---------------------------------------------------------------------------
  test('GIVEN forceReset AND acceptDataLoss both true WHEN called THEN both flags are appended', async () => {
    await pushPrismaSchema({ ...baseOpts(), forceReset: true, acceptDataLoss: true });

    const [, args] = runCliSpy.mock.calls[0]!;
    expect(args).toContain('--force-reset');
    expect(args).toContain('--accept-data-loss');
    // order: forceReset 이 acceptDataLoss 보다 먼저 push 되므로 인덱스 순서 유지
    expect(args.indexOf('--force-reset')).toBeLessThan(args.indexOf('--accept-data-loss'));
    vt.debugSnapshot({ args });
  });

  // ---------------------------------------------------------------------------
  // 7. dbUrl → --url <value> 한 쌍이 정확히 args 에 위치
  // ---------------------------------------------------------------------------
  test('GIVEN dbUrl override WHEN called THEN appends --url <value> pair in args', async () => {
    const url = 'postgresql://user:pass@host.local:5432/override-db?schema=public';
    await pushPrismaSchema({ ...baseOpts(), dbUrl: url });

    const [, args] = runCliSpy.mock.calls[0]!;
    const urlIdx = args.indexOf('--url');
    expect(urlIdx).toBeGreaterThan(-1);
    expect((args as string[])[urlIdx + 1]).toBe(url);
    vt.debugSnapshot({ args, urlIdx });
  });

  // ---------------------------------------------------------------------------
  // 8. 전체 조합: forceReset + acceptDataLoss + dbUrl 모두 적용된 args 검증
  // ---------------------------------------------------------------------------
  test('GIVEN forceReset + acceptDataLoss + dbUrl WHEN called THEN builds fully-qualified args with correct order', async () => {
    const layout = fakeLayout();
    const url = 'postgresql://x:y@z/db';
    await pushPrismaSchema({
      ...baseOpts(),
      forceReset: true,
      acceptDataLoss: true,
      dbUrl: url,
    });

    const [, args] = runCliSpy.mock.calls[0]!;
    expect(args).toEqual([
      'db',
      'push',
      '--config',
      layout.prismaConfigPath,
      '--force-reset',
      '--accept-data-loss',
      '--url',
      url,
    ]);
    vt.debugSnapshot({ args });
  });

  // ---------------------------------------------------------------------------
  // 9. stdio 모드 전달: 'inherit' / 미지정(undefined) → runPrismaCli 에 그대로 전달
  // ---------------------------------------------------------------------------
  test('GIVEN stdio=inherit WHEN called THEN runPrismaCli receives stdio="inherit"', async () => {
    await pushPrismaSchema({ ...baseOpts(), stdio: 'inherit' });

    const call = runCliSpy.mock.calls[0]!;
    expect(call[4]).toBe('inherit');
    vt.debugSnapshot({ stdio: call[4] });
  });

  test('GIVEN no stdio WHEN called THEN runPrismaCli receives undefined (falls back to utils default "pipe")', async () => {
    await pushPrismaSchema(baseOpts());

    const call = runCliSpy.mock.calls[0]!;
    expect(call[4]).toBeUndefined();
    vt.debugSnapshot({ stdio: call[4] ?? 'default-pipe' });
  });

  // ---------------------------------------------------------------------------
  // 10. buildPrismaEnv 는 options bundle 자체를 받아서 호출된다 (projectRoot 포함)
  // ---------------------------------------------------------------------------
  test('GIVEN opts with projectRoot WHEN called THEN buildPrismaEnv receives full options bundle', async () => {
    const opts = baseOpts(sb.resolve('env-bundle'));
    opts.env.PROJECT_NAME = 'apps-api';

    await pushPrismaSchema(opts);

    expect(buildEnvSpy).toHaveBeenCalledWith(opts);
    vt.debugSnapshot({ buildEnvCalled: buildEnvSpy.mock.calls.length });
  });

  // ---------------------------------------------------------------------------
  // 11. 성공 경로: assertResultOk(result, 'db push') 호출 + 반환값 구조 PrismaCliResult
  // ---------------------------------------------------------------------------
  test('GIVEN runPrismaCli succeeds (exit=0) WHEN called THEN calls assertResultOk("db push") and returns PrismaCliResult shape', async () => {
    const layout = fakeLayout();
    const result = await pushPrismaSchema(baseOpts());

    expect(assertSpy).toHaveBeenCalledTimes(1);
    const [assertedResult, command] = assertSpy.mock.calls[0]!;
    expect(command).toBe('db push');
    expect((assertedResult as PrismaCliResult).exitCode).toBe(0);

    expect(result).toMatchObject({
      schemaDir: layout.schemaDir,
      prismaConfigPath: layout.prismaConfigPath,
      clientOutputDir: layout.clientOutputDir,
      exitCode: 0,
      stdout: 'The database is already in sync',
      stderr: '',
    });
    expect(Object.keys(result).sort()).toEqual(
      ['schemaDir', 'prismaConfigPath', 'clientOutputDir', 'exitCode', 'stdout', 'stderr'].sort(),
    );
    vt.debugSnapshot({ keys: Object.keys(result).sort() });
  });

  // ---------------------------------------------------------------------------
  // 12. 실패 경로: runPrismaCli exit != 0 → assertResultOk 가 throw 한 것을 그대로 propagate
  // ---------------------------------------------------------------------------
  test('GIVEN runPrismaCli returns non-zero WHEN called THEN assertResultOk throw is propagated verbatim', async () => {
    // 2회 호출 모두 exit != 0 반환 → 2번째 assert에서도 throw 유도
    runCliSpy
      .mockResolvedValueOnce({
        exitCode: 42,
        stdout: '',
        stderr: 'table drop detected',
      })
      .mockResolvedValueOnce({
        exitCode: 42,
        stdout: '',
        stderr: 'table drop detected',
      });
    assertSpy.mockImplementation((res: PrismaCliResult, command: PrismaAction) => {
      if (res.exitCode !== 0) {
        const err = new Error(
          `Prisma ${command} failed (exitCode=${res.exitCode}).\n${res.stderr}`,
        );
        Object.assign(err, { result: res });
        throw err;
      }
    });

    await expect(pushPrismaSchema(baseOpts())).rejects.toThrow(
      /Prisma db push failed \(exitCode=42\)/,
    );
    await expect(pushPrismaSchema(baseOpts())).rejects.toThrow('table drop detected');
    vt.debugSnapshot({ threw: true, exitCode: 42 });
  });

  // ---------------------------------------------------------------------------
  // 13. 사전 검증 게이트: validate throw → runPrismaCli / assertResultOk 는 단 한번도 호출되지 않음
  // ---------------------------------------------------------------------------
  test('GIVEN validatePrismaProjectLayout throws WHEN called THEN short-circuits without runPrismaCli/assert', async () => {
    validateSpy.mockImplementation(() => {
      throw new Error('[Prisma db push] Schema directory not found');
    });

    await expect(pushPrismaSchema(baseOpts())).rejects.toThrow(/Schema directory not found/);
    expect(runCliSpy).not.toHaveBeenCalled();
    expect(assertSpy).not.toHaveBeenCalled();
    vt.debugSnapshot({ shortCircuit: true });
  });

  // ---------------------------------------------------------------------------
  // 14. projectRoot 기본값: 명시적으로 projectRoot를 넘기지 않았을 때
  //     validateSpy/projectRootSpy 통해 workspaceRoot가 사용되는지 간접 검증
  //     (workspaceRoot getter를 스파이해서 projectRoot 인자 일치 확인)
  // ---------------------------------------------------------------------------
  test('GIVEN projectRoot omitted WHEN called THEN utils are invoked with workspaceRoot as fallback', async () => {
    const nxMod = require('@nx/devkit');
    const fakeWs = sb.resolve('fake-ws-root');
    const wrSpy = vi.spyOn(nxMod, 'workspaceRoot', 'get').mockReturnValue(fakeWs);
    try {
      const optsNoRoot = {
        env: {
          DATABASE_TYPE: 'postgres' as const,
          OTS_NAME,
          PRISMA_CLIENT_OUTPUT: '',
        },
      } as PushOptions;
      await pushPrismaSchema(optsNoRoot);

      expect(resolvePrismaBinSpy).toHaveBeenCalledWith(fakeWs);
      const validateArgs = validateSpy.mock.calls[0]!;
      expect(validateArgs[2]).toBe(fakeWs);
      const [, , cwd] = runCliSpy.mock.calls[0]!;
      expect(cwd).toBe(fakeWs);
      vt.debugSnapshot({ workspaceRoot: relative(sb.root, fakeWs) });
    } finally {
      wrSpy.mockRestore();
    }
  });

  // ---------------------------------------------------------------------------
  // 15. buildPrismaEnv 가 반환한 env 가 runPrismaCli 의 env 로 그대로 전달되는지 identity check
  // ---------------------------------------------------------------------------
  test('GIVEN buildPrismaEnv returns specific env object WHEN called THEN runPrismaCli receives exact same object reference', async () => {
    const envObj: NodeJS.ProcessEnv = {
      DATABASE_TYPE: 'postgres',
      OTS_NAME: 'main',
      PRISMA_CLIENT_OUTPUT: 'gen-out',
      PROJECT_NAME: 'custom-proj',
    };
    buildEnvSpy.mockReturnValue(envObj);

    await pushPrismaSchema(baseOpts());

    const [, , , envPassed] = runCliSpy.mock.calls[0]!;
    expect(envPassed).toBe(envObj);
    vt.debugSnapshot({ envKeys: Object.keys(envPassed as any).sort() });
  });
});
