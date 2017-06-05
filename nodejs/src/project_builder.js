"use strict";

const path = require('path');
const util = require('util');
const fs = require('fs');
const fse = require('fs-extra');

const spawn = require('child_process').spawn;

const STATICS = require('./statics.js');

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



  function writeChunksToFile(output_file, repo_path, build, callback) {
    const out_path = path.dirname(output_file);
    let cb_called = false;
    fse.ensureDir(out_path, (err) => {
      if (err) {
        // Ignore,
        console.error(err);
      }
      const chunks = build.out_chunks;
      try {
        const logstream = fs.createWriteStream(output_file);
        logstream.on('drain', pushChunks);
        logstream.on('error', (err) => {
          if (!cb_called) {
            cb_called = true;
            callback(err);
          }
        });
        let i = 0;
        function pushChunks() {
          let write_more = true;
          // Write chunks until we reach the end,
          while (i < chunks.length && write_more) {
            write_more = logstream.write(chunks[i].data);
            ++i;
          }
          if (i >= chunks.length) {
            logstream.end();
            if (!cb_called) {
              cb_called = true;
              callback();
            }
          }
        }
        // Start pushing chunks to the file,
        pushChunks();
      }
      catch (e) {
        callback(e);
      }
    });
  }


  // Returns a build object which is used to keep track of a build
  // in progress. Only one build object should be active during the
  // time in which a build is happening.

  function createBuildObject(repo_ob) {
    const repo_key = repo_ob.branch + '.' + repo_ob.project_git_name;
    // Fetch 'current_build'
    let current_build = current_build_status[repo_key];
    if (current_build === undefined) {
      // Construct 'current_build' object,
      current_build = {
        callbacks: []
      };
      current_build_status[repo_key] = current_build;
    }
    return current_build;
  }

  function clearBuildObject(repo_ob) {
    const repo_key = repo_ob.branch + '.' + repo_ob.project_git_name;
    delete current_build_status[repo_key];
  }


  function getReportDestination(update_type, gitname, branch) {
    if (update_type === 'build') {
      return STATICS.toBuildReportPath(gitname, branch);
    }
    else if (update_type === 'test') {
      return STATICS.toTestReportPath(gitname, branch);
    }
    else {
      throw Error("Unknown update type");
    }
  }


  function fileBuildSuccess(repo_path, build, repo_ob, callback) {
    const report_path = getReportDestination(
              build.update_type, repo_ob.gitname, repo_ob.branch);
    writeChunksToFile(report_path, repo_path, build, callback);
  }


  function fileBuildFailure(repo_path, build, repo_ob, callback) {
    const report_path = getReportDestination(
              build.update_type, repo_ob.gitname, repo_ob.branch);
    writeChunksToFile(report_path, repo_path, build, callback);
  }


  // function callCallbackOn(callbacks) {
  //   const nargs = [];
  //   for (let i = 1; i < arguments.length; ++i) {
  //     nargs[i - 1] = arguments[i];
  //   }
  //   callbacks.forEach( (callback) => {
  //     callback.apply(callback, nargs);
  //   });
  // }

  function handleBuildFail(build, repo_path, repo_ob, callback) {
    // File that the build failed,
    fileBuildFailure(repo_path, build, repo_ob, (err) => {
      clearBuildObject(repo_ob);

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

  function buildProject(cur_config, current_build, repo_path, repo_ob, callback) {

    const project_branch = repo_ob.branch;

    // Update 'in_progress' status,
    current_build.out_chunks = [];

    // Fetch from remote and determine if current base is different
    // than the remote.
    gitFetchAndDifCheck(current_build, repo_path, project_branch, (err, different) => {
      if (err) {
        writeToBuildLog(current_build, 'Error during git fetch.\n');
        writeToBuildLog(current_build, '%s\n', err);
        handleBuildFail(current_build, repo_path, repo_ob, () => {
          callback(err);
        });
      }
      else if (different) {
        // Different, so checkout to new version,
        writeToBuildLog(current_build, 'Differences on Git Remote.\n');

        // Run 'checkout' then 'merge'
        gitCheckoutAndMerge(current_build, repo_path, project_branch, (err) => {
          if (err) {
            writeToBuildLog(current_build, 'Error during git checkout and merge.\n');
            writeToBuildLog(current_build, '%s\n', err);
            handleBuildFail(current_build, repo_path, repo_ob, () => {
              callback(err);
            });
          }
          else {

            // Go do the build commands for this project,
            runBuildScript(cur_config, current_build, repo_path, repo_ob, callback);

          }
        });

      }
      else {
        // No differences,
        writeToBuildLog(current_build, 'No Differences.\n');
        clearBuildObject(repo_ob);
        callback(undefined,
            util.format("BUILD COMPLETE:%s", (new Date()).getTime()));
      }
    });


  }


  // Perform build commands on the given repository. The build process
  // varies depending on the project configuration.

  function runBuildScript(cur_config, current_build, repo_path, repo_ob, callback) {

    console.log("Building: %s", repo_path);

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
              console.log("Build failed.");
              writeToBuildLog(current_build, 'Error during project build.\n');
              writeToBuildLog(current_build, '%s\n', last_failure);
              handleBuildFail(current_build, repo_path, repo_ob, () => {
                callback(last_failure);
              });
            }
            else {
              // File success report,
              fileBuildSuccess(repo_path, current_build, repo_ob, () => {
                console.log("Build complete.");
                clearBuildObject(repo_ob);
                callback(undefined,
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
            console.log("Build failed.");
            writeToBuildLog(current_build, 'Error during project build.\n');
            writeToBuildLog(current_build, '%s\n', err);
            handleBuildFail(current_build, repo_path, repo_ob, () => {
              callback(err);
            });
          }
          else {
            // File success report,
            fileBuildSuccess(repo_path, current_build, repo_ob, () => {
              console.log("Build complete.");
              clearBuildObject(repo_ob);
              callback(undefined,
                      util.format("BUILD COMPLETE:%s", (new Date()).getTime()));
            });
          }
        });
      }

    }
    else {
      // No build type,
      // File success report,
      clearBuildObject(repo_ob);
      callback(undefined,
              util.format("BUILD COMPLETE:%s", (new Date()).getTime()));
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
//              console.log("Current: %s, Latest: %s", current_hash, latest_hash);
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




  // Tests the project from the given 'repo_path'. The 'repo_path'
  // string points to the location of the git repository stored
  // locally.
  //
  // 'callback' has arguments (err, status) where 'status' is either
  // of; "TEST COMPLETE:[timestamp]", "TEST FAILED:[timestamp]"

  function testProject(cur_config, current_build, repo_path, repo_ob, callback) {

    const project_branch = repo_ob.branch;

    current_build.out_chunks = [];

    // Run 'checkout' then 'merge' to ensure we are on the correct
    // branch to test.
    gitCheckoutAndMerge(current_build, repo_path, project_branch, (err) => {
      if (err) {
        writeToBuildLog(current_build, 'Error during git checkout and merge.\n');
        writeToBuildLog(current_build, '%s\n', err);
        handleBuildFail(current_build, repo_path, repo_ob, () => {
          callback(err);
        });
      }
      else {

        // Go do the test commands for this project,
        runTestScript(cur_config, current_build, repo_path, repo_ob, callback);

      }
    });

  }


  // Runs the test script(s) for the given repository and branch,
  function runTestScript(cur_config, current_build, repo_path, repo_ob, callback) {

    console.log("     Testing: %s", repo_path);

    const project_branch = repo_ob.branch;

    // Run the list of test fixtures and write the test result
    // to the build log.



    clearBuildObject(repo_ob);
    callback(undefined,
            util.format("TEST COMPLETE:%s", (new Date()).getTime()));

  }



  const current_git_builds = {};

  function internalUpdateGitProject(cur_config, build_info) {

    // Exit early if no listeners waiting to be notified,
    if (build_info.waiting.length === 0) {
      return;
    }

    console.log("Update git project: %s", build_info.git_name);

    // Scan the list of repositories for the configuration,
    const repos = cur_config.repositories;

    const build_result = [];

    if (repos !== undefined) {

      // The base path of the git projects,
      let repos_path = STATICS.DEFAULT_REPO_LOCATION;
      if (cur_config.repos_path !== undefined) {
        repos_path = cur_config.repos_path;
      }

      // 'fs-extra' bug.
      let first_call = true;

      // The repos are within the /var/lib/devserver/repos/ path.
      fse.ensureDir(repos_path, (err) => {
        if (first_call === true) {
          first_call = false;
          if (err) {
            // Ignore this.
          }

          const referenced_projects = [];

          // Discover all 'repo_ob' entries that reference this git
          // name.

          repos.forEach( (repo_ob) => {
            if (repo_ob.gitname === build_info.git_name) {
              referenced_projects.push(repo_ob);
            }
          });

          let i = 0;
          function bproj() {
            if (i >= referenced_projects.length) {
              // All projects built?
              // Callback on oldest first,
              const waiting_ob = build_info.waiting.shift();
              const callback = waiting_ob.callback;
              if (waiting_ob !== undefined) {
                // NOTE: Important the callback is behind a 'setImmediate'
                //   because callback might change build_info.
                //
                // callback(undefined, build_result)
                setImmediate(callback, undefined, build_result);
              }
              console.log("Completed update (%s) git project: %s",
                              waiting_ob.update_type, build_info.git_name);
              // Recurse to see if we need to rebuild because a request
              // happened while we were building,
              internalUpdateGitProject(cur_config, build_info);
            }
            else {
              const repo_ob = referenced_projects[i];
              const project_git_name = repo_ob.gitname;
              // Form the path,
              const repo_path = path.join(repos_path, project_git_name);

              // Fetch 'current_build'
              const current_build = createBuildObject(repo_ob);

              // The last waiting update type,
              const last_waiting_ob = build_info.waiting[build_info.waiting.length - 1];
              const update_type = last_waiting_ob.update_type;

              current_build.update_type = update_type;

              if (update_type === 'build') {
                // Build it,
                buildProject(cur_config, current_build,
                                repo_path, repo_ob, (err, status) => {
                  build_result.push({ repo_path, err, status });
                  // Build the next project,
                  ++i;
                  bproj();
                });
              }
              else if (update_type === 'test') {
                // Test it,
                testProject(cur_config, current_build,
                                repo_path, repo_ob, (err, status) => {
                  build_result.push({ repo_path, err, status });
                  // Test the next project,
                  ++i;
                  bproj();
                });
              }
              else {
                throw Error('Unknown update_type: "' + update_type + '"');
              }
            }
          }
          bproj();

        }
      });
    }
    else {
      // No repositories to build,
      const waiting_ob = build_info.waiting.shift();
      const callback = waiting_ob.callback;
      if (callback !== undefined) {
        // NOTE: Important the callback is behind a 'setImmediate'
        //   because callback might change build_info.
        //
        // callback(undefined, build_result)
        setImmediate(callback, undefined, build_result);
      }
      console.log("Completed update (%s) git project: %s",
                      waiting_ob.update_type, build_info.git_name);
      // Recurse to see if we need to rebuild because a request
      // happened while we were building,
      internalUpdateGitProject(cur_config, build_info);
    }
  }



  function performProjectAction(git_name, update_type, callback) {
    // Is this currently being built?
    let build_info = current_git_builds[git_name];
    if (build_info === void 0) {
      build_info = {
        git_name,
        waiting: []
      };
      current_git_builds[git_name] = build_info;
    }

    // If there's a waiting list,
    build_info.waiting.push({
      update_type,
      callback
    });
    if (build_info.waiting.length === 1) {
      const cur_config = config.cur;
      internalUpdateGitProject(cur_config, build_info);
    }
  }


  // Builds all projects in the given repository,
  function updateGitProject(git_name, callback) {
    performProjectAction(git_name, 'build', callback);
  }

  // Runs all tests,
  function runProjectTests(git_name, callback) {
    performProjectAction(git_name, 'test', callback);
  }




  function fullPassBuild(unique_repos, build_results, callback) {
    let build_count = 0;
    // Go check/build all the repos,
    unique_repos.forEach( (gitname) => {
      updateGitProject(gitname, (err, status) => {
        build_results.push({ type:'build', gitname, err, status });
        ++build_count;
        if (build_count === unique_repos.length) {
          if (callback !== undefined) {
            callback(undefined);
          }
        }
      });
    });
  }

  function fullPassTest(unique_repos, build_results, callback) {
    let test_count = 0;
    // Go check/build all the repos,
    unique_repos.forEach( (gitname) => {
      runProjectTests(gitname, (err, status) => {
        build_results.push({ type:'test', gitname, err, status });
        ++test_count;
        if (test_count === unique_repos.length) {
          if (callback !== undefined) {
            callback(undefined);
          }
        }
      });
    });
  }

  // Performs a full scan and build of all projects. Works by
  // generating a list of unique git project repositories and
  // building each in turn.

  function fullPass(callback) {
    const cur_config = config.cur;
    const repos = cur_config.repositories;
    // List of unique git repositories stored locally,
    const unique_repos = [];
    // For each repository defined in the configuration,
    // Pick out list of unique named git repositories.
    repos.forEach( (repo_ob) => {
      // Add git name if it's unique,
      if (unique_repos.indexOf(repo_ob.gitname) < 0) {
        unique_repos.push(repo_ob.gitname);
      }
    });

    // Go build them,
    const build_results = [];
    if (unique_repos.length === 0) {
      callback(undefined, build_results);
    }
    else {
      console.log("Calling: fullPassBuild");
      fullPassBuild(unique_repos, build_results, (err) => {
        console.log("Calling: fullPassTest");
        fullPassTest(unique_repos, build_results, (err) => {
          console.log("Finished fullPassBuild and fullPassTest");
          if (callback !== undefined) {
            callback(undefined, build_results);
          }
        });
      });
    }

  }



  // Exported API
  return {

    // Runs the tests for all projects that directly reference
    // the given git repository in the repository directory.
    runProjectTests,

    // Updates all projects that directly reference the given git
    // repository in the repositories directory. This would
    // typically be called via a webhook from the hub after
    // changes have been pushed.
    updateGitProject,

    // Performs a single project monitor pass. This looks at the
    // repositories from the configuration and runs a 'git pull'
    // and 'git checkout [branch]' for each.
    // If a project is currently being built then this will skip
    // the build call on this project but will still return the
    // status of the built project when it completes.
    fullPass
  };
}



module.exports = projectBuilder;
