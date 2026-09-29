import type { SessionDTO } from '../../shared/types';

export interface TreeNode {
  session: SessionDTO;
  children: TreeNode[];
}

/**
 * Builds a session tree from a flat list (the API returns the selected session
 * plus its descendants). Orphans become roots and cycles are impossible to
 * render twice: the final walk marks visited ids.
 */
export function buildTree(sessions: SessionDTO[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  for (const session of sessions) {
    nodes.set(session.id, { session, children: [] });
  }

  const roots: TreeNode[] = [];
  for (const session of sessions) {
    const node = nodes.get(session.id);
    if (!node) continue;
    const parent = session.parentId ? nodes.get(session.parentId) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  const visited = new Set<string>();
  const prune = (list: TreeNode[]): TreeNode[] => {
    const result: TreeNode[] = [];
    for (const node of list) {
      if (visited.has(node.session.id)) continue;
      visited.add(node.session.id);
      node.children = prune(node.children);
      result.push(node);
    }
    return result;
  };

  const tree = prune(roots);
  // Defensive: nodes unreachable from any root (data anomaly) still show up once.
  for (const session of sessions) {
    if (visited.has(session.id)) continue;
    const node = nodes.get(session.id);
    if (node) tree.push(...prune([node]));
  }
  return tree;
}

export function countNodes(nodes: TreeNode[]): number {
  let total = 0;
  for (const node of nodes) total += 1 + countNodes(node.children);
  return total;
}
