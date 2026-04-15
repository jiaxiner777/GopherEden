(function () {
  const vscode = acquireVsCodeApi();
  const body = document.body;
  const petName = document.getElementById('pet-name');
  const petStatus = document.getElementById('pet-status');
  const petImage = document.querySelector('.pet-image');
  const bricks = document.getElementById('resource-bricks');
  const dew = document.getElementById('resource-dew');
  const themeButtons = Array.from(document.querySelectorAll('.theme-button'));
  const toggleButton = document.getElementById('editor-pet-toggle');
  const editorPetSummary = document.getElementById('editor-pet-summary');

  const statusCopy = {
    normal: '悠闲中',
    startled: '受惊了',
    working: '疯狂工作',
  };

  const petImages = {
    normal: body.dataset.petNormal,
    startled: body.dataset.petAlert,
    working: body.dataset.petWorking,
  };

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

    const themeHost = target.closest('[data-theme]');
    if (themeHost instanceof HTMLElement && themeHost.dataset.theme) {
      vscode.postMessage({ type: 'setTheme', theme: themeHost.dataset.theme });
    }
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || message.type !== 'state') {
      return;
    }

    const viewState = message.payload;
    const state = viewState.state;
    const editorPet = viewState.editorPet;
    body.classList.toggle('theme-cyber-oasis', state.theme === 'cyber-oasis');
    body.classList.toggle('theme-pixel-meadow', state.theme === 'pixel-meadow');

    petName.textContent = state.petName;
    petStatus.textContent = statusCopy[state.petStatus] || statusCopy.normal;
    petImage.setAttribute('src', petImages[state.petStatus] || petImages.normal);
    bricks.textContent = String(state.totalBricks);
    dew.textContent = String(state.inspirationDew);

    if (toggleButton) {
      toggleButton.textContent = editorPet.toggleLabel;
      toggleButton.classList.toggle('action-primary', !editorPet.enabled);
    }

    if (editorPetSummary) {
      editorPetSummary.textContent = editorPet.statusText;
    }

    themeButtons.forEach((button) => {
      button.classList.toggle('is-active', button.dataset.theme === state.theme);
    });
  });

  vscode.postMessage({ type: 'ready' });
})();