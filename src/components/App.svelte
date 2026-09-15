<script lang="ts">
  import { onMount } from "svelte"
  import ThemeToggle from "./ThemeToggle.svelte"
  import { importCurrent, importHistory } from "../lib/importer"
  import { emptyData, episodeLabel, eventTime, expandedEpisodes, matchesTitle, nextEpisode, nextVolumeEpisode, setDefaultTitle, sortShowsByActivity, uniqueTitles, volumeLabel, type BangumiData, type Precision, type Show, type Status, type Volume, type WatchEvent } from "../lib/model"
  import { loadData, loginUrl, logout, saveData, searchBangumi } from "../lib/api"

  const CACHE = "bangumi-trace-cache"
  const SETUP_DOC = "https://github.com/Nigh/bangumi-trace/blob/main/docs/DEPLOYMENT.md#6-%E4%BD%BF%E7%94%A8%E4%B8%8E%E8%BF%81%E7%A7%BB%E4%B8%AA%E4%BA%BA%E6%95%B0%E6%8D%AE"
  const statuses: { value: Status; label: string; badge: string }[] = [
    { value: "planned", label: "计划", badge: "badge-ghost" },
    { value: "watching", label: "观看中", badge: "badge-info" },
    { value: "completed", label: "完成", badge: "badge-success" },
    { value: "dropped", label: "放弃", badge: "badge-warning" }
  ]
  let data: BangumiData = emptyData(), sha: string | null = null, query = "", statusFilter: Status[] = statuses.map(({ value }) => value), listRank = new Map<string, number>()
  let view = "list", selectedId = "", notice = "", noticeAction: (() => void) | null = null, auth: "checking" | "authenticated" | "unauthenticated" | "repository-error" = "checking", busy = false, dirty = false
  let importBackup: BangumiData | null = null, repositoryDialog: HTMLDialogElement, confirmDialog: HTMLDialogElement, addShowDialog: HTMLDialogElement, addVolumeDialog: HTMLDialogElement
  let confirmation: { title: string; body: string; label: string; danger: boolean; action: () => void | Promise<void> } = { title: "", body: "", label: "确认", danger: false, action: () => {} }
  let newTitle = "", metadataQuery = "", candidates: Awaited<ReturnType<typeof searchBangumi>>["data"] = [], metadataBusy = false, metadataSearched = false, metadataError = ""
  let volumeType = "正剧", customVolumeType = "", volumeEpisodes = 12
  let volumeId = "", episodeFrom = 1, episodeTo = 1, precision: Precision = "exact", watchedValue = "", editingEventId = "", recordError = "", activeSubtitle = -1

  $: selected = data.shows.find((show) => show.id === selectedId)
  $: shows = data.shows.filter((show) => statusFilter.includes(show.status) && matchesTitle(show, query)).sort((a, b) => (listRank.get(a.id) ?? Infinity) - (listRank.get(b.id) ?? Infinity))
  $: events = selected ? data.watchEvents.filter((event) => event.showId === selected.id).sort((a, b) => eventTime(b) - eventTime(a)) : []
  $: recordVolume = selected?.volumes.find((volume) => volume.id === volumeId)

  function route(hash = location.hash) {
    const [, next = "list", id = ""] = hash.match(/^#([^/]+)(?:\/(.+))?/) ?? []
    view = next; selectedId = id; activeSubtitle = -1
    if (next === "list") refreshListOrder()
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
  const nowForInput = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)

  onMount(() => {
    const handleRoute = () => route()
    route(); addEventListener("hashchange", handleRoute)
    const cached = localStorage.getItem(CACHE)
    if (cached) try { ({ data, sha } = JSON.parse(cached)); refreshListOrder() } catch { localStorage.removeItem(CACHE) }
    void sync(false)
    return () => removeEventListener("hashchange", handleRoute)
  })

  async function sync(force = true, confirmed = false) {
    if (force && dirty && !confirmed) return ask("覆盖本地修改？", "强制同步会永久放弃尚未保存的本地修改，并使用 GitHub 数据覆盖。", () => sync(true, true), "覆盖并同步", true)
    busy = true
    try { ({ data, sha } = await loadData()); auth = "authenticated"; cache(false); if (view === "list") refreshListOrder(); if (force) message("已用 GitHub 数据覆盖本地内容") }
    catch (error) {
      const apiError = error as { status?: number; code?: string; message: string }
      if (apiError.code === "DATA_REPOSITORY_UNAVAILABLE") { auth = "repository-error"; repositoryDialog?.showModal() }
      else if (apiError.status === 401) auth = "unauthenticated"
      else message(apiError.message)
    } finally { busy = false }
  }
  async function save() {
    busy = true
    try { ({ sha } = await saveData(data, sha)); cache(false); auth = "authenticated"; message("已保存到 GitHub") }
    catch (error) {
      const apiError = error as { status?: number; code?: string; message: string }
      if (apiError.code === "DATA_REPOSITORY_UNAVAILABLE") { auth = "repository-error"; repositoryDialog?.showModal() }
      else message(apiError.status === 409 ? "远端已有更新，请强制同步后重新应用修改" : apiError.message)
    } finally { busy = false }
  }
  function addShow() {
    if (!newTitle.trim()) return
    const show: Show = { id: crypto.randomUUID(), title: [newTitle.trim()], status: "planned", volumes: [] }
    listRank.set(show.id, Math.min(0, ...listRank.values()) - 1); data = { ...data, shows: [...data.shows, show] }; newTitle = ""; addShowDialog.close(); cache()
  }
  function updateShow(next: Show) { data = { ...data, shows: data.shows.map((show) => show.id === next.id ? next : show) }; cache() }
  function removeShow(show: Show) {
    ask("删除作品？", `“${show.title[0]}”及其观看记录都会被删除。`, () => {
      data = { ...data, shows: data.shows.filter((item) => item.id !== show.id), watchEvents: data.watchEvents.filter((event) => event.showId !== show.id) }
      cache(); go("list")
    }, "删除作品", true)
  }
  function addVolume() {
    if (!selected || !Number.isInteger(volumeEpisodes) || volumeEpisodes < 1) return message("集数必须是正整数")
    const type = volumeType === "自定义" ? customVolumeType.trim() : volumeType
    if (!type) return message("请输入 volume 类型")
    updateShow({ ...selected, volumes: [...selected.volumes, { id: crypto.randomUUID(), type, episodeCount: volumeEpisodes }] })
    customVolumeType = ""; addVolumeDialog.close()
  }
  function resizeVolume(volume: Volume, episodeCount: number) {
    if (!selected || !Number.isInteger(episodeCount) || episodeCount < 1) return message("集数必须是正整数")
    const watched = data.watchEvents.filter((event) => event.episodes.volumeId === volume.id).reduce((max, event) => Math.max(max, event.episodes.to), 0)
    if (episodeCount < watched) return message(`集数不能小于已观看的第 ${watched} 话`)
    updateShow({ ...selected, volumes: selected.volumes.map((item) => item.id === volume.id ? { ...item, episodeCount } : item) })
  }
  function removeVolume(volume: Volume) {
    if (!selected) return
    const count = data.watchEvents.filter((event) => event.episodes.volumeId === volume.id).length
    ask(`删除 ${volumeLabel(selected, volume)}？`, count ? `同时会删除其中的 ${count} 条观看记录。` : "此操作无法撤销。", () => {
      data = { ...data, shows: data.shows.map((show) => show.id === selected.id ? { ...show, volumes: show.volumes.filter((item) => item.id !== volume.id) } : show), watchEvents: data.watchEvents.filter((event) => event.episodes.volumeId !== volume.id) }
      cache()
    }, "删除 Volume", true)
  }
  function quickRecord(show: Show, volume: Volume) {
    const episode = nextEpisode(data, volume)
    if (!episode) return
    const event: WatchEvent = { id: crypto.randomUUID(), showId: show.id, episodes: { volumeId: volume.id, from: episode, to: episode }, watchedAt: { precision: "exact", value: new Date().toISOString() }, recordedAt: new Date().toISOString(), source: "manual" }
    data = { ...data, watchEvents: [...data.watchEvents, event], shows: data.shows.map((item) => item.id === show.id && item.status === "planned" ? { ...item, status: "watching" } : item) }
    cache(); message("已记录 " + volumeLabel(show, volume) + "第 " + episode + " 话", () => {
      const remaining = data.watchEvents.filter((item) => item.id !== event.id)
      data = { ...data, watchEvents: remaining, shows: data.shows.map((item) => item.id === show.id && show.status === "planned" && !remaining.some((watch) => watch.showId === show.id) ? { ...item, status: "planned" } : item) }
      cache(); message("已撤销观看记录")
    })
  }
  function startRecord(show: Show, event?: WatchEvent) {
    selectedId = show.id; editingEventId = event?.id ?? ""
    volumeId = event?.episodes.volumeId ?? show.volumes[0]?.id ?? ""
    episodeFrom = event?.episodes.from ?? 1; episodeTo = event?.episodes.to ?? episodeFrom
    precision = event?.watchedAt.precision === "range" ? "unknown" : event?.watchedAt.precision ?? "exact"
    watchedValue = event?.watchedAt.precision === "exact" ? event.watchedAt.value.slice(0, 16) : event?.watchedAt.precision === "day" || event?.watchedAt.precision === "month" || event?.watchedAt.precision === "year" ? event.watchedAt.value : nowForInput()
    recordError = ""; go(`record/${show.id}`)
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
  async function findMetadata() {
    if (!metadataQuery.trim()) return
    metadataBusy = true; metadataSearched = false; metadataError = ""
    try { candidates = (await searchBangumi(metadataQuery)).data; metadataSearched = true }
    catch (error) { candidates = []; metadataError = (error as Error).message }
    finally { metadataBusy = false }
  }
  function bindMetadata(candidate: (typeof candidates)[number]) {
    if (!selected) return
    updateShow({ ...selected, title: uniqueTitles(selected.title[0], [candidate.name_cn ?? "", candidate.name, ...selected.title.slice(1)]), externalRef: { provider: "bangumi", id: String(candidate.id) } })
    candidates = []; message("已绑定 Bangumi 条目")
  }
  function downloadBackup() {
    const link = document.createElement("a")
    link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" }))
    link.download = `bangumi-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href)
  }
  function undoImport() { if (importBackup) { data = importBackup; importBackup = null; cache(); message("已撤销最近一次导入") } }
  async function importFile(file: File) {
    try {
      const value = JSON.parse(await file.text())
      if (Array.isArray(value.items)) {
        const imported = importCurrent(value)
        ask("导入作品？", `将添加 ${imported.length} 个作品到本地草稿。`, () => { importBackup = structuredClone(data); data = { ...data, shows: [...data.shows, ...imported] }; cache(); message("导入保存在本地草稿中，请检查后保存") }, "确认导入")
      } else {
        const imported = importHistory(value, data)
        ask("导入观看历史？", `将添加 ${imported.length} 条高置信候选记录，观看时间保持未知。`, () => { importBackup = structuredClone(data); data = { ...data, watchEvents: [...data.watchEvents, ...imported] }; cache(); message("导入保存在本地草稿中，请检查后保存") }, "确认导入")
      }
    } catch (error) { message((error as Error).message) }
  }
</script>

<dialog class="modal" bind:this={repositoryDialog}>
  <div class="modal-box"><h2 class="text-xl font-bold">找不到可用的数据仓库</h2><p class="py-4">请创建私有仓库 <code>bangumi-trace-data</code>，并授权 GitHub App 访问，然后重试。</p><a class="link link-primary" href={SETUP_DOC} target="_blank" rel="noreferrer">查看仓库配置文档</a><div class="modal-action"><form method="dialog"><button class="btn">关闭</button></form><button class="btn btn-primary" on:click={() => sync(false)}>重试</button></div></div>
</dialog>
<dialog class="modal" bind:this={confirmDialog}>
  <div class="modal-box"><h2 class="text-xl font-bold">{confirmation.title}</h2><p class="py-4 text-base-content/70">{confirmation.body}</p><div class="modal-action"><form method="dialog"><button class="btn">取消</button></form><button class:btn-error={confirmation.danger} class:btn-primary={!confirmation.danger} class="btn" on:click={confirmAction}>{confirmation.label}</button></div></div>
</dialog>

<dialog class="modal" bind:this={addShowDialog}>
  <form class="modal-box" on:submit|preventDefault={addShow}><h2 class="text-xl font-bold">添加作品</h2><label class="form-control mt-4"><span class="label-text">作品名称</span><input class="input input-bordered" bind:value={newTitle} placeholder="输入任意语言标题" required /></label><div class="modal-action"><button class="btn" type="button" on:click={() => addShowDialog.close()}>取消</button><button class="btn btn-primary">添加作品</button></div></form>
</dialog>

<dialog class="modal" bind:this={addVolumeDialog}>
  <form class="modal-box" on:submit|preventDefault={addVolume}><h2 class="text-xl font-bold">添加 Volume</h2><div class="mt-4 grid gap-4 sm:grid-cols-2"><label class="form-control"><span class="label-text">类型</span><select class="select select-bordered" bind:value={volumeType}><option>正剧</option><option>OVA</option><option>SP</option><option>自定义</option></select></label><label class="form-control"><span class="label-text">集数</span><input class="input input-bordered" type="number" min="1" bind:value={volumeEpisodes} required /></label>{#if volumeType === "自定义"}<label class="form-control sm:col-span-2"><span class="label-text">类型名称</span><input class="input input-bordered" bind:value={customVolumeType} placeholder="例如：剧场版" required /></label>{/if}</div><div class="modal-action"><button class="btn" type="button" on:click={() => addVolumeDialog.close()}>取消</button><button class="btn btn-primary">添加 Volume</button></div></form>
</dialog>


<svelte:window on:click={() => activeSubtitle = -1} />

{#if auth !== "authenticated"}
  <main class="grid min-h-dvh place-items-center p-4 text-center">
    {#if auth === "checking"}<p aria-busy="true">正在检查登录状态…</p>{:else if auth === "repository-error"}<div><h1 class="text-xl font-bold">数据仓库不可用</h1><p class="mt-2 text-base-content/70">完成仓库配置后即可继续使用。</p><button class="btn btn-primary mt-4" disabled={busy} on:click={() => sync(false)}>重试</button></div>{:else}<div><h1 class="text-xl font-bold">登录 Bangumi Trace</h1><p class="mt-2 text-base-content/70">使用 GitHub 同步你的私人观看数据。</p><a class="btn btn-primary mt-4" href={loginUrl}>GitHub 登录</a></div>{/if}
  </main>
{:else}
  <header class="navbar sticky top-0 z-40 min-h-16 flex-nowrap gap-1 border-b border-base-300 bg-base-100/95 px-2 backdrop-blur sm:px-4"><div class="min-w-0 flex-1"><button class="btn btn-ghost btn-sm px-2 text-lg sm:text-xl" on:click={() => go("list")}><span class="sm:hidden">BT</span><span class="hidden sm:inline">Bangumi Trace</span></button></div><nav class="flex shrink-0 items-center gap-1" aria-label="主导航"><button class="btn btn-primary btn-sm" on:click={() => addShowDialog.showModal()}>添加</button><button class:btn-primary={dirty} class="btn btn-sm" disabled={!dirty || busy} on:click={save}>{busy ? "保存中" : dirty ? "保存" : "已保存"}</button><button class="btn btn-ghost btn-sm hidden sm:inline-flex" on:click={() => go("list")}>列表</button><button class="btn btn-ghost btn-sm hidden sm:inline-flex" on:click={() => go("settings")}>设置</button><div class="hidden sm:block"><ThemeToggle /></div><details class="dropdown dropdown-end sm:hidden"><summary class="btn btn-ghost btn-sm">菜单</summary><ul class="menu dropdown-content z-50 mt-2 w-36 rounded-box border border-base-300 bg-base-100 p-2 shadow"><li><button on:click={() => go("list")}>列表</button></li><li><button on:click={() => go("settings")}>设置</button></li><li><ThemeToggle /></li></ul></details></nav></header>
  <main class="mx-auto max-w-3xl p-4 pb-24">
    {#if notice}<div class="toast toast-center toast-bottom z-50 sm:toast-end"><div class="alert alert-info shadow-lg" role="status"><span>{notice}</span>{#if noticeAction}<button class="btn btn-sm" on:click={() => noticeAction?.()}>撤销</button>{/if}</div></div>{/if}
    {#if view === "list"}
      <section class="space-y-4"><div><h1 class="text-3xl font-bold">我的番剧</h1><p class="text-base-content/60">按进入列表时的最近观看活动排序。</p></div><input class="input w-full" bind:value={query} placeholder="搜索任意语言标题" aria-label="搜索" /><fieldset class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-box border border-base-300 px-3 py-2"><legend class="sr-only">按状态过滤</legend>{#each statuses as item}<label class="flex cursor-pointer items-center gap-2 text-sm"><input class="checkbox checkbox-sm" type="checkbox" checked={statusFilter.includes(item.value)} on:change={() => toggleStatus(item.value)} /><span>{item.label}</span></label>{/each}<span class="ml-auto flex gap-1"><button class="btn btn-ghost btn-xs" type="button" on:click={() => statusFilter = statuses.map(({ value }) => value)}>全部</button><button class="btn btn-ghost btn-xs" type="button" on:click={() => statusFilter = statuses.map(({ value }) => value).filter((value) => !statusFilter.includes(value))}>反选</button></span></fieldset>
        <div class="grid gap-3 sm:grid-cols-2">{#each shows as show}{@const next = nextVolumeEpisode(data, show)}{@const status = statuses.find(({ value }) => value === show.status)!}<article class="card border border-base-300 bg-base-100"><div class="card-body p-4"><div class="flex items-start justify-between gap-2"><button class="min-w-0 break-words text-left text-lg font-semibold hover:text-primary" on:click={() => go(`show/${show.id}`)}>{show.title[0]}</button><span class={`badge shrink-0 whitespace-nowrap ${status.badge}`}>{status.label}</span></div>{#if show.title.length > 1}<p class="truncate text-sm text-base-content/60">{show.title.slice(1).join(" · ")}</p>{/if}<div class="card-actions mt-auto justify-end">{#if next}<button class="btn btn-primary btn-sm" aria-label={`标记已观看${volumeLabel(show, next.volume)}第 ${next.episode} 话`} on:click={() => quickRecord(show, next.volume)}>记录 {volumeLabel(show, next.volume)}第 {next.episode} 话</button>{:else}<button class="btn btn-sm" disabled>{show.volumes.length ? "已全部看完" : "请先添加 Volume"}</button>{/if}</div></div></article>{/each}</div>{#if !shows.length}<div class="py-16 text-center"><p class="text-base-content/60">{query ? "没有找到匹配标题" : statusFilter.length ? "还没有作品" : "未选择任何观看状态"}</p>{#if query}<button class="btn btn-sm mt-4" on:click={() => query = ""}>清除搜索</button>{:else if !statusFilter.length}<button class="btn btn-sm mt-4" on:click={() => statusFilter = statuses.map(({ value }) => value)}>恢复全部状态</button>{:else}<button class="btn btn-primary btn-sm mt-4" on:click={() => addShowDialog.showModal()}>添加第一部作品</button>{/if}</div>{/if}
      </section>
    {:else if view === "show" && selected}
      <section class="space-y-5"><button class="btn btn-ghost btn-sm" on:click={() => go("list")}>← 返回</button><div class="flex flex-col items-start justify-between gap-3 sm:flex-row"><div class="min-w-0"><h1 class="text-3xl font-bold">{selected.title[0]}</h1><div class="flex flex-wrap items-center gap-x-2 text-sm text-base-content/60">{#each selected.title.slice(1) as title, index}{#if index}<span aria-hidden="true">·</span>{/if}<span class="relative inline-flex"><button class="hover:text-primary" aria-expanded={activeSubtitle === index + 1} on:click|stopPropagation={() => activeSubtitle = activeSubtitle === index + 1 ? -1 : index + 1}>{title}</button>{#if activeSubtitle === index + 1}<span class="absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 rounded-box border border-base-300 bg-base-100 p-1 shadow-lg" on:click|stopPropagation><button class="btn btn-primary btn-xs whitespace-nowrap" on:click={() => { updateShow(setDefaultTitle(selected!, index + 1)); activeSubtitle = -1 }}>设为默认</button></span>{/if}</span>{/each}</div><p class="text-base-content/60">{selected.externalRef ? `Bangumi #${selected.externalRef.id}` : "本地作品"}</p></div><fieldset class="join grid w-full grid-cols-4 sm:w-auto" aria-label="观看状态">{#each statuses as item}<button class:btn-active={selected.status === item.value} class="btn btn-sm join-item" type="button" aria-pressed={selected.status === item.value} on:click={() => updateShow({ ...selected!, status: item.value })}>{item.label}</button>{/each}</fieldset></div>
        <details class="border-b border-base-300"><summary class="cursor-pointer py-3 font-semibold">笔记</summary><div class="pb-4"><label class="form-control"><span class="label-text">作品笔记</span><textarea class="textarea textarea-bordered min-h-32 w-full" maxlength="2048" placeholder="最多 2048 字" value={selected.note ?? ""} on:change={(event) => updateShow({ ...selected!, note: event.currentTarget.value })}></textarea></label></div></details>
        <div class="card border border-base-300"><div class="card-body"><div class="flex items-center justify-between gap-3"><h2 class="card-title">Volumes</h2><button class="btn btn-primary btn-sm" on:click={() => addVolumeDialog.showModal()}>添加 Volume</button></div><div class="space-y-2">{#each selected.volumes as volume}{@const next = nextEpisode(data, volume)}{@const watched = new Set(data.watchEvents.filter((event) => event.episodes.volumeId === volume.id).flatMap(expandedEpisodes))}<div class="rounded-lg border border-base-300 p-3"><div class="flex flex-wrap items-center gap-2"><strong class="min-w-24">{volumeLabel(selected, volume)}</strong><input class="input input-sm w-24" type="number" min="1" value={volume.episodeCount} aria-label={`${volumeLabel(selected, volume)}集数`} on:change={(event) => resizeVolume(volume, Number(event.currentTarget.value))} /><span>话</span><button class="btn btn-primary btn-sm ml-auto" disabled={!next} on:click={() => quickRecord(selected!, volume)}>{next ? `记录第 ${next} 话` : "已看完"}</button><button class="btn btn-ghost btn-sm text-error" on:click={() => removeVolume(volume)}>删除</button></div><p class="mt-3 text-sm font-medium">已观看 {watched.size}/{volume.episodeCount} 话</p><div class="mt-2 grid grid-cols-12 gap-1" aria-hidden="true">{#each Array(volume.episodeCount) as _, index}<span class={`aspect-square min-h-2 rounded-sm ${watched.has(index + 1) ? "bg-success" : "bg-base-300"}`} title={`第 ${index + 1} 话：${watched.has(index + 1) ? "已观看" : "未观看"}`}></span>{/each}</div></div>{/each}</div></div></div>
        <section class="space-y-3 border-b border-base-300 pb-5"><h2 class="text-xl font-bold">绑定 Bangumi</h2><form class="join w-full" on:submit|preventDefault={findMetadata}><label class="sr-only" for="metadata-search">搜索 Bangumi 标题</label><input id="metadata-search" class="input join-item min-w-0 w-full" bind:value={metadataQuery} placeholder="搜索标题" required /><button class="btn join-item" disabled={metadataBusy}>{metadataBusy ? "搜索中" : "搜索"}</button></form>{#if metadataError}<p class="text-sm text-error" role="alert">{metadataError}</p>{:else if metadataSearched && !candidates.length}<p class="text-sm text-base-content/60">没有找到匹配条目。</p>{/if}{#each candidates as candidate}<button class="flex w-full min-w-0 items-center gap-3 rounded-lg p-2 text-left hover:bg-base-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" on:click={() => bindMetadata(candidate)}>{#if candidate.images?.small}<img class="h-16 w-12 shrink-0 object-cover" src={candidate.images.small} alt="" />{/if}<span class="min-w-0"><strong class="block truncate">{candidate.name_cn || candidate.name}</strong><small class="block truncate">{candidate.name} · {candidate.date || "日期未知"}</small></span></button>{/each}</section>
        <button class="btn w-full" disabled={!selected.volumes.length} on:click={() => startRecord(selected!)}>自定义补录</button><details class="rounded-box border border-base-300"><summary class="cursor-pointer px-4 py-3 font-semibold">详细观看历史 <span class="font-normal text-base-content/60">{events.length} 条</span></summary><div class="divide-y divide-base-300 border-t border-base-300 px-4">{#each events as event}<div class="flex items-center gap-2 py-2"><span class="min-w-0 flex-1"><strong class="block truncate text-sm">{episodeLabel(selected, event)}</strong><small class="text-base-content/60">{displayDate(event)}</small></span><button class="btn btn-ghost btn-xs" on:click={() => startRecord(selected!, event)}>修改</button><button class="btn btn-ghost btn-xs text-error" on:click={() => removeEvent(event.id)}>删除</button></div>{/each}{#if !events.length}<p class="py-4 text-sm text-base-content/60">尚无观看记录</p>{/if}</div></details><button class="btn btn-error btn-outline" on:click={() => removeShow(selected!)}>删除作品</button>
      </section>
    {:else if view === "record" && selected}
      <section class="space-y-5"><button class="btn btn-ghost btn-sm" on:click={() => go(`show/${selected!.id}`)}>← 返回</button><header><h1 class="text-3xl font-bold">补录观看记录</h1><p class="mt-1 truncate text-base-content/60">{selected.title[0]}</p></header><form class="card border border-base-300" on:submit|preventDefault={record}><div class="card-body gap-5"><div><h2 class="mb-3 font-semibold">观看范围</h2><div class="grid gap-4 sm:grid-cols-3"><label class="form-control sm:col-span-3"><span class="label-text">Volume</span><select class="select select-bordered" bind:value={volumeId}>{#each selected.volumes as volume}<option value={volume.id}>{volumeLabel(selected, volume)}</option>{/each}</select></label><label class="form-control"><span class="label-text">起始话</span><input class="input input-bordered" type="number" min="1" max={recordVolume?.episodeCount} bind:value={episodeFrom} aria-describedby="record-error" required /></label><label class="form-control"><span class="label-text">结束话</span><input class="input input-bordered" type="number" min="1" max={recordVolume?.episodeCount} bind:value={episodeTo} aria-describedby="record-error" required /></label></div></div>{#if recordError}<p id="record-error" class="text-sm text-error" role="alert">{recordError}</p>{/if}<div class="divider my-0"></div><div><h2 class="mb-3 font-semibold">观看时间</h2><div class="grid gap-4 sm:grid-cols-2"><label class="form-control"><span class="label-text">时间精度</span><select class="select select-bordered" bind:value={precision}><option value="exact">精确</option><option value="day">精确到日</option><option value="month">精确到月</option><option value="year">精确到年</option><option value="unknown">未知</option></select></label>{#if precision === "exact"}<label class="form-control"><span class="label-text">日期与时间</span><input class="input input-bordered w-full" type="datetime-local" bind:value={watchedValue} /></label>{:else if precision === "day"}<label class="form-control"><span class="label-text">日期</span><input class="input input-bordered w-full" type="date" bind:value={watchedValue} /></label>{:else if precision === "month"}<label class="form-control"><span class="label-text">月份</span><input class="input input-bordered w-full" type="month" bind:value={watchedValue} /></label>{:else if precision === "year"}<label class="form-control"><span class="label-text">年份</span><input class="input input-bordered w-full" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="例如 2026" bind:value={watchedValue} /></label>{/if}</div></div><div class="card-actions justify-end"><button class="btn" type="button" on:click={() => go(`show/${selected!.id}`)}>取消</button><button class="btn btn-primary">{editingEventId ? "更新本地草稿" : "加入本地草稿"}</button></div></div></form></section>
    {:else if view === "settings"}
      <section class="space-y-6"><h1 class="text-3xl font-bold">设置与导入</h1><div class="card border border-base-300"><div class="card-body"><h2 class="card-title">GitHub 数据</h2><p>已登录 · {sha ? `SHA ${sha.slice(0, 8)}` : "远端文件尚未创建"}</p><div class="card-actions"><button class="btn btn-warning" disabled={busy} on:click={() => sync(true)}>强制从 GitHub 覆盖本地</button><button class="btn btn-primary" disabled={!dirty || busy} on:click={save}>保存到 GitHub</button><button class="btn btn-ghost" on:click={async () => { await logout(); auth = "unauthenticated" }}>退出</button></div></div></div><div class="card border border-base-300"><div class="card-body"><h2 class="card-title">本地迁移</h2><p>文件只在当前浏览器读取；先导入当前状态，再导入历史。</p><input class="file-input file-input-bordered" type="file" accept="application/json,.json" aria-label="选择迁移 JSON" on:change={(e) => { const file = e.currentTarget.files?.[0]; if (file) importFile(file) }} /><div class="card-actions"><button class="btn btn-sm" on:click={downloadBackup}>下载当前备份</button><button class="btn btn-sm" disabled={!importBackup} on:click={undoImport}>撤销最近导入</button></div></div></div></section>
    {:else}<div class="py-16 text-center"><p>页面或作品不存在</p><button class="btn mt-4" on:click={() => go("list")}>返回列表</button></div>{/if}
  </main>
{/if}
