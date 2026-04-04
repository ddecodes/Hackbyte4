/**
 * Utility for safe YAML object manipulation (moving/cutting/copying blocks).
 */

/**
 * Removes a block from an object at a given path.
 * Path is an array of strings/indicators like ["services", "app"].
 */
export function removeBlock(obj: any, path: string[]): any {
  if (path.length === 0) return obj;
  
  const newObj = JSON.parse(JSON.stringify(obj)); // Deep clone for safety
  let current = newObj;
  
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i];
    if (current && current[segment] !== undefined) {
      current = current[segment];
    } else {
      return newObj; // Path not found
    }
  }
  
  const lastSegment = path[path.length - 1];
  const removedValue = current[lastSegment];
  delete current[lastSegment];
  
  return { updatedObj: newObj, removedValue };
}

/**
 * Inserts a block into an object at a given path.
 */
export function insertBlock(obj: any, path: string[], value: any): any {
  const newObj = JSON.parse(JSON.stringify(obj));
  let current = newObj;
  
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i];
    if (current[segment] === undefined || typeof current[segment] !== 'object') {
      current[segment] = {};
    }
    current = current[segment];
  }
  
  const lastSegment = path[path.length - 1];
  current[lastSegment] = value;
  
  return newObj;
}

/**
 * Moves a block from source path to destination path.
 */
export function moveBlock(obj: any, sourcePath: string[], destPath: string[]): any {
  const { updatedObj, removedValue } = removeBlock(obj, sourcePath);
  if (removedValue === undefined) return obj;
  
  return insertBlock(updatedObj, destPath, removedValue);
}

/**
 * Normalizes a React Flow ID back into a path array if needed.
 */
export function idToPath(id: string): string[] {
  if (id === 'root') return [];
  return id.split('.');
}
