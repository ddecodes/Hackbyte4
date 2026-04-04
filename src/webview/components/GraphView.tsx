import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
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
  updateEdge
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

export const GraphView: React.FC<GraphViewProps> = ({ data, onEditValue, onUpdateStructure, onHighlightNode, selectedNodeId, nodeValidations, }) => {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => transformToLogicalGraph(data), [data]);
  
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
          nodeTypes={nodeTypes}
          connectionLineType={ConnectionLineType.SmoothStep}
          fitView
        >
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
          background: var(--panel-background);
          border: 1px solid var(--border-color);
        }
        .react-flow__controls-button {
          border-bottom: 1px solid var(--border-color);
          fill: var(--text-color);
        }
        .react-flow__edge-path {
          stroke: var(--border-color);
          stroke-width: 2;
        }
      `}</style>
    </div>
  );
};
