/** Debug: which link breaks in the ChatView chain? */
import { buildTypeScriptDeclarations, parseTypeScriptSource } from './src/languages/TypeScriptAdapter';

const classSource = `
export class RepoQAClient {
  readonly chat: ChatMergeClient;
  constructor(chat: ChatMergeClient) { this.chat = chat; }
}
export class ChatMergeClient {
  listSessions() { return []; }
  createSession(repoId: string) { return {}; }
  messages(id: string) { return []; }
}
`;
const decls = buildTypeScriptDeclarations([{ relativePath: 'src/client/RepoQAClient.ts', source: classSource }]);
console.log('fields:', JSON.stringify([...decls.fields.entries()]));
console.log('methods:', JSON.stringify([...decls.methods.keys()]));

const consumer = `
export function ChatView(props: { client: RepoQAClient }) {
  const { client } = props;
  const chatClient = client.chat;
  const refresh = useCallback(() => {
    chatClient.listSessions();
    return null;
  }, [chatClient]);
  const open = async (id: string) => {
    await chatClient.messages(id);
    await chatClient.createSession('repo-1');
    return null;
  };
  return refresh;
}
`;
const symbols = parseTypeScriptSource(consumer, 'src/ChatView.tsx', 'repo', {
  languages: { typescript: decls }
});
const view = symbols.find((symbol) => symbol.name === 'ChatView');
for (const call of view?.calls ?? []) {
  console.log(`  ${call.method} receiver=${call.receiver ?? '-'} type=${call.receiverType ?? '-'} dyn=${call.dynamic} ref=${String(call.reference)}`);
}
