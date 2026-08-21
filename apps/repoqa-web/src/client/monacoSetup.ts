import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

// Configure the react wrapper to use the local monaco-editor package instead
// of loading it from a CDN, and wire the editor worker for Vite.
self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  }
};

loader.config({ monaco });

export { monaco };