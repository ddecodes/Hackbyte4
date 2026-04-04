import * as React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import type { NodeValidationInfo } from '../types/nodeValidation.ts';

export const EntityNode: React.FC<NodeProps> = ({ data, selected }) => {
  const validation = data.validation as NodeValidationInfo | undefined;
  const statusClass =
    validation?.status === 'pending'
      ? 'val-pending'
      : validation?.status === 'good'
        ? 'val-good'
        : validation?.status === 'warning'
          ? 'val-warning'
          : validation?.status === 'error'
            ? 'val-error'
            : '';
  const tooltip =
    validation?.status === 'pending'
      ? `Pending: ${validation.message}`
      : validation
        ? `${validation.status.toUpperCase()}: ${validation.message}`
        : undefined;
  return (
    <div className={`entity-node-card ${selected ? 'selected' : ''}`} title={tooltip}>
      <div className="entity-header">
        <span className="entity-type-badge">{data.type === 'collection' ? 'List' : 'Object'}</span>
        <div className={`entity-label ${statusClass}`}>{data.label}</div>
      </div>
      
      <div className="entity-body">
        <div className="attribute-indicator">
          {data.attributeCount} propert{data.attributeCount === 1 ? 'y' : 'ies'}
        </div>
      </div>

      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Left}
        className="entity-handle"
      />
      
      {/* Output Handle */}
      <Handle
        type="source"
        position={Position.Right}
        className="entity-handle"
      />

      <style>{`
        .entity-node-card {
          background-color: var(--panel-background);
          border: 2px solid var(--border-color);
          border-radius: 8px;
          min-width: 180px;
          padding: 0;
          box-shadow: 0 4px 6px var(--shadow-color);
          transition: all 0.2s ease-in-out;
          font-family: var(--vscode-editor-font-family);
          overflow: visible;
        }
        .entity-node-card.selected {
          border-color: var(--button-background);
          box-shadow: 0 0 10px var(--button-background);
          transform: translateY(-2px);
        }
        .entity-header {
          padding: 8px 12px;
          background: var(--format-background);
          border-bottom: 1px solid var(--border-color);
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .entity-type-badge {
          font-size: 9px;
          text-transform: uppercase;
          background: var(--button-background);
          color: var(--button-text);
          padding: 1px 4px;
          border-radius: 3px;
          align-self: flex-start;
          font-weight: bold;
        }
    /* Border-bottom (not text-decoration): survives overflow:hidden on parents and is obvious in the webview. */

        .entity-label {
          font-weight: bold;
          font-size: 13px;
          color: var(--text-color);
          word-break: break-all;
          display: inline-block;
          max-width: 100%;
          box-sizing: border-box;
          padding-bottom: 3px;
          margin-bottom: 1px;
          border-bottom: 3px solid transparent;
        }
        .entity-label.val-pending {
          border-bottom: 3px dashed #888;
        }
        .entity-label.val-good {
          border-bottom-color: #2da44e;
        }
        .entity-label.val-warning {
          border-bottom-color: #d4a017;
        }
        .entity-label.val-error {
          border-bottom-color: #cf222e;
        }
        .entity-body {
          padding: 8px 12px;
        }
        .attribute-indicator {
          font-size: 11px;
          color: var(--format-text);
          opacity: 0.8;
          font-style: italic;
        }
        .entity-handle {
          width: 8px;
          height: 8px;
          background-color: var(--button-background);
          border: 2px solid var(--panel-background);
        }
      `}</style>
    </div>
  );
};
