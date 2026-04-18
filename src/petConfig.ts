import { FurnitureKind, GrowthStageId, PetLineage, PetStatus } from './types';

export interface DetectionLanguageRule {
  readonly languageIds: readonly string[];
  readonly score: number;
}

export interface DetectionKeywordRule {
  readonly pattern: RegExp;
  readonly score: number;
}

export interface DetectionComplexityRule {
  readonly kind: 'lineCount' | 'nesting' | 'errorCount';
  readonly threshold: number;
  readonly score: number;
}

export interface MotionProfile {
  readonly frameHold: number;
  readonly motionMs: number;
}

export interface StageGrowthProfile {
  readonly codeGainCap: number;
  readonly interactionGain: number;
  readonly placementGain: number;
  readonly purchaseGain: number;
  readonly saveGrowthGain: number;
  readonly stableDevelopmentBonusGain: number;
  readonly saveRewardBricks: number;
  readonly supportsEscapeSearch: boolean;
  readonly supportsCelebrationReward: boolean;
  readonly furnitureAffinity: 'weak' | 'medium' | 'strong';
}

export interface GrowthStageDefinition {
  readonly id: GrowthStageId;
  readonly displayName: string;
  readonly minPoints: number;
  readonly maxPoints: number | null;
  readonly description: string;
  readonly uiDescription: string;
  readonly detailLevel: 'minimal' | 'growing' | 'complete';
  readonly behaviorUnlocks: readonly string[];
  readonly abilityTitle: string;
  readonly abilityHint: string;
  readonly editorScaleMultiplier: number;
  readonly dockScaleMultiplier: number;
  readonly sidebarScaleMultiplier: number;
  readonly growthProfile: StageGrowthProfile;
}

export interface LineageDetectionRules {
  readonly languageBoosts: readonly DetectionLanguageRule[];
  readonly keywordRules: readonly DetectionKeywordRule[];
  readonly complexityRules: readonly DetectionComplexityRule[];
}

export interface PetLineageDefinition {
  readonly id: PetLineage;
  readonly displayName: string;
  readonly description: string;
  readonly behaviorHint: string;
  readonly preferredFurniture: readonly FurnitureKind[];
  readonly visualVariant: string;
  readonly paletteKey: string;
  readonly accentColor: string;
  readonly sidebarFilter: string;
  readonly dockFilter: string;
  readonly idleProfile: MotionProfile;
  readonly workingProfile: MotionProfile;
  readonly alertProfile: MotionProfile;
  readonly detectionRules: LineageDetectionRules;
}

export interface DetectionContext {
  readonly languageId: string;
  readonly text: string;
  readonly lineCount: number;
  readonly nestingCount: number;
  readonly errorCount: number;
}

export const GROWTH_STAGES: readonly GrowthStageDefinition[] = [
  {
    id: 'stage-a',
    displayName: '初生期',
    minPoints: 0,
    maxPoints: 99,
    description: '它刚来到这个工程，动作还很稚嫩，更像一只安静观察世界的小宠物。',
    uiDescription: '体型最小、细节最少、动作最轻，像一只刚住进项目里的幼崽。',
    detailLevel: 'minimal',
    behaviorUnlocks: ['基础待机', '基础受惊', '基础工作状态', '可被逗玩'],
    abilityTitle: '基础陪伴动作',
    abilityHint: '当前只解锁基础 idle / alert / working，和家具的联动还很弱，庆祝反馈也最轻。',
    editorScaleMultiplier: 0.88,
    dockScaleMultiplier: 0.92,
    sidebarScaleMultiplier: 0.9,
    growthProfile: {
      codeGainCap: 3,
      interactionGain: 2,
      placementGain: 2,
      purchaseGain: 1,
      saveGrowthGain: 2,
      stableDevelopmentBonusGain: 1,
      saveRewardBricks: 0,
      supportsEscapeSearch: false,
      supportsCelebrationReward: false,
      furnitureAffinity: 'weak',
    },
  },
  {
    id: 'stage-b',
    displayName: '成长期',
    minPoints: 100,
    maxPoints: 299,
    description: '它已经熟悉这个工程，开始真正住进伊甸园，也会主动回应环境和家具。',
    uiDescription: '体型略大、表情更灵动，开始显出种族习惯，也会主动回应空间。',
    detailLevel: 'growing',
    behaviorUnlocks: ['明显家具偏好', '保存成功稳定庆祝', '报错寻找掩体', '互动反馈更热烈'],
    abilityTitle: '习惯养成开启',
    abilityHint: '它开始表现出明确的家具偏好，保存成功会稳定庆祝，报错时也会主动找地方躲起来。',
    editorScaleMultiplier: 1.02,
    dockScaleMultiplier: 1.06,
    sidebarScaleMultiplier: 1.04,
    growthProfile: {
      codeGainCap: 4,
      interactionGain: 3,
      placementGain: 4,
      purchaseGain: 2,
      saveGrowthGain: 4,
      stableDevelopmentBonusGain: 2,
      saveRewardBricks: 1,
      supportsEscapeSearch: true,
      supportsCelebrationReward: true,
      furnitureAffinity: 'medium',
    },
  },
  {
    id: 'stage-c',
    displayName: '成熟期',
    minPoints: 300,
    maxPoints: null,
    description: '它已经成为这个项目的原住民，动作最完整，也最会和空间产生联系。',
    uiDescription: '体型最大、细节最完整、行为最稳定，是已经真正住进项目的原住民。',
    detailLevel: 'complete',
    behaviorUnlocks: ['家具联动最强', '报错逃逸最自然', '保存庆祝最完整', '互动反馈最丰富'],
    abilityTitle: '完整原住民姿态',
    abilityHint: '它会用最完整的动作和空间建立联系，保存、报错和逗玩反馈都更有个性，也能作为后续进化分支的前置阶段。',
    editorScaleMultiplier: 1.16,
    dockScaleMultiplier: 1.2,
    sidebarScaleMultiplier: 1.14,
    growthProfile: {
      codeGainCap: 5,
      interactionGain: 4,
      placementGain: 5,
      purchaseGain: 2,
      saveGrowthGain: 5,
      stableDevelopmentBonusGain: 3,
      saveRewardBricks: 2,
      supportsEscapeSearch: true,
      supportsCelebrationReward: true,
      furnitureAffinity: 'strong',
    },
  },
];

