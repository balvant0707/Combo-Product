import db from "../db.server";

function toDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function normalizeAnalyticsComboTypeFilter(value) {
  const normalized = String(value || "all").trim().toLowerCase();
  if (normalized === "simple" || normalized === "specific") return normalized;
  return "all";
}

function isSpecificComboBoxRecord(box) {
  if (!box) return false;

  const configType = Number.parseInt(box?.config?.comboType, 10);
  if (Number.isFinite(configType) && configType > 0) return true;

  const raw = typeof box.comboStepsConfig === "string" ? box.comboStepsConfig.trim() : "";
  if (!raw) return false;

  try {
    const parsed = JSON.parse(raw);
    const parsedType = Number.parseInt(parsed?.comboType ?? parsed?.type, 10);
    if (Number.isFinite(parsedType) && parsedType > 0) return true;
    if (Array.isArray(parsed?.steps) && parsed.steps.length > 0) return true;
  } catch {
    return false;
  }

  return false;
}

function matchesComboTypeFilter(box, comboTypeFilter) {
  if (comboTypeFilter === "all") return true;
  const isSpecific = isSpecificComboBoxRecord(box);
  return comboTypeFilter === "specific" ? isSpecific : !isSpecific;
}

function getComboTypeLabel(box) {
  return isSpecificComboBoxRecord(box) ? "Specific Combo Product" : "Simple Combo Product";
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

function serializeSelectedProducts(value) {
  if (Array.isArray(value)) {
    return JSON.stringify(
      value
        .map((entry) => (entry == null ? "" : String(entry).trim()))
        .filter(Boolean),
    );
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "[]";
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return JSON.stringify(parsed.map((entry) => String(entry)));
    } catch {
      return JSON.stringify([trimmed]);
    }
    return JSON.stringify([trimmed]);
  }

  return "[]";
}

function parseSelectedProducts(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (entry == null ? "" : String(entry).trim()))
      .filter(Boolean);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => (entry == null ? "" : String(entry).trim()))
          .filter(Boolean);
      }
    } catch {
      return [trimmed];
    }

    return [trimmed];
  }

  return [];
}

