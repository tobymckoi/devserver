"use strict";

// The starting point for the server.
// This loads the configuration file and sets up the system as
// configured.

// The configuration file is expected to be found at
// '/var/lib/devserver/config.js'. If it's not found there then
// the service terminates.
//
// If this is run within a Docker container then the config would
// typically be mapped there from the file system.
// '/var/lib/devserver/projects/' is used as the git destination.

// Docker Setup
// ------------
// Assuming we have a network 'buildnet' that has a host on it
// called 'registry.local' for accessing the local Docker registry.
// Assuming '/etc/letsencrypt/' in the local filesystem has certs
// for our domain name.
// Assuming 'devserver/' in the local filesystem contains the data
// for the app (including the configuration file).

// The docker container might be setup as follows (assuming we
// have a network 'buildnet' that has a 'registry.local' host
// within it for managing our registry):
/*
    docker run --rm -d -p 2500:2500 \
               --net buildnet \
               -v /etc/letsencrypt:/etc/letsencrypt \
               -v `pwd`/devserver:/var/lib/devserver \
               toby/devserver:latest
*/

const util = require('util');
const fs = require('fs');
const fse = require('fs-extra');
const https = require('https');
const express = require('express');


// Check required files exist,

const CONFIG_FILE = '/var/lib/devserver/config.js';

let config;

fse.ensureFile(CONFIG_FILE, (err) => {
  if (err) {
    console.error(util.format("%s not found.", CONFIG_FILE));
    process.exit(-1);
  }
  else {
    // File exists, so load it with a 'require',
    config = require(CONFIG_FILE);

    startService();

  }
});


// Start the service,

function startService() {
  const app = express();

  // Default to port 2500
  let port = 2500;
  if (config.port !== void 0) {
    port = config.port;
  }

  app.get('/', (req, res) => {

    const output = util.format("%s says 'Hello!'", config.hostname);

    res.end(output);

  });

  // NOTE: It's ok to have syncronous access to these files because
  //  it's for configuration.
  const options = {
    cert: fs.readFileSync(
      '/etc/letsencrypt/live/' + config.hostname + '/fullchain.pem'),
    key: fs.readFileSync(
      '/etc/letsencrypt/live/' + config.hostname + '/privkey.pem')
  };

  https.createServer(options, app).listen(port, () => {
    console.log('Example app listening on port %s!', port);
  });
}
