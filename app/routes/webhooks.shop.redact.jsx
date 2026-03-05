import db from "../db.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const result = await db.$transaction(async (tx) => {
    const boxes = await tx.comboBox.findMany({
      where: { shop },
      select: { id: true },
    });
    const boxIds = boxes.map((box) => box.id);

    let comboProductsDeleted = 0;
    if (boxIds.length > 0) {
      const deletedProducts = await tx.comboBoxProduct.deleteMany({
        where: { boxId: { in: boxIds } },
      });
      comboProductsDeleted = deletedProducts.count;
    }

    const bundleOrdersDeleted = await tx.bundleOrder.deleteMany({
      where: { shop },
    });
    const comboBoxesDeleted = await tx.comboBox.deleteMany({ where: { shop } });
    const appSettingsDeleted = await tx.appSettings.deleteMany({
      where: { shop },
    });
    const sessionsDeleted = await tx.session.deleteMany({ where: { shop } });
    const shopsDeleted = await tx.shop.deleteMany({ where: { shop } });

    return {
      comboProductsDeleted,
      bundleOrdersDeleted: bundleOrdersDeleted.count,
      comboBoxesDeleted: comboBoxesDeleted.count,
      appSettingsDeleted: appSettingsDeleted.count,
      sessionsDeleted: sessionsDeleted.count,
      shopsDeleted: shopsDeleted.count,
    };
  });

  console.info("[privacy.shop_redact] deleted records", { shop, ...result });

  return new Response();
};
