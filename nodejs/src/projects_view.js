"use strict";

const util = require('util');
const fs = require('fs');
const Handlebars = require('handlebars');
const path = require('path');

const ansiToHTML = require('./ansi_to_html.js').toHTML;

const STATICS = require('./statics.js');



// Unformated list,
Handlebars.registerHelper('list', (items, options) => {
//  console.log('items=', items);
//  console.log('options=', options);
  let out = "";
  for (let i = 0; i < items.length; ++i) {
    out += options.fn(items[i]);
  }
  return out;
});

Handlebars.registerHelper('optionlink', (url, title) => {
  if (url) {
    url = Handlebars.Utils.escapeExpression(url);
    title = Handlebars.Utils.escapeExpression(title);
    return new Handlebars.SafeString('<a href="' + url + '">' + title + '</a>');
  }
  else {
    return '';
  }
});


function projectsViewHandler(config, project_builder) {


  function toStaticPage(file, args, callback) {
    const template_file = path.join(__dirname, '../web', file);
    fs.readFile(template_file, 'utf8', (err, data) => {
      if (err) {
        callback(err);
      }
      else {
        const template = Handlebars.compile(data);
        const result_html = template(args);
        callback(err, result_html);
      }
    });
  }



  // Default landing page,
  function defaultLandingPage(req, res) {
    const args = {
      config: config.cur,
      page_title: 'Landing Page'
    };

    const repos = config.cur.repositories;
    const projects = [];
    repos.forEach( (repo) => {
      const unique_repo_key = repo.branch + "." + repo.gitname;
      projects.push({
        name: repo.name,
        development_url: repo.development_url,
        build_report_url: 'buildlog?r=' + encodeURIComponent(unique_repo_key),
        test_report_url: 'testreport?r=' + encodeURIComponent(unique_repo_key),
      });
    });
    args.projects = projects;

    toStaticPage('index.handlebars', args, (err, html) => {
      if (err) {
        console.error(err.stack);
        res.status(500).send('Script failed. See logs.');
      }
      else {
        res.end(html);
      }
    });
  }

  function findMatchingRepositoryKey(repo_key) {
    const repos = config.cur.repositories;
    for (let i = 0; i < repos.length; ++i) {
      const repo = repos[i];
      const unique_repo_key = repo.branch + "." + repo.gitname;
      if (repo_key === unique_repo_key) {
        return repo;
      }
    }
    return;
  }

  // Views the build log for the given repository,
  function viewBuildLog(req, res, repo_key) {

    // Find the matching repository key,
    const matched_repo = findMatchingRepositoryKey(repo_key);

    // Build report file location,
    const report_file = STATICS.toBuildReportPath(
              matched_repo.gitname, matched_repo.branch);

    fs.stat(report_file, (err, stats) => {
      fs.readFile(report_file, 'utf8', (err, content) => {
        let report_content;
        if (err) {
          report_content = 'No build report currently available.';
        }
        else {
          // Convert the Unix ANSI content to HTML,
          report_content = ansiToHTML(content);
        }

        const args = {
          config: config.cur,
          page_title: 'Build Log',
          report_content: report_content,
          repo: matched_repo,
          mtime: stats ? util.inspect(stats.mtime) : ''
        };

        toStaticPage('buildlog.handlebars', args, (err, html) => {
          if (err) {
            console.error(err.stack);
            res.status(500).send('Script failed. See logs.');
          }
          else {
            res.end(html);
          }
        });
      });
    });

  }



  function viewTestReport(req, res, repo_key) {

    // Find the matching repository key,
    const matched_repo = findMatchingRepositoryKey(repo_key);

    // Test log content file,
    const report_file = STATICS.toTestReportPath(
              matched_repo.gitname, matched_repo.branch);

    fs.stat(report_file, (err, stats) => {
      fs.readFile(report_file, 'utf8', (err, content) => {
        let report_content;
        if (err) {
          report_content = 'No test logs currently available.';
        }
        else {
          // Convert the Unix ANSI content to HTML,
          report_content = ansiToHTML(content);
        }

        const args = {
          config: config.cur,
          page_title: 'Test Report',
          report_content: report_content,
          repo: matched_repo,
          mtime: stats ? util.inspect(stats.mtime) : ''
        };

        toStaticPage('testreport.handlebars', args, (err, html) => {
          if (err) {
            console.error(err.stack);
            res.status(500).send('Script failed. See logs.');
          }
          else {
            res.end(html);
          }
        });
      });
    });

  }


  // Web handler for project viewer,
  return (req, res) => {

    // Handle authentication,
    const site_user = config.cur.site_user;
    const site_pass = config.cur.site_pass;

    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const b64string = new Buffer(b64auth, 'base64').toString();
    const usrpass_pair = b64string.split(':');
    const login = usrpass_pair[0];
    const password = usrpass_pair[1];

    // Login/Password must match,
    if (!login || !password || login !== site_user || password !== site_pass) {
      res.set('WWW-Authenticate', 'Basic realm="Project Viewer"');
      res.status(401).send('Authorization failed.');
      return;
    }

    // Handle page,
    const page = req.params.page;
    if (page === void 0 || page === null) {
      // Default landing page,
      defaultLandingPage(req, res);
    }
    else {
      switch (page) {
        // View projects,
        case 'dump':
          res.end(util.format(req));
          break;

        case 'buildlog':
          viewBuildLog(req, res, req.query.r);
          break;

        case 'testreport':
          viewTestReport(req, res, req.query.r);
          break;

        case 'style.css':
          res.sendFile(path.join(__dirname, '../web', 'style.css'));
          break;

        default:
          // Not found,
          res.status(404).send('Page not found.');
      }
    }

  }

}

module.exports = projectsViewHandler;
