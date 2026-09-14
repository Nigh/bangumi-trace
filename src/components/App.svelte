<script lang="ts">
  import { onMount } from "svelte"
  import ThemeToggle from "./ThemeToggle.svelte"
  import { importCurrent, importHistory } from "../lib/importer"
  import { emptyData, episodeLabel, matchesTitle, nextEpisodes, reorderTitle, uniqueTitles, withEpisodeMapping, type BangumiData, type Precision, type Show, type Status, type WatchEvent } from "../lib/model"
  import { loadData, loginUrl, logout, saveData, searchBangumi } from "../lib/api"

  const CACHE = "bangumi-trace-cache"
  let data: BangumiData = emptyData(), sha: string | null = null, query = "", status: Status | "all" = "all"
  let view = "list", selectedId = "", notice = "", authenticated = false, busy = false, dirty = false
  let importBackup: BangumiData | null = null
  let newTitle = "", metadataQuery = "", candidates: Awaited<ReturnType<typeof searchBangumi>>["data"] = []
  let episode = { season: 1, from: 1, to: 1, absoluteFrom: undefined as number | undefined, absoluteTo: undefined as number | undefined }
  let precision: Precision = "exact", watchedValue = "", rangeFrom = "", rangeTo = "", rangeLabel = "近期"
  let editingEventId = "", mapSeason = 1, mapStart = 1

  $: selected = data.shows.find((show) => show.id === selectedId)
  $: shows = data.shows.filter((show) => (status === "all" || show.status === status) && matchesTitle(show, query))
  $: events = selected ? data.watchEvents.filter((event) => event.showId === selected.id).reverse() : []

  function route(hash = location.hash) {
    const [, next = "list", id = ""] = hash.match(/^#([^/]+)(?:\/(.+))?/) ?? []
    view = next; selectedId = id
  }
  const go = (next: string) => { location.hash = next }
  function cache(markDirty = true) { dirty = markDirty; localStorage.setItem(CACHE, JSON.stringify({ data, sha })) }
  function message(text: string) { notice = text; setTimeout(() => notice === text && (notice = ""), 4000) }

  onMount(async () => {
    route(); addEventListener("hashchange", () => route())
    const cached = localStorage.getItem(CACHE)
    if (cached) try { ({ data, sha } = JSON.parse(cached)) } catch { localStorage.removeItem(CACHE) }
    await sync()
  })

  async function sync() {
    if (dirty && !confirm("同步会放弃尚未保存的本地修改，继续？")) return
    busy = true
    try { ({ data, sha } = await loadData()); authenticated = true; cache(false); message("已与 GitHub 同步") }
    catch (error) { authenticated = false; if ((error as { status?: number }).status !== 401) message((error as Error).message) }
    finally { busy = false }
  }
  async function save() {
    busy = true
    try { ({ sha } = await saveData(data, sha)); cache(false); authenticated = true; message("已保存并创建 commit") }
    catch (error) { message((error as { status?: number }).status === 409 ? "远端已有更新，请先同步后重新应用修改" : (error as Error).message) }
    finally { busy = false }
  }
  function addShow() {
    if (!newTitle.trim()) return
    const show: Show = { id: crypto.randomUUID(), title: [newTitle.trim()], status: "planned", notes: [] }
    data = { ...data, shows: [...data.shows, show] }; newTitle = ""; cache(); go(`show/${show.id}`)
  }
  function updateShow(next: Show) { data = { ...data, shows: data.shows.map((show) => show.id === next.id ? next : show) }; cache() }
  function removeShow(show: Show) {
    if (!confirm(`删除“${show.title[0]}”及其观看记录？`)) return
    data = { ...data, shows: data.shows.filter((item) => item.id !== show.id), watchEvents: data.watchEvents.filter((event) => event.showId !== show.id) }
    cache(); go("list")
  }
  function startRecord(show: Show, next = false) {
    selectedId = show.id
    editingEventId = ""
    episode = next ? { ...nextEpisodes(data, show) } as typeof episode : { season: 1, from: 1, to: 1, absoluteFrom: undefined, absoluteTo: undefined }
    precision = "exact"; watchedValue = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    go(`record/${show.id}`)
  }
  function record() {
    if (!selected || (!episode.from && !episode.absoluteFrom)) return message("至少填写一种集数编号")
    if ((precision === "exact" || precision === "day") && !watchedValue) return message("请选择观看时间")
    if (precision === "range" && (!rangeFrom || !rangeTo || !rangeLabel.trim())) return message("请填写完整时间范围")
    const episodes = withEpisodeMapping(selected, episode)
    let watchedAt: WatchEvent["watchedAt"] = { precision: "unknown" }
    if (precision === "exact") watchedAt = { precision, value: new Date(watchedValue).toISOString() }
    if (precision === "day") watchedAt = { precision, value: watchedValue.slice(0, 10) }
    if (precision === "range") watchedAt = { precision, from: rangeFrom, to: rangeTo, label: rangeLabel }
    const existing = data.watchEvents.find((item) => item.id === editingEventId)
    const event: WatchEvent = { id: existing?.id ?? crypto.randomUUID(), showId: selected.id, episodes, watchedAt, recordedAt: existing?.recordedAt ?? new Date().toISOString(), source: existing?.source ?? "manual", confidence: existing?.confidence, sourceCommit: existing?.sourceCommit }
    const watchEvents = existing ? data.watchEvents.map((item) => item.id === existing.id ? event : item) : [...data.watchEvents, event]
    data = { ...data, watchEvents, shows: data.shows.map((show) => show.id === selected.id && show.status === "planned" ? { ...show, status: "watching" } : show) }
    cache(); go(`show/${selected.id}`)
  }
  function editEvent(event: WatchEvent) {
    editingEventId = event.id
    episode = { season: event.episodes.season ?? 1, from: event.episodes.from ?? 1, to: event.episodes.to ?? event.episodes.from ?? 1, absoluteFrom: event.episodes.absoluteFrom, absoluteTo: event.episodes.absoluteTo }
    precision = event.watchedAt.precision
    watchedValue = event.watchedAt.precision === "exact" ? event.watchedAt.value.slice(0, 16) : event.watchedAt.precision === "day" ? event.watchedAt.value : ""
    rangeFrom = event.watchedAt.precision === "range" ? event.watchedAt.from : ""
    rangeTo = event.watchedAt.precision === "range" ? event.watchedAt.to : ""
    rangeLabel = event.watchedAt.precision === "range" ? event.watchedAt.label : "近期"
    go(`record/${event.showId}`)
  }
  function saveMapping() {
    if (!selected || mapSeason < 1 || mapStart < 1) return
    const seasons = [...(selected.numbering?.seasons ?? []).filter((item) => item.season !== mapSeason), { season: mapSeason, absoluteStart: mapStart }].sort((a, b) => a.season - b.season)
    updateShow({ ...selected, numbering: { seasons } })
  }
  function removeEvent(id: string) {
    if (!confirm("删除这条观看记录？")) return
    data = { ...data, watchEvents: data.watchEvents.filter((event) => event.id !== id) }; cache()
  }
  async function findMetadata() {
    if (!metadataQuery.trim()) return
    try { candidates = (await searchBangumi(metadataQuery)).data } catch (error) { message((error as Error).message) }
  }
  function bindMetadata(candidate: (typeof candidates)[number]) {
    if (!selected) return
    updateShow({ ...selected, title: uniqueTitles(selected.title[0], [candidate.name_cn ?? "", candidate.name, ...selected.title.slice(1)]), externalRef: { provider: "bangumi", id: String(candidate.id) } })
    candidates = []; message("已绑定 Bangumi 条目")
  }
  function downloadBackup() {
    const link = document.createElement("a")
    link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" }))
    link.download = `bangumi-backup-${new Date().toISOString().slice(0, 10)}.json`
    link.click(); URL.revokeObjectURL(link.href)
  }
  function undoImport() {
    if (!importBackup) return
    data = importBackup; importBackup = null; cache(); message("已撤销最近一次导入")
  }
  async function importFile(file: File) {
    try {
      const value = JSON.parse(await file.text())
      importBackup = structuredClone(data)
      if (Array.isArray(value.items)) {
        const shows = importCurrent(value)
        if (!confirm(`预览：将导入 ${shows.length} 个作品。继续？`)) return
        data = { ...data, shows: [...data.shows, ...shows] }
      } else {
        const events = importHistory(value, data)
        if (!confirm(`预览：找到 ${events.length} 条高置信候选记录；观看时间保持未知。继续？`)) return
        data = { ...data, watchEvents: [...data.watchEvents, ...events] }
      }
      cache(); message("导入保存在本地草稿中，请检查后同步")
    } catch (error) { message((error as Error).message) }
  }
</script>

<header class="navbar sticky top-0 z-40 border-b border-base-300 bg-base-100/95 px-4 backdrop-blur">
  <div class="flex-1"><button class="btn btn-ghost text-xl" on:click={() => go("list")}>Bangumi Trace</button></div>
  <nav class="flex gap-1" aria-label="主导航">
    <button class="btn btn-ghost btn-sm" on:click={() => go("list")}>列表</button>
    <button class="btn btn-ghost btn-sm" on:click={() => go("settings")}>设置</button>
    <ThemeToggle />
  </nav>
</header>

<main class="mx-auto max-w-3xl p-4 pb-24">
  {#if notice}<div class="alert alert-info mb-4" role="status">{notice}</div>{/if}

  {#if view === "list"}
    <section class="space-y-4">
      <div><h1 class="text-3xl font-bold">我的番剧</h1><p class="text-base-content/60">所有名称都在标题数组中，首项为默认标题。</p></div>
      <div class="join w-full"><input class="input join-item w-full" bind:value={query} placeholder="搜索任意语言标题" aria-label="搜索" /><select class="select join-item" bind:value={status} aria-label="状态"><option value="all">全部</option><option value="planned">计划</option><option value="watching">观看中</option><option value="completed">完成</option><option value="dropped">放弃</option></select></div>
      <form class="join w-full" on:submit|preventDefault={addShow}><input class="input join-item w-full" bind:value={newTitle} placeholder="创建本地作品" aria-label="作品标题" /><button class="btn btn-primary join-item">添加</button></form>
      <div class="grid gap-3 sm:grid-cols-2">
        {#each shows as show}
          <article class="card border border-base-300 bg-base-100"><div class="card-body p-4"><div class="flex items-start justify-between gap-2"><button class="text-left text-lg font-semibold hover:text-primary" on:click={() => go(`show/${show.id}`)}>{show.title[0]}</button><span class="badge badge-outline">{show.status}</span></div><p class="truncate text-sm text-base-content/60">{show.title.slice(1).join(" · ") || "仅一个标题"}</p><div class="card-actions justify-end"><button class="btn btn-primary btn-sm" on:click={() => startRecord(show, true)}>下一话</button></div></div></article>
        {/each}
      </div>
      {#if !shows.length}<p class="py-16 text-center text-base-content/50">暂无匹配作品</p>{/if}
    </section>
  {:else if view === "show" && selected}
    <section class="space-y-5">
      <button class="btn btn-ghost btn-sm" on:click={() => go("list")}>← 返回</button>
      <div class="flex items-start justify-between"><div><h1 class="text-3xl font-bold">{selected.title[0]}</h1><p class="text-base-content/60">{selected.externalRef ? `Bangumi #${selected.externalRef.id}` : "本地作品"}</p></div><select class="select select-sm" value={selected.status} on:change={(e) => updateShow({ ...selected, status: (e.currentTarget as HTMLSelectElement).value as Status })}><option value="planned">计划</option><option value="watching">观看中</option><option value="completed">完成</option><option value="dropped">放弃</option></select></div>
      <div class="card border border-base-300"><div class="card-body"><h2 class="card-title">标题</h2>{#each selected.title as title, index}<div class="flex items-center gap-2"><span class="flex-1">{title}{index === 0 ? "（默认）" : ""}</span><button class="btn btn-xs" disabled={index === 0} aria-label={`上移 ${title}`} on:click={() => updateShow(reorderTitle(selected!, index, index - 1))}>↑</button><button class="btn btn-xs" disabled={index === selected.title.length - 1} aria-label={`下移 ${title}`} on:click={() => updateShow(reorderTitle(selected!, index, index + 1))}>↓</button></div>{/each}</div></div>
      <div class="card border border-base-300"><div class="card-body"><h2 class="card-title">集数映射</h2><p class="text-sm text-base-content/60">{selected.numbering?.seasons.map((item) => `S${item.season} 从总第 ${item.absoluteStart} 话开始`).join(" · ") || "尚未设置"}</p><div class="join"><input class="input input-sm join-item w-24" type="number" min="1" aria-label="季度" bind:value={mapSeason} /><input class="input input-sm join-item w-32" type="number" min="1" aria-label="总集数起点" bind:value={mapStart} /><button class="btn btn-sm join-item" on:click={saveMapping}>保存映射</button></div></div></div>
      <div class="card border border-base-300"><div class="card-body"><h2 class="card-title">绑定 Bangumi</h2><div class="join"><input class="input join-item w-full" bind:value={metadataQuery} placeholder="搜索标题" /><button class="btn join-item" on:click={findMetadata}>搜索</button></div>{#each candidates as candidate}<button class="flex items-center gap-3 rounded-lg p-2 text-left hover:bg-base-200" on:click={() => bindMetadata(candidate)}>{#if candidate.images?.small}<img class="h-16 w-12 object-cover" src={candidate.images.small} alt="" />{/if}<span><strong>{candidate.name_cn || candidate.name}</strong><br /><small>{candidate.name} · {candidate.date || "日期未知"}</small></span></button>{/each}</div></div>
      <div class="flex gap-2"><button class="btn btn-primary flex-1" on:click={() => startRecord(selected!, true)}>记录下一话</button><button class="btn flex-1" on:click={() => startRecord(selected!)}>自定义记录</button></div>
      <div><h2 class="mb-2 text-xl font-bold">观看记录</h2><div class="space-y-2">{#each events as event}<div class="flex items-center rounded-lg border border-base-300 p-3"><span class="flex-1"><strong>{episodeLabel(event)}</strong><br /><small>{event.watchedAt.precision === "unknown" ? "时间未知" : event.watchedAt.precision}</small></span><button class="btn btn-ghost btn-sm" on:click={() => editEvent(event)}>修改</button><button class="btn btn-ghost btn-sm text-error" on:click={() => removeEvent(event.id)}>删除</button></div>{/each}</div></div>
      <button class="btn btn-error btn-outline" on:click={() => removeShow(selected!)}>删除作品</button>
    </section>
  {:else if view === "record" && selected}
    <section class="space-y-5"><button class="btn btn-ghost btn-sm" on:click={() => go(`show/${selected!.id}`)}>← 返回</button><h1 class="text-3xl font-bold">记录 · {selected.title[0]}</h1>
      <div class="grid grid-cols-3 gap-2"><label class="form-control"><span class="label-text">季度</span><input class="input input-bordered" type="number" min="1" bind:value={episode.season} /></label><label class="form-control"><span class="label-text">从第几话</span><input class="input input-bordered" type="number" min="1" bind:value={episode.from} /></label><label class="form-control"><span class="label-text">到第几话</span><input class="input input-bordered" type="number" min="1" bind:value={episode.to} /></label><label class="form-control"><span class="label-text">总集数从</span><input class="input input-bordered" type="number" min="1" bind:value={episode.absoluteFrom} /></label><label class="form-control"><span class="label-text">总集数到</span><input class="input input-bordered" type="number" min="1" bind:value={episode.absoluteTo} /></label></div>
      <label class="form-control"><span class="label-text">观看时间精度</span><select class="select select-bordered" bind:value={precision}><option value="exact">精确时间</option><option value="day">日期</option><option value="range">范围</option><option value="unknown">未知</option></select></label>
      {#if precision === "exact"}<input class="input input-bordered w-full" type="datetime-local" bind:value={watchedValue} />{:else if precision === "day"}<input class="input input-bordered w-full" type="date" bind:value={watchedValue} />{:else if precision === "range"}<div class="grid grid-cols-3 gap-2"><input class="input input-bordered" type="date" bind:value={rangeFrom} /><input class="input input-bordered" type="date" bind:value={rangeTo} /><input class="input input-bordered" bind:value={rangeLabel} placeholder="近期" /></div>{/if}
      <button class="btn btn-primary w-full" on:click={record}>{editingEventId ? "更新本地草稿" : "加入本地草稿"}</button>
    </section>
  {:else if view === "settings"}
    <section class="space-y-6"><h1 class="text-3xl font-bold">设置与导入</h1>
      <div class="card border border-base-300"><div class="card-body"><h2 class="card-title">GitHub 同步</h2><p>{authenticated ? "已登录" : "未登录"} · {sha ? `SHA ${sha.slice(0, 8)}` : "远端文件尚未创建"}</p><div class="card-actions"><a class="btn" href={loginUrl}>GitHub 登录</a><button class="btn" disabled={busy} on:click={sync}>同步</button><button class="btn btn-primary" disabled={!authenticated || busy} on:click={save}>保存到 GitHub</button><button class="btn btn-ghost" on:click={async () => { await logout(); authenticated = false }}>退出</button></div></div></div>
      <div class="card border border-base-300"><div class="card-body"><h2 class="card-title">本地迁移</h2><p>文件只在当前浏览器读取；先导入当前状态，再导入历史。导入前会显示数量并要求确认。</p><input class="file-input file-input-bordered" type="file" accept="application/json,.json" aria-label="选择迁移 JSON" on:change={(e) => { const file = (e.currentTarget as HTMLInputElement).files?.[0]; if (file) importFile(file) }} /><div class="card-actions"><button class="btn btn-sm" on:click={downloadBackup}>下载当前备份</button><button class="btn btn-sm" disabled={!importBackup} on:click={undoImport}>撤销最近导入</button></div></div></div>
    </section>
  {:else}<div class="py-16 text-center"><p>页面或作品不存在</p><button class="btn mt-4" on:click={() => go("list")}>返回列表</button></div>{/if}
</main>
