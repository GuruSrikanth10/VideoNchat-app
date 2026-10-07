// Entry point: `node app.js` (or `npm start`) runs the server.
const { createServer, start } = require("./src/server");

if (require.main === module) start();

module.exports = { createServer, start };
