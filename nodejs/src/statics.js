"use strict";

const path = require('path');


// Location of the global configuration file,
const CONFIG_FILE = '/var/lib/devserver/config.js';

// Git Repositories path,
const DEFAULT_REPO_LOCATION = '/var/lib/devserver/repos/';

// Reports path,
const BUILD_RECORDS_LOCATION = '/var/lib/devserver/reports/';


function toReportPath(gitname, branch) {
  // Make an appropriate filename for the reports directory,
  let build_report_name = branch + '.' + gitname;
  // Sanitize it,
  build_report_name = build_report_name.replace('/', '-');
  build_report_name = build_report_name.replace('\\', '-');
  return path.join(BUILD_RECORDS_LOCATION, build_report_name);
}


module.exports = {

  // Location of the global configuration file,
  CONFIG_FILE,

  // Git Repositories path,
  DEFAULT_REPO_LOCATION,

  // Reports path,
  BUILD_RECORDS_LOCATION,

  toReportPath,

};
