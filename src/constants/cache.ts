/**
 * @file Prisma Cache Manifest — 스키마 캐시 정책 상수
 */
const CACHE_MANIFEST_VERSION = 1 as const;
const CACHE_MANIFEST_FILENAME = '.prisma-schema-manifest.json' as const;

export { CACHE_MANIFEST_VERSION, CACHE_MANIFEST_FILENAME };
