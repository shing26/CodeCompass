import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// QA-03 (ticket 12): the root `monaco-editor` import eagerly registers the
// TS/JSON/CSS/HTML language contributions, so a .ts file asks for a
// 'typescript'-labelled worker. Serving the EDITOR worker to every label made
// that worker receive `$loadForeignModule('vs/language/typescript/tsWorker')`
// without a static foreign-module factory → it fell into monaco's dynamic
// `import(asBrowserUri(...))` branch, which throws the uncaught
// "Cannot read properties of undefined (reading 'toUrl')" (3× per Inspector
// mount, silent failure: semantic tokens never ran). The official Vite recipe
// distributes by label; each worker is its own lazy chunk (ts.worker is only
// fetched when a TS/JS file is first opened), and the monaco version stays on
// 0.52.x per the maintainer ruling.
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    switch (label) {
      case 'json':
        return new jsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker();
      case 'typescript':
      case 'javascript':
        return new tsWorker();
      default:
        // 'editor' and anything else (e.g. java — no language worker is
        // registered for it, so only the base editor worker is ever asked
        // for).
        return new editorWorker();
    }
  }
};

loader.config({ monaco });

export { monaco };