export const PET_LINEAGE_ORDER: readonly PetLineage[] = ['primitives', 'concurrency', 'protocols', 'chaos'];

export const PET_LINEAGES: readonly PetLineageDefinition[] = [
  {
    id: 'primitives',
    displayName: 'Primitives / 原型派',
    description: '最朴素、最亲和、最容易满足，动作圆润又放松。',
    behaviorHint: '它喜欢在长椅和树边慢悠悠地待着，是最可爱松弛的一支。',
    preferredFurniture: ['bench', 'tree'],
    visualVariant: 'soft-rounded',
    paletteKey: 'moss',
    accentColor: '#8fd4a0',
    sidebarFilter: 'sepia(0.16) saturate(1.02) hue-rotate(-10deg) brightness(1.02)',
    dockFilter: 'sepia(0.12) saturate(1.04) hue-rotate(-8deg) brightness(1.02)',
    idleProfile: { frameHold: 3, motionMs: 2550 },
    workingProfile: { frameHold: 2, motionMs: 1500 },
    alertProfile: { frameHold: 2, motionMs: 920 },
    detectionRules: {
      languageBoosts: [
        { languageIds: ['c', 'cpp', 'rust'], score: 2.4 },
        { languageIds: ['go', 'java', 'python'], score: 1.2 },
      ],
      keywordRules: [
        { pattern: /\b(var|let|const|if|else|for|while|bool|boolean|int|int32|int64|string|number)\b/g, score: 0.75 },
        { pattern: /\b(return|break|continue|value|flag|count)\b/g, score: 0.45 },
      ],
      complexityRules: [
        { kind: 'nesting', threshold: 10, score: 1.4 },
      ],
    },
  },
  {
    id: 'concurrency',
    displayName: 'Concurrency / 并发派',
    description: '轻快、灵动、带着明显的速度感，像一只忙碌的小精灵。',
    behaviorHint: '它喜欢靠近台灯和小游戏机，动作最轻快，保存成功时也最兴奋。',
    preferredFurniture: ['lamp', 'grass'],
    visualVariant: 'swift-spark',
    paletteKey: 'spark',
    accentColor: '#7cd8ff',
    sidebarFilter: 'saturate(1.18) hue-rotate(8deg) brightness(1.08)',
    dockFilter: 'saturate(1.22) hue-rotate(12deg) brightness(1.08)',
    idleProfile: { frameHold: 1, motionMs: 1320 },
    workingProfile: { frameHold: 1, motionMs: 900 },
    alertProfile: { frameHold: 1, motionMs: 680 },
    detectionRules: {
      languageBoosts: [
        { languageIds: ['go'], score: 5.5 },
        { languageIds: ['typescript', 'javascript', 'java', 'csharp'], score: 1.5 },
      ],
      keywordRules: [
        { pattern: /\b(go|chan|select|goroutine|mutex|lock|thread|async|await|promise|future)\b/g, score: 1.2 },
        { pattern: /\b(queue|parallel|concurrent|worker|schedule|pool)\b/g, score: 0.8 },
      ],
      complexityRules: [],
    },
  },
  {
    id: 'protocols',
    displayName: 'Protocols / 协议派',
    description: '更稳、更有秩序感，像一个认真整理边界和结构的小管理员。',
    behaviorHint: '它喜欢钢琴和台灯，更偏爱有秩序感的角落，反应也更克制。',
    preferredFurniture: ['piano', 'lamp'],
    visualVariant: 'orderly-keeper',
    paletteKey: 'ember',
    accentColor: '#f5c77b',
    sidebarFilter: 'sepia(0.2) saturate(1.08) hue-rotate(-18deg) brightness(1.04)',
    dockFilter: 'sepia(0.22) saturate(1.12) hue-rotate(-16deg) brightness(1.05)',
    idleProfile: { frameHold: 4, motionMs: 2780 },
    workingProfile: { frameHold: 2, motionMs: 1180 },
    alertProfile: { frameHold: 2, motionMs: 980 },
    detectionRules: {
      languageBoosts: [
        { languageIds: ['java', 'kotlin', 'csharp', 'typescript'], score: 2.8 },
        { languageIds: ['go', 'python'], score: 1.0 },
      ],
      keywordRules: [
        { pattern: /\b(struct|interface|class|type|implements|extends|protocol|schema|request|response|handler|service)\b/g, score: 0.95 },
        { pattern: /\b(model|dto|adapter|contract|repository|controller)\b/g, score: 0.65 },
      ],
      complexityRules: [
        { kind: 'lineCount', threshold: 180, score: 1.2 },
      ],
    },
  },
  {
    id: 'chaos',
    displayName: 'Chaos / 混沌派',
    description: '更跳脱也更戏剧化，平时就有点不安，报错时反应最夸张。',
    behaviorHint: '它更依赖树和长椅这种躲藏型家具，出错时总想先找掩体。',
    preferredFurniture: ['tree', 'bench'],
    visualVariant: 'dramatic-jitter',
    paletteKey: 'storm',
    accentColor: '#ff9a8d',
    sidebarFilter: 'saturate(1.1) hue-rotate(-24deg) brightness(1.03)',
    dockFilter: 'saturate(1.12) hue-rotate(-22deg) brightness(1.04)',
    idleProfile: { frameHold: 1, motionMs: 1760 },
    workingProfile: { frameHold: 1, motionMs: 980 },
    alertProfile: { frameHold: 1, motionMs: 560 },
    detectionRules: {
      languageBoosts: [
        { languageIds: ['bash', 'shellscript'], score: 1.8 },
      ],
      keywordRules: [
        { pattern: /\b(switch|case|catch|panic|recover|throw|error|errors|err|retry|fallback)\b/g, score: 0.92 },
        { pattern: /\b(timeout|rollback|fail|failure|unexpected|edge)\b/g, score: 0.7 },
      ],
      complexityRules: [
        { kind: 'nesting', threshold: 12, score: 2.2 },
        { kind: 'errorCount', threshold: 1, score: 6 },
        { kind: 'lineCount', threshold: 220, score: 1.2 },
      ],
    },
  },
];

