"use strict";

const crypto = require('crypto');


function timingSafeEqual(a, b) {
  const len = Math.min(a.length, b.length);
  let out = 0;
  let i = 0;

  if (a.length !== b.length) {
    out = 1;
  }
  while (i < len) {
    out |= (a.charCodeAt(i) ^ b.charCodeAt(i));
    ++i;
  }
  return out === 0;
}



function signBlob (key, bodyv) {
  return 'sha1=' + crypto.createHmac('sha1', key).update(bodyv).digest('hex');
}


function gitHubHandler(config, projectBuilder) {


  function handleGitHubCall(event_type, payload) {
    console.log("----- Call from GitHub: %s", event_type);
    console.log(payload);
    console.log("-----");



  }


  // Web handler for GitHub web hooks.

  return (req, res) => {

    let buf = '';

//    console.log(req);

    const sig = req.headers['x-hub-signature'];
    const evt = req.headers['x-github-event'];

    let payload_threshold = false;

    req.on('data', (data) => {
      if (!payload_threshold) {
        if (buf.length + data.length > 100000) {
          res.write('{"ERROR":"Payload too large"}');
          buf = '';
          payload_threshold = true;
        }
        else {
          buf += data;
        }
      }
    });
    req.on('end', () => {

      const webhook_secret = config.cur.github_webhook_secret;

      const gen_sig = signBlob(webhook_secret, buf);
      // We
      if (timingSafeEqual(sig, gen_sig)) {
        console.log("  Verified!");
        const payload = JSON.parse(buf);
        res.end('{}');

        handleGitHubCall(evt, payload);

      }
      else {
        console.log("GITHUB SIG:     %s", sig);
        console.log("CALCULATED SIG: %s", gen_sig);
        console.log("  WEB HOOK SECRET MISMATCH - Check configuration");
        // JSON response back to GitHub,
        res.status(400).end('{}');
      }

    });

  };

}


module.exports = gitHubHandler;
