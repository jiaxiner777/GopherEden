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

  const petFrames = {
    normal: [edenAssets.petMarkup?.normal1 || '', edenAssets.petMarkup?.normal2 || ''],
    startled: [edenAssets.petMarkup?.alert1 || '', edenAssets.petMarkup?.alert2 || ''],
    working: [edenAssets.petMarkup?.working1 || '', edenAssets.petMarkup?.working2 || ''],
  };

  const effectMarkup = {
    heart: edenAssets.effectMarkup?.heart || '',
    sparkle: edenAssets.effectMarkup?.sparkle || '',
    alert: edenAssets.effectMarkup?.alert || '',
  };

  const furnitureImages = {
    piano: body.dataset.assetPiano,
    bench: body.dataset.assetBench,
    tree: body.dataset.assetTree,
    lamp: body.dataset.assetLamp,
    grass: body.dataset.assetGrass,
  };

  const labelCopy = {
    piano: '像素钢琴',
    bench: '小木椅',
    tree: '像素盆栽',
    lamp: '复古台灯',
    grass: '小游戏机',
  };

  let latestViewState = null;
  let dragSession = null;
  let manageOpen = false;
  let lastEffectNonce = 0;

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

  function render() {
    if (!latestViewState) {
      return;
    }

    const state = latestViewState.state;
    const editorPet = latestViewState.editorPet;
    const dockPlacements = (state.placedFurniture || []).filter((placement) => placement.anchorType === 'dock');
    const visual = latestViewState.petVisual;

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
      furniture.className = `entity furniture ${placement.kind}`;
      furniture.dataset.entity = 'furniture';
      furniture.dataset.id = placement.id;
      applyPosition(furniture, placement);

      const image = document.createElement('img');
      image.alt = labelCopy[placement.kind] || placement.kind;
      image.src = furnitureImages[placement.kind];
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
            <img src="${furnitureImages[placement.kind]}" alt="${labelCopy[placement.kind]}" class="item-icon" />
            <div>
              <strong>${labelCopy[placement.kind]}</strong>
              <p class="dock-copy">这里可以直接拖动位置，也可以切回代码区的跟行或浮层投影。</p>
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

  function updateEntityPosition(element, event) {
    const rect = stage.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width, 0.06, 0.96);
    const y = clamp((event.clientY - rect.top) / rect.height, 0.2, 0.88);
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
    const x = clamp(parseFloat(entity.style.left) / 100, 0.06, 0.96);
    const y = clamp(parseFloat(entity.style.top) / 100, 0.2, 0.88);

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