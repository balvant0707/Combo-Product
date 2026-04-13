const fs = require('fs');

// ─── Patch combo-builder.js ───────────────────────────────────────────────────
const jsPath = String.raw`c:\shopify apps\combo-product\extensions\combo-product\assets\combo-builder.js`;
let js = fs.readFileSync(jsPath, 'utf8');

// Replace the entire wizard build block (lines 731-825)
const OLD_JS = `      var wizardEl = document.createElement('div');
      wizardEl.className = 'cb-wizard';

      // Header row: Change box btn (left) + title
      var wizardHeader = document.createElement('div');
      wizardHeader.className = 'cb-wizard-header';

      var wizardChangeBtn = document.createElement('button');
      wizardChangeBtn.type = 'button';
      wizardChangeBtn.className = 'cb-change-box-btn';
      wizardChangeBtn.innerHTML = '&#8592; Change box';
      wizardChangeBtn.style.display = 'none';
      wizardHeader.appendChild(wizardChangeBtn);
      ctx._changeBoxBtn = wizardChangeBtn;

      var wizardTitle = document.createElement('div');
      wizardTitle.className = 'cb-wizard-title';
      wizardTitle.textContent = 'Build Your Box';
      wizardHeader.appendChild(wizardTitle);
      wizardEl.appendChild(wizardHeader);

      // Horizontal steps row
      var stepsRow = document.createElement('div');
      stepsRow.className = 'cb-wizard-steps-row';

      var WIZARD_STEP_DEFS = [
        { line1: 'SELECT', line2: 'BOX' },
        { line1: 'SELECT', line2: 'PRODUCT' },
        { line1: 'ADD TO', line2: 'CART' }
      ];
      var wizardDots = [];
      var wizardLines = [];
      var wizardDotEls = [];
      var wizardLabelEls = [];

      WIZARD_STEP_DEFS.forEach(function (def, i) {
        if (i > 0) {
          var line = document.createElement('div');
          line.className = 'cb-wizard-line';
          stepsRow.appendChild(line);
          wizardLines.push(line);
        }
        var stepEl = document.createElement('div');
        stepEl.className = 'cb-wizard-step' + (i === 0 ? ' cb-wizard-step--active' : '');

        var indicator = document.createElement('div');
        indicator.className = 'cb-wizard-indicator';
        stepEl.appendChild(indicator);

        // Step 1: content area for selected box image + name
        if (i === 0) {
          var s1Content = document.createElement('div');
          s1Content.className = 'cb-wizard-step-content';
          s1Content.style.display = 'none';
          var s1Img = document.createElement('img');
          s1Img.className = 'cb-wizard-step-thumb';
          s1Img.alt = '';
          s1Content.appendChild(s1Img);
          var s1Name = document.createElement('div');
          s1Name.className = 'cb-wizard-step-box-name';
          s1Content.appendChild(s1Name);
          stepEl.appendChild(s1Content);
          ctx._wizardStep1Content = s1Content;
          ctx._wizardStep1Img = s1Img;
          ctx._wizardStep1Name = s1Name;
        }

        // Steps 2 & 3: large ghost number in center
        if (i > 0) {
          var stepNum = document.createElement('div');
          stepNum.className = 'cb-wizard-step-num';
          stepNum.textContent = '0' + (i + 1);
          stepEl.appendChild(stepNum);
        }

        var stepLbl = document.createElement('div');
        stepLbl.className = 'cb-wizard-step-label';
        stepLbl.innerHTML = def.line1 + '<br>' + def.line2;
        stepEl.appendChild(stepLbl);

        var lbl = document.createElement('div');
        lbl.className = 'cb-wizard-label';

        stepsRow.appendChild(stepEl);
        wizardDots.push(stepEl);
        wizardDotEls.push(indicator);
        wizardLabelEls.push(lbl);
      });

      wizardEl.appendChild(stepsRow);
      wrapper.appendChild(wizardEl);
      ctx._wizardDots = wizardDots;
      ctx._wizardLines = wizardLines;
      ctx._wizardDotEls = wizardDotEls;
      ctx._wizardLabelEls = wizardLabelEls;`;

const NEW_JS = `      var wizardEl = document.createElement('div');
      wizardEl.className = 'cb-wizard';

      // Header: title only
      var wizardHeader = document.createElement('div');
      wizardHeader.className = 'cb-wizard-header';
      var wizardTitle = document.createElement('div');
      wizardTitle.className = 'cb-wizard-title';
      wizardTitle.textContent = 'Build Your Box';
      wizardHeader.appendChild(wizardTitle);
      wizardEl.appendChild(wizardHeader);

      // Body row: [change-btn col] + [steps column (stepsRow + labelsRow)]
      var wizardBody = document.createElement('div');
      wizardBody.className = 'cb-wizard-body';

      // Left col: change box button
      var changeBtnCol = document.createElement('div');
      changeBtnCol.className = 'cb-wizard-changebtn-col';
      var wizardChangeBtn = document.createElement('button');
      wizardChangeBtn.type = 'button';
      wizardChangeBtn.className = 'cb-change-box-btn';
      wizardChangeBtn.innerHTML = '&#8592; Change box';
      wizardChangeBtn.style.visibility = 'hidden';
      changeBtnCol.appendChild(wizardChangeBtn);
      ctx._changeBoxBtn = wizardChangeBtn;
      wizardBody.appendChild(changeBtnCol);

      // Right col: steps row + labels row
      var stepsCol = document.createElement('div');
      stepsCol.className = 'cb-wizard-steps-col';

      var stepsRow = document.createElement('div');
      stepsRow.className = 'cb-wizard-steps-row';

      var labelsRow = document.createElement('div');
      labelsRow.className = 'cb-wizard-labels-row';

      var WIZARD_STEP_DEFS = [
        { line1: 'SELECT', line2: 'BOX' },
        { line1: 'SELECT', line2: 'PRODUCT' },
        { line1: 'ADD TO', line2: 'CART' }
      ];
      var wizardDots = [];
      var wizardLines = [];
      var wizardDotEls = [];
      var wizardLabelEls = [];

      WIZARD_STEP_DEFS.forEach(function (def, i) {
        if (i > 0) {
          var line = document.createElement('div');
          line.className = 'cb-wizard-line';
          stepsRow.appendChild(line);
          wizardLines.push(line);

          // Matching spacer in labels row
          var lSpacer = document.createElement('div');
          lSpacer.className = 'cb-wizard-labels-spacer';
          labelsRow.appendChild(lSpacer);
        }

        var stepEl = document.createElement('div');
        stepEl.className = 'cb-wizard-step' + (i === 0 ? ' cb-wizard-step--active' : '');

        var indicator = document.createElement('div');
        indicator.className = 'cb-wizard-indicator';
        stepEl.appendChild(indicator);

        // Step 1: content area for selected box image + name
        if (i === 0) {
          var s1Content = document.createElement('div');
          s1Content.className = 'cb-wizard-step-content';
          s1Content.style.display = 'none';
          var s1Img = document.createElement('img');
          s1Img.className = 'cb-wizard-step-thumb';
          s1Img.alt = '';
          s1Content.appendChild(s1Img);
          var s1Name = document.createElement('div');
          s1Name.className = 'cb-wizard-step-box-name';
          s1Content.appendChild(s1Name);
          stepEl.appendChild(s1Content);
          ctx._wizardStep1Content = s1Content;
          ctx._wizardStep1Img = s1Img;
          ctx._wizardStep1Name = s1Name;
        }

        // Steps 2 & 3: large ghost number in center
        if (i > 0) {
          var stepNum = document.createElement('div');
          stepNum.className = 'cb-wizard-step-num';
          stepNum.textContent = '0' + (i + 1);
          stepEl.appendChild(stepNum);
        }

        stepsRow.appendChild(stepEl);

        // Label BELOW the steps row (not inside stepEl)
        var stepLbl = document.createElement('div');
        stepLbl.className = 'cb-wizard-step-label';
        stepLbl.innerHTML = def.line1 + '<br>' + def.line2;
        labelsRow.appendChild(stepLbl);

        wizardDots.push(stepEl);
        wizardDotEls.push(indicator);
        wizardLabelEls.push(stepLbl);
      });

      stepsCol.appendChild(stepsRow);
      stepsCol.appendChild(labelsRow);
      wizardBody.appendChild(stepsCol);
      wizardEl.appendChild(wizardBody);
      wrapper.appendChild(wizardEl);
      ctx._wizardDots = wizardDots;
      ctx._wizardLines = wizardLines;
      ctx._wizardDotEls = wizardDotEls;
      ctx._wizardLabelEls = wizardLabelEls;`;

if (!js.includes(OLD_JS)) {
  console.error('JS: OLD block not found — check spacing/content');
  process.exit(1);
}
js = js.replace(OLD_JS, NEW_JS);

// Also update the changeBoxBtn show/hide: was display='none'/'', now visibility
js = js.replace(
  /wizardChangeBtn\.style\.display = 'none';/g,
  "wizardChangeBtn.style.visibility = 'hidden';"
);

// In openBuilder: _changeBoxBtn.style.display = '' → visibility = 'visible'
js = js.replace(
  /ctx\._changeBoxBtn\.style\.display = '';/g,
  "ctx._changeBoxBtn.style.visibility = 'visible';"
);
js = js.replace(
  /if \(ctx\._changeBoxBtn\) ctx\._changeBoxBtn\.style\.display = '';/g,
  "if (ctx._changeBoxBtn) ctx._changeBoxBtn.style.visibility = 'visible';"
);
// Hide on change-box click
js = js.replace(
  /_cbBtn\.style\.display = 'none';/g,
  "_cbBtn.style.visibility = 'hidden';"
);

fs.writeFileSync(jsPath, js, 'utf8');
console.log('JS patched OK');

// ─── Patch combo-builder.css ──────────────────────────────────────────────────
const cssPath = String.raw`c:\shopify apps\combo-product\extensions\combo-product\assets\combo-builder.css`;
let css = fs.readFileSync(cssPath, 'utf8');

// 1. Update wizard header (no gap since button no longer lives there)
css = css.replace(
  /\/\* Header row: Change-box btn left \+ title \*\/\n\.cb-wizard-header \{[^}]+\}/,
  `/* Header: title only */
.cb-wizard-header {
  display: flex;
  align-items: center;
  padding: 0 0 12px;
}`
);

// 2. Replace the old .cb-wizard-step-label absolute styles with below-box styles
const OLD_LABEL_CSS = `/* STEP labels — bottom-left, next to indicator */
.cb-wizard-step-label {
  position: absolute;
  left: 32px;
  bottom: 12px;
  font-size: 10px;
  font-weight: 800 !important;
  color: #b5a898 !important;
  line-height: 1.25;
  transition: color 0.25s;
  z-index: 3;
}`;

const NEW_LABEL_CSS = `/* STEP labels — below the steps row, one per step */
.cb-wizard-step-label {
  flex: 1;
  text-align: center;
  font-size: 10px;
  font-weight: 800 !important;
  color: #b5a898 !important;
  line-height: 1.25;
  padding-top: 8px;
}`;

if (!css.includes(OLD_LABEL_CSS)) {
  console.error('CSS: OLD label block not found');
  process.exit(1);
}
css = css.replace(OLD_LABEL_CSS, NEW_LABEL_CSS);

// 3. Add new wizard body / changebtn-col / steps-col / labels-row rules
// Insert after the .cb-wizard-steps-row block
const AFTER_STEPS_ROW = `.cb-wizard-steps-row {
  display: flex;
  align-items: stretch; /* lines stretch to box height */
  overflow: hidden;
}`;

const STEPS_ROW_PLUS = `.cb-wizard-steps-row {
  display: flex;
  align-items: stretch; /* lines stretch to box height */
  overflow: hidden;
}

/* Body layout: [change-btn col] + [steps column] */
.cb-wizard-body {
  display: flex;
  align-items: flex-start;
  gap: 0;
}

/* Left column: holds the "← Change box" button */
.cb-wizard-changebtn-col {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-right: 12px;
  /* width is determined by button content; collapses nicely when invisible */
}

/* Right column: steps row stacked above labels row */
.cb-wizard-steps-col {
  flex: 1;
  min-width: 0;
}

/* Labels row below steps */
.cb-wizard-labels-row {
  display: flex;
  align-items: flex-start;
  padding-top: 2px;
}

/* Spacer in labels row matches line width */
.cb-wizard-labels-spacer {
  flex-shrink: 0;
  width: 32px;
}`;

if (!css.includes(AFTER_STEPS_ROW)) {
  console.error('CSS: steps-row anchor not found');
  process.exit(1);
}
css = css.replace(AFTER_STEPS_ROW, STEPS_ROW_PLUS);

// 4. Remove active/done label color overrides that relied on label being inside the box
//    (step-3 label color → now handled by labels-row child)
css = css.replace(
  `.cb-wizard-steps-row .cb-wizard-step:last-child.cb-wizard-step--active .cb-wizard-step-label,
.cb-wizard-steps-row .cb-wizard-step:last-child.cb-wizard-step--done .cb-wizard-step-label {
  color: #fff !important;
}`,
  `/* step 3 label (below box) — use primary color when active/done */
.cb-wizard-labels-row .cb-wizard-step-label:last-child {
  color: var(--cb-primary, #2A7A4F) !important;
}`
);

// 5. Update done label color (was targeting label inside stepEl)
css = css.replace(
  `.cb-wizard-step--done .cb-wizard-step-label {
  color: #fff !important;
}
.cb-wizard-step--active .cb-wizard-step-label {
  color: var(--cb-primary, #2A7A4F) !important;
}`,
  `/* labels live outside step boxes — color managed via .cb-wizard-labels-row */`
);

// 6. Mobile: update label responsive (no longer absolute)
css = css.replace(
  `  .cb-wizard-step-label { font-size: 8px;  left: 26px; bottom: 8px; }`,
  `  .cb-wizard-step-label { font-size: 8px; padding-top: 6px; }`
);
// Remove content/thumb responsive rules that referenced old absolute label context
css = css.replace(
  `  .cb-wizard-step-content { top: 6px; left: 8px; right: 8px; }`,
  `  .cb-wizard-labels-spacer { width: 12px; }`
);

fs.writeFileSync(cssPath, css, 'utf8');
console.log('CSS patched OK');
