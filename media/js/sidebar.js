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
  const petImage = document.querySelector('.pet-image');

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

  const labelCopy = edenAssets.furnitureLabels || {};

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
  const summerImages = {
    floorTiles: edenAssets.floorTile || '',
    floorBlendMask: edenAssets.floorTileMask || '',
  };

  let latestViewState = null;
  let selectedInventoryKind = null;
  let lastEffectNonce = 0;
  const sectionState = {
    inventory: false,
    placed: false,
    shop: false,
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
    if (!message || message.type !== 'state') {
      return;
    }

    latestViewState = message.payload;
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

    const frames = petFrames[state.petStatus] || petFrames.normal;
    if (petImage instanceof HTMLElement) {
      petImage.innerHTML = frames[viewState.petAnimationFrame % frames.length] || frames[0] || '';
    }
    petStage?.classList.toggle('is-working', state.petStatus === 'working');
    petStage?.classList.toggle('is-alert', state.petStatus === 'startled');

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
        ? `距离 ${growth.nextStageLabel} 还差 ${growth.pointsToNextStage} 点`
        : '已经到达当前版本的最高成长阶段';
    }
  }

  function renderLineagePicker(currentLineage) {
    lineageButtons.forEach((button) => {
      button.classList.toggle('is-active', button.dataset.lineageChoice === currentLineage);
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
          <strong>${labelCopy[entry.kind]}</strong>
          <small>库存 ${entry.count}</small>
        </span>
      `;
      inventoryList.appendChild(button);
    }

    const activeEntry = available.find((entry) => entry.kind === selectedInventoryKind);
    inventoryActions.classList.toggle('is-hidden', !activeEntry);
    if (inventorySelected) {
      inventorySelected.textContent = activeEntry
        ? `当前准备摆放：${labelCopy[activeEntry.kind]}。选择下面的落点方式即可。`
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
            <strong>${labelCopy[placement.kind]}</strong>
            <small>${anchorCopy[placement.anchorType] || '未知位置'}</small>
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
    items.forEach((item) => {
      const affordable = totalBricks >= item.priceBricks && inspirationDew >= item.priceDew;
      const article = document.createElement('article');
      article.className = 'shop-item';
      article.innerHTML = `
        <div class="shop-item-head">
          <img class="shop-thumb" src="${furnitureImages[item.kind] || ''}" alt="${item.name}" />
          <div class="shop-copy">
            <strong>${item.name}</strong>
            <small>${item.description}</small>
          </div>
        </div>
        <div class="shop-item-foot">
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

  document.querySelectorAll('[data-summer-preview]').forEach((node) => {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    const key = node.dataset.summerPreview;
    if (!key) {
      return;
    }
    const asset = summerImages[key];
    if (!asset) {
      return;
    }
    node.style.setProperty('--seasonal-preview-image', `url("${asset}")`);
  });
})();
