const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./test-helpers');

class MockPdf {
  constructor(options) {
    this.options = options;
    this.actions = [];
  }

  addPage(format, orientation) {
    this.actions.push({ type: 'addPage', format, orientation });
  }

  addImage(dataUrl, imageType, x, y, width, height, alias, compression) {
    this.actions.push({
      type: 'addImage',
      dataUrl,
      imageType,
      x,
      y,
      width,
      height,
      alias,
      compression
    });
  }

  output(type) {
    return {
      type,
      options: this.options,
      actions: this.actions
    };
  }
}

function createCanvas(width, height, label) {
  return {
    width,
    height,
    toDataURL() {
      return `data:image/png;base64,${label}`;
    }
  };
}

const ctx = loadScripts(['pdf-export.js'], {
  window: {
    WOCHENPLAN_DRIVE_CONFIG: {},
    jspdf: { jsPDF: MockPdf }
  }
});

test('buildMepPdfBlobFromCanvases creates one PDF page per canvas', () => {
  const pageOne = createCanvas(1000, 700, 'page-1');
  const pageTwo = createCanvas(1000, 700, 'page-2');

  const result = ctx.buildMepPdfBlobFromCanvases([pageOne, pageTwo], { jsPdfCtor: MockPdf });

  assert.equal(result.type, 'blob');
  assert.equal(result.options.orientation, 'landscape');
  assert.equal(result.options.unit, 'mm');
  assert.equal(result.options.format, 'a4');
  assert.equal(result.options.compress, true);

  const actionTypes = result.actions.map((action) => action.type);
  assert.deepEqual(actionTypes, ['addImage', 'addPage', 'addImage']);
  assert.equal(result.actions[0].width, 297);
  assert.equal(result.actions[0].height, 210);
});

test('buildOverviewPdfBlobFromCanvases inserts page breaks when remaining space is too small', () => {
  const firstBlock = createCanvas(1000, 1200, 'block-1');
  const secondBlock = createCanvas(1000, 1500, 'block-2');

  const result = ctx.buildOverviewPdfBlobFromCanvases([firstBlock, secondBlock], { jsPdfCtor: MockPdf });
  const actionTypes = result.actions.map((action) => action.type);

  assert.deepEqual(actionTypes, ['addImage', 'addPage', 'addImage']);
  assert.equal(result.actions[0].x, 8);
  assert.equal(result.actions[0].y, 8);
  assert.equal(result.actions[1].orientation, 'portrait');
});
