import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

import { debugSnapshot, describe, expect, test, vi } from '@infra/testing';

import { sqlitePrismaClient } from './sqlite-client';

describe.unit(
  'runtime/sqlite-client.ts — sqlitePrismaClient (UNIT, adapter is built lazily)',
  () => {
    /**
     * 최소 PrismaClient fake — 생성자 인자를 기록하고 $connect/$disconnect spy 를 노출한다.
     * (3개 test 에서 재사용)
     */
    function makeFakePrismaClient() {
      const constructorArgs: unknown[][] = [];
      const connectSpy = vi.fn().mockResolvedValue(undefined);
      const disconnectSpy = vi.fn().mockResolvedValue(undefined);

      class FakePrismaClient {
        $connect = connectSpy;
        $disconnect = disconnectSpy;

        constructor(...args: unknown[]) {
          constructorArgs.push(args);
        }
      }

      return { FakePrismaClient, constructorArgs, connectSpy, disconnectSpy };
    }

    test('GIVEN a PrismaClient class + db path WHEN called THEN client is constructed with a single { adapter } arg holding a PrismaBetterSqlite3', () => {
      const { FakePrismaClient, constructorArgs } = makeFakePrismaClient();

      const client = sqlitePrismaClient(FakePrismaClient, '/tmp/platform-sqlite-client-1.db');

      expect(constructorArgs).toHaveLength(1);
      const firstArg = constructorArgs[0]?.[0] as { adapter?: unknown } | undefined;
      expect(firstArg?.adapter).toBeInstanceOf(PrismaBetterSqlite3);
      expect(client).toBeInstanceOf(FakePrismaClient);
      debugSnapshot({
        constructorCalls: constructorArgs.length,
        adapterIsSqlite: firstArg?.adapter instanceof PrismaBetterSqlite3,
      });
    });

    test('GIVEN a db path WHEN called THEN no eager connection is opened ($connect/$disconnect stay untouched)', () => {
      const { FakePrismaClient, connectSpy, disconnectSpy } = makeFakePrismaClient();

      sqlitePrismaClient(FakePrismaClient, '/tmp/platform-sqlite-client-2.db');

      expect(connectSpy).not.toHaveBeenCalled();
      expect(disconnectSpy).not.toHaveBeenCalled();
      debugSnapshot({
        connectCalls: connectSpy.mock.calls.length,
        disconnectCalls: disconnectSpy.mock.calls.length,
      });
    });

    test('GIVEN the same db path WHEN called twice THEN two DISTINCT client instances are returned (no module-level cache)', () => {
      const { FakePrismaClient, constructorArgs } = makeFakePrismaClient();

      const first = sqlitePrismaClient(FakePrismaClient, '/tmp/platform-sqlite-client-3.db');
      const second = sqlitePrismaClient(FakePrismaClient, '/tmp/platform-sqlite-client-3.db');

      expect(first).not.toBe(second);
      expect(constructorArgs).toHaveLength(2);
      debugSnapshot({ distinct: first !== second, constructorCalls: constructorArgs.length });
    });
  },
);
