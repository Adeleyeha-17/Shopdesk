// A proper Excel workbook (.xlsx) made in the browser, with nothing to install: styles, formulas (with their
// answers already filled in, so every app shows numbers straight away), tables with filter buttons, dropdowns,
// colour rules, frozen headers, hidden sheets and real charts. No macros, so it opens in Excel, Google Sheets,
// WPS Office and LibreOffice.
//
//   const blob = await xlsxBlob({
//     names: { PeriodStart: 'Summary!$B$5' },
//     sheets: [{
//       name: 'Orders', widths: [10, 14], freeze: { rows: 4, cols: 1 },
//       rows: [[{ v: 'Orders', s: 'title' }], [], [], [{ v: 'Order', s: 'head' }, { v: 'Total', s: 'head' }],
//              ['BB-1', { v: 5000, s: 'money' }], ...],
//       table: { name: 'Orders', ref: 'A4:B20' }, merges: ['A1:F1'],
//       lists: [{ ref: 'B2', source: 'Lists!$A$2:$A$9' }],
//       rules: [{ ref: 'B5:B20', bar: '93C5FD' }, { ref: 'C5:C9', scale: ['FFFFFF', '1D4ED8'] },
//               { ref: 'D5:D20', when: '$D5>30', style: 'bad' }],
//       charts: [{ at: [0, 6, 8, 22], kind: 'bar', title: 'Sales', cats: "'Daily'!$A$5:$A$30", numCats: true,
//                  series: [{ name: 'Money in', ref: "'Daily'!$C$5:$C$30", color: '2563EB' }] }],
//     }],
//   });
// A cell is a value (number or text), or { v, f, s }: v the value (or the formula's answer), f a formula without
// "=", s a style name from STYLE below.

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

export function col(i) {
  let s = '';
  for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}
export const cellRef = (c, r) => col(c) + (r + 1); // both from 0
export const quoteSheet = (name) => `'${String(name).replace(/'/g, "''")}'`;

// A moment in time as an Excel date (days since 30 Dec 1899, in the phone's own time zone).
export function excelDate(t) {
  const ms = typeof t === 'number' ? t : Date.parse(t);
  return (ms - new Date(ms).getTimezoneOffset() * 60000) / 864e5 + 25569;
}

