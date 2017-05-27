"use strict";

const path = require('path');
const util = require('util');
const fs = require('fs');
const fse = require('fs-extra');

const spawn = require('child_process').spawn;

// PENDING: Put this into a 'statics.js' module.
const DEFAULT_REPO_LOCATION = '/var/lib/devserver/repos/';

// Set this to 'true' for 'git merge' command to be skipped. This
// can be useful for debugging the build process.
const DEBUG_NO_MERGE = false;




// Monitors projects in the git repository directory and when the
// remote is updated, builds the Docker image and pushes it to
// the registry.


function projectBuilder(config) {

  // Keeps track of all projects currently build built.
  const current_build_status = {};


  // Ensure the given file name is executable,
  function ensureExec(filename, callback) {
    fs.access(filename, fs.R_OK | fs.X_OK, (err) => {
      if (err) {
        // Check the file exists and can be written to,
        fs.access(filename, fs.F_OK | fs.W_OK, (err) => {
          if (err) {
            callback('Unable to make shell file executable');
          }
          else {
            // Make executable,
            fs.chmod(filename, '755', (err) => {
              if (err) {
                callback('Unable to make shell file executable');
              }
              else {
                callback();
              }
            });
          }
        });
      }
      else {
        // All good!
        callback();
      }
    })
  }


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

  function writeToBuildLog(build) {
    const fargs = [];
    for (let i = 1; i < arguments.length; ++i) {
      fargs[i - 1] = arguments[i];
    }
    pushChunkToBuild(build,
            chunk('stdout', util.format.apply(util.format, fargs)));
  }

  // Execute command on the local OS.
  function execOnLocalOptions(build, cl_exec, args, options, callback) {
    let called_cb = false;
    // Output commands to build log,
    const resolved_path = path.resolve(options.cwd);
    writeToBuildLog(build,
        "%s> %s %s\n", resolved_path, cl_exec, JSON.stringify(args));
    try {
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
    catch (e) {
      writeToBuildLog(build, "   javascript exception.\n");
      writeToBuildLog(build, "   %j\n", e);
      console.error(e);
      callback(e);
    }
  }

  function execOnLocal(build, pwd, cl_exec, args, callback) {
    const options = {
      cwd: pwd,
      env: process.env
    };
    execOnLocalOptions(build, cl_exec, args, options, callback);
  }

  // Execute command and capture output of stdout to returned 'result'
  // string.
  //   callback => (err, return_code, result)

  function execFunction(pwd, cl_exec, args, callback) {

    const options = {
      cwd: pwd,
      env: process.env,
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

    console.log("$$$ Build Success START: %s", repo_path);
    const chunks = build.out_chunks;
    chunks.forEach( (chunk) => {
      process[chunk.type].write(chunk.data);
    });
    console.log("$$$ Build Success END: %s", repo_path);

    callback();

  }


  function fileBuildFailure(repo_path, build, callback) {

    console.log("BUILD FAILED START: %s", repo_path);
    const chunks = build.out_chunks;
    chunks.forEach( (chunk) => {
      process[chunk.type].write(chunk.data);
    });
    console.log("BUILD FAILED END: %s", repo_path);

    callback();

  }


  function callCallbackOn(callbacks) {
    const nargs = [];
    for (let i = 1; i < arguments.length; ++i) {
      nargs[i - 1] = arguments[i];
    }
    callbacks.forEach( (callback) => {
      callback.apply(callback, nargs);
    });
  }

  function handleBuildFail(build, repo_path, callback) {
    // File that the build failed,
    fileBuildFailure(repo_path, build, (err) => {
      build.in_progress = false;
      delete current_build_status[repo_path];

      // If the 'fileBuildFailure' function produces an error then
      // report it to console.error
      if (err) {
        console.error(err);
      }

      callback();
    });
  }



  // Replaces inline variables in the string. For example, the
  // value of '{repo_path}/nodejs' would get fully qualified.
  function substituteInline(value, substitutes) {
    if (typeof value === 'string') {
      for (let key in substitutes) {
        const subst_to_replace = '{' + key + '}';
        value = value.replace(subst_to_replace, substitutes[key]);
      }
    }
    return value;
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

  function buildProject(cur_config, repo_path, repo_ob, callback) {

    const project_branch = repo_ob.branch;

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

      // Fetch from remote and determine if current base is different
      // than the remote.
      gitFetchAndDifCheck(current_build, repo_path, project_branch, (err, different) => {
        if (err) {
          handleBuildFail(current_build, repo_path, () => {
            callCallbackOn(current_build.callbacks, err);
          });
        }
        else if (different) {
          // Different, so checkout to new version,
          writeToBuildLog(current_build, 'Differences on Git Remote.\n');

          // Run 'checkout' then 'merge'
          gitCheckoutAndMerge(current_build, repo_path, project_branch, (err) => {
            if (err) {
              handleBuildFail(current_build, repo_path, () => {
                callCallbackOn(current_build.callbacks, err);
              });
            }
            else {

              // Go do the build commands for this project,
              runBuildScript(cur_config, current_build, repo_path, repo_ob);

            }
          });

        }
        else {
          // No differences,
          writeToBuildLog(current_build, 'No Differences.\n');
          fileBuildSuccess(repo_path, current_build, () => {
            current_build.in_progress = false;
            delete current_build_status[repo_path];
            callCallbackOn(current_build.callbacks, undefined,
                     util.format("BUILD COMPLETE:%s", (new Date()).getTime()));
          });
        }
      });


    }

  }


  // Perform build commands on the given repository. The build process
  // varies depending on the project configuration.

  function runBuildScript(cur_config, current_build, repo_path, repo_ob) {

    // What's the build type?
    const build_type = repo_ob.build;
    if (build_type !== undefined) {

      // Put the config properties into process environment copy,
      const new_env = {};
      for (let key in process.env) {
        new_env[key] = process.env[key];
      }

      const substitutes = {
        repo_path: repo_path
      };

      // Collect the fields necessary to support this build type from
      // the configuration,
      const key_type = build_type + '_';
      for (let key in cur_config) {
        if (key.startsWith(key_type)) {
          new_env[key] = substituteInline(cur_config[key], substitutes);
        }
      }
      for (let key in repo_ob) {
        if (key.startsWith(key_type)) {
          new_env[key] = substituteInline(repo_ob[key], substitutes);
        }
      }
      new_env['repo_path'] = repo_path;

      // The path of the build scripts - './sh/'
      const build_scripts_path = path.join('.', 'sh');

      // The 'spawn' command options,
      const options = {
        cwd: build_scripts_path,
        env: new_env
      };
      // Build shell command - 'docker.sh'
      const build_shell_script = path.join(
                  path.resolve(build_scripts_path), build_type + ".sh");

      // Perform the build operation
      function performBuild(extra_envs, callback) {
        // Ensure the shell script is executable,
        ensureExec(build_shell_script, (err) => {
          if (err) {
            callback(err);
          }
          else {
            const copts = JSON.parse(JSON.stringify(options));
            for (let key in extra_envs) {
              copts.env[key] = substituteInline(extra_envs[key], substitutes);
            }

            // Run the build script,
            execOnLocalOptions(current_build,
                        build_shell_script, [], copts, (err, code) => {

              // If failed,
              if (err) {
                callback(err);
              }
              else if (code !== 0) {
                callback('Excepted return code of 0');
              }
              // Build success!
              else {
                callback();
              }
            });
          }
        });
      }



      const tobuild_list = new_env.docker_tobuild;
      if (tobuild_list !== undefined) {
        let last_failure;
        let has_failure = false;
        let i = 0;
        function dof() {
          if (i >= tobuild_list.length) {
            if (has_failure) {
              handleBuildFail(current_build, repo_path, () => {
                callCallbackOn(current_build.callbacks, last_failure);
              });
            }
            else {
              // File success report,
              fileBuildSuccess(repo_path, current_build, () => {
                current_build.in_progress = false;
                delete current_build_status[repo_path];
                callCallbackOn(current_build.callbacks, undefined,
                         util.format("BUILD COMPLETE:%s", (new Date()).getTime()));
              });
            }
          }
          else {
            const extra_env = tobuild_list[i];
            performBuild( extra_env, (err) => {
              if (err) {
                console.error(err);
                has_failure = true;
                last_failure = err;
              }
              ++i;
              dof();
            });
          }
        }
        dof();
      }
      else {
        performBuild( {}, (err) => {
          if (err) {
            handleBuildFail(current_build, repo_path, () => {
              callCallbackOn(current_build.callbacks, err);
            });
          }
          else {
            // File success report,
            fileBuildSuccess(repo_path, current_build, () => {
              current_build.in_progress = false;
              delete current_build_status[repo_path];
              callCallbackOn(current_build.callbacks, undefined,
                       util.format("BUILD COMPLETE:%s", (new Date()).getTime()));
            });
          }
        });
      }


    }
    else {
      // File success report,
      fileBuildSuccess(repo_path, current_build, () => {
        current_build.in_progress = false;
        delete current_build_status[repo_path];
        callCallbackOn(current_build.callbacks, undefined,
                 util.format("BUILD COMPLETE:%s", (new Date()).getTime()));
      });
    }

  }


  // Spawn a 'git fetch' command on the repo to download latest
  // changes.
  // Then, 'git checkout [branch]'
  //
  // Assumes git will work without providing credentials (they've
  // been stored with 'git config credential.helper store')

  function gitFetchAndDifCheck(build, repo_path, project_branch, callback) {
    execOnLocal(build, repo_path, 'git', [ 'fetch', '--all' ], (err, code) => {
      if (err) {
        callback(err);
      }
      else {

        // Determine if our current base is different than upstream,
        execFunction(repo_path, 'git', [ 'rev-parse', '--branch', project_branch, '@{u}' ],
                        (err, code, result) => {
          if (err) {
            callback(err);
          }
          if (code !== 0) {
            callback('Expected git rev-parse to return exit 0');
          }
          else {
            // Three lines; '--branch', '[latest hash]', '[current hash]'
            const lines = result.split('\n');
            if (lines.length < 3) {
              callback('Unexpected git rev-parse output');
            }
            else {
              const latest_hash = lines[1];
              const current_hash = lines[2];
              console.log("Current: %s, Latest: %s", current_hash, latest_hash);
              let different = (latest_hash !== current_hash);
              callback(undefined, different);
            }
          }
        });

      }
    });
  }



  // Checkout to the project branch, then merge the current state with the
  // new one just fetched. This should only be called when
  // 'gitFetchAndDifCheck' indicates a difference.

  function gitCheckoutAndMerge(build, repo_path, project_branch, callback) {
    execOnLocal(build, repo_path,
            'git', [ 'checkout', project_branch ], (err, code) => {
      if (err) {
        callback(err);
      }
      else if (code !== 0) {
        callback('Return code != 0');
      }
      else if (DEBUG_NO_MERGE) {
        callback();
      }
      else {
        execOnLocal(build, repo_path,
              'git', [ 'merge' ], (err, code) => {
          if (err) {
            callback(err);
          }
          else if (code !== 0) {
            callback('Return code != 0');
          }
          else {
            callback();
          }
        });
      }
    });
  }


  // Scans all the projects. If a project is not currently being built then
  // attempts to build the project.

  function fullPass(callback) {
    const cur_config = config.cur;
    // Scan the list of repositories for the configuration,
    const repos = cur_config.repositories;
    if (repos !== undefined) {

      let repos_path = DEFAULT_REPO_LOCATION;
      if (cur_config.repos_path !== undefined) {
        repos_path = cur_config.repos_path;
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
          repos.forEach( (repo_ob) => {

            const project_git_name = repo_ob.gitname;

            // Form the path,
            const repo_path = path.join(repos_path, project_git_name);

            // Build it,
            buildProject(cur_config, repo_path, repo_ob, (err, status) => {
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
