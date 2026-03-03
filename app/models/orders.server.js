import db from "../db.server";

function toDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function buildDailySkeleton(fromDate, toDate) {
  const days = [];
  const cursor = new Date(fromDate);
  cursor.setHours(0, 0, 0, 0);

  const end = new Date(toDate);
  end.setHours(0, 0, 0, 0);

  while (cursor <= end) {
    days.push({
      date: toDateKey(cursor),
      revenue: 0,
      orders: 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

export async function trackBundleOrder(shop, orderData) {
  const { orderId, boxId, selectedProducts, bundlePrice, giftMessage, orderDate, customerId } = orderData;

  // Verify box exists for this shop
  const box = await db.comboBox.findFirst({
    where: { id: parseInt(boxId), shop },
  });
  if (!box) {
    console.warn(`[trackBundleOrder] Box ${boxId} not found for shop ${shop}`);
    return null;
  }

  // Avoid duplicate tracking
  const existing = await db.bundleOrder.findFirst({
    where: { orderId: String(orderId), shop },
  });
  if (existing) return existing;

  return db.bundleOrder.create({
    data: {
      shop,
      orderId: String(orderId),
      boxId: parseInt(boxId),
      selectedProducts: Array.isArray(selectedProducts) ? selectedProducts : [],
      bundlePrice: parseFloat(bundlePrice) || 0,
      giftMessage: giftMessage || null,
      orderDate: orderDate instanceof Date ? orderDate : new Date(orderDate),
      customerId: customerId ? String(customerId) : null,
    },
  });
}

export async function getOrders(shop, { page = 1, limit = 20, boxId = null } = {}) {
  const skip = (page - 1) * limit;
  const where = {
    shop,
    ...(boxId ? { boxId: parseInt(boxId) } : {}),
  };

  const [orders, total] = await Promise.all([
    db.bundleOrder.findMany({
      where,
      include: { box: { select: { displayTitle: true, itemCount: true } } },
      orderBy: { orderDate: "desc" },
      skip,
      take: limit,
    }),
    db.bundleOrder.count({ where }),
  ]);

  return { orders, total, page, limit };
}

export async function getAnalytics(shop, from, to) {
  const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to) : new Date();

  const [orders, activeBoxes] = await Promise.all([
    db.bundleOrder.findMany({
      where: {
        shop,
        orderDate: { gte: fromDate, lte: toDate },
      },
      include: { box: { select: { displayTitle: true, itemCount: true } } },
      orderBy: { orderDate: "asc" },
    }),
    db.comboBox.findMany({
      where: { shop, isActive: true, deletedAt: null },
      select: { id: true, displayTitle: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  const totalOrders = orders.length;
  const totalRevenue = orders.reduce(
    (sum, o) => sum + parseFloat(o.bundlePrice),
    0,
  );
  const avgBundleValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  const activeBoxCount = activeBoxes.length;

  // Top products (from selectedProducts JSON arrays)
  const productCounts = {};
  for (const order of orders) {
    const products = Array.isArray(order.selectedProducts)
      ? order.selectedProducts
      : [];
    for (const pid of products) {
      productCounts[pid] = (productCounts[pid] || 0) + 1;
    }
  }
  const topProducts = Object.entries(productCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([productId, count]) => ({ productId, count }));

  // Daily trend (always include every day in range, even if zero orders).
  const dailyTrend = buildDailySkeleton(fromDate, toDate);
  const dailyMap = Object.fromEntries(dailyTrend.map((d) => [d.date, d]));
  for (const order of orders) {
    const day = toDateKey(order.orderDate);
    if (!dailyMap[day]) continue;
    dailyMap[day].revenue += parseFloat(order.bundlePrice);
    dailyMap[day].orders += 1;
  }

  // Box type performance
  const boxPerf = Object.fromEntries(
    activeBoxes.map((box) => [
      box.id,
      {
        boxId: box.id,
        boxTitle: box.displayTitle || "Untitled Box",
        revenue: 0,
        orders: 0,
      },
    ]),
  );

  for (const order of orders) {
    const key = order.boxId;
    if (!boxPerf[key]) {
      boxPerf[key] = {
        boxId: order.boxId,
        boxTitle: order.box?.displayTitle || "Unknown",
        revenue: 0,
        orders: 0,
      };
    }
    boxPerf[key].revenue += parseFloat(order.bundlePrice);
    boxPerf[key].orders += 1;
  }
  const boxPerformance = Object.values(boxPerf).sort(
    (a, b) => b.revenue - a.revenue,
  );

  return {
    totalOrders,
    totalRevenue: parseFloat(totalRevenue.toFixed(2)),
    avgBundleValue: parseFloat(avgBundleValue.toFixed(2)),
    activeBoxCount,
    topProducts,
    dailyTrend,
    boxPerformance,
    period: { from: fromDate.toISOString(), to: toDate.toISOString() },
  };
}

export async function getRecentOrders(shop, limit = 10) {
  return db.bundleOrder.findMany({
    where: { shop },
    include: { box: { select: { displayTitle: true, itemCount: true } } },
    orderBy: { orderDate: "desc" },
    take: limit,
  });
}

export async function getBundlesSoldCount(shop) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return db.bundleOrder.count({
    where: { shop, orderDate: { gte: thirtyDaysAgo } },
  });
}

export async function getBundleRevenue(shop) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const result = await db.bundleOrder.aggregate({
    where: { shop, orderDate: { gte: thirtyDaysAgo } },
    _sum: { bundlePrice: true },
  });
  return parseFloat(result._sum.bundlePrice ?? 0);
}
