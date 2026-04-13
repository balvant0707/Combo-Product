const fs = require('fs');

const cssPath = String.raw`c:\shopify apps\combo-product\extensions\combo-product\assets\combo-builder.css`;
let css = fs.readFileSync(cssPath, 'utf8');

// 1. Update wizard header
css = css.replace(
  /\/\* Header row: Change-box btn left \+ title \*\/\n\.cb-wizard-header \{[^}]+\}/,
  `/* Header: title only */
.cb-wizard-header {
  display: flex;
  align-items: center;
  padding: 0 0 12px;
}`
);

// 2. Replace label absolute positioning with flex below-box style
const OLD_LABEL = `/* STEP labels — bottom-left, next to indicator */
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

const NEW_LABEL = `/* STEP labels — below the steps row, one per step */
.cb-wizard-step-label {
  flex: 1;
  text-align: center;
  font-size: 10px;
  font-weight: 800 !important;
  color: #b5a898 !important;
  line-height: 1.25;
  padding-top: 8px;
}`;

if (!css.includes(OLD_LABEL)) { console.error('OLD_LABEL not found'); process.exit(1); }
css = css.replace(OLD_LABEL, NEW_LABEL);

// 3. Add body / changebtn-col / steps-col / labels-row rules after .cb-wizard-steps-row block
const STEPS_ROW_BLOCK = `.cb-wizard-steps-row {
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
}

/* Left column: "← Change box" button */
.cb-wizard-changebtn-col {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding-right: 14px;
}

/* Right column: stepsRow stacked above labelsRow */
.cb-wizard-steps-col {
  flex: 1;
  min-width: 0;
}

/* Labels row — sits below the step boxes */
.cb-wizard-labels-row {
  display: flex;
  align-items: flex-start;
}

/* Spacer aligns with connecting line width */
.cb-wizard-labels-spacer {
  flex-shrink: 0;
  width: 32px;
}`;

if (!css.includes(STEPS_ROW_BLOCK)) { console.error('STEPS_ROW_BLOCK not found'); process.exit(1); }
css = css.replace(STEPS_ROW_BLOCK, STEPS_ROW_PLUS);

// 4. Step-3 active/done label: was targeting label INSIDE box, now label is BELOW
css = css.replace(
  `.cb-wizard-steps-row .cb-wizard-step:last-child.cb-wizard-step--active .cb-wizard-step-label,
.cb-wizard-steps-row .cb-wizard-step:last-child.cb-wizard-step--done .cb-wizard-step-label {
  color: #fff !important;
}`,
  `/* step-3 label (below box) turns primary color when active/done */
.cb-wizard-labels-row .cb-wizard-step-label:last-child {
  color: var(--cb-primary, #2A7A4F) !important;
}`
);

// 5. Remove old done/active label overrides (labels no longer inside boxes)
css = css.replace(
  `.cb-wizard-step--done .cb-wizard-step-label {
  color: #fff !important;
}
.cb-wizard-step--active .cb-wizard-step-label {
  color: var(--cb-primary, #2A7A4F) !important;
}`,
  `/* label colors managed via .cb-wizard-labels-row rules above */`
);

// 6. Mobile: update label responsive rule (no longer absolute)
css = css.replace(
  `  .cb-wizard-step-label { font-size: 8px; left: 26px; bottom: 8px; }`,
  `  .cb-wizard-step-label { font-size: 8px; padding-top: 5px; }
  .cb-wizard-labels-spacer { width: 12px; }`
);
css = css.replace(
  `  .cb-wizard-step-content { top: 6px; left: 8px; right: 8px; }`,
  ``
);

fs.writeFileSync(cssPath, css, 'utf8');
console.log('CSS patched OK');
