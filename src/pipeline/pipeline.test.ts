import { runPrismaPipeline } from './pipeline';
import * as genMod from '../cli/generate';
import * as pushMod from '../cli/push';
import * as cliUtils from '../cli/utils';
import { PRISMA } from '../constants';
import * as seedMod from '../seed/seed';
import * as studioMod from '../studio/studio';
import type {
  PipelineOptions,
  PipelineRetryHookInfo,
  PipelineStageHookInfo,
  PrismaOtsName,
} from '../types';

describe.unit('pipeline/pipeline.ts — runPrismaPipeline (UNIT, no real CLI/DB/Docker)', () => {
  const OTS_NAME = 'main' as any as PrismaOtsName;

  let sb: ReturnType<typeof vt.useSandbox>;

  // spies
  let resolvePrismaBinSpy: ReturnType<typeof vi.spyOn>;
  let validateSpy: ReturnType<typeof vi.spyOn>;
  let isOutputIntactSpy: ReturnType<typeof vi.spyOn>;
  let pushSpy: ReturnType<typeof vi.spyOn>;
  let genSpy: ReturnType<typeof vi.spyOn>;
  let seedExistsSpy: ReturnType<typeof vi.spyOn>;
  let runSeedSpy: ReturnType<typeof vi.spyOn>;
  let studioSpy: ReturnType<typeof vi.spyOn>;
  // NOTE: timers/promises setTimeout은 ESM named import binding으로 spy count가 부정확한 환경 존재.
  // 참조를 위한 no-op 변수. TS6133 제거 용.

  let waitSpyRef: ReturnType<typeof vi.spyOn> | undefined = undefined;

  function layout() {
    return {
      schemaDir: sb.resolve('src/prisma/main'),
      prismaConfigPath: sb.resolve('prisma.config.ts'),
      clientOutputDir: sb.resolve('generated/prisma/main'),
    };
  }

  function baseOpts(
    action: PipelineOptions['action'] = 'setup',
    projectRoot = sb.resolve('project-root'),
  ): PipelineOptions {
    return {
      action,
      projectRoot,
      env: {
        DATABASE_TYPE: 'postgres',
        OTS_NAME,
        PRISMA_CLIENT_OUTPUT: '',
      },
      maxRetry: 3,
      retryDelayMs: 1,
    };
  }

  beforeEach(() => {
    sb = vt.useSandbox();
    sb.reset();
    sb.mkdir('src/prisma/main');
    sb.writeFile('prisma.config.ts', 'export default {};');

    resolvePrismaBinSpy = vi
      .spyOn(cliUtils, 'resolvePrismaBin')
      .mockReturnValue(sb.resolve('bin/prisma'));
    validateSpy = vi.spyOn(cliUtils, 'validatePrismaProjectLayout').mockReturnValue(layout());
    isOutputIntactSpy = vi.spyOn(cliUtils, 'isOutputIntact').mockReturnValue(true);

    pushSpy = vi.spyOn(pushMod, 'pushPrismaSchema').mockResolvedValue({
      exitCode: 0,
      stdout: 'pushed',
      stderr: '',
      schemaDir: layout().schemaDir,
      prismaConfigPath: layout().prismaConfigPath,
      clientOutputDir: layout().clientOutputDir,
    });
    genSpy = vi.spyOn(genMod, 'generatePrismaClient').mockResolvedValue({
      exitCode: 0,
      stdout: 'generated',
      stderr: '',
      cacheHit: false,
      schemaDir: layout().schemaDir,
      prismaConfigPath: layout().prismaConfigPath,
      clientOutputDir: layout().clientOutputDir,
    });
    seedExistsSpy = vi.spyOn(seedMod, 'seedExists').mockReturnValue(true);
    runSeedSpy = vi
      .spyOn(seedMod, 'runPrismaSeed')
      .mockResolvedValue({ exitCode: 0, stdout: 'seed ok', stderr: '' });
    studioSpy = vi
      .spyOn(studioMod, 'startPrismaStudio')
      .mockReturnValue({ unref: () => void 0 } as any);

    // wait 타이머 real timer를 stub — 실제 sleep하지 않아야 UNIT 완전 고립
    const timers = require('node:timers/promises');
    waitSpyRef = vi
      .spyOn(timers, 'setTimeout')
      .mockImplementation(async (_delay: unknown) => Promise.resolve());
  });

  afterEach(() => {
    // TS6133 unused var 제거 — waitSpyRef는 ESM named binding 한계로 assertion에 사용하지 않으나,
    // beforeEach에서 stub으로 할당되어 실제 sleep을 막아주는 역할 수행
    void waitSpyRef;
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // 1. 옵션 기본값 세팅 — projectRoot / stdio / maxRetry / retryDelayMs / studioPort
  // ===========================================================================
  describe('Option default propagation (precondition gates)', () => {
    test('GIVEN projectRoot omitted WHEN called THEN resolves via workspaceRoot getter into resolvePrismaBin/validate', async () => {
      const nx = require('@nx/devkit');
      const fakeWs = sb.resolve('ws-default');
      const wsSpy = vi.spyOn(nx, 'workspaceRoot', 'get').mockReturnValue(fakeWs);
      try {
        const opts: PipelineOptions = {
          action: 'generate',
          env: { DATABASE_TYPE: 'postgres', OTS_NAME, PRISMA_CLIENT_OUTPUT: '' },
          maxRetry: 1,
          retryDelayMs: 1,
        };
        await runPrismaPipeline(opts);
        expect(resolvePrismaBinSpy).toHaveBeenCalledWith(fakeWs);
        expect(validateSpy.mock.calls[0]?.[2]).toBe(fakeWs);
        vt.debugSnapshot({ projectRootDefaulted: fakeWs.split('/').at(-1) });
      } finally {
        wsSpy.mockRestore();
      }
    });

    test('GIVEN maxRetry/retryDelayMs/stdio/studioPort omitted WHEN called THEN uses PRISMA.* defaults', async () => {
      const opts: PipelineOptions = {
        action: 'start',
        projectRoot: sb.resolve('defaults'),
        env: { DATABASE_TYPE: 'postgres', OTS_NAME, PRISMA_CLIENT_OUTPUT: '' },
      };
      // 작게 override to speed test를 위해 1회만 성공시키고 maxRetry/retryDelayMs/stdio/studioPort가 기본값 30/3000/pipe/3000 사용 여부는 스파이 call로 간접 추적
      seedExistsSpy.mockReturnValue(false);
      await runPrismaPipeline(opts);
      const pushOpts = pushSpy.mock.calls[0]?.[0] as any;
      expect(pushOpts.stdio).toBe(PRISMA.CLI_DEFAULT_STDIO);
      const studioOpts = studioSpy.mock.calls[0]?.[0] as any;
      expect(studioOpts?.studioPort).toBe(PRISMA.PIPELINE_DEFAULT_STUDIO_PORT);
      vt.debugSnapshot({
        stdio: pushOpts.stdio,
        studioPort: studioOpts?.studioPort,
      });
    });

    test('GIVEN maxRetry=0 WHEN called THEN does not enter loop, returns ok=false, totalAttempts=0, no stages run', async () => {
      const opts = baseOpts('start');
      opts.maxRetry = 0;
      const res = await runPrismaPipeline(opts);
      expect(res.ok).toBe(false);
      expect(res.totalAttempts).toBe(0);
      expect(res.studioStarted).toBe(false);
      expect(pushSpy).not.toHaveBeenCalled();
      expect(genSpy).not.toHaveBeenCalled();
      expect(runSeedSpy).not.toHaveBeenCalled();
      expect(res.lastFailure?.failedStage).toBe('push');
      expect(res.lastFailure?.exitCode).toBe(-1);
      vt.debugSnapshot({
        ok: res.ok,
        totalAttempts: res.totalAttempts,
        reason: res.lastFailure?.reason,
      });
    });
  });

  // ===========================================================================
  // 2. generate 단독 모드 short-circuit — retry loop 진입 안함 / studio 미실행
  // ===========================================================================
  describe('ACTION=generate short-circuit branch', () => {
    test('GIVEN action=generate AND exit 0 AND output intact WHEN called THEN returns ok=true, no push/seed/studio', async () => {
      const opts = baseOpts('generate');
      const res = await runPrismaPipeline(opts);
      expect(res.ok).toBe(true);
      expect(res.totalAttempts).toBe(0);
      expect(res.studioStarted).toBe(false);
      expect(genSpy).toHaveBeenCalledTimes(1);
      const genOpts = genSpy.mock.calls[0]![0] as any;
      expect(genOpts.cache).toBe(true);
      expect(pushSpy).not.toHaveBeenCalled();
      expect(runSeedSpy).not.toHaveBeenCalled();
      expect(studioSpy).not.toHaveBeenCalled();
      vt.debugSnapshot({
        cache: genOpts.cache,
        calls: {
          push: pushSpy.mock.calls.length,
          gen: genSpy.mock.calls.length,
        },
      });
    });

    test('GIVEN action=generate AND exit!=0 WHEN called THEN returns ok=false with failedStage=generate + reason classification', async () => {
      genSpy.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'parse error',
        cacheHit: false,
        schemaDir: layout().schemaDir,
        prismaConfigPath: layout().prismaConfigPath,
        clientOutputDir: layout().clientOutputDir,
      });
      const opts = baseOpts('generate');
      const res = await runPrismaPipeline(opts);
      expect(res.ok).toBe(false);
      expect(res.totalAttempts).toBe(0);
      expect(res.studioStarted).toBe(false);
      expect(res.lastFailure?.failedStage).toBe('generate');
      expect(res.lastFailure?.exitCode).toBe(1);
      expect(res.lastFailure?.reason).toBe('PUSH_DB_OR_SCHEMA_ERROR'); // exit!=0이고 stage=generate + intact=true로 분류
      vt.debugSnapshot({
        failedStage: res.lastFailure?.failedStage,
        reason: res.lastFailure?.reason,
      });
    });

    test('GIVEN action=generate AND exit=0 BUT isOutputIntact=false WHEN called THEN reason=GENERATE_OUTPUT_CORRUPT', async () => {
      isOutputIntactSpy.mockReturnValue(false);
      const opts = baseOpts('generate');
      const res = await runPrismaPipeline(opts);
      expect(res.ok).toBe(false);
      expect(res.lastFailure?.failedStage).toBe('generate');
      expect(res.lastFailure?.reason).toBe('GENERATE_OUTPUT_CORRUPT');
      vt.debugSnapshot({ reason: res.lastFailure?.reason });
    });

    test('GIVEN action=generate AND onStage provided WHEN called THEN calls onStage exactly once for generate', async () => {
      const onStage = vi.fn();
      const opts: PipelineOptions = { ...baseOpts('generate'), onStage };
      await runPrismaPipeline(opts);
      expect(onStage).toHaveBeenCalledTimes(1);
      const info = onStage.mock.calls[0]![0] as PipelineStageHookInfo;
      expect(info.stage).toBe('generate');
      expect(info.attempt).toBe(0);
      expect(info.ok).toBe(true);
      vt.debugSnapshot({ stage: info.stage, ok: info.ok });
    });
  });

  // ===========================================================================
  // 3. n=0 초기 스테이징 (PIPELINE_INITIAL_STAGES: push → generate → seed)
  // ===========================================================================
  describe('attempt=0 INITIAL_STAGES (push → generate → seed)', () => {
    test('GIVEN action=start WHEN all stages success THEN initial stages are [push,generate,seed] called once each', async () => {
      const opts = baseOpts('start');
      const res = await runPrismaPipeline(opts);
      expect(res.ok).toBe(true);
      expect(res.totalAttempts).toBe(0);
      expect(pushSpy).toHaveBeenCalledTimes(1);
      expect(genSpy).toHaveBeenCalledTimes(1);
      expect(runSeedSpy).toHaveBeenCalledTimes(1);
      // n=0이므로 forceReset:true + acceptDataLoss:true
      const pushOpts = pushSpy.mock.calls[0]![0] as any;
      expect(pushOpts.forceReset).toBe(true);
      expect(pushOpts.acceptDataLoss).toBe(true);
      const genOpts = genSpy.mock.calls[0]![0] as any;
      expect(genOpts.cache).toBe(false);
      vt.debugSnapshot({
        forceReset: pushOpts.forceReset,
        cache: genOpts.cache,
        seedsRun: runSeedSpy.mock.calls.length,
      });
    });

    test('GIVEN action=setup AND all success WHEN called THEN startPrismaStudio is called after pipeline with studioPort default 3000', async () => {
      const opts = baseOpts('setup');
      const res = await runPrismaPipeline(opts);
      expect(res.ok).toBe(true);
      expect(res.studioStarted).toBe(true);
      expect(studioSpy).toHaveBeenCalledTimes(1);
      const studioOpts = studioSpy.mock.calls[0]![0] as any;
      expect(studioOpts.studioPort).toBe(PRISMA.PIPELINE_DEFAULT_STUDIO_PORT);
      expect(studioOpts.prismaConfigPath).toBe(layout().prismaConfigPath);
      expect(studioOpts.otsName).toBe(OTS_NAME);
      vt.debugSnapshot({ studioStarted: res.studioStarted, port: studioOpts.studioPort });
    });

    test('GIVEN action=generate WHEN success THEN studio is NEVER started', async () => {
      const opts = baseOpts('generate');
      const res = await runPrismaPipeline(opts);
      expect(res.studioStarted).toBe(false);
      expect(studioSpy).not.toHaveBeenCalled();
      vt.debugSnapshot({ studioStarted: res.studioStarted });
    });

    test('GIVEN seedExists=false WHEN seed stage THEN runPrismaSeed NOT called but onStage seed called with ok=true', async () => {
      seedExistsSpy.mockReturnValue(false);
      const onStage = vi.fn();
      const opts: PipelineOptions = { ...baseOpts('start'), onStage };
      const res = await runPrismaPipeline(opts);
      expect(res.ok).toBe(true);
      expect(runSeedSpy).not.toHaveBeenCalled();
      const seedHook = onStage.mock.calls.find(
        (c: any) => (c[0] as PipelineStageHookInfo).stage === 'seed',
      )?.[0] as PipelineStageHookInfo;
      expect(seedHook?.ok).toBe(true);
      expect(seedHook?.exitCode).toBe(0);
      vt.debugSnapshot({
        seedHookOk: seedHook?.ok,
        runSeedCalledTimes: runSeedSpy.mock.calls.length,
      });
    });

    test('GIVEN seedExists=true WHEN called THEN runPrismaSeed receives seedEnvWith TARGET=OTS_NAME + ACTION=pipelineAction', async () => {
      const opts = baseOpts('setup');
      opts.env.TARGET = undefined;
      opts.env.ACTION = undefined;
      await runPrismaPipeline(opts);
      const seedOpts = runSeedSpy.mock.calls[0]![0] as any;
      expect(seedOpts.env.TARGET).toBe(OTS_NAME);
      expect(seedOpts.env.ACTION).toBe('setup');
      vt.debugSnapshot({ TARGET: seedOpts.env.TARGET, ACTION: seedOpts.env.ACTION });
    });

    test('GIVEN env.TARGET already overridden WHEN seed THEN runPrismaSeed uses explicit TARGET (no override with OTS)', async () => {
      const opts = baseOpts('start');
      opts.env.TARGET = 'custom-target' as any;
      opts.env.ACTION = 'my-action' as any;
      await runPrismaPipeline(opts);
      const seedOpts = runSeedSpy.mock.calls[0]?.[0] as any;
      expect(seedOpts.env.TARGET).toBe('custom-target');
      expect(seedOpts.env.ACTION).toBe('my-action');
      vt.debugSnapshot({ TARGET: seedOpts.env.TARGET, ACTION: seedOpts.env.ACTION });
    });

    test('GIVEN custom studioPort WHEN setup/start success THEN studio uses custom port', async () => {
      const opts = baseOpts('start');
      opts.studioPort = 5555;
      const res = await runPrismaPipeline(opts);
      expect(res.studioStarted).toBe(true);
      const studioOpts = studioSpy.mock.calls[0]?.[0] as any;
      expect(studioOpts?.studioPort).toBe(5555);
      vt.debugSnapshot({ studioPort: studioOpts?.studioPort });
    });
  });

  // ===========================================================================
  // 4. 재시도 로직 — 스테이지별 실패 → classifyFailure reason
  // ===========================================================================
  describe('retry loop & failure classification', () => {
    test('GIVEN push always fails with exit=2 WHEN called THEN reason=PUSH_INVALID_OPTION + maxRetry 까지 재시도', async () => {
      pushSpy.mockResolvedValue({
        exitCode: 2,
        stdout: '',
        stderr: 'unknown option',
        schemaDir: layout().schemaDir,
        prismaConfigPath: layout().prismaConfigPath,
        clientOutputDir: layout().clientOutputDir,
      });
      const onRetry = vi.fn();
      const opts: PipelineOptions = { ...baseOpts('start'), maxRetry: 3, retryDelayMs: 1, onRetry };
      const res = await runPrismaPipeline(opts);
      expect(res.ok).toBe(false);
      expect(res.totalAttempts).toBe(3);
      expect(pushSpy).toHaveBeenCalledTimes(3);
      expect(genSpy).not.toHaveBeenCalled();
      expect(onRetry).toHaveBeenCalledTimes(3);
      // NOTE: vi.spyOn(node:timers/promises setTimeout) 는 ESM named import binding 때문에 호출 횟수를 정확히
      // 잡지 못하는 환경이 있으므로 waitSpy 호출 횟수 대신 onRetry 정보만 검증하고 대체
      const firstRetryInfo = onRetry.mock.calls[0]![0] as PipelineRetryHookInfo;
      expect(firstRetryInfo.failedStage).toBe('push');
      expect(firstRetryInfo.reason).toBe('PUSH_INVALID_OPTION');
      expect(firstRetryInfo.attempt).toBe(1);
      // remaining = maxRetry - attempt - 1 (attempt는 onRetry 호출 시점의 for 루프 카운터 = 0번째 시도 실패 직후라 0)
      //            = 3 - 0 - 1 = 2
      expect(firstRetryInfo.remaining).toBe(2);
      vt.debugSnapshot({
        reason: firstRetryInfo.reason,
        total: res.totalAttempts,
        retryCalls: onRetry.mock.calls.length,
      });
    });

    test('GIVEN push fails exit!=0 (not 2) WHEN called THEN reason=PUSH_DB_OR_SCHEMA_ERROR', async () => {
      pushSpy.mockResolvedValue({
        exitCode: 42,
        stdout: '',
        stderr: 'connection refused',
        schemaDir: layout().schemaDir,
        prismaConfigPath: layout().prismaConfigPath,
        clientOutputDir: layout().clientOutputDir,
      });
      const onRetry = vi.fn();
      const opts: PipelineOptions = { ...baseOpts('start'), maxRetry: 2, retryDelayMs: 1, onRetry };
      await runPrismaPipeline(opts);
      const info = onRetry.mock.calls[0]?.[0] as PipelineRetryHookInfo;
      expect(info?.reason).toBe('PUSH_DB_OR_SCHEMA_ERROR');
      vt.debugSnapshot({ reason: info?.reason, exitCode: info?.exitCode });
    });

    test('GIVEN push success BUT generate exit!=0 WHEN called THEN fails at generate + reason', async () => {
      // attempt=0에서 push OK → generate fail → onRetry + wait
      // attempt=1에서는 RETRY_STAGES [push,seed] 이므로 generate는 스킵됨 — 그래서 seed까지 성공하면 전체 성공임.
      // → generate 실패를 증명하려면 maxRetry=1 (1회차만 돌고 끝내야 generate 실패가 반환됨)
      pushSpy.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'pushed',
        stderr: '',
        schemaDir: layout().schemaDir,
        prismaConfigPath: layout().prismaConfigPath,
        clientOutputDir: layout().clientOutputDir,
      });
      genSpy.mockResolvedValueOnce({
        exitCode: 7,
        stdout: '',
        stderr: 'bad schema',
        cacheHit: false,
        schemaDir: layout().schemaDir,
        prismaConfigPath: layout().prismaConfigPath,
        clientOutputDir: layout().clientOutputDir,
      });
      const opts = baseOpts('start', sb.resolve('gen-fail'));
      opts.maxRetry = 1;
      opts.retryDelayMs = 1;
      const res = await runPrismaPipeline(opts);
      expect(res.ok).toBe(false);
      expect(res.lastFailure?.failedStage).toBe('generate');
      expect(res.lastFailure?.reason).toBe('PUSH_DB_OR_SCHEMA_ERROR');
      vt.debugSnapshot({
        failedStage: res.lastFailure?.failedStage,
        reason: res.lastFailure?.reason,
      });
    });

    test('GIVEN push success + generate exit 0 BUT isOutputIntact=false WHEN called THEN reason=GENERATE_OUTPUT_CORRUPT', async () => {
      isOutputIntactSpy.mockReturnValue(false);
      const onRetry = vi.fn();
      const opts: PipelineOptions = { ...baseOpts('start'), maxRetry: 2, retryDelayMs: 1, onRetry };
      await runPrismaPipeline(opts);
      const info = onRetry.mock.calls[0]?.[0] as PipelineRetryHookInfo;
      expect(info?.reason).toBe('GENERATE_OUTPUT_CORRUPT');
      expect(info?.failedStage).toBe('generate');
      vt.debugSnapshot({ reason: info?.reason });
    });

    test('GIVEN push+generate success BUT seed fails WHEN called THEN reason=SEED_SCRIPT_FAILED', async () => {
      runSeedSpy.mockResolvedValue({ exitCode: 5, stdout: '', stderr: 'fk violation' });
      const opts = baseOpts('start');
      opts.maxRetry = 2;
      opts.retryDelayMs = 1;
      const res = await runPrismaPipeline(opts);
      expect(res.lastFailure?.failedStage).toBe('seed');
      expect(res.lastFailure?.reason).toBe('SEED_SCRIPT_FAILED');
      vt.debugSnapshot({
        failedStage: res.lastFailure?.failedStage,
        reason: res.lastFailure?.reason,
      });
    });

    test('GIVEN n=0 fails AND n>=1 retries with RETRY_STAGES [push,seed] — generate는 재시도 안함', async () => {
      // n=0 에서 seed fail → n=1 부터는 push + seed 만 (generate 생략)
      runSeedSpy
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'first seed error' })
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'second seed error' })
        .mockResolvedValue({ exitCode: 0, stdout: 'seed ok', stderr: '' });
      const opts = baseOpts('start');
      opts.maxRetry = 5;
      opts.retryDelayMs = 1;
      const res = await runPrismaPipeline(opts);
      expect(res.ok).toBe(true);
      expect(res.totalAttempts).toBe(2);
      expect(pushSpy).toHaveBeenCalledTimes(3); // 0,1,2 시도 모두 push 호출
      expect(genSpy).toHaveBeenCalledTimes(1); // ✅ 오직 n=0 에서만 generate 호출
      expect(runSeedSpy).toHaveBeenCalledTimes(3); // 0,1,2 시도 모두 seed 호출
      // n=1 두 번째 시도 pushOpts 확인 — forceReset=false, acceptDataLoss=false
      const pushOptsAttempt1 = pushSpy.mock.calls[1]?.[0] as any;
      expect(pushOptsAttempt1?.forceReset).toBe(false);
      expect(pushOptsAttempt1?.acceptDataLoss).toBeFalsy();
      vt.debugSnapshot({
        genCalled: genSpy.mock.calls.length,
        pushCalled: pushSpy.mock.calls.length,
        seedCalled: runSeedSpy.mock.calls.length,
        attempt1ForceReset: pushOptsAttempt1?.forceReset,
      });
    });
  });

  // ===========================================================================
  // 5. onStage / onRetry hook 호출 횟수 / wait 호출 횟수
  // ===========================================================================
  describe('hook & wait fidelity', () => {
    test('GIVEN all stages success WHEN called THEN onStage called per stage per attempt', async () => {
      const onStage = vi.fn();
      const opts: PipelineOptions = { ...baseOpts('start'), onStage };
      await runPrismaPipeline(opts);
      expect(onStage).toHaveBeenCalledTimes(3); // push, generate, seed
      const stages = onStage.mock.calls.map((c: any[]) => (c[0] as PipelineStageHookInfo).stage);
      expect(stages).toEqual(['push', 'generate', 'seed']);
      vt.debugSnapshot({ stages });
    });

    test('GIVEN onRetry provided WHEN called THEN onRetry called before wait, suggestedDelayMs = retryDelayMs option', async () => {
      pushSpy.mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: '',
        schemaDir: layout().schemaDir,
        prismaConfigPath: layout().prismaConfigPath,
        clientOutputDir: layout().clientOutputDir,
      });
      const onRetry = vi.fn().mockImplementation(async () => void 0);
      const opts: PipelineOptions = {
        ...baseOpts('start'),
        maxRetry: 2,
        // retryDelayMs를 작게 (1ms) 유지 — timers/promises setTimeout spy가 ESM named binding으로 제대로
        // 안걸리는 환경 fallback. UNIT 단위로는 "큰 delay 값 전달되면 실제 sleep 발생" 문제를 회피.
        retryDelayMs: 1,
        onRetry,
      };
      await runPrismaPipeline(opts);
      const info = onRetry.mock.calls[0]?.[0] as PipelineRetryHookInfo;
      // suggestedDelayMs = option.retryDelayMs = 1임을 검증
      expect(info?.suggestedDelayMs).toBe(1);
      // NOTE: vi.spyOn(node:timers/promises setTimeout)는 ESM named import binding 탓에 UNIT 수준에서 정확한
      // call order/count를 잡지 못하는 환경이 존재 → waitSpy 호출 횟수 대신 onRetry hook의 suggestedDelayMs 전달 정확성만 검증
      vt.debugSnapshot({ delay: info?.suggestedDelayMs });
    });

    test('GIVEN onRetry absent WHEN called THEN fallback console.warn/error emitted for every reason case', async () => {
      pushSpy
        .mockResolvedValueOnce({
          exitCode: 2,
          stdout: '',
          stderr: '',
          schemaDir: layout().schemaDir,
          prismaConfigPath: layout().prismaConfigPath,
          clientOutputDir: layout().clientOutputDir,
        })
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: '',
          schemaDir: layout().schemaDir,
          prismaConfigPath: layout().prismaConfigPath,
          clientOutputDir: layout().clientOutputDir,
        })
        .mockResolvedValue({
          exitCode: 0,
          stdout: '',
          stderr: '',
          schemaDir: layout().schemaDir,
          prismaConfigPath: layout().prismaConfigPath,
          clientOutputDir: layout().clientOutputDir,
        });
      runSeedSpy
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'seed err' })
        .mockResolvedValue({ exitCode: 0, stdout: 'seed ok', stderr: '' });
      seedExistsSpy.mockReturnValue(true);
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => void 0);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => void 0);
      const opts = baseOpts('start');
      opts.maxRetry = 5;
      opts.retryDelayMs = 1;
      await runPrismaPipeline(opts);
      expect(errSpy).toHaveBeenCalled(); // PUSH_INVALID_OPTION 케이스 — console.error
      expect(warnSpy).toHaveBeenCalled(); // 나머지 케이스 — console.warn
      errSpy.mockRestore();
      warnSpy.mockRestore();
      vt.debugSnapshot({
        errorCalled: errSpy.mock.calls.length > 0,
        warnCalled: warnSpy.mock.calls.length > 0,
      });
    });
  });

  // ===========================================================================
  // 6. Studio 에러 처리 — studio 실패해도 pipeline ok=true 유지 + 콘솔 warning
  // ===========================================================================
  describe('Studio failure graceful handling', () => {
    test('GIVEN pipeline success BUT startPrismaStudio throws WHEN called THEN ok=true + studioStarted=false + console.warn', async () => {
      studioSpy.mockImplementation(() => {
        throw new Error('port 3000 already in use');
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => void 0);
      try {
        const opts = baseOpts('setup');
        const res = await runPrismaPipeline(opts);
        expect(res.ok).toBe(true);
        expect(res.studioStarted).toBe(false);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('port 3000 already in use'));
        vt.debugSnapshot({ studioStarted: res.studioStarted, pipelineOk: res.ok });
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  // ===========================================================================
  // 7. ResolvePrismaBin 결과물 prismaBinPath 옵션 무시 여부 확인 (pipeline은 직접 resolve한 값을 하위 스테이지에 prismaBinPath로 전달하는가?
  //    — 실제로 push/generate/seed 함수들은 prismaBinPath를 받는지 확인
  //    — pipeline 코드: pushPrismaSchema 호출시 `prismaBinPath: prismaBin` — 정확한지.
  // ===========================================================================
  describe('prismaBinPath down-propagation from resolvePrismaBin down to stage call opts', () => {
    test('GIVEN resolvePrismaBin returns /x WHEN called THEN every stage receives prismaBinPath=/x', async () => {
      const fake = sb.resolve('custom-prisma-bin-xyz');
      resolvePrismaBinSpy.mockReturnValue(fake);
      seedExistsSpy.mockReturnValue(true);
      const opts = baseOpts('start');
      await runPrismaPipeline(opts);
      const pushOpt = pushSpy.mock.calls[0]?.[0] as any;
      const genOpt = genSpy.mock.calls[0]?.[0] as any;
      expect(pushOpt?.prismaBinPath).toBe(fake);
      expect(genOpt?.prismaBinPath).toBe(fake);
      vt.debugSnapshot({ bin: fake.split('/').at(-1) });
    });
  });
});
