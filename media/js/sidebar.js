(function () {
  const vscode = acquireVsCodeApi();
  const body = document.body;
  const assetNode = document.getElementById('eden-assets');
  const edenAssets = assetNode ? JSON.parse(assetNode.textContent || '{}') : {};

  const petName = document.getElementById('pet-name');
  const petStatus = document.getElementById('pet-status');
  const petLineageChip = document.getElementById('pet-lineage-chip');
  const petStageChip = document.getElementById('pet-stage-chip');
  const petStage = document.getElementById('sidebar-pet-stage');
  const petShell = document.querySelector('.pet-shell');
  const petImage = document.querySelector('.pet-image');
  const petFocus = document.querySelector('.pet-focus');

  const bricks = document.getElementById('resource-bricks');
  const dew = document.getElementById('resource-dew');
  const themeButtons = Array.from(document.querySelectorAll('.theme-button'));
  const lineageButtons = Array.from(document.querySelectorAll('[data-lineage-choice]'));

  const toggleButton = document.getElementById('editor-pet-toggle');
  const editorPetSummary = document.getElementById('editor-pet-summary');
  const editorPetScale = document.getElementById('editor-pet-scale');
  const editorPetScaleValue = document.getElementById('editor-pet-scale-value');

  const growthLineage = document.getElementById('growth-lineage');
  const growthLineageHint = document.getElementById('growth-lineage-hint');
  const growthLineageSource = document.getElementById('growth-lineage-source');
  const growthStageName = document.getElementById('growth-stage-name');
  const growthStageDescription = document.getElementById('growth-stage-description');
  const growthPoints = document.getElementById('growth-points');
  const growthProgressBar = document.getElementById('growth-progress-bar');
  const growthProgressLabel = document.getElementById('growth-progress-label');
  const growthNext = document.getElementById('growth-next');
  const growthPreference = document.getElementById('growth-preference');
  const growthBehavior = document.getElementById('growth-behavior');
  const growthStageAbilityTitle = document.getElementById('growth-stage-ability-title');
  const growthStageAbilityHint = document.getElementById('growth-stage-ability-hint');
  const growthStatus = document.getElementById('growth-status');
  const growthStatusHint = document.getElementById('growth-status-hint');
  const growthStagePill = document.getElementById('growth-stage-pill');

  const inventoryList = document.getElementById('inventory-list');
  const inventoryEmpty = document.getElementById('inventory-empty');
  const inventoryActions = document.getElementById('inventory-actions');
  const inventorySelected = document.getElementById('inventory-selected');
  const inventorySummary = document.getElementById('inventory-summary');

  const placedList = document.getElementById('placed-list');
  const placedEmpty = document.getElementById('placed-empty');
  const placedSummary = document.getElementById('placed-summary');

  const shopList = document.getElementById('shop-list');

  const statusCopy = {
    normal: '悠闲中',
    startled: '受惊了',
    working: '认真工作中',
  };

  const anchorCopy = {
    dock: '底部乐园',
    'line-bind': '跟行摆放',
    'viewport-float': '代码区浮层',
  };

  const placementCopy = {
    floor: '地面摆放',
    wall: '墙面挂载',
  };

  const labelCopy = edenAssets.furnitureLabels || {};
  const furniturePlacementTypes = edenAssets.furniturePlacementTypes || {};
  const placeButtons = Array.from(document.querySelectorAll('[data-place-anchor]'));

  const allPetMarkup = edenAssets.allPetMarkup || {};

  function getPetFrames(lineage) {
    const m = allPetMarkup[lineage] || edenAssets.petMarkup || {};
    return {
      normal: [m.normal1 || '', m.normal2 || ''],
      startled: [m.alert1 || '', m.alert2 || ''],
      working: [m.working1 || '', m.working2 || ''],
    };
  }

  let petFrames = getPetFrames('primitives');

  const effectMarkup = {
    heart: edenAssets.effectMarkup?.heart || '',
    sparkle: edenAssets.effectMarkup?.sparkle || '',
    alert: edenAssets.effectMarkup?.alert || '',
  };

  const furnitureImages = edenAssets.furnitureImages || {};

  let latestViewState = null;
  let latestMotionState = null;
  let selectedInventoryKind = null;
  let lastEffectNonce = 0;
  const sectionState = {
    inventory: false,
    placed: false,
    shop: false,
    'growth-ability': false,
    'growth-status': false,
  };

  if (editorPetScale instanceof HTMLInputElement) {
    editorPetScale.addEventListener('input', () => {
      const scale = Number(editorPetScale.value);
      if (editorPetScaleValue) {
        editorPetScaleValue.textContent = `${scale}%`;
      }
      vscode.postMessage({ type: 'setEditorPetScale', scale });
    });
  }

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const lineageHost = target.closest('[data-lineage-choice]');
    if (lineageHost instanceof HTMLElement && lineageHost.dataset.lineageChoice) {
      vscode.postMessage({ type: 'setLineage', lineage: lineageHost.dataset.lineageChoice });
      return;
    }

    const actionHost = target.closest('[data-action]');
    if (actionHost instanceof HTMLElement && actionHost.dataset.action) {
      vscode.postMessage({ type: actionHost.dataset.action });
      return;
    }

    const toggleHost = target.closest('[data-toggle-section]');
    if (toggleHost instanceof HTMLElement && toggleHost.dataset.toggleSection) {
      const section = toggleHost.dataset.toggleSection;
      sectionState[section] = !sectionState[section];
      renderSections();
      return;
    }

    const themeHost = target.closest('[data-theme]');
    if (themeHost instanceof HTMLElement && themeHost.dataset.theme) {
      vscode.postMessage({ type: 'setTheme', theme: themeHost.dataset.theme });
      return;
    }

    const inventoryHost = target.closest('[data-inventory-kind]');
    if (inventoryHost instanceof HTMLElement && inventoryHost.dataset.inventoryKind) {
      selectedInventoryKind = inventoryHost.dataset.inventoryKind;
      render();
      return;
    }

    const placeHost = target.closest('[data-place-anchor]');
    if (placeHost instanceof HTMLElement && placeHost.dataset.placeAnchor && selectedInventoryKind) {
      vscode.postMessage({
        type: 'placeFurniture',
        kind: selectedInventoryKind,
        anchorType: placeHost.dataset.placeAnchor,
      });
      return;
    }

    const buyHost = target.closest('[data-buy-kind]');
    if (buyHost instanceof HTMLElement && buyHost.dataset.buyKind) {
      vscode.postMessage({ type: 'buyItem', kind: buyHost.dataset.buyKind });
      return;
    }

    const placementHost = target.closest('[data-placement-id][data-placement-action]');
    if (placementHost instanceof HTMLElement && placementHost.dataset.placementId && placementHost.dataset.placementAction) {
      vscode.postMessage({
        type: 'placementAction',
        id: placementHost.dataset.placementId,
        action: placementHost.dataset.placementAction,
      });
    }
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) {
      return;
    }

    if (message.type === 'motion') {
      latestMotionState = message.payload;
      applyPetMotion(latestMotionState);
      return;
    }

    if (message.type !== 'state') {
      return;
    }

    latestViewState = message.payload;
    latestMotionState = latestViewState.petMotion || latestMotionState;
    const inventoryKinds = new Set(
      (latestViewState.state.inventory || []).filter((item) => item.count > 0).map((item) => item.kind),
    );
    if (!selectedInventoryKind || !inventoryKinds.has(selectedInventoryKind)) {
      selectedInventoryKind = inventoryKinds.values().next().value || null;
    }
    render();
  });

  function render() {
    if (!latestViewState) {
      return;
    }

    const viewState = latestViewState;
    const state = viewState.state;
    const editorPet = viewState.editorPet;
    const growth = viewState.growth;
    const petVisual = viewState.petVisual;

    body.classList.toggle('theme-cyber-oasis', state.theme === 'cyber-oasis');
    body.classList.toggle('theme-pixel-meadow', state.theme === 'pixel-meadow');

    petFrames = getPetFrames(petVisual.lineage);
    applyPetVisual(petVisual, state.petStatus);

    if (petName) {
      petName.textContent = state.petName;
    }
    if (petStatus) {
      petStatus.textContent = statusCopy[state.petStatus] || statusCopy.normal;
    }
    if (petLineageChip) {
      petLineageChip.textContent = petVisual.lineageLabel;
    }
    if (petStageChip) {
      petStageChip.textContent = petVisual.stageLabel;
    }

    renderPetFrame(latestMotionState || viewState.petMotion || { frameIndex: viewState.petAnimationFrame });
    petStage?.classList.toggle('is-working', state.petStatus === 'working');
    petStage?.classList.toggle('is-alert', state.petStatus === 'startled');
    applyPetMotion(latestMotionState || viewState.petMotion);

    if (bricks) {
      bricks.textContent = String(state.totalBricks);
    }
    if (dew) {
      dew.textContent = String(state.inspirationDew);
    }

    if (toggleButton) {
      toggleButton.textContent = editorPet.toggleLabel;
      toggleButton.classList.toggle('action-primary', !editorPet.enabled);
    }

    if (editorPetSummary) {
      editorPetSummary.textContent = editorPet.statusText;
    }

    if (editorPetScale instanceof HTMLInputElement) {
      editorPetScale.value = String(state.editorPetScale || 100);
    }
    if (editorPetScaleValue) {
      editorPetScaleValue.textContent = `${state.editorPetScale || 100}%`;
    }

    themeButtons.forEach((button) => {
      button.classList.toggle('is-active', button.dataset.theme === state.theme);
    });

    renderGrowth(growth);
    renderLineagePicker(growth.lineage);

    if (viewState.petEffect && viewState.petEffectNonce !== lastEffectNonce) {
      lastEffectNonce = viewState.petEffectNonce;
      triggerPetEffect(petStage, viewState.petEffect);
    }

    renderInventory(state.inventory || []);
    renderPlaced(state.placedFurniture || []);
    renderShop(viewState.shopItems || [], state.totalBricks, state.inspirationDew);
    renderSections();
  }

  function applyPetVisual(visual, status) {
    if (!(petStage instanceof HTMLElement)) {
      return;
    }

    petStage.classList.remove(
      'lineage-primitives',
      'lineage-concurrency',
      'lineage-protocols',
      'lineage-chaos',
      'stage-stage-a',
      'stage-stage-b',
      'stage-stage-c',
    );
    petStage.classList.add(`lineage-${visual.lineage}`, `stage-${visual.stageId}`);
    petStage.dataset.detailLevel = visual.detailLevel;
    petStage.dataset.visualVariant = visual.visualVariant;
    petStage.style.setProperty('--pet-scale', String(visual.sidebarScale));
    petStage.style.setProperty('--pet-filter', visual.sidebarFilter);
    petStage.style.setProperty('--pet-accent', visual.accentColor);
    petStage.style.setProperty('--idle-duration', `${visual.idleMotionMs}ms`);
    petStage.style.setProperty('--working-duration', `${visual.workingMotionMs}ms`);
    petStage.style.setProperty('--alert-duration', `${visual.alertMotionMs}ms`);
    petStage.dataset.status = status;
  }

  function renderPetFrame(motion) {
    if (!(petImage instanceof HTMLElement) || !latestViewState) {
      return;
    }

    const state = latestViewState.state;
    const frames = petFrames[state.petStatus] || petFrames.normal;
    const frameIndex = Number(motion?.frameIndex || 0) % Math.max(1, frames.length);
    petImage.innerHTML = frames[frameIndex] || frames[0] || '';
  }

  function applyPetMotion(motion) {
    if (!(petStage instanceof HTMLElement) || !motion) {
      return;
    }

    petStage.dataset.behavior = motion.activeBehavior || 'settled';
    petStage.classList.toggle('is-anticipating', Number(motion.anticipation || 0) > 0.08);
    petStage.style.setProperty('--motion-body-x', `${Number(motion.bodyOffsetX || 0).toFixed(2)}px`);
    petStage.style.setProperty('--motion-body-y', `${Number(motion.bodyOffsetY || 0).toFixed(2)}px`);
    petStage.style.setProperty('--motion-body-rotate', `${Number(motion.bodyRotateDeg || 0).toFixed(2)}deg`);
    petStage.style.setProperty('--motion-body-scale-x', Number(motion.bodyScaleX || 1).toFixed(4));
    petStage.style.setProperty('--motion-body-scale-y', Number(motion.bodyScaleY || 1).toFixed(4));
    petStage.style.setProperty('--motion-head-x', `${Number(motion.headOffsetX || 0).toFixed(2)}px`);
    petStage.style.setProperty('--motion-head-y', `${Number(motion.headOffsetY || 0).toFixed(2)}px`);
    petStage.style.setProperty('--motion-head-rotate', `${Number(motion.headRotateDeg || 0).toFixed(2)}deg`);
    petStage.style.setProperty('--motion-gaze-x', `${(Number(motion.gazeX || 0) * 2.2).toFixed(2)}px`);
    petStage.style.setProperty('--motion-gaze-y', `${(Number(motion.gazeY || 0) * 2.2).toFixed(2)}px`);
    petStage.style.setProperty('--motion-focus-opacity', Number(motion.focusOpacity || 0).toFixed(3));
    petStage.style.setProperty('--motion-shadow-scale', Number(motion.shadowScale || 1).toFixed(4));
    petStage.style.setProperty('--motion-shadow-opacity', Number(motion.shadowOpacity || 0.24).toFixed(3));
    petStage.style.setProperty('--motion-energy', Number(motion.motionEnergy || 0).toFixed(3));
    petStage.style.setProperty('--motion-posture', Number(motion.posture || 0).toFixed(3));
    petStage.style.setProperty('--motion-arousal', Number(motion.emotionalArousal || 0).toFixed(3));
    petStage.style.setProperty('--motion-valence', Number(motion.emotionalValence || 0).toFixed(3));

    if (petShell instanceof HTMLElement) {
      petShell.style.setProperty('--motion-body-x', `${Number(motion.bodyOffsetX || 0).toFixed(2)}px`);
      petShell.style.setProperty('--motion-body-y', `${Number(motion.bodyOffsetY || 0).toFixed(2)}px`);
      petShell.style.setProperty('--motion-body-rotate', `${Number(motion.bodyRotateDeg || 0).toFixed(2)}deg`);
      petShell.style.setProperty('--motion-body-scale-x', Number(motion.bodyScaleX || 1).toFixed(4));
      petShell.style.setProperty('--motion-body-scale-y', Number(motion.bodyScaleY || 1).toFixed(4));
    }

    if (petFocus instanceof HTMLElement) {
      petFocus.style.opacity = Number(motion.focusOpacity || 0).toFixed(3);
    }

    renderPetFrame(motion);
  }

  function renderGrowth(growth) {
    if (!growth) {
      return;
    }

    if (growthLineage) {
      growthLineage.textContent = growth.lineageLabel;
    }
    if (growthLineageHint) {
      growthLineageHint.textContent = growth.lineageHint;
    }
    if (growthLineageSource) {
      growthLineageSource.textContent = `${growth.lineageSourceLabel} · ${growth.lineageSourceHint}`;
    }
    if (growthStageName) {
      growthStageName.textContent = growth.stageLabel;
    }
    if (growthStageDescription) {
      growthStageDescription.textContent = growth.stageDescription;
    }
    if (growthPoints) {
      growthPoints.textContent = String(growth.growthPoints);
    }

    const stageSpan = growth.nextStageMinPoints
      ? Math.max(1, growth.nextStageMinPoints - growth.stageMinPoints)
      : 1;
    const stageProgress = growth.nextStageMinPoints
      ? Math.max(0, growth.growthPoints - growth.stageMinPoints)
      : stageSpan;
    const progressRatio = growth.nextStageMinPoints
      ? Math.min(Math.max(stageProgress / stageSpan, 0), 1)
      : 1;

    if (growthProgressBar instanceof HTMLElement) {
      growthProgressBar.style.width = `${progressRatio * 100}%`;
    }
    if (growthProgressLabel) {
      growthProgressLabel.textContent = growth.nextStageMinPoints
        ? `本阶段 ${stageProgress} / ${stageSpan}`
        : '当前阶段已满';
    }
    if (growthPreference) {
      growthPreference.textContent = growth.preferredFurnitureLabel;
    }
    if (growthBehavior) {
      growthBehavior.textContent = growth.behaviorHint;
    }
    if (growthStageAbilityTitle) {
      growthStageAbilityTitle.textContent = growth.stageAbilityTitle;
    }
    if (growthStageAbilityHint) {
      growthStageAbilityHint.textContent = growth.stageAbilityHint;
    }
    if (growthStatus) {
      growthStatus.textContent = growth.currentStatusLabel;
    }
    if (growthStatusHint) {
      growthStatusHint.textContent = growth.currentStatusHint;
    }
    if (growthStagePill) {
      growthStagePill.textContent = growth.stageLabel;
    }
    if (growthNext) {
      growthNext.textContent = growth.nextStageLabel
        ? `距 ${growth.nextStageLabel} 还差 ${growth.pointsToNextStage} 点`
        : '已到达当前最高阶段';
    }
  }

  function renderLineagePicker(currentLineage) {
    lineageButtons.forEach((button) => {
      button.classList.toggle('is-active', button.dataset.lineageChoice === currentLineage);
    });
  }

  function getPlacementType(kind) {
    return furniturePlacementTypes[kind] === 'wall' ? 'wall' : 'floor';
  }

  function getPlacementLabel(kind) {
    return placementCopy[getPlacementType(kind)] || placementCopy.floor;
  }

  function getPlacementBadgeMarkup(kind) {
    const placementType = getPlacementType(kind);
    if (placementType === 'wall') {
      return `
        <span class="placement-pill placement-pill-wall" title="墙面挂载">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 2h4v2H8v4.5a2.5 2.5 0 1 0 2.5 2.5H9a1 1 0 1 1-1 1V4H6z" fill="currentColor"></path>
          </svg>
          墙挂
        </span>
      `;
    }

    return '<span class="placement-pill placement-pill-floor">落地</span>';
  }

  function updatePlacementButtons(kind) {
    const wallMounted = getPlacementType(kind) === 'wall';
    placeButtons.forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) {
        return;
      }
      switch (button.dataset.placeAnchor) {
        case 'line-bind':
          button.textContent = wallMounted ? '挂到代码区 · 跟行' : '摆到代码区 · 跟行';
          break;
        case 'viewport-float':
          button.textContent = wallMounted ? '挂到代码区 · 浮层' : '摆到代码区 · 浮层';
          break;
        case 'dock':
          button.textContent = wallMounted ? '挂到底部乐园' : '摆到底部乐园';
          break;
        default:
          break;
      }
    });
  }

  function renderInventory(entries) {
    if (!inventoryList || !inventoryEmpty || !inventoryActions || !inventorySummary) {
      return;
    }

    const available = entries.filter((entry) => entry.count > 0);
    inventorySummary.textContent = `${available.reduce((sum, item) => sum + item.count, 0)} 件可摆放`;
    inventoryEmpty.classList.toggle('is-hidden', available.length > 0);
    inventoryList.innerHTML = '';

    for (const entry of available) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `inventory-item${entry.kind === selectedInventoryKind ? ' is-selected' : ''}`;
      button.dataset.inventoryKind = entry.kind;
      button.innerHTML = `
        <span class="inventory-icon"><img src="${furnitureImages[entry.kind] || ''}" alt="${labelCopy[entry.kind]}" /></span>
        <span class="inventory-copy">
          <span class="item-title-row">
            <strong>${labelCopy[entry.kind]}</strong>
            ${getPlacementBadgeMarkup(entry.kind)}
          </span>
          <small>${getPlacementLabel(entry.kind)} · 库存 ${entry.count}</small>
        </span>
      `;
      inventoryList.appendChild(button);
    }

    const activeEntry = available.find((entry) => entry.kind === selectedInventoryKind);
    inventoryActions.classList.toggle('is-hidden', !activeEntry);
    if (activeEntry) {
      updatePlacementButtons(activeEntry.kind);
    }
    if (inventorySelected) {
      inventorySelected.textContent = activeEntry
        ? `当前准备${getPlacementType(activeEntry.kind) === 'wall' ? '挂载' : '摆放'}：${labelCopy[activeEntry.kind]}（${getPlacementLabel(activeEntry.kind)}）。选择下面的位置即可。`
        : '先选中一个想摆放的家具。';
    }
  }

  function renderPlaced(placements) {
    if (!placedList || !placedEmpty || !placedSummary) {
      return;
    }

    placedSummary.textContent = `${placements.length} 个摆件`;
    placedEmpty.classList.toggle('is-hidden', placements.length > 0);
    placedList.innerHTML = '';

    placements.forEach((placement) => {
      const article = document.createElement('article');
      article.className = 'placed-item';
      article.innerHTML = `
        <div class="placed-item-head">
          <div class="placed-item-copy">
            <span class="item-title-row">
              <strong>${labelCopy[placement.kind]}</strong>
              ${getPlacementBadgeMarkup(placement.kind)}
            </span>
            <small>${getPlacementLabel(placement.kind)} · ${anchorCopy[placement.anchorType] || '未知位置'}</small>
          </div>
          <img class="placed-thumb" src="${furnitureImages[placement.kind] || ''}" alt="${labelCopy[placement.kind]}" />
        </div>
        <div class="placed-actions-grid">
          <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="nudge-left">左移</button>
          <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="nudge-right">右移</button>
          <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="nudge-up">上移</button>
          <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="nudge-down">下移</button>
          <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="to-dock">移到底部</button>
          <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="to-line-bind">跟行</button>
          <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="to-viewport-float">浮层</button>
          <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="return">收回背包</button>
          <button class="mini-button danger" type="button" data-placement-id="${placement.id}" data-placement-action="delete">删除</button>
        </div>
      `;
      placedList.appendChild(article);
    });
  }

  function renderShop(items, totalBricks, inspirationDew) {
    if (!shopList) {
      return;
    }

    shopList.innerHTML = '';
    items
      .filter((item) => item.kind !== 'flower')
      .forEach((item) => {
        const affordable = totalBricks >= item.priceBricks && inspirationDew >= item.priceDew;
        const article = document.createElement('article');
        article.className = `shop-card${affordable ? '' : ' is-disabled'}`;
        article.innerHTML = `
          <div class="placed-main">
            <img class="item-icon" src="${furnitureImages[item.kind] || ''}" alt="${item.name}" />
            <div class="shop-top">
              <span class="item-title-row">
                <strong>${item.name}</strong>
                ${getPlacementBadgeMarkup(item.kind)}
              </span>
              <small>${getPlacementLabel(item.kind)} · ${item.description}</small>
            </div>
          </div>
          <div class="shop-bottom">
            <span class="price-tag">${item.priceBricks} 碎砖 / ${item.priceDew} 露珠</span>
            <button class="mini-button${affordable ? '' : ' is-disabled'}" type="button" data-buy-kind="${item.kind}" ${affordable ? '' : 'disabled'}>购买</button>
          </div>
        `;
        shopList.appendChild(article);
      });
  }

  function renderSections() {
    Object.entries(sectionState).forEach(([section, expanded]) => {
      const root = document.querySelector(`[data-section-root="${section}"]`);
      const body = document.querySelector(`[data-section-body="${section}"]`);
      const indicator = root?.querySelector('.fold-indicator');
      root?.classList.toggle('is-open', expanded);
      body?.classList.toggle('is-hidden', !expanded);
      if (indicator) {
        indicator.textContent = expanded ? '收起' : '展开';
      }
    });
  }

  function triggerPetEffect(container, effect) {
    if (!(container instanceof HTMLElement)) {
      return;
    }

    const effectNode = document.createElement('div');
    effectNode.className = `pet-effect pet-effect-${effect}`;
    effectNode.innerHTML = effectMarkup[effect] || '';
    container.appendChild(effectNode);
    window.setTimeout(() => effectNode.remove(), 1600);
  }

  vscode.postMessage({ type: 'ready' });
})();
