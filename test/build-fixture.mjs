// Rebuilds test/fixtures/primary-2026.html from the tab-separated text capture.
// Mimics the Electionware / JasperReports HTML export: every piece of text is a
// leaf <span style="font-family: Roboto ...">, absolutely positioned, with a
// repeated page header and footer on each of the 20 pages.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const txt = readFileSync(join(here, 'fixtures/primary-2026.txt'), 'utf8');
const pages = txt.split('##PAGE\n');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#39;');
const cell = (t, font = 'Roboto Condensed; color: #000000; font-size: 8px') =>
  `<div style="position:absolute;left:0px;top:0px;width:120px;height:14px;overflow: hidden;"><span style="width: 100%; height: 100%;text-align: left; display:table;line-height: 1.0; text-indent: 0px; "><span style="display:table-cell;vertical-align:top;"><span style="font-family: ${font};">${esc(t)}</span></span></span></div>\n`;

const header = (pi) =>
  cell('Summary Results Report', 'Roboto; color: #000000; font-size: 12px') +
  cell('Primary Election', 'Roboto; color: #000000; font-size: 12px') +
  cell('May 5, 2026', 'Roboto; color: #000000; font-size: 12px') +
  cell('UNOFFICIAL RESULTS', 'Roboto; color: #000000; font-size: 12px') +
  cell('Howard County, IN', 'Roboto; color: #000000; font-size: 12px');
const footer = (pi, n) =>
  cell('Election Summary - 05/05/2026&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;8:00 PM'.replace(/&nbsp;/g, ' '), 'Roboto; color: #000000; font-size: 7px') +
  cell(String(pi + 1), 'Roboto; color: #000000; font-size: 7px') +
  cell(`of ${n}`, 'Roboto; color: #000000; font-size: 7px') +
  cell('Report generated with Electionware Copyright © 2007-2019', 'Roboto; color: #000000; font-size: 7px');

let body = '';
pages.forEach((p, pi) => {
  body += `<a name="JR_PAGE_ANCHOR_0_${pi + 1}"></a>\n<div style="background-color: #FFFFFF;position:relative;width:612px;height:792px;">\n`;
  body += header(pi);
  for (const line of p.split('\n')) {
    if (!line.trim()) continue;
    const [a, b] = line.split('\t');
    if (/^Vote For \d+$/.test(a) || /^(REP|DEM) /.test(a)) body += cell(a, 'Roboto; color: #000000; font-size: 9px; font-weight: bold');
    else body += cell(a);
    if (b !== undefined) body += cell(b);
  }
  body += footer(pi, pages.length);
  body += '</div>\n';
});

const html = `<html><head>\n  <title></title>\n  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">\n  <style type="text/css">\n    a {text-decoration: none}\n  </style>\n</head>\n<body text="#000000" link="#000000" alink="#000000" vlink="#000000">\n<table width="100%" cellpadding="0" cellspacing="0" border="0">\n<tbody><tr><td width="50%">&nbsp;</td><td align="center">\n\n${body}\n</td><td width="50%">&nbsp;</td></tr>\n</tbody></table>\n</body>\n</html>\n`;
writeFileSync(join(here, 'fixtures/primary-2026.html'), html.replace(/ /g, '&nbsp;'));
console.log('wrote fixture,', pages.length, 'pages,', html.length, 'bytes');
