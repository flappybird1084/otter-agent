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
import type { AgentEvent, Friendship, User } from "@/lib/types";

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
}: {
  users: User[];
  friendships: Friendship[];
  events: AgentEvent[];
  meId: string;
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
    const seen = new Set<string>();
    const out: Edge[] = [];
    for (const f of friendships) {
      const a = f.owner_id < f.friend_id ? f.owner_id : f.friend_id;
      const b = f.owner_id < f.friend_id ? f.friend_id : f.owner_id;
      const key = `${a}__${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: key,
        source: a,
        target: b,
        style: { stroke: "#3f3f46", strokeWidth: 1.5 },
        animated: false,
      });
    }
    // Always render the 3 mutually-friended demo pairs
    const demoPairs = [
      ["user_maya", "user_priya"],
      ["user_maya", "user_devon"],
      ["user_priya", "user_devon"],
    ];
    for (const [a, b] of demoPairs) {
      const key = `${a}__${b}`;
      if (!seen.has(key) && visibleUsers.find((u) => u.id === a) && visibleUsers.find((u) => u.id === b)) {
        out.push({
          id: key,
          source: a,
          target: b,
          style: { stroke: "#27272a", strokeWidth: 1, strokeDasharray: "4 4" },
          animated: false,
        });
      }
    }
    return out;
  }, [friendships, visibleUsers]);

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
      >
        <Background gap={20} color="#1f1f23" />
      </ReactFlow>
    </div>
  );
}
