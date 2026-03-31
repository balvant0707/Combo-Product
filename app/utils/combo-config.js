const MIN_COMBO_STEPS = 2;
const MAX_COMBO_STEPS = 8;

export function validateComboConfig(configInput) {
  if (!configInput) {
    return {
      form: "Complete the required product or collection selection for each combo step.",
      stepSelections: {},
    };
  }

  let parsed;
  try {
    parsed = typeof configInput === "string" ? JSON.parse(configInput) : configInput;
  } catch {
    return {
      form: "Specific Combo Box configuration is invalid.",
      stepSelections: {},
    };
  }

  const requestedType = parseInt(parsed?.type, 10);
  const comboType = Number.isInteger(requestedType)
    ? Math.max(MIN_COMBO_STEPS, Math.min(MAX_COMBO_STEPS, requestedType))
    : MIN_COMBO_STEPS;
  const steps = Array.isArray(parsed?.steps) ? parsed.steps : [];
  const stepSelections = {};

  for (let index = 0; index < comboType; index += 1) {
    const step = steps[index] || {};
    const isOptionalStep = step?.optional === true || String(step?.optional).toLowerCase() === "true";
    if (isOptionalStep) continue;
    const scope = step?.scope === "product" ? "product" : "collection";
    const hasCollections =
      Array.isArray(step?.collections) && step.collections.length > 0;
    const hasProducts =
      Array.isArray(step?.selectedProducts) && step.selectedProducts.length > 0;

    if (scope === "collection" && !hasCollections) {
      stepSelections[index] = "Select at least one collection.";
    }

    if (scope === "product" && !hasProducts) {
      stepSelections[index] = "Select at least one product.";
    }
  }

  if (Object.keys(stepSelections).length === 0) {
    return null;
  }

  return {
    form: "Complete the required product or collection selection for each combo step.",
    stepSelections,
  };
}
