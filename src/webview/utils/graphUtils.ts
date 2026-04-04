import * as dagre from 'dagre';
import { Node, Edge, MarkerType } from 'reactflow';

export interface GraphData {
  nodes: Node[];
  edges: Edge[];
}

/**
 * Resolve the JSON value at a graph node path (first segment = document index; then object keys or `[i]` for arrays).
 */
export function getValueAtPath(data: any, path: string[]): any {
  const docs = Array.isArray(data) ? data : [data];
  if (path.length === 0) {
    return undefined;
  }
  const docIndex = parseInt(path[0], 10);
  if (Number.isNaN(docIndex) || docIndex < 0 || docIndex >= docs.length) {
    return undefined;
  }
  let cur: any = docs[docIndex];
  for (let i = 1; i < path.length; i++) {
    const seg = path[i];
    if (cur == null) {
      return undefined;
    }
    const idxMatch = /^\[(\d+)\]$/.exec(seg);
    if (idxMatch && Array.isArray(cur)) {
      cur = cur[parseInt(idxMatch[1], 10)];
    } else {
      cur = cur[seg];
    }
  }
  return cur;
}

/** Truncate JSON snippets sent to Gemini from the webview. */
export function trimValidationSnippet(snippet: string, maxLen: number = 2000): string {
  if (snippet.length <= maxLen) {
    return snippet;
  }
  return snippet.slice(0, maxLen) + '…';
}

const nodeWidth = 220;
const nodeHeight = 100;

/**
 * Transforms YAML document(s) into logical Entities and Attributes.
 * Supports multiple documents and Kubernetes relationship detection.
 */
export function transformToLogicalGraph(data: any): GraphData {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const visited = new Set<string>();

  const docs = Array.isArray(data) ? data : [data];

  function traverse(obj: any, parentId: string | null = null, path: string[] = [], entityKey: string | null = null) {
    const currentId = path.join('.');
    if (visited.has(currentId)) return;
    visited.add(currentId);

    const attributes: Record<string, any> = {};
    const subEntities: Array<{ k: string, v: any, label?: string }> = [];

    if (obj !== null && typeof obj === 'object') {
      if (Array.isArray(obj)) {
        obj.forEach((item, index) => {
          if (item !== null && typeof item === 'object') {
            subEntities.push({ k: index.toString(), v: item, label: `[${index}]` });
          } else {
            attributes[index.toString()] = item;
          }
        });
      } else {
        Object.entries(obj).forEach(([k, v]) => {
          if (v !== null && typeof v === 'object') {
            subEntities.push({ k, v });
          } else {
            attributes[k] = v;
          }
        });
      }
    } else {
      attributes['value'] = obj;
    }

    // Determine a friendly label for the document root
    let label = entityKey;
    if (path.length === 1) { // It's a document root
      label = obj?.metadata?.name || (obj?.kind ? `[${obj.kind}]` : `Doc ${path[0]}`);
    } else if (path.length === 0) {
      label = 'Root';
    }

    nodes.push({
      id: currentId,
      data: {
        label: label || 'Entity',
        attributes,
        path,
        type: Array.isArray(obj) ? 'collection' : 'entity',
        attributeCount: Object.keys(attributes).length,
        kind: obj?.kind,
        metadata: obj?.metadata,
        spec: obj?.spec
      },
      position: { x: 0, y: 0 },
      type: 'entityNode',
    });

    if (parentId) {
      edges.push({
        id: `e-${parentId}-${currentId}`,
        source: parentId,
        target: currentId,
        animated: true,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: 'var(--border-color)',
        },
        style: { stroke: 'var(--border-color)', strokeWidth: 2 }
      });
    }

    subEntities.forEach(({ k, v, label }) => {
      traverse(v, currentId, [...path, k], label || k);
    });
  }

  // Iterate through all documents
  docs.forEach((doc, index) => {
    traverse(doc, null, [index.toString()], doc?.kind || `Doc ${index}`);
  });

  // Post-process: Kubernetes Relationship Detection
  detectKubernetesLinks(nodes, edges);

  const graphData = detectBidirectionalEdges({ nodes, edges });
  return layoutGraph(graphData);
}

/**
 * Detects relationships between Kubernetes resources (e.g., Service -> Deployment).
 */
function detectKubernetesLinks(nodes: Node[], edges: Edge[]) {
  const k8sNodes = nodes.filter(n => n.data.kind && n.data.path.length === 1);
  const services = k8sNodes.filter(n => n.data.kind === 'Service');
  const controllers = k8sNodes.filter(n => ['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet'].includes(n.data.kind));

  services.forEach(svc => {
    const selector = svc.data.spec?.selector;
    if (!selector) return;

    controllers.forEach(ctrl => {
      const labels = ctrl.data.spec?.template?.metadata?.labels;
      if (!labels) return;

      // Check if selector matches labels
      const matches = Object.entries(selector).every(([k, v]) => labels[k] === v);
      if (matches) {
        edges.push({
          id: `link-${svc.id}-${ctrl.id}`,
          source: svc.id,
          target: ctrl.id,
          label: 'targets pods of',
          animated: true,
          style: { stroke: 'var(--button-background)', strokeWidth: 2, strokeDasharray: '5 5' },
          markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--button-background)' }
        });
      }
    });
  });
}

/**
 * Detects reciprocal edges (A->B and B->A) and merges them into a single bidirectional edge.
 */
function detectBidirectionalEdges(graph: GraphData): GraphData {
  const processedEdges: Edge[] = [];
  const edgeMap = new Map<string, Edge>();

  graph.edges.forEach((edge) => {
    const reverseKey = `${edge.target}->${edge.source}`;
    if (edgeMap.has(reverseKey)) {
      const reciprocalEdge = edgeMap.get(reverseKey)!;
      reciprocalEdge.markerStart = {
        type: MarkerType.ArrowClosed,
        color: edge.markerEnd ? (edge.markerEnd as any).color : 'var(--border-color)',
      };
      reciprocalEdge.animated = false;
      reciprocalEdge.label = '↔';
    } else {
      const key = `${edge.source}->${edge.target}`;
      edgeMap.set(key, edge);
      processedEdges.push(edge);
    }
  });

  return { nodes: graph.nodes, edges: processedEdges };
}

/**
 * Uses Dagre to calculate node positions for a hierarchical layout.
 */
function layoutGraph(graph: GraphData): GraphData {
  if (graph.nodes.length === 0) return graph;

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 100, ranksep: 200 }); // Increased spacing for complex K8s graphs
  g.setDefaultEdgeLabel(() => ({}));

  graph.nodes.forEach((node) => {
    g.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  graph.edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const positionedNodes = graph.nodes.map((node) => {
    const nodeWithPos = g.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPos.x - nodeWidth / 2,
        y: nodeWithPos.y - nodeHeight / 2,
      },
    };
  });

  return { nodes: positionedNodes, edges: graph.edges };
}
