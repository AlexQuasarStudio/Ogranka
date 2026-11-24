/* Updates, release history, feedback and GitHub issues. */
const GITHUB_REPO = "AlexQuasarStudio/Ogranka";

async function openExternal(url) {
  if (!url) return;
  try {
    if (window.pywebview?.api?.open_url) {
      await window.pywebview.api.open_url(url);
      return;
    }
  } catch (error) {
  }
  window.open(url, "_blank", "noopener");
}

function renderReleaseInline(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  return html;
}

function renderPatchNotes(text, truncated) {
  const source = String(text || "").replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!source) return '<p class="update-empty">В описании релиза пока нет подробностей.</p>';
  const lines = source.split("\n");
  let html = "";
  let list = null;
  let paragraph = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    html += "<p>" + paragraph.map(renderReleaseInline).join("<br>") + "</p>";
    paragraph = [];
  };
  const closeList = () => {
    if (!list) return;
    html += "</" + list + ">";
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      closeList();
      continue;
    }
    if (/^-{3,}$/.test(line)) {
      flushParagraph();
      closeList();
      html += "<hr>";
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const tag = heading[1].length === 1 ? "h3" : "h4";
      html += "<" + tag + ">" + renderReleaseInline(heading[2]) + "</" + tag + ">";
      continue;
    }
    if (/^[-*+]\s+/.test(line)) {
      flushParagraph();
      if (list !== "ul") {
        closeList();
        html += "<ul>";
        list = "ul";
      }
      html += "<li>" + renderReleaseInline(line.replace(/^[-*+]\s+/, "")) + "</li>";
      continue;
    }
    if (/^\d+[.)]\s+/.test(line)) {
      flushParagraph();
      if (list !== "ol") {
        closeList();
        html += "<ol>";
        list = "ol";
      }
      html += "<li>" + renderReleaseInline(line.replace(/^\d+[.)]\s+/, "")) + "</li>";
      continue;
    }
    closeList();
    paragraph.push(line);
  }
  flushParagraph();
  closeList();
  if (truncated) html += '<p class="update-truncated">Показаны первые 12 000 символов описания.</p>';
  return html;
}

function formatReleaseDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric", month: "long", year: "numeric",
  }).format(date);
}

function isBuildUpdate(info) {
  if (!info) return false;
  if (info.update_kind) return info.update_kind === "build";
  return !!info.version && info.version === info.current;
}

function updateHeadline(info) {
  return "Доступно обновление";
}

function setUpdateInstall(state) {
  const text = $("updateInstallState");
  const bar = $("updateProgress");
  const fill = $("updateProgressFill");
  if (!text || !bar || !fill) return;
  const current = state || {};
  const progress = Math.max(0, Math.min(1, Number(current.progress) || 0));
  const active = ["downloading", "verifying", "installing", "restarting"].includes(current.state);
  bar.classList.toggle("hidden", !active);
  fill.style.width = Math.round(progress * 100) + "%";
  text.classList.toggle("error", current.state === "error");
  text.classList.toggle("busy", active);
  text.setAttribute("aria-busy", String(active));
  if (current.state === "error") {
    text.textContent = current.error || "Не удалось установить обновление.";
  } else if (current.detail) {
    text.textContent = current.detail;
  } else if (current.state === "restarting") {
    text.textContent = "Обновление установлено. Перезапускаю приложение…";
  } else if (current.state && current.state !== "idle") {
    text.textContent = "Подготовка…";
  } else {
    text.textContent = "";
  }
}

function showUpdateModal(info) {
  if (!info || !info.available) return;
  $("changelogModal").classList.add("hidden");
  const version = info.version || info.tag || "";
  const buildOnly = isBuildUpdate(info);
  $("updateTitle").textContent = updateHeadline(info);
  const date = formatReleaseDate(info.published_at);
  const meta = [];
  if (!buildOnly && version) meta.push("версия " + version);
  if (!buildOnly && info.build) meta.push("сборка " + info.build);
  if (date) meta.push("опубликовано " + date);
  $("updateMeta").textContent = meta.join(" · ");
  $("updateNotes").innerHTML = renderPatchNotes(info.notes, info.notes_truncated);
  const download = $("updateDownload");
  const installable = !!info.installable;
  download.textContent = installable ? "Установить и перезапустить" : (info.asset_url ? "Скачать обновление" : "Открыть страницу релиза");
  download.disabled = installable ? false : !(info.asset_url || info.url);
  download.title = installable
    ? "Скачать, установить и перезапустить приложение"
    : (info.asset || "Страница релиза");
  $("updateInstallHint").textContent = installable
    ? "Приложение скачает обновление, установит его и перезапустится."
    : (info.install_hint || "Автоустановка недоступна. Скачайте обновление вручную.");
  if (App.updateInstallActive) setUpdateInstall(App.updateInstall);
  else setUpdateInstall(null);
  const release = $("updateRelease");
  release.classList.toggle("hidden", !info.release_url || info.release_url === info.url);
  $("updateModal").classList.remove("hidden");
}

