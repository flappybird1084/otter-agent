"use client";

import { useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Edge,
  Handle,
  MarkerType,
  Node,
  NodeProps,
  Position,
} from "reactflow";
import type { AgentEvent, Friendship, Scope, User } from "@/lib/types";

const SCOPE_RANK: Record<Scope, number> = {
  acquaintance: 1,
  friend: 2,
  close_friend: 3,
  family: 4,
};

const SCOPE_STYLE: Record<
  Scope | "none",
  { stroke: string; width: number; dash?: string; label: string }
> = {
  none: { stroke: "#27272a", width: 1, dash: "4 4", label: "—" },
  acquaintance: { stroke: "#52525b", width: 1.25, dash: "5 4", label: "Acq" },
  friend: { stroke: "#a1a1aa", width: 1.75, label: "Friend" },
  close_friend: { stroke: "#34d399", width: 2.5, label: "Close" },
  family: { stroke: "#fbbf24", width: 3, label: "Family" },
};

type EdgeFlash = {
  edgeId: string;
  color: "emerald" | "sky" | "red";
  until: number;
};

function nodePosition(index: number, total: number, w = 360, h = 320) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.34;
  if (total === 1) return { x: cx - 60, y: cy - 40 };
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
  return { x: cx + r * Math.cos(angle) - 60, y: cy + r * Math.sin(angle) - 40 };
}

const colorOf = (c: EdgeFlash["color"]) =>
  c === "emerald" ? "#34d399" : c === "sky" ? "#38bdf8" : "#ef4444";

function UserNode({ data }: NodeProps<{ user: User; isMe: boolean; busy: boolean }>) {
  const { user, isMe, busy } = data;
  return (
    <div
      className={
        "relative rounded-2xl border bg-zinc-950 px-4 py-3 w-32 text-center select-none " +
        (isMe ? "border-emerald-500" : "border-zinc-800") +
        (busy ? " ring-2 ring-emerald-400/50 animate-pulse" : "")
      }
    >
      <Handle type="source" position={Position.Top} className="opacity-0" />
      <Handle type="target" position={Position.Bottom} className="opacity-0" />
      <div className="text-3xl leading-none">{user.avatar_emoji}</div>
      <div className="mt-1 text-sm text-zinc-100 font-medium">
        {user.display_name?.split(" ")[0]}
      </div>
      <div className="text-[10px] text-zinc-500">{user.handle}</div>
    </div>
  );
}

const nodeTypes = { user: UserNode };

