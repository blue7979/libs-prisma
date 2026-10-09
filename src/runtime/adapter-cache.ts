import { buildPrismaMongodbConnectionUrl, buildPrismaPostgresConnectionUrl } from '../connection';
import type { PrismaDatabaseType, PrismaOtsName } from '../types';
import type { AdapterFactory } from './types';

type AdapterCacheKey = `${PrismaDatabaseType}::${PrismaOtsName}`;
const ADAPTER_INSTANCE_CACHE = new Map<AdapterCacheKey, unknown>();

function _buildConnectionUrl<T extends PrismaDatabaseType>(
  dbType: T,
  name: PrismaOtsName<T>,
  forceContainerFormat = false,
): string {
  if (dbType === 'postgres') {
    return buildPrismaPostgresConnectionUrl(name as PrismaOtsName<'postgres'>, {
      forceContainerFormat,
    });
  }
  return buildPrismaMongodbConnectionUrl(name as PrismaOtsName<'mongodb'>, {
    forceContainerFormat,
  });
}

export function getOrCreateAdapter<TDb extends PrismaDatabaseType, TAdapter = unknown>(
  dbType: TDb,
  name: PrismaOtsName<TDb>,
  adapterFactory: AdapterFactory<TAdapter>,
  opts: { forceContainerFormat?: boolean } = {},
): TAdapter {
  // NOTE: cacheKey는 `TDb` 제네릭 바운드로 인한 TS2322 우회 cast — Codegen 타입 연산 혼용 (GLOSSARY 허용)
  const cacheKey = `${dbType}::${name}` as AdapterCacheKey;
  const cached = ADAPTER_INSTANCE_CACHE.get(cacheKey) as TAdapter | undefined;
  if (cached) {
    return cached;
  }

  const connectionString = _buildConnectionUrl(dbType, name, opts.forceContainerFormat ?? false);
  const adapter = adapterFactory(connectionString);
  ADAPTER_INSTANCE_CACHE.set(cacheKey, adapter);
  return adapter;
}
