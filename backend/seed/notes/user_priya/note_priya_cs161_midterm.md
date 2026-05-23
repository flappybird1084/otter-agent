# CS161 Midterm — clean notes

Covers chapters 1-5. Below: the version of my notes I'd actually share.

## Graphs

- Adjacency list when sparse (E ≈ V), matrix when dense (E ≈ V²)
- Edge list rarely useful except for Kruskal

## BFS / DFS

- BFS: queue, shortest path in unweighted graphs
- DFS: stack/recursion, used for topo sort, SCC, cycle detection
- Topo sort = reverse postorder of DFS on a DAG

## Shortest paths

- Dijkstra: non-negative weights, O((V+E) log V) with a heap
- Bellman-Ford: handles negative edges, detects negative cycles, O(VE)

## DP

- Identify the subproblem dimension carefully — wrong dimension = exponential blowup
- Memoize OR bottom-up table; bottom-up wins when you need all subproblems
- Classic examples: LIS, edit distance, knapsack

## Greedy

- Greedy is optimal when the **exchange argument** works: any optimal can be transformed step-by-step into the greedy without loss
- Interval scheduling (earliest finish time), Huffman coding
