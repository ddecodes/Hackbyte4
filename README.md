# Flowjam

Flowjam is a VS Code extension that provides a visual playground for YAML configurations. It transforms static YAML files into interactive graphs and tables, helping you understand and debug complex structures with ease.

## Key Features

- **Bi-directional Sync**: Real-time updates between the visual canvas and YAML code
- **Table & Graph Views**: Seamlessly switch between structured table editing and structural graph visualization
- **AI-Powered Validation**: Intelligent logic checks using Gemini AI (e.g., Kubernetes Service-to-Deployment mapping)
- **AI Syntax Repair**: One-click "AI Propose Fix" for YAML parsing errors
- **Logical Resource Linking**: Automatic detection and drawing of relationships (like selectors and matchLabels)
- **Flexible Exporting**: Support for JSON, Markdown, XML, HTML, and PNG formats
- **Interactive Mascot**: A status-aware AI mascot that reacts to the health of your YAML (Happy / Serious / Angry)
- **Theme Support**: Full integration with VS Code's Light and Dark themes


## Tech Stack & Why

- **React & React Flow**: Used for the core visualization. React Flow provides a powerful, performant way to render nodes and edges with built-in zoom/drag functionality.
- **Dagre**: Handles the automatic layout of the graph, ensuring that nodes are placed logically without manual intervention.
- **js-yaml & yaml**: Robust parsing libraries to convert YAML content into JSON for visualization and vice-versa for editing.
- **Gemini AI**: Integrated for intelligent graph validation and parsing error fixes, providing automated suggestions for fixing broken YAML.
- **Webpack & TypeScript**: Standard tooling for building a fast, type-safe VS Code extension.


## Setup Instructions

1.  **Clone the repository** and open the folder in VS Code.
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Start the compiler**:
    ```bash
    npm run watch
    ```

## How to Test

1.  Press **F5** in VS Code to launch a new "Extension Development Host" window.
2.  In the new window, open any folder or create a new YAML file (e.g., `test.yaml`).
3.  **Right-click** anywhere in the YAML editor and select **"Show YAML Preview"**.
4.  Toggle between **Table View** and **Graph View** using the switcher.
5.  (Optional) Enable the **AI** toggle and paste a Gemini API key to run intelligent validations.

## Sample YAML for Testing

Copy and paste this into a file named `sample.yaml` to see the graph visualization in action:

```yaml
---
# Kubernetes Deployment & Service Example
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web-server
  template:
    metadata:
      labels:
        app: web-server
    spec:
      containers:
      - name: nginx
        image: nginx:1.24.0
        ports:
        - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: web-service
spec:
  selector:
    app: web-server
  ports:
  - protocol: TCP
    port: 80
    targetPort: 80
  type: LoadBalancer
```

## Feedback & Contributions

We welcome issues, feature requests, and pull requests!