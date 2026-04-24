import * as vscode from 'vscode';

import { FurnitureKind, PetLineage } from './types';

const PET_LINEAGE_ASSET_DIRECTORIES: Readonly<Record<PetLineage, readonly string[]>> = {
  primitives: ['pets', 'primitives'],
  concurrency: ['pets', 'concurrency'],
  protocols: ['pets', 'protocols'],
  chaos: ['pets', 'chaos'],
};

const PET_EFFECT_ASSET_DIRECTORY = ['pets', 'common'] as const;
const FURNITURE_DEFAULT_ASSET_DIRECTORY = ['furniture', 'default'] as const;
const FURNITURE_SUMMER_ASSET_DIRECTORY = ['furniture', 'summer_limited'] as const;
const CSS_ASSET_DIRECTORY = ['css'] as const;
const JS_ASSET_DIRECTORY = ['js'] as const;
const UI_ASSET_DIRECTORY = ['ui'] as const;

export function getMediaUri(extensionUri: vscode.Uri, ...segments: readonly string[]): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, 'media', ...segments);
}

export function getWebviewScriptUri(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  fileName: string,
): vscode.Uri {
  return webview.asWebviewUri(getMediaUri(extensionUri, ...JS_ASSET_DIRECTORY, fileName));
}

export function getWebviewStyleUri(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  fileName: string,
): vscode.Uri {
  return webview.asWebviewUri(getMediaUri(extensionUri, ...CSS_ASSET_DIRECTORY, fileName));
}

export function getActivityIconPath(fileName: string): string {
  return ['media', ...UI_ASSET_DIRECTORY, fileName].join('/');
}

export function getReadmeMediaPath(fileName: string): string {
  return ['media', 'docs', fileName].join('/');
}

export function getPetAssetUri(extensionUri: vscode.Uri, lineage: PetLineage, fileName: string): vscode.Uri {
  return getMediaUri(extensionUri, ...PET_LINEAGE_ASSET_DIRECTORIES[lineage], fileName);
}

export function getPetEffectAssetUri(extensionUri: vscode.Uri, fileName: string): vscode.Uri {
  return getMediaUri(extensionUri, ...PET_EFFECT_ASSET_DIRECTORY, fileName);
}

export function getFurnitureAssetUri(extensionUri: vscode.Uri, fileName: string): vscode.Uri {
  return getMediaUri(extensionUri, ...FURNITURE_DEFAULT_ASSET_DIRECTORY, fileName);
}

export function getSummerFurnitureAssetUri(extensionUri: vscode.Uri, fileName: string): vscode.Uri {
  return getMediaUri(extensionUri, ...FURNITURE_SUMMER_ASSET_DIRECTORY, fileName);
}

export function getPetAssetPath(lineage: PetLineage, fileName: string): readonly string[] {
  return [...PET_LINEAGE_ASSET_DIRECTORIES[lineage], fileName];
}

export function getPetEffectAssetPath(fileName: string): readonly string[] {
  return [...PET_EFFECT_ASSET_DIRECTORY, fileName];
}

export function getFurnitureAssetPath(kind: FurnitureKind): readonly string[] {
  return [...FURNITURE_DEFAULT_ASSET_DIRECTORY, getFurnitureAssetFileName(kind)];
}

export function getSummerFurnitureAssetPath(fileName: string): readonly string[] {
  return [...FURNITURE_SUMMER_ASSET_DIRECTORY, fileName];
}

export function getFurnitureAssetFileName(kind: FurnitureKind): string {
  switch (kind) {
    case 'piano':
      return 'piano.svg';
    case 'bench':
      return 'bench.svg';
    case 'tree':
      return 'tree.svg';
    case 'lamp':
      return 'lamp.svg';
    case 'grass':
      return 'grass.svg';
    default:
      return kind satisfies never;
  }
}
