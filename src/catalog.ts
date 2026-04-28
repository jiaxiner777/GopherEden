import { FurnitureKind, ShopItem } from './types';
import { getShopItemsFromConfig, getShopItemFromConfig } from './roomConfig';

export const SHOP_ITEMS: readonly ShopItem[] = getShopItemsFromConfig();

export const SHOP_ITEM_MAP: Readonly<Record<string, ShopItem>> = SHOP_ITEMS.reduce(
  (result, item) => ({ ...result, [item.kind]: item }),
  {} as Record<string, ShopItem>,
);

export function getShopItem(kind: FurnitureKind): ShopItem | undefined {
  return getShopItemFromConfig(kind);
}
