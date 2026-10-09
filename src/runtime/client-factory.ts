import { getOrCreateAdapter } from './adapter-cache';
import type { PrismaDatabaseType, PrismaOtsName } from '../types';
import type { AdapterFactory, CreatePrismaClientOptions, PrismaClassConstructor } from './types';

type ClientCacheKey = `${PrismaDatabaseType}::${PrismaOtsName}::${string}`;
const CLIENT_INSTANCE_CACHE = new Map<ClientCacheKey, unknown>();

function _getClientCacheKey<T extends PrismaDatabaseType>(
  dbType: T,
  name: PrismaOtsName<T>,
  PrismaClientClass: PrismaClassConstructor,
): ClientCacheKey {
  // NOTE: `as ClientCacheKey` cast는 TS2322 우회용.
  // `T extends PrismaDatabaseType` 제네릭 바운드 때문에 `${T}::${PrismaOtsName<T>}::${string}` 이
  // `ClientCacheKey` 구체 리터럴 유니온에 직접 할당 불가한 문제 — Codegen 타입 연산 혼용 허용 카테고리 (GLOSSARY)
  return `${dbType}::${name}::${PrismaClientClass.name || 'AnonymousPrismaClient'}` as ClientCacheKey;
}

export function createPrismaClient<
  TDb extends PrismaDatabaseType,
  TPrisma extends PrismaClassConstructor,
  TAdapter = unknown,
>(
  PrismaClientClass: TPrisma,
  dbType: TDb,
  name: PrismaOtsName<TDb>,
  adapterFactory: AdapterFactory<TAdapter>,
  opts: CreatePrismaClientOptions = {},
): InstanceType<TPrisma> {
  const cacheKey = _getClientCacheKey(dbType, name, PrismaClientClass);
  const cached = CLIENT_INSTANCE_CACHE.get(cacheKey) as InstanceType<TPrisma> | undefined;
  if (cached) {
    return cached;
  }

  const adapter = getOrCreateAdapter(dbType, name, adapterFactory, opts);
  const prisma = new PrismaClientClass({ adapter }) as InstanceType<TPrisma>;

  CLIENT_INSTANCE_CACHE.set(cacheKey, prisma);
  return prisma;
}
