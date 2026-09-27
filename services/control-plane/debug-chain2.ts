/** Debug 2: isolate the links. */
import {
  buildTypeScriptDeclarations,
  parseTypeScriptSource
} from './src/languages/TypeScriptAdapter';

const classSource = `
export class RepoQAClient {
  readonly chat: ChatMergeClient;
  constructor(chat: ChatMergeClient) { this.chat = chat; }
}
export class ChatMergeClient {
  listSessions(): string[] { return []; }
}
`;
const decls = buildTypeScriptDeclarations([{ relativePath: 'src/client/RepoQAClient.ts', source: classSource }]);
console.log('fields:', JSON.stringify([...decls.fields.entries()]));
console.log('methods:', JSON.stringify([...decls.methods.keys()]));
const ctx = { languages: { typescript: decls } };

function show(label: string, src: string): void {
  const symbols = parseTypeScriptSource(src, 'src/f.ts', 'repo', ctx);
  const f = symbols.find((symbol) => symbol.name === 'f');
  console.log(`\n${label}:`);
  for (const call of f?.calls ?? []) {
    console.log(`  ${call.method} recv=${call.receiver ?? '-'} type=${call.receiverType ?? '-'} dyn=${call.dynamic} ref=${String(call.reference ?? false)}`);
  }
}

// link 1: inline-literal param, direct member call
show('props.client.listSessions()', `export function f(props: { client: RepoQAClient }) { props.client.listSessions(); }`);
// link 2: destructure from typed variable
show('const { client } = props; client.listSessions()', `export function f(props: { client: RepoQAClient }) { const { client } = props; client.listSessions(); }`);
// link 3: member-access initializer
show('const chatClient = client.chat; chatClient.listSessions()', `export function f(props: { client: RepoQAClient }) { const chatClient = client.chat; chatClient.listSessions(); }`);
