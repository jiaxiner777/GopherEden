import { FurnitureKind, ShopItem } from './types';

export const SHOP_ITEMS: readonly ShopItem[] = [
  {
    kind: 'piano',
    name: '像素钢琴',
    description: '一架暖木色的小钢琴，让底部乐园立刻有了安静又温柔的节奏。',
    priceBricks: 5,
    priceDew: 0,
  },
  {
    kind: 'bench',
    name: '小木椅',
    description: '适合让宠物歇脚的小木椅，也适合给你的灵感留一个座位。',
    priceBricks: 3,
    priceDew: 0,
  },
  {
    kind: 'tree',
    name: '像素盆栽',
    description: '柔软的绿色会让伊甸园多一点呼吸感，和宠物也更搭。',
    priceBricks: 4,
    priceDew: 1,
  },
  {
    kind: 'lamp',
    name: '复古台灯',
    description: '夜里写代码时，一盏像素台灯会让整个角落更像温暖的小屋。',
    priceBricks: 3,
    priceDew: 1,
  },
  {
    kind: 'grass',
    name: '小游戏机',
    description: '一台迷你街机，给乐园留下一点轻松又俏皮的像素娱乐感。',
    priceBricks: 4,
    priceDew: 1,
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
