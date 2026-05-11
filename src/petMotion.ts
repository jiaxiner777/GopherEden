import { getGrowthStage, getMotionProfile } from './petConfig';
import { EdenState, PetIdleBehavior, PetMotionUiState, PetStatus } from './types';

type MotionPulseKind = 'interaction' | 'save' | 'error' | 'typing' | 'placement';
type IdleBehavior = Exclude<PetIdleBehavior, 'settled'>;

interface MotionPulse {
  readonly kind: MotionPulseKind;
  readonly intensity: number;
  readonly startedAt: number;
  readonly anticipationUntil: number;
  readonly impulseUntil: number;
  readonly settleUntil: number;
}

interface IdleBehaviorState {
  readonly kind: IdleBehavior;
  readonly startedAt: number;
  readonly endsAt: number;
  readonly nextAt: number;
}

const TAU = Math.PI * 2;
const MIN_IDLE_BEHAVIOR_GAP_MS = 540;

export class PetMotionEngine {
  private readonly seed: number;
  private rngState: number;
  private lastSampleAt = 0;
  private breathPhaseOffset = 0;
  private driftPhaseOffset = 0;
  private currentPulse: MotionPulse | undefined;
  private currentBehavior: IdleBehaviorState | undefined;
  private behaviorHistory: IdleBehavior[] = [];
  private frameHoldUntil = 0;
  private arousal = 0.18;
  private valence = 0.08;
  private alertness = 0.16;
  private lastPose: PetMotionUiState = defaultMotionPose();

  public constructor(seed: number) {
    this.seed = seed >>> 0;
    this.rngState = (this.seed ^ 0xa5a5a5a5) >>> 0;
    this.breathPhaseOffset = this.random() * TAU;
    this.driftPhaseOffset = this.random() * TAU;
  }

  public note(kind: MotionPulseKind, intensity = 1): void {
    const now = Date.now();
    const pulseIntensity = clamp01(intensity);
    const anticipationMs = 70 + Math.round(80 * pulseIntensity);
    const impulseMs = 120 + Math.round(80 * pulseIntensity);
    const settleMs = 190 + Math.round(160 * pulseIntensity);

    this.currentPulse = {
      kind,
      intensity: pulseIntensity,
      startedAt: now,
      anticipationUntil: now + anticipationMs,
      impulseUntil: now + anticipationMs + impulseMs,
      settleUntil: now + anticipationMs + impulseMs + settleMs,
    };

    if (kind === 'error') {
      this.alertness = clamp01(this.alertness + 0.26 * pulseIntensity);
      this.arousal = clamp01(this.arousal + 0.28 * pulseIntensity);
      this.valence = clamp(this.valence - 0.16 * pulseIntensity, -1, 1);
    } else if (kind === 'save') {
      this.valence = clamp(this.valence + 0.2 * pulseIntensity, -1, 1);
      this.arousal = clamp01(this.arousal + 0.16 * pulseIntensity);
    } else if (kind === 'interaction') {
      this.valence = clamp(this.valence + 0.14 * pulseIntensity, -1, 1);
      this.arousal = clamp01(this.arousal + 0.12 * pulseIntensity);
    } else if (kind === 'typing') {
      this.arousal = clamp01(this.arousal + 0.18 * pulseIntensity);
      this.alertness = clamp01(this.alertness + 0.08 * pulseIntensity);
    } else if (kind === 'placement') {
      this.valence = clamp(this.valence + 0.08 * pulseIntensity, -1, 1);
      this.alertness = clamp01(this.alertness + 0.06 * pulseIntensity);
    }
  }

