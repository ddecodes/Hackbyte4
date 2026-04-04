import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { YamlPreview } from './components/YamlPreview';
import { ThemeProvider } from './utils/themeContext';
import './utils/themeStyles.css';


if (typeof globalThis.process === 'undefined') {
  (globalThis as any).process = {
    env: {},
    browser: true,

    nextTick: (cb: Function, ...args: any[]) => {
      setTimeout(() => cb(...args), 0);
    }
  };
}


console.log('Webview script loaded');


declare global {
  interface Window {
    initialData: {
      yamlContent: string;
    };
    acquireVsCodeApi: () => {
      postMessage: (message: any) => void;
      getState: () => any;
      setState: (state: any) => void;
    };
  }
}


function notifyReady(vscode: any) {
  setTimeout(() => {
    try {
      console.log('Sending ready message to extension');
      vscode.postMessage({ command: 'ready' });
    } catch (e) {
      console.error('Failed to send ready message:', e);
    }
  }, 500);
}


document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM fully loaded, initializing app');
  initializeApp();
});


if (document.readyState === 'loading') {
  console.log('Document is still loading, waiting for DOMContentLoaded');
} else {
  console.log('Document already loaded, initializing immediately');
  initializeApp();
}


function initializeApp() {

  try {

    console.log('Initial data:', typeof window.initialData !== 'undefined' ? 'Available' : 'Not available');
    console.log('VS Code API:', typeof window.acquireVsCodeApi === 'function' ? 'Available' : 'Not available');


    if (typeof window.initialData === 'undefined') {
      console.error('initialData is not defined');
      document.getElementById('root')!.innerHTML = '<div class="error-message">Data not found</div>';
      return;
    }

    if (typeof window.acquireVsCodeApi !== 'function') {
      console.error('acquireVsCodeApi is not available');
      document.getElementById('root')!.innerHTML = '<div class="error-message">VSCode API not available</div>';
      return;
    }

    try {

      const vscode = window.acquireVsCodeApi();
      console.log('VS Code API acquired');


      const rootElement = document.getElementById('root');
      if (!rootElement) {
        console.error('Root element not found');
        return;
      }

      console.log('Root element found, rendering React component');


      ReactDOM.render(
        <React.StrictMode>
          <ThemeProvider>
            <YamlPreview
              initialContent={window.initialData.yamlContent}
              vscodeApi={vscode}
            />
          </ThemeProvider>
        </React.StrictMode>,
        rootElement
      );
      console.log('React component rendered');


      notifyReady(vscode);


      window.addEventListener('message', event => {
        const message = event.data;
        console.log('Received message in webview:', message);

        if (message.command === 'updateContent') {
          console.log('Updating YAML content via custom event');
          const customEvent = new CustomEvent('yaml-content-update', {
            detail: { content: message.content }
          });
          window.dispatchEvent(customEvent);
        }
      });
    } catch (error) {
      console.error('Error initializing webview:', error);
      document.getElementById('root')!.innerHTML = `<div class="error-message">初期化エラー: ${error}</div>`;
    }
  } catch (outerError) {
    console.error('Critical error during initialization:', outerError);
    try {
      document.getElementById('root')!.innerHTML = `
        <div class="error-message">
            <h3>Something went wrong</h3>
            <p>${outerError}</p>
            <p>Please check the browser console for more details.</p>
        </div>
      `;
    } catch (e) {

      document.body.innerHTML = `<div style="color:red; padding: 20px;">Critical error: ${outerError}</div>`;
    }
  }
} 