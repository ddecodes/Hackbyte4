import * as React from 'react';
import { useState, useEffect } from 'react';

interface AttributePanelProps {
  selectedNode: {
    id: string;
    data: {
      label: string;
      attributes: Record<string, any>;
      path: string[];
    };
  } | null;
  onEditValue: (path: string[], newValue: any) => void;
  onClose: () => void;
}

export const AttributePanel: React.FC<AttributePanelProps> = ({ selectedNode, onEditValue, onClose }) => {
  const [attributes, setAttributes] = useState<Record<string, any>>({});

  useEffect(() => {
    if (selectedNode) {
      setAttributes(selectedNode.data.attributes);
    }
  }, [selectedNode]);

  if (!selectedNode) return null;

  return (
    <div className="attribute-panel-container">
      <div className="panel-header">
        <div className="panel-title">Properties: {selectedNode.data.label}</div>
        <button className="panel-close" onClick={onClose}>&times;</button>
      </div>

      <div className="panel-content">
        <table className="attribute-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(attributes).length > 0 ? (
              Object.entries(attributes).map(([key, value]) => (
                <tr key={key}>
                  <td className="attr-key">{key}</td>
                  <td className="attr-value">
                    <input
                      className="attr-input"
                      type="text"
                      defaultValue={String(value)}
                      onBlur={(e) => {
                        const newValue = e.target.value;
                        if (newValue !== String(value)) {
                          onEditValue([...selectedNode.data.path, key], newValue);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                    />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={2} className="attr-empty">No direct properties</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <style>{`
        .attribute-panel-container {
          width: 350px;
          height: 100%;
          background-color: var(--panel-background);
          border-left: 1px solid var(--border-color);
          display: flex;
          flex-direction: column;
          box-shadow: -2px 0 10px var(--shadow-color);
          animation: slideIn 0.3s ease;
          font-family: var(--vscode-editor-font-family);
          z-index: 100;
        }
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .panel-header {
          padding: 12px 16px;
          background-color: var(--format-background);
          border-bottom: 1px solid var(--border-color);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .panel-title {
          font-weight: bold;
          font-size: 13px;
          color: var(--text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .panel-close {
          background: none;
          border: none;
          color: var(--text-color);
          font-size: 20px;
          cursor: pointer;
          opacity: 0.6;
        }
        .panel-close:hover {
          opacity: 1;
        }
        .panel-content {
          padding: 0;
          overflow-y: auto;
          flex: 1;
        }
        .attribute-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }
        .attribute-table th {
          text-align: left;
          padding: 8px 16px;
          background-color: var(--background-color);
          border-bottom: 1px solid var(--border-color);
          color: var(--format-text);
          text-transform: uppercase;
          font-size: 10px;
        }
        .attribute-table td {
          padding: 4px 16px;
          border-bottom: 1px dotted var(--border-color);
        }
        .attr-key {
          font-weight: bold;
          color: var(--format-text);
          width: 40%;
          word-break: break-all;
        }
        .attr-value {
          width: 60%;
        }
        .attr-input {
          width: 100%;
          background-color: var(--background-color);
          border: 1px solid transparent;
          color: var(--text-color);
          padding: 4px 8px;
          border-radius: 4px;
          font-family: var(--vscode-editor-font-family);
        }
        .attr-input:focus {
          border-color: var(--button-background);
          outline: none;
        }
        .attr-empty {
          text-align: center;
          padding: 20px;
          color: var(--format-text);
          font-style: italic;
        }
      `}</style>
    </div>
  );
};