// ---------- styles ----------
const NUMFMTS = [
  [164, '"₦"#,##0;[Red]-"₦"#,##0'],
  [165, '#,##0'],
  [166, '0%'],
  [167, '"▲ "0%;"▼ "0%;"0%"'],
  [168, 'd mmm yyyy'],
  [169, 'd mmm yyyy, h:mm AM/PM'],
  [170, 'mmmm yyyy'],
  [171, '#,##0.0'],
  [172, 'ddd d mmm'],
  [173, '0;-0;""'],
];
const FONTS = [
  '<font><sz val="11"/><color rgb="FF111827"/><name val="Calibri"/><family val="2"/></font>', // 0 normal
  '<font><b/><sz val="11"/><color rgb="FF111827"/><name val="Calibri"/><family val="2"/></font>', // 1 bold
  '<font><b/><sz val="18"/><color rgb="FF111827"/><name val="Calibri"/><family val="2"/></font>', // 2 title
  '<font><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/><family val="2"/></font>', // 3 grey note
  '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>', // 4 white bold
  '<font><b/><sz val="14"/><color rgb="FF111827"/><name val="Calibri"/><family val="2"/></font>', // 5 big bold
  '<font><u/><sz val="11"/><color rgb="FF1D4ED8"/><name val="Calibri"/><family val="2"/></font>', // 6 link
  '<font><b/><sz val="12"/><color rgb="FF111827"/><name val="Calibri"/><family val="2"/></font>', // 7 section
  '<font><b/><sz val="12"/><color rgb="FF111827"/><name val="Calibri"/><family val="2"/></font>', // 8 input
];
const FILLS = [
  '<fill><patternFill patternType="none"/></fill>',
  '<fill><patternFill patternType="gray125"/></fill>',
  '<fill><patternFill patternType="solid"><fgColor rgb="FF111827"/><bgColor indexed="64"/></patternFill></fill>', // 2 dark
  '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF4C2"/><bgColor indexed="64"/></patternFill></fill>', // 3 input yellow
  '<fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/><bgColor indexed="64"/></patternFill></fill>', // 4 light grey
];
const BORDERS = [
  '<border><left/><right/><top/><bottom/><diagonal/></border>',
  '<border><left/><right/><top/><bottom style="thin"><color rgb="FFD1D5DB"/></bottom><diagonal/></border>', // 1 line under
  '<border><left/><right/><top style="thin"><color rgb="FF111827"/></top><bottom/><diagonal/></border>', // 2 total line
  '<border><left style="thin"><color rgb="FFE0B400"/></left><right style="thin"><color rgb="FFE0B400"/></right><top style="thin"><color rgb="FFE0B400"/></top><bottom style="thin"><color rgb="FFE0B400"/></bottom><diagonal/></border>', // 3 input box
];
// name: [numFmt, font, fill, border, align]  (align: 'r' right, 'c' centre, 'w' wrap, 'rw', '' none)
const STYLE = {
  text: [0, 0, 0, 0, ''],
  bold: [0, 1, 0, 0, ''],
  title: [0, 2, 0, 0, ''],
  note: [0, 3, 0, 0, ''],
  noteWrap: [0, 3, 0, 0, 'w'],
  head: [0, 4, 2, 0, 'cw'],
  headL: [0, 4, 2, 0, ''],
  section: [0, 7, 0, 1, ''],
  money: [164, 0, 0, 0, ''],
  moneyB: [164, 1, 0, 0, ''],
  moneyBig: [164, 5, 0, 0, ''],
  int: [165, 0, 0, 0, ''],
  intB: [165, 1, 0, 0, ''],
  dec: [171, 0, 0, 0, ''],
  pct: [166, 0, 0, 0, ''],
  pctB: [166, 1, 0, 0, ''],
  change: [167, 1, 0, 0, 'r'],
  date: [168, 0, 0, 0, ''],
  dateB: [168, 1, 0, 0, ''],
  day: [172, 0, 0, 0, ''],
  datetime: [169, 0, 0, 0, ''],
  month: [170, 0, 0, 0, ''],
  link: [0, 6, 0, 0, ''],
  label: [0, 0, 4, 0, ''],
  input: [0, 8, 3, 3, 'c'],
  inputMoney: [164, 8, 3, 3, 'c'],
  inputDate: [168, 8, 3, 3, 'c'],
  totalText: [0, 1, 4, 2, ''],
  totalMoney: [164, 1, 4, 2, ''],
  totalInt: [165, 1, 4, 2, ''],
  totalBlank: [0, 1, 4, 2, ''],
  heat: [173, 0, 0, 0, 'c'],
  center: [0, 0, 0, 0, 'c'],
};
const STYLE_NAMES = Object.keys(STYLE);
const styleId = (name) => {
  const i = STYLE_NAMES.indexOf(name || 'text');
  return i < 0 ? 0 : i;
};
// Colour rules use these (in order): 0 bad (red), 1 good (green), 2 muted
const DXFS = [
  '<dxf><font><b/><color rgb="FFB91C1C"/></font><fill><patternFill><bgColor rgb="FFFEE2E2"/></patternFill></fill></dxf>',
  '<dxf><font><b/><color rgb="FF15803D"/></font><fill><patternFill><bgColor rgb="FFDCFCE7"/></patternFill></fill></dxf>',
  '<dxf><font><color rgb="FF9CA3AF"/></font></dxf>',
];
const DXF = { bad: 0, good: 1, muted: 2 };

