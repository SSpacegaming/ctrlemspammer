const state = { items: [], sending: false, uploading: false };
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" })[c]);
function notice(text, error = false) { $("notice").textContent = text; $("notice").style.color = error ? "var(--danger)" : ""; }
function render() {
  $("queueCount").textContent = state.items.length;
  $("emptyState").hidden = state.items.length > 0;
  $("sendButton").disabled = !state.items.length || state.sending || state.uploading;
  $("clearButton").disabled = !state.items.length || state.sending || state.uploading;
  $("uploadButton").disabled = state.uploading;
  $("queue").innerHTML = state.items.map((item, i) => `<article class="queue-item">${mediaPreview(item)}<div><div class="filename">${esc(item.filename || commandLabel(item.command))}</div><div class="url" title="${esc(item.url)}">${esc(item.url)}</div></div><span class="status ${item.status}">${esc(item.statusLabel)}</span><button class="remove" data-remove="${i}" type="button" ${state.sending || state.uploading ? "disabled" : ""}>×</button></article>`).join("");
}
function commandLabel(command) { return command === "videoOverlay" ? "Video overlay" : command === "changeWallpaper" ? "Wallpaper" : "Popup image"; }
function mediaPreview(item) {
  if (item.mediaType?.startsWith("video/") || item.command === "videoOverlay") return `<video src="${esc(item.url)}" muted preload="metadata" onerror="this.style.opacity='.25'"></video>`;
  return `<img src="${esc(item.url)}" alt="" onerror="this.style.opacity='.25'" />`;
}
function addImage() {
  const url = $("imageUrl").value.trim();
  try { const parsed = new URL(url); if (!["http:","https:"].includes(parsed.protocol)) throw new Error(); } catch { return notice("Enter a valid http(s) image URL.", true); }
  state.items.push({ url, command: $("command").value, mediaType: mediaTypeFromUrl(url), status: "", statusLabel: "Queued" });
  $("imageUrl").value = ""; render();
}
async function uploadImages() {
  const token = $("imageChestToken").value.trim();
  const files = [...$("imageFiles").files];
  if (!token) return notice("Enter your ImageChest personal access token.", true);
  if (!files.length) return notice("Select one or more images or videos first.", true);
  if (files.some((file) => !file.type.startsWith("image/") && !file.type.startsWith("video/"))) return notice("Only images, GIFs, and videos can be uploaded.", true);
  const mode = $("uploadMode").value;
  if (mode === "batch" && files.length > 20) return notice("Batch mode supports up to 20 images. Choose individual mode for more.", true);
  state.uploading = true;
  notice(mode === "batch" ? `Uploading ${files.length} images as one ImageChest post...` : `Uploading 0 of ${files.length} images to ImageChest...`);
  render();
  if (mode === "batch") {
    try {
      const images = await Promise.all(files.map(async (file) => ({ name: file.name, type: file.type, data: await asBase64(file) })));
      const response = await fetch("/api/imgchest/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, title: "CtrlEm image queue", images })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.result?.message || data.result?.error || data.error || `Upload failed (${data.status})`);
      const uploadedImages = data.result?.data?.images || [];
      uploadedImages.forEach((image, index) => state.items.push({
        url: image.link,
        command: $("command").value,
        status: "",
        statusLabel: "Queued",
        filename: files[index]?.name || image.link.split("/").pop(),
        mediaType: files[index]?.type
      }));
      notice(`${uploadedImages.length} images uploaded as one NSFW-marked batch and added to the queue.`);
    } catch (error) {
      notice(error instanceof TypeError ? "Could not reach the local server. Make sure npm start is running, then try again." : error.message, true);
    }
    $("imageFiles").value = "";
    state.uploading = false;
    render();
    return;
  }
  let uploaded = 0;
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    try {
      const image = { name: file.name, type: file.type, data: await asBase64(file) };
      const titlePrefix = file.name;
      const response = await fetch("/api/imgchest/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, title: `${titlePrefix}+#${index + 1}`, images: [image] })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.result?.message || data.result?.error || data.error || `Upload failed (${data.status})`);
      const uploadedImage = data.result?.data?.images?.[0];
      if (!uploadedImage?.link) throw new Error("ImageChest did not return an image URL.");
      state.items.push({
        url: uploadedImage.link,
        command: $("command").value,
        status: "",
        statusLabel: "Queued",
        filename: `${titlePrefix}+#${index + 1}`,
        mediaType: file.type
      });
      uploaded += 1;
      notice(`Uploaded ${uploaded} of ${files.length} images to ImageChest.`);
      render();
    } catch (error) {
      notice(`${file.name}: ${error.message}`, true);
    }
  }
  $("imageFiles").value = "";
  state.uploading = false;
  if (uploaded) notice(`${uploaded} image${uploaded === 1 ? "" : "s"} uploaded and added to the queue.`);
  render();
}
async function asBase64(file) {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function mediaTypeFromUrl(url) {
  const path = new URL(url).pathname.toLowerCase();
  return /\.(mp4|webm|mov|m4v|avi)(?:$|\.)/.test(path) ? "video/*" : "image/*";
}
async function sendQueue() {
  const apiKey = $("apiKey").value.trim(), target = $("target").value.trim().toUpperCase();
  if (!apiKey) return notice("Enter your API key first.", true);
  if (!/^[A-Z0-9]{5}$/.test(target)) return notice("Enter a valid 5-character control code.", true);
  state.sending = true; notice("Sending queue. CtrlEm allows one command every 3 seconds per user."); render();
  for (let i = 0; i < state.items.length; i++) {
    const item = state.items[i]; item.status = "sending"; item.statusLabel = "Sending..."; render();
    try {
      const response = await fetch("/api/command", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ apiKey, payload:{ target, command:item.command, argument:item.url } }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.result?.error || data.error || `Request failed (${data.status})`);
      item.status = "success"; item.statusLabel = "Sent";
    } catch (error) { item.status = "error"; item.statusLabel = error.message.slice(0, 28); }
    render();
    if (i < state.items.length - 1) await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  state.sending = false; notice("Queue finished. Review any items marked with an error."); render();
}
$("addButton").addEventListener("click", addImage); $("uploadButton").addEventListener("click", uploadImages); $("sendButton").addEventListener("click", sendQueue);
$("uploadMode").addEventListener("change", () => {
  $("uploadHint").innerHTML = $("uploadMode").value === "batch"
    ? "Uploads up to 20 images as one unlisted (hidden), NSFW-marked post. This is usually faster."
    : "Uploads each image as its own unlisted (hidden), NSFW-marked post with titles such as <code>photo+#1</code>. No batch limit.";
});
$("imageUrl").addEventListener("keydown", (e) => { if (e.key === "Enter") addImage(); });
$("queue").addEventListener("click", (e) => { const i = e.target.dataset.remove; if (i !== undefined && !state.sending) { state.items.splice(Number(i), 1); render(); } });
$("clearButton").addEventListener("click", () => { if (!state.sending) { state.items = []; render(); } }); render();
