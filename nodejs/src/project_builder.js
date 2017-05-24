"use strict";

const path = require('path');
const util = require('util');
const fse = require('fs-extra');

const spawn = require('child_process').spawn;

// PENDING: Put this into a 'statics.js' module.
const DEFAULT_REPO_LOCATION = '/var/lib/devserver/repos/';


function projectBuilder(config) {

  // Keeps track of all projects currently build built.
  const current_build_status = {};



  function chunk(type, data) {
    return { type, data };
  }


  function pushChunkToBuild(build, chunk) {
    // Add chunk to 'out_chunks'
    build.out_chunks.push(chunk);
    // Tell listeners that a chunk has arrived to be processed
    // accordingly.
    if (build.notifiers !== undefined) {
      build.notifiers.forEach( (to_notify) => to_notify(chunk) );
    }
  }

  // Execute command on the local OS.

  function execOnLocal(build, pwd, cl_exec, args, callback) {

    const options = {
      cwd: pwd,
      env: process.env
    };

    let called_cb = false;

    const p = spawn(cl_exec, args, options);
    p.stdout.on('data', (data) => {
      pushChunkToBuild(build, chunk('stdout', data));
    });
    p.stderr.on('data', (data) => {
      pushChunkToBuild(build, chunk('stderr', data));
    });
    p.on('close', (code) => {
      if (!called_cb) {
        called_cb = true;
        callback(undefined, code);
      }
    });
    p.on('error', (err) => {
      if (!called_cb) {
        called_cb = true;
        callback(err);
      }
    });

  }

  // Execute command and capture output of stdout to returned 'result'
  // string.
  //   callback => (err, return_code, result)

  function execFunction(pwd, cl_exec, args, callback) {

    const options = {
      cwd: pwd,
      env: process.env
    };

    let called_cb = false;

    let result = '';

    const p = spawn(cl_exec, args, options);
    p.stdout.on('data', (data) => {
      result += data.toString();
    });
    p.stderr.on('data', (data) => {
      if (!called_cb) {
        called_cb = true;
        callback(data.toString());
      }
    });
    p.on('close', (code) => {
      if (!called_cb) {
        called_cb = true;
        callback(undefined, code, result);
      }
    });
    p.on('error', (err) => {
      if (!called_cb) {
        called_cb = true;
        callback(err);
      }
    });

  }




  function fileBuildSuccess(repo_path, build, callback) {

    console.log("Build Success: %s", repo_path);
    const chunks = build.out_chunks;
    chunks.forEach( (chunk) => {
      process[chunk.type].write(chunk.data);
    });

    callback();

  }


  function fileBuildFailure(repo_path, build, callback) {

    console.log("BUILD FAILED: %s", repo_path);
    const chunks = build.out_chunks;
    chunks.forEach( (chunk) => {
      process[chunk.type].write(chunk.data);
    });

    callback();

  }


  function handleBuildFail(build, repo_path, callback) {
    // File that the build failed,
    fileBuildFailure(repo_path, build, (err) => {
      build.in_progress = false;
      delete current_build_status[repo_path];

      // If the 'fileBuildFailure' function produces an error then
      // report it to console.error
      console.error(err);

      callback();
    });
  }


  // Builds the project from the given 'repo_path'. The 'repo_path'
  // string points to the location of the git repository stored
  // locally.
  //
  // 'callback' has arguments (err, status) where 'status' is either
  // of; "BUILD COMPLETE:[timestamp]", "BUILD FAILED:[timestamp]"
  //
  // If the project is currently being built when this is called
  // then callback is only called when the build is complete.

  function buildProject(repo_path, callback) {

    // Fetch 'current_build'
    let current_build = current_build_status[repo_path];
    if (current_build === undefined) {
      // Construct 'current_build' object,
      current_build = {
        callbacks: []
      };
      current_build_status[repo_path] = current_build;
    }
    // Add callback to be notified when build complete,
    current_build.callbacks.push(callback);

    // If the current build isn't in progress,
    if (current_build.in_progress !== true) {

      // Update 'in_progress' status,
      current_build.in_progress = true;
      current_build.out_chunks = [];

      // Spawn a 'git fetch' command on the repo to download latest
      // changes.
      // Then, 'git checkout [branch]'
      //
      // Assumes git will work without providing credentials (they've
      // been stored with 'git config credential.helper store')

      execOnLocal(current_build, repo_path, 'git', [ 'fetch' ], (err, code) => {
        console.log("%s> git fetch", repo_path);
        if (err) {
          handleBuildFail(current_build, repo_path, () => {
            callback(err);
          });
        }
        else {
          // If changes were made then we rebuild the docker image with;
          //   docker build --tag [docker image tag] .
          //   docker push [docker image tag]

          console.log("Return code: %s", code);
          // File the build success,
          fileBuildSuccess(repo_path, current_build, () => {
            current_build.in_progress = false;
            delete current_build_status[repo_path];
            callback(undefined,
                     util.format("BUILD COMPLETE:%s", (new Date()).getTime()));
          });
        }
      });

    }

  }



  // Scans all the projects. If a project is not currently being built then
  // attempts to build the project.

  function fullPass(callback) {
    // Scan the list of repositories for the configuration,
    const repos = config.cur.repositories;
    if (repos !== undefined) {

      let repos_path = DEFAULT_REPO_LOCATION;
      if (config.cur.repos_path !== undefined) {
        repos_path = config.cur.repos_path;
      }

      const build_result = [];

      // 'fs-extra' bug.
      let first_call = true;

      // The repos are within the /var/lib/devserver/repos/ path.
      fse.ensureDir(repos_path, (err) => {
        if (first_call === true) {
          first_call = false;
          if (err) {
            // Ignore this.
          }
          repos.forEach( (repo) => {

            // Form the path,
            const repo_path = path.join(repos_path, repo);

            // Build it,
            buildProject(repo_path, (err, status) => {
              build_result.push({ repo_path, err, status });
              // All projects built?
              if (build_result.length === repos.length) {
                // Callback when complete,
                if (callback !== undefined) {
                  callback(undefined, build_result);
                }
              }
            });

          });
        }
      });
    }
  }


  // Exported API
  return {
    // Performs a single project monitor pass. This looks at the
    // repositories from the configuration and runs a 'git pull'
    // and 'git checkout [branch]' for each.
    fullPass
  };
}




module.exports = projectBuilder;
