(function () {
  const vscode = acquireVsCodeApi();
  const body = document.body;
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

  const petImages = {
    normal: body.dataset.petNormal,
    startled: body.dataset.petAlert,
    working: body.dataset.petWorking,
  };

  const furnitureImages = {
    piano: body.dataset.assetPiano,
    bench: body.dataset.assetBench,
    tree: body.dataset.assetTree,
    lamp: body.dataset.assetLamp,
    grass: body.dataset.assetGrass,
  };

  const labelCopy = {
    piano: '\u94a2\u7434',
    bench: '\u957f\u6905',
    tree: '\u5c0f\u6811',
    lamp: '\u5c0f\u706f',
    grass: '\u8349\u5806',
  };

  let latestViewState = null;
  let dragSession = null;
  let manageOpen = false;

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const actionHost = target.closest('[data-action]');
    if (actionHost instanceof HTMLElement) {
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

    entities.innerHTML = '';

    if (toggleButton) {
      toggleButton.textContent = editorPet.toggleLabel;
      toggleButton.classList.toggle('secondary', editorPet.enabled);
    }

    if (editorPetSummary) {
      editorPetSummary.textContent = editorPet.statusText;
    }

    const pet = document.createElement('div');
    pet.className = 'entity pet';
    pet.dataset.entity = 'pet';
    pet.dataset.id = 'pet';
    applyPosition(pet, state.petDockPosition);

    const petImage = document.createElement('img');
    petImage.alt = state.petName;
    petImage.src = petImages[state.petStatus] || petImages.normal;
    pet.appendChild(petImage);

    const petLabel = document.createElement('div');
    petLabel.className = 'entity-label';
    petLabel.textContent = state.petName;
    pet.appendChild(petLabel);
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

    dockSummary.textContent = `${dockPlacements.length} \u4e2a\u6446\u4ef6`;
    dockEmpty.classList.toggle('is-hidden', dockPlacements.length > 0);
    dockList.innerHTML = dockPlacements.map((placement) => `
      <article class="dock-card">
        <div class="dock-card-main">
          <img src="${furnitureImages[placement.kind]}" alt="${labelCopy[placement.kind]}" class="item-icon" />
          <div>
            <strong>${labelCopy[placement.kind]}</strong>
            <p class="dock-copy">\u8fd9\u91cc\u53ef\u4ee5\u76f4\u63a5\u62d6\u52a8\u4f4d\u7f6e\uff1b\u4e5f\u53ef\u4ee5\u5207\u56de\u4ee3\u7801\u533a\u6295\u5f71\u6a21\u5f0f\u3002</p>
          </div>
        </div>
        <div class="dock-actions">
          <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="to-line-bind">\u6539\u4e3a\u8ddf\u884c</button>
          <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="to-viewport-float">\u6539\u4e3a\u6d6e\u5c42</button>
          <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="return">\u6536\u56de\u80cc\u5305</button>
          <button class="mini-button danger" type="button" data-placement-id="${placement.id}" data-placement-action="delete">\u5220\u9664</button>
        </div>
      </article>
    `).join('');

    renderManageState();
  }

  function renderManageState() {
    if (!dockManageBody || !dockFoldIndicator) {
      return;
    }

    dockManageBody.classList.toggle('is-hidden', !manageOpen);
    dockFoldIndicator.textContent = manageOpen ? '\u6536\u8d77' : '\u5c55\u5f00';
  }

  function applyPosition(element, point) {
    element.style.left = `${point.x * 100}%`;
    element.style.top = `${point.y * 100}%`;
  }

  function updateEntityPosition(element, event) {
    const rect = stage.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width, 0.06, 0.96);
    const y = clamp((event.clientY - rect.top) / rect.height, 0.16, 0.86);
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
    const y = clamp(parseFloat(entity.style.top) / 100, 0.16, 0.86);

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
