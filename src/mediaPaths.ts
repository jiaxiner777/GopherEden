import * as vscode from 'vscode';

import { PetLineage } from './types';

const PET_LINEAGE_ASSET_DIRECTORIES: Readonly<Record<PetLineage, readonly string[]>> = {
  primitives: ['pets', 'primitives'],
  concurrency: ['pets', 'concurrency'],
  protocols: ['pets', 'protocols'],
  chaos: ['pets', 'chaos'],
};

const PET_EFFECT_ASSET_DIRECTORY = ['pets', 'common'] as const;
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

export function getPetAssetPath(lineage: PetLineage, fileName: string): readonly string[] {
  return [...PET_LINEAGE_ASSET_DIRECTORIES[lineage], fileName];
}

export function getPetEffectAssetPath(fileName: string): readonly string[] {
  return [...PET_EFFECT_ASSET_DIRECTORY, fileName];
}