function renderChangelog(info) {
  const list = $("changelogList");
  const releases = info && Array.isArray(info.releases) ? info.releases : [];
  const current = document.querySelector('meta[name="version"]')?.content || "";
  if (!info || !info.checked) {
    $("changelogMeta").textContent = "Не удалось загрузить";
    list.innerHTML = '<p class="update-empty">История сейчас недоступна. Проверьте подключение к GitHub.</p>';
    return;
  }
  if (!releases.length) {
    $("changelogMeta").textContent = "Релизов пока нет";
    list.innerHTML = '<p class="update-empty">Опубликованных релизов пока нет.</p>';
    return;
  }
  const latestDate = formatReleaseDate(releases[0].published_at);
  $("changelogMeta").textContent = "Всего: " + releases.length + (latestDate ? " · последний " + latestDate : "");
  list.innerHTML = releases.map((release, index) => {
    const version = release.version || release.tag || "";
    const title = release.title || (version ? "Огранка " + version : "Релиз");
    const date = formatReleaseDate(release.published_at);
    const badges = [];
    if (index === 0) badges.push('<span class="changelog-badge">последний</span>');
    if (version && version === current) badges.push('<span class="changelog-badge current">установлена</span>');
    if (release.prerelease) badges.push('<span class="changelog-badge">pre-release</span>');
    const link = release.url
      ? '<button class="changelog-link" data-url="' + escapeHtml(release.url) + '">Страница релиза</button>'
      : "";
    return '<article class="changelog-entry">' +
      '<div class="changelog-head"><h3>' + escapeHtml(title) + '</h3>' +
      badges.join("") +
      '<span class="changelog-date">' + escapeHtml(date) + '</span></div>' +
      '<div class="changelog-notes update-notes">' +
      renderPatchNotes(release.notes, release.notes_truncated) +
      '</div>' + link + '</article>';
  }).join("");
}

async function loadChangelog(force = false) {
  const list = $("changelogList");
  $("changelogMeta").textContent = "";
  list.innerHTML = '<p class="update-empty">Загружаю историю…</p>';
  try {
    const response = await fetch("/api/changelog" + (force ? "?force=1" : ""));
    if (!response.ok) throw new Error("changelog unavailable");
    renderChangelog(await response.json());
  } catch (error) {
    $("changelogMeta").textContent = "Ошибка загрузки";
    list.innerHTML = '<p class="update-empty">Не удалось загрузить историю изменений.</p>';
  }
}

function showChangelog(force = false) {
  $("updateModal").classList.add("hidden");
  $("aboutModal").classList.add("hidden");
  $("changelogModal").classList.remove("hidden");
  return loadChangelog(force);
}

function composeFeedback() {
  const type = $("feedbackType").value || "Другое";
  const name = $("feedbackName").value.trim();
  const contact = $("feedbackContact").value.trim();
  const message = $("feedbackText").value.trim();
  const version = document.querySelector('meta[name="version"]')?.content || "";
  const build = document.querySelector('meta[name="build"]')?.content || "";
  const title = "[Обратная связь] " + type + " · Огранка " + version;
  const lines = ["Тип: " + type];
  if (name) lines.push("Имя: " + name);
  if (contact) lines.push("Контакт: " + contact);
  lines.push("", message, "", "Версия: " + version + (build ? " (сборка " + build + ")" : ""));
  if (navigator.platform) lines.push("Платформа: " + navigator.platform);
  return { type, name, contact, message, title, body: lines.join("\n") };
}

function formatFeedbackDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function setFeedbackStatus(text, isError = false) {
  const status = $("feedbackStatus");
  status.textContent = text;
  status.className = "feedback-status" + (isError ? " error" : "");
}

function showFeedback() {
  $("updateModal").classList.add("hidden");
  $("changelogModal").classList.add("hidden");
  $("aboutModal").classList.add("hidden");
  $("feedbackModal").classList.remove("hidden");
  setFeedbackStatus("");
  switchFeedbackTab("send");
  $("feedbackText").focus();
}

