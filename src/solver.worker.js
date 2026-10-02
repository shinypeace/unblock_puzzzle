import { solve } from "./engine.js";
self.onmessage = ({ data }) => {
  const { id, blocks, state } = data;
  self.postMessage({ id, path: solve(blocks, state) });
};
