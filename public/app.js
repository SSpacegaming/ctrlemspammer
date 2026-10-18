// CtrlEm Image Queue - Frontend Application
// Improved version with better UX, bug fixes, and accessibility

(function() {
  'use strict';

  // ============================================
  // STATE MANAGEMENT
  // ============================================
  const state = {
    items: [],
    sending: false,
    uploading: false,
    dragIndex: null
  };

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================
  const $ = (id) => document.getElementById(id);
  const $$ = (selector) => document.querySelectorAll(selector);

  const esc = (value) => String(value)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');

  const debounce = (fn, delay) => {
    let timeoutId;
    return (...args) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn(...args), delay);
    };
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getMediaType = (url) => {
    try {
      const path = new URL(url).pathname.toLowerCase();
      if (/\.(mp4|webm|mov|m4v|avi)(?:$|\.)/.test(path)) return 'video';
      return 'image';
    } catch {
      return 'image';
    }
  };

  const getCommandLabel = (command) => {
    const labels = {
      popupImage: 'Popup image',
      changeWallpaper: 'Wallpaper',
      videoOverlay: 'Video overlay'
    };
    return labels[command] || command;
  };

  const getCommandClass = (command) => {
    const classes = {
      popupImage: 'popup',
      changeWallpaper: 'wallpaper',
      videoOverlay: 'video'
    };
    return classes[command] || '';
  };

  // ============================================
  // NOTICE/TOAST SYSTEM
  // ============================================
  let noticeTimeout = null;

  function showNotice(text, type = 'info') {
    const noticeEl = $('notice');
    noticeEl.textContent = text;
    noticeEl.className = `notice ${type}`;
    noticeEl.style.display = 'flex';

    if (noticeTimeout) clearTimeout(noticeTimeout);
    noticeTimeout = setTimeout(() => {
      noticeEl.style.display = 'none';
      noticeEl.textContent = '';
      noticeEl.className = 'notice';
    }, type === 'error' ? 8000 : 5000);
  }

  function hideNotice() {
    if (noticeTimeout) clearTimeout(noticeTimeout);
    const noticeEl = $('notice');
    noticeEl.style.display = 'none';
    noticeEl.textContent = '';
    noticeEl.className = 'notice';
  }

  // ============================================
  // LOCAL STORAGE HELPERS
  // ============================================
  const STORAGE_KEYS = {
    savedCodes: 'ctrlem.savedCodes',
    tokens: 'ctrlem.tokens'
  };

  function readSavedCodes() {
    try {
      const codes = JSON.parse(localStorage.getItem(STORAGE_KEYS.savedCodes) || '[]');
      return Array.isArray(codes)
        ? codes.filter(code => code?.name && /^[A-Z0-9]{5}$/.test(code.value))
        : [];
    } catch {
      return [];
    }
  }

  function writeSavedCodes(codes) {
    localStorage.setItem(STORAGE_KEYS.savedCodes, JSON.stringify(codes));
  }

  function loadCachedTokens() {
    try {
      const tokens = JSON.parse(localStorage.getItem(STORAGE_KEYS.tokens) || '{}');
      if (tokens.apiKey || tokens.imageChestToken) {
        $('apiKey').value = tokens.apiKey || '';
        $('imageChestToken').value = tokens.imageChestToken || '';
        $('rememberTokens').checked = true;
      }
    } catch {
      localStorage.removeItem(STORAGE_KEYS.tokens);
    }
  }

  function cacheTokens() {
    if ($('rememberTokens').checked) {
      localStorage.setItem(STORAGE_KEYS.tokens, JSON.stringify({
        apiKey: $('apiKey').value,
        imageChestToken: $('imageChestToken').value
      }));
    } else {
      localStorage.removeItem(STORAGE_KEYS.tokens);
    }
  }

  // ============================================
  // SAVED CODES MANAGEMENT
  // ============================================
  function renderSavedCodes() {
    const select = $('savedCodes');
    const targetInput = $('target');
    const selected = targetInput.value.trim().toUpperCase();
    const codes = readSavedCodes();

    select.innerHTML = '<option value="">Saved control codes</option>';
    for (const code of codes) {
      const option = document.createElement('option');
      option.value = code.value;
      option.textContent = `${code.name} · ${code.value}`;
      option.selected = code.value === selected;
      select.append(option);
    }

    $('deleteCodeButton').disabled = !codes.some(code => code.value === selected);
  }

  function saveControlCode() {
    const value = $('target').value.trim().toUpperCase();
    const name = $('codeName').value.trim() || value;

    if (!/^[A-Z0-9]{5}$/.test(value)) {
      return showNotice('Enter a valid 5-character control code first.', 'error');
    }

    const codes = readSavedCodes().filter(code => code.value !== value);
    codes.push({ name, value });
    writeSavedCodes(codes);

    $('target').value = value;
    $('codeName').value = '';
    renderSavedCodes();
    showNotice(`Saved "${name}".`, 'success');
  }

  function deleteControlCode() {
    const value = $('target').value.trim().toUpperCase();
    writeSavedCodes(readSavedCodes().filter(code => code.value !== value));
    renderSavedCodes();
    showNotice('Saved control code deleted.', 'info');
  }

  // ============================================
  // QUEUE RENDERING
  // ============================================
  function renderQueue() {
    const queueEl = $('queue');
    const emptyState = $('emptyState');
    const countEl = $('queueCount');
    const sendBtn = $('sendButton');
    const clearBtn = $('clearButton');
    const uploadBtn = $('uploadButton');

    countEl.textContent = state.items.length;
    emptyState.hidden = state.items.length > 0;
    sendBtn.disabled = !state.items.length || state.sending || state.uploading;
    clearBtn.disabled = !state.items.length || state.sending || state.uploading;
    uploadBtn.disabled = state.uploading;

    if (state.items.length === 0) {
      queueEl.innerHTML = '';
      return;
    }

    queueEl.innerHTML = state.items.map((item, index) => `
      <article class="queue-item ${item.status || ''}" draggable="true" data-index="${index}" role="listitem">
        <button class="queue-drag" type="button" aria-label="Drag to reorder" tabindex="-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="5 9 2 12 5 15"></polyline>
            <polyline points="19 9 22 12 19 15"></polyline>
            <line x1="2" y1="12" x2="22" y2="12"></line>
          </svg>
        </button>
        <div class="queue-preview ${item.mediaType === 'video' || item.command === 'videoOverlay' ? 'video' : ''}">
          ${item.mediaType === 'video' || item.command === 'videoOverlay'
            ? `<video src="${esc(item.url)}" muted preload="metadata" onerror="this.style.opacity='.25'"></video>`
            : `<img src="${esc(item.url)}" alt="" onerror="this.style.opacity='.25'" />`
          }
        </div>
        <div class="queue-info">
          <div class="queue-filename" title="${esc(item.filename || getCommandLabel(item.command))}">${esc(item.filename || getCommandLabel(item.command))}</div>
          <div class="queue-url" title="${esc(item.url)}">${esc(item.url)}</div>
          <span class="queue-command ${getCommandClass(item.command)}">${getCommandLabel(item.command)}</span>
        </div>
        <span class="queue-status ${item.status || 'queued'}">${esc(item.statusLabel || 'Queued')}</span>
        <button class="queue-remove" type="button" data-remove="${index}" ${state.sending || state.uploading ? 'disabled' : ''} aria-label="Remove from queue">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </article>
    `).join('');

    // Attach drag and drop handlers
    attachDragHandlers();
  }

  // ============================================
  // DRAG AND DROP FOR REORDERING
  // ============================================
  function attachDragHandlers() {
    const items = $$('.queue-item');

    items.forEach(item => {
      item.addEventListener('dragstart', handleDragStart);
      item.addEventListener('dragend', handleDragEnd);
      item.addEventListener('dragover', handleDragOver);
      item.addEventListener('drop', handleDrop);
      item.addEventListener('dragenter', handleDragEnter);
      item.addEventListener('dragleave', handleDragLeave);
    });
  }

  function handleDragStart(e) {
    if (state.sending || state.uploading) {
      e.preventDefault();
      return;
    }
    const index = Number(e.currentTarget.dataset.index);
    state.dragIndex = index;
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  }

  function handleDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    state.dragIndex = null;
    $$('.queue-item').forEach(el => el.classList.remove('drag-over'));
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function handleDragEnter(e) {
    e.currentTarget.classList.add('drag-over');
  }

  function handleDragLeave(e) {
    // Only remove if actually leaving the element (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget)) {
      e.currentTarget.classList.remove('drag-over');
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    const fromIndex = state.dragIndex;
    const toIndex = Number(e.currentTarget.dataset.index);

    if (fromIndex === null || fromIndex === toIndex) return;

    const [movedItem] = state.items.splice(fromIndex, 1);
    state.items.splice(toIndex, 0, movedItem);
    renderQueue();
    showNotice('Queue reordered.', 'info');
  }

  // ============================================
  // ADD IMAGE TO QUEUE
  // ============================================
  function addImage() {
    const urlInput = $('imageUrl');
    const url = urlInput.value.trim();

    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      return showNotice('Enter a valid http(s) image or video URL.', 'error');
    }

    state.items.push({
      url,
      command: $('command').value,
      mediaType: getMediaType(url),
      status: '',
      statusLabel: 'Queued'
    });

    urlInput.value = '';
    urlInput.focus();
    renderQueue();
    showNotice('Image added to queue.', 'success');
  }

  // ============================================
  // IMAGECHEST UPLOAD
  // ============================================
  async function uploadImages() {
    const token = $('imageChestToken').value.trim();
    const files = [...$('imageFiles').files];
    const mode = $('uploadMode').value;

    if (!token) return showNotice('Enter your ImageChest personal access token in Settings.', 'error');
    if (!files.length) return showNotice('Select one or more images or videos first.', 'error');

    const invalidFiles = files.filter(f => !f.type.startsWith('image/') && !f.type.startsWith('video/'));
    if (invalidFiles.length) return showNotice('Only images, GIFs, and videos can be uploaded.', 'error');

    if (mode === 'batch' && files.length > 20) {
      return showNotice('Batch mode supports up to 20 images. Choose individual mode for more.', 'error');
    }

    state.uploading = true;
    renderQueue();

    const uploadArea = $('uploadArea');
    uploadArea.classList.add('uploading');

    let existingTitles;
    try {
      existingTitles = await getImageChestTitles(token);
    } catch (error) {
      state.uploading = false;
      uploadArea.classList.remove('uploading');
      renderQueue();
      return showNotice(error instanceof TypeError
        ? 'Could not reach the local server. Make sure the app is running, then try again.'
        : error.message, 'error');
    }

    if (mode === 'batch') {
      await uploadBatch(token, files, existingTitles);
    } else {
      await uploadIndividual(token, files, existingTitles);
    }

    $('imageFiles').value = '';
    uploadArea.classList.remove('uploading');
    state.uploading = false;
    renderQueue();
  }

  async function uploadBatch(token, files, existingTitles) {
    const batchTitle = `CtrlEm batch: ${files.map(f => f.name).join(', ')}`;

    if (existingTitles.has(batchTitle)) {
      return showNotice('This batch title already exists on ImageChest; nothing was uploaded.', 'error');
    }

    showNotice(`Uploading ${files.length} images as one ImageChest post...`, 'info');

    try {
      const images = await Promise.all(files.map(async file => ({
        name: file.name,
        type: file.type,
        data: await fileToBase64(file)
      })));

      const response = await fetch('/api/imgchest/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, title: batchTitle, images })
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.result?.message || data.result?.error || data.error || `Upload failed (${data.status})`);
      }

      const uploadedImages = data.result?.data?.images || [];
      uploadedImages.forEach((image, index) => {
        state.items.push({
          url: image.link,
          command: $('command').value,
          status: '',
          statusLabel: 'Queued',
          filename: files[index]?.name || image.link.split('/').pop(),
          mediaType: files[index]?.type.startsWith('video/') ? 'video' : 'image'
        });
      });

      showNotice(`${uploadedImages.length} images uploaded as one NSFW-marked batch and added to the queue.`, 'success');
    } catch (error) {
      showNotice(error instanceof TypeError
        ? 'Could not reach the local server. Make sure the app is running, then try again.'
        : error.message, 'error');
    }
  }

  async function uploadIndividual(token, files, existingTitles) {
    let uploaded = 0;

    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const title = `${file.name}+#${index + 1}`;

      if (existingTitles.has(title)) {
        showNotice(`Skipped ${file.name}: already exists on ImageChest.`, 'warning');
        continue;
      }

      showNotice(`Uploading ${index + 1} of ${files.length}...`, 'info');

      try {
        const image = { name: file.name, type: file.type, data: await fileToBase64(file) };
        const response = await fetch('/api/imgchest/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, title, images: [image] })
        });

        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.result?.message || data.result?.error || data.error || `Upload failed (${data.status})`);
        }

        const uploadedImage = data.result?.data?.images?.[0];
        if (!uploadedImage?.link) throw new Error('ImageChest did not return an image URL.');

        state.items.push({
          url: uploadedImage.link,
          command: $('command').value,
          status: '',
          statusLabel: 'Queued',
          filename: title,
          mediaType: file.type.startsWith('video/') ? 'video' : 'image'
        });

        uploaded++;
        renderQueue();
      } catch (error) {
        showNotice(`${file.name}: ${error.message}`, 'error');
      }
    }

    if (uploaded) {
      showNotice(`${uploaded} image${uploaded === 1 ? '' : 's'} uploaded and added to the queue.`, 'success');
    }
  }

  async function getImageChestTitles(token) {
    const response = await fetch('/api/imgchest/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.result?.message || data.result?.error || data.error || `ImageChest lookup failed (${data.status})`);
    }

    return new Set((data.result.posts || []).map(post => post.title).filter(Boolean));
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ============================================
  // SEND QUEUE TO CTRL-EM
  // ============================================
  async function sendQueue() {
    const apiKey = $('apiKey').value.trim();
    const target = $('target').value.trim().toUpperCase();

    if (!apiKey) return showNotice('Enter your API key in Settings first.', 'error');
    if (!/^[A-Z0-9]{5}$/.test(target)) return showNotice('Enter a valid 5-character control code.', 'error');

    state.sending = true;
    renderQueue();
    showNotice('Sending queue. CtrlEm allows one command every 3 seconds per user.', 'info');

    let stoppedForApiAccess = false;

    for (let i = 0; i < state.items.length; i++) {
      const item = state.items[i];
      item.status = 'sending';
      item.statusLabel = 'Sending...';
      renderQueue();

      try {
        const response = await fetch('/api/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey, payload: { target, command: item.command, argument: item.url } })
        });

        const data = await response.json();

        if (!response.ok || !data.ok) {
          const error = new Error(data.result?.error || data.error || `Request failed (${data.status})`);
          error.status = response.status;
          throw error;
        }

        item.status = 'success';
        item.statusLabel = 'Sent';
      } catch (error) {
        item.status = 'error';
        item.statusLabel = error.message.slice(0, 30);

        if (isApiAccessDenied(error)) {
          for (let remaining = i + 1; remaining < state.items.length; remaining++) {
            state.items[remaining].status = 'error';
            state.items[remaining].statusLabel = 'Skipped: API access';
          }
          stoppedForApiAccess = true;
          showNotice('CtrlEm denied API access for this user. The remaining queue was stopped.', 'error');
          break;
        }
      }

      renderQueue();

      if (i < state.items.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    state.sending = false;

    if (!stoppedForApiAccess) {
      const successCount = state.items.filter(i => i.status === 'success').length;
      const errorCount = state.items.filter(i => i.status === 'error').length;
      if (errorCount > 0) {
        showNotice(`Queue finished: ${successCount} sent, ${errorCount} failed.`, 'warning');
      } else {
        showNotice(`Queue finished: all ${successCount} items sent successfully.`, 'success');
      }
    }

    renderQueue();
  }

  function isApiAccessDenied(error) {
    return error.status === 403 || /api access|opted in|permission|not allowed/i.test(error.message);
  }

  // ============================================
  // SETTINGS DIALOG
  // ============================================
  function openSettings() {
    $('settingsDialog').showModal();
    $('apiKey').focus();
  }

  function closeSettings() {
    $('settingsDialog').close();
  }

  // ============================================
  // UPDATE CHECK
  // ============================================
  async function checkForUpdates() {
    const btn = $('updateButton');
    const statusEl = $('updateStatus');
    const versionLabel = $('versionLabel');

    btn.disabled = true;
    statusEl.textContent = 'Checking GitHub...';

    try {
      const local = await fetch('/api/version').then(r => r.json());
      versionLabel.textContent = `Current v${local.version}`;

      const latest = await fetch('https://api.github.com/repos/SSpacegaming/ctrlemspammer/releases/latest', {
        headers: { Accept: 'application/vnd.github+json' }
      }).then(async r => {
        if (!r.ok) throw new Error(`GitHub returned ${r.status}`);
        return r.json();
      });

      if (compareVersions(latest.tag_name, local.version) > 0) {
        statusEl.innerHTML = `Update available: <a href="${esc(latest.html_url)}" target="_blank" rel="noreferrer">v${esc(latest.tag_name.replace(/^v/, ''))}</a>`;
      } else {
        statusEl.textContent = 'You are using the latest version.';
      }
    } catch (error) {
      statusEl.textContent = `Could not check for updates: ${error.message}`;
    } finally {
      btn.disabled = false;
    }
  }

  function compareVersions(left, right) {
    const parse = v => String(v).replace(/^v/, '').split('.').map(p => parseInt(p, 10) || 0);
    const a = parse(left), b = parse(right);
    for (let i = 0; i < 3; i++) {
      if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
    }
    return 0;
  }

  // ============================================
  // UPLOAD AREA INTERACTIONS
  // ============================================
  function setupUploadArea() {
    const uploadArea = $('uploadArea');
    const fileInput = $('imageFiles');

    ['dragenter', 'dragover'].forEach(event => {
      uploadArea.addEventListener(event, e => {
        e.preventDefault();
        e.stopPropagation();
        uploadArea.classList.add('drag-active');
      });
    });

    ['dragleave', 'drop'].forEach(event => {
      uploadArea.addEventListener(event, e => {
        e.preventDefault();
        e.stopPropagation();
        uploadArea.classList.remove('drag-active');
      });
    });

    uploadArea.addEventListener('drop', e => {
      const files = e.dataTransfer.files;
      if (files.length) {
        fileInput.files = files;
        uploadImages();
      }
    });

    uploadArea.addEventListener('click', e => {
      if (e.target === uploadArea || e.target.closest('.upload-text') || e.target.closest('.upload-icon')) {
        fileInput.click();
      }
    });

    uploadArea.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) {
        uploadImages();
      }
    });
  }

  // ============================================
  // UPLOAD MODE HINT UPDATE
  // ============================================
  function updateUploadHint() {
    const mode = $('uploadMode').value;
    const hintEl = $('uploadHint');

    if (mode === 'batch') {
      hintEl.innerHTML = 'Uploads up to 20 images as one unlisted (hidden), NSFW-marked post. This is usually faster.';
    } else {
      hintEl.innerHTML = 'Uploads each image as its own unlisted (hidden), NSFW-marked post with titles such as <code>photo+#1</code>. No batch limit.';
    }
  }

  // ============================================
  // KEYBOARD SHORTCUTS
  // ============================================
  function handleKeyboardShortcuts(e) {
    // Ctrl/Cmd + Enter to send queue
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      if (!state.sending && !state.uploading && state.items.length > 0) {
        e.preventDefault();
        sendQueue();
      }
    }

    // Escape to close dialog
    if (e.key === 'Escape') {
      if ($('settingsDialog').open) {
        closeSettings();
      }
    }

    // Delete key to remove selected queue item
    if (e.key === 'Delete' && document.activeElement === $('queue')) {
      // Could implement selection, but for now just prevent default
    }
  }

  // ============================================
  // EVENT LISTENERS SETUP
  // ============================================
  function setupEventListeners() {
    // Buttons
    $('addButton').addEventListener('click', addImage);
    $('uploadButton').addEventListener('click', uploadImages);
    $('sendButton').addEventListener('click', sendQueue);
    $('clearButton').addEventListener('click', () => {
      if (!state.sending && !state.uploading) {
        state.items = [];
        renderQueue();
        showNotice('Queue cleared.', 'info');
      }
    });

    // Settings
    $('settingsButton').addEventListener('click', openSettings);
    $('closeSettings').addEventListener('click', closeSettings);
    $('updateButton').addEventListener('click', checkForUpdates);

    // Saved codes
    $('savedCodes').addEventListener('change', () => {
      if ($('savedCodes').value) {
        $('target').value = $('savedCodes').value;
        renderSavedCodes();
      }
    });
    $('target').addEventListener('input', debounce(renderSavedCodes, 150));
    $('saveCodeButton').addEventListener('click', saveControlCode);
    $('deleteCodeButton').addEventListener('click', deleteControlCode);

    // Token caching
    $('rememberTokens').addEventListener('change', cacheTokens);
    $('apiKey').addEventListener('input', debounce(cacheTokens, 500));
    $('imageChestToken').addEventListener('input', debounce(cacheTokens, 500));

    // Upload mode
    $('uploadMode').addEventListener('change', updateUploadHint);

    // URL input enter key
    $('imageUrl').addEventListener('keydown', e => {
      if (e.key === 'Enter') addImage();
    });

    // Queue delegation for remove buttons
    $('queue').addEventListener('click', e => {
      const removeBtn = e.target.closest('.queue-remove');
      if (removeBtn && !state.sending && !state.uploading) {
        const index = Number(removeBtn.dataset.remove);
        state.items.splice(index, 1);
        renderQueue();
        showNotice('Item removed from queue.', 'info');
      }
    });

    // Dialog backdrop click
    $('settingsDialog').addEventListener('click', e => {
      if (e.target === $('settingsDialog')) closeSettings();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);

    // Upload area
    setupUploadArea();
  }

  // ============================================
  // INITIALIZATION
  // ============================================
  function init() {
    loadCachedTokens();
    renderSavedCodes();
    updateUploadHint();
    setupEventListeners();
    checkForUpdates();
    renderQueue();

    // Focus first input
    $('target').focus();
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();