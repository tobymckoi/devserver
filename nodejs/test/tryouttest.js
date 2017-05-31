"use strict";

// Define mocha globals for eslint,
/* global describe, it */

const assert = require('assert');

describe('ansi_to_html.js', function() {
  describe('#toHTML(content1)', function() {
    it('parses and returns styled HTML from Unix ANSI');
  });
  describe('#toHTML(content2)', function() {
    it('ANSI to HTML', function() {
      assert.equal(-1, 0);
    });
  });
  describe('#toHTML(content3)', function() {
    it('ANSI to HTML', function() {
      assert.equal(0, 0);
    });
  });
});
