'use strict';

const { makeApp } = require('./app');

const PORT = process.env.PORT || 8080;
const { server } = makeApp();

server.listen(PORT, '0.0.0.0', () => {
  console.error(`Tablekeeper Stage 2 listening on 0.0.0.0:${PORT}`);
});
