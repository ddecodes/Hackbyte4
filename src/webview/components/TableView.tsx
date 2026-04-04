import * as React from 'react';
import { EditableKeyCell } from './EditableKeyCell';
import { EditableCell } from './EditableCell';

interface TableViewProps {
  data: any;
  vscodeApi: {
    postMessage: (message: any) => void;
    getState: () => any;
    setState: (state: any) => void;
  };
  onUpdateValue: (path: string[], newValue: any) => void;
  onUpdateKey: (path: string[], oldKey: string, newKey: string) => void;
  isSaving: boolean;
  saveError: string | null;
}

interface NestedTableProps {
  data: any;
  level: number;
  path: string[];
  onEditValue: (path: string[], newValue: any) => void;
  onEditKey: (path: string[], oldKey: string, newKey: string) => void;
}

export const TableView: React.FC<TableViewProps> = ({ 
  data, 
  onUpdateValue, 
  onUpdateKey,
  isSaving,
  saveError 
}) => {
  const docs = Array.isArray(data) ? data : [data];

  return (
    <div className="table-view">
      <div className="multi-doc-container">
        {docs.map((doc, index) => (
          <div key={index} className="doc-section">
            <div className="doc-header">
              <span className="doc-badge">Document #{index + 1}</span>
              <span className="doc-title">{doc?.kind || 'Resource'}</span>
              <span className="doc-name">{doc?.metadata?.name || ''}</span>
            </div>
            <div className="doc-body">
              <NestedTable
                data={doc}
                level={0}
                path={[index.toString()]}
                onEditKey={onUpdateKey}
                onEditValue={onUpdateValue}
              />
            </div>
          </div>
        ))}
      </div>

      {isSaving && <div className="save-indicator">Saving...</div>}
      {saveError && <div className="error-indicator">Error: {saveError} sync failed</div>}

      <style>
        {`
          .table-view {
            font-family: var(--vscode-editor-font-family);
            padding: 16px;
          }
          .multi-doc-container {
            display: flex;
            flex-direction: column;
            gap: 24px;
          }
          .doc-section {
            border: 1px solid var(--border-color);
            border-radius: 8px;
            overflow: hidden;
            background: var(--panel-background);
            box-shadow: 0 4px 12px var(--shadow-color);
          }
          .doc-header {
            padding: 10px 16px;
            background: var(--format-background);
            border-bottom: 1px solid var(--border-color);
            display: flex;
            align-items: center;
            gap: 12px;
            font-weight: bold;
          }
          .doc-badge {
            background: var(--button-background);
            color: var(--button-text);
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 10px;
            text-transform: uppercase;
          }
          .doc-title {
            color: var(--text-color);
            font-size: 14px;
          }
          .doc-name {
            color: var(--format-text);
            font-weight: normal;
            font-size: 12px;
            opacity: 0.7;
          }
          .doc-body {
            padding: 8px;
          }
          .save-indicator {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: var(--button-background);
            color: var(--button-text);
            padding: 8px 16px;
            border-radius: 4px;
            z-index: 1000;
          }
          .error-indicator {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #f44336;
            color: white;
            padding: 8px 16px;
            border-radius: 4px;
            z-index: 1000;
          }
          
          /* Table Styles */
          .nested-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
          }
          .table-row {
            border-bottom: 1px solid var(--border-color);
          }
          .table-row:last-child {
            border-bottom: none;
          }
          .key-cell {
            padding: 8px 12px;
            background-color: var(--format-background);
            width: 30%;
            vertical-align: top;
            border-right: 1px solid var(--border-color);
          }
          .value-cell {
            padding: 8px 12px;
            width: 70%;
          }
          .bullet-list {
            margin: 0;
            padding-left: 20px;
          }
          .bullet-item {
            margin: 4px 0;
          }
        `}
      </style>
    </div>
  );
};

const NestedTable: React.FC<NestedTableProps> = ({ data, level, path, onEditValue, onEditKey }) => {
  if (data === null || typeof data !== 'object') {
    return <EditableCell value={data} path={path} onSave={onEditValue} />;
  }

  if (Array.isArray(data)) {
    return (
      <ul className="bullet-list">
        {data.map((item, index) => (
          <li key={index} className="bullet-item">
            <NestedTable 
              data={item} 
              level={level + 1} 
              path={[...path, index.toString()]} 
              onEditValue={onEditValue} 
              onEditKey={onEditKey} 
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <table className="nested-table">
      <tbody>
        {Object.entries(data).map(([key, value]) => (
          <tr key={key} className="table-row">
            <td className="key-cell">
              <EditableKeyCell 
                keyName={key} 
                path={path} 
                onSave={onEditKey} 
              />
            </td>
            <td className="value-cell">
              <NestedTable 
                data={value} 
                level={level + 1} 
                path={[...path, key]} 
                onEditValue={onEditValue} 
                onEditKey={onEditKey} 
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};