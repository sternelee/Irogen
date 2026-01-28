import { render } from "solid-js/web";
import VConsole from "vconsole";
import App from "./App";
import "./index.css";

new VConsole();

render(() => <App />, document.getElementById("app") as HTMLElement);