  public sample(state: EdenState, now = Date.now()): PetMotionUiState {
    const dt = this.lastSampleAt > 0 ? clamp(now - this.lastSampleAt, 0, 120) : 16;
    this.lastSampleAt = now;

    const stage = getGrowthStage(state.growthPoints);
    const profile = getMotionProfile(state.petLineage, state.petStatus);
    const motionMultiplier = stage.motionMultiplier;
    const breathPeriod = Math.max(520, profile.motionMs / Math.max(0.5, profile.breathRate));
    const swayPeriod = Math.max(1800, profile.motionMs / Math.max(0.18, profile.swayRate));
    const headPeriod = Math.max(1100, profile.motionMs / Math.max(0.18, profile.headRate));
    const gazePeriod = Math.max(1500, profile.motionMs / Math.max(0.12, profile.gazeRate));
    const posturePeriod = Math.max(2600, profile.motionMs / Math.max(0.08, profile.postureRate));

    const baseArousal = statusBaseArousal(state.petStatus);
    const baseValence = statusBaseValence(state.petStatus);
    const baseAlertness = statusBaseAlertness(state.petStatus);

    this.arousal = approach(this.arousal, baseArousal, dt / Math.max(140, profile.motionMs / Math.max(0.05, profile.arousalDecay)));
    this.valence = approach(this.valence, baseValence, dt / Math.max(180, profile.motionMs * 1.8));
    this.alertness = approach(this.alertness, baseAlertness, dt / Math.max(120, profile.motionMs / Math.max(0.05, profile.alertnessShift + 0.05)));

    const pulse = this.currentPulse;
    const pulseAge = pulse ? now - pulse.startedAt : Number.POSITIVE_INFINITY;
    const pulseTotal = pulse ? Math.max(1, pulse.settleUntil - pulse.startedAt) : 1;
    const pulseProgress = pulse ? clamp01(pulseAge / pulseTotal) : 0;
    const anticipation = pulse && now < pulse.anticipationUntil ? clamp01((pulse.anticipationUntil - now) / Math.max(1, pulse.anticipationUntil - pulse.startedAt)) : 0;
    const impulse = pulse && now >= pulse.anticipationUntil && now < pulse.impulseUntil ? clamp01((now - pulse.anticipationUntil) / Math.max(1, pulse.impulseUntil - pulse.anticipationUntil)) : 0;
    const settle = pulse && now >= pulse.impulseUntil && now < pulse.settleUntil ? clamp01((now - pulse.impulseUntil) / Math.max(1, pulse.settleUntil - pulse.impulseUntil)) : 0;
    const reactionEnvelope = pulse ? triEnvelope(pulseProgress) * profile.reactionStrength * pulse.intensity : 0;

    if (pulse && now >= pulse.settleUntil) {
      this.currentPulse = undefined;
    }

    const motionDrift = smoothNoise(this.seed + 1, (now + this.driftPhaseOffset * 1800) / swayPeriod, 3);
    const motionDriftY = smoothNoise(this.seed + 2, (now + this.driftPhaseOffset * 1400) / (swayPeriod * 1.23), 3);
    const headDrift = smoothNoise(this.seed + 3, (now + this.driftPhaseOffset * 900) / headPeriod, 3);
    const headDriftY = smoothNoise(this.seed + 4, (now + this.driftPhaseOffset * 1100) / (headPeriod * 1.4), 3);
    const gazeDrift = smoothNoise(this.seed + 5, (now + this.driftPhaseOffset * 700) / gazePeriod, 3);
    const gazeDriftY = smoothNoise(this.seed + 6, (now + this.driftPhaseOffset * 1200) / (gazePeriod * 1.26), 3);
    const postureDrift = smoothNoise(this.seed + 7, (now + this.driftPhaseOffset * 1200) / posturePeriod, 3);

    const activeBehavior = this.updateBehavior(now, state.petStatus, profile.motionMs, profile.idleBehaviorWeights);
    const behaviorEnvelope = this.resolveBehaviorEnvelope(now, activeBehavior);

    const breathAngle = TAU * (now / breathPeriod + smoothNoise(this.seed + 8, now / (breathPeriod * 2.8), 2) * 0.035 + this.breathPhaseOffset / TAU);
    const breath = Math.sin(breathAngle);
    const breathLift = breath * profile.breathDepth * motionMultiplier;
    const breathCompression = Math.max(0, breath) * 0.12;

    const attentionBoost = clamp01(this.arousal * 0.55 + this.alertness * 0.45 + Math.abs(this.valence) * 0.12);
    const motionEnergy = clamp01(
      Math.abs(breathLift) * 0.22 +
      Math.abs(motionDrift) * profile.swayDepth * 0.18 +
      Math.abs(headDrift) * profile.headDepth * 0.22 +
      anticipation * 0.68 +
      impulse * 0.42 +
      settle * 0.24 +
      behaviorEnvelope * 0.34 +
      attentionBoost * 0.16,
    );

    const behaviorPose = resolveBehaviorPose(activeBehavior, behaviorEnvelope, motionMultiplier);
    const pulsePose = resolvePulsePose(pulse?.kind, anticipation, impulse, settle, reactionEnvelope, pulse?.intensity ?? 0, state.petStatus);

    const bodyOffsetX = (motionDrift * profile.swayDepth + behaviorPose.bodyOffsetX + pulsePose.bodyOffsetX) * motionMultiplier;
    const bodyOffsetY = (breathLift + motionDriftY * profile.swayDepth * 0.74 + postureDrift * profile.postureDepth * 0.74 + behaviorPose.bodyOffsetY + pulsePose.bodyOffsetY) * motionMultiplier;
    const bodyRotateDeg = (motionDrift * 1.15 + pulsePose.bodyRotateDeg + behaviorPose.bodyRotateDeg) * motionMultiplier;
    const bodyScaleX = 1 + breathCompression * 0.035 + pulsePose.bodyScaleX + behaviorPose.bodyScaleX;
    const bodyScaleY = 1 - breathCompression * 0.06 + pulsePose.bodyScaleY + behaviorPose.bodyScaleY;

    const headOffsetX = (headDrift * profile.headDepth + behaviorPose.headOffsetX + pulsePose.headOffsetX) * motionMultiplier;
    const headOffsetY = (headDriftY * profile.headDepth * 0.62 + behaviorPose.headOffsetY + pulsePose.headOffsetY) * motionMultiplier;
    const headRotateDeg = (headDrift * 1.6 + motionDrift * 0.52 + pulsePose.headRotateDeg + behaviorPose.headRotateDeg) * motionMultiplier;

    const gazeX = clamp(headDrift * profile.gazeDepth * 1.08 + gazeDrift * profile.gazeDepth * 0.86 + behaviorPose.gazeX + pulsePose.gazeX, -1.4, 1.4);
    const gazeY = clamp(headDriftY * profile.gazeDepth * 0.7 + gazeDriftY * profile.gazeDepth * 0.56 + behaviorPose.gazeY + pulsePose.gazeY, -1.2, 1.2);

    const posture = clamp01(0.28 + attentionBoost * 0.34 + behaviorEnvelope * 0.18 + settle * 0.12 + profile.postureDepth * 0.14 + pulsePose.posture);
    const focusOpacity = clamp01(0.12 + motionEnergy * 0.24 + anticipation * 0.14 + attentionBoost * 0.08 + pulsePose.focusOpacity);
    const shadowScale = clamp(1 - breathLift * 0.045 + settle * 0.014 - anticipation * 0.02 + behaviorEnvelope * 0.006, 0.9, 1.08);
    const shadowOpacity = clamp01(0.2 + (1 - motionEnergy) * 0.1 + behaviorEnvelope * 0.04 + settle * 0.04);

    if (pulse && now < pulse.settleUntil) {
      this.frameHoldUntil = Math.max(this.frameHoldUntil, now + Math.round(profile.motionMs * 0.18));
    }

    const frameIndex = this.resolveFrameIndex(now, profile, motionEnergy, anticipation, impulse, settle, activeBehavior, pulse?.kind, breath);

    this.lastPose = {
      frameIndex,
      bodyOffsetX,
      bodyOffsetY,
      bodyRotateDeg,
      bodyScaleX,
      bodyScaleY,
      headOffsetX,
      headOffsetY,
      headRotateDeg,
      gazeX,
      gazeY,
      focusOpacity,
      posture,
      anticipation,
      emotionalArousal: this.arousal,
      emotionalValence: this.valence,
      motionEnergy,
      shadowScale,
      shadowOpacity,
      activeBehavior,
    };

    return this.lastPose;
  }

  public snapshot(): PetMotionUiState {
    return this.lastPose;
  }

  private resolveFrameIndex(
    now: number,
    profile: ReturnType<typeof getMotionProfile>,
    motionEnergy: number,
    anticipation: number,
    impulse: number,
    settle: number,
    activeBehavior: PetIdleBehavior,
    pulseKind: MotionPulseKind | undefined,
    breath: number,
  ): 0 | 1 {
    const accentSignal = Math.max(
      motionEnergy,
      anticipation * 0.9,
      impulse * 0.72,
      settle * 0.38,
      breath > 0.58 ? 0.38 : 0,
      activeBehavior === 'settled' ? 0 : 0.34,
      pulseKind === 'error' ? 0.48 : 0,
      pulseKind === 'save' ? 0.34 : 0,
      pulseKind === 'interaction' ? 0.28 : 0,
      pulseKind === 'typing' ? 0.22 : 0,
    );

    if (accentSignal >= profile.accentThreshold) {
      this.frameHoldUntil = Math.max(this.frameHoldUntil, now + Math.round(profile.motionMs * 0.18));
    }

    if (now < this.frameHoldUntil) {
      return 1;
    }

    if (accentSignal >= profile.accentThreshold * 0.74) {
      return 1;
    }

    return 0;
  }

