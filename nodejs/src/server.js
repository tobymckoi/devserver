"use strict";

// The starting point for the server.
//
// This loads the configuration file and sets up the system as
// configured. This runs an https server on port 2500 that gives
// access to build logs and unit testing output. We monitor the git
// repositories specified in a configuration file. When an update is
// successfully pulled, the docker image is built and pushed to the
// docker registry.
//
// The configuration file is expected to be found at
// '/var/lib/devserver/config.js'. If it's not found there then
// the service terminates.
//
// '/var/lib/devserver/repos/' is used as the git repository
// destinations.
//
// The configuration file at /var/lib/devserver/config.js should
// look something like this;
/*
"use strict";

// Development server configuration

module.exports = {

    // This host name,
    hostname: << FQDN hostname (eg. 'rep.example.com') >>,

    // The port to bind the https web service to,
    port: 2500,

    // Full chain and private key for SSL encryption.
    // (Example uses letsencrypt keys).

    ssl_cert: '/etc/letsencrypt/live/rep.example.com/fullchain.pem',
    ssl_key: '/etc/letsencrypt/live/rep.example.com/privkey.pem',

    // General site password for getting to the site. Doesn't need to
    // be too secure because we can't change the state dangerously with
    // this password. It's only used to protect again general snooping.
    site_user: << General site user name >>,
    site_pass: << General site password >>,

    // Docker registry authentication,
    docker_registry: << Docker registry (eg. 'rep.example.com') >>,
    docker_user: << Registry username >>,
    docker_pass: << Registry password >>,

    // The repositories,
    repositories: [
        {   gitname: << Git repo name >>,
            branch: 'master',
            // Testing fixture,
            test_fixture: 'test_fixture.js',
            // Temporary for testing only,
            build: 'docker',
            docker_tobuild: [ {
                docker_path: '{repo_path}',
                docker_tag: 'rep.example.com/devp/example:latest'
            } ]
        },
    ]
};
*/

// NOTE: The Docker setup described below probably won't work but
//   I'm leaving it here for now.

// Docker Setup
// ------------
// Assuming we have a network 'buildnet' that has a host on it
// called 'registry.local' for accessing the local Docker registry.
// Assuming '/etc/letsencrypt/' in the local filesystem has certs
// for our domain name.
// Assuming 'devserver/' in the local filesystem contains the data
// for the app (including the configuration file).
//
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
const bodyParser = require('body-parser');

// Check required files exist,

const CONFIG_FILE = '/var/lib/devserver/config.js';

const config = {};

const projectBuilder = require('./project_builder.js')(config);
const web_hook_handler = require('./github_webhook.js')(config, projectBuilder);


// Ensure the configuration file exists.
fse.ensureFile(CONFIG_FILE, (err) => {
  if (err) {
    console.error(util.format('ensureFile output: %j', err));
    console.error(util.format("%s not found.", CONFIG_FILE));
    process.exit(-1);
  }
  else {
    // File exists, so load it with a 'require',
    config.cur = require(CONFIG_FILE);
    configStatusUpdate();

    // Watch the config file. When it changes then update 'config'.
    fs.watch(CONFIG_FILE, () => {
      setTimeout( () => {
        delete require.cache[require.resolve(CONFIG_FILE)];
        config.cur = require(CONFIG_FILE);
        configStatusUpdate();
      }, 50);
    });

    pollMonitorProjects();
    startService();

  }
});


// Print out some information about the config we just loaded.

function configStatusUpdate() {
  console.log("LOADED %s", CONFIG_FILE);
  if (config.cur.repositories !== undefined) {
    console.log("  Repositories monitored: %j", config.cur.repositories);
  }
}

// Full pass poll of the projects we are monitoring,

function pollMonitorProjects() {
  // Monitor and build the projects,
  projectBuilder.fullPass();
  // Randomize polls so we don't create resonate spikes in traffic,
  // On average we poll every 5 minutes,
  const poll_timeout = (30000 + (Math.random() * 60000)) * 5;
  setTimeout( () => {
    // Recurse,
    pollMonitorProjects();
  }, poll_timeout );
}




// Start the web service,

let https_server;
const app = express();

function startService() {

  // WebHook route from GitHub,
  app.post('/gh/webhook/ep', web_hook_handler);

  // Define all the HTTP routes,
  app.get('/', (req, res) => {

    const output = util.format("%s says 'Hello!'", config.cur.hostname);

    res.end(output);

  });





  // Put server into a restart loop, this allows certs to renew while staying
  // online.
  function timedRestart() {
    doStartService();
    setTimeout( timedRestart, (24 * 60 * 60 * 1000) );
  }
  timedRestart();

}

function doStartService() {
  // Close current server before restarting a new one,
  if (https_server !== undefined) {
    https_server.once('close', () => {
      console.log("Server CLOSE event");
    });
    https_server.close();
    // Start a new service,
    startHttpsService();
  }
  else {
    // Start a new service,
    startHttpsService();
  }
}

function startHttpsService() {
  // Need timeout here to prevent an fs-extra callback bug.
  setTimeout( () => {
    // NOTE: It's ok to have syncronous access to these files because
    //  it's for configuration.
    const options = {
      cert: fs.readFileSync(config.cur.ssl_cert),
      key: fs.readFileSync(config.cur.ssl_key)
    };

    // Default to port 2500
    let port = 2500;
    if (config.cur.port !== void 0) {
      port = config.cur.port;
    }

    console.log("New https_server created");
    https_server = https.createServer(options, app);
    // Create HTTP server and listen on the port,
    https_server.listen(port, () => {
      console.log('Listening on port %s!', port);
    });
  }, 20);
}