export function SocialGraph({
  users,
  friendships,
  events,
  meId,
  onNodeClick,
}: {
  users: User[];
  friendships: Friendship[];
  events: AgentEvent[];
  meId: string;
  onNodeClick?: (userId: string) => void;
}) {
  const [flashes, setFlashes] = useState<EdgeFlash[]>([]);
  const [busyNodes, setBusyNodes] = useState<Record<string, number>>({});

  // Index a "global" view: union of all friendships seen + the 3 demo users.
  const visibleUsers = useMemo(() => {
    const set = new Map<string, User>();
    users.forEach((u) => set.set(u.id, u));
    return Array.from(set.values());
  }, [users]);

  const edges: Edge[] = useMemo(() => {
    // Index directed friendships: "owner__friend" -> scope
    const byPair = new Map<string, Scope>();
    for (const f of friendships) {
      byPair.set(`${f.owner_id}__${f.friend_id}`, f.scope);
    }

    // Collect all undirected pairs we've seen + the canonical demo pairs
    const undirected = new Set<string>();
    const addPair = (a: string, b: string) => {
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      undirected.add(`${lo}__${hi}`);
    };
    for (const f of friendships) addPair(f.owner_id, f.friend_id);
    const demoPairs: [string, string][] = [
      ["user_maya", "user_priya"],
      ["user_maya", "user_devon"],
      ["user_priya", "user_devon"],
    ];
    for (const [a, b] of demoPairs) {
      if (visibleUsers.find((u) => u.id === a) && visibleUsers.find((u) => u.id === b)) {
        addPair(a, b);
      }
    }

    const out: Edge[] = [];
    for (const key of undirected) {
      const [a, b] = key.split("__");
      const ab = byPair.get(`${a}__${b}`);
      const ba = byPair.get(`${b}__${a}`);
      // Pick the perspective most relevant to the viewer when they're on
      // one end. Otherwise show the *lower* of the two scopes (weakest link
      // determines what data can flow).
      let scope: Scope | "none" = "none";
      if (meId === a && ab) scope = ab;
      else if (meId === b && ba) scope = ba;
      else if (ab && ba)
        scope = SCOPE_RANK[ab] <= SCOPE_RANK[ba] ? ab : ba;
      else scope = ab || ba || "none";

      const style = SCOPE_STYLE[scope];
      out.push({
        id: key,
        source: a,
        target: b,
        style: {
          stroke: style.stroke,
          strokeWidth: style.width,
          strokeDasharray: style.dash,
        },
        animated: false,
        label: scope !== "none" ? SCOPE_STYLE[scope].label : undefined,
        labelStyle: { fill: "#71717a", fontSize: 9 },
        labelBgStyle: { fill: "#0a0a0c" },
        labelBgPadding: [4, 2],
      });
    }
    return out;
  }, [friendships, visibleUsers, meId]);

  const nodes: Node[] = useMemo(() => {
    return visibleUsers.map((u, i) => ({
      id: u.id,
      type: "user",
      position: nodePosition(i, visibleUsers.length || 1),
      data: { user: u, isMe: u.id === meId, busy: !!busyNodes[u.id] },
      draggable: false,
    }));
  }, [visibleUsers, meId, busyNodes]);

  // React to new events
  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[0];
    const ts = new Date(latest.created_at).getTime();
    if (Date.now() - ts > 6000) return; // ignore stale ticks

    if (latest.type === "agent_thinking") {
      flashBusy(latest.actor_user_id);
    } else if (
      latest.type === "agent_message_sent" &&
      latest.actor_user_id &&
      latest.target_user_id
    ) {
      const color: EdgeFlash["color"] = latest.payload?.rejected
        ? "red"
        : "emerald";
      flashEdge(latest.actor_user_id, latest.target_user_id, color);
      flashBusy(latest.target_user_id);
    } else if (
      latest.type === "agent_message_received" &&
      latest.actor_user_id &&
      latest.target_user_id
    ) {
      flashEdge(latest.target_user_id, latest.actor_user_id, "sky");
    } else if (latest.type === "agent_replied") {
      // clear busy for actor
      setBusyNodes((b) => {
        const { [latest.actor_user_id]: _drop, ...rest } = b;
        return rest;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  function flashEdge(
    a: string,
    b: string,
    color: EdgeFlash["color"],
    durationMs = 1800,
  ) {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const edgeId = `${lo}__${hi}`;
    setFlashes((fs) => [
      ...fs.filter((f) => f.edgeId !== edgeId),
      { edgeId, color, until: Date.now() + durationMs },
    ]);
    setTimeout(
      () => setFlashes((fs) => fs.filter((f) => f.until > Date.now())),
      durationMs + 50,
    );
  }

  function flashBusy(userId: string, durationMs = 2200) {
    setBusyNodes((b) => ({ ...b, [userId]: (b[userId] || 0) + 1 }));
    setTimeout(() => {
      setBusyNodes((b) => {
        const next = { ...b };
        if (!next[userId]) return next;
        next[userId] = Math.max(0, next[userId] - 1);
        if (next[userId] === 0) delete next[userId];
        return next;
      });
    }, durationMs);
  }

  const styledEdges: Edge[] = useMemo(() => {
    return edges.map((e) => {
      const flash = flashes.find((f) => f.edgeId === e.id);
      if (!flash) return e;
      const color = colorOf(flash.color);
      return {
        ...e,
        animated: true,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color,
          width: 14,
          height: 14,
        },
        style: { stroke: color, strokeWidth: 2.5 },
        className: "edge-active",
      };
    });
  }, [edges, flashes]);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={styledEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable={false}
        nodesConnectable={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        panOnDrag={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => {
          if (onNodeClick && node.id !== meId) onNodeClick(node.id);
        }}
      >
        <Background gap={20} color="#1f1f23" />
      </ReactFlow>
    </div>
  );
}
