import { loadMailBrokerConfig } from './config.js';
import { createMailBroker } from './server.js';

const config = loadMailBrokerConfig(process.env);
const server = createMailBroker(config);
server.listen(config.port, config.bind, () => {
  process.stdout.write(`microsoft mail broker listening on http://${config.bind}:${config.port}\n`);
});
