import db from "../db.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const loader = async ({ request, params }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const boxId = parseInt(params.boxId);
  const stepIndex = parseInt(params.stepIndex);

  if (!boxId || isNaN(stepIndex)) {
    return new Response("Not found", { status: 404 });
  }

  const img = await db.comboStepImage.findUnique({
    where: { boxId_stepIndex: { boxId, stepIndex } },
    select: { imageData: true, mimeType: true },
  });

  if (!img?.imageData || !img?.mimeType) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(img.imageData, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": img.mimeType,
      "Cache-Control": "public, max-age=86400",
    },
  });
};
