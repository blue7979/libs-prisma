import * as nodePath from 'node:path';

import { PRISMA } from '../constants';
import type { PrismaEnv, PrismaOtsName } from '../types';
import { runPrismaSeed, seedExists, assertSeedResultOk } from './seed';

// 🚨 seed.ts 는 `import { spawn } from 'node:child_process'` named import 로 spawn을
// 직접 가져다 쓴다. ESM named import 바인딩은 런타임에 재할당 불가하므로
// vi.spyOn(require('node:child_process'), 'spawn') 패턴이 통하지 않음.
// 모듈 레벨 vi.mock() 으로 named import 자체를 갈아끼워야 UNIT에서 실제 spawn 호출을 막을 수 있음.
const mockSpawn = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// 마찬가지로 `import { existsSync } from 'node:fs'` named import 이므로 모듈 레벨 mock 필요.
const mockExistsSync = vi.fn();
vi.mock('node:fs', async () => {
  const actual = (await vi.importActual('node:fs')) as object;
  return { ...actual, existsSync: (...a: unknown[]) => mockExistsSync(...a) };
});

describe.unit(
  'seed/seed.ts — runPrismaSeed + seedExists + assertSeedResultOk (UNIT, no real spawn)',
  () => {
    const FAKE_PROJECT_ROOT = '/fake/domains/structure';
    const FAKE_OTS = 'main' as any as PrismaOtsName<'postgres'>;
    const FAKE_ENV: PrismaEnv = {
      OTS_NAME: FAKE_OTS,
      DATABASE_TYPE: 'postgres' as any,
      PROJECT_NAME: 'structure',
      PRISMA_CLIENT_OUTPUT: '/generated/prisma/structure/main',
      HOST_PRISMA_PORT: 5432 as any,
    } as any;

    let spawnSpyRef = mockSpawn;
    let existsSpyRef = mockExistsSync;

    /** @typescript-eslint/no-unsafe-function-type 회피를 위한 명시적 콜백 시그니처 */
    type ListenerCb = (...args: unknown[]) => unknown;

    /**
     * 가짜 ChildProcess — on('close', cb) / on('error', cb) 가 등록된 콜백을
     * 저장해두었다가 트리거할 수 있는 EventEmitter-like 객체.
     * UNIT에서 실제 프로세스 기다리는 대신 ._fireClose(code) / ._fireError(err) 로 직접 이벤트 발생시킴.
     */
    function makeFakeSeedChild(stdioMode: 'pipe' | 'inherit' = 'pipe') {
      const listeners = new Map<string, ListenerCb[]>();
      const streamListeners = {
        stdout: new Map<string, ListenerCb[]>(),
        stderr: new Map<string, ListenerCb[]>(),
      };

      const fire = (ev: string, ...args: unknown[]) => {
        (listeners.get(ev) ?? []).forEach((cb) => cb(...args));
      };

      const makeStream = (which: 'stdout' | 'stderr') => ({
        on: (ev: string, cb: ListenerCb) => {
          const arr = streamListeners[which].get(ev) ?? [];
          arr.push(cb);
          streamListeners[which].set(ev, arr);
        },
        _fire: (ev: string, ...args: unknown[]) => {
          (streamListeners[which].get(ev) ?? []).forEach((cb) => cb(...args));
        },
      });

      const fakeChild = {
        pid: 99999,
        stdin: null,
        stdout: stdioMode === 'pipe' ? makeStream('stdout') : null,
        stderr: stdioMode === 'pipe' ? makeStream('stderr') : null,
        killed: false,
        exitCode: null as number | null,
        signalCode: null,
        spawnfile: 'npx',
        spawnargs: [] as string[],
        connected: true,
        kill: vi.fn().mockReturnValue(true),
        ref: vi.fn().mockReturnThis(),
        unref: vi.fn().mockReturnThis(),
        addListener: vi.fn().mockImplementation((ev: string, cb: ListenerCb) => {
          const arr = listeners.get(ev) ?? [];
          arr.push(cb);
          listeners.set(ev, arr);
          return fakeChild;
        }),
        on: vi.fn().mockImplementation((ev: string, cb: ListenerCb) => {
          const arr = listeners.get(ev) ?? [];
          arr.push(cb);
          listeners.set(ev, arr);
          return fakeChild;
        }),
        once: vi.fn().mockReturnThis(),
        prependListener: vi.fn().mockReturnThis(),
        prependOnceListener: vi.fn().mockReturnThis(),
        removeListener: vi.fn().mockReturnThis(),
        off: vi.fn().mockReturnThis(),
        removeAllListeners: vi.fn().mockReturnThis(),
        setMaxListeners: vi.fn().mockReturnThis(),
        getMaxListeners: vi.fn().mockReturnValue(10),
        listeners: vi.fn().mockImplementation((ev: string) => listeners.get(ev) ?? []),
        rawListeners: vi.fn().mockImplementation((ev: string) => listeners.get(ev) ?? []),
        emit: vi.fn().mockImplementation(fire),
        eventNames: vi.fn().mockReturnValue([]),
        listenerCount: vi.fn().mockImplementation((ev: string) => (listeners.get(ev) ?? []).length),
        // === Test helpers (UNIT-only API) ===
        /** 'close' 이벤트 트리거 — runPrismaSeed 내 Promise resolve 시킴 */
        _fireClose: (code: number) => fire('close', code),
        /** 'error' 이벤트 트리거 — spawn ENOENT 시뮬레이션 */
        _fireError: (err: Error) => fire('error', err),
        /** stdout data 이벤트 트리거 — stdio=pipe 일 때만 동작 */
        _fireStdout: (chunk: string | Buffer) => {
          (fakeChild.stdout as any)?._fire?.(
            'data',
            typeof chunk === 'string' ? Buffer.from(chunk) : chunk,
          );
        },
        /** stderr data 이벤트 트리거 — stdio=pipe 일 때만 동작 */
        _fireStderr: (chunk: string | Buffer) => {
          (fakeChild.stderr as any)?._fire?.(
            'data',
            typeof chunk === 'string' ? Buffer.from(chunk) : chunk,
          );
        },
      };
      return fakeChild;
    }

    beforeEach(() => {
      vt.useSandbox().reset();
      mockSpawn.mockReset();
      mockExistsSync.mockReset();
      existsSpyRef = mockExistsSync;
      spawnSpyRef = mockSpawn;
      // 기본 반환 — test마다 override 가능.
      mockSpawn.mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (_cmd: any, _a: any, opts: any) =>
          makeFakeSeedChild(opts?.stdio?.[1] === 'pipe' ? 'pipe' : 'inherit') as any,
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    // ---------------------------------------------------------------------------
    // 1. seedExists() — 레이아웃 검증 헬퍼
    // ---------------------------------------------------------------------------
    describe('seedExists() — OTS별 seed entry 파일 존재여부', () => {
      test('GIVEN src/seeds/<ots>/index.ts 존재 WHEN called THEN existsSync에 정확한 경로 전달 + true 반환', () => {
        existsSpyRef.mockReturnValue(true);
        const ok = seedExists(FAKE_OTS, FAKE_PROJECT_ROOT);
        expect(existsSpyRef).toHaveBeenCalledExactlyOnceWith(
          nodePath.join(FAKE_PROJECT_ROOT, 'src/seeds', String(FAKE_OTS), 'index.ts'),
        );
        expect(ok).toBe(true);
      });

      test('GIVEN 파일 없을 때 WHEN called THEN false 반환', () => {
        existsSpyRef.mockReturnValue(false);
        expect(seedExists('analytics' as any, FAKE_PROJECT_ROOT)).toBe(false);
      });
    });

    // ---------------------------------------------------------------------------
    // 2. runPrismaSeed() — 기본 인자 정확성 / env 병합
    // ---------------------------------------------------------------------------
    describe('runPrismaSeed() spawn invocation & args', () => {
      test('GIVEN 기본 옵션 WHEN called THEN npx vite-node <resolved entry> 실행 (shell=false)', async () => {
        const child = makeFakeSeedChild('pipe');
        spawnSpyRef.mockReturnValue(child as any);
        const promise = runPrismaSeed({ projectRoot: FAKE_PROJECT_ROOT, env: FAKE_ENV });
        child._fireClose(0);
        await promise;
        expect(spawnSpyRef).toHaveBeenCalledTimes(1);
        const [cmd, args, opts] = spawnSpyRef.mock.calls[0]!;
        expect(cmd).toBe('npx');
        expect(args).toStrictEqual([
          'vite-node',
          nodePath.resolve(FAKE_PROJECT_ROOT, PRISMA.SEED_ENTRY_PATH),
        ]);
        expect((opts as any)?.cwd).toBe(FAKE_PROJECT_ROOT);
        expect((opts as any)?.shell).toBe(false);
      });

      test('GIVEN env.OTS_NAME WHEN merged THEN TARGET env에도 동일 값 복제 (seeds/<ots>/ routing)', async () => {
        const child = makeFakeSeedChild('pipe');
        spawnSpyRef.mockReturnValue(child as any);
        const promise = runPrismaSeed({ projectRoot: FAKE_PROJECT_ROOT, env: FAKE_ENV });
        child._fireClose(0);
        await promise;
        const mergedEnv: NodeJS.ProcessEnv = (spawnSpyRef.mock.calls[0]![2] as any).env;
        expect(mergedEnv.OTS_NAME).toBe(String(FAKE_OTS));
        expect(mergedEnv.TARGET).toBe(String(FAKE_OTS));
        expect(mergedEnv.DATABASE_TYPE).toBe(FAKE_ENV.DATABASE_TYPE);
        expect(mergedEnv.PROJECT_NAME).toBe(FAKE_ENV.PROJECT_NAME);
        expect(mergedEnv.PRISMA_CLIENT_OUTPUT).toBe(FAKE_ENV.PRISMA_CLIENT_OUTPUT);
      });

      test('GIVEN nodePath 미제공 WHEN called THEN NODE_ENV 기본값 <projectRoot>/node_modules', async () => {
        const child = makeFakeSeedChild('pipe');
        spawnSpyRef.mockReturnValue(child as any);
        const p = runPrismaSeed({ projectRoot: '/custom/project', env: FAKE_ENV });
        child._fireClose(0);
        await p;
        const mergedEnv = (spawnSpyRef.mock.calls[0]![2] as any).env;
        expect(mergedEnv.NODE_PATH).toBe(nodePath.join('/custom/project', 'node_modules'));
      });

      test('GIVEN nodePath 명시 WHEN called THEN NODE_PATH에 명시 값 그대로', async () => {
        const child = makeFakeSeedChild('pipe');
        spawnSpyRef.mockReturnValue(child as any);
        const p = runPrismaSeed({
          projectRoot: FAKE_PROJECT_ROOT,
          env: FAKE_ENV,
          nodePath: '/explicit/node/path',
        });
        child._fireClose(0);
        await p;
        expect((spawnSpyRef.mock.calls[0]![2] as any).env.NODE_PATH).toBe('/explicit/node/path');
      });

      test('GIVEN env PROJECT_NAME / PRISMA_CLIENT_OUTPUT 누락 WHEN merged THEN options env에서 해당 키로 재정의하지 않는다 (process.env 값은 그대로 상속)', async () => {
        const child = makeFakeSeedChild('pipe');
        spawnSpyRef.mockReturnValue(child as any);
        const minimalEnv: PrismaEnv = {
          OTS_NAME: FAKE_OTS,
          DATABASE_TYPE: 'postgres' as any,
          HOST_PRISMA_PORT: 5432 as any,
        } as any;
        const beforeProjectName = process.env.PROJECT_NAME;
        delete process.env.PROJECT_NAME;
        try {
          const p = runPrismaSeed({ projectRoot: FAKE_PROJECT_ROOT, env: minimalEnv });
          child._fireClose(0);
          await p;
          const mergedEnv = (spawnSpyRef.mock.calls[0]![2] as any).env;
          // options.env 에 프로퍼티가 없으면 options 레벨에선 재할당 코드 자체를 안타야 함.
          // → process.env.PROJECT_NAME 이 없었으므로 merged env 에도 없어야 함.
          expect(mergedEnv).not.toHaveProperty('PROJECT_NAME');
          expect(mergedEnv).not.toHaveProperty('PRISMA_CLIENT_OUTPUT');
          // 반드시 채워져야 하는 강제 키들
          expect(mergedEnv).toHaveProperty('TARGET');
          expect(mergedEnv).toHaveProperty('OTS_NAME');
          expect(mergedEnv).toHaveProperty('DATABASE_TYPE');
          expect(mergedEnv).toHaveProperty('NODE_PATH');
        } finally {
          if (beforeProjectName !== undefined) {
            process.env.PROJECT_NAME = beforeProjectName;
          }
        }
      });
    });

    // ---------------------------------------------------------------------------
    // 3. stdio 모드 분기
    // ---------------------------------------------------------------------------
    describe('stdio mode handling', () => {
      test('GIVEN stdio 미제공 → PRISMA.CLI_DEFAULT_STDIO (pipe) WHEN called THEN stdio = [ignore,pipe,pipe]', async () => {
        const child = makeFakeSeedChild('pipe');
        spawnSpyRef.mockReturnValue(child as any);
        const p = runPrismaSeed({ projectRoot: FAKE_PROJECT_ROOT, env: FAKE_ENV });
        child._fireClose(0);
        await p;
        expect((spawnSpyRef.mock.calls[0]![2] as any).stdio).toStrictEqual([
          'ignore',
          'pipe',
          'pipe',
        ]);
      });

      test('GIVEN stdio=inherit WHEN called THEN spawn stdio는 inherit 문자열 / stdout,stderr 핸들러 등록 안함', async () => {
        const child = makeFakeSeedChild('inherit');
        spawnSpyRef.mockReturnValue(child as any);
        const p = runPrismaSeed({
          projectRoot: FAKE_PROJECT_ROOT,
          env: FAKE_ENV,
          stdio: 'inherit',
        });
        child._fireClose(0);
        await p;
        expect((spawnSpyRef.mock.calls[0]![2] as any).stdio).toBe('inherit');
        // stdio=inherit 일 때는 함수 내부에서도 child.stdout/stderr이 null 로 오므로
        // 리스너 등록 시도 자체가 일어나지 않아야 함 → child.stdout/on이 호출된 횟수 = 0
        const streamSpy = (child.stdout as any)?.on;
        expect(streamSpy).toBeUndefined();
      });
    });

    // ---------------------------------------------------------------------------
    // 4. 결과값 검증 — exit code / stdout / stderr 버퍼 누적 / error 이벤트
    // ---------------------------------------------------------------------------
    describe('result emission (close / error events)', () => {
      test('GIVEN stdio=pipe WHEN 여러 청크 쌓이고 close THEN stdout/stderr 버퍼 concat + exitCode 정확', async () => {
        const child = makeFakeSeedChild('pipe');
        spawnSpyRef.mockReturnValue(child as any);
        const p = runPrismaSeed({ projectRoot: FAKE_PROJECT_ROOT, env: FAKE_ENV });
        child._fireStdout('seed record 1 inserted\n');
        child._fireStdout(Buffer.from('seed record 2 inserted\n'));
        child._fireStderr('warning: index skipped\n');
        child._fireClose(0);
        const res = await p;
        expect(res.exitCode).toBe(0);
        expect(res.stdout).toBe('seed record 1 inserted\nseed record 2 inserted\n');
        expect(res.stderr).toBe('warning: index skipped\n');
        vt.debugSnapshot({
          exitCode: res.exitCode,
          stdoutLen: res.stdout.length,
          stderrLen: res.stderr.length,
        });
      });

      test('GIVEN spawn 오류 (ENOENT 등) WHEN error 이벤트 THEN exitCode -1 + stack 담아 반환', async () => {
        const child = makeFakeSeedChild('pipe');
        spawnSpyRef.mockReturnValue(child as any);
        const p = runPrismaSeed({ projectRoot: FAKE_PROJECT_ROOT, env: FAKE_ENV });
        const err = new Error('spawn npx ENOENT');
        err.stack = 'Error: spawn npx ENOENT\n    at fake';
        child._fireStdout('stdout-before-crash\n');
        child._fireError(err);
        const res = await p;
        expect(res.exitCode).toBe(-1);
        expect(res.stdout).toBe('stdout-before-crash\n');
        expect(res.stderr).toContain('[spawn error] npx vite-node: spawn npx ENOENT');
        expect(res.stderr).toContain('Error: spawn npx ENOENT');
        vt.debugSnapshot({ exitCode: res.exitCode, errPrefix: res.stderr.slice(0, 50) });
      });

      test('GIVEN close code=null (signal kill) WHEN resolve THEN exitCode fallback 0', async () => {
        const child = makeFakeSeedChild('pipe');
        spawnSpyRef.mockReturnValue(child as any);
        const p = runPrismaSeed({ projectRoot: FAKE_PROJECT_ROOT, env: FAKE_ENV });
        // code에 null 넘기는 시나리오 (signal kill)
        child._fireClose(null as any);
        const res = await p;
        expect(res.exitCode).toBe(0);
      });
    });

    // ---------------------------------------------------------------------------
    // 5. assertSeedResultOk()
    // ---------------------------------------------------------------------------
    describe('assertSeedResultOk() — SeedResult 성공 assertion 래퍼', () => {
      test('GIVEN exitCode = 0 WHEN called THEN throw 안함', () => {
        const okResult = { exitCode: 0, stdout: 'done\n', stderr: '' };
        expect(() => assertSeedResultOk(okResult, 'setup')).not.toThrow();
      });

      test('GIVEN exitCode != 0 WHEN called THEN actionLabel 포함한 Error throw', () => {
        const badResult = { exitCode: 2, stdout: '', stderr: 'vite-node resolution error' };
        expect(() => assertSeedResultOk(badResult, 'start')).toThrowError(
          /^\[Prisma start\] Seed failed \(exit=2\)/,
        );
        expect(() => assertSeedResultOk(badResult, 'start')).toThrowError(
          'vite-node resolution error',
        );
      });

      test('GIVEN exitCode=1 stderr empty stdout 있을 때 WHEN called THEN stdout 으로 메시지 fallback', () => {
        const noStderr = { exitCode: 1, stdout: 'crash-info-in-stdout', stderr: '' };
        expect(() => assertSeedResultOk(noStderr, 'setup')).toThrowError('crash-info-in-stdout');
      });
    });
  },
);
