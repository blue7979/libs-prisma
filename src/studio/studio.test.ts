import { workspaceRoot as ACTUAL_WORKSPACE_ROOT } from '@nx/devkit';

import * as cliUtilsMod from '../cli/utils';
import type { PrismaOtsName } from '../types';
import { startPrismaStudio } from './studio';

// 🚨 ESM `import { spawn } from 'node:child_process'` 바인딩은 런타임에 재할당 불가.
// UNIT이므로 vi.mock() 으로 모듈 전체를 fake factory로 교체한다.
const mockSpawn = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

describe.unit('studio/studio.ts — startPrismaStudio (UNIT, spawn 전혀 안함)', () => {
  const FAKE_PRISMA_BIN = '/fake/workspace/node_modules/.bin/prisma';
  const FAKE_CONFIG = '/fake/project/prisma.config.ts';
  // vt.useSandbox() 가 내부적으로 mkdirSync(sandboxRoot)를 호출하므로,
  // 가짜 CWD는 반드시 실제 존재하는 경로여야 한다.
  // 존재하지 않는 /fake/workspace 를 쓰면 EACCES 터짐.
  const FAKE_CWD = ACTUAL_WORKSPACE_ROOT;
  const FAKE_OTS = 'analytics' as any as PrismaOtsName<'postgres'>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nxDevkitMod: any = vi.mocked(require('@nx/devkit'));

  let resolveBinSpy: ReturnType<typeof vi.spyOn>;

  /**
   * 가짜 ChildProcess 생성 — EventEmitter 흉내 + unref() 스파이 포함.
   * 실제 node:child_process.ChildProcess는 heavy 하므로, structural typing으로
   * SpawnChildProcess 요구조건만 만족하는 최소 객체를 반환.
   */
  type ListenerCb = (...args: unknown[]) => unknown;
  function makeFakeChild(overrides?: Partial<{ pid: number }>) {
    const listeners = new Map<string, ListenerCb[]>();
    const fakeChild = {
      pid: overrides?.pid ?? 12345,
      stdin: null,
      stdout: null,
      stderr: null,
      killed: false,
      exitCode: null as number | null,
      signalCode: null,
      spawnfile: 'prisma',
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
      emit: vi.fn().mockImplementation((ev: string, ...args: unknown[]) => {
        (listeners.get(ev) ?? []).forEach((cb) => cb(...args));
        return true;
      }),
      eventNames: vi.fn().mockReturnValue([]),
      listenerCount: vi.fn().mockImplementation((ev: string) => (listeners.get(ev) ?? []).length),
    };
    return fakeChild;
  }

  beforeEach(() => {
    vt.useSandbox().reset();
    mockSpawn.mockReset();
    const defaultChild = makeFakeChild();
    mockSpawn.mockReturnValue(defaultChild);
    resolveBinSpy = vi.spyOn(cliUtilsMod, 'resolvePrismaBin').mockReturnValue(FAKE_PRISMA_BIN);
    // @nx/devkit workspaceRoot getter: import 단계에서 이미 박힌 값 재할당.
    Object.defineProperty(nxDevkitMod, 'workspaceRoot', {
      value: FAKE_CWD,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // 1. spawn 호출 인자 정확성 — prisma studio CLI args / detached 옵션
  // ---------------------------------------------------------------------------
  describe('spawn invocation correctness', () => {
    test('GIVEN minimal opts WHEN called THEN prisma CLI args는 [studio, --config, path, --port, 3000, --browser, none]', () => {
      startPrismaStudio({ prismaConfigPath: FAKE_CONFIG });
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      const [bin, args, opts] = mockSpawn.mock.calls[0]!;
      expect(bin).toBe(FAKE_PRISMA_BIN);
      expect(args).toStrictEqual([
        'studio',
        '--config',
        FAKE_CONFIG,
        '--port',
        '3000',
        '--browser',
        'none',
      ]);
      vt.debugSnapshot({ args });
      expect((opts as any)?.detached).toBe(true);
      expect((opts as any)?.shell).toBe(false);
    });

    test('GIVEN studioPort override WHEN called THEN --port 다음 index에 override 값 반영', () => {
      startPrismaStudio({ prismaConfigPath: FAKE_CONFIG, studioPort: 5555 });
      const args = mockSpawn.mock.calls[0]![1] as string[];
      expect(args.indexOf('--port')).toBeGreaterThan(-1);
      expect(args[args.indexOf('--port') + 1]).toBe('5555');
      vt.debugSnapshot({ portArg: args[args.indexOf('--port') + 1] });
    });

    test('GIVEN prismaBinPath WHEN called THEN resolvePrismaBin 호출되지 않고 해당 값 사용', () => {
      startPrismaStudio({ prismaConfigPath: FAKE_CONFIG, prismaBinPath: '/explicit/prisma-cli' });
      expect(resolveBinSpy).not.toHaveBeenCalled();
      expect(mockSpawn.mock.calls[0]![0]).toBe('/explicit/prisma-cli');
      vt.debugSnapshot({ usedBin: mockSpawn.mock.calls[0]![0] });
    });

    test('GIVEN prismaBinPath 미제공 WHEN called THEN resolvePrismaBin(cwd) 가 실행됨', () => {
      startPrismaStudio({ prismaConfigPath: FAKE_CONFIG });
      expect(resolveBinSpy).toHaveBeenCalledExactlyOnceWith(FAKE_CWD);
    });

    test('GIVEN cwd override WHEN called THEN spawn opts.cwd 와 resolveBin 인자 둘 다 override 값', () => {
      const customCwd = '/custom/project/root';
      startPrismaStudio({ prismaConfigPath: FAKE_CONFIG, cwd: customCwd });
      expect(resolveBinSpy).toHaveBeenCalledExactlyOnceWith(customCwd);
      expect((mockSpawn.mock.calls[0]![2] as any).cwd).toBe(customCwd);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. stdio 모드 선택 — pipe / inherit 분기
  // ---------------------------------------------------------------------------
  describe('stdio mode handling', () => {
    test('GIVEN stdio=inherit (기본값) WHEN called THEN spawn stdio는 inherit 문자열', () => {
      startPrismaStudio({ prismaConfigPath: FAKE_CONFIG });
      expect((mockSpawn.mock.calls[0]![2] as any).stdio).toBe('inherit');
    });

    test('GIVEN stdio=pipe WHEN called THEN spawn stdio는 [ignore, pipe, pipe] 튜플', () => {
      startPrismaStudio({ prismaConfigPath: FAKE_CONFIG, stdio: 'pipe' });
      expect((mockSpawn.mock.calls[0]![2] as any).stdio).toStrictEqual(['ignore', 'pipe', 'pipe']);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. detached + unref 계약 — 부모 Node exit 후에도 Studio 계속 살아있어야 함
  // ---------------------------------------------------------------------------
  describe('detached + unref contract', () => {
    test('GIVEN spawn 호출 직후 WHEN 반환 THEN detached:true 와 unref()가 정확히 1회 호출됨', () => {
      const child = makeFakeChild();
      mockSpawn.mockReturnValue(child as any);
      const result = startPrismaStudio({ prismaConfigPath: FAKE_CONFIG });
      expect((mockSpawn.mock.calls[0]![2] as any).detached).toBe(true);
      expect(child.unref).toHaveBeenCalledTimes(1);

      const sameRef = (result as unknown) === child;
      expect(sameRef).toBe(true);
      vt.debugSnapshot({
        unrefCalls: child.unref.mock.calls.length,
        returnedSameRef: sameRef,
      });
    });

    test('GIVEN 옵션에 otsName 포함 WHEN called THEN 로깅/식별용으로만 쓰이고 spawn 인자에 영향 없음', () => {
      const child = makeFakeChild();
      mockSpawn.mockReturnValue(child as any);
      const r = startPrismaStudio({
        prismaConfigPath: FAKE_CONFIG,
        otsName: FAKE_OTS,
        studioPort: 4000,
      });
      const args = mockSpawn.mock.calls[0]![1] as string[];
      expect(args.join(' ')).not.toContain(String(FAKE_OTS));
      expect(r).toBe(child);
    });
  });
});
