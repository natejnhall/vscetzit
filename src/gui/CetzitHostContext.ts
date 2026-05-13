import { createContext } from "preact";
import CetzitHost from "../lib/CetzitHost";

const CetzitHostContext = createContext<CetzitHost>(new CetzitHost());
export default CetzitHostContext;
