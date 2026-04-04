import * as React from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import * as jsYaml from 'js-yaml';
import { TableView } from './TableView';
import { GraphView } from './GraphView';
import { YamlDetector, YamlFormat } from '../../utils/yaml-detector';
import { ThemeProvider } from '../utils/themeContext';
import * as yamlOps from '../utils/yamlOperations';
import { transformToLogicalGraph, getValueAtPath, trimValidationSnippet } from '../utils/graphUtils';
import type { NodeValidationInfo } from '../types/nodeValidation';

// Property type definition
interface YamlPreviewProps {
  initialContent: string;
  vscodeApi: {
    postMessage: (message: any) => void;
    getState: () => any;
    setState: (state: any) => void;
  };
}

// Export format definition
type ExportFormat = 'json' | 'xml' | 'pdf' | 'csv' | 'markdown' | 'html' | 'png';

/** Webview postMessage may coerce numbers; normalize so validation updates are not dropped. */
function graphValidationRequestMatches(incoming: unknown, current: number): boolean {
  const n = Number(incoming);
  return Number.isFinite(n) && n === current;
}

// Component wrapped with theme
const YamlPreviewInner: React.FC<YamlPreviewProps> = ({ initialContent, vscodeApi }) => {
  // YAML content state
  const [yamlContent, setYamlContent] = useState<string>(initialContent);
  // Parsed JSON data
  const [jsonData, setJsonData] = useState<any>(null);
  // Error message
  const [error, setError] = useState<string | null>(null);
  // Detected YAML format
  const [yamlFormat, setYamlFormat] = useState<YamlFormat>(YamlFormat.Generic);
  // Communication status tracking
  const [communicationStatus, setCommunicationStatus] = useState<string | null>(null);
  // Ref to hold last processed YAML content
  const lastContentRef = useRef<string>(initialContent);
  // Export menu display state
  const [showExportMenu, setShowExportMenu] = useState<boolean>(false);
  // View mode state (table or graph)
  const [viewMode, setViewMode] = useState<'table' | 'graph'>('table');
  // Latest view mode ref for async/callback access
  const viewModeRef = useRef<'table' | 'graph'>(viewMode);
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [showAiKeyPanel, setShowAiKeyPanel] = useState(false);

  const updateGeminiApiKey = useCallback(
    (value: string) => {
      setGeminiApiKey(value);
      try {
        const prev = vscodeApi.getState?.() ?? {};
        vscodeApi.setState({ ...prev, geminiApiKey: value });
      } catch {
        /* ignore */
      }
    },
    [vscodeApi]
  );

  useEffect(() => {
    try {
      const s = vscodeApi.getState?.() ?? {};
      if (typeof s.geminiApiKey === 'string') {
        setGeminiApiKey(s.geminiApiKey);
      }
    } catch {
      /* ignore */
    }
  }, [vscodeApi]);
  // Saving states lifted from TableView
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Highlighted node (from code editor selection)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // Graph node validations (Gemini-based)
  const [nodeValidations, setNodeValidations] = useState<Record<string, NodeValidationInfo>>({});
  // Trace latest validation request to avoid race conditions
  const latestGraphValidationIdRef = useRef<number>(0);

  // Convert YAML to JSON
  const parseYaml = (content: string) => {
    try {
      console.log('Parsing YAML content (multi-doc)...');
      const docs: any[] = [];
      try {
        jsYaml.loadAll(content, (doc) => {
          if (doc !== null) {
            docs.push(doc);
          }
        });
      } catch (loadErr) {
        console.error('JS-YAML load error:', loadErr);
        throw loadErr;
      }

      setJsonData(docs);

      // Detect YAML format from the first document if available
      if (docs.length > 0 && typeof docs[0] === 'object') {
        const format = YamlDetector.detectFormat(docs[0]);
        setYamlFormat(format);
      }
      setError(null);
      return docs;
    } catch (err) {
      console.error('YAML parsing error:', err);
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Unknown error parsing YAML');
      }
      return null;
    }
  };

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  // Process initial content
  useEffect(() => {
    console.log('Processing initial content...');
    parseYaml(initialContent);
    lastContentRef.current = initialContent;
  }, [initialContent]);

  // Gemini graph validation (Graph view only); debounced when YAML structure changes
  useEffect(() => {
    if (viewMode !== 'graph' || error || !jsonData || !geminiApiKey.trim()) {
      if (viewMode !== 'graph' || !geminiApiKey.trim()) {
        setNodeValidations({});
      }
      return;
    }

    const timer = window.setTimeout(() => {
      const { nodes } = transformToLogicalGraph(jsonData);
      const payloads = nodes.map((n) => {
        const path = n.data.path as string[];
        const sub = getValueAtPath(jsonData, path);
        let snippet: string;
        try {
          snippet = JSON.stringify(sub);
        } catch {
          snippet = String(sub);
        }
        return {
          id: n.id,
          label: String(n.data.label ?? ''),
          snippet: trimValidationSnippet(snippet),
        };
      });

      latestGraphValidationIdRef.current += 1;
      const requestId = latestGraphValidationIdRef.current;
      vscodeApi.postMessage({
        command: 'validateGraphNodes',
        requestId,
        nodes: payloads,
        apiKey: geminiApiKey.trim(),
      });
    }, 550);

    return () => clearTimeout(timer);
  }, [jsonData, viewMode, error, vscodeApi, geminiApiKey]);

  // Set up VSCode API message handling
  useEffect(() => {
    const handleVSCodeMessage = (event: MessageEvent) => {
      const message = event.data;
      console.log('YamlPreview: Received message from vscode:', message);

      if (message.command === 'updateContent') {
        if (message.content && message.content !== lastContentRef.current) {
          console.log('YamlPreview: Updating content from VSCode message');
          setYamlContent(message.content);
          parseYaml(message.content);
          lastContentRef.current = message.content;
        }
      } else if (message.command === 'saveComplete') {
        // Process save complete notification
        console.log('YamlPreview: Save complete notification received:', message.success);
        if (message.success) {
          setCommunicationStatus('Saved successfully');
          setTimeout(() => setCommunicationStatus(null), 2000);
        } else {
          setCommunicationStatus(`Error: ${message.error || 'Failed to save'}`);
          setTimeout(() => setCommunicationStatus(null), 5000);
        }
      } else if (message.command === 'exportComplete') {
        // Process export complete notification
        console.log('YamlPreview: Export complete notification received:', message.success);
        if (message.success) {
          setCommunicationStatus(`Exported ${message.format?.toUpperCase() || 'file'} successfully`);
          setTimeout(() => setCommunicationStatus(null), 2000);
        } else {
          setCommunicationStatus(`Error: ${message.error || 'Export failed'}`);
          setTimeout(() => setCommunicationStatus(null), 5000);
        }
      } else if (message.command === 'graphValidationStart') {
        if (viewModeRef.current !== 'graph') {
          return;
        }
        if (!graphValidationRequestMatches(message.requestId, latestGraphValidationIdRef.current)) {
          return;
        }
        const ids = (message.nodeIds as string[]) || [];
        console.log('[Flowjam] graphValidationStart', { requestId: message.requestId, nodeCount: ids.length });
        const pending: Record<string, NodeValidationInfo> = {};
        ids.forEach((id) => {
          pending[id] = { status: 'pending', message: 'Analyzing…' };
        });
        setNodeValidations(pending);
      } else if (message.command === 'nodeValidation') {
        if (viewModeRef.current !== 'graph') {
          return;
        }
        if (!graphValidationRequestMatches(message.requestId, latestGraphValidationIdRef.current)) {
          return;
        }
        const status = message.status as NodeValidationInfo['status'];
        if (status !== 'good' && status !== 'warning' && status !== 'error') {
          return;
        }
        console.log('[Flowjam] nodeValidation', message.nodeId, status);
        setNodeValidations((prev) => ({
          ...prev,
          [message.nodeId]: {
            status,
            message: String(message.message ?? ''),
          },
        }));
      } else if (message.command === 'graphValidationComplete') {
        if (!graphValidationRequestMatches(message.requestId, latestGraphValidationIdRef.current)) {
          return;
        }
      } else if (message.command === 'graphValidationError') {
        if (!graphValidationRequestMatches(message.requestId, latestGraphValidationIdRef.current)) {
          return;
        }
        setNodeValidations({});
        setCommunicationStatus(`Graph AI: ${message.error || 'Request failed'}`);
        setTimeout(() => setCommunicationStatus(null), 8000);
      } else if (message.command === 'highlightNode') {
        console.log('YamlPreview: Received highlightNode from VSCode:', message.id);
        setSelectedNodeId(message.id);
        // Do NOT automatically switch to graph view anymore, keep current view mode
      } else if (message.command === 'prepareForScreenshot') {
        // Process screenshot preparation
        console.log('YamlPreview: Preparing for screenshot');
        // Close export menu if open
        setShowExportMenu(false);
        // Hide notification messages
        setCommunicationStatus(null);
        // Prepare other UI elements as needed (e.g., expand all nodes)
      } else if (message.command === 'captureHtmlSnapshot') {
        // Capture and send HTML snapshot
        console.log('YamlPreview: Capturing HTML snapshot');

        // Hide export menu
        setShowExportMenu(false);
        // Hide notification messages
        setCommunicationStatus(null);

        // Wait a moment to capture snapshot (to allow UI updates to complete)
        setTimeout(() => {
          try {
            // Get table element only
            const tableElement = document.querySelector('.content-view table');
            if (!tableElement) {
              // If table not found, use entire content view as fallback
              const contentElement = document.querySelector('.content-view');
              if (!contentElement) {
                throw new Error('Content element not found');
              }

              // Get style information
              const styles = Array.from(document.styleSheets)
                .filter(sheet => {
                  try {
                    // CSSStyleSheet.cssRules access may be restricted by CORS policy
                    return sheet.cssRules !== null;
                  } catch (e) {
                    return false;
                  }
                })
                .map(sheet => {
                  return Array.from(sheet.cssRules)
                    .map(rule => rule.cssText)
                    .join('\n');
                })
                .join('\n');

              // Get HTML content (excluding edit-related UI elements)
              const html = contentElement.innerHTML;

              // Send snapshot information to VSCode
              vscodeApi.postMessage({
                command: 'htmlSnapshot',
                html: html,
                styles: styles
              });
            } else {
              // If table element found, use it only
              // Get style information
              const styles = Array.from(document.styleSheets)
                .filter(sheet => {
                  try {
                    return sheet.cssRules !== null;
                  } catch (e) {
                    return false;
                  }
                })
                .map(sheet => {
                  return Array.from(sheet.cssRules)
                    .map(rule => rule.cssText)
                    .join('\n');
                })
                .join('\n');

              // Get table HTML
              const html = tableElement.outerHTML;

              // Send snapshot information to VSCode
              vscodeApi.postMessage({
                command: 'htmlSnapshot',
                html: html,
                styles: styles,
                tableOnly: true
              });
            }

            console.log('YamlPreview: HTML snapshot sent to VSCode');
          } catch (err) {
            console.error('Error capturing HTML snapshot:', err);
            vscodeApi.postMessage({
              command: 'htmlSnapshotError',
              error: String(err)
            });
          }
        }, 200); // Set 200ms delay
      }
    };

    // Check for VS Code Webview API initialization
    if (window.addEventListener) {
      // Listen for messages from VS Code Webview API
      window.addEventListener('message', handleVSCodeMessage);

      // Send initialization complete message
      console.log('YamlPreview: Sending ready message to VSCode');
      vscodeApi.postMessage({ command: 'ready' });
    } else {
      console.error('Window event listener is not available');
    }

    // Handle content updates from VSCode (custom event)
    const handleContentUpdate = (event: CustomEvent) => {
      const detail = event.detail;
      console.log('YamlPreview: Received content update event:', detail);

      if (detail.command === 'updateYaml' && detail.content) {
        // Send updated YAML back to VS Code
        vscodeApi.postMessage({
          command: 'updateYaml',
          content: detail.content
        });
        setCommunicationStatus('Saving...');
      }
    };

    // Add custom event listener
    window.addEventListener('yaml-editor-update', handleContentUpdate as EventListener);

    return () => {
      window.removeEventListener('message', handleVSCodeMessage);
      window.removeEventListener('yaml-editor-update', handleContentUpdate as EventListener);
    };
  }, [vscodeApi]);

  // --- LIFTED UPDATE LOGIC ---
  const updateYamlKey = (path: string[], oldKey: string, newKey: string) => {
    try {
      setIsSaving(true);
      setSaveError(null);

      const docs: any[] = [];
      jsYaml.loadAll(yamlContent, (doc) => { if (doc !== null) docs.push(doc); });

      // First element of path is document index
      const docIndex = parseInt(path[0]);
      const actualPath = path.slice(1);

      if (actualPath.length === 0) {
        const targetDoc = docs[docIndex];
        const newObj: any = {};
        Object.keys(targetDoc).forEach(key => {
          newObj[key === oldKey ? newKey : key] = targetDoc[key];
        });
        docs[docIndex] = newObj;
      } else {
        let current: any = docs[docIndex];
        for (let i = 0; i < actualPath.length - 1; i++) {
          current = current[actualPath[i]];
        }
        const parentKey = actualPath[actualPath.length - 1];
        const targetObj = current[parentKey];
        const newObj: any = {};
        Object.keys(targetObj).forEach(key => {
          newObj[key === oldKey ? newKey : key] = targetObj[key];
        });
        current[parentKey] = newObj;
      }

      const updatedYaml = docs.map(d => jsYaml.dump(d, { lineWidth: -1, noRefs: true, sortKeys: false })).join('---\n');
      vscodeApi.postMessage({ command: 'updateYaml', content: updatedYaml });
    } catch (err) {
      console.error('Failed to update key:', err);
      setIsSaving(false);
      setSaveError(String(err));
    }
  };

  const updateYamlValue = (path: string[], newValue: any) => {
    try {
      setIsSaving(true);
      setSaveError(null);

      const docs: any[] = [];
      jsYaml.loadAll(yamlContent, (doc) => { if (doc !== null) docs.push(doc); });

      const docIndex = parseInt(path[0]);
      const actualPath = path.slice(1);

      let current: any = docs[docIndex];
      for (let i = 0; i < actualPath.length - 1; i++) {
        if (current[actualPath[i]] === undefined) current[actualPath[i]] = {};
        current = current[actualPath[i]];
      }

      const lastKey = actualPath[actualPath.length - 1];
      if (lastKey !== undefined) current[lastKey] = newValue;

      const updatedYaml = docs.map(d => jsYaml.dump(d, { lineWidth: -1, noRefs: true, sortKeys: false })).join('---\n');
      vscodeApi.postMessage({ command: 'updateYaml', content: updatedYaml });
    } catch (err) {
      console.error('Failed to update value:', err);
      setIsSaving(false);
      setSaveError(String(err));
    }
  };

  const updateYamlStructure = (action: 'move' | 'remove', sourcePath: string[], targetPath?: string[]) => {
    try {
      setIsSaving(true);
      setSaveError(null);

      const docs: any[] = [];
      jsYaml.loadAll(yamlContent, (doc) => { if (doc !== null) docs.push(doc); });

      const sourceDocIndex = parseInt(sourcePath[0]);
      const sourceActualPath = sourcePath.slice(1);

      let targetDocIndex = targetPath ? parseInt(targetPath[0]) : sourceDocIndex;
      const targetActualPath = targetPath ? targetPath.slice(1) : undefined;

      if (action === 'remove') {
        const { updatedObj } = yamlOps.removeBlock(docs[sourceDocIndex], sourceActualPath);
        docs[sourceDocIndex] = updatedObj;
      } else if (action === 'move' && targetActualPath) {
        // Handle move across documents
        const { updatedObj: newSourceDoc, removedValue } = yamlOps.removeBlock(docs[sourceDocIndex], sourceActualPath);
        docs[sourceDocIndex] = newSourceDoc;
        docs[targetDocIndex] = yamlOps.insertBlock(docs[targetDocIndex], targetActualPath, removedValue);
      }

      const updatedYaml = docs.map(d => jsYaml.dump(d, { lineWidth: -1, noRefs: true, sortKeys: false })).join('---\n');
      vscodeApi.postMessage({ command: 'updateYaml', content: updatedYaml });
    } catch (err) {
      console.error('Failed to update structure:', err);
      setIsSaving(false);
      setSaveError(String(err));
    }
  };
  // ---------------------------

  // Close export menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (showExportMenu && !target.closest('.export-menu-container')) {
        setShowExportMenu(false);
      }
    };

    document.addEventListener('click', handleClickOutside);

    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [showExportMenu]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (showAiKeyPanel && !target.closest('.ai-panel-container')) {
        setShowAiKeyPanel(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showAiKeyPanel]);

  // Export in specified format
  const exportAs = (format: ExportFormat) => {
    console.log(`YamlPreview: Exporting as ${format}`);

    if (!jsonData) {
      console.error('Cannot export: No valid data');
      setCommunicationStatus('Error: No valid data to export');
      setTimeout(() => setCommunicationStatus(null), 3000);
      return;
    }

    // Send export message to VS Code extension
    vscodeApi.postMessage({
      command: 'exportAs',
      format: format,
      content: jsonData,
      yamlContent: yamlContent
    });

    setCommunicationStatus(`Exporting as ${format.toUpperCase()}...`);
    setShowExportMenu(false); // Close menu
  };

  // Toggle export menu
  const toggleExportMenu = () => {
    setShowExportMenu(!showExportMenu);
  };

  const handleHighlightNode = (path: string[]) => {
    vscodeApi.postMessage({
      command: 'highlightPath',
      path: path
    });
  };

  return (
    <div className="yaml-preview-container">
      <style>
        {`
          .yaml-preview-container {
            background-color: var(--background-color);
            color: var(--text-color);
            padding: 20px;
            font-family: var(--vscode-editor-font-family);
            border-radius: 8px;
            box-shadow: 0 1px 5px var(--shadow-color);
            max-width: 1200px;
            margin: 0 auto;
            position: relative;
          }
          .error-message {
            background-color: var(--error-background);
            color: var(--error-text);
            padding: 10px 15px;
            border-radius: 4px;
            margin: 10px 0;
            font-family: var(--vscode-editor-font-family);
            white-space: pre-wrap;
          }
          .editing-guide {
            background-color: var(--info-background);
            color: var(--info-text);
            padding: 8px 12px;
            border-radius: 4px;
            margin: 10px 0 15px;
            font-size: 12px;
            display: flex;
            align-items: center;
          }
          .editing-guide .info-icon {
            margin-right: 8px;
          }
          .toolbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            padding: 0;
            background-color: transparent;
            border-radius: 0;
          }
          .yaml-format-badge {
            background-color: var(--format-background);
            color: var(--format-text);
            padding: 4px 8px;
            font-size: 12px;
            border-radius: 4px;
            display: inline-block;
            font-weight: 500;
          }
          .export-button {
            background-color: var(--button-background);
            color: var(--button-text);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            font-family: var(--vscode-editor-font-family);
            display: flex;
            align-items: center;
            outline: none;
            box-shadow: 0 1px 3px var(--shadow-color);
            transition: all 0.2s ease;
            min-width: 90px;
            justify-content: center;
            margin-top: 5px;
            margin-bottom: 10px;
          }
          .export-button svg {
            margin-right: 5px;
            width: 14px;
            height: 14px;
          }
          .export-button:hover {
            background-color: var(--button-hover);
            transform: scale(1.05);
          }
          .export-button:active {
            transform: translateY(1px) scale(1);
            box-shadow: 0 0 1px var(--shadow-color);
          }
          .export-menu {
            position: absolute;
            top: 45px;
            left: 10px;
            background-color: var(--panel-background);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 5px 0;
            z-index: 100;
            box-shadow: 0 2px 10px var(--shadow-color);
            min-width: 150px;
          }
          .export-menu-item {
            padding: 8px 16px;
            cursor: pointer;
            font-size: 13px;
            white-space: nowrap;
            display: flex;
            align-items: center;
            transition: background-color 0.1s;
          }
          .export-menu-item:hover {
            background-color: var(--format-background);
            color: var(--format-text);
          }
          .export-menu-item svg {
            margin-right: 8px;
            width: 14px;
            height: 14px;
          }
          .status-indicator {
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 8px 12px;
            background-color: var(--status-background);
            color: var(--status-text);
            border-radius: 4px;
            font-size: 12px;
            z-index: 1000;
            transition: opacity 0.3s;
            box-shadow: 0 2px 10px var(--shadow-color);
          }
          .action-buttons {
            position: relative;
            display: flex;
            justify-content: flex-start;
            margin: 10px 0 15px;
          }
          [data-theme='light'] {
            --panel-background: #ffffff;
            --background-color: #fafafa;
            --text-color: #555555;
            --border-color: #e5e5e5;
            --format-background: #f7f7f9;
            --format-text: #5e7985;
            --button-background: #8aa0aa;
            --button-text: #ffffff;
            --button-hover: #778e99;
            --shadow-color: rgba(0, 0, 0, 0.06);
            --status-background: #f0f0f2;
            --status-text: #5e7985;
            --error-background: #feeef0;
            --error-text: #c56c6c;
            --info-background: #f0f0f2;
            --info-text: #5e7985;
          }
          
          [data-theme='dark'] {
            --panel-background: #2d2d2d;
            --background-color: #1e1e1e;
            --text-color: #e8e8e8;
            --border-color: #555555;
            --format-background: #2d3439;
            --format-text: #a6bbc5;
            --button-background: #4a5a64;
            --button-text: #ffffff;
            --button-hover: #5a6a74;
            --shadow-color: rgba(0, 0, 0, 0.4);
            --status-background: #2d3439;
            --status-text: #ffffff;
            --error-background: #5a1d1d;
            --error-text: #f48771;
            --info-background: #2d3439;
            --info-text: #a6bbc5;
          }
          .ai-panel-container {
            position: relative;
          }
          .ai-toggle-button {
            background-color: var(--panel-background);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 5px 12px;
            font-size: 12px;
            font-weight: 600;
            color: var(--text-color);
            cursor: pointer;
            font-family: var(--vscode-editor-font-family);
          }
          .ai-toggle-button:hover {
            background-color: var(--format-background);
          }
          .ai-toggle-button.has-key {
            border-color: var(--button-background);
            color: var(--button-background);
          }
          .ai-key-dropdown {
            position: absolute;
            top: calc(100% + 6px);
            right: 0;
            z-index: 150;
            min-width: 260px;
            padding: 10px 12px;
            background-color: var(--panel-background);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            box-shadow: 0 4px 14px var(--shadow-color);
          }
            
          .ai-key-label {
            font-size: 11px;
            font-weight: 600;
            color: var(--format-text);
            margin-bottom: 6px;
          }
          .ai-key-input {
            width: 100%;
            box-sizing: border-box;
            padding: 6px 8px;
            font-size: 12px;
            font-family: var(--vscode-editor-font-family);
            color: var(--text-color);
            background: var(--background-color);
            border: 1px solid var(--border-color);
            border-radius: 4px;
          }
          .ai-key-hint {
            margin-top: 8px;
            font-size: 10px;
            color: var(--format-text);
            line-height: 1.35;
          }

          .view-switcher {
            display: flex;
            background-color: var(--panel-background);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 2px;
            margin-left: 10px;
          }
          .view-switcher-button {
            background: none;
            border: none;
            padding: 4px 12px;
            font-size: 12px;
            color: var(--text-color);
            cursor: pointer;
            border-radius: 4px;
            transition: all 0.2s;
          }
          .view-switcher-button.active {
            background-color: var(--button-background);
            color: var(--button-text);
          }
          .view-switcher-button:hover:not(.active) {
            background-color: var(--button-hover);
            color: var(--button-text);
          }
          
          .save-indicator {
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 10px 16px;
            background-color: var(--status-background);
            color: var(--status-text);
            border-radius: 4px;
            font-size: 14px;
            box-shadow: 0 2px 8px var(--shadow-color);
            z-index: 1000;
          }
        `}
      </style>

      {error && (
        <div className="error-message">
          <p>YAML parsing error:</p>
          <pre>{error}</pre>
        </div>
      )}

      {communicationStatus && (
        <div className={`communication-status ${communicationStatus.includes('Error') ? 'error' : 'success'}`}>
          {communicationStatus}
        </div>
      )}

      {/* Editing guide */}
      <div className="editing-guide">
        <span className="info-icon">ℹ️</span> Double-click on any key or value to edit
      </div>

      {/* YAML format information display */}
      {!error && jsonData && (
        <div className="yaml-format-info" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span className="yaml-format-icon">📄</span>
            <span className="yaml-format-name">
              {yamlFormat === YamlFormat.Generic ? 'Generic YAML' : yamlFormat}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div className="ai-panel-container" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className={`ai-toggle-button ${geminiApiKey.trim() ? 'has-key' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowAiKeyPanel((open) => !open);
                }}
              >
                AI {showAiKeyPanel ? '▴' : '▾'}
              </button>
              {showAiKeyPanel && (
                <div className="ai-key-dropdown" onClick={(e) => e.stopPropagation()}>
                  <div className="ai-key-label">Gemini API key</div>
                  <input
                    type="password"
                    className="ai-key-input"
                    placeholder="Paste key from Google AI Studio…"
                    value={geminiApiKey}
                    onChange={(e) => updateGeminiApiKey(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <div className="ai-key-hint">
                    Enables graph node checks only. Stored in this preview session.
                  </div>
                </div>
              )}
            </div>

            <div className="view-switcher">
              <button
                className={`view-switcher-button ${viewMode === 'table' ? 'active' : ''}`}
                onClick={() => setViewMode('table')}
              >
                Table View
              </button>
              <button
                className={`view-switcher-button ${viewMode === 'graph' ? 'active' : ''}`}
                onClick={() => setViewMode('graph')}
              >
                Graph View
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export button and menu */}
      {!error && jsonData && (
        <div className="action-buttons">
          <button
            className="export-button"
            onClick={toggleExportMenu}
            title="Export"
          >
            Export ▾
          </button>

          {showExportMenu && (
            <div className="export-menu">
              <div className="export-menu-item" onClick={() => exportAs('json')}>
                Save as JSON
              </div>
              <div className="export-menu-item" onClick={() => exportAs('markdown')}>
                Save as Markdown
              </div>
              <div className="export-menu-item" onClick={() => exportAs('xml')}>
                Save as XML
              </div>
              <div className="export-menu-item" onClick={() => exportAs('html')}>
                Save as HTML
              </div>
              <div className="export-menu-item" onClick={() => exportAs('png')}>
                Save as PNG
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Content (Table or Graph) */}
      {!error && jsonData && (
        <div className="content-view">
          {viewMode === 'table' ? (
            <TableView
              data={jsonData}
              vscodeApi={vscodeApi}
              onUpdateValue={updateYamlValue}
              onUpdateKey={updateYamlKey}
              isSaving={isSaving}
              saveError={saveError}
              onHighlightNode={handleHighlightNode}
              selectedNodeId={selectedNodeId}
            />
          ) : (
            <GraphView
              data={jsonData}
              onEditValue={updateYamlValue}
              onUpdateStructure={updateYamlStructure}
              onHighlightNode={handleHighlightNode}
              selectedNodeId={selectedNodeId}
              nodeValidations={nodeValidations}
            />
          )}
        </div>
      )}

      {isSaving && <div className="save-indicator">Saving...</div>}
      {saveError && <div className="error-message">Error: {saveError}</div>}
    </div>
  );
};

// Main component (wrapped with ThemeProvider)
export const YamlPreview: React.FC<YamlPreviewProps> = (props) => {
  return <YamlPreviewInner {...props} />;
};