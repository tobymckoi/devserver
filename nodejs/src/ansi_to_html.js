"use strict";

const util = require('util');
const Handlebars = require('handlebars');
const AnsiParser = require('node-ansiparser');




const ansi_styles = [];
ansi_styles[30] = 'fliblack';
ansi_styles[31] = 'flired';
ansi_styles[32] = 'fligreen';
ansi_styles[33] = 'fliyellow';
ansi_styles[34] = 'fliblue';
ansi_styles[35] = 'flimagenta';
ansi_styles[36] = 'flicyan';
ansi_styles[37] = 'fliwhite';

ansi_styles[40] = 'fliblack';
ansi_styles[41] = 'flired';
ansi_styles[42] = 'fligreen';
ansi_styles[43] = 'fliyellow';
ansi_styles[44] = 'fliblue';
ansi_styles[45] = 'flimagenta';
ansi_styles[46] = 'flicyan';
ansi_styles[47] = 'fliwhite';

ansi_styles[90] = 'fhiblack';
ansi_styles[91] = 'fhired';
ansi_styles[92] = 'fhigreen';
ansi_styles[93] = 'fhiyellow';
ansi_styles[94] = 'fhiblue';
ansi_styles[95] = 'fhimagenta';
ansi_styles[96] = 'fhicyan';
ansi_styles[97] = 'fhiwhite';

ansi_styles[100] = 'bhiblack';
ansi_styles[101] = 'bhired';
ansi_styles[102] = 'bhigreen';
ansi_styles[103] = 'bhiyellow';
ansi_styles[104] = 'bhiblue';
ansi_styles[105] = 'bhimagenta';
ansi_styles[106] = 'bhicyan';
ansi_styles[107] = 'bhiwhite';


function toHTML(ansi_content) {

  let style_count = 0;
  let tokenized_content = '';

  function closeSpans() {
    for (let i = 0; i < style_count; ++i) {
      tokenized_content += '</span>';
    }
    style_count = 0;
  }

  const terminal = {
    inst_p: function(s) {
      tokenized_content += s;
    },
    inst_o: function(s) {
      // No-op
    },
    inst_x: function(flag) {
      const ccode = flag.charCodeAt(0);
      if (ccode !== 13) {
        tokenized_content += flag;
      }
    },
    inst_c: function(collected, params, flag) {
      // Colour control,
      if (flag === 'm') {
        let class_list = '';
        let first = true;
        params.forEach( (pcode) => {
          if (!first) {
            class_list += ' ';
          }
          const style_class = ansi_styles[pcode];
          if (style_class) {
            class_list += ansi_styles[pcode];
            first = false;
          }
        });

        if (params.length === 1 && params[0] === 0) {
          closeSpans();
        }
        else {
          tokenized_content += '<span class="' + class_list + '">';
          ++style_count;
        }
      }
//      console.log(util.format('csi (%s) (%s) (%s)', collected, params, flag) + '\n');
    },
    inst_e: function(collected, flag) {
  //            tokenized_content += util.format('esc', collected, flag) + '\n';
    },
    inst_H: function(collected, params, flag) {
  //            tokenized_content += util.format('dcs-Hook', collected, params, flag) + '\n';
    },
    inst_P: function(dcs) {
  //            tokenized_content += util.format('dcs-Put', dcs) + '\n';
    },
    inst_U: function() {
  //            tokenized_content += util.format('dcs-Unhook') + '\n';
    }
  };

  // The ANSI parser,
  const parser = new AnsiParser(terminal);
  parser.parse(ansi_content);
  closeSpans();

  // Return the HTML content,
  return new Handlebars.SafeString(tokenized_content);

}

module.exports = {
  toHTML
}
