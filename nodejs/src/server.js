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

    // This host name.

    hostname: 'mydev.example.com',


    // Full chain and private key for SSL encryption.
    // (Example uses letsencrypt keys).

    ssl_cert: '/etc/letsencrypt/live/mydev.example.com/fullchain.pem',
    ssl_key: '/etc/letsencrypt/live/mydev.example.com/privkey.pem',


    // The username and password for access to the stats.

    site_user: << Enter User Name >>,
    site_pass: << Enter Password >>,


    // The port to bind the https web service to.
    // Used for administration.

    port: 2500,


    // The repositories. These repositories must be located in the
    // '/var/lib/devserver/repos/' directory. The projects must
    // have been already cloned.

    repositories: [
        {   // Located at /var/lib/devserver/repos/hwserver/
            gitname: 'hwserver',
            branch: 'master',
            dockertag: 'mydev.example.com/toby/hwserver:latest'
        },
        {   // Located at /var/lib/devserver/repos/awesome/
            gitname: 'awesome',
            branch: 'develop',
            dockertag: 'mydev.example.com/toby/awesome:latest'
        }
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


// Check required files exist,

const CONFIG_FILE = '/var/lib/devserver/config.js';

const config = {};

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

// Poll the projects we are monitoring,

function pollMonitorProjects() {
  // Randomize polls so we don't create resonate spikes in traffic,
  // On average we poll every 5 minutes,
  const poll_timeout = (30000 + (Math.random() * 60000)) * 5;
  setTimeout( () => {
    // Monitor the projects,
    monitorProjects();
    // Recurse,
    pollMonitorProjects();
  }, poll_timeout );
}


// Start the projects monitoring,

function monitorProjects() {
  // Scan the list of repositories for the configuration,
  const repos = config.cur.repositories;
  if (repos !== undefined) {
    // The repos are within the /var/lib/devserver/repos/ path.
    fse.ensureDir('/var/lib/devserver/repos/', (err) => {
      if (err) {
        // Ignore this.
      }
      repos.forEach( (repo) => {
        // Form the path,
        const repo_path = '/var/lib/devserver/repos/' + repo;

        // Spawn a 'git pull' command on the repo.
        // Assumes the branch is checked out to the one we are interested
        // in (eg. 'git checkout develop').
        // Assumes git will work without providing credentials (they've
        // been stored with 'git config credential.helper store')

        console.log("Executing git pull on %s", repo_path);

        // If changes were made then we rebuild the docker image with;
        //   docker build --tag [docker image tag] .
        //   docker push [docker image tag]

      });
    });
  }
}






// Start the web service,

let https_server;
const app = express();

function startService() {

  // Define all the HTTP routes,
  app.get('/', (req, res) => {

    const output = util.format("%s says 'Hello!'", config.cur.hostname);

    res.end(output);

  });

  // Put server into a restart loop,
  function timedRestart() {
    doStartService();
    setTimeout( timedRestart, 5000 );
  }
  timedRestart();

}

function doStartService() {
  // Close current server before restarting a new one,
  if (https_server !== undefined) {
    https_server.once('close', () => {
      startHttpsService();
    });
    https_server.close();
  }
  else {
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

    https_server = https.createServer(options, app);
    // Create HTTP server and listen on the port,
    https_server.listen(port, () => {
      console.log('Listening on port %s!', port);
    });
  }, 100);
}
