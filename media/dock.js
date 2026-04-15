(function () {
  const vscode = acquireVsCodeApi();
  const body = document.body;
  const stage = document.getElementById('stage');
  const entities = document.getElementById('entities');
  const toggleButton = document.getElementById('dock-editor-pet-toggle');
  const editorPetSummary = document.getElementById('editor-pet-summary');
  const petImages = {
    normal: body.dataset.petNormal,
    startled: body.dataset.petAlert,
    working: body.dataset.petWorking,
  };

  let latestViewState = null;
  let dragSession = null;

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const actionHost = target.closest('[data-action]');
    if (actionHost instanceof HTMLElement) {
      vscode.postMessage({ type: actionHost.dataset.action });
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

    state.placements.forEach((placement) => {
      const piano = document.createElement('div');
      piano.className = 'entity piano';
      piano.dataset.entity = 'furniture';
      piano.dataset.id = placement.id;
      applyPosition(piano, placement);

      const pianoImage = document.createElement('img');
      pianoImage.alt = '钢琴';
      pianoImage.src = body.dataset.piano;
      piano.appendChild(pianoImage);
      entities.appendChild(piano);
    });
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