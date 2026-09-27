/** Probe (throwaway): useRef type-arg tree shape. */
import { parser } from '@lezer/javascript';
const P = parser.configure({ dialect: 'jsx ts' });
const src = `const streamRef = useRef<QueryStreamLike | null>(null);
const r2 = useRef<number>(0);`;
const tree = P.parse(src);
tree.iterate({
  enter(ref) {
    if (/CallExpression|TypeArgList|VariableName|TypeDefinition|TypeName|ArgList/.test(ref.name)) {
      const text = src.slice(ref.node.from, ref.node.to).replace(/\n/g, ' ').slice(0, 60);
      console.log(`${ref.name} | parent=${ref.node.parent?.name} | ${text}`);
    }
  }
});
