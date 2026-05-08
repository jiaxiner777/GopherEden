(function () {
  const vscode = acquireVsCodeApi();
  const body = document.body;
  const assetNode = document.getElementById('eden-assets');
  const edenAssets = assetNode ? JSON.parse(assetNode.textContent || '{}') : {};
  const stage = document.getElementById('stage');
  const entities = document.getElementById('entities');
  const toggleButton = document.getElementById('dock-editor-pet-toggle');
  const editorPetSummary = document.getElementById('editor-pet-summary');
  const dockList = document.getElementById('dock-list');
  const dockEmpty = document.getElementById('dock-empty');
  const dockSummary = document.getElementById('dock-summary');
  const dockManageToggle = document.getElementById('dock-manage-toggle');
  const dockManageBody = document.getElementById('dock-manage-body');
  const dockFoldIndicator = document.getElementById('dock-fold-indicator');
  const dockLineageChip = document.getElementById('dock-lineage-chip');
  const dockStageChip = document.getElementById('dock-stage-chip');

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
  const labelCopy = edenAssets.furnitureLabels || {};
  const furniturePlacementTypes = edenAssets.furniturePlacementTypes || {};
  const roomLayout = edenAssets.roomLayout || null;
  const roomVisuals = edenAssets.roomVisuals || null;

  let latestViewState = null;
  let dragSession = null;
  let manageOpen = false;
  let lastEffectNonce = 0;

  if (roomLayout) {
    initRoomLayout(roomLayout, roomVisuals);
  }

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const actionHost = target.closest('[data-action]');
    if (actionHost instanceof HTMLElement && actionHost.dataset.action) {
      vscode.postMessage({ type: actionHost.dataset.action });
      return;
    }

    if (dockManageToggle && target.closest('#dock-manage-toggle')) {
      manageOpen = !manageOpen;
      renderManageState();
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

  entities.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const entity = target.closest('[data-entity]');
    if (!(entity instanceof HTMLElement)) {
      return;
    }

    if (entity.dataset.entity !== 'pet' && entity.dataset.entity !== 'furniture') {
      return;
    }

    dragSession = {
      id: entity.dataset.id || '',
      type: entity.dataset.entity || '',
    };
    entity.classList.add('dragging');
    entity.setPointerCapture(event.pointerId);
    updateEntityPosition(entity, event);
  });

  entities.addEventListener('pointermove', (event) => {
    if (!dragSession) {
      return;
    }

    const entity = entities.querySelector(`[data-id="${dragSession.id}"]`);
    if (!(entity instanceof HTMLElement)) {
      return;
    }

    updateEntityPosition(entity, event);
  });

  entities.addEventListener('pointerup', (event) => finishDrag(event));
  entities.addEventListener('pointercancel', (event) => finishDrag(event));

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || message.type !== 'state') {
      return;
    }

    latestViewState = message.payload;
    render();
  });

  function getPlacementType(kind) {
    return furniturePlacementTypes[kind] === 'wall' ? 'wall' : 'floor';
  }

  function getPlacementLabel(kind) {
    return getPlacementType(kind) === 'wall' ? '墙面挂载' : '地面摆放';
  }

  function getPlacementBadgeMarkup(kind) {
    if (getPlacementType(kind) === 'wall') {
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

  function render() {
    if (!latestViewState) {
      return;
    }

    const state = latestViewState.state;
    const editorPet = latestViewState.editorPet;
    const dockPlacements = (state.placedFurniture || []).filter((placement) => placement.anchorType === 'dock');
    const visual = latestViewState.petVisual;
    petFrames = getPetFrames(visual.lineage);

    entities.innerHTML = '';
    body.dataset.lineage = visual.lineage;
    body.dataset.stage = visual.stageId;

    if (toggleButton) {
      toggleButton.textContent = editorPet.toggleLabel;
      toggleButton.classList.toggle('secondary', editorPet.enabled);
    }

    if (editorPetSummary) {
      editorPetSummary.textContent = editorPet.statusText;
    }
    if (dockLineageChip) {
      dockLineageChip.textContent = visual.lineageLabel;
    }
    if (dockStageChip) {
      dockStageChip.textContent = visual.stageLabel;
    }

    const pet = document.createElement('div');
    pet.className = `entity pet pet-status-${state.petStatus} lineage-${visual.lineage} stage-${visual.stageId}`;
    pet.dataset.entity = 'pet';
    pet.dataset.id = 'pet';
    pet.style.zIndex = '2';
    pet.style.setProperty('--pet-scale', String(visual.dockScale));
    pet.style.setProperty('--pet-filter', visual.dockFilter);
    pet.style.setProperty('--pet-accent', visual.accentColor);
    pet.style.setProperty('--idle-duration', `${visual.idleMotionMs}ms`);
    pet.style.setProperty('--working-duration', `${visual.workingMotionMs}ms`);
    pet.style.setProperty('--alert-duration', `${visual.alertMotionMs}ms`);
    applyPosition(pet, state.petDockPosition);

    const petImage = document.createElement('div');
    petImage.className = 'pet-sprite';
    petImage.setAttribute('role', 'img');
    petImage.setAttribute('aria-label', state.petName);
    const frames = petFrames[state.petStatus] || petFrames.normal;
    petImage.innerHTML = frames[latestViewState.petAnimationFrame % frames.length] || frames[0] || '';
    pet.appendChild(petImage);

    const petLabel = document.createElement('div');
    petLabel.className = 'entity-label';
    petLabel.textContent = `${state.petName} · ${visual.stageLabel}`;
    pet.appendChild(petLabel);

    if (latestViewState.petEffect && latestViewState.petEffectNonce !== lastEffectNonce) {
      lastEffectNonce = latestViewState.petEffectNonce;
      decoratePetReaction(pet, latestViewState.petEffect);
    }

    entities.appendChild(pet);

    dockPlacements.forEach((placement) => {
      const furniture = document.createElement('div');
      const placementType = getPlacementType(placement.kind);
      furniture.className = `entity furniture furniture-${placementType} ${placement.kind}`;
      furniture.dataset.entity = 'furniture';
      furniture.dataset.id = placement.id;
      furniture.dataset.placementType = placementType;
      furniture.style.zIndex = '1';
      applyPosition(furniture, placement);

      const image = document.createElement('img');
      image.alt = labelCopy[placement.kind] || placement.kind;
      image.src = furnitureImages[placement.kind] || '';
      furniture.appendChild(image);
      entities.appendChild(furniture);
    });

    if (dockSummary) {
      dockSummary.textContent = `${dockPlacements.length} 个摆件`;
    }
    dockEmpty?.classList.toggle('is-hidden', dockPlacements.length > 0);
    if (dockList) {
      dockList.innerHTML = dockPlacements.map((placement) => `
        <article class="dock-card">
          <div class="dock-card-main">
            <img src="${furnitureImages[placement.kind] || ''}" alt="${labelCopy[placement.kind] || placement.kind}" class="item-icon" />
            <div>
              <div class="item-title-row">
                <strong>${labelCopy[placement.kind] || placement.kind}</strong>
                ${getPlacementBadgeMarkup(placement.kind)}
              </div>
              <p class="dock-copy">${getPlacementLabel(placement.kind)} · 这里可以直接拖动位置，也可以切回代码区的跟行或浮层投影。</p>
            </div>
          </div>
          <div class="dock-actions">
            <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="to-line-bind">改为跟行</button>
            <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="to-viewport-float">改为浮层</button>
            <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="return">收回背包</button>
            <button class="mini-button danger" type="button" data-placement-id="${placement.id}" data-placement-action="delete">删除</button>
          </div>
        </article>
      `).join('');
    }

    renderManageState();
  }

  function initRoomLayout(config, visuals) {
    if (!stage) {
      return;
    }

    const grid = config.stage;
    const theme = config.theme;
    const wallRatio = grid.floorStartRow / grid.rows;
    const floorRatio = grid.floorRows / grid.rows;

    stage.style.setProperty('--backdrop-color', theme.backdropColor || '#2c1e15');
    stage.style.setProperty('--wall-ratio', String(wallRatio));
    stage.style.setProperty('--floor-ratio', String(floorRatio));
    stage.style.setProperty('--grid-cols', String(grid.cols));
    stage.style.setProperty('--floor-rows', String(grid.floorRows));
    stage.style.setProperty('--wall-upper-tile', visuals?.wallUpperTile ? `url("${visuals.wallUpperTile}")` : 'none');
    stage.style.setProperty('--wall-lower-tile', visuals?.wallLowerTile ? `url("${visuals.wallLowerTile}")` : 'none');
    stage.style.setProperty('--window-sprite', visuals?.windowSprite ? `url("${visuals.windowSprite}")` : 'none');
    stage.style.setProperty('--window-glow-color', theme.window.glowColor || 'rgba(255, 218, 130, 0.32)');
    stage.style.setProperty('--sun-patch-color', theme.window.sunPatchColor || 'rgba(255, 220, 132, 0.28)');
    stage.style.setProperty('--ao-color', theme.wall.aoColor || 'rgba(44, 24, 10, 0.72)');
    stage.style.setProperty('--vignette-color', theme.wall.vignetteColor || 'rgba(28, 16, 8, 0.34)');
    stage.style.setProperty('--floor-tile-mask', visuals?.floorTileMask ? `url("${visuals.floorTileMask}")` : 'none');

    const wallpaperEl = stage.querySelector('.wallpaper');
    const wallLowerEl = stage.querySelector('.wall-lower');
    const windowFrameEl = stage.querySelector('.window-frame');
    const wallGlowEl = stage.querySelector('.wall-glow');
    const sunPatchEl = stage.querySelector('.sun-patch');
    const aoLineEl = stage.querySelector('.ao-line');
    const rugEl = stage.querySelector('.rug');

    if (wallpaperEl instanceof HTMLElement) {
      wallpaperEl.style.height = `${wallRatio * 100}%`;
    }

    const lowerTopRatio = (grid.floorStartRow - theme.wall.lowerRows) / grid.rows;
    const lowerHeightRatio = theme.wall.lowerRows / grid.rows;
    if (wallLowerEl instanceof HTMLElement) {
      wallLowerEl.style.top = `${lowerTopRatio * 100}%`;
      wallLowerEl.style.height = `${lowerHeightRatio * 100}%`;
    }

    const win = theme.window;
    const winLeft = win.pos[0] / grid.cols;
    const winTop = win.pos[1] / grid.rows;
    const winWidth = win.size[0] / grid.cols;
    const winHeight = win.size[1] / grid.rows;

    if (windowFrameEl instanceof HTMLElement) {
      windowFrameEl.style.left = `${winLeft * 100}%`;
      windowFrameEl.style.top = `${winTop * 100}%`;
      windowFrameEl.style.width = `${winWidth * 100}%`;
      windowFrameEl.style.height = `${winHeight * 100}%`;
    }

    if (wallGlowEl instanceof HTMLElement) {
      const glowPadX = 1.25 / grid.cols;
      const glowPadY = 0.85 / grid.rows;
      wallGlowEl.style.left = `${Math.max(0, winLeft - glowPadX) * 100}%`;
      wallGlowEl.style.top = `${Math.max(0, winTop - glowPadY) * 100}%`;
      wallGlowEl.style.width = `${Math.min(1, winWidth + glowPadX * 2) * 100}%`;
      wallGlowEl.style.height = `${Math.min(1, winHeight + glowPadY * 2) * 100}%`;
    }

    if (sunPatchEl instanceof HTMLElement) {
      const patchWidthCols = Math.min(grid.cols * 0.44, win.size[0] * 2.4);
      const patchHeightRows = Math.min(grid.floorRows * 1.2, 1.6);
      const patchLeftCols = clamp((win.pos[0] + win.size[0] * 0.5) - patchWidthCols * 0.5, 0, grid.cols - patchWidthCols);
      const patchTopRows = grid.floorStartRow + 0.18;
      sunPatchEl.style.left = `${(patchLeftCols / grid.cols) * 100}%`;
      sunPatchEl.style.top = `${(patchTopRows / grid.rows) * 100}%`;
      sunPatchEl.style.width = `${(patchWidthCols / grid.cols) * 100}%`;
      sunPatchEl.style.height = `${(patchHeightRows / grid.rows) * 100}%`;
    }

    if (aoLineEl instanceof HTMLElement) {
      aoLineEl.style.top = `${wallRatio * 100}%`;
    }

    if (rugEl instanceof HTMLElement) {
      if (theme.rug) {
        const rug = theme.rug;
        rugEl.classList.remove('is-hidden');
        rugEl.style.left = `${rug.pos[0] / grid.cols * 100}%`;
        rugEl.style.top = `${rug.pos[1] / grid.rows * 100}%`;
        rugEl.style.width = `${rug.size[0] / grid.cols * 100}%`;
        rugEl.style.height = `${rug.size[1] / grid.rows * 100}%`;
        rugEl.style.setProperty('--rug-color', rug.color);
        rugEl.style.setProperty('--rug-stripe', rug.stripeColor);
      } else {
        rugEl.classList.add('is-hidden');
      }
    }

    buildFloorTiles(grid, visuals);
  }

  function buildFloorTiles(grid, visuals) {
    const floorEl = stage?.querySelector('.floor');
    if (!(floorEl instanceof HTMLElement)) {
      return;
    }

    const variantUris = visuals?.floorTileVariants?.length ? visuals.floorTileVariants : visuals?.floorTile ? [visuals.floorTile] : [];
    const signature = JSON.stringify({ cols: grid.cols, rows: grid.floorRows, variantUris });
    if (floorEl.dataset.signature === signature) {
      return;
    }

    floorEl.dataset.signature = signature;
    floorEl.innerHTML = '';

    for (let row = 0; row < grid.floorRows; row += 1) {
      for (let col = 0; col < grid.cols; col += 1) {
        const cell = document.createElement('div');
        cell.className = 'floor-tile-cell';
        const tileUri = selectFloorVariantUri(row, col, variantUris);
        cell.style.setProperty('--floor-cell-image', tileUri ? `url("${tileUri}")` : 'none');
        floorEl.appendChild(cell);
      }
    }
  }

  function selectFloorVariantUri(row, col, variantUris) {
    if (!variantUris.length) {
      return '';
    }
    if (variantUris.length === 1) {
      return variantUris[0];
    }

    const biasPattern = [0, 0, 1, 0, 2, 0, 3, 0];
    const seed = (row * 11 + col * 7 + row * col * 3) % biasPattern.length;
    return variantUris[biasPattern[seed] % variantUris.length];
  }

  function decoratePetReaction(host, effect) {
    host.classList.remove('is-heart', 'is-sparkle', 'is-alert-react');
    host.querySelectorAll('.pet-effect').forEach((node) => node.remove());
    void host.offsetWidth;
    host.classList.add(effect === 'heart' ? 'is-heart' : effect === 'sparkle' ? 'is-sparkle' : 'is-alert-react');

    const bubble = document.createElement('div');
    bubble.className = `pet-effect effect-${effect}`;
    bubble.innerHTML = effectMarkup[effect] || '';
    host.appendChild(bubble);

    window.setTimeout(() => {
      bubble.remove();
      host.classList.remove('is-heart', 'is-sparkle', 'is-alert-react');
    }, 1400);
  }

  function renderManageState() {
    if (!dockManageBody || !dockFoldIndicator) {
      return;
    }

    dockManageBody.classList.toggle('is-hidden', !manageOpen);
    dockFoldIndicator.textContent = manageOpen ? '收起' : '展开';
  }

  function applyPosition(element, point) {
    element.style.left = `${point.x * 100}%`;
    element.style.top = `${point.y * 100}%`;
  }

  function getEntityBounds(element) {
    if (!roomLayout || element.dataset.entity !== 'furniture') {
      return { minX: 0.06, maxX: 0.96, minY: 0.2, maxY: 0.88 };
    }

    const wallRatio = roomLayout.stage.floorStartRow / roomLayout.stage.rows;
    if (element.dataset.placementType === 'wall') {
      return { minX: 0.08, maxX: 0.92, minY: 0.18, maxY: Math.max(0.3, wallRatio - 0.06) };
    }

    return { minX: 0.08, maxX: 0.92, minY: Math.min(0.76, wallRatio + 0.04), maxY: 0.88 };
  }

  function updateEntityPosition(element, event) {
    const rect = stage.getBoundingClientRect();
    const bounds = getEntityBounds(element);
    const x = clamp((event.clientX - rect.left) / rect.width, bounds.minX, bounds.maxX);
    const y = clamp((event.clientY - rect.top) / rect.height, bounds.minY, bounds.maxY);
    applyPosition(element, { x, y });
  }

  function finishDrag(event) {
    if (!dragSession) {
      return;
    }

    const entity = entities.querySelector(`[data-id="${dragSession.id}"]`);
    if (!(entity instanceof HTMLElement)) {
      dragSession = null;
      return;
    }

    entity.classList.remove('dragging');
    const bounds = getEntityBounds(entity);
    const x = clamp(parseFloat(entity.style.left) / 100, bounds.minX, bounds.maxX);
    const y = clamp(parseFloat(entity.style.top) / 100, bounds.minY, bounds.maxY);

    if (dragSession.type === 'pet') {
      vscode.postMessage({ type: 'movePet', x, y });
    }

    if (dragSession.type === 'furniture') {
      vscode.postMessage({ type: 'moveFurniture', id: dragSession.id, x, y });
    }

    if (entity.hasPointerCapture(event.pointerId)) {
      entity.releasePointerCapture(event.pointerId);
    }

    dragSession = null;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  vscode.postMessage({ type: 'ready' });
})();
