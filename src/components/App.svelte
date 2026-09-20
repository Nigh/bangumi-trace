<script lang="ts">
  import { onMount } from "svelte"
  import ThemeToggle from "./ThemeToggle.svelte"
  import { importCurrent, importHistory } from "../lib/importer"
  import { emptyData, episodeLabel, eventTime, expandedEpisodes, externalEpisodeRange, hasWatchedAll, matchesTitle, normalizeBangumiData, nextEpisode, nextVolumeEpisode, setDefaultAlias, setDefaultTitle, sortShowsByActivity, statusDisplay, uniqueTitles, volumeLabel, type BangumiData, type Folder, type Precision, type Show, type Status, type Volume, type WatchEvent } from "../lib/model"
  import { getTmdbSeries, loadData, loginUrl, logout, saveData, searchTmdb } from "../lib/api"
  import { validateData } from "../../shared/validation"

  const ASSET_BASE = import.meta.env.BASE_URL.replace(/\/$/, "")
  const CACHE = "bangumi-trace-cache"
  const SETUP_DOC = "https://github.com/Nigh/bangumi-trace/blob/main/docs/DEPLOYMENT.md#6-%E4%BD%BF%E7%94%A8%E4%B8%8E%E8%BF%81%E7%A7%BB%E4%B8%AA%E4%BA%BA%E6%95%B0%E6%8D%AE"
  const statuses: { value: Status; label: string; badge: string }[] = [
    { value: "planned", label: "计划观看", badge: "badge-ghost" },
    { value: "watching", label: "正在追番", badge: "badge-info" },
    { value: "completed", label: "标记完成", badge: "badge-success" },
    { value: "dropped", label: "已经弃番", badge: "badge-neutral" }
  ]
  let data: BangumiData = emptyData(), sha: string | null = null, query = "", statusFilter: Status[] = statuses.map(({ value }) => value), listRank = new Map<string, number>()
  let view = "list", selectedId = "", notice = "", importError = "", noticeAction: (() => void) | null = null, auth: "checking" | "authenticated" | "unauthenticated" | "repository-error" = "checking", busy = false, dirty = false
  let importBackup: BangumiData | null = null, repositoryDialog: HTMLDialogElement, confirmDialog: HTMLDialogElement, addShowDialog: HTMLDialogElement, addVolumeDialog: HTMLDialogElement, metadataDialog: HTMLDialogElement, folderDialog: HTMLDialogElement, moveDialog: HTMLDialogElement
  let confirmation: { title: string; body: string; label: string; danger: boolean; action: () => void | Promise<void>; secondaryLabel?: string; secondaryAction?: () => void | Promise<void> } = { title: "", body: "", label: "确认", danger: false, action: () => {} }
  let newTitle = "", addToFolderId = "", folderName = "", editingFolderId = "", metadataQuery = "", candidates: Awaited<ReturnType<typeof searchTmdb>>["data"] = [], tmdbSeries: Awaited<ReturnType<typeof getTmdbSeries>> | null = null, targetVolumeId = "", metadataBusy = false, metadataSearched = false, metadataError = ""
  let volumeType = "正剧", customVolumeType = "", volumeEpisodes = 12
  let volumeId = "", episodeFrom = 1, episodeTo = 1, rangeAnchor: number | null = null, precision: Precision = "unknown", watchedValue = "", editingEventId = "", recordError = "", activeSubtitle = -1
  let editingVolumeId = "", editingVolumeEpisodes = 1, editingNote = false, noteDraft = "", editingAliasIndex: number | null = null, aliasDraft = ""
  let volumeUndo = new Map<string, { events: WatchEvent[]; wasPlanned: boolean }>()

  $: selected = data.shows.find((show) => show.id === selectedId)
  $: selectedOwner = data.folders.find((folder) => folder.showIds.includes(selectedId))
  $: selectedComplete = selected ? hasWatchedAll(data, selected) : false
  $: selectedFolder = data.folders.find((folder) => folder.id === selectedId)
  $: assignedIds = new Set(data.folders.flatMap((folder) => folder.showIds))
  $: folderShows = selectedFolder ? data.shows.filter((show) => selectedFolder!.showIds.includes(show.id)) : []
  $: visibleSource = view === "folder" ? folderShows : query.trim() ? data.shows : data.shows.filter((show) => !assignedIds.has(show.id))
  $: shows = visibleSource.filter((show) => statusFilter.includes(show.status) && matchesTitle(show, query)).sort((a, b) => (listRank.get(a.id) ?? Infinity) - (listRank.get(b.id) ?? Infinity))
  $: visibleFolders = view === "list" && !query.trim() ? data.folders.filter((folder) => !folder.showIds.length || folder.showIds.some((id) => { const show = data.shows.find((item) => item.id === id); return show && statusFilter.includes(show.status) })).sort((a, b) => Math.min(...a.showIds.map((id) => listRank.get(id) ?? Infinity)) - Math.min(...b.showIds.map((id) => listRank.get(id) ?? Infinity))) : []
  $: unassignedShows = data.shows.filter((show) => !assignedIds.has(show.id))
  $: events = selected ? data.watchEvents.filter((event) => event.showId === selected.id).sort((a, b) => eventTime(b) - eventTime(a)) : []
  $: recordVolume = selected?.volumes.find((volume) => volume.id === volumeId)

  function route(hash = location.hash) {
    const [, next = "list", id = ""] = hash.match(/^#([^/]+)(?:\/(.+))?/) ?? []
    view = next; selectedId = id; activeSubtitle = -1; editingVolumeId = ""; editingNote = false; editingAliasIndex = null
    if (next === "list" || next === "folder") refreshListOrder()
  }
  function refreshListOrder() { listRank = new Map(sortShowsByActivity(data, data.shows).map((show, index) => [show.id, index])) }
  function toggleStatus(status: Status) { statusFilter = statusFilter.includes(status) ? statusFilter.filter((item) => item !== status) : [...statusFilter, status] }
  const go = (next: string) => { location.hash = next }
  function cache(markDirty = true) { dirty = markDirty; localStorage.setItem(CACHE, JSON.stringify({ data, sha })) }
  function message(text: string, action: (() => void) | null = null) { notice = text; noticeAction = action; setTimeout(() => { if (notice === text) { notice = ""; noticeAction = null } }, 4000) }
  function ask(title: string, body: string, action: () => void | Promise<void>, label = "确认", danger = false) {
    confirmation = { title, body, action, label, danger }; confirmDialog.showModal()
  }
  async function confirmAction() { confirmDialog.close(); await confirmation.action() }
  async function secondaryConfirmAction() { confirmDialog.close(); await confirmation.secondaryAction?.() }
  const nowForInput = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)

  onMount(() => {
    const handleRoute = () => route()
    route(); addEventListener("hashchange", handleRoute)
    const cached = localStorage.getItem(CACHE)
    if (cached) try { const value = JSON.parse(cached); const normalized = normalizeBangumiData(value.data); if (!normalized) throw new Error(); data = normalized; sha = value.sha; dirty = false; refreshListOrder() } catch { localStorage.removeItem(CACHE) }
    void sync(false)
    return () => removeEventListener("hashchange", handleRoute)
  })

  async function sync(force = true, confirmed = false) {
    if (force && dirty && !confirmed) return ask("覆盖本地修改？", "强制同步会永久放弃尚未保存的本地修改，并使用 GitHub 数据覆盖。", () => sync(true, true), "覆盖并同步", true)
    busy = true
    try { const loaded = await loadData(); data = loaded.data; sha = loaded.sha; volumeUndo = new Map(); auth = "authenticated"; cache(false); if (view === "list" || view === "folder") refreshListOrder(); if (force) message("已用 GitHub 数据覆盖本地内容") }
    catch (error) {
      const apiError = error as { status?: number; code?: string; message: string }
      if (apiError.code === "DATA_REPOSITORY_UNAVAILABLE") { auth = "repository-error"; repositoryDialog?.showModal() }
      else if (apiError.status === 401) auth = "unauthenticated"
      else message(apiError.message)
    } finally { busy = false }
  }
  async function save() {
    busy = true
    try { ({ sha } = await saveData(data, sha)); volumeUndo = new Map(); cache(false); auth = "authenticated"; message("已保存到 GitHub") }
    catch (error) {
      const apiError = error as { status?: number; code?: string; message: string }
      if (apiError.code === "DATA_REPOSITORY_UNAVAILABLE") { auth = "repository-error"; repositoryDialog?.showModal() }
      else message(apiError.status === 409 ? "远端已有更新，请强制同步后重新应用修改" : apiError.message)
    } finally { busy = false }
  }
  function openAddShow(folderId = "") { addToFolderId = folderId; addShowDialog.showModal() }
  function addShow() {
    if (!newTitle.trim()) return
    const show: Show = { id: crypto.randomUUID(), title: [newTitle.trim()], status: "planned", volumes: [] }
    listRank.set(show.id, Math.min(0, ...listRank.values()) - 1)
    data = { ...data, shows: [...data.shows, show], folders: data.folders.map((folder) => folder.id === addToFolderId ? { ...folder, showIds: [...folder.showIds, show.id] } : folder) }
    newTitle = ""; addToFolderId = ""; addShowDialog.close(); cache()
  }
  function editFolder(folder?: Folder) { editingFolderId = folder?.id ?? ""; folderName = folder?.name ?? ""; folderDialog.showModal() }
  function saveFolder() {
    const name = folderName.trim(); if (!name) return
    data = editingFolderId ? { ...data, folders: data.folders.map((folder) => folder.id === editingFolderId ? { ...folder, name } : folder) } : { ...data, folders: [...data.folders, { id: crypto.randomUUID(), name, showIds: [] }] }
    folderDialog.close(); cache()
  }
  function dissolveFolder(folder: Folder) { ask("解散目录？", `“${folder.name}”中的作品会回到我的番剧，作品数据不会删除。`, () => { data = { ...data, folders: data.folders.filter((item) => item.id !== folder.id) }; cache(); go("list") }, "解散目录", true) }
  function moveToFolder(showId: string) {
    if (!selectedFolder) return
    data = { ...data, folders: data.folders.map((folder) => folder.id === selectedFolder!.id ? { ...folder, showIds: [...folder.showIds, showId] } : folder) }
    moveDialog.close(); cache()
  }
  function updateShow(next: Show) { data = { ...data, shows: data.shows.map((show) => show.id === next.id ? next : show) }; cache() }
  function removeShow(show: Show) {
    ask("删除作品？", `“${show.title[0]}”及其观看记录都会被删除。`, () => {
      data = { ...data, shows: data.shows.filter((item) => item.id !== show.id), watchEvents: data.watchEvents.filter((event) => event.showId !== show.id), folders: data.folders.map((folder) => ({ ...folder, showIds: folder.showIds.filter((id) => id !== show.id) })) }
      cache(); go("list")
    }, "删除作品", true)
  }
  function addVolume(bind = false) {
    if (!selected || !Number.isInteger(volumeEpisodes) || volumeEpisodes < 1 || volumeEpisodes > 256) return message("集数必须是 1–256 的整数")
    const type = volumeType === "自定义" ? customVolumeType.trim() : volumeType
    if (!type) return message("请输入 volume 类型")
    const volume: Volume = { id: crypto.randomUUID(), type, episodeCount: volumeEpisodes }
    updateShow({ ...selected, volumes: [...selected.volumes, volume] })
    customVolumeType = ""; addVolumeDialog.close(); if (bind) openMetadata(volume)
  }
  function resizeVolume(volume: Volume, episodeCount: number) {
    if (!selected || !Number.isInteger(episodeCount) || episodeCount < 1 || episodeCount > 256) return message("集数必须是 1–256 的整数")
    const watched = data.watchEvents.filter((event) => event.episodes.volumeId === volume.id).reduce((max, event) => Math.max(max, event.episodes.to), 0)
    if (episodeCount < watched) return message(`集数不能小于已观看的第 ${watched} 话`)
    updateShow({ ...selected, volumes: selected.volumes.map((item) => item.id === volume.id ? { ...item, episodeCount } : item) })
    editingVolumeId = ""
  }
  function editVolume(volume: Volume) { editingVolumeId = volume.id; editingVolumeEpisodes = volume.episodeCount }
  function editNote() { noteDraft = selected?.note ?? ""; editingNote = true }
  function saveNote() { if (selected) updateShow({ ...selected, note: noteDraft }); editingNote = false }
  function editAlias(index = -1) { editingAliasIndex = index; aliasDraft = index < 0 ? "" : selected?.aliases?.[index] ?? "" }
  function saveAlias() {
    if (!selected) return
    const alias = aliasDraft.trim(), aliases = selected.aliases ?? []
    if (!alias) return message("请输入别名")
    if ([...selected.title, ...aliases.filter((_, index) => index !== editingAliasIndex)].some((title) => title.localeCompare(alias, undefined, { sensitivity: "accent" }) === 0)) return message("别名已存在")
    updateShow({ ...selected, aliases: editingAliasIndex === -1 ? [...aliases, alias] : aliases.map((item, index) => index === editingAliasIndex ? alias : item) })
    editingAliasIndex = null; aliasDraft = ""
  }
  function removeAlias(index: number) { if (selected) updateShow({ ...selected, aliases: (selected.aliases ?? []).filter((_, item) => item !== index) }) }
  function setAliasDisplayName(index: number) { if (selected) updateShow(setDefaultAlias(selected, index)) }
  function removeVolume(volume: Volume) {
    if (!selected) return
    const count = data.watchEvents.filter((event) => event.episodes.volumeId === volume.id).length
    ask(`删除 ${volumeLabel(selected, volume)}？`, count ? `同时会删除其中的 ${count} 条观看记录。` : "此操作无法撤销。", () => {
      data = { ...data, shows: data.shows.map((show) => show.id === selected.id ? { ...show, volumes: show.volumes.filter((item) => item.id !== volume.id) } : show), watchEvents: data.watchEvents.filter((event) => event.episodes.volumeId !== volume.id) }
      cache()
    }, "删除 Volume", true)
  }
  function rememberVolume(show: Show, volumeId: string) {
    if (volumeUndo.has(volumeId)) return
    volumeUndo = new Map(volumeUndo).set(volumeId, { events: data.watchEvents.filter((event) => event.episodes.volumeId === volumeId), wasPlanned: show.status === "planned" })
  }
  function undoVolume(show: Show, volume: Volume) {
    const snapshot = volumeUndo.get(volume.id)
    if (!snapshot) return
    const watchEvents = [...data.watchEvents.filter((event) => event.episodes.volumeId !== volume.id), ...snapshot.events]
    data = { ...data, watchEvents, shows: data.shows.map((item) => item.id === show.id && snapshot.wasPlanned && !watchEvents.some((event) => event.showId === show.id) ? { ...item, status: "planned" } : item) }
    const remainingUndo = new Map(volumeUndo); remainingUndo.delete(volume.id); volumeUndo = remainingUndo
    cache(); message(`已撤销 ${volumeLabel(show, volume)} 的未保存观看操作`)
  }
  function recordEpisode(show: Show, volume: Volume, episode: number) {
    if (data.watchEvents.some((event) => event.episodes.volumeId === volume.id && event.episodes.from <= episode && event.episodes.to >= episode)) return
    rememberVolume(show, volume.id)
    const event: WatchEvent = { id: crypto.randomUUID(), showId: show.id, episodes: { volumeId: volume.id, from: episode, to: episode }, watchedAt: { precision: "exact", value: new Date().toISOString() }, recordedAt: new Date().toISOString(), source: "manual" }
    data = { ...data, watchEvents: [...data.watchEvents, event], shows: data.shows.map((item) => item.id === show.id && item.status === "planned" ? { ...item, status: "watching" } : item) }
    cache(); message("已记录 " + volumeLabel(show, volume) + "第 " + episode + " 话")
  }
  function quickRecord(show: Show, volume: Volume) { const episode = nextEpisode(data, volume); if (episode) recordEpisode(show, volume, episode) }
  function selectRange(episode: number) {
    if (rangeAnchor === null) { episodeFrom = episodeTo = episode; rangeAnchor = episode }
    else { episodeFrom = Math.min(rangeAnchor, episode); episodeTo = Math.max(rangeAnchor, episode); rangeAnchor = null }
  }
  function startRecord(show: Show, event?: WatchEvent) {
    selectedId = show.id; editingEventId = event?.id ?? ""
    volumeId = event?.episodes.volumeId ?? show.volumes[0]?.id ?? ""
    episodeFrom = event?.episodes.from ?? 1; episodeTo = event?.episodes.to ?? episodeFrom
    precision = event?.watchedAt.precision === "range" ? "unknown" : event?.watchedAt.precision ?? "unknown"
    watchedValue = event?.watchedAt.precision === "exact" ? event.watchedAt.value.slice(0, 16) : event?.watchedAt.precision === "day" || event?.watchedAt.precision === "month" || event?.watchedAt.precision === "year" ? event.watchedAt.value : nowForInput()
    rangeAnchor = null; recordError = ""; go(`record/${show.id}`)
  }
  function record() {
    if (!selected) return
    const volume = selected.volumes.find((item) => item.id === volumeId)
    recordError = ""
    if (!volume || episodeFrom < 1 || episodeTo < episodeFrom || episodeTo > volume.episodeCount) return recordError = "话数超出 Volume 范围，请检查起始话和结束话。"
    if (precision !== "unknown" && !watchedValue) return recordError = "请选择观看时间。"
    let watchedAt: WatchEvent["watchedAt"] = { precision: "unknown" }
    if (precision === "year" && !/^\d{4}$/.test(watchedValue)) return recordError = "请输入四位年份。"
    if (precision === "exact") watchedAt = { precision, value: new Date(watchedValue).toISOString() }
    if (precision === "day") watchedAt = { precision, value: watchedValue.slice(0, 10) }
    if (precision === "month") watchedAt = { precision, value: watchedValue.slice(0, 7) }
    if (precision === "year") watchedAt = { precision, value: watchedValue.slice(0, 4) }
    const existing = data.watchEvents.find((item) => item.id === editingEventId)
    if (existing) rememberVolume(selected, existing.episodes.volumeId)
    rememberVolume(selected, volume.id)
    const event: WatchEvent = { id: existing?.id ?? crypto.randomUUID(), showId: selected.id, episodes: { volumeId, from: episodeFrom, to: episodeTo }, watchedAt, recordedAt: existing?.recordedAt ?? new Date().toISOString(), source: existing?.source ?? "manual", confidence: existing?.confidence, sourceCommit: existing?.sourceCommit }
    data = { ...data, watchEvents: existing ? data.watchEvents.map((item) => item.id === existing.id ? event : item) : [...data.watchEvents, event], shows: data.shows.map((show) => show.id === selected.id && show.status === "planned" ? { ...show, status: "watching" } : show) }
    cache(); go(`show/${selected.id}`)
  }
  function removeEvent(id: string) {
    ask("删除观看记录？", "此操作无法撤销。", () => { data = { ...data, watchEvents: data.watchEvents.filter((event) => event.id !== id) }; cache() }, "删除记录", true)
  }
  function displayDate(event: WatchEvent) {
    const watched = event.watchedAt
    if (watched.precision === "unknown") return "时间未知"
    if (watched.precision === "range") return `${watched.from} 至 ${watched.to}（${watched.label}）`
    if (watched.precision !== "exact") return watched.value
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(watched.value))
  }
  function openMetadata(volume: Volume) {
    targetVolumeId = volume.id; metadataQuery = selected?.title[0] ?? ""; candidates = []; tmdbSeries = null; metadataSearched = false; metadataError = ""; metadataDialog.showModal()
  }
  async function findMetadata() {
    if (!metadataQuery.trim()) return
    metadataBusy = true; metadataSearched = false; metadataError = ""; tmdbSeries = null
    try { candidates = (await searchTmdb(metadataQuery)).data; metadataSearched = true }
    catch (error) { candidates = []; metadataError = (error as Error).message }
    finally { metadataBusy = false }
  }
  async function selectTmdbSeries(candidate: (typeof candidates)[number]) {
    metadataBusy = true; metadataError = ""
    try { tmdbSeries = await getTmdbSeries(candidate.id) }
    catch (error) { metadataError = (error as Error).message }
    finally { metadataBusy = false }
  }
  function bindMetadata(season: NonNullable<typeof tmdbSeries>["seasons"][number]) {
    if (!selected || !tmdbSeries) return
    const volume = selected.volumes.find((item) => item.id === targetVolumeId)
    if (!volume) return
    const series = tmdbSeries
    const apply = (episodeCount: number) => {
      updateShow({ ...selected!, title: uniqueTitles(selected!.title[0], [...series.titles, ...selected!.title.slice(1)]), volumes: selected!.volumes.map((item) => item.id === volume.id ? { ...item, episodeCount, externalRef: { provider: "tmdb", seriesId: series.id, seasonNumber: season.seasonNumber } } : item) })
      message("已绑定 TMDB；同类型 Volume 将自动连续映射")
    }
    metadataDialog.close()
    if (season.episodeCount === volume.episodeCount) return apply(volume.episodeCount)
    const watched = data.watchEvents.filter((event) => event.episodes.volumeId === volume.id).reduce((max, event) => Math.max(max, event.episodes.to), 0)
    if (season.episodeCount < watched) return apply(volume.episodeCount)
    confirmation = { title: "采用 TMDB 集数？", body: "TMDB 的" + season.name + "共有 " + season.episodeCount + " 话。是否将" + volumeLabel(selected, volume) + "设为 " + season.episodeCount + " 话？", label: "设为 " + season.episodeCount + " 话", action: () => apply(season.episodeCount), danger: false, secondaryLabel: "保留 " + volume.episodeCount + " 话", secondaryAction: () => apply(volume.episodeCount) }
    confirmDialog.showModal()
  }
  function downloadBackup() {
    const link = document.createElement("a")
    link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" }))
    link.download = `bangumi-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href)
  }
  function undoImport() { if (importBackup) { data = importBackup; importBackup = null; cache(); message("已撤销最近一次导入") } }
  async function importFile(file: File) {
    importError = ""
    try {
      let value: unknown
      try { value = JSON.parse(await file.text()) }
      catch (error) { throw new Error(`不是有效 JSON：${(error as Error).message}`) }
      const input = value as Record<string, unknown> | null
      if (input && "version" in input) {
        const normalized = normalizeBangumiData(value)
        const error = normalized ? validateData(normalized) : validateData(value)
        if (error) throw new Error(`数据格式无效：${error}`)
        ask("导入 Bangumi Trace 备份？", `将用备份中的 ${normalized!.shows.length} 个作品和 ${normalized!.watchEvents.length} 条观看记录覆盖本地草稿。`, () => { importBackup = structuredClone(data); data = normalized!; cache(); refreshListOrder(); message("备份已导入本地草稿，请检查后保存") }, "覆盖本地草稿", true)
      } else if (Array.isArray(input?.items)) {
        const imported = importCurrent(value)
        ask("导入作品？", `将添加 ${imported.length} 个作品到本地草稿。`, () => { importBackup = structuredClone(data); data = { ...data, shows: [...data.shows, ...imported] }; cache(); message("导入保存在本地草稿中，请检查后保存") }, "确认导入")
      } else if (Array.isArray(input?.events)) {
        const imported = importHistory(value, data)
        ask("导入观看历史？", `将添加 ${imported.length} 条高置信候选记录，观看时间保持未知。`, () => { importBackup = structuredClone(data); data = { ...data, watchEvents: [...data.watchEvents, ...imported] }; cache(); message("导入保存在本地草稿中，请检查后保存") }, "确认导入")
      } else throw new Error("无法识别导入文件：需要 Bangumi Trace 备份、bangumi.json 或 bangumi-history.json")
    } catch (error) { importError = (error as Error).message }
  }
</script>

<dialog class="modal" bind:this={repositoryDialog}>
  <div class="modal-box"><h2 class="text-xl font-bold">找不到可用的数据仓库</h2><p class="py-4">请创建私有仓库 <code>bangumi-trace-data</code>，并授权 GitHub App 访问，然后重试。</p><a class="link link-primary" href={SETUP_DOC} target="_blank" rel="noreferrer">查看仓库配置文档</a><div class="modal-action"><form method="dialog"><button class="btn">关闭</button></form><button class="btn btn-primary" on:click={() => sync(false)}>重试</button></div></div>
</dialog>
<dialog class="modal" bind:this={confirmDialog}>
  <div class="modal-box"><h2 class="text-xl font-bold">{confirmation.title}</h2><p class="py-4 text-base-content/70">{confirmation.body}</p><div class="modal-action">{#if confirmation.secondaryAction}<button class="btn" on:click={secondaryConfirmAction}>{confirmation.secondaryLabel}</button>{:else}<form method="dialog"><button class="btn">取消</button></form>{/if}<button class:btn-error={confirmation.danger} class:btn-primary={!confirmation.danger} class="btn" on:click={confirmAction}>{confirmation.label}</button></div></div>
</dialog>

<dialog class="modal" bind:this={addShowDialog}>
  <form class="modal-box" on:submit|preventDefault={addShow}><h2 class="text-xl font-bold">添加作品</h2><label class="form-control mt-4"><span class="label-text">作品名称</span><input class="input input-bordered" bind:value={newTitle} placeholder="输入任意语言标题" required /></label><div class="modal-action"><button class="btn" type="button" on:click={() => addShowDialog.close()}>取消</button><button class="btn btn-primary">添加作品</button></div></form>
</dialog>

<dialog class="modal" bind:this={folderDialog}>
  <form class="modal-box" on:submit|preventDefault={saveFolder}><h2 class="text-xl font-bold">{editingFolderId ? "重命名目录" : "新建目录"}</h2><label class="form-control mt-4"><span class="label-text">目录名称</span><input class="input input-bordered" bind:value={folderName} placeholder="例如：物语系列" required /></label><div class="modal-action"><button class="btn" type="button" on:click={() => folderDialog.close()}>取消</button><button class="btn btn-primary">{editingFolderId ? "保存名称" : "建立目录"}</button></div></form>
</dialog>
<dialog class="modal" bind:this={moveDialog}>
  <div class="modal-box"><h2 class="text-xl font-bold">移入已有作品</h2><div class="mt-4 space-y-2">{#each unassignedShows as show}<button class="btn btn-ghost w-full justify-start" on:click={() => moveToFolder(show.id)}>{show.title[0]}</button>{/each}{#if !unassignedShows.length}<p class="py-6 text-center text-base-content/60">没有可移入的作品</p>{/if}</div><div class="modal-action"><form method="dialog"><button class="btn">关闭</button></form></div></div>
</dialog>

<dialog class="modal" bind:this={addVolumeDialog}>
  <form class="modal-box" on:submit|preventDefault={() => addVolume()}><h2 class="text-xl font-bold">添加 Volume</h2><div class="mt-4 grid gap-4 sm:grid-cols-2"><label class="form-control"><span class="label-text">类型</span><select class="select select-bordered" bind:value={volumeType}><option>正剧</option><option>OVA</option><option>SP</option><option>自定义</option></select></label><label class="form-control"><span class="label-text">集数</span><input class="input input-bordered" type="number" min="1" max="256" bind:value={volumeEpisodes} required /></label>{#if volumeType === "自定义"}<label class="form-control sm:col-span-2"><span class="label-text">类型名称</span><input class="input input-bordered" bind:value={customVolumeType} placeholder="例如：剧场版" required /></label>{/if}</div><div class="modal-action"><button class="btn" type="button" on:click={() => addVolumeDialog.close()}>取消</button><button class="btn" type="button" on:click={() => addVolume(true)}>添加并绑定 TMDB</button><button class="btn btn-primary">仅添加</button></div></form>
</dialog>
<dialog class="modal" bind:this={metadataDialog}>
  <div class="modal-box"><h2 class="text-xl font-bold">绑定 TMDB</h2><form class="join mt-4 w-full" on:submit|preventDefault={findMetadata}><label class="sr-only" for="metadata-search">搜索 TMDB 标题</label><input id="metadata-search" class="input join-item min-w-0 w-full" bind:value={metadataQuery} placeholder="搜索标题" required /><button class="btn join-item" disabled={metadataBusy}>{metadataBusy ? "搜索中" : "搜索"}</button></form>{#if metadataError}<p class="mt-3 text-sm text-error" role="alert">{metadataError}</p>{:else if metadataSearched && !candidates.length}<p class="mt-3 text-sm text-base-content/60">没有找到匹配条目。</p>{/if}{#if tmdbSeries}<div class="mt-4 space-y-2"><button class="btn btn-ghost btn-sm" on:click={() => tmdbSeries = null}>← 返回搜索结果</button>{#each tmdbSeries.seasons as season}<button class="btn h-auto min-h-12 w-full justify-between py-2" on:click={() => bindMetadata(season)}><span class="text-left">{season.name}<small class="block font-normal text-base-content/60">第 {season.seasonNumber} 季 · {season.airDate || "日期未知"}</small></span><span>{season.episodeCount} 话</span></button>{/each}</div>{:else}<div class="mt-4 space-y-2">{#each candidates as candidate}<button class="flex w-full min-w-0 items-center gap-3 rounded-lg p-2 text-left hover:bg-base-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" on:click={() => selectTmdbSeries(candidate)}>{#if candidate.poster}<img class="h-16 w-12 shrink-0 object-cover" src={candidate.poster} alt="" />{/if}<span class="min-w-0"><strong class="block truncate">{candidate.name}</strong><small class="block truncate">{candidate.originalName} · {candidate.firstAirDate || "日期未知"}</small></span></button>{/each}</div>{/if}<div class="modal-action"><button class="btn" on:click={() => metadataDialog.close()}>取消</button></div></div>
</dialog>


<svelte:window on:click={() => activeSubtitle = -1} />

{#if auth !== "authenticated"}
  <main class="grid min-h-dvh place-items-center p-4 text-center">
    <div class="w-full max-w-sm rounded-box border border-base-300 bg-base-100 p-8 shadow-sm">
      <img class="mx-auto size-20 rounded-2xl" src={`${ASSET_BASE}/favicon.png`} alt="" />
      {#if auth === "checking"}<h1 class="mt-5 text-2xl font-bold">Bangumi Trace</h1><p class="mt-2 text-base-content/70" aria-busy="true">正在检查登录状态…</p>{:else if auth === "repository-error"}<h1 class="mt-5 text-xl font-bold">数据仓库不可用</h1><p class="mt-2 text-base-content/70">完成仓库配置后即可继续使用。</p><button class="btn btn-primary mt-5 w-full" disabled={busy} on:click={() => sync(false)}>重试</button>{:else}<h1 class="mt-5 text-2xl font-bold">Bangumi Trace</h1><p class="mt-2 text-base-content/70">使用 GitHub 同步你的私人观看数据。</p><a class="btn btn-primary mt-5 w-full" href={loginUrl} data-astro-reload>使用 GitHub 登录</a>{/if}
    </div>
  </main>
{:else}
  <header class="navbar sticky top-0 z-40 min-h-16 flex-nowrap gap-2 border-b border-base-300 bg-base-100/95 px-2 backdrop-blur sm:px-4"><div class="min-w-0 flex-1"><button class="btn btn-ghost btn-sm gap-2 px-2 text-lg sm:text-xl" aria-label="返回我的番剧" on:click={() => go("list")}><img class="size-8 rounded-lg" src={`${ASSET_BASE}/favicon.png`} alt="" /><span class="hidden sm:inline">Bangumi Trace</span></button></div><nav class="flex shrink-0 items-center gap-2" aria-label="主导航"><details class="dropdown dropdown-end"><summary class="btn btn-primary btn-sm w-20">添加</summary><ul class="menu dropdown-content z-50 mt-2 w-36 rounded-box border border-base-300 bg-base-100 p-2 shadow"><li><button on:click={() => openAddShow(view === "folder" ? selectedId : "")}>添加作品</button></li><li><button on:click={() => editFolder()}>新建目录</button></li></ul></details><button class:btn-primary={dirty} class:btn-ghost={!dirty} class="btn btn-sm w-20" disabled={!dirty || busy} on:click={save}>{busy ? "保存中" : dirty ? "保存" : "已保存"}</button><button class="btn btn-ghost btn-sm hidden sm:inline-flex" on:click={() => go("list")}>列表</button><button class="btn btn-ghost btn-sm hidden sm:inline-flex" on:click={() => go("settings")}>设置</button><div class="hidden sm:block"><ThemeToggle /></div><details class="dropdown dropdown-end sm:hidden"><summary class="btn btn-ghost btn-sm">菜单</summary><ul class="menu dropdown-content z-50 mt-2 w-36 rounded-box border border-base-300 bg-base-100 p-2 shadow"><li><button on:click={() => go("list")}>列表</button></li><li><button on:click={() => go("settings")}>设置</button></li><li><ThemeToggle /></li></ul></details></nav></header>
  <main class="mx-auto max-w-3xl p-4 pb-24">
    {#if notice}<div class="toast toast-center toast-bottom z-50 sm:toast-end"><div class="alert alert-info shadow-lg" role="status"><span>{notice}</span>{#if noticeAction}<button class="btn btn-sm" on:click={() => noticeAction?.()}>撤销</button>{/if}</div></div>{/if}
    {#if view === "list" || view === "folder" && selectedFolder}
      <section class="space-y-4">
        {#if view === "folder"}<button class="btn btn-outline btn-sm w-fit" on:click={() => go("list")}><span aria-hidden="true">←</span> 我的番剧</button>{/if}
        <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 class="text-3xl font-bold">{view === "folder" ? selectedFolder!.name : "我的番剧"}</h1><p class="text-base-content/60">{view === "folder" ? `${folderShows.length} 部作品` : "按最近观看活动排序。"}</p></div>{#if view === "folder"}<div class="flex flex-wrap gap-2"><button class="btn btn-primary btn-sm" on:click={() => openAddShow(selectedFolder!.id)}>添加作品</button><button class="btn btn-sm" disabled={!unassignedShows.length} on:click={() => moveDialog.showModal()}>移入已有</button><button class="btn btn-ghost btn-sm" on:click={() => editFolder(selectedFolder)}>重命名</button><button class="btn btn-ghost btn-sm text-error" on:click={() => dissolveFolder(selectedFolder!)}>解散目录</button></div>{/if}</div>
        <input class="input w-full" bind:value={query} placeholder="搜索任意语言标题" aria-label="搜索" />
        <fieldset class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-box border border-base-300 px-3 py-2"><legend class="sr-only">按状态过滤</legend>{#each statuses as item}<label class="flex cursor-pointer items-center gap-2 text-sm"><input class="checkbox checkbox-sm" type="checkbox" checked={statusFilter.includes(item.value)} on:change={() => toggleStatus(item.value)} /><span>{item.label}</span></label>{/each}<span class="ml-auto flex gap-1"><button class="btn btn-ghost btn-xs" type="button" on:click={() => statusFilter = statuses.map(({ value }) => value)}>全部</button><button class="btn btn-ghost btn-xs" type="button" on:click={() => statusFilter = statuses.map(({ value }) => value).filter((value) => !statusFilter.includes(value))}>反选</button></span></fieldset>
        <div class="grid gap-3 sm:grid-cols-2">
          {#each visibleFolders as folder}<button class="card min-w-0 border border-base-300 bg-base-200/50 text-left transition hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" on:click={() => go(`folder/${folder.id}`)}><span class="card-body min-w-0 p-4"><span class="flex items-start justify-between gap-3"><strong class="min-w-0 break-words text-lg">{folder.name}</strong><span class="badge badge-outline whitespace-nowrap">{folder.showIds.length} 部</span></span><span class="text-sm text-base-content/60">系列目录 · 点击查看作品</span></span></button>{/each}
          {#each shows as show}{@const next = nextVolumeEpisode(data, show)}{@const status = statusDisplay(data, show)}{@const owner = data.folders.find((folder) => folder.showIds.includes(show.id))}<article class="card min-w-0 border border-base-300 bg-base-100"><div class="card-body min-w-0 p-4"><div class="flex min-w-0 items-start justify-between gap-2"><button class="min-w-0 break-words text-left text-lg font-semibold hover:text-primary" on:click={() => go(`show/${show.id}`)}>{show.title[0]}</button><span class={`badge shrink-0 whitespace-nowrap ${status.badge}`}>{status.label}</span></div>{#if owner && view === "list" && query.trim()}<p class="text-sm text-base-content/60">目录：{owner.name}</p>{:else if show.title.length > 1 || show.aliases?.length}<p class="truncate text-sm text-base-content/60">{[...show.title.slice(1), ...(show.aliases ?? [])].join(" · ")}</p>{/if}<div class="card-actions mt-auto justify-end">{#if view === "folder"}<button class="btn btn-ghost btn-sm" on:click={() => { data = { ...data, folders: data.folders.map((folder) => folder.id === selectedFolder!.id ? { ...folder, showIds: folder.showIds.filter((id) => id !== show.id) } : folder) }; cache() }}>移出目录</button>{/if}{#if next}<button class="btn btn-primary btn-sm" aria-label={`标记已观看${volumeLabel(show, next.volume)}第 ${next.episode} 话`} on:click={() => quickRecord(show, next.volume)}>记录 {volumeLabel(show, next.volume)}第 {next.episode} 话</button>{:else}<button class="btn btn-sm" disabled>{show.volumes.length ? "已全部看完" : "请先添加 Volume"}</button>{/if}</div></div></article>{/each}
        </div>
        {#if !shows.length && !visibleFolders.length}<div class="py-16 text-center"><p class="text-base-content/60">{query ? "没有找到匹配标题" : statusFilter.length ? view === "folder" ? "目录中还没有作品" : "还没有作品或目录" : "未选择任何观看状态"}</p>{#if query}<button class="btn btn-sm mt-4" on:click={() => query = ""}>清除搜索</button>{:else if !statusFilter.length}<button class="btn btn-sm mt-4" on:click={() => statusFilter = statuses.map(({ value }) => value)}>恢复全部状态</button>{:else}<button class="btn btn-primary btn-sm mt-4" on:click={() => view === "folder" ? openAddShow(selectedFolder!.id) : openAddShow()}>添加第一部作品</button>{/if}</div>{/if}
      </section>
    {:else if view === "show" && selected}
      <section class="space-y-5"><button class="btn btn-outline btn-sm w-fit" on:click={() => go(selectedOwner ? `folder/${selectedOwner.id}` : "list")}><span aria-hidden="true">←</span> {selectedOwner ? selectedOwner.name : "我的番剧"}</button><div class="grid gap-4"><div class="min-w-0"><h1 class="break-words text-3xl font-bold">{selected.title[0]}</h1><div class="flex flex-wrap items-center gap-x-2 text-sm text-base-content/60">{#each selected.title.slice(1) as title, index}{#if index}<span aria-hidden="true">·</span>{/if}<span class="relative inline-flex"><button class="hover:text-primary" aria-expanded={activeSubtitle === index + 1} on:click|stopPropagation={() => activeSubtitle = activeSubtitle === index + 1 ? -1 : index + 1}>{title}</button>{#if activeSubtitle === index + 1}<span class="absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 rounded-box border border-base-300 bg-base-100 p-1 shadow-lg" on:click|stopPropagation><button class="btn btn-primary btn-xs whitespace-nowrap" on:click={() => { updateShow(setDefaultTitle(selected!, index + 1)); activeSubtitle = -1 }}>设为默认</button></span>{/if}</span>{/each}</div><div class="mt-2 flex flex-wrap items-center gap-2 text-sm"><span class="text-base-content/60">手动别名</span>{#each selected.aliases ?? [] as alias, index}{#if editingAliasIndex === index}<label class="flex items-center gap-2"><span class="sr-only">编辑别名</span><input class="input input-bordered input-sm w-40" bind:value={aliasDraft} maxlength="200" /></label><button class="btn btn-primary btn-xs" on:click={saveAlias}>保存</button><button class="btn btn-ghost btn-xs" on:click={() => editingAliasIndex = null}>取消</button>{:else}<span class="badge badge-lg gap-1">{alias}<button class="btn btn-ghost btn-xs px-1" aria-label="设为显示名称" on:click={() => setAliasDisplayName(index)}>显示</button><button class="btn btn-ghost btn-xs px-1" aria-label="编辑别名" on:click={() => editAlias(index)}>编辑</button><button class="btn btn-ghost btn-xs px-1 text-error" aria-label="删除别名" on:click={() => removeAlias(index)}>删除</button></span>{/if}{/each}{#if editingAliasIndex === -1}<label class="flex items-center gap-2"><span class="sr-only">新别名</span><input class="input input-bordered input-sm w-40" bind:value={aliasDraft} maxlength="200" placeholder="输入别名" /></label><button class="btn btn-primary btn-xs" on:click={saveAlias}>添加</button><button class="btn btn-ghost btn-xs" on:click={() => editingAliasIndex = null}>取消</button>{:else if editingAliasIndex === null}<button class="btn btn-outline btn-xs" on:click={() => editAlias()}>添加别名</button>{/if}</div></div><div class="w-full"><fieldset class="grid grid-cols-2 gap-1 rounded-box border border-base-300 bg-base-200 p-1 sm:grid-cols-4" aria-label="观看状态">{#each statuses as item}<button class="btn btn-sm whitespace-nowrap border transition-colors hover:border-primary hover:bg-primary/15 hover:text-base-content {selected.status === item.value ? 'border-primary bg-primary text-primary-content shadow-sm hover:bg-primary hover:text-primary-content' : 'border-transparent bg-transparent'}" type="button" aria-pressed={selected.status === item.value} on:click={() => updateShow({ ...selected!, status: item.value })}>{item.label}</button>{/each}</fieldset><p class="mt-2 text-xs text-base-content/60">{selected.status === "watching" && selectedComplete ? "已看完当前全部剧集，保持追番中可能是在等待更新。" : selected.status === "completed" && !selectedComplete ? "尚未看完全部剧集，但已手动标记为完成。" : `当前状态：${statusDisplay(data, selected).label}`}</p></div></div>
        <details class="border-b border-base-300"><summary class="cursor-pointer py-3 font-semibold">笔记</summary><div class="pb-4">{#if editingNote}<label class="form-control"><span class="label-text">作品笔记</span><textarea class="textarea textarea-bordered min-h-32 w-full" maxlength="2048" placeholder="最多 2048 字" bind:value={noteDraft}></textarea></label><div class="mt-3 flex justify-end gap-2"><button class="btn btn-sm" on:click={() => editingNote = false}>取消</button><button class="btn btn-primary btn-sm" on:click={saveNote}>保存笔记</button></div>{:else}<div class="flex items-start justify-between gap-3"><p class="min-w-0 whitespace-pre-wrap text-sm text-base-content/70">{selected.note || "暂无笔记"}</p><button class="btn btn-outline btn-sm shrink-0" on:click={editNote}>编辑笔记</button></div>{/if}</div></details>
        <div class="card border border-base-300"><div class="card-body"><div class="flex items-center justify-between gap-3"><h2 class="card-title">Volumes</h2><button class="btn btn-primary btn-sm" on:click={() => addVolumeDialog.showModal()}>添加 Volume</button></div><div class="space-y-2">{#each selected.volumes as volume}{@const next = nextEpisode(data, volume)}{@const watched = new Set(data.watchEvents.filter((event) => event.episodes.volumeId === volume.id).flatMap(expandedEpisodes))}{@const externalRange = externalEpisodeRange(selected, volume)}<div class="rounded-lg border border-base-300 p-3"><div class="flex flex-col gap-3"><div class="flex min-w-0 flex-wrap items-center gap-2"><strong class="min-w-0 break-words">{volumeLabel(selected, volume)}</strong>{#if volume.externalRef}<span class="badge badge-outline">TMDB #{volume.externalRef.seriesId} S{volume.externalRef.seasonNumber}{#if externalRange} · E{externalRange.from}–{externalRange.to}{/if}</span>{/if}{#if editingVolumeId === volume.id}<label class="flex items-center gap-2"><span class="sr-only">{volumeLabel(selected, volume)}集数</span><input class="input input-bordered input-sm w-24" type="number" min="1" max="256" bind:value={editingVolumeEpisodes} /><span>话</span></label><button class="btn btn-ghost btn-sm" on:click={() => editingVolumeId = ""}>取消</button><button class="btn btn-primary btn-sm" on:click={() => resizeVolume(volume, editingVolumeEpisodes)}>保存集数</button>{:else}<span class="badge badge-lg bg-base-200">共 {volume.episodeCount} 话</span><button class="btn btn-outline btn-sm whitespace-nowrap" on:click={() => editVolume(volume)}>编辑集数</button>{/if}</div><div class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"><button class="btn btn-sm whitespace-nowrap" on:click={() => openMetadata(volume)}>{volume.externalRef ? "重新绑定 TMDB" : "绑定 TMDB"}</button><button class="btn btn-primary btn-sm whitespace-nowrap" disabled={!next} on:click={() => quickRecord(selected!, volume)}>{next ? `记录第 ${next} 话` : "已看完"}</button>{#if volumeUndo.has(volume.id)}<button class="btn btn-sm" on:click={() => undoVolume(selected!, volume)}>撤销未保存操作</button>{/if}<button class="btn btn-ghost btn-sm whitespace-nowrap text-error sm:ml-auto" on:click={() => removeVolume(volume)}>删除</button></div></div><p class="mt-3 text-sm font-medium">已观看 {watched.size}/{volume.episodeCount} 话</p><div class="mt-2 grid grid-cols-12 gap-1">{#each Array(volume.episodeCount) as _, index}<button class={`min-h-8 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:min-h-10 ${watched.has(index + 1) ? "cursor-default bg-success" : "bg-base-300 hover:bg-primary/50"}`} type="button" disabled={watched.has(index + 1)} aria-label={`第 ${index + 1} 话，${watched.has(index + 1) ? "已观看" : "点击记录观看"}`} title={`第 ${index + 1} 话：${watched.has(index + 1) ? "已观看" : "点击记录观看"}`} on:click={() => recordEpisode(selected!, volume, index + 1)}></button>{/each}</div></div>{/each}</div></div></div>
        <button class="btn w-full" disabled={!selected.volumes.length} on:click={() => startRecord(selected!)}>自定义补录</button><details class="rounded-box border border-base-300"><summary class="cursor-pointer px-4 py-3 font-semibold">详细观看历史 <span class="font-normal text-base-content/60">{events.length} 条</span></summary><div class="divide-y divide-base-300 border-t border-base-300 px-4">{#each events as event}<div class="flex items-center gap-2 py-2"><span class="min-w-0 flex-1"><strong class="block truncate text-sm">{episodeLabel(selected, event)}</strong><small class="text-base-content/60">{displayDate(event)}</small></span><button class="btn btn-ghost btn-xs" on:click={() => startRecord(selected!, event)}>修改</button><button class="btn btn-ghost btn-xs text-error" on:click={() => removeEvent(event.id)}>删除</button></div>{/each}{#if !events.length}<p class="py-4 text-sm text-base-content/60">尚无观看记录</p>{/if}</div></details><button class="btn btn-error btn-outline" on:click={() => removeShow(selected!)}>删除作品</button>
      </section>
    {:else if view === "record" && selected}
      <section class="space-y-5"><button class="btn btn-outline btn-sm w-fit" on:click={() => go(`show/${selected!.id}`)}><span aria-hidden="true">←</span> {selected.title[0]}</button><header><h1 class="text-3xl font-bold">补录观看记录</h1><p class="mt-1 truncate text-base-content/60">{selected.title[0]}</p></header><form class="card border border-base-300" on:submit|preventDefault={record}><div class="card-body gap-5"><div><h2 class="mb-3 font-semibold">观看范围</h2><label class="form-control"><span class="label-text">Volume</span><select class="select select-bordered" bind:value={volumeId} on:change={() => { episodeFrom = episodeTo = 1; rangeAnchor = null }}>{#each selected.volumes as volume}<option value={volume.id}>{volumeLabel(selected, volume)}</option>{/each}</select></label>{#if recordVolume}<div class="mt-4"><p class="mb-2 text-sm font-medium">已选择第 {episodeFrom === episodeTo ? episodeFrom : `${episodeFrom}–${episodeTo}`} 话</p><div class="grid grid-cols-12 gap-1" aria-describedby="range-help">{#each Array(recordVolume.episodeCount) as _, index}{@const episode = index + 1}{@const inRange = episode >= episodeFrom && episode <= episodeTo}<button class={`min-h-8 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:min-h-10 ${inRange ? "bg-primary text-primary-content" : "bg-base-300 hover:bg-primary/50"}`} type="button" aria-pressed={inRange} aria-label={`第 ${episode} 话${inRange ? "，已选择" : ""}`} title={`第 ${episode} 话`} on:click={() => selectRange(episode)}></button>{/each}</div><p id="range-help" class="mt-2 text-xs text-base-content/60">点击一格设为起点，再点击一格确定连续范围；继续点击可重新选择。</p></div>{/if}</div>{#if recordError}<p id="record-error" class="text-sm text-error" role="alert">{recordError}</p>{/if}<div class="divider my-0"></div><div><h2 class="mb-3 font-semibold">观看时间</h2><div class="grid gap-4 sm:grid-cols-3"><label class="form-control"><span class="label-text">时间精度</span><select class="select select-bordered" bind:value={precision}><option value="unknown">未知</option><option value="exact">精确</option><option value="day">精确到日</option><option value="month">精确到月</option><option value="year">精确到年</option></select></label>{#if precision === "unknown"}<button class="btn btn-primary btn-outline self-end sm:col-span-2" type="button" on:click={() => precision = "exact"}>选择日期与时间</button>{:else if precision === "exact"}<label class="form-control sm:col-span-2"><span class="label-text">日期与时间</span><input class="input input-primary w-full cursor-pointer" type="datetime-local" bind:value={watchedValue} /></label>{:else if precision === "day"}<label class="form-control sm:col-span-2"><span class="label-text">日期</span><input class="input input-primary w-full cursor-pointer" type="date" bind:value={watchedValue} /></label>{:else if precision === "month"}<label class="form-control sm:col-span-2"><span class="label-text">月份</span><input class="input input-primary w-full cursor-pointer" type="month" bind:value={watchedValue} /></label>{:else if precision === "year"}<label class="form-control sm:col-span-2"><span class="label-text">年份</span><input class="input input-bordered w-full" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="例如 2026" bind:value={watchedValue} /></label>{/if}</div></div><div class="card-actions justify-end"><button class="btn" type="button" on:click={() => go(`show/${selected!.id}`)}>取消</button><button class="btn btn-primary">{editingEventId ? "更新本地草稿" : "加入本地草稿"}</button></div></div></form></section>
    {:else if view === "settings"}
      <section class="space-y-6"><button class="btn btn-outline btn-sm w-fit" on:click={() => go("list")}><span aria-hidden="true">←</span> 我的番剧</button><h1 class="text-3xl font-bold">设置与导入</h1><div class="card border border-base-300"><div class="card-body"><h2 class="card-title">GitHub 数据</h2><p>已登录 · {sha ? `SHA ${sha.slice(0, 8)}` : "远端文件尚未创建"}</p><div class="card-actions"><button class="btn btn-warning" disabled={busy} on:click={() => sync(true)}>强制从 GitHub 覆盖本地</button><button class="btn btn-primary" disabled={!dirty || busy} on:click={save}>保存到 GitHub</button><button class="btn btn-ghost" on:click={async () => { await logout(); auth = "unauthenticated" }}>退出</button></div></div></div><div class="card border border-base-300"><div class="card-body"><h2 class="card-title">本地迁移</h2><p>支持 Bangumi Trace 备份和旧版迁移文件；文件只在当前浏览器读取。</p>{#if importError}<p class="text-sm text-error" role="alert">{importError}</p>{/if}<input class="file-input file-input-bordered" type="file" accept="application/json,.json" aria-label="选择迁移 JSON" on:change={(e) => { const file = e.currentTarget.files?.[0]; if (file) importFile(file) }} /><div class="card-actions"><button class="btn btn-sm" on:click={downloadBackup}>下载当前备份</button><button class="btn btn-sm" disabled={!importBackup} on:click={undoImport}>撤销最近导入</button></div></div></div></section>
    {:else}<div class="py-16 text-center"><p>页面或作品不存在</p><button class="btn mt-4" on:click={() => go("list")}>返回列表</button></div>{/if}
  </main>
{/if}
