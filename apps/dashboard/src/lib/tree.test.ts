import { describe, expect, test } from 'vitest';
import { buildTree, countNodes } from './tree';
import { makeSession } from './testFixtures';

describe('buildTree', () => {
  test('links children to their parent and keeps roots on top', () => {
    const root = makeSession({ id: 'a' });
    const child = makeSession({ id: 'b', parentId: 'a' });
    const grandchild = makeSession({ id: 'c', parentId: 'b' });

    const tree = buildTree([root, child, grandchild]);

    expect(tree).toHaveLength(1);
    expect(tree[0]?.session.id).toBe('a');
    expect(tree[0]?.children).toHaveLength(1);
    expect(tree[0]?.children[0]?.session.id).toBe('b');
    expect(tree[0]?.children[0]?.children[0]?.session.id).toBe('c');
    expect(countNodes(tree)).toBe(3);
  });

  test('an orphan child becomes a root instead of disappearing', () => {
    const orphan = makeSession({ id: 'orphan', parentId: 'missing-parent' });
    const tree = buildTree([orphan]);
    expect(tree.map((node) => node.session.id)).toEqual(['orphan']);
  });

  test('a parent/child cycle renders every session exactly once', () => {
    const a = makeSession({ id: 'a', parentId: 'b' });
    const b = makeSession({ id: 'b', parentId: 'a' });
    const tree = buildTree([a, b]);
    expect(countNodes(tree)).toBe(2);
  });

  test('an empty list produces an empty tree', () => {
    expect(buildTree([])).toEqual([]);
  });
});
