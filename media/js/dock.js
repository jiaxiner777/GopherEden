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

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const XLINK_NS = 'http://www.w3.org/1999/xlink';

  let latestViewState = null;
  let latestMotionState = null;
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
    if (dragSession) {
      return;
    }

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

    entity.classList.add('dragging');
    entity.setPointerCapture(event.pointerId);
    const point = updateEntityPosition(entity, event);
    dragSession = {
      id: entity.dataset.id || '',
      type: entity.dataset.entity || '',
      element: entity,
      pointerId: event.pointerId,
      x: point.x,
      y: point.y,
    };
  });

  entities.addEventListener('pointermove', (event) => {
    if (!dragSession || event.pointerId !== dragSession.pointerId) {
      return;
    }

    const entity = dragSession.element instanceof HTMLElement && dragSession.element.isConnected
      ? dragSession.element
      : entities.querySelector(`[data-id="${dragSession.id}"]`);
    if (!(entity instanceof HTMLElement)) {
      return;
    }

    dragSession.element = entity;
    const point = updateEntityPosition(entity, event);
    dragSession.x = point.x;
    dragSession.y = point.y;
  });

  entities.addEventListener('pointerup', (event) => finishDrag(event));
  entities.addEventListener('pointercancel', (event) => finishDrag(event));

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) {
      return;
    }

    if (message.type === 'motion') {
      latestMotionState = message.payload;
      applyDockPetMotion(latestMotionState);
      return;
    }

    if (message.type !== 'state') {
      return;
    }

    latestViewState = message.payload;
    latestMotionState = latestViewState.petMotion || latestMotionState;
    if (dragSession) {
      applyDockPetMotion(latestMotionState);
      return;
    }

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
    applyPosition(
      pet,
      dragSession && dragSession.type === 'pet'
        ? { x: dragSession.x, y: dragSession.y }
        : state.petDockPosition,
    );
    if (dragSession && dragSession.type === 'pet') {
      pet.classList.add('dragging');
      dragSession.element = pet;
    }

    const petShell = document.createElement('div');
    petShell.className = 'pet-shell';

    const petShadow = document.createElement('div');
    petShadow.className = 'pet-shadow';
    petShell.appendChild(petShadow);

    const petImage = document.createElement('div');
    petImage.className = 'pet-sprite';
    petImage.setAttribute('role', 'img');
    petImage.setAttribute('aria-label', state.petName);
    petShell.appendChild(petImage);

    const petFocus = document.createElement('div');
    petFocus.className = 'pet-focus';
    petFocus.setAttribute('aria-hidden', 'true');
    petShell.appendChild(petFocus);

    pet.appendChild(petShell);

    const petLabel = document.createElement('div');
    petLabel.className = 'entity-label';
    petLabel.textContent = `${state.petName} · ${visual.stageLabel}`;
    pet.appendChild(petLabel);

    if (latestViewState.petEffect && latestViewState.petEffectNonce !== lastEffectNonce) {
      lastEffectNonce = latestViewState.petEffectNonce;
      decoratePetReaction(pet, latestViewState.petEffect);
    }

    entities.appendChild(pet);
    applyDockPetMotion(latestMotionState || latestViewState.petMotion);

    dockPlacements.forEach((placement) => {
      const furniture = document.createElement('div');
      const placementType = getPlacementType(placement.kind);
      furniture.className = `entity furniture furniture-${placementType} ${placement.kind}`;
      furniture.dataset.entity = 'furniture';
      furniture.dataset.id = placement.id;
      furniture.dataset.placementType = placementType;
      furniture.style.zIndex = '1';
      applyPosition(
        furniture,
        dragSession && dragSession.type === 'furniture' && dragSession.id === placement.id
          ? { x: dragSession.x, y: dragSession.y }
          : placement,
      );
      if (dragSession && dragSession.type === 'furniture' && dragSession.id === placement.id) {
        furniture.classList.add('dragging');
        dragSession.element = furniture;
      }

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

  function applyDockPetMotion(motion) {
    if (!latestViewState || !motion) {
      return;
    }

    const pet = entities.querySelector('[data-entity="pet"]');
    if (!(pet instanceof HTMLElement)) {
      return;
    }

    const petShell = pet.querySelector('.pet-shell');
    const petImage = pet.querySelector('.pet-sprite');
    const petFocus = pet.querySelector('.pet-focus');
    const petShadow = pet.querySelector('.pet-shadow');
    const frames = petFrames[latestViewState.state.petStatus] || petFrames.normal;
    const frameIndex = Number(motion.frameIndex || 0) % Math.max(1, frames.length);

    if (petImage instanceof HTMLElement) {
      petImage.innerHTML = frames[frameIndex] || frames[0] || '';
      petImage.style.setProperty('--motion-head-x', `${Number(motion.headOffsetX || 0).toFixed(2)}px`);
      petImage.style.setProperty('--motion-head-y', `${Number(motion.headOffsetY || 0).toFixed(2)}px`);
      petImage.style.setProperty('--motion-head-rotate', `${Number(motion.headRotateDeg || 0).toFixed(2)}deg`);
    }

    pet.dataset.behavior = motion.activeBehavior || 'settled';
    pet.classList.toggle('is-anticipating', Number(motion.anticipation || 0) > 0.08);
    pet.style.setProperty('--motion-posture', Number(motion.posture || 0).toFixed(3));
    pet.style.setProperty('--motion-arousal', Number(motion.emotionalArousal || 0).toFixed(3));
    pet.style.setProperty('--motion-valence', Number(motion.emotionalValence || 0).toFixed(3));
    pet.style.setProperty('--motion-energy', Number(motion.motionEnergy || 0).toFixed(3));
    pet.style.setProperty('--motion-gaze-x', `${(Number(motion.gazeX || 0) * 2.8).toFixed(2)}px`);
    pet.style.setProperty('--motion-gaze-y', `${(Number(motion.gazeY || 0) * 2.8).toFixed(2)}px`);
    pet.style.setProperty('--motion-focus-opacity', Number(motion.focusOpacity || 0).toFixed(3));

    if (petShell instanceof HTMLElement) {
      petShell.style.setProperty('--motion-body-x', `${Number(motion.bodyOffsetX || 0).toFixed(2)}px`);
      petShell.style.setProperty('--motion-body-y', `${Number(motion.bodyOffsetY || 0).toFixed(2)}px`);
      petShell.style.setProperty('--motion-body-rotate', `${Number(motion.bodyRotateDeg || 0).toFixed(2)}deg`);
      petShell.style.setProperty('--motion-body-scale-x', Number(motion.bodyScaleX || 1).toFixed(4));
      petShell.style.setProperty('--motion-body-scale-y', Number(motion.bodyScaleY || 1).toFixed(4));
    }

    if (petShadow instanceof HTMLElement) {
      petShadow.style.setProperty('--motion-shadow-scale', Number(motion.shadowScale || 1).toFixed(4));
      petShadow.style.setProperty('--motion-shadow-opacity', Number(motion.shadowOpacity || 0.24).toFixed(3));
    }

    if (petFocus instanceof HTMLElement) {
      petFocus.style.opacity = Number(motion.focusOpacity || 0).toFixed(3);
    }
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

    if (!variantUris.length) {
      return;
    }

    const mosaic = document.createElementNS(SVG_NS, 'svg');
    mosaic.classList.add('floor-mosaic');
    mosaic.setAttribute('viewBox', `0 0 ${grid.cols} ${grid.floorRows}`);
    mosaic.setAttribute('preserveAspectRatio', 'none');
    mosaic.setAttribute('aria-hidden', 'true');

    for (let row = 0; row < grid.floorRows; row += 1) {
      for (let col = 0; col < grid.cols; col += 1) {
        const tileUri = selectFloorVariantUri(row, col, variantUris);
        if (!tileUri) {
          continue;
        }

        const image = document.createElementNS(SVG_NS, 'image');
        image.setAttribute('x', String(col));
        image.setAttribute('y', String(row));
        image.setAttribute('width', '1');
        image.setAttribute('height', '1');
        image.setAttribute('preserveAspectRatio', 'none');
        image.setAttribute('href', tileUri);
        image.setAttributeNS(XLINK_NS, 'xlink:href', tileUri);
        mosaic.appendChild(image);
      }
    }

    floorEl.appendChild(mosaic);
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
    const point = getEventPosition(element, event);
    applyPosition(element, point);
    return point;
  }

  function getEventPosition(element, event) {
    const rect = stage.getBoundingClientRect();
    const bounds = getEntityBounds(element);
    return {
      x: clamp((event.clientX - rect.left) / rect.width, bounds.minX, bounds.maxX),
      y: clamp((event.clientY - rect.top) / rect.height, bounds.minY, bounds.maxY),
    };
  }

  function finishDrag(event) {
    if (!dragSession || event.pointerId !== dragSession.pointerId) {
      return;
    }

    const { type, id, x, y, pointerId } = dragSession;
    const entity = dragSession.element instanceof HTMLElement && dragSession.element.isConnected
      ? dragSession.element
      : entities.querySelector(`[data-id="${id}"]`);

    if (entity instanceof HTMLElement) {
      entity.classList.remove('dragging');
      if (entity.hasPointerCapture(pointerId)) {
        entity.releasePointerCapture(pointerId);
      }
    }

    if (type === 'pet') {
      vscode.postMessage({ type: 'movePet', x, y });
    }

    if (type === 'furniture') {
      vscode.postMessage({ type: 'moveFurniture', id, x, y });
    }

    dragSession = null;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  vscode.postMessage({ type: 'ready' });
})();
