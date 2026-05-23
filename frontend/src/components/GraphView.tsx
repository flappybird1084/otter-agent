"use client";
import { useEffect, useMemo, useRef, useState } from "react";

interface GNode { id: string; title: string; kind: string }
interface GEdge { a: string; b: string }
interface Sim {
  id: string;
  title: string;
  kind: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed: boolean;
}

const KIND_HUE: Record<string, number> = {
  daily: 90, project: 200, person: 320, note: 250, task: 70, system: 280,
};

// continuous force-sim params, tuned to feel like Obsidian's gentle hum
const REPULSE = 5200;
const SPRING_K = 0.028;
const SPRING_LEN = 130;
const CENTER_K = 0.014;
const DAMP = 0.82;
const JIGGLE = 0.07; // brownian noise per frame — keeps it "alive"

export default function GraphView({ onPick }: { onPick: (id: string) => void }) {
  const [data, setData] = useState<{ nodes: GNode[]; edges: GEdge[] } | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // mutable simulation state — node positions live here, not in React state
  const simRef = useRef<Sim[]>([]);
  // pan/zoom drag
  const panDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  // node drag — tracks whether the pointer moved enough to treat as a drag
  // rather than a click (so click-to-open doesn't fire on every drag end).
  const nodeDragRef = useRef<{ id: string; pointerId: number; startX: number; startY: number; moved: boolean } | null>(null);
  const CLICK_PX = 4;
  // bump tick to re-render at ~60fps
  const [, setTick] = useState(0);
  const rafRef = useRef<number | null>(null);

  // fetch graph data
  useEffect(() => {
    fetch("/api/notes/graph")
      .then((r) => (r.ok ? r.json() : { nodes: [], edges: [] }))
      .then((j: { nodes: GNode[]; edges: GEdge[] }) => setData(j));
  }, []);

  // size observer
  useEffect(() => {
    if (!stageRef.current) return;
    const ro = new ResizeObserver((es) => {
      for (const e of es) setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, []);

  // (re)seed simulation when data or container size shows up
  useEffect(() => {
    if (!data || size.w === 0 || size.h === 0) return;
    const cx = size.w / 2, cy = size.h / 2;
    // preserve positions for nodes we've already seen; new nodes get placed on a circle
    const prev = new Map(simRef.current.map((s) => [s.id, s]));
    simRef.current = data.nodes.map((n, i) => {
      const existing = prev.get(n.id);
      if (existing) return { ...existing, title: n.title, kind: n.kind };
      const a = (i * Math.PI * 2) / Math.max(data.nodes.length, 1);
      const r = 120 + (i % 3) * 40;
      return {
        id: n.id, title: n.title, kind: n.kind,
        x: cx + Math.cos(a) * r,
        y: cy + Math.sin(a) * r,
        vx: 0, vy: 0, fixed: false,
      };
    });
  }, [data, size.w, size.h]);

  // continuous force simulation — runs every animation frame
  useEffect(() => {
    if (!data) return;
    const cx = () => size.w / 2;
    const cy = () => size.h / 2;
    const step = () => {
      const sim = simRef.current;
      const edges = data.edges;
      // pairwise repulsion
      for (let i = 0; i < sim.length; i++) {
        for (let j = i + 1; j < sim.length; j++) {
          const A = sim[i], B = sim[j];
          const dx = B.x - A.x, dy = B.y - A.y;
          const d2 = dx * dx + dy * dy + 0.01;
          const d = Math.sqrt(d2);
          const f = REPULSE / d2;
          const fx = (dx / d) * f, fy = (dy / d) * f;
          if (!A.fixed) { A.vx -= fx; A.vy -= fy; }
          if (!B.fixed) { B.vx += fx; B.vy += fy; }
        }
      }
      // edge spring forces
      const byId = new Map(sim.map((s) => [s.id, s]));
      for (const e of edges) {
        const A = byId.get(e.a), B = byId.get(e.b);
        if (!A || !B) continue;
        const dx = B.x - A.x, dy = B.y - A.y;
        const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const f = (d - SPRING_LEN) * SPRING_K;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        if (!A.fixed) { A.vx += fx; A.vy += fy; }
        if (!B.fixed) { B.vx -= fx; B.vy -= fy; }
      }
      // centering + jiggle + integrate
      const ccx = cx(), ccy = cy();
      for (const n of sim) {
        if (n.fixed) { n.vx = 0; n.vy = 0; continue; }
        n.vx += (ccx - n.x) * CENTER_K;
        n.vy += (ccy - n.y) * CENTER_K;
        // tiny brownian wobble — keeps the graph subtly alive
        n.vx += (Math.random() - 0.5) * JIGGLE;
        n.vy += (Math.random() - 0.5) * JIGGLE;
        n.vx *= DAMP; n.vy *= DAMP;
        n.x += n.vx; n.y += n.vy;
      }
      setTick((t) => (t + 1) % 1_000_000);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [data, size.w, size.h]);

  const neighbors = useMemo(() => {
    if (!selectedId || !data) return null;
    const set = new Set<string>([selectedId]);
    for (const e of data.edges) {
      if (e.a === selectedId) set.add(e.b);
      if (e.b === selectedId) set.add(e.a);
    }
    return set;
  }, [data, selectedId]);

  const degrees = useMemo(() => {
    const m = new Map<string, number>();
    if (!data) return m;
    for (const e of data.edges) {
      m.set(e.a, (m.get(e.a) ?? 0) + 1);
      m.set(e.b, (m.get(e.b) ?? 0) + 1);
    }
    return m;
  }, [data]);

  // convert screen→world coords (accounting for zoom+pan)
  function screenToWorld(clientX: number, clientY: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const cx = size.w / 2, cy = size.h / 2;
    // inverse of: translate(pan) translate(cx,cy) scale(zoom) translate(-cx,-cy)
    const x = (sx - pan.x - cx) / zoom + cx;
    const y = (sy - pan.y - cy) / zoom + cy;
    return { x, y };
  }

  const onStagePointerDown = (e: React.PointerEvent) => {
    // only start pan if click landed on background, not a node
    const target = e.target as Element;
    if (target.closest("g.node")) return;
    panDragRef.current = { startX: e.clientX, startY: e.clientY, origX: pan.x, origY: pan.y };
  };
  const onStagePointerMove = (e: React.PointerEvent) => {
    if (nodeDragRef.current) {
      const drag = nodeDragRef.current;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (dx * dx + dy * dy > CLICK_PX * CLICK_PX) drag.moved = true;
      const sim = simRef.current.find((s) => s.id === drag.id);
      if (sim) {
        const { x, y } = screenToWorld(e.clientX, e.clientY);
        sim.x = x; sim.y = y; sim.vx = 0; sim.vy = 0;
      }
      return;
    }
    if (!panDragRef.current) return;
    setPan({
      x: panDragRef.current.origX + (e.clientX - panDragRef.current.startX),
      y: panDragRef.current.origY + (e.clientY - panDragRef.current.startY),
    });
  };
  const onStagePointerUp = (e: React.PointerEvent) => {
    if (nodeDragRef.current) {
      const sim = simRef.current.find((s) => s.id === nodeDragRef.current!.id);
      if (sim) sim.fixed = false;
      try { (e.target as Element).releasePointerCapture(nodeDragRef.current.pointerId); } catch { /* noop */ }
      nodeDragRef.current = null;
    }
    panDragRef.current = null;
  };

  const onNodePointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const sim = simRef.current.find((s) => s.id === id);
    if (!sim) return;
    sim.fixed = true;
    nodeDragRef.current = { id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false };
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* noop */ }
  };

  const onWheel = (e: React.WheelEvent) => {
    setZoom((z) => Math.max(0.4, Math.min(2.5, z * (e.deltaY > 0 ? 0.92 : 1.08))));
  };

  const selected = data?.nodes.find((n) => n.id === selectedId) ?? null;
  const cx = size.w / 2, cy = size.h / 2;
  const sim = simRef.current;
  const byId = new Map(sim.map((s) => [s.id, s]));

  return (
    <div className="main">
      <div className="main-head">
        <div className="crumb">
          <span>Brain</span>
          <span className="sep">/</span>
          <span className="leaf">Map</span>
        </div>
        <div className="main-head-actions">
          <span className="meta">{data?.nodes.length ?? 0} notes · {data?.edges.length ?? 0} links</span>
          <button className="tb-btn" onClick={() => setZoom((z) => Math.max(0.4, z * 0.85))}>−</button>
          <button className="tb-btn" onClick={() => setZoom((z) => Math.min(2.5, z * 1.15))}>+</button>
          <button className="tb-btn" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Reset</button>
        </div>
      </div>

      <div
        className="graph-stage"
        ref={stageRef}
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerUp}
        onPointerLeave={onStagePointerUp}
        onWheel={onWheel}
      >
        <div className="graph-bg"></div>
        <svg ref={svgRef} width={size.w} height={size.h}>
          <g transform={`translate(${pan.x},${pan.y}) translate(${cx},${cy}) scale(${zoom}) translate(${-cx},${-cy})`}>
            {data?.edges.map((e, i) => {
              const A = byId.get(e.a), B = byId.get(e.b);
              if (!A || !B) return null;
              const focused = selectedId && (e.a === selectedId || e.b === selectedId);
              const dim = selectedId && !focused;
              return (
                <line
                  key={i}
                  x1={A.x} y1={A.y} x2={B.x} y2={B.y}
                  stroke={focused ? "var(--accent)" : "var(--border)"}
                  strokeWidth={focused ? 1.6 : 1}
                  opacity={dim ? 0.15 : 0.9}
                />
              );
            })}
            {sim.map((n) => {
              const hue = KIND_HUE[n.kind] ?? 264;
              const d = degrees.get(n.id) ?? 0;
              const r = 10 + Math.min(8, d * 1.6);
              const isFocused = selectedId === n.id;
              const dim = selectedId && !neighbors?.has(n.id);
              return (
                <g
                  key={n.id}
                  className="node"
                  style={{ cursor: nodeDragRef.current?.id === n.id ? "grabbing" : "grab", transition: "opacity .25s" }}
                  opacity={dim ? 0.25 : 1}
                  onPointerDown={(e) => onNodePointerDown(e, n.id)}
                  onClick={(e) => {
                    e.stopPropagation();
                    // Suppress click if the user was dragging the node.
                    if (nodeDragRef.current?.id === n.id && nodeDragRef.current.moved) return;
                    setSelectedId(n.id);
                  }}
                >
                  <circle
                    cx={n.x} cy={n.y} r={r}
                    fill={`oklch(0.72 0.16 ${hue})`}
                    stroke={isFocused ? "var(--fg)" : `oklch(0.30 0.02 ${hue})`}
                    strokeWidth={isFocused ? 2 : 1.4}
                    style={{ filter: isFocused ? `drop-shadow(0 0 14px oklch(0.72 0.16 ${hue} / .6))` : "none" }}
                  />
                  <text
                    x={n.x} y={n.y + r + 14}
                    textAnchor="middle"
                    fill={isFocused ? "var(--fg)" : "var(--fg-mute)"}
                    style={{
                      fontFamily: "var(--font-sans)",
                      fontSize: isFocused ? 13 : 11.5,
                      fontWeight: isFocused ? 600 : 500,
                      pointerEvents: "none",
                    }}
                  >
                    {n.title}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        <div className="graph-legend">
          <div className="graph-legend-head">Map of your brain</div>
          <div className="graph-legend-sub">click node to select · drag node to move · drag bg to pan · scroll to zoom · use Open button to view note</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 8px" }}>
            {Object.entries(KIND_HUE).map(([k, hue]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: "var(--fg-mute)" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: `oklch(0.72 0.16 ${hue})`, boxShadow: `0 0 8px oklch(0.72 0.16 ${hue})` }}></span>
                {k}
              </div>
            ))}
          </div>
        </div>

        {selected && (
          <div className="graph-detail">
            <div className="graph-detail-head">
              <span style={{
                fontSize: 9.5, letterSpacing: ".06em", textTransform: "uppercase", fontWeight: 700,
                padding: "2px 7px", borderRadius: 999, border: "1px solid",
                color: `oklch(0.72 0.16 ${KIND_HUE[selected.kind] ?? 264})`,
                background: `oklch(0.72 0.16 ${KIND_HUE[selected.kind] ?? 264} / .18)`,
                borderColor: `oklch(0.72 0.16 ${KIND_HUE[selected.kind] ?? 264} / .38)`,
              }}>{selected.kind}</span>
              <button className="tb-btn" style={{ marginLeft: "auto" }} onClick={() => setSelectedId(null)}>×</button>
            </div>
            <div className="graph-detail-title">{selected.title}</div>
            <div className="graph-detail-meta">{degrees.get(selected.id) ?? 0} link{(degrees.get(selected.id) ?? 0) === 1 ? "" : "s"}</div>
            <div className="graph-detail-neighbors">
              <div className="gdn-head">Connected to</div>
              {[...(neighbors ?? new Set())].filter((id) => id !== selected.id).length === 0 ? (
                <div className="empty" style={{ padding: "12px 0", textAlign: "left" }}>— nothing yet —</div>
              ) : (
                [...(neighbors ?? new Set())]
                  .filter((id) => id !== selected.id)
                  .map((id) => {
                    const nn = data?.nodes.find((x) => x.id === id);
                    if (!nn) return null;
                    const hue = KIND_HUE[nn.kind] ?? 264;
                    return (
                      <div key={id} className="gdn-row" onClick={() => setSelectedId(id)}>
                        <span className="gdn-dot" style={{ background: `oklch(0.72 0.16 ${hue})` }}></span>
                        <span>{nn.title}</span>
                        <span className="gdn-kind">{nn.kind}</span>
                      </div>
                    );
                  })
              )}
            </div>
            <button
              type="button"
              className="tb-btn primary"
              style={{ margin: "10px 14px 14px", justifyContent: "center" }}
              onClick={() => onPick(selected.id)}
            >
              Open note →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
