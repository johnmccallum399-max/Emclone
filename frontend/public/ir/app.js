/* IR Remote — app logic. Depends on encoders.js (IR) and presets.js (IR_PRESETS). */
(() => {
  const STORAGE_KEY = "ir-remote-v1";

  const state = load() || {
    remotes: [],
    activeRemoteId: null,
    settings: { outputMode: "dual", leadInMs: 80 },
  };
  let editMode = false;
  let editingButtonId = null; // null = adding

  // ---------- persistence ----------
  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch {
      return null;
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function activeRemote() {
    return state.remotes.find((r) => r.id === state.activeRemoteId) || null;
  }

  // ---------- audio transmission ----------
  let audioCtx = null;

  async function transmit(button) {
    const encoded = IR.encode(button.protocol, button.params);
    const wave = IR.renderWaveform(encoded, {
      sampleRate: audioCtx ? audioCtx.sampleRate : 48000,
      invertRight: state.settings.outputMode !== "mono",
      repeats: button.repeat || 1,
      leadInMs: state.settings.leadInMs,
    });

    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 48000,
        latencyHint: "interactive",
      });
    }
    if (audioCtx.state === "suspended") await audioCtx.resume();

    // Re-render if the context settled on a different sample rate.
    const pcm =
      wave.sampleRate === audioCtx.sampleRate
        ? wave
        : IR.renderWaveform(encoded, {
            sampleRate: audioCtx.sampleRate,
            invertRight: state.settings.outputMode !== "mono",
            repeats: button.repeat || 1,
            leadInMs: state.settings.leadInMs,
          });

    const buffer = audioCtx.createBuffer(2, pcm.left.length, audioCtx.sampleRate);
    buffer.copyToChannel(pcm.left, 0);
    buffer.copyToChannel(pcm.right, 1);
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start();
    if (navigator.vibrate) navigator.vibrate(15);
  }

  // ---------- toast ----------
  let toastTimer = null;
  function toast(message, isError) {
    const el = document.getElementById("status-toast");
    el.textContent = message;
    el.classList.toggle("error", !!isError);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), isError ? 4000 : 1500);
  }

  // ---------- rendering ----------
  function render() {
    renderTabs();
    renderRemote();
    document.getElementById("edit-toggle").classList.toggle("active", editMode);
    document.body.classList.toggle("edit-mode", editMode);
  }

  function renderTabs() {
    const nav = document.getElementById("remote-tabs");
    nav.innerHTML = "";
    for (const remote of state.remotes) {
      const tab = document.createElement("button");
      tab.className =
        "remote-tab" + (remote.id === state.activeRemoteId ? " active" : "");
      tab.textContent = remote.name;
      tab.onclick = () => {
        state.activeRemoteId = remote.id;
        save();
        render();
      };
      nav.appendChild(tab);
    }
    const add = document.createElement("button");
    add.className = "remote-tab add";
    add.textContent = "+ New";
    add.onclick = openRemoteDialog;
    nav.appendChild(add);
  }

  function renderRemote() {
    const view = document.getElementById("remote-view");
    view.innerHTML = "";
    const remote = activeRemote();

    if (!remote) {
      const note = document.createElement("p");
      note.className = "empty-note";
      note.innerHTML =
        "No remotes yet.<br />Tap <strong>+ New</strong> to create one from a brand preset or from scratch.";
      view.appendChild(note);
      return;
    }

    const grid = document.createElement("div");
    grid.className = "button-grid";
    for (const button of remote.buttons) {
      const el = document.createElement("button");
      el.className = "ir-btn";
      el.dataset.color = button.color || "dark";
      el.textContent = button.label;
      el.onclick = async () => {
        if (editMode) {
          openButtonDialog(button.id);
          return;
        }
        el.classList.add("flash");
        setTimeout(() => el.classList.remove("flash"), 250);
        try {
          await transmit(button);
        } catch (err) {
          toast(String(err.message || err), true);
        }
      };
      grid.appendChild(el);
    }

    if (editMode) {
      const add = document.createElement("button");
      add.className = "ir-btn add-btn";
      add.textContent = "+";
      add.title = "Add button";
      add.onclick = () => openButtonDialog(null);
      grid.appendChild(add);
    }
    view.appendChild(grid);

    if (editMode) {
      const meta = document.createElement("div");
      meta.className = "remote-meta";
      const rename = document.createElement("button");
      rename.textContent = "Rename remote";
      rename.onclick = () => {
        const name = prompt("Remote name", remote.name);
        if (name && name.trim()) {
          remote.name = name.trim().slice(0, 24);
          save();
          render();
        }
      };
      const del = document.createElement("button");
      del.className = "danger";
      del.textContent = "Delete remote";
      del.onclick = () => {
        if (!confirm(`Delete "${remote.name}"?`)) return;
        state.remotes = state.remotes.filter((r) => r.id !== remote.id);
        state.activeRemoteId = state.remotes[0] ? state.remotes[0].id : null;
        save();
        render();
      };
      meta.appendChild(rename);
      meta.appendChild(del);
      view.appendChild(meta);
    }
  }

  // ---------- button dialog ----------
  const buttonDialog = document.getElementById("button-dialog");
  const buttonForm = document.getElementById("button-form");
  const protocolSelect = document.getElementById("protocol-select");

  for (const [key, def] of Object.entries(IR.PROTOCOLS)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = def.label;
    protocolSelect.appendChild(opt);
  }

  function showProtoFields() {
    const proto = protocolSelect.value;
    document.querySelectorAll(".proto-fields").forEach((el) => {
      el.classList.toggle(
        "visible",
        el.dataset.proto.split(" ").includes(proto)
      );
    });
  }
  protocolSelect.onchange = showProtoFields;

  function openButtonDialog(buttonId) {
    editingButtonId = buttonId;
    const remote = activeRemote();
    if (!remote) return;
    buttonForm.reset();
    document.getElementById("button-dialog-title").textContent = buttonId
      ? "Edit button"
      : "Add button";
    document.getElementById("button-delete").hidden = !buttonId;

    if (buttonId) {
      const b = remote.buttons.find((x) => x.id === buttonId);
      if (!b) return;
      buttonForm.label.value = b.label;
      buttonForm.color.value = b.color || "dark";
      protocolSelect.value = b.protocol;
      buttonForm.repeat.value = b.repeat || 1;
      const p = b.params || {};
      if (b.protocol === "nec" || b.protocol === "samsung32") {
        buttonForm.code_hex32.value = p.code || "";
      } else if (b.protocol === "sirc") {
        buttonForm.sirc_bits.value = String(p.bits || 12);
        buttonForm.code_sirc.value = p.code || "";
      } else if (b.protocol === "rc5") {
        buttonForm.rc5_address.value = p.address ?? "";
        buttonForm.rc5_command.value = p.command ?? "";
      } else if (b.protocol === "raw") {
        buttonForm.raw_freq.value = p.frequency || 38000;
        buttonForm.raw_durations.value = Array.isArray(p.durations)
          ? p.durations.join(" ")
          : p.durations || "";
      } else if (b.protocol === "pronto") {
        buttonForm.pronto_code.value = p.code || "";
      }
    }
    showProtoFields();
    buttonDialog.showModal();
  }

  function paramsFromForm() {
    const proto = protocolSelect.value;
    if (proto === "nec" || proto === "samsung32") {
      return { code: buttonForm.code_hex32.value.trim() };
    }
    if (proto === "sirc") {
      return {
        code: buttonForm.code_sirc.value.trim(),
        bits: Number(buttonForm.sirc_bits.value),
      };
    }
    if (proto === "rc5") {
      return {
        address: Number(buttonForm.rc5_address.value),
        command: Number(buttonForm.rc5_command.value),
      };
    }
    if (proto === "raw") {
      return {
        frequency: Number(buttonForm.raw_freq.value),
        durations: buttonForm.raw_durations.value.trim(),
      };
    }
    return { code: buttonForm.pronto_code.value.trim() };
  }

  function buttonFromForm() {
    return {
      id: editingButtonId || uid(),
      label: buttonForm.label.value.trim(),
      color: buttonForm.color.value,
      protocol: protocolSelect.value,
      params: paramsFromForm(),
      repeat: Math.max(1, Number(buttonForm.repeat.value) || 1),
    };
  }

  buttonForm.onsubmit = (e) => {
    const remote = activeRemote();
    if (!remote) return;
    const button = buttonFromForm();
    try {
      IR.encode(button.protocol, button.params); // validate before saving
    } catch (err) {
      e.preventDefault();
      toast(String(err.message || err), true);
      return;
    }
    if (editingButtonId) {
      const i = remote.buttons.findIndex((b) => b.id === editingButtonId);
      if (i >= 0) remote.buttons[i] = button;
    } else {
      remote.buttons.push(button);
    }
    save();
    render();
  };

  document.getElementById("button-test").onclick = async () => {
    try {
      await transmit(buttonFromForm());
      toast("Sent");
    } catch (err) {
      toast(String(err.message || err), true);
    }
  };

  document.getElementById("button-delete").onclick = () => {
    const remote = activeRemote();
    if (remote && editingButtonId) {
      remote.buttons = remote.buttons.filter((b) => b.id !== editingButtonId);
      save();
      render();
    }
    buttonDialog.close();
  };

  document.getElementById("button-cancel").onclick = () => buttonDialog.close();

  // ---------- remote dialog ----------
  const remoteDialog = document.getElementById("remote-dialog");
  const remoteForm = document.getElementById("remote-form");
  const presetSelect = document.getElementById("preset-select");

  for (const preset of IR_PRESETS) {
    const opt = document.createElement("option");
    opt.value = preset.id;
    opt.textContent = preset.name;
    presetSelect.appendChild(opt);
  }
  presetSelect.value = "blank";

  function openRemoteDialog() {
    remoteForm.reset();
    presetSelect.value = "blank";
    remoteDialog.showModal();
  }

  remoteForm.onsubmit = () => {
    const preset = IR_PRESETS.find((p) => p.id === presetSelect.value);
    const remote = {
      id: uid(),
      name: remoteForm.name.value.trim().slice(0, 24) || "Remote",
      buttons: (preset ? preset.buttons : []).map((b) => ({
        id: uid(),
        repeat: b.protocol === "sirc" ? 3 : 1,
        ...b,
        params: { ...b.params },
      })),
    };
    state.remotes.push(remote);
    state.activeRemoteId = remote.id;
    save();
    render();
  };

  document.getElementById("remote-cancel").onclick = () => remoteDialog.close();

  // ---------- settings ----------
  const settingsDialog = document.getElementById("settings-dialog");
  document.getElementById("settings-open").onclick = () => {
    document.getElementById("setting-output").value =
      state.settings.outputMode;
    document.getElementById("setting-leadin").value = state.settings.leadInMs;
    settingsDialog.showModal();
  };
  settingsDialog.addEventListener("close", () => {
    state.settings.outputMode = document.getElementById("setting-output").value;
    state.settings.leadInMs = Math.min(
      1000,
      Math.max(0, Number(document.getElementById("setting-leadin").value) || 0)
    );
    save();
  });

  document.getElementById("export-btn").onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ir-remotes.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importFile = document.getElementById("import-file");
  document.getElementById("import-btn").onclick = () => importFile.click();
  importFile.onchange = async () => {
    const file = importFile.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.remotes)) throw new Error("Not an export file");
      state.remotes = data.remotes;
      state.activeRemoteId =
        data.activeRemoteId || (data.remotes[0] && data.remotes[0].id) || null;
      if (data.settings) Object.assign(state.settings, data.settings);
      save();
      render();
      settingsDialog.close();
      toast("Imported " + data.remotes.length + " remote(s)");
    } catch (err) {
      toast("Import failed: " + (err.message || err), true);
    }
    importFile.value = "";
  };

  // ---------- edit toggle ----------
  document.getElementById("edit-toggle").onclick = () => {
    editMode = !editMode;
    render();
  };

  // ---------- init ----------
  if (!state.activeRemoteId && state.remotes.length) {
    state.activeRemoteId = state.remotes[0].id;
  }
  render();

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