  private updateBehavior(
    now: number,
    status: PetStatus,
    cycleMs: number,
    behaviorWeights: Readonly<Record<IdleBehavior, number>>,
  ): PetIdleBehavior {
    const current = this.currentBehavior;
    if (current && now < current.endsAt) {
      return current.kind;
    }

    if (current && now >= current.endsAt) {
      this.currentBehavior = undefined;
    }

    if (this.currentPulse && now < this.currentPulse.settleUntil) {
      return 'settled';
    }

    if (now < this.nextBehaviorTime(status)) {
      return 'settled';
    }

    const nextKind = chooseBehavior(status, this.random(), this.behaviorHistory, behaviorWeights);
    const duration = Math.max(180, Math.round(cycleMs * behaviorDurationFactor(nextKind, status)));
    const cooldown = Math.max(MIN_IDLE_BEHAVIOR_GAP_MS, Math.round(cycleMs * behaviorCooldownFactor(nextKind, status)));
    this.currentBehavior = {
      kind: nextKind,
      startedAt: now,
      endsAt: now + duration,
      nextAt: now + duration + cooldown,
    };
    this.behaviorHistory = [nextKind, ...this.behaviorHistory].slice(0, 3);
    return nextKind;
  }

  private nextBehaviorTime(status: PetStatus): number {
    if (!this.currentBehavior) {
      return 0;
    }

    return this.currentBehavior.nextAt + (status === 'startled' ? 120 : status === 'working' ? 40 : 0);
  }

  private resolveBehaviorEnvelope(now: number, behavior: PetIdleBehavior): number {
    if (behavior === 'settled' || !this.currentBehavior) {
      return 0;
    }

    const total = Math.max(1, this.currentBehavior.endsAt - this.currentBehavior.startedAt);
    const progress = clamp01((now - this.currentBehavior.startedAt) / total);
    return triEnvelope(progress);
  }

