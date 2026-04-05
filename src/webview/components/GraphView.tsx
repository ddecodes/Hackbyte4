import * as React from 'react';
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  ConnectionLineType,
  Node,
  Edge,
  OnNodesChange,
  applyNodeChanges,
  OnEdgesChange,
  applyEdgeChanges,
  Connection,
  addEdge,
  updateEdge,
  useReactFlow,
  ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { EntityNode } from './EntityNode';
import { AttributePanel } from './AttributePanel';
import { transformToLogicalGraph } from '../utils/graphUtils';
import { idToPath } from '../utils/yamlOperations';
import type { NodeValidationInfo } from '../types/nodeValidation';

export type { NodeValidationInfo };

interface GraphViewProps {
  data: any;
  onEditValue: (path: string[], newValue: any) => void;
  onUpdateStructure: (action: 'move' | 'remove', sourcePath: string[], targetPath?: string[]) => void;
  onHighlightNode?: (path: string[]) => void;
  selectedNodeId?: string | null;
  nodeValidations?: Record<string, NodeValidationInfo>;
}

const nodeTypes = {
  entityNode: EntityNode,
};

/** Re-run fitView when layout from YAML changes (not on node drag). */
function FitViewOnGraphChange({ layoutKey }: { layoutKey: string }) {
  const { fitView } = useReactFlow();
  useLayoutEffect(() => {
    let alive = true;
    const t = window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        if (!alive) {
          return;
        }
        fitView({
          padding: 0.2,
          minZoom: 0.02,
          maxZoom: 1.75,
          duration: 220,
          includeHiddenNodes: false,
        });
      });
    }, 48);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [layoutKey, fitView]);
  return null;
}

