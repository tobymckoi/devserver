"use strict";

const path = require('path');


// The base system path location,
const BASE_SYS = '/var/lib/devserver/';

// Location of the global configuration file,
const CONFIG_FILE = path.join(BASE_SYS, 'config.js');

// Git Repositories path,
const DEFAULT_REPO_LOCATION = path.join(BASE_SYS, 'repos/');

// Build reports path,
const BUILD_RECORDS_LOCATION = path.join(BASE_SYS, 'reports/');

// Test reports path,
const TEST_REPORTS_LOCATION = path.join(BASE_SYS, 'tests/');


function toReportName(gitname, branch) {
  // Make an appropriate filename for the reports directory,
  let build_report_name = branch + '.' + gitname;
  // Sanitize it,
  build_report_name = build_report_name.replace('/', '-');
  build_report_name = build_report_name.replace('\\', '-');
  return build_report_name;
}

function toBuildReportPath(gitname, branch) {
  return path.join(BUILD_RECORDS_LOCATION, toReportName(gitname, branch));
}

function toTestReportPath(gitname, branch) {
  return path.join(TEST_REPORTS_LOCATION, toReportName(gitname, branch));
}

module.exports = {

  // Location of the global configuration file,
  CONFIG_FILE,

  // Git Repositories path,
  DEFAULT_REPO_LOCATION,

  // Reports path,
  BUILD_RECORDS_LOCATION,

  // Test results path,
  TEST_REPORTS_LOCATION,

  // Given gitname and branch, returns a unique identifier for build report,
  toBuildReportPath,

  // Given gitname and branch, returns a unique identifier for test report,
  toTestReportPath,

};
