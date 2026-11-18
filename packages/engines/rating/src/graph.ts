export interface TopologicalOrder<T> {
  order: T[];
  cyclic: T[];
}

export function topologicalOrder<T>(
  nodes: readonly T[],
  dependencies: (node: T) => Iterable<T>,
): TopologicalOrder<T> {
  const known = new Set(nodes);
  const pending = new Map<T, number>();
  const dependents = new Map<T, T[]>();

  for (const node of nodes) {
    let count = 0;

    for (const dependency of new Set(dependencies(node))) {
      if (!known.has(dependency)) continue;

      count++;
      const list = dependents.get(dependency);

      if (list) list.push(node);
      else dependents.set(dependency, [node]);
    }

    pending.set(node, count);
  }

  const queue = nodes.filter((node) => pending.get(node) === 0);
  const order: T[] = [];

  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]!;
    order.push(node);

    for (const dependent of dependents.get(node) ?? []) {
      const left = pending.get(dependent)! - 1;
      pending.set(dependent, left);

      if (left === 0) queue.push(dependent);
    }
  }

  const done = new Set(order);

  return { order, cyclic: nodes.filter((node) => !done.has(node)) };
}