function stylesXml() {
  const align = (a) =>
    !a
      ? ''
      : `<alignment${a.includes('r') ? ' horizontal="right"' : a.includes('c') ? ' horizontal="center"' : ''}${a.includes('w') ? ' wrapText="1"' : ''} vertical="center"/>`;
  const xfs = STYLE_NAMES.map((n) => {
    const [fmt, font, fill, border, al] = STYLE[n];
    return `<xf numFmtId="${fmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${fmt ? ' applyNumberFormat="1"' : ''}${font ? ' applyFont="1"' : ''}${fill ? ' applyFill="1"' : ''}${border ? ' applyBorder="1"' : ''}${al ? ' applyAlignment="1">' + align(al) + '</xf>' : '/>'}`;
  }).join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<numFmts count="${NUMFMTS.length}">${NUMFMTS.map(([id, f]) => `<numFmt numFmtId="${id}" formatCode="${esc(f)}"/>`).join('')}</numFmts>` +
    `<fonts count="${FONTS.length}">${FONTS.join('')}</fonts>` +
    `<fills count="${FILLS.length}">${FILLS.join('')}</fills>` +
    `<borders count="${BORDERS.length}">${BORDERS.join('')}</borders>` +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${STYLE_NAMES.length}">${xfs}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    `<dxfs count="${DXFS.length}">${DXFS.join('')}</dxfs>` +
    '<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>' +
    '</styleSheet>'
  );
}

// ---------- one sheet ----------
function cellXml(ref, cell) {
  if (cell === null || cell === undefined || cell === '') return '';
  const c = typeof cell === 'object' ? cell : { v: cell };
  const s = c.s ? ` s="${styleId(c.s)}"` : '';
  const f = c.f ? `<f>${esc(c.f)}</f>` : '';
  const v = c.v;
  if (c.f) {
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${s}>${f}<v>${v}</v></c>`;
    if (typeof v === 'boolean') return `<c r="${ref}"${s} t="b">${f}<v>${v ? 1 : 0}</v></c>`;
    return `<c r="${ref}"${s} t="str">${f}<v>${esc(v ?? '')}</v></c>`;
  }
  if (v === null || v === undefined || v === '') return s ? `<c r="${ref}"${s}/>` : '';
  if (typeof v === 'number') return isFinite(v) ? `<c r="${ref}"${s}><v>${v}</v></c>` : '';
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

function sheetXml(sh, rel) {
  const widths = (sh.widths || [])
    .map(
      (w, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"${(sh.hide || []).includes(i) ? ' hidden="1"' : ''}/>`,
    )
    .join('');
  const rows = (sh.rows || [])
    .map((row, r) => {
      const cells = (row || []).map((cell, c) => cellXml(cellRef(c, r), cell)).join('');
      const h = sh.heights && sh.heights[r] ? ` ht="${sh.heights[r]}" customHeight="1"` : '';
      return cells || h ? `<row r="${r + 1}"${h}>${cells}</row>` : '';
    })
    .join('');
  const fz = sh.freeze;
  const pane = fz
    ? `<pane${fz.cols ? ` xSplit="${fz.cols}"` : ''}${fz.rows ? ` ySplit="${fz.rows}"` : ''} topLeftCell="${cellRef(fz.cols || 0, fz.rows || 0)}" activePane="${fz.rows && fz.cols ? 'bottomRight' : fz.rows ? 'bottomLeft' : 'topRight'}" state="frozen"/>`
    : '';
  const view = `<sheetViews><sheetView workbookViewId="0"${sh.first ? ' tabSelected="1"' : ''} showGridLines="${sh.grid ? 1 : 0}" zoomScale="${sh.zoom || 100}">${pane}</sheetView></sheetViews>`;
  const merges =
    sh.merges && sh.merges.length
      ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
      : '';
  let prio = 1;
  const rules = (sh.rules || [])
    .map((x) => {
      const rule = x.bar
        ? `<cfRule type="dataBar" priority="${prio++}"><dataBar><cfvo type="num" val="0"/>${x.max != null ? `<cfvo type="num" val="${x.max}"/>` : '<cfvo type="max"/>'}<color rgb="FF${x.bar}"/></dataBar></cfRule>`
        : x.scale
          ? `<cfRule type="colorScale" priority="${prio++}"><colorScale><cfvo type="min"/><cfvo type="max"/>${x.scale.map((c) => `<color rgb="FF${c}"/>`).join('')}</colorScale></cfRule>`
          : `<cfRule type="expression" dxfId="${DXF[x.style] ?? 0}" priority="${prio++}"><formula>${esc(x.when)}</formula></cfRule>`;
      return `<conditionalFormatting sqref="${x.ref}">${rule}</conditionalFormatting>`;
    })
    .join('');
  const lists =
    sh.lists && sh.lists.length
      ? `<dataValidations count="${sh.lists.length}">${sh.lists.map((l) => `<dataValidation type="${l.type || 'list'}" allowBlank="1" showInputMessage="1" showErrorMessage="1"${l.prompt ? ` promptTitle="${esc(l.promptTitle || '')}" prompt="${esc(l.prompt)}"` : ''} sqref="${l.ref}">${l.type === 'date' ? '<formula1>1</formula1><formula2>2958465</formula2>' : `<formula1>${esc(l.source)}</formula1>`}</dataValidation>`).join('')}</dataValidations>`
      : '';
  const margins = '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>';
  const setup = '<pageSetup orientation="landscape" fitToHeight="0"/>';
  const drawing = rel.drawing ? `<drawing r:id="${rel.drawing}"/>` : '';
  const tables = rel.table ? `<tableParts count="1"><tablePart r:id="${rel.table}"/></tableParts>` : '';
  const filter = sh.filter && !sh.table ? `<autoFilter ref="${sh.filter}"/>` : '';
  const sheetPr = `<sheetPr>${sh.tab ? `<tabColor rgb="FF${sh.tab}"/>` : ''}<pageSetUpPr fitToPage="1"/></sheetPr>`;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    sheetPr +
    view +
    '<sheetFormatPr defaultRowHeight="16"/>' +
    (widths ? `<cols>${widths}</cols>` : '') +
    `<sheetData>${rows}</sheetData>` +
    filter +
    merges +
    rules +
    lists +
    margins +
    setup +
    drawing +
    tables +
    '</worksheet>'
  );
}