export const GraphView: React.FC<GraphViewProps> = ({ data, onEditValue, onUpdateStructure, onHighlightNode, selectedNodeId, nodeValidations, }) => {
  const graphLayout = useMemo(() => transformToLogicalGraph(data), [data]);
  const { nodes: initialNodes, edges: initialEdges } = graphLayout;
  const fitViewLayoutKey = useMemo(
    () =>
      `${graphLayout.nodes.length}:${graphLayout.edges.length}:${graphLayout.nodes.map((n) => n.id).join(',')}`,
    [graphLayout]
  );
  
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);
  const [selectedNode, setSelectedNode] = useState<any | null>(null);

  // Sync nodes when data or Gemini validation map changes; keep user-dragged positions when ids match
  React.useEffect(() => {
    const { nodes: newNodes, edges: newEdges } = transformToLogicalGraph(data);
    setNodes((prev) => {
      const posMap = new Map(prev.map((p) => [p.id, p.position]));
      return newNodes.map((n) => ({
        ...n,
        position: posMap.get(n.id) ?? n.position,
        data: {
          ...n.data,
          validation: nodeValidations?.[n.id],
        },
      }));
    });
    setEdges(newEdges);
  }, [data, nodeValidations]);
  
  // Sync selectedNode when selectedNodeId changes
  React.useEffect(() => {
    if (selectedNodeId) {
      const node = nodes.find(n => n.id === selectedNodeId);
      if (node) {
        setSelectedNode(node);
      }
    } else {
      setSelectedNode(null);
    }
  }, [selectedNodeId, nodes]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );
  
  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const onEdgeUpdate = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      // Re-wiring logic
      if (newConnection.target && newConnection.source) {
        const sourcePath = idToPath(oldEdge.target);
        const targetPath = [...idToPath(newConnection.target), sourcePath[sourcePath.length - 1]];
        onUpdateStructure('move', sourcePath, targetPath);
      }
      setEdges((els) => updateEdge(oldEdge, newConnection, els));
    },
    [onUpdateStructure]
  );

  const onConnect = useCallback(
    (params: Connection) => {
      if (params.source && params.target) {
        // In a tree, this is a move. Find the node being moved.
        // For now, let's assume valid re-connections.
        const sourcePath = idToPath(params.source); // This is actually the parent
        const targetPath = idToPath(params.target); // New parent
      }
      setEdges((eds) => addEdge(params, eds));
    },
    []
  );

  const onEdgesDelete = useCallback(
    (edgesToDelete: Edge[]) => {
      if (confirm('Are you sure you want to delete this connection and its associated data?')) {
        edgesToDelete.forEach(edge => {
          const path = idToPath(edge.target);
          onUpdateStructure('remove', path);
        });
      }
    },
    [onUpdateStructure]
  );

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
    if (onHighlightNode) {
      onHighlightNode(node.data.path);
    }
  }, [onHighlightNode]);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const onFlowInit = useCallback((instance: ReactFlowInstance) => {
    window.requestAnimationFrame(() => {
      instance.fitView({
        padding: 0.2,
        minZoom: 0.02,
        maxZoom: 1.75,
        duration: 0,
      });
    });
  }, []);

  const defaultEdgeOptions = useMemo(
    () => ({
      type: 'smoothstep' as const,
      pathOptions: { borderRadius: 28, offset: 2 },
      style: {
        strokeWidth: 2.5,
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
      },
    }),
    []
  );

  return (
    <div className="graph-view-wrapper">
      <div className="flow-container">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onEdgeUpdate={onEdgeUpdate}
          onConnect={onConnect}
          onEdgesDelete={onEdgesDelete}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onInit={onFlowInit}
          nodeTypes={nodeTypes}
          connectionLineType={ConnectionLineType.SmoothStep}
          defaultEdgeOptions={defaultEdgeOptions}
          connectionLineStyle={{ stroke: 'var(--graph-accent)', strokeWidth: 2.5, strokeLinecap: 'round' }}
          minZoom={0.02}
          maxZoom={4}
          proOptions={{ hideAttribution: true }}
        >
          <FitViewOnGraphChange layoutKey={fitViewLayoutKey} />
          <Background color="var(--border-color)" gap={20} />
          <Controls />
        </ReactFlow>
      </div>

      {selectedNode && (
        <AttributePanel 
          selectedNode={selectedNode} 
          onEditValue={onEditValue}
          onClose={() => setSelectedNode(null)}
        />
      )}

      <style>{`
        .graph-view-wrapper {
          display: flex;
          width: 100%;
          height: 600px;
          background: var(--background-color);
          border-radius: 8px;
          border: 1px solid var(--border-color);
          overflow: hidden;
          position: relative;
        }
        .flow-container {
          flex: 1;
          height: 100%;
          position: relative;
        }
        .react-flow__handle {
          background: var(--button-background);
        }
        .react-flow__controls {
          background: linear-gradient(
            165deg,
            rgba(168, 85, 247, 0.22) 0%,
            rgba(124, 58, 237, 0.14) 45%,
            rgba(17, 24, 39, 0.55) 100%
          ) !important;
          border: 1px solid var(--graph-accent) !important;
          border-radius: 12px !important;
          overflow: hidden;
          box-shadow:
            0 2px 12px rgba(124, 58, 237, 0.35),
            inset 0 1px 0 rgba(255, 255, 255, 0.06) !important;
        }
        [data-theme='light'] .react-flow__controls {
          background: linear-gradient(
            165deg,
            rgba(168, 85, 247, 0.35) 0%,
            rgba(196, 181, 253, 0.45) 100%
          ) !important;
          box-shadow: 0 2px 12px rgba(124, 58, 237, 0.25) !important;
        }
        .react-flow__controls-button {
          background: transparent !important;
          border: none !important;
          border-bottom: 1px solid rgba(124, 58, 237, 0.45) !important;
          border-radius: 0 !important;
        }
        .react-flow__controls-button:last-child {
          border-bottom: none !important;
        }
        .react-flow__controls-button:hover {
          background: rgba(17, 24, 39, 0.35) !important;
        }
        [data-theme='light'] .react-flow__controls-button:hover {
          background: rgba(124, 58, 237, 0.25) !important;
        }
        .react-flow__controls-button svg,
        .react-flow__controls-button svg path {
          fill: #ffffffff !important;
          stroke: #909090ff !important;
        }
        [data-theme='light'] .react-flow__controls-button svg,
        [data-theme='light'] .react-flow__controls-button svg path {
          fill: #111827 !important;
          stroke: #111827 !important;
        }
        .react-flow__edge-path {
          stroke: var(--graph-accent);
          stroke-width: 2.5;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
      `}</style>
    </div>
  );
};
