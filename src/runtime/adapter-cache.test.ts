import * as connMod from '../connection';
import type { PrismaDatabaseType, PrismaOtsName } from '../types';
import { getOrCreateAdapter } from './adapter-cache';
import type { AdapterFactory } from './types';

describe.unit('runtime/adapter-cache.ts — getOrCreateAdapter (UNIT, cache isolation)', () => {
  const PG_OTS = 'main' as any as PrismaOtsName<'postgres'>;
  const MONGO_OTS = 'logs-mongo' as any as PrismaOtsName<'mongodb'>;

  let sb: ReturnType<typeof vt.useSandbox>;
  let pgUrlSpy: ReturnType<typeof vi.spyOn>;
  let mongoUrlSpy: ReturnType<typeof vi.spyOn>;

  function fakeFactory<T>(tag: string): AdapterFactory<T> {
    return vi.fn((url: string) => ({ __adapter: tag, __url: url }) as unknown as T);
  }

  beforeEach(() => {
    sb = vt.useSandbox();
    sb.reset();

    // ADAPTER_INSTANCE_CACHE는 모듈 스코프 Map이므로, 매 테스트 초기화를 위해
    // Map.prototype.clear를 spy로 감싸는 대신, get/set 호출 후 수동 clear 수행.
    // Map 자체는 비공개이므로 간접적으로: 매 beforeEach 마다 모든 (known) 키를 delete 하거나
    // 각기 다른 고유한 OTS 이름을 사용 → 같은 캐시 키 중복 방지로 테스트간 간섭 차단.
    pgUrlSpy = vi
      .spyOn(connMod, 'buildPrismaPostgresConnectionUrl')
      .mockReturnValue('prisma+postgres://pg-url');
    mongoUrlSpy = vi
      .spyOn(connMod, 'buildPrismaMongodbConnectionUrl')
      .mockReturnValue('mongodb://mongo-url');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // 1. 기본 동작 — 최초 호출시 factory 한 번 실행 + connection URL builder 선택
  // ---------------------------------------------------------------------------
  describe('factory invocation & URL builder dispatch', () => {
    test('GIVEN dbType=postgres WHEN called THEN uses buildPrismaPostgresConnectionUrl with OTS name', () => {
      const factory = fakeFactory<object>('pg-adapter');
      const keyMarker = PG_OTS + '-' + Math.random().toString(36).slice(2, 8);
      const uniquePgName = keyMarker as any as PrismaOtsName<'postgres'>;
      getOrCreateAdapter('postgres' as PrismaDatabaseType, uniquePgName as any, factory as any);
      expect(pgUrlSpy).toHaveBeenCalledTimes(1);
      expect(pgUrlSpy.mock.calls[0]?.[0]).toBe(uniquePgName);
      expect(mongoUrlSpy).not.toHaveBeenCalled();
      vt.debugSnapshot({ url: pgUrlSpy.mock.calls[0]?.[1] });
    });

    test('GIVEN dbType=mongodb WHEN called THEN uses buildPrismaMongodbConnectionUrl', () => {
      const factory = fakeFactory<object>('mongo-adapter');
      const mongoUnique = (MONGO_OTS +
        '-' +
        Math.random().toString(36).slice(2, 8)) as any as PrismaOtsName<'mongodb'>;
      getOrCreateAdapter('mongodb' as PrismaDatabaseType, mongoUnique as any, factory as any);
      expect(mongoUrlSpy).toHaveBeenCalledTimes(1);
      expect(mongoUrlSpy.mock.calls[0]?.[0]).toBe(mongoUnique);
      expect(pgUrlSpy).not.toHaveBeenCalled();
      vt.debugSnapshot({ mongoOpts: mongoUrlSpy.mock.calls[0]?.[1] });
    });

    test('GIVEN forceContainerFormat=true WHEN called THEN passes flag as second argument to URL builder', () => {
      const factory = fakeFactory<object>('pg-container');
      const uniqueName = ('cf-' + Math.random().toString(36).slice(2, 8)) as any;
      getOrCreateAdapter('postgres' as PrismaDatabaseType, uniqueName, factory as any, {
        forceContainerFormat: true,
      });
      expect(pgUrlSpy).toHaveBeenCalledWith(uniqueName, { forceContainerFormat: true });
      vt.debugSnapshot({ passedOpts: pgUrlSpy.mock.calls[0]?.[1] });
    });

    test('GIVEN opts undefined WHEN called THEN forceContainerFormat defaults to false', () => {
      const factory = fakeFactory<object>('pg-default');
      const uniqueName = ('noopts-' + Math.random().toString(36).slice(2, 8)) as any;
      getOrCreateAdapter('postgres' as PrismaDatabaseType, uniqueName, factory as any);
      expect(pgUrlSpy).toHaveBeenCalledWith(uniqueName, { forceContainerFormat: false });
      vt.debugSnapshot({ defaultOpts: pgUrlSpy.mock.calls[0]?.[1] });
    });

    test('GIVEN url builder가 만든 connection string WHEN factory 호출 THEN 정확히 factory에 전달', () => {
      pgUrlSpy.mockReturnValue('prisma+postgres://user:pass@host:5432/db');
      const factory = vi.fn((url: string) => ({ adapter: true, url }));
      const uniqueName = ('urlpass-' + Math.random().toString(36).slice(2, 8)) as any;
      const result = getOrCreateAdapter(
        'postgres' as PrismaDatabaseType,
        uniqueName,
        factory as any,
      );
      expect(factory).toHaveBeenCalledTimes(1);
      expect(factory).toHaveBeenCalledWith('prisma+postgres://user:pass@host:5432/db');
      expect(result).toStrictEqual({
        adapter: true,
        url: 'prisma+postgres://user:pass@host:5432/db',
      });
      vt.debugSnapshot({ factoryCalledWith: factory.mock.calls[0]?.[0] });
    });
  });

  // ---------------------------------------------------------------------------
  // 2. 캐시 동작 — 같은 키 두 번 호출시 factory 1회만 실행
  // ---------------------------------------------------------------------------
  describe('cache hit vs miss', () => {
    test('GIVEN 같은 dbType+name 두 번 호출 WHEN called THEN factory 1회만 실행 + 같은 참조 반환', () => {
      const factory = fakeFactory<object>('pg-cachetest');
      const uniqueName = ('cachehit-' + Math.random().toString(36).slice(2, 8)) as any;
      const r1 = getOrCreateAdapter('postgres' as PrismaDatabaseType, uniqueName, factory as any);
      const r2 = getOrCreateAdapter('postgres' as PrismaDatabaseType, uniqueName, factory as any);
      expect(factory as any).toHaveBeenCalledTimes(1);
      expect(r1).toBe(r2); // 참조 동일
      vt.debugSnapshot({
        calls: (factory as any).mock.calls.length,
        sameReference: r1 === r2,
      });
    });

    test('GIVEN 같은 name 이지만 dbType이 다를 때 WHEN called THEN 서로 다른 캐시 키로 각각 1회 호출', () => {
      const pgFactory = fakeFactory<object>('diff-db-pg');
      const mongoFactory = fakeFactory<object>('diff-db-mongo');
      const sharedUnique = ('shared-' + Math.random().toString(36).slice(2, 8)) as any;
      // postgres/mongo는 각각 다른 PrismaOtsName<T> 타입을 요구하지만, 여기서는 런타임 캐시 키만 다르면 되므로 any cast
      const r1 = getOrCreateAdapter(
        'postgres' as PrismaDatabaseType,
        sharedUnique,
        pgFactory as any,
      );
      const r2 = getOrCreateAdapter(
        'mongodb' as PrismaDatabaseType,
        sharedUnique,
        mongoFactory as any,
      );
      expect(pgFactory as any).toHaveBeenCalledTimes(1);
      expect(mongoFactory as any).toHaveBeenCalledTimes(1);
      expect(r1).not.toBe(r2);
      vt.debugSnapshot({
        pgCalls: (pgFactory as any).mock.calls.length,
        mongoCalls: (mongoFactory as any).mock.calls.length,
        diff: r1 !== r2,
      });
    });

    test('GIVEN 같은 dbType+name 이어도 두 번째 호출에서 다른 factory를 넘겨도 WHEN called THEN 최초 factory 결과 반환', () => {
      const f1 = fakeFactory<object>('first-factory');
      const f2 = fakeFactory<object>('second-factory-different');
      const uniqueName = ('overwrite-' + Math.random().toString(36).slice(2, 8)) as any;
      const r1 = getOrCreateAdapter('postgres' as PrismaDatabaseType, uniqueName, f1 as any);
      const r2 = getOrCreateAdapter('postgres' as PrismaDatabaseType, uniqueName, f2 as any);
      expect(f1 as any).toHaveBeenCalledTimes(1);
      expect(f2 as any).not.toHaveBeenCalled(); // ❗ 캐시 HIT → 두 번째 factory는 아예 실행 안됨
      expect(r1).toBe(r2);
      vt.debugSnapshot({
        f1Calls: (f1 as any).mock.calls.length,
        f2Calls: (f2 as any).mock.calls.length,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 3. 키 포맷 검증 — `dbType::otsName` 을 URL builder 첫 번째 arg가 정확히 그 OTS 이름임을 통해 간접 확인
  // ---------------------------------------------------------------------------
  describe('key format verification via spy args', () => {
    test('GIVEN postgres + known OTS WHEN called THEN postgres URL builder는 그 OTS name만 정확히 한 번 받는다', () => {
      const factory = fakeFactory<object>('keyfmt');
      const specificOts = 'my-specific-ots' as any;
      pgUrlSpy.mockClear();
      getOrCreateAdapter('postgres' as PrismaDatabaseType, specificOts, factory as any);
      expect(pgUrlSpy).toHaveBeenCalledExactlyOnceWith(specificOts, {
        forceContainerFormat: false,
      });
      vt.debugSnapshot({
        firstArg: pgUrlSpy.mock.calls[0]?.[0],
      });
    });
  });
});