  private random(): number {
    this.rngState = (this.rngState + 0x6d2b79f5) >>> 0;
    let t = this.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

function defaultMotionPose(): PetMotionUiState {
  return {
    frameIndex: 0,
    bodyOffsetX: 0,
    bodyOffsetY: 0,
    bodyRotateDeg: 0,
    bodyScaleX: 1,
    bodyScaleY: 1,
    headOffsetX: 0,
    headOffsetY: 0,
    headRotateDeg: 0,
    gazeX: 0,
    gazeY: 0,
    focusOpacity: 0.12,
    posture: 0.28,
    anticipation: 0,
    emotionalArousal: 0.18,
    emotionalValence: 0.08,
    motionEnergy: 0,
    shadowScale: 1,
    shadowOpacity: 0.24,
    activeBehavior: 'settled',
  };
}

function statusBaseArousal(status: PetStatus): number {
  if (status === 'working') {
    return 0.36;
  }
  if (status === 'startled') {
    return 0.6;
  }
  return 0.18;
}

function statusBaseValence(status: PetStatus): number {
  if (status === 'working') {
    return 0.1;
  }
  if (status === 'startled') {
    return -0.08;
  }
  return 0.14;
}

function statusBaseAlertness(status: PetStatus): number {
  if (status === 'working') {
    return 0.46;
  }
  if (status === 'startled') {
    return 0.76;
  }
  return 0.24;
}

function resolveBehaviorPose(behavior: PetIdleBehavior, envelope: number, motionMultiplier: number): Pick<PetMotionUiState, 'bodyOffsetX' | 'bodyOffsetY' | 'bodyRotateDeg' | 'bodyScaleX' | 'bodyScaleY' | 'headOffsetX' | 'headOffsetY' | 'headRotateDeg' | 'gazeX' | 'gazeY' | 'posture' | 'focusOpacity'> {
  if (behavior === 'settled') {
    return neutralPose();
  }

  const strength = envelope * motionMultiplier;
  switch (behavior) {
    case 'breath-hold':
      return {
        bodyOffsetX: 0,
        bodyOffsetY: -0.08 * strength,
        bodyRotateDeg: -0.1 * strength,
        bodyScaleX: 0.004 * strength,
        bodyScaleY: -0.01 * strength,
        headOffsetX: 0,
        headOffsetY: -0.08 * strength,
        headRotateDeg: -0.12 * strength,
        gazeX: 0,
        gazeY: -0.02 * strength,
        posture: 0.05 * strength,
        focusOpacity: 0.02 * strength,
      };
    case 'glance-left':
      return {
        bodyOffsetX: -0.08 * strength,
        bodyOffsetY: -0.03 * strength,
        bodyRotateDeg: -0.08 * strength,
        bodyScaleX: 0,
        bodyScaleY: 0,
        headOffsetX: -0.24 * strength,
        headOffsetY: -0.06 * strength,
        headRotateDeg: -0.54 * strength,
        gazeX: -0.62 * strength,
        gazeY: -0.02 * strength,
        posture: 0.05 * strength,
        focusOpacity: 0.04 * strength,
      };
    case 'glance-right':
      return {
        bodyOffsetX: 0.08 * strength,
        bodyOffsetY: -0.03 * strength,
        bodyRotateDeg: 0.08 * strength,
        bodyScaleX: 0,
        bodyScaleY: 0,
        headOffsetX: 0.24 * strength,
        headOffsetY: -0.06 * strength,
        headRotateDeg: 0.54 * strength,
        gazeX: 0.62 * strength,
        gazeY: -0.02 * strength,
        posture: 0.05 * strength,
        focusOpacity: 0.04 * strength,
      };
    case 'head-tilt-left':
      return {
        bodyOffsetX: -0.04 * strength,
        bodyOffsetY: -0.06 * strength,
        bodyRotateDeg: -0.16 * strength,
        bodyScaleX: 0,
        bodyScaleY: 0,
        headOffsetX: -0.12 * strength,
        headOffsetY: -0.08 * strength,
        headRotateDeg: -1.16 * strength,
        gazeX: -0.18 * strength,
        gazeY: -0.04 * strength,
        posture: 0.08 * strength,
        focusOpacity: 0.05 * strength,
      };
    case 'head-tilt-right':
      return {
        bodyOffsetX: 0.04 * strength,
        bodyOffsetY: -0.06 * strength,
        bodyRotateDeg: 0.16 * strength,
        bodyScaleX: 0,
        bodyScaleY: 0,
        headOffsetX: 0.12 * strength,
        headOffsetY: -0.08 * strength,
        headRotateDeg: 1.16 * strength,
        gazeX: 0.18 * strength,
        gazeY: -0.04 * strength,
        posture: 0.08 * strength,
        focusOpacity: 0.05 * strength,
      };
    case 'curious-lean':
      return {
        bodyOffsetX: 0.2 * strength,
        bodyOffsetY: -0.14 * strength,
        bodyRotateDeg: -0.22 * strength,
        bodyScaleX: 0.005 * strength,
        bodyScaleY: -0.018 * strength,
        headOffsetX: 0.28 * strength,
        headOffsetY: -0.18 * strength,
        headRotateDeg: -0.42 * strength,
        gazeX: 0.34 * strength,
        gazeY: -0.08 * strength,
        posture: 0.1 * strength,
        focusOpacity: 0.06 * strength,
      };
    case 'posture-reset':
      return {
        bodyOffsetX: 0,
        bodyOffsetY: 0.02 * strength,
        bodyRotateDeg: 0,
        bodyScaleX: -0.006 * strength,
        bodyScaleY: 0.012 * strength,
        headOffsetX: 0,
        headOffsetY: 0.02 * strength,
        headRotateDeg: 0,
        gazeX: 0,
        gazeY: 0.01 * strength,
        posture: 0.12 * strength,
        focusOpacity: 0.02 * strength,
      };
    case 'attentive-freeze':
      return {
        bodyOffsetX: 0,
        bodyOffsetY: -0.04 * strength,
        bodyRotateDeg: 0,
        bodyScaleX: -0.002 * strength,
        bodyScaleY: -0.006 * strength,
        headOffsetX: 0,
        headOffsetY: -0.02 * strength,
        headRotateDeg: 0,
        gazeX: 0.02 * strength,
        gazeY: -0.03 * strength,
        posture: 0.14 * strength,
        focusOpacity: 0.08 * strength,
      };
    default:
      return neutralPose();
  }
}

function resolvePulsePose(
  kind: MotionPulseKind | undefined,
  anticipation: number,
  impulse: number,
  settle: number,
  envelope: number,
  intensity: number,
  status: PetStatus,
): Pick<PetMotionUiState, 'bodyOffsetX' | 'bodyOffsetY' | 'bodyRotateDeg' | 'bodyScaleX' | 'bodyScaleY' | 'headOffsetX' | 'headOffsetY' | 'headRotateDeg' | 'gazeX' | 'gazeY' | 'posture' | 'focusOpacity'> {
  if (!kind) {
    return neutralPose();
  }

  const pulseStrength = envelope * clamp01(intensity);
  const anticipationScale = anticipation * (status === 'startled' ? 1.28 : 1);
  const impulseScale = impulse * (status === 'working' ? 1.1 : 1);
  const settleScale = settle * 0.82;

  switch (kind) {
    case 'error':
      return {
        bodyOffsetX: -0.24 * anticipationScale + 0.16 * impulseScale - 0.1 * settleScale,
        bodyOffsetY: -0.36 * anticipationScale - 0.14 * impulseScale + 0.12 * settleScale,
        bodyRotateDeg: -1.12 * pulseStrength,
        bodyScaleX: -0.02 * anticipationScale,
        bodyScaleY: -0.04 * anticipationScale - 0.02 * impulseScale + 0.03 * settleScale,
        headOffsetX: -0.18 * anticipationScale + 0.12 * impulseScale,
        headOffsetY: -0.26 * anticipationScale - 0.08 * impulseScale,
        headRotateDeg: -1.8 * pulseStrength,
        gazeX: -0.42 * pulseStrength,
        gazeY: -0.18 * pulseStrength,
        posture: 0.18 * pulseStrength,
        focusOpacity: 0.08 * pulseStrength,
      };
    case 'save':
      return {
        bodyOffsetX: 0.14 * anticipationScale - 0.08 * impulseScale + 0.06 * settleScale,
        bodyOffsetY: -0.18 * anticipationScale - 0.28 * impulseScale + 0.14 * settleScale,
        bodyRotateDeg: 0.52 * pulseStrength,
        bodyScaleX: 0.01 * anticipationScale,
        bodyScaleY: 0.04 * impulseScale - 0.02 * settleScale,
        headOffsetX: 0.1 * anticipationScale,
        headOffsetY: -0.16 * anticipationScale - 0.14 * impulseScale,
        headRotateDeg: 0.84 * pulseStrength,
        gazeX: 0.2 * pulseStrength,
        gazeY: -0.1 * pulseStrength,
        posture: 0.14 * pulseStrength,
        focusOpacity: 0.1 * pulseStrength,
      };
    case 'interaction':
      return {
        bodyOffsetX: 0.1 * anticipationScale + 0.06 * impulseScale - 0.04 * settleScale,
        bodyOffsetY: -0.12 * anticipationScale - 0.18 * impulseScale + 0.1 * settleScale,
        bodyRotateDeg: 0.38 * pulseStrength,
        bodyScaleX: 0.01 * anticipationScale,
        bodyScaleY: 0.02 * impulseScale - 0.02 * settleScale,
        headOffsetX: 0.1 * anticipationScale + 0.08 * impulseScale,
        headOffsetY: -0.1 * anticipationScale - 0.08 * impulseScale,
        headRotateDeg: 0.48 * pulseStrength,
        gazeX: 0.12 * pulseStrength,
        gazeY: -0.06 * pulseStrength,
        posture: 0.08 * pulseStrength,
        focusOpacity: 0.06 * pulseStrength,
      };
    case 'typing':
      return {
        bodyOffsetX: 0.08 * anticipationScale + 0.08 * impulseScale - 0.04 * settleScale,
        bodyOffsetY: -0.08 * anticipationScale - 0.1 * impulseScale + 0.06 * settleScale,
        bodyRotateDeg: 0.26 * pulseStrength,
        bodyScaleX: 0.006 * anticipationScale,
        bodyScaleY: 0.014 * impulseScale - 0.014 * settleScale,
        headOffsetX: 0.06 * anticipationScale + 0.05 * impulseScale,
        headOffsetY: -0.06 * anticipationScale - 0.06 * impulseScale,
        headRotateDeg: 0.36 * pulseStrength,
        gazeX: 0.08 * pulseStrength,
        gazeY: -0.04 * pulseStrength,
        posture: 0.08 * pulseStrength,
        focusOpacity: 0.04 * pulseStrength,
      };
    case 'placement':
      return {
        bodyOffsetX: 0.08 * anticipationScale + 0.05 * impulseScale - 0.04 * settleScale,
        bodyOffsetY: -0.1 * anticipationScale - 0.14 * impulseScale + 0.08 * settleScale,
        bodyRotateDeg: 0.28 * pulseStrength,
        bodyScaleX: 0.006 * anticipationScale,
        bodyScaleY: 0.018 * impulseScale - 0.014 * settleScale,
        headOffsetX: 0.08 * anticipationScale,
        headOffsetY: -0.08 * anticipationScale - 0.06 * impulseScale,
        headRotateDeg: 0.34 * pulseStrength,
        gazeX: 0.1 * pulseStrength,
        gazeY: -0.04 * pulseStrength,
        posture: 0.06 * pulseStrength,
        focusOpacity: 0.05 * pulseStrength,
      };
    default:
      return neutralPose();
  }
}

function chooseBehavior(
  status: PetStatus,
  roll: number,
  history: IdleBehavior[],
  behaviorWeights: Readonly<Record<IdleBehavior, number>>,
): IdleBehavior {
  const weights: Array<[IdleBehavior, number]> = [
    ['breath-hold', behaviorWeights['breath-hold']],
    ['glance-left', behaviorWeights['glance-left']],
    ['glance-right', behaviorWeights['glance-right']],
    ['head-tilt-left', behaviorWeights['head-tilt-left']],
    ['head-tilt-right', behaviorWeights['head-tilt-right']],
    ['curious-lean', behaviorWeights['curious-lean']],
    ['posture-reset', behaviorWeights['posture-reset']],
    ['attentive-freeze', behaviorWeights['attentive-freeze']],
  ];

  for (const entry of weights) {
    const recentPenalty = history.includes(entry[0]) ? 0.45 : 1;
    entry[1] *= recentPenalty;
    if (status === 'working') {
      if (entry[0] === 'attentive-freeze') {
        entry[1] *= 1.5;
      }
      if (entry[0] === 'curious-lean') {
        entry[1] *= 1.14;
      }
      if (entry[0] === 'breath-hold') {
        entry[1] *= 0.72;
      }
    }
    if (status === 'startled') {
      if (entry[0] === 'attentive-freeze') {
        entry[1] *= 1.8;
      }
      if (entry[0] === 'posture-reset') {
        entry[1] *= 1.18;
      }
      if (entry[0] === 'curious-lean') {
        entry[1] *= 0.62;
      }
    }
  }

  const statusBias = status === 'working' ? 0.08 : status === 'startled' ? 0.14 : 0;
  return weightedChoice(weights, (roll + statusBias) % 1) ?? 'glance-left';
}

function behaviorDurationFactor(kind: IdleBehavior, status: PetStatus): number {
  switch (kind) {
    case 'breath-hold':
      return status === 'startled' ? 0.18 : 0.22;
    case 'glance-left':
    case 'glance-right':
      return 0.3;
    case 'head-tilt-left':
    case 'head-tilt-right':
      return 0.36;
    case 'curious-lean':
      return 0.48;
    case 'posture-reset':
      return 0.36;
    case 'attentive-freeze':
      return status === 'startled' ? 0.52 : 0.42;
    default:
      return 0.28;
  }
}

function behaviorCooldownFactor(kind: IdleBehavior, status: PetStatus): number {
  switch (kind) {
    case 'breath-hold':
      return status === 'working' ? 1.18 : 1.12;
    case 'glance-left':
    case 'glance-right':
      return 1.2;
    case 'head-tilt-left':
    case 'head-tilt-right':
      return 1.28;
    case 'curious-lean':
      return 1.36;
    case 'posture-reset':
      return 1.44;
    case 'attentive-freeze':
      return status === 'startled' ? 1.16 : 1.28;
    default:
      return 1.2;
  }
}

function neutralPose(): Pick<PetMotionUiState, 'bodyOffsetX' | 'bodyOffsetY' | 'bodyRotateDeg' | 'bodyScaleX' | 'bodyScaleY' | 'headOffsetX' | 'headOffsetY' | 'headRotateDeg' | 'gazeX' | 'gazeY' | 'posture' | 'focusOpacity'> {
  return {
    bodyOffsetX: 0,
    bodyOffsetY: 0,
    bodyRotateDeg: 0,
    bodyScaleX: 0,
    bodyScaleY: 0,
    headOffsetX: 0,
    headOffsetY: 0,
    headRotateDeg: 0,
    gazeX: 0,
    gazeY: 0,
    posture: 0,
    focusOpacity: 0,
  };
}

function weightedChoice<T>(entries: readonly [T, number][], roll: number): T | undefined {
  const total = entries.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
  if (total <= 0) {
    return undefined;
  }

  let cursor = roll * total;
  for (const [value, weight] of entries) {
    cursor -= Math.max(0, weight);
    if (cursor <= 0) {
      return value;
    }
  }

  return entries[entries.length - 1]?.[0];
}

function triEnvelope(progress: number): number {
  return 1 - Math.abs(1 - clamp01(progress) * 2);
}

function smoothNoise(seed: number, value: number, scale = 1): number {
  const x = value * scale;
  const start = Math.floor(x);
  const end = start + 1;
  const blend = smoothstep(x - start);
  const left = hash(seed, start);
  const right = hash(seed, end);
  return lerp(left, right, blend);
}

function hash(seed: number, input: number): number {
  let value = input | 0;
  value ^= seed + 0x9e3779b9;
  value = Math.imul(value ^ (value >>> 16), 2246822519);
  value = Math.imul(value ^ (value >>> 13), 3266489917);
  return ((value ^ (value >>> 16)) >>> 0) / 2147483648 - 1;
}

function smoothstep(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function lerp(left: number, right: number, amount: number): number {
  return left + (right - left) * amount;
}

function approach(current: number, target: number, amount: number): number {
  return current + (target - current) * clamp01(amount);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
