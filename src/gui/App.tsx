// Main entry point for the browser version of TikZiT

import { useContext, useEffect, useState } from "preact/hooks";
import CodeEditor from "./CodeEditor";
import Splitpane from "./Splitpane";
import FigureEditor, { FigureEditorContent } from "./FigureEditor";
import CetzitHostContext from "./CetzitHostContext";
import { CetzitBrowserHost } from "./CetzitBrowserHost";

interface AppProps {
  initialContent: FigureEditorContent;
}

const App = ({ initialContent }: AppProps) => {
  const [code, setCode] = useState<string>(initialContent.document);
  const [initialCode, setInitialCode] = useState<string>(initialContent.document);
  const host = useContext(CetzitHostContext) as CetzitBrowserHost;

  const resetCode = (newCode: string) => {
    setInitialCode(newCode);
    setCode(newCode);
  };

  useEffect(() => {
    host.onUpdateFromGui(source => {
      resetCode(source);
    });
  }, [host, resetCode]);

  const handleCodeChange = (newCode: string) => {
    setCode(newCode);
    host.updateToGui(newCode);
  };

  return (
    <Splitpane splitRatio={0.7} orientation="vertical">
      <FigureEditor initialContent={initialContent} />
      <CodeEditor value={initialCode} onChange={handleCodeChange} />
    </Splitpane>
  );
};

export default App;
