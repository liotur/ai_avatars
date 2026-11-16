type Box = { x: number; y: number; w: number; h: number };
type Point = [number, number];
type NodeId = 'library' | 'chat' | 'manager' | 'assistant' | 'mcp' | 'model';

type Edge = {
  id: string;
  from: Point;
  to: Point;
  label: string;
  labelAt: Point;
  /** The answer coming back, drawn dashed. */
  back?: boolean;
};

type Layout = {
  width: number;
  height: number;
  group: Box;
  nodes: Record<NodeId, Box>;
  edges: Edge[];
};

const NODES: Record<NodeId, { title: string; sub: string; kind: 'ui' | 'assistant' | 'data' | 'model' }> = {
  library: { title: 'Library page', sub: 'create · edit', kind: 'ui' },
  chat: { title: 'Chat page', sub: 'ask · get answers', kind: 'ui' },
  manager: { title: 'Avatar manager', sub: 'REST API · SQLite', kind: 'data' },
  assistant: { title: 'Assistant', sub: 'prompts · the loop', kind: 'assistant' },
  mcp: { title: 'Avatar MCP', sub: 'list · get · create', kind: 'data' },
  model: { title: 'Language model', sub: 'any provider', kind: 'model' },
};

/** Side by side, for a wide window. */
const WIDE: Layout = {
  width: 940,
  height: 456,
  group: { x: 10, y: 10, w: 230, h: 322 },
  nodes: {
    library: { x: 30, y: 60, w: 190, h: 72 },
    chat: { x: 30, y: 240, w: 190, h: 72 },
    manager: { x: 710, y: 60, w: 220, h: 72 },
    assistant: { x: 380, y: 240, w: 200, h: 72 },
    mcp: { x: 710, y: 240, w: 220, h: 72 },
    model: { x: 380, y: 374, w: 200, h: 72 },
  },
  edges: [
    { id: 'library-manager', from: [220, 96], to: [710, 96], label: 'REST', labelAt: [465, 96] },
    { id: 'chat-assistant', from: [220, 262], to: [380, 262], label: 'REST', labelAt: [300, 262] },
    { id: 'assistant-chat', from: [380, 292], to: [220, 292], label: 'answer, streamed', labelAt: [300, 292], back: true },
    { id: 'assistant-mcp', from: [580, 276], to: [710, 276], label: 'MCP', labelAt: [645, 276] },
    { id: 'mcp-manager', from: [820, 240], to: [820, 132], label: 'REST', labelAt: [820, 186] },
    { id: 'assistant-model', from: [480, 312], to: [480, 374], label: 'HTTPS', labelAt: [480, 343] },
  ],
};

/** Stacked, for a phone. */
const TALL: Layout = {
  width: 360,
  height: 606,
  group: { x: 8, y: 8, w: 344, h: 110 },
  nodes: {
    library: { x: 20, y: 42, w: 140, h: 64 },
    chat: { x: 200, y: 42, w: 140, h: 64 },
    manager: { x: 20, y: 206, w: 140, h: 64 },
    mcp: { x: 20, y: 370, w: 140, h: 64 },
    assistant: { x: 200, y: 370, w: 140, h: 64 },
    model: { x: 200, y: 530, w: 140, h: 64 },
  },
  edges: [
    { id: 'library-manager', from: [90, 106], to: [90, 206], label: 'REST', labelAt: [90, 156] },
    { id: 'chat-assistant', from: [238, 106], to: [238, 370], label: 'REST', labelAt: [238, 190] },
    { id: 'assistant-chat', from: [302, 370], to: [302, 106], label: 'stream', labelAt: [302, 290], back: true },
    { id: 'assistant-mcp', from: [200, 410], to: [160, 410], label: 'MCP', labelAt: [180, 386] },
    { id: 'mcp-manager', from: [90, 370], to: [90, 270], label: 'REST', labelAt: [90, 320] },
    { id: 'assistant-model', from: [270, 434], to: [270, 530], label: 'HTTPS', labelAt: [270, 482] },
  ],
};

const HEAD = 9;

/** A line that stops short of its end, and the arrowhead that fills the gap. */
function Arrow({ edge }: { edge: Edge }) {
  const [x1, y1] = edge.from;
  const [x2, y2] = edge.to;
  const length = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / length;
  const uy = (y2 - y1) / length;
  const baseX = x2 - ux * HEAD;
  const baseY = y2 - uy * HEAD;
  const half = HEAD * 0.55;
  const head = [
    `${x2},${y2}`,
    `${baseX - uy * half},${baseY + ux * half}`,
    `${baseX + uy * half},${baseY - ux * half}`,
  ].join(' ');
  const labelWidth = edge.label.length * 6.6 + 18;
  const [lx, ly] = edge.labelAt;

  return (
    <g className={edge.back ? 'dg-edge dg-edge-back' : 'dg-edge'}>
      <line x1={x1} y1={y1} x2={baseX} y2={baseY} />
      <polygon points={head} />
      <rect className="dg-label-box" x={lx - labelWidth / 2} y={ly - 11} width={labelWidth} height={22} rx={11} />
      <text className="dg-label" x={lx} y={ly + 4} textAnchor="middle">
        {edge.label}
      </text>
    </g>
  );
}

function Diagram({ layout, className }: { layout: Layout; className: string }) {
  const { group } = layout;
  return (
    <svg
      className={className}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      aria-hidden="true"
      focusable="false"
    >
      <rect className="dg-group" x={group.x} y={group.y} width={group.w} height={group.h} rx={18} />
      <text className="dg-group-label" x={group.x + 16} y={group.y + 24}>
        Web UI · in your browser
      </text>
      {layout.edges.map((edge) => (
        <Arrow key={edge.id} edge={edge} />
      ))}
      {(Object.keys(layout.nodes) as NodeId[]).map((id) => {
        const box = layout.nodes[id];
        const node = NODES[id];
        return (
          <g key={id} className={`dg-node dg-${node.kind}`}>
            <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={14} />
            <rect className="dg-bar" x={box.x} y={box.y + 14} width={4} height={box.h - 28} rx={2} />
            <text className="dg-title" x={box.x + 18} y={box.y + box.h / 2 - 4}>
              {node.title}
            </text>
            <text className="dg-sub" x={box.x + 18} y={box.y + box.h / 2 + 16}>
              {node.sub}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * The four parts and how they talk. Drawn twice, wide and tall, and the
 * stylesheet shows the one that fits. The same facts are given as text for
 * anyone who cannot see the drawing.
 */
export function ArchitectureDiagram() {
  return (
    <figure className="diagram">
      <Diagram layout={WIDE} className="diagram-wide" />
      <Diagram layout={TALL} className="diagram-tall" />
      <figcaption className="visually-hidden">
        The web UI runs in your browser and has two pages. The library page calls the avatar manager over REST. The
        chat page calls the assistant over REST and receives the answer as a stream. The assistant calls the avatar MCP
        server with MCP tools, and the avatar MCP server calls the avatar manager over REST. The assistant calls the
        language model over HTTPS. The avatar manager keeps avatars in SQLite.
      </figcaption>
    </figure>
  );
}
