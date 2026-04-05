import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import * as jsYaml from 'js-yaml';
import { TableView } from './TableView';
import { GraphView, NodeValidationInfo } from './GraphView';
import { YamlDetector, YamlFormat } from '../../utils/yaml-detector';
import { ThemeProvider } from '../utils/themeContext';
import * as yamlOps from '../utils/yamlOperations';
import { transformToLogicalGraph, getValueAtPath, trimValidationSnippet } from '../utils/graphUtils';
import { Mascot } from './Mascot';

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
  // Saving states lifted from TableView
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Highlighted node (from code editor selection)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // --- Gemini Validation State ---
  const [nodeValidations, setNodeValidations] = useState<Record<string, NodeValidationInfo>>({});
  const [isAiValidating, setIsAiValidating] = useState<boolean>(false);
  const [geminiApiKey, setGeminiApiKey] = useState<string>('');
  const [isAiEnabled, setIsAiEnabled] = useState<boolean>(false);
  /** API key + Run Validation popover (toggle can stay on after dismiss). */
  const [showAiConfigForm, setShowAiConfigForm] = useState<boolean>(false);
  const validationRequestIdRef = useRef<number>(0);
  const aiConfigFormShellRef = useRef<HTMLDivElement | null>(null);

  // --- AI parse-error fix (YAML invalid: no graph/table) ---
  const parseFixRequestIdRef = useRef<number>(0);
  const [parseFixLoading, setParseFixLoading] = useState<boolean>(false);
  const [parseFixProposal, setParseFixProposal] = useState<{
    analysis: string;
    changeSummary: string;
    proposedYaml: string;
  } | null>(null);
  const [parseFixError, setParseFixError] = useState<string | null>(null);

  // Initialize API key from local storage
  useEffect(() => {
    const saved = localStorage.getItem('flowjam.geminiApiKey');
    if (saved) setGeminiApiKey(saved);
  }, []);

  const saveApiKey = (key: string) => {
    setGeminiApiKey(key);
    localStorage.setItem('flowjam.geminiApiKey', key);
  };

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

  // Process initial content
  useEffect(() => {
    console.log('Processing initial content...');
    parseYaml(initialContent);
    lastContentRef.current = initialContent;
  }, [initialContent]);

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
          setIsSaving(false);
          setTimeout(() => setCommunicationStatus(null), 2000);
        } else {
          setCommunicationStatus(`Error: ${message.error || 'Failed to save'}`);
          setIsSaving(false);
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
      } else if (message.command === 'graphValidationStart') {
        const rid = Number(message.requestId);
        if (rid === validationRequestIdRef.current) {
          setIsAiValidating(true);
          const ids = message.nodeIds as string[];
          setNodeValidations((prev) => {
            const next = { ...prev };
            for (const id of ids) {
              next[id] = { status: 'pending', message: 'Gemini is reviewing this fragment...' };
            }
            return next;
          });
        }
      } else if (message.command === 'nodeValidation') {
        const rid = Number(message.requestId);
        if (rid === validationRequestIdRef.current) {
          setNodeValidations((prev) => ({
            ...prev,
            [message.nodeId]: { status: message.status, message: message.message },
          }));
        }
      } else if (message.command === 'graphValidationComplete') {
        const rid = Number(message.requestId);
        if (rid === validationRequestIdRef.current) {
          setIsAiValidating(false);
          setCommunicationStatus('AI Validation Complete');
          setTimeout(() => setCommunicationStatus(null), 3000);
        }
      } else if (message.command === 'graphValidationError') {
        const rid = Number(message.requestId);
        if (rid === validationRequestIdRef.current) {
          setIsAiValidating(false);
          const err = String(message.error);
          setCommunicationStatus(`AI Error: ${err}`);
          setNodeValidations({});
          setTimeout(() => setCommunicationStatus(null), 6000);
        }
      } else if (message.command === 'parseErrorFixReady') {
        const rid = Number(message.requestId);
        if (rid === parseFixRequestIdRef.current) {
          setParseFixLoading(false);
          setParseFixError(null);
          setParseFixProposal({
            analysis: String(message.analysis ?? ''),
            changeSummary: String(message.changeSummary ?? ''),
            proposedYaml: String(message.proposedYaml ?? ''),
          });
        }
      } else if (message.command === 'parseErrorFixFailed') {
        const rid = Number(message.requestId);
        if (rid === parseFixRequestIdRef.current) {
          setParseFixLoading(false);
          setParseFixProposal(null);
          setParseFixError(String(message.error ?? 'Unknown error'));
        }
      } else if (message.command === 'applyParseErrorFixCancelled') {
        setCommunicationStatus('Apply cancelled');
        setTimeout(() => setCommunicationStatus(null), 2500);
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

      // OPTIMISTIC UPDATE: Update local state immediately
      setYamlContent(updatedYaml);
      setJsonData(docs);
      lastContentRef.current = updatedYaml;

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

      // OPTIMISTIC UPDATE: Update local state immediately
      setYamlContent(updatedYaml);
      setJsonData(docs);
      lastContentRef.current = updatedYaml;

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

      // OPTIMISTIC UPDATE: Update local state immediately
      setYamlContent(updatedYaml);
      setJsonData(docs);
      lastContentRef.current = updatedYaml;

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

  // Close AI config popover on mousedown outside the form shell (toggle stays on until user turns it off)
  useEffect(() => {
    if (!showAiConfigForm) {
      return;
    }
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (aiConfigFormShellRef.current?.contains(target)) {
        return;
      }
      setShowAiConfigForm(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [showAiConfigForm]);

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

  const handleAiToggle = (enabled: boolean) => {
    if (enabled) {
      setIsAiEnabled(true);
      setShowAiConfigForm(true);
      return;
    }
    const ridToCancel = validationRequestIdRef.current;
    validationRequestIdRef.current += 1;
    setIsAiValidating(false);
    setNodeValidations({});
    setIsAiEnabled(false);
    setShowAiConfigForm(false);
    vscodeApi.postMessage({ command: 'cancelGraphValidation', requestId: ridToCancel });
  };

  const handleRunGraphValidation = () => {
    if (!jsonData || !isAiEnabled) return;
    const rid = ++validationRequestIdRef.current;

    // We only validate the "entity" nodes in the graph view.
    const { nodes } = transformToLogicalGraph(jsonData);
    const payloads = nodes.map((n) => {
      const val = getValueAtPath(jsonData, n.data.path);
      const snippet = trimValidationSnippet(JSON.stringify(val, null, 2));
      return {
        id: n.id,
        label: n.data.label,
        snippet,
      };
    });

    vscodeApi.postMessage({
      command: 'validateGraphNodes',
      requestId: rid,
      apiKey: geminiApiKey,
      nodes: payloads,
    });
  };

  const handleHighlightNode = (path: string[]) => {
    vscodeApi.postMessage({
      command: 'highlightPath',
      path: path
    });
  };

  // Clear AI proposal when parse succeeds
  useEffect(() => {
    if (!error) {
      setParseFixProposal(null);
      setParseFixError(null);
      setParseFixLoading(false);
    }
  }, [error]);

  const handleRequestParseErrorFix = () => {
    if (!error) return;
    const key = geminiApiKey.trim();
    if (!key) {
      setParseFixError('Enter your Gemini API key below first.');
      return;
    }
    const rid = ++parseFixRequestIdRef.current;
    setParseFixLoading(true);
    setParseFixError(null);
    setParseFixProposal(null);
    vscodeApi.postMessage({
      command: 'requestParseErrorFix',
      requestId: rid,
      apiKey: key,
      yamlContent: yamlContent,
      errorText: error,
    });
  };

  const handleApplyParseErrorFix = () => {
    if (!parseFixProposal) return;
    vscodeApi.postMessage({
      command: 'applyParseErrorFix',
      content: parseFixProposal.proposedYaml,
      changeSummary: parseFixProposal.changeSummary,
    });
  };

  const handleDismissParseFix = () => {
    setParseFixProposal(null);
    setParseFixError(null);
  };

  return (
    <div className="yaml-preview-container">
      <Mascot status={(() => {
        if (error) return 'angry';
        const vals = Object.values(nodeValidations);
        if (vals.some(v => v.status === 'error')) return 'angry';
        if (vals.some(v => v.status === 'warning')) return 'serious';
        return 'happy';
      })()} />
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
            height: 25px;
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
            left: 0;
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
            --graph-accent: #A855F7;
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
            --graph-accent: #7C3AED;
          }

          .yaml-format-info {
            display: flex;
            justify-content: space-between;
            align-items: center;
            width: 100%;
            max-width: none;
            box-sizing: border-box;
            margin-bottom: 12px;
            flex-wrap: wrap;
            gap: 8px;
            /* Reserve top-right corner for Mascot (absolute in container; do not change Mascot.tsx) */
            padding-right: 88px;
          }
          .view-switcher {
            display: inline-flex;
            justify-content: flex-start;
            align-items: center;
            background-color: var(--panel-background);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 2px;
            width: fit-content;
            max-width: 100%;
          }
          .ai-toolbar-section {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 0;
            flex-shrink: 0;
          }
          .ai-toolbar-section .ai-toggle-label {
            background-color: var(--panel-background);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 4px 10px;
            opacity: 1;
          }
          .content-view {
            width: 100%;
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

          .ai-menu-container {
            position: relative;
            display: inline-block;
          }

          /* Modern Toggle Switch inside view-switcher */
          .switcher-divider {
            width: 1px;
            background-color: var(--border-color);
            margin: 4px 10px;
            align-self: stretch;
          }
          .ai-toggle-label {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 11px;
            font-weight: 500;
            cursor: pointer;
            user-select: none;
            padding: 0 8px;
            color: var(--text-color);
            opacity: 0.8;
            transition: opacity 0.2s;
          }
          .ai-toggle-label:hover { opacity: 1; }
          .switch {
            position: relative;
            display: inline-block;
            width: 30px;
            height: 16px;
          }
          .switch input {
            opacity: 0;
            width: 0;
            height: 0;
          }
          .slider {
            position: absolute;
            cursor: pointer;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: var(--border-color);
            transition: .4s;
            border-radius: 34px;
          }
          .slider:before {
            position: absolute;
            content: "";
            height: 12px;
            width: 12px;
            left: 2px;
            bottom: 2px;
            background-color: white;
            transition: .4s;
            border-radius: 50%;
          }
          input:checked + .slider {
            background-color: #6366f1;
          }
          input:checked + .slider:before {
            transform: translateX(14px);
          }

          .ai-config-form {
            position: absolute;
            top: calc(100% + 10px);
            right: 0;
            background-color: var(--panel-background);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 15px;
            width: 280px;
            box-shadow: 0 4px 20px var(--shadow-color);
            z-index: 150;
            display: flex;
            flex-direction: column;
            gap: 12px;
            animation: slideInDown 0.2s ease;
          }
          .ai-config-form-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 10px;
          }
          .ai-config-form-header h4 {
            margin: 0;
          }
          .ai-config-close-btn {
            flex-shrink: 0;
            border: none;
            background: transparent;
            color: var(--text-color);
            font-size: 20px;
            line-height: 1;
            cursor: pointer;
            padding: 0 2px;
            margin: -4px 0 0;
            opacity: 0.65;
            border-radius: 4px;
          }
          .ai-config-close-btn:hover {
            opacity: 1;
            background: var(--format-background);
          }
          @keyframes slideInDown {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .ai-config-form h4 {
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 6px;
            color: var(--text-color);
          }
          .ai-config-form p {
            margin: 0;
            font-size: 11px;
            opacity: 0.7;
            line-height: 1.4;
          }
          .ai-config-input {
            background: var(--background-color);
            color: var(--text-color);
            border: 1px solid var(--border-color);
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            outline: none;
          }
          .ai-config-input:focus {
            border-color: #6366f1;
          }
          .ai-form-actions {
            display: flex;
            gap: 8px;
          }
          .ai-run-btn {
            flex: 1;
            background-color: #6366f1;
            color: white;
            border: none;
            padding: 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: bold;
            cursor: pointer;
          }
          .ai-run-btn:hover { background-color: #4f46e5; }
          .ai-run-btn:disabled { opacity: 0.5; }
          .parse-error-ai-panel {
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px solid var(--border-color, rgba(128,128,128,0.35));
          }
          .parse-error-ai-panel h4 {
            margin: 0 0 8px 0;
            font-size: 13px;
            font-weight: 600;
          }
          .parse-error-ai-panel .hint {
            font-size: 11px;
            opacity: 0.85;
            margin: 0 0 8px 0;
            line-height: 1.4;
          }
          .parse-error-ai-row {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            align-items: center;
            margin-bottom: 8px;
          }
          .parse-error-ai-key {
            flex: 1;
            min-width: 180px;
            background: var(--background-color);
            color: var(--text-color);
            border: 1px solid var(--border-color);
            padding: 8px 10px;
            border-radius: 4px;
            font-size: 12px;
          }
          .parse-error-ai-btn {
            background: #6366f1;
            color: white;
            border: none;
            padding: 8px 14px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            font-family: var(--vscode-editor-font-family);
          }
          .parse-error-ai-btn:hover:not(:disabled) { background: #4f46e5; }
          .parse-error-ai-btn:disabled { opacity: 0.55; cursor: not-allowed; }
          .parse-fix-proposal {
            margin-top: 10px;
            padding: 10px;
            background: var(--info-background, rgba(99,102,241,0.08));
            border-radius: 6px;
            font-size: 12px;
            line-height: 1.45;
          }
          .parse-fix-proposal pre {
            margin: 8px 0 0 0;
            max-height: 140px;
            overflow: auto;
            white-space: pre-wrap;
            word-break: break-word;
            font-size: 11px;
            opacity: 0.95;
          }
          .parse-fix-actions {
            display: flex;
            gap: 8px;
            margin-top: 10px;
            flex-wrap: wrap;
          }
          .parse-fix-apply {
            background: #059669;
            color: white;
            border: none;
            padding: 8px 14px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
          }
          .parse-fix-apply:hover { background: #047857; }
          .parse-fix-dismiss {
            background: transparent;
            color: var(--text-color);
            border: 1px solid var(--border-color);
            padding: 8px 14px;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
          }
        `}
      </style>

      {error && (
        <div className="error-message">
          <p>YAML parsing error:</p>
          <pre>{error}</pre>
          <div className="parse-error-ai-panel">
            <h4>AI agent (Gemini)</h4>
            <p className="hint">
              Use your own API key (same as graph validation). The agent analyzes this error and proposes a fix.
              Applying runs a second confirmation in VS Code so you can validate before the file changes.
            </p>
            <div className="parse-error-ai-row">
              <input
                className="parse-error-ai-key"
                type="password"
                placeholder="Gemini API key"
                value={geminiApiKey}
                onChange={(e) => saveApiKey(e.target.value)}
                aria-label="Gemini API key for parse fix"
              />
              <button
                type="button"
                className="parse-error-ai-btn"
                disabled={parseFixLoading}
                onClick={handleRequestParseErrorFix}
              >
                {parseFixLoading ? 'Analyzing…' : 'Propose fix with AI'}
              </button>
            </div>
            {parseFixError && (
              <p style={{ margin: '8px 0 0', fontSize: 12, opacity: 0.95 }}>{parseFixError}</p>
            )}
            {parseFixProposal && (
              <div className="parse-fix-proposal">
                <strong>Analysis</strong>
                <p style={{ margin: '6px 0 0' }}>{parseFixProposal.analysis}</p>
                <strong style={{ display: 'block', marginTop: 10 }}>Planned changes (review before applying)</strong>
                <pre>{parseFixProposal.changeSummary}</pre>
                <strong style={{ display: 'block', marginTop: 10 }}>Proposed file preview (truncated)</strong>
                <pre>
                  {parseFixProposal.proposedYaml.length > 1200
                    ? `${parseFixProposal.proposedYaml.slice(0, 1200)}…`
                    : parseFixProposal.proposedYaml}
                </pre>
                <div className="parse-fix-actions">
                  <button type="button" className="parse-fix-apply" onClick={handleApplyParseErrorFix}>
                    Apply proposed fix…
                  </button>
                  <button type="button" className="parse-fix-dismiss" onClick={handleDismissParseFix}>
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {communicationStatus && (
        <div className={`communication-status ${communicationStatus.includes('Error') ? 'error' : 'success'}`}>
          {communicationStatus}
        </div>
      )}

      {/* Panel toolbar: view switcher (left) + AI controls (right), same row */}
      {!error && jsonData && (
        <div className="yaml-format-info">
          <div className="view-switcher">
            <div className="view-switcher-left" style={{ display: 'flex' }}>
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
          <div className="ai-toolbar-section">
            <label className="ai-toggle-label">
              <div className="switch">
                <input
                  type="checkbox"
                  checked={isAiEnabled}
                  onChange={(e) => handleAiToggle(e.target.checked)}
                />
                <span className="slider"></span>
              </div>
              <span> AI </span>
            </label>
            {isAiEnabled && showAiConfigForm && (
              <div
                ref={aiConfigFormShellRef}
                className="ai-menu-container ai-config-form-shell"
              >
                <div className="ai-config-form">
                  <div className="ai-config-form-header">
                    <h4>✨ Gemini Validation</h4>
                    <button
                      type="button"
                      className="ai-config-close-btn"
                      aria-label="Close"
                      onClick={() => setShowAiConfigForm(false)}
                    >
                      ×
                    </button>
                  </div>
                  <p>Paste your API key below to enable intelligent graph validation.</p>
                  <input
                    className="ai-config-input"
                    type="password"
                    placeholder="Gemini API Key..."
                    value={geminiApiKey}
                    onChange={(e) => saveApiKey(e.target.value)}
                  />
                  <div className="ai-form-actions">
                    <button
                      className="ai-run-btn"
                      onClick={handleRunGraphValidation}
                      disabled={isAiValidating}
                    >
                      {isAiValidating ? '✨ Validating...' : '✨ Run Validation'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Export Tool */}
      <div className="action-buttons">

        <div className="export-menu-container">
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
      </div>

      {/* JSON display or table display */}
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