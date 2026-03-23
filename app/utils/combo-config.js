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
  const comboType = (Number.isInteger(requestedType) && requestedType >= 2) ? requestedType : 2;
  const steps = Array.isArray(parsed?.steps) ? parsed.steps : [];
  const stepSelections = {};

  for (let index = 0; index < comboType; index += 1) {
    const step = steps[index] || {};
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
