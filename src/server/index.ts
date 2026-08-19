import { loadConfig } from "./config.js";
import { createControlServer } from "./server.js";

const config = loadConfig();
const server = createControlServer(config);

server.listen(config.port, config.host, () => {
  console.log(`Herdr Control bridge listening on http://${config.host}:${config.port}`);
});
