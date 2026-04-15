(function () {
  const vscode = acquireVsCodeApi();
  const body = document.body;
  const assetNode = document.getElementById('eden-assets');
  const edenAssets = assetNode ? JSON.parse(assetNode.textContent || '{}') : {};
  const petName = document.getElementById('pet-name');
  const petStatus = document.getElementById('pet-status');
  const petImage = document.querySelector('.pet-image');
  const petStage = document.getElementById('sidebar-pet-stage');
  const bricks = document.getElementById('resource-bricks');
  const dew = document.getElementById('resource-dew');
  const themeButtons = Array.from(document.querySelectorAll('.theme-button'));
  const toggleButton = document.getElementById('editor-pet-toggle');
  const editorPetSummary = document.getElementById('editor-pet-summary');
  const editorPetScale = document.getElementById('editor-pet-scale');
  const editorPetScaleValue = document.getElementById('editor-pet-scale-value');
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
    'viewport-float': '代码区漂浮',
  };

  const labelCopy = {
    piano: '像素钢琴',
    bench: '小木椅',
    tree: '像素盆栽',
    lamp: '复古台灯',
    grass: '小游戏机',
  };

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

  let latestViewState = null;
  let selectedInventoryKind = null;
  let lastEffectNonce = 0;
  let sectionState = {
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
    const frames = petFrames[state.petStatus] || petFrames.normal;
    if (petImage instanceof HTMLElement) {
      petImage.innerHTML = frames[viewState.petAnimationFrame % frames.length] || frames[0] || '';
    }
    petStage?.classList.toggle('is-working', state.petStatus === 'working');
    petStage?.classList.toggle('is-alert', state.petStatus === 'startled');
    bricks.textContent = String(state.totalBricks);
    dew.textContent = String(state.inspirationDew);

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

    if (viewState.petEffect && viewState.petEffectNonce !== lastEffectNonce) {
      lastEffectNonce = viewState.petEffectNonce;
      triggerPetEffect(petStage, viewState.petEffect);
    }

    renderInventory(state.inventory || []);
    renderPlaced(state.placedFurniture || []);
    renderShop(viewState.shopItems || [], state.totalBricks, state.inspirationDew);
    renderSections();
  }

  function triggerPetEffect(host, effect) {
    if (!(host instanceof HTMLElement)) {
      return;
    }

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
        indicator.textContent = expanded ? '收起' : '展开';
      }
    });
  }

  function renderInventory(inventory) {
    const available = inventory.filter((item) => item.count > 0);
    inventorySummary.textContent = `${available.reduce((sum, item) => sum + item.count, 0)} 件可摆放`;

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
            <small>库存 ${item.count}</small>
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
    inventorySelected.textContent = `已选中 ${labelCopy[selected.kind]}，现在可以摆到代码区或底部乐园。`;
  }

  function renderPlaced(placements) {
    placedSummary.textContent = `${placements.length} 个摆件`;

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
            <p class="placement-meta">${anchorCopy[placement.anchorType] || placement.anchorType}${placement.anchorType === 'line-bind' ? ` · 第 ${placement.line + 1} 行` : ''}</p>
          </div>
        </div>
        <div class="placement-actions-grid">
          <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="nudge-left">左移</button>
          <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="nudge-right">右移</button>
          <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="nudge-up">上移</button>
          <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="nudge-down">下移</button>
          <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="to-line-bind">改为跟行</button>
          <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="to-viewport-float">改为浮层</button>
          <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="to-dock">移到底部</button>
          <button class="mini-button" type="button" data-placement-id="${placement.id}" data-placement-action="return">收回背包</button>
          <button class="mini-button danger" type="button" data-placement-id="${placement.id}" data-placement-action="delete">删除</button>
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
            <span class="price-tag">${item.priceBricks} 碎砖 / ${item.priceDew} 露珠</span>
            <button class="action-button ${affordable ? 'action-primary' : ''}" type="button" data-buy-kind="${item.kind}" ${affordable ? '' : 'disabled'}>购买</button>
          </div>
        </article>
      `;
    }).join('');
  }

  vscode.postMessage({ type: 'ready' });
})();
