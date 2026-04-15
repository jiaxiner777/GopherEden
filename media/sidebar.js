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
    normal: '\u60a0\u95f2\u4e2d',
    startled: '\u53d7\u60ca\u4e86',
    working: '\u75af\u72c2\u5de5\u4f5c',
  };

  const anchorCopy = {
    dock: '\u5e95\u90e8\u4e50\u56ed',
    'line-bind': '\u8ddf\u884c\u6446\u653e',
    'viewport-float': '\u4ee3\u7801\u533a\u6d6e\u5c42',
  };

  const labelCopy = {
    piano: '\u94a2\u7434',
    bench: '\u957f\u6905',
    tree: '\u5c0f\u6811',
    lamp: '\u5c0f\u706f',
    grass: '\u8349\u5806',
  };

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

  let latestViewState = null;
  let selectedInventoryKind = null;
  let sectionState = {
    inventory: false,
    placed: false,
    shop: false,
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
    const inventoryKinds = new Set((latestViewState.state.inventory || []).filter((item) => item.count > 0).map((item) => item.kind));
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

    renderInventory(state.inventory || []);
    renderPlaced(state.placedFurniture || []);
    renderShop(viewState.shopItems || [], state.totalBricks, state.inspirationDew);
    renderSections();
  }

  function renderSections() {
    Object.keys(sectionState).forEach((section) => {
      const bodyEl = document.querySelector(`[data-section-body="${section}"]`);
      const rootEl = document.querySelector(`[data-section-root="${section}"]`);
      if (!(bodyEl instanceof HTMLElement) || !(rootEl instanceof HTMLElement)) {
        return;
      }

      const expanded = !!sectionState[section];
      bodyEl.classList.toggle('is-hidden', !expanded);
      rootEl.classList.toggle('is-open', expanded);
      const indicator = rootEl.querySelector('.fold-indicator');
      if (indicator instanceof HTMLElement) {
        indicator.textContent = expanded ? '\u6536\u8d77' : '\u5c55\u5f00';
      }
    });
  }

  function renderInventory(inventory) {
    const available = inventory.filter((item) => item.count > 0);
    inventorySummary.textContent = `${available.reduce((sum, item) => sum + item.count, 0)} \u4ef6\u53ef\u6446\u653e`;

    if (available.length === 0) {
      inventoryEmpty.classList.remove('is-hidden');
      inventoryList.innerHTML = '';
      inventoryActions.classList.add('is-hidden');
      return;
    }

    inventoryEmpty.classList.add('is-hidden');
    inventoryList.innerHTML = available.map((item) => {
      const selected = item.kind === selectedInventoryKind;
      return `
        <button class="inventory-card ${selected ? 'is-selected' : ''}" type="button" data-inventory-kind="${item.kind}">
          <img src="${furnitureImages[item.kind]}" alt="${labelCopy[item.kind]}" class="item-icon" />
          <span class="inventory-meta">
            <strong>${labelCopy[item.kind]}</strong>
            <small>\u5e93\u5b58 ${item.count}</small>
          </span>
        </button>
      `;
    }).join('');

    const selected = available.find((item) => item.kind === selectedInventoryKind) || available[0];
    selectedInventoryKind = selected ? selected.kind : null;

    if (!selected) {
      inventoryActions.classList.add('is-hidden');
      return;
    }

    inventoryActions.classList.remove('is-hidden');
    inventorySelected.textContent = `\u5df2\u9009\u4e2d ${labelCopy[selected.kind]}\uff0c\u73b0\u5728\u53ef\u4ee5\u6446\u5230\u4ee3\u7801\u533a\u6216\u5e95\u90e8\u4e50\u56ed\u3002`;
  }

  function renderPlaced(placements) {
    placedSummary.textContent = `${placements.length} \u4e2a\u6446\u4ef6`;

    if (placements.length === 0) {
      placedEmpty.classList.remove('is-hidden');
      placedList.innerHTML = '';
      return;
    }

    placedEmpty.classList.add('is-hidden');
    placedList.innerHTML = placements.map((placement) => `
      <article class="placed-card">
        <div class="placed-main">
          <img src="${furnitureImages[placement.kind]}" alt="${labelCopy[placement.kind]}" class="item-icon" />
          <div>
            <strong>${labelCopy[placement.kind]}</strong>
            <p class="placement-meta">${anchorCopy[placement.anchorType] || placement.anchorType}${placement.anchorType === 'line-bind' ? ` \u00b7 \u7b2c ${placement.line + 1} \u884c` : ''}</p>
          </div>
        </div>
        <div class="placement-actions-grid">
          <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="nudge-left">\u5de6\u79fb</button>
          <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="nudge-right">\u53f3\u79fb</button>
          <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="nudge-up">\u4e0a\u79fb</button>
          <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="nudge-down">\u4e0b\u79fb</button>
          <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="to-line-bind">\u6539\u4e3a\u8ddf\u884c</button>
          <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="to-viewport-float">\u6539\u4e3a\u6d6e\u5c42</button>
          <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="to-dock">\u79fb\u5230\u5e95\u90e8</button>
          <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="return">\u6536\u56de\u80cc\u5305</button>
          <button class="mini-button danger" type="button" data-placement-id="${placement.id}" data-placement-action="delete">\u5220\u9664</button>
        </div>
      </article>
    `).join('');
  }

  function renderShop(shopItems, totalBricks, inspirationDew) {
    shopList.innerHTML = shopItems.map((item) => {
      const affordable = totalBricks >= item.priceBricks && inspirationDew >= item.priceDew;
      return `
        <article class="shop-card ${affordable ? '' : 'is-disabled'}">
          <div class="shop-top">
            <img src="${furnitureImages[item.kind]}" alt="${item.name}" class="item-icon" />
            <div>
              <strong>${item.name}</strong>
              <p class="shop-copy">${item.description}</p>
            </div>
          </div>
          <div class="shop-bottom">
            <span class="price-tag">${item.priceBricks} \u788e\u7816 / ${item.priceDew} \u9732\u73e0</span>
            <button class="action-button ${affordable ? 'action-primary' : ''}" type="button" data-buy-kind="${item.kind}" ${affordable ? '' : 'disabled'}>\u8d2d\u4e70</button>
          </div>
        </article>
      `;
    }).join('');
  }

  vscode.postMessage({ type: 'ready' });
})();
