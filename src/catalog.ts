import { FurnitureKind, ShopItem } from './types';

export const SHOP_ITEMS: readonly ShopItem[] = [
  {
    kind: 'piano',
    name: '钢琴',
    description: '低调地放一架琴，提醒自己今天也要优雅地写代码。',
    priceBricks: 5,
    priceDew: 0,
  },
  {
    kind: 'bench',
    name: '长椅',
    description: '适合给 Gopher 午休，也适合给你脑内的小灵感坐一坐。',
    priceBricks: 3,
    priceDew: 0,
  },
  {
    kind: 'tree',
    name: '小树',
    description: '在赛博伊甸园里补一点绿意。',
    priceBricks: 4,
    priceDew: 1,
  },
  {
    kind: 'lamp',
    name: '小灯',
    description: '给夜里的重构现场留一盏温柔的灯。',
    priceBricks: 2,
    priceDew: 1,
  },
  {
    kind: 'grass',
    name: '草堆',
    description: '最轻量的装饰，铺一点氛围感。',
    priceBricks: 1,
    priceDew: 0,
  },
];

export const SHOP_ITEM_MAP: Readonly<Record<FurnitureKind, ShopItem>> = SHOP_ITEMS.reduce(
  (result, item) => ({
    ...result,
    [item.kind]: item,
  }),
  {} as Record<FurnitureKind, ShopItem>,
);

export function getShopItem(kind: FurnitureKind): ShopItem {
  return SHOP_ITEM_MAP[kind];
}