const LINEAGE_MAP: Readonly<Record<PetLineage, PetLineageDefinition>> = PET_LINEAGES.reduce(
  (result, lineage) => ({
    ...result,
    [lineage.id]: lineage,
  }),
  {} as Record<PetLineage, PetLineageDefinition>,
);

const STAGE_MAP: Readonly<Record<GrowthStageId, GrowthStageDefinition>> = GROWTH_STAGES.reduce(
  (result, stage) => ({
    ...result,
    [stage.id]: stage,
  }),
  {} as Record<GrowthStageId, GrowthStageDefinition>,
);

export function getGrowthStage(points: number): GrowthStageDefinition {
  return GROWTH_STAGES.find((stage) => points >= stage.minPoints && (stage.maxPoints === null || points <= stage.maxPoints))
    ?? GROWTH_STAGES[0];
}

export function getGrowthStageById(stageId: GrowthStageId): GrowthStageDefinition {
  return STAGE_MAP[stageId];
}

export function getLineageDefinition(lineage: PetLineage): PetLineageDefinition {
  return LINEAGE_MAP[lineage];
}

export function getMotionProfile(lineage: PetLineage, status: PetStatus): MotionProfile {
  const definition = getLineageDefinition(lineage);
  if (status === 'working') {
    return definition.workingProfile;
  }
  if (status === 'startled') {
    return definition.alertProfile;
  }
  return definition.idleProfile;
}

export function scoreLineageDetection(
  definition: PetLineageDefinition,
  context: DetectionContext,
): number {
  let score = 0;

  for (const languageRule of definition.detectionRules.languageBoosts) {
    if (languageRule.languageIds.includes(context.languageId)) {
      score += languageRule.score;
    }
  }

  for (const keywordRule of definition.detectionRules.keywordRules) {
    const matches = context.text.match(keywordRule.pattern);
    if (!matches?.length) {
      continue;
    }

    score += Math.min(matches.length, 18) * keywordRule.score;
  }

  for (const complexityRule of definition.detectionRules.complexityRules) {
    if (complexityRule.kind === 'lineCount' && context.lineCount >= complexityRule.threshold) {
      score += complexityRule.score;
    }
    if (complexityRule.kind === 'nesting' && context.nestingCount >= complexityRule.threshold) {
      score += complexityRule.score;
    }
    if (complexityRule.kind === 'errorCount' && context.errorCount >= complexityRule.threshold) {
      score += complexityRule.score;
    }
  }

  return score;
}
