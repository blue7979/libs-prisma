import { symlinkSync } from 'node:fs';
import { relative, join } from 'node:path';

import { collectPrismaClientDirs } from './discovery';

describe.component('collectPrismaClientDirs', () => {
  let sb: ReturnType<typeof vt.useSandbox>;

  beforeEach(() => {
    sb = vt.useSandbox();
    sb.reset();
  });

  function toRel(absList: string[]): string[] {
    return absList.map((p) => relative(sb.root, p)).sort();
  }

  test('GIVEN empty root directory WHEN called THEN returns empty array', () => {
    const result = collectPrismaClientDirs({ rootDir: sb.root });

    expect(result).toEqual([]);
    vt.debugSnapshot(toRel(result));
  });

  test('GIVEN .prisma suffixed dirs in various depths WHEN called THEN discovers all and sorts ascending', () => {
    const p1 = sb.mkdir('a.prisma');
    const p2 = sb.mkdir('nested/b.prisma');
    const p3 = sb.mkdir('nested/deep/c.prisma');

    sb.mkdir('a.prisma/subdir-not-prisma');
    sb.mkdir('other-dir');

    const result = collectPrismaClientDirs({ rootDir: sb.root });

    expect(result).toEqual([p2, p3, p1].sort());
    expect(result).toHaveLength(3);
    vt.debugSnapshot(toRel(result));
  });

  test('GIVEN .prisma dirs inside node_modules or .git* WHEN called THEN skips them entirely', () => {
    const ok = sb.mkdir('ok.prisma');
    sb.mkdir('node_modules/x/hidden.prisma');
    sb.mkdir('.git/objects/hidden.prisma');
    sb.mkdir('.git-cherry/y/hidden.prisma');

    const result = collectPrismaClientDirs({ rootDir: sb.root });

    expect(result).toEqual([ok]);
    expect(result).toHaveLength(1);
    vt.debugSnapshot(toRel(result));
  });

  test('GIVEN searchDirs option WHEN called THEN restricts walk only to given subdirs', () => {
    const inApps = sb.mkdir('apps/inside.prisma');
    sb.mkdir('libs/skip.prisma');
    sb.mkdir('domains/skip.prisma');

    const result = collectPrismaClientDirs({
      rootDir: sb.root,
      searchDirs: ['apps'],
    });

    expect(result).toEqual([inApps]);
    vt.debugSnapshot(toRel(result));
  });

  test('GIVEN cyclic symlink in dir tree WHEN called THEN visited Set prevents infinite recursion (terminates without throw)', () => {
    const a = sb.mkdir('loop/a.prisma');
    const parent = sb.mkdir('loop/sub');
    const src = sb.resolve('loop');
    const dst = join(parent, 'cycle');
    symlinkSync(src, dst);

    let result: string[] = [];
    expect(() => {
      result = collectPrismaClientDirs({ rootDir: sb.root });
    }).not.toThrow();
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.includes(a)).toBe(true);
    vt.debugSnapshot({
      count: result.length,
      includesA: result.includes(a),
      rel: toRel(result).slice(0, 3),
    });
  });

  test('GIVEN .prisma dir contains another non-prisma dirs and files WHEN called THEN .prisma itself is leaf (not recursed into)', () => {
    const client = sb.mkdir('client.prisma');
    sb.mkdir('client.prisma/node_modules');
    sb.mkdir('client.prisma/schema.prisma');

    const result = collectPrismaClientDirs({ rootDir: sb.root });

    expect(result).toEqual([client]);
    expect(result).toHaveLength(1);
    vt.debugSnapshot(toRel(result));
  });
});
