import { javascript } from "@codemirror/lang-javascript";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";

const typescript = javascript({ typescript: true });

const theme = EditorView.theme({
  "&": { fontSize: "12px", backgroundColor: "transparent" },
  ".cm-content": { fontFamily: "var(--font-mono, ui-monospace, monospace)", padding: "12px 0" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    borderRight: "1px solid var(--border)",
    color: "var(--muted-foreground)",
  },
  "&.cm-focused": { outline: "none" },
});

/** The extension source editor: TypeScript highlighting, line numbers, bracket matching. */
export function CodeEditor({
  value,
  onChange,
  readOnly,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  label: string;
}) {
  return (
    <CodeMirror
      aria-label={label}
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      editable={!readOnly}
      extensions={[typescript, theme, EditorView.lineWrapping]}
      basicSetup={{ foldGutter: false, highlightActiveLine: !readOnly }}
      minHeight="28rem"
    />
  );
}
