import { useMemo } from "react";
import type { SymbolView } from "../../src/studio/protocol";
import type { Report } from "../../src/reporting/report";
export function DependencyMap({
  symbols,
  edges,
  selected,
  onSelect,
  onOpen,
}: {
  symbols: SymbolView[];
  edges: Report["dependencies"];
  selected: string;
  onSelect: (id: string) => void;
  onOpen: (symbol: SymbolView) => void;
}) {
  const graph = useMemo(() => {
    const incoming = new Map<string, Set<string>>(),
      outgoing = new Map<string, Set<string>>();
    for (const edge of edges) {
      const a = incoming.get(edge.to) ?? new Set<string>();
      a.add(edge.from);
      incoming.set(edge.to, a);
      const b = outgoing.get(edge.from) ?? new Set<string>();
      b.add(edge.to);
      outgoing.set(edge.from, b);
    }
    return {
      incoming,
      outgoing,
      nodes: new Map(symbols.map((s) => [s.id, s])),
    };
  }, [edges, symbols]);
  const root =
    graph.nodes.get(selected) ??
    symbols.find((s) => s.kind === "flow") ??
    symbols[0];
  if (!root) return null;
  const incoming = [...(graph.incoming.get(root.id) ?? [])].filter(
    (id) => id !== root.id && graph.nodes.has(id),
  );
  const outgoing = [...(graph.outgoing.get(root.id) ?? [])].filter(
    (id) => id !== root.id && graph.nodes.has(id),
  );
  const left = incoming.slice(0, 6).map((id) => graph.nodes.get(id)!);
  const right = outgoing.slice(0, 6).map((id) => graph.nodes.get(id)!);
  const height = Math.max(left.length, right.length, 1) * 64 + 24;
  const y = (index: number, count: number) =>
    (height - count * 64) / 2 + index * 64 + 32;
  const card = (symbol: SymbolView, center = false) => (
    <button
      key={symbol.id}
      className={`dependency-node ${center ? "center-node" : ""}`}
      title={symbol.signature}
      aria-label={`Explore ${symbol.name}`}
      onClick={() => onSelect(symbol.id)}
    >
      <strong>{symbol.name}</strong>
      <span>{symbol.kind}</span>
    </button>
  );
  return (
    <section className="dependency-map" aria-label="Component dependencies">
      <div className="map-heading">
        <div>
          <h3>How {root.name} fits into the design</h3>
          <p>Choose a component to follow its direct relationships.</p>
        </div>
        <button className="text-link" onClick={() => onOpen(root)}>
          Open {root.name} source ↗
        </button>
      </div>
      <div className="map-column-labels">
        <span>Depends on {root.name}</span>
        <span>Selected component</span>
        <span>{root.name} depends on</span>
      </div>
      <div className="map-canvas" style={{ height }}>
        <svg
          viewBox={`0 0 1000 ${height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="dependency-arrow"
              markerWidth="6"
              markerHeight="6"
              refX="5"
              refY="3"
              orient="auto"
            >
              <path d="M 0 0 L 6 3 L 0 6 z" />
            </marker>
          </defs>
          {left.map((s, i) => (
            <path
              key={s.id}
              d={`M 280 ${y(i, left.length)} C 325 ${y(i, left.length)},325 ${height / 2},380 ${height / 2}`}
              markerEnd="url(#dependency-arrow)"
            />
          ))}
          {right.map((s, i) => (
            <path
              key={s.id}
              d={`M 620 ${height / 2} C 675 ${height / 2},675 ${y(i, right.length)},720 ${y(i, right.length)}`}
              markerEnd="url(#dependency-arrow)"
            />
          ))}
        </svg>
        <div className="map-column">
          {left.map((s) => card(s))}
          {!left.length && <p className="no-relations">No direct consumers</p>}
        </div>
        <div className="map-column center-column">{card(root, true)}</div>
        <div className="map-column">
          {right.map((s) => card(s))}
          {!right.length && (
            <p className="no-relations">No direct dependencies</p>
          )}
        </div>
      </div>
      <p className="map-note">
        Arrows follow calls and declared dependencies. They do not prove that
        every consumer will break after a change.
        {incoming.length > 6 || outgoing.length > 6
          ? ` Showing up to six relationships on each side (${incoming.length} incoming, ${outgoing.length} outgoing); select another component below to explore further.`
          : ""}
      </p>
    </section>
  );
}
