import * as adapterCacheMod from './adapter-cache';
import type { PrismaDatabaseType, PrismaOtsName } from '../types';
import { createPrismaClient } from './client-factory';
import type { PrismaClassConstructor } from './types';

describe.unit('runtime/client-factory.ts — createPrismaClient (UNIT, no real DB)', () => {
  const PG_OTS = 'main' as any as PrismaOtsName<'postgres'>;

  let sb: ReturnType<typeof vt.useSandbox>;
  let getOrCreateAdapterSpy: ReturnType<typeof vi.spyOn>;

  /** 랜덤 접미어 추가 — 모듈 스코프 Map을 공유하므로 TC간 같은 캐시 키 충돌 방지 */
  function unique(prefix: string, base: PrismaOtsName<'postgres'>): PrismaOtsName<'postgres'> {
    return (String(base) + '-' + prefix + '-' + Math.random().toString(36).slice(2, 8)) as any;
  }

  /** 익명 클래스 — PrismaClientClass.name 빈 문자열 되는 케이스 재현 */
  function makeAnonymousPrismaClass(): PrismaClassConstructor {
    return class {
      $connect = vi.fn().mockResolvedValue(void 0);
      $disconnect = vi.fn().mockResolvedValue(void 0);
    };
  }

  function makeNamedPrismaClass(name: string): PrismaClassConstructor {
    const cls = makeAnonymousPrismaClass();
    Object.defineProperty(cls, 'name', { value: name, configurable: true });
    return cls;
  }

  beforeEach(() => {
    sb = vt.useSandbox();
    sb.reset();
    getOrCreateAdapterSpy = vi.spyOn(adapterCacheMod, 'getOrCreateAdapter').mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (_dbType, _name, factory: any) => factory('fake-connection-string'),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // 1. _getClientCacheKey 기본 동작 — 내부 동작은 adapterFactory / new PrismaClient 호출로 간접 검증
  // ---------------------------------------------------------------------------
  describe('cache key behavior (간접 검증)', () => {
    test('GIVEN 같은 파라미터로 두 번 호출 WHEN called THEN 두 번째는 CLIENT cache HIT (factory 1회만, 같은 참조)', () => {
      const cls = makeNamedPrismaClass('PrismaPgClientA');
      const adapterFactory = vi.fn((_url: string) => ({ kind: 'pg-adapter' }));
      const uniqueOts = unique('hit', PG_OTS);
      const r1 = createPrismaClient(
        cls as any,
        'postgres' as PrismaDatabaseType,
        uniqueOts as any,
        adapterFactory as any,
      );
      const r2 = createPrismaClient(
        cls as any,
        'postgres' as PrismaDatabaseType,
        uniqueOts as any,
        adapterFactory as any,
      );
      expect(r1).toBe(r2);
      expect(adapterFactory).toHaveBeenCalledTimes(1);
      vt.debugSnapshot({
        sameRef: r1 === r2,
        factoryCalls: adapterFactory.mock.calls.length,
      });
    });

    test('GIVEN 다른 PrismaClientClass WHEN called THEN 서로 다른 캐시 키로 각각 factory 2회 호출', () => {
      const cls1 = makeNamedPrismaClass('PrismaPgClientV1');
      const cls2 = makeNamedPrismaClass('PrismaPgClientV2');
      const adapterFactory = vi.fn((_url: string) => ({ kind: 'pg-adapter' }));
      const uniqueOts = unique('twocls', PG_OTS);
      const r1 = createPrismaClient(
        cls1 as any,
        'postgres' as PrismaDatabaseType,
        uniqueOts as any,
        adapterFactory as any,
      );
      const r2 = createPrismaClient(
        cls2 as any,
        'postgres' as PrismaDatabaseType,
        uniqueOts as any,
        adapterFactory as any,
      );
      expect(r1).not.toBe(r2);
      expect(adapterFactory).toHaveBeenCalledTimes(2);
      vt.debugSnapshot({
        diffRef: r1 !== r2,
        factoryCalls: adapterFactory.mock.calls.length,
      });
    });

    test('GIVEN 익명 PrismaClientClass (name === "") WHEN called THEN AnonymousPrismaClient fallback으로 cache key 빌드 → 같은 참조 캐시 히트', () => {
      const anonCls = makeAnonymousPrismaClass();
      expect(anonCls.name).toBeFalsy();
      const adapterFactory = vi.fn((_url: string) => ({ kind: 'anon-adapter' }));
      const uniqueOts = unique('anon', PG_OTS);
      const r1 = createPrismaClient(
        anonCls as any,
        'postgres' as PrismaDatabaseType,
        uniqueOts as any,
        adapterFactory as any,
      );
      const r2 = createPrismaClient(
        anonCls as any,
        'postgres' as PrismaDatabaseType,
        uniqueOts as any,
        adapterFactory as any,
      );
      expect(r1).toBe(r2);
      expect(adapterFactory).toHaveBeenCalledTimes(1);
      vt.debugSnapshot({
        anonymousName: anonCls.name,
        cacheHitSame: r1 === r2,
        factoryCalls: adapterFactory.mock.calls.length,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 2. adapterFactory 전달 정확성 — opts.forceContainerFormat 전파
  // ---------------------------------------------------------------------------
  describe('adapter creation & opts propagation', () => {
    test('GIVEN opts.forceContainerFormat WHEN called THEN getOrCreateAdapter에 opts 전체 전달', () => {
      const cls = makeNamedPrismaClass('FormatCheck');
      const adapterFactory = vi.fn((_url: string) => ({}));
      const uniqueOts = unique('opts', PG_OTS);
      createPrismaClient(
        cls as any,
        'postgres' as PrismaDatabaseType,
        uniqueOts as any,
        adapterFactory as any,
        { forceContainerFormat: true },
      );
      expect(getOrCreateAdapterSpy).toHaveBeenCalledTimes(1);
      const callOpts = getOrCreateAdapterSpy.mock.calls[0]?.[3];
      expect(callOpts).toStrictEqual({ forceContainerFormat: true });
      vt.debugSnapshot({ callOpts });
    });

    test('GIVEN opts 생략 WHEN called THEN getOrCreateAdapter opts는 기본 {}로 전달', () => {
      const cls = makeNamedPrismaClass('DefaultOpts');
      const adapterFactory = vi.fn((_url: string) => ({}));
      const uniqueOts = unique('default', PG_OTS);
      createPrismaClient(
        cls as any,
        'postgres' as PrismaDatabaseType,
        uniqueOts as any,
        adapterFactory as any,
      );
      expect(getOrCreateAdapterSpy).toHaveBeenCalledWith(
        'postgres' as PrismaDatabaseType,
        uniqueOts as any,
        adapterFactory as any,
        {},
      );
      vt.debugSnapshot({
        optsArg: getOrCreateAdapterSpy.mock.calls[0]?.[3],
      });
    });

    test('GIVEN adapterFactory로 생성된 adapter WHEN new PrismaClientClass THEN constructor args에 adapter로 정확히 넘어감', () => {
      const adapterInst = { __myAdapter: true, connect: vi.fn() };
      const adapterFactory = vi.fn((_url: string) => adapterInst);
      const constructorSpy = vi.fn();
      class SpyPrisma {
        $connect = vi.fn().mockResolvedValue(void 0);
        $disconnect = vi.fn().mockResolvedValue(void 0);
        constructor(...args: unknown[]) {
          constructorSpy(...args);
        }
      }
      const uniqueOts = unique('ctor', PG_OTS);
      createPrismaClient(
        SpyPrisma as any,
        'postgres' as PrismaDatabaseType,
        uniqueOts as any,
        adapterFactory as any,
      );
      expect(constructorSpy).toHaveBeenCalledTimes(1);
      expect(constructorSpy).toHaveBeenCalledWith({ adapter: adapterInst });
      vt.debugSnapshot({
        constructorCalledWith: constructorSpy.mock.calls[0]?.[0],
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 3. getOrCreateAdapter 반환값 재사용 (shared adapter across classes with same dbtype+ots)
  // ---------------------------------------------------------------------------
  describe('shared adapter across multiple PrismaClient classes', () => {
    test('GIVEN 같은 dbType+name 다른 PrismaClass들 WHEN called THEN getOrCreateAdapter 내부 캐시로 인해 adapterFactory는 최초 1회만 실제 호출됨 (spy 인보케이션 분석)', () => {
      const factoryCalls: { url: string }[] = [];
      const adapterFactory = vi.fn((url: string) => {
        factoryCalls.push({ url });
        return { shared: true, url };
      });
      getOrCreateAdapterSpy.mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbType: any, name: any, innerFactory: any) => {
          // cache key 계산을 getOrCreateAdapter 내부와 동일하게 수행 (spy의 real call 대신 흉내)
          const cacheKey = `${String(dbType)}::${String(name)}`;
          const cache = (globalThis as any).__fakeSharedAdapterCache ?? new Map<string, unknown>();
          (globalThis as any).__fakeSharedAdapterCache = cache;
          if (cache.has(cacheKey)) return cache.get(cacheKey);
          const adapter = innerFactory(`fake-url-for-${cacheKey}`);
          cache.set(cacheKey, adapter);
          return adapter;
        },
      );
      const clsA = makeNamedPrismaClass('SharedAdA');
      const clsB = makeNamedPrismaClass('SharedAdB');
      const uniqueOts = unique('shared', PG_OTS);
      createPrismaClient(
        clsA as any,
        'postgres' as PrismaDatabaseType,
        uniqueOts as any,
        adapterFactory as any,
      );
      createPrismaClient(
        clsB as any,
        'postgres' as PrismaDatabaseType,
        uniqueOts as any,
        adapterFactory as any,
      );
      expect(adapterFactory).toHaveBeenCalledTimes(1);
      vt.debugSnapshot({
        sharedFactoryCalls: adapterFactory.mock.calls.length,
      });
    });
  });
});
