export function resolveOffers(config, catalog) {
  return config.offerItemIds.map((itemId) => {
    const item = catalog.items.find((entry) => entry.id === itemId);
    if (!item) {
      throw Object.assign(new Error(`Catalog item "${itemId}" cannot be resolved for event "${config.id}".`), {
        code: 'CATALOG_ITEM_NOT_FOUND', itemId
      });
    }
    return item;
  });
}