function tableXml(t, id, headers) {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="${id}" name="${t.name}" displayName="${t.name}" ref="${t.ref}" totalsRowShown="0">` +
    `<autoFilter ref="${t.ref}"/>` +
    `<tableColumns count="${headers.length}">${headers.map((h, i) => `<tableColumn id="${i + 1}" name="${esc(h)}"/>`).join('')}</tableColumns>` +
    `<tableStyleInfo name="${t.style || 'TableStyleLight1'}" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/>` +
    '</table>'
  );
}

// ---------- charts ----------
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const C = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const fill = (c) => `<c:spPr><a:solidFill><a:srgbClr val="${c}"/></a:solidFill></c:spPr>`;
const lineFill = (c, w = 28575) =>
  `<c:spPr><a:ln w="${w}" cap="rnd"><a:solidFill><a:srgbClr val="${c}"/></a:solidFill><a:round/></a:ln></c:spPr>`;
const text = (sz, bold, color = '374151') =>
  `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}" b="${bold ? 1 : 0}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Calibri"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;

function chartXml(ch) {
  const ser = (s, i, kind) => {
    const tx = s.name ? `<c:tx><c:v>${esc(s.name)}</c:v></c:tx>` : '';
    const cat = ch.numCats
      ? `<c:cat><c:numRef><c:f>${esc(ch.cats)}</c:f></c:numRef></c:cat>`
      : `<c:cat><c:strRef><c:f>${esc(ch.cats)}</c:f></c:strRef></c:cat>`;
    const val = `<c:val><c:numRef><c:f>${esc(s.ref)}</c:f></c:numRef></c:val>`;
    return kind === 'line'
      ? `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx}${lineFill(s.color)}<c:marker><c:symbol val="none"/></c:marker>${cat}${val}<c:smooth val="0"/></c:ser>`
      : `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx}${fill(s.color)}<c:invertIfNegative val="0"/>${cat}${val}</c:ser>`;
  };
  const bars = ch.series.filter((s) => (s.kind || (ch.kind === 'line' ? 'line' : 'bar')) === 'bar');
  const lines = ch.series.filter((s) => (s.kind || (ch.kind === 'line' ? 'line' : 'bar')) === 'line');
  let idx = 0;
  const barXml = bars.length
    ? `<c:barChart><c:barDir val="${ch.horizontal ? 'bar' : 'col'}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${bars.map((s) => ser(s, idx++, 'bar')).join('')}<c:gapWidth val="${ch.gap ?? 50}"/><c:axId val="10"/><c:axId val="20"/></c:barChart>`
    : '';
  const lineXml = lines.length
    ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${lines.map((s) => ser(s, idx++, 'line')).join('')}<c:marker val="1"/><c:axId val="10"/><c:axId val="20"/></c:lineChart>`
    : '';
  const grid =
    '<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E5E7EB"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>';
  const noLine = '<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>';
  const catAx = `<c:catAx><c:axId val="10"/><c:scaling><c:orientation val="${ch.horizontal ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/><c:axPos val="${ch.horizontal ? 'l' : 'b'}"/>${ch.catFormat ? `<c:numFmt formatCode="${esc(ch.catFormat)}" sourceLinked="0"/>` : ''}<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="D1D5DB"/></a:solidFill></a:ln></c:spPr>${text(900, false, '6B7280')}<c:crossAx val="20"/><c:crosses val="autoZero"/><c:auto val="${ch.numCats ? 0 : 1}"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
  const valAx = `<c:valAx><c:axId val="20"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${ch.horizontal ? 'b' : 'l'}"/>${grid}<c:numFmt formatCode="${esc(ch.valFormat || '"₦"#,##0')}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${noLine}${text(900, false, '6B7280')}<c:crossAx val="10"/><c:crosses val="${ch.horizontal ? 'max' : 'autoZero'}"/><c:crossBetween val="between"/></c:valAx>`;
  const title = ch.title
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="en-US" sz="1200" b="1"><a:solidFill><a:srgbClr val="111827"/></a:solidFill></a:rPr><a:t>${esc(ch.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
    : '<c:autoTitleDeleted val="1"/>';
  const legend =
    ch.series.length > 1
      ? `<c:legend><c:legendPos val="t"/><c:overlay val="0"/>${text(900, false, '374151')}</c:legend>`
      : '';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<c:chartSpace ${C} ${A} ${R}><c:roundedCorners val="0"/><c:chart>${title}<c:plotArea><c:layout/>${barXml}${lineXml}${catAx}${valAx}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    '<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>' +
    `${text(1000, false)}</c:chartSpace>`
  );
}

function drawingXml(charts, firstChart) {
  const anchors = charts
    .map((ch, i) => {
      const [c1, r1, c2, r2] = ch.at;
      return (
        '<xdr:twoCellAnchor editAs="oneCell">' +
        `<xdr:from><xdr:col>${c1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
        `<xdr:to><xdr:col>${c2}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r2}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
        `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Chart ${firstChart + i}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
        '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>' +
        `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart ${C} ${R} r:id="rId${i + 1}"/></a:graphicData></a:graphic>` +
        '</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>'
      );
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ${A}>${anchors}</xdr:wsDr>`
  );
}

const rels = (list) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  list
    .map(
      ([id, type, target]) =>
        `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`,
    )
    .join('') +
  '</Relationships>';

export function workbookFiles(book) {
  const files = {};
  const types = [];
  let tableNo = 0,
    drawingNo = 0,
    chartNo = 0;
  book.sheets.forEach((sh, i) => {
    const n = i + 1;
    const rel = {};
    const list = [];
    if (sh.table) {
      tableNo += 1;
      rel.table = 'rId' + (list.length + 1);
      list.push([rel.table, 'table', `../tables/table${tableNo}.xml`]);
      const [a] = sh.table.ref.split(':');
      const m = a.match(/^([A-Z]+)(\d+)$/);
      const headRow = (sh.rows || [])[Number(m[2]) - 1] || [];
      const width = sh.table.cols;
      const startCol = m[1].split('').reduce((x, ch) => x * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const headers = Array.from({ length: width }, (_, k) => {
        const cell = headRow[startCol + k];
        return String(cell && typeof cell === 'object' ? cell.v : (cell ?? `Column ${k + 1}`));
      });
      files[`xl/tables/table${tableNo}.xml`] = tableXml(sh.table, tableNo, headers);
      types.push([
        `/xl/tables/table${tableNo}.xml`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml',
      ]);
    }
    if (sh.charts && sh.charts.length) {
      drawingNo += 1;
      rel.drawing = 'rId' + (list.length + 1);
      list.push([rel.drawing, 'drawing', `../drawings/drawing${drawingNo}.xml`]);
      const first = chartNo + 1;
      const drels = sh.charts.map((ch, k) => {
        chartNo += 1;
        files[`xl/charts/chart${chartNo}.xml`] = chartXml(ch);
        types.push([
          `/xl/charts/chart${chartNo}.xml`,
          'application/vnd.openxmlformats-officedocument.drawingml.chart+xml',
        ]);
        return [`rId${k + 1}`, 'chart', `../charts/chart${chartNo}.xml`];
      });
      files[`xl/drawings/drawing${drawingNo}.xml`] = drawingXml(sh.charts, first);
      files[`xl/drawings/_rels/drawing${drawingNo}.xml.rels`] = rels(drels);
      types.push([
        `/xl/drawings/drawing${drawingNo}.xml`,
        'application/vnd.openxmlformats-officedocument.drawing+xml',
      ]);
    }
    files[`xl/worksheets/sheet${n}.xml`] = sheetXml({ ...sh, first: i === 0 }, rel);
    if (list.length) files[`xl/worksheets/_rels/sheet${n}.xml.rels`] = rels(list);
    types.push([
      `/xl/worksheets/sheet${n}.xml`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
    ]);
  });
  const names = Object.entries(book.names || {})
    .map(([k, v]) => `<definedName name="${k}">${esc(v)}</definedName>`)
    .join('');
  files['xl/workbook.xml'] =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ${R}>` +
    '<bookViews><workbookView activeTab="0" firstSheet="0"/></bookViews><sheets>' +
    book.sheets
      .map(
        (sh, i) =>
          `<sheet name="${esc(
            String(sh.name)
              .replace(/[[\]:*?/\\]/g, ' ')
              .slice(0, 31),
          )}" sheetId="${i + 1}"${sh.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`,
      )
      .join('') +
    `</sheets>${names ? `<definedNames>${names}</definedNames>` : ''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
  files['xl/_rels/workbook.xml.rels'] = rels([
    ...book.sheets.map((_, i) => [`rId${i + 1}`, 'worksheet', `worksheets/sheet${i + 1}.xml`]),
    [`rId${book.sheets.length + 1}`, 'styles', 'styles.xml'],
  ]);
  files['xl/styles.xml'] = stylesXml();
  files['_rels/.rels'] = rels([['rId1', 'officeDocument', 'xl/workbook.xml']]);
  files['[Content_Types].xml'] =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    types.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join('') +
    '</Types>';
  return files;
}

// ---------- zip (compressed where the browser can, stored otherwise) ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (e) {
    return null;
  }
}
async function zip(files) {
  const enc = new TextEncoder();
  const parts = [],
    central = [];
  let offset = 0;
  const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
  const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  for (const [name, content] of Object.entries(files)) {
    const data = enc.encode(content);
    const path = enc.encode(name);
    const crc = crc32(data);
    const packed = await deflate(data);
    const body = packed || data;
    const common = [
      ...u16(20),
      ...u16(0x0800),
      ...u16(packed ? 8 : 0),
      ...u16(0),
      ...u16(0x21),
      ...u32(crc),
      ...u32(body.length),
      ...u32(data.length),
      ...u16(path.length),
      ...u16(0),
    ];
    const local = new Uint8Array([...u32(0x04034b50), ...common, ...path]);
    parts.push(local, body);
    central.push(
      new Uint8Array([
        ...u32(0x02014b50),
        ...u16(20),
        ...common,
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(offset),
        ...path,
      ]),
    );
    offset += local.length + body.length;
  }
  const size = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(central.length),
    ...u16(central.length),
    ...u32(size),
    ...u32(offset),
    ...u16(0),
  ]);
  return new Blob([...parts, ...central, end], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export const xlsxBlob = (book) => zip(workbookFiles(book));

export async function downloadXlsx(fileName, book) {
  const blob = await xlsxBlob(book);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