async function copyFeedback(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

function githubIssueUrl(data) {
  const url = new URL("https://github.com/" + GITHUB_REPO + "/issues/new");
  url.searchParams.set("title", data.title);
  url.searchParams.set("body", data.body);
  url.searchParams.set("labels", "feedback");
  return url.toString();
}

async function submitFeedback() {
  const data = composeFeedback();
  if (data.message.length < 3) {
    setFeedbackStatus("Напишите сообщение — хотя бы пару слов.", true);
    return;
  }
  const button = $("feedbackOpenBrowser");
  button.disabled = true;
  try {
    await openExternal(githubIssueUrl(data));
    setFeedbackStatus("GitHub открыт в браузере. Проверьте текст и приложите файлы.");
    $("feedbackText").value = "";
  } catch (error) {
    setFeedbackStatus(String(error.message || error), true);
  } finally {
    button.disabled = false;
  }
}

let feedbackTabToken = 0;

function switchFeedbackTab(name) {
  const tab = name === "issues" ? "issues" : "send";
  document.querySelectorAll(".feedback-tab").forEach((button) => {
    const active = button.dataset.feedbackTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  const send = $("feedbackSendPane");
  const issues = $("feedbackIssuesPane");
  const next = tab === "send" ? send : issues;
  const current = send.classList.contains("hidden") ? issues : send;
  if (!next || current === next) {
    if (tab === "issues") loadGithubIssues(false);
    return;
  }
  const wrap = $("feedbackPanes");
  const token = ++feedbackTabToken;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const reveal = () => {
    if (token !== feedbackTabToken) return;
    current.classList.add("hidden");
    current.classList.remove("is-leaving");
    next.classList.remove("hidden");
    next.classList.add("is-entering");
    if (wrap && !reduce) {
      const startHeight = Number.parseFloat(wrap.style.height) || next.getBoundingClientRect().height;
      const endHeight = next.getBoundingClientRect().height;
      wrap.style.height = `${startHeight}px`;
      void wrap.offsetWidth;
      wrap.style.height = `${endHeight}px`;
      window.setTimeout(() => {
        if (token !== feedbackTabToken) return;
        wrap.style.height = "";
      }, 240);
    }
    let entered = false;
    const enter = () => {
      if (entered || token !== feedbackTabToken) return;
      entered = true;
      next.classList.remove("is-entering");
    };
    requestAnimationFrame(enter);
    window.setTimeout(enter, 60);
    if (tab === "issues") loadGithubIssues(false);
  };

  if (reduce) {
    if (wrap) wrap.style.height = "";
    reveal();
    return;
  }
  const startHeight = wrap ? wrap.getBoundingClientRect().height : 0;
  if (wrap) wrap.style.height = `${startHeight}px`;
  current.classList.add("is-leaving");
  window.setTimeout(reveal, 150);
}

function renderGithubIssues(info) {
  const list = $("githubIssuesList");
  const meta = $("githubIssuesMeta");
  if (!list || !meta) return;
  if (!info || !info.checked) {
    meta.textContent = "Не удалось загрузить проблемы";
    list.innerHTML = '<p class="feedback-empty">GitHub сейчас недоступен. Попробуйте обновить.</p>';
    return;
  }
  const rows = Array.isArray(info.issues) ? info.issues : [];
  meta.textContent = rows.length ? rows.length + " проблем" : "Проблем пока нет";
  if (!rows.length) {
    list.innerHTML = '<p class="feedback-empty">Открытых и закрытых проблем пока нет.</p>';
    return;
  }
  list.innerHTML = rows.map((issue) => {
    const labels = (issue.labels || []).map((label) => {
      const color = /^[0-9a-f]{6}$/i.test(label.color || "") ? "#" + label.color : "#586069";
      return `<span class="issue-label" style="background:${color}">${escapeHtml(label.name || "")}</span>`;
    }).join("");
    const state = issue.state === "closed" ? "закрыта" : "открыта";
    const date = formatFeedbackDate(issue.updated_at || issue.created_at);
    return `<article class="github-issue">
      <div class="github-issue-head">
        <a href="${escapeHtml(issue.url || "#")}" data-github-url="${escapeHtml(issue.url || "")}">#${escapeHtml(String(issue.number || ""))} ${escapeHtml(issue.title || "")}</a>
        <span class="github-issue-state ${escapeHtml(issue.state || "")}">${state}</span>
      </div>
      <div class="github-issue-meta">${escapeHtml(issue.user || "")}${date ? " · " + date : ""} · ${Number(issue.comments) || 0} комм.</div>
      ${labels ? `<div class="github-issue-labels">${labels}</div>` : ""}
    </article>`;
  }).join("");
}

async function loadGithubIssues(force = false) {
  const list = $("githubIssuesList");
  const meta = $("githubIssuesMeta");
  if (list) list.innerHTML = '<p class="feedback-empty">Загружаю…</p>';
  if (meta) meta.textContent = "Загружаю проблемы…";
  try {
    const response = await fetch("/api/github/issues" + (force ? "?force=1" : ""), { cache: "no-store" });
    if (!response.ok) throw new Error("github issues unavailable");
    renderGithubIssues(await response.json());
  } catch (error) {
    if (meta) meta.textContent = "Ошибка загрузки";
    if (list) list.innerHTML = '<p class="feedback-empty">Не удалось загрузить проблемы GitHub.</p>';
  }
}

function hideUpdateToast() {
  $("updateToast").classList.add("hidden");
}

function showUpdateToast(info) {
  if (!info || !info.available) {
    hideUpdateToast();
    return;
  }
  const version = info.version || info.current || "";
  const build = info.build ? " · сборка " + info.build : "";
  $("updateToastText").textContent = version + build + ". Откройте, чтобы установить.";
  $("updateToast").classList.remove("hidden");
}

async function checkForUpdates(force = false) {
  const button = $("updateBtn");
  const state = $("updateState");
  if (force && state) {
    state.className = "update-state";
    state.textContent = "Проверяю обновления…";
  }
  try {
    const response = await fetch("/api/update" + (force ? "?force=1" : ""));
    if (!response.ok) throw new Error("update unavailable");
    const info = await response.json();
    App.update = info;
    if (button) {
      if (info.available) {
        const label = button.querySelector("span");
        if (label) label.textContent = "Доступно обновление";
        button.title = updateHeadline(info) + (info.version ? " · " + info.version : "");
        button.classList.remove("hidden");
      } else {
        button.classList.add("hidden");
      }
    }
    if (info.available) showUpdateToast(info);
    else hideUpdateToast();
    if (force && state) {
      if (info.available) {
        state.className = "update-state good";
        state.textContent = updateHeadline(info) + ".";
      } else if (info.checked) {
        state.className = "update-state";
        state.textContent = "Обновлений нет — установлена последняя версия (" + info.current + ").";
      } else {
        state.className = "update-state warn";
        state.textContent = "Не удалось проверить обновления. Попробуйте позже.";
      }
    }
    return info;
  } catch (error) {
    if (force && state) {
      state.className = "update-state warn";
      state.textContent = "Не удалось проверить обновления. Проверьте подключение.";
    }
    return null;
  }
}

async function pollUpdateInstall() {
  for (let i = 0; i < 600; i++) {
    try {
      const response = await fetch("/api/update/status", { cache: "no-store" });
      if (!response.ok) throw new Error("status unavailable");
      const state = await response.json();
      App.updateInstall = state;
      setUpdateInstall(state);
      if (state.state === "error") {
        App.updateInstallActive = false;
        const button = $("updateDownload");
        button.disabled = false;
        button.textContent = "Установить и перезапустить";
        return;
      }
      if (state.state === "restarting") {
        setTimeout(() => {
          const text = $("updateInstallState");
          if (text && text.textContent.indexOf("перезапуска") === -1) {
            text.textContent = "Приложение перезапускается…";
          }
        }, 1200);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      $("updateProgress").classList.remove("hidden");
      $("updateProgressFill").style.width = "100%";
      const text = $("updateInstallState");
      text.classList.remove("error");
      text.textContent = "Обновление установлено. Приложение перезапускается…";
      return;
    }
  }
}

async function installUpdate() {
  const info = App.update;
  if (!info) return;
  if (!info.installable) {
    const url = info.asset_url || info.url;
    if (url) openExternal(url);
    return;
  }
  const button = $("updateDownload");
  button.disabled = true;
  button.textContent = "Устанавливаю…";
  App.updateInstallActive = true;
  App.updateInstall = { state: "preparing", progress: 0, detail: "Подготовка…" };
  setUpdateInstall(App.updateInstall);
  try {
    const data = await apiPost("/api/update/install", {});
    App.updateInstall = data;
    setUpdateInstall(data);
    pollUpdateInstall();
  } catch (error) {
    App.updateInstallActive = false;
    button.disabled = false;
    button.textContent = "Установить и перезапустить";
    setUpdateInstall({ state: "error", error: String(error.message || error) });
  }
}

function initRestartToast() {
  const toast = $("restartToast");
  if (!toast) return;
  const current = Number(document.querySelector('meta[name="build"]')?.content || 0);
  const updated = document.querySelector('meta[name="just-updated"]')?.content === "1";
  if (!current || !updated) return;
  const text = $("restartToastText");
  if (text) {
    const version = document.querySelector('meta[name="version"]')?.content || "";
    text.textContent = (version ? "Версия " + version + " · " : "") + "сборка " + current + ". Можно продолжать работу.";
  }
  toast.classList.remove("hidden");
  const close = () => toast.classList.add("hidden");
  $("restartToastClose").onclick = close;
  setTimeout(close, 9000);
}