export async function trackBundleOrder(shop, orderData) {
  const { orderId, boxId, selectedProducts, bundlePrice, giftMessage, orderDate, customerId } = orderData;
  const parsedBoxId = Number.parseInt(String(boxId), 10);
  if (!Number.isFinite(parsedBoxId) || parsedBoxId <= 0) {
    console.warn(`[trackBundleOrder] Invalid boxId received: ${boxId}`);
    return null;
  }

  // Verify box exists for this shop
  const box = await db.comboBox.findFirst({
    where: { id: parsedBoxId, shop },
  });
  if (!box) {
    console.warn(`[trackBundleOrder] Box ${boxId} not found for shop ${shop}`);
    return null;
  }

  // Avoid duplicate tracking
  const existing = await db.bundleOrder.findFirst({
    where: { orderId: String(orderId), shop, boxId: parsedBoxId },
  });
  if (existing) return existing;

  const parsedBundlePrice = Number.parseFloat(String(bundlePrice));
  const safeBundlePrice = Number.isFinite(parsedBundlePrice) ? parsedBundlePrice : 0;

  return db.bundleOrder.create({
    data: {
      shop,
      orderId: String(orderId),
      boxId: parsedBoxId,
      selectedProducts: serializeSelectedProducts(selectedProducts),
      bundlePrice: safeBundlePrice,
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

export async function getAnalytics(shop, from, to, options = {}) {
  const comboTypeFilter = normalizeAnalyticsComboTypeFilter(options.comboTypeFilter);
  const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to) : new Date();

  // Previous period: same duration, immediately before current period
  const periodMs = toDate.getTime() - fromDate.getTime();
  const prevFromDate = new Date(fromDate.getTime() - periodMs);
  const prevToDate = new Date(fromDate.getTime());

  const [rawOrders, rawPrevOrders, rawActiveBoxes] = await Promise.all([
    db.bundleOrder.findMany({
      where: { shop, orderDate: { gte: fromDate, lte: toDate } },
      include: {
        box: {
          select: {
            displayTitle: true,
            itemCount: true,
            comboStepsConfig: true,
            config: { select: { comboType: true } },
          },
        },
      },
      orderBy: { orderDate: "asc" },
    }),
    db.bundleOrder.findMany({
      where: { shop, orderDate: { gte: prevFromDate, lte: prevToDate } },
      include: {
        box: {
          select: {
            comboStepsConfig: true,
            config: { select: { comboType: true } },
          },
        },
      },
      orderBy: { orderDate: "asc" },
    }),
    db.comboBox.findMany({
      where: { shop, isActive: true, deletedAt: null },
      select: {
        id: true,
        displayTitle: true,
        comboStepsConfig: true,
        config: { select: { comboType: true } },
      },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  const orders = rawOrders.filter((order) => matchesComboTypeFilter(order.box, comboTypeFilter));
  const prevOrders = rawPrevOrders.filter((order) => matchesComboTypeFilter(order.box, comboTypeFilter));
  const activeBoxes = rawActiveBoxes.filter((box) => matchesComboTypeFilter(box, comboTypeFilter));

  const totalOrders = orders.length;
  const totalRevenue = orders.reduce((sum, o) => sum + parseFloat(o.bundlePrice), 0);
  const avgBundleValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  const activeBoxCount = activeBoxes.length;

  const prevTotalOrders = prevOrders.length;
  const prevTotalRevenue = prevOrders.reduce((sum, o) => sum + parseFloat(o.bundlePrice), 0);

  // Period-over-period change (null = no previous data to compare)
  const revenueChange =
    prevTotalRevenue > 0
      ? ((totalRevenue - prevTotalRevenue) / prevTotalRevenue) * 100
      : totalRevenue > 0 ? 100 : null;
  const ordersChange =
    prevTotalOrders > 0
      ? ((totalOrders - prevTotalOrders) / prevTotalOrders) * 100
      : totalOrders > 0 ? 100 : null;

  // Top products (from selectedProducts JSON arrays)
  const productCounts = {};
  for (const order of orders) {
    const products = parseSelectedProducts(order.selectedProducts);
    for (const pid of products) {
      productCounts[pid] = (productCounts[pid] || 0) + 1;
    }
  }
  const topProducts = Object.entries(productCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([productId, count]) => ({ productId, count }));

  // Daily trend — every day in range including zeros
  const dailyTrend = buildDailySkeleton(fromDate, toDate);
  const dailyMap = Object.fromEntries(dailyTrend.map((d) => [d.date, d]));
  for (const order of orders) {
    const day = toDateKey(order.orderDate);
    if (dailyMap[day]) {
      dailyMap[day].revenue += parseFloat(order.bundlePrice);
      dailyMap[day].orders += 1;
    }
  }

  // Previous period daily trend (same number of days, shifted back)
  const prevDailyTrend = buildDailySkeleton(prevFromDate, prevToDate);
  const prevDailyMap = Object.fromEntries(prevDailyTrend.map((d) => [d.date, d]));
  for (const order of prevOrders) {
    const day = toDateKey(order.orderDate);
    if (prevDailyMap[day]) {
      prevDailyMap[day].revenue += parseFloat(order.bundlePrice);
      prevDailyMap[day].orders += 1;
    }
  }

  // Box type performance
  const boxPerf = Object.fromEntries(
    activeBoxes.map((box) => [
      box.id,
      { boxId: box.id, boxTitle: box.displayTitle || "Untitled Box", revenue: 0, orders: 0 },
    ]),
  );
  for (const order of orders) {
    const key = order.boxId;
    if (!boxPerf[key]) {
      boxPerf[key] = { boxId: order.boxId, boxTitle: order.box?.displayTitle || "Unknown", revenue: 0, orders: 0 };
    }
    boxPerf[key].revenue += parseFloat(order.bundlePrice);
    boxPerf[key].orders += 1;
  }
  const boxPerformance = Object.values(boxPerf).sort((a, b) => b.revenue - a.revenue);

  const recentOrders = [...orders]
    .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime())
    .slice(0, 10)
    .map((order) => {
      const selected = parseSelectedProducts(order.selectedProducts);
      return {
        id: order.id,
        orderId: order.orderId,
        boxId: order.boxId,
        boxTitle: order.box?.displayTitle || "Unknown Box",
        comboType: isSpecificComboBoxRecord(order.box) ? "specific" : "simple",
        comboTypeLabel: getComboTypeLabel(order.box),
        selectedProducts: selected,
        selectedCount: selected.length,
        itemCount: order.box?.itemCount || 0,
        bundlePrice: parseFloat(order.bundlePrice),
        orderDate: order.orderDate.toISOString(),
      };
    });

  return {
    totalOrders,
    totalRevenue: parseFloat(totalRevenue.toFixed(2)),
    avgBundleValue: parseFloat(avgBundleValue.toFixed(2)),
    activeBoxCount,
    prevTotalOrders,
    prevTotalRevenue: parseFloat(prevTotalRevenue.toFixed(2)),
    revenueChange,
    ordersChange,
    topProducts,
    dailyTrend,
    prevDailyTrend,
    boxPerformance,
    recentOrders,
    comboTypeFilter,
    period: { from: fromDate.toISOString(), to: toDate.toISOString() },
    prevPeriod: { from: prevFromDate.toISOString(), to: prevToDate.toISOString() },
  };
}

export async function getRecentOrders(shop, limit = 10) {
  return db.bundleOrder.findMany({
    where: { shop },
    include: {
      box: {
        select: {
          displayTitle: true,
          itemCount: true,
          comboStepsConfig: true,
          config: { select: { comboType: true } },
        },
      },
    },
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
