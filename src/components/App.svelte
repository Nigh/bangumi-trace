<script lang="ts">
  import { onMount } from "svelte"
  import ThemeToggle from "./ThemeToggle.svelte"
  import { importCurrent, importHistory } from "../lib/importer"
  import { emptyData, episodeLabel, eventTime, expandedEpisodes, matchesTitle, nextEpisode, nextVolumeEpisode, setDefaultTitle, sortShowsByActivity, uniqueTitles, volumeLabel, type BangumiData, type Precision, type Show, type Status, type Volume, type WatchEvent } from "../lib/model"
  import { loadData, loginUrl, logout, saveData, searchBangumi } from "../lib/api"

  const CACHE = "bangumi-trace-cache"
  const SETUP_DOC = "https://github.com/Nigh/bangumi-trace/blob/main/docs/DEPLOYMENT.md#6-%E4%BD%BF%E7%94%A8%E4%B8%8E%E8%BF%81%E7%A7%BB%E4%B8%AA%E4%BA%BA%E6%95%B0%E6%8D%AE"
  let data: BangumiData = emptyData(), sha: string | null = null, query = "", status: Status | "all" = "all"
  let view = "list", selectedId = "", notice = "", auth: "checking" | "authenticated" | "unauthenticated" | "repository-error" = "checking", busy = false, dirty = false
  let importBackup: BangumiData | null = null, repositoryDialog: HTMLDialogElement
  let newTitle = "", metadataQuery = "", candidates: Awaited<ReturnType<typeof searchBangumi>>["data"] = []
  let volumeType = "正剧", customVolumeType = "", volumeEpisodes = 12
  let volumeId = "", episodeFrom = 1, episodeTo = 1, precision: Precision = "exact", watchedValue = "", editingEventId = "", activeSubtitle = -1

  $: selected = data.shows.find((show) => show.id === selectedId)
  $: shows = sortShowsByActivity(data, data.shows.filter((show) => (status === "all" || show.status === status) && matchesTitle(show, query)))
  $: events = selected ? data.watchEvents.filter((event) => event.showId === selected.id).sort((a, b) => eventTime(b) - eventTime(a)) : []

  function route(hash = location.hash) {
    const [, next = "list", id = ""] = hash.match(/^#([^/]+)(?:\/(.+))?/) ?? []
    view = next; selectedId = id; activeSubtitle = -1
  }
  const go = (next: string) => { location.hash = next }
  function cache(markDirty = true) { dirty = markDirty; localStorage.setItem(CACHE, JSON.stringify({ data, sha })) }
  function message(text: string) { notice = text; setTimeout(() => notice === text && (notice = ""), 4000) }
  const nowForInput = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)

  onMount(async () => {
    route(); addEventListener("hashchange", () => route())
    const cached = localStorage.getItem(CACHE)
    if (cached) try { ({ data, sha } = JSON.parse(cached)) } catch { localStorage.removeItem(CACHE) }
    await sync(false)
  })

  async function sync(force = true) {
    if (force && dirty && !confirm("强制同步会永久放弃尚未保存的本地修改，并使用 GitHub 数据覆盖。继续？")) return
    busy = true
    try { ({ data, sha } = await loadData()); auth = "authenticated"; cache(false); if (force) message("已用 GitHub 数据覆盖本地内容") }
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
    data = { ...data, shows: [...data.shows, show] }; newTitle = ""; cache(); go(`show/${show.id}`)
  }
  function updateShow(next: Show) { data = { ...data, shows: data.shows.map((show) => show.id === next.id ? next : show) }; cache() }
  function removeShow(show: Show) {
    if (!confirm(`删除“${show.title[0]}”及其观看记录？`)) return
    data = { ...data, shows: data.shows.filter((item) => item.id !== show.id), watchEvents: data.watchEvents.filter((event) => event.showId !== show.id) }
    cache(); go("list")
  }
  function addVolume() {
    if (!selected || !Number.isInteger(volumeEpisodes) || volumeEpisodes < 1) return message("集数必须是正整数")
    const type = volumeType === "自定义" ? customVolumeType.trim() : volumeType
    if (!type) return message("请输入 volume 类型")
    updateShow({ ...selected, volumes: [...selected.volumes, { id: crypto.randomUUID(), type, episodeCount: volumeEpisodes }] })
    customVolumeType = ""
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
    if (!confirm(count ? `删除 ${volumeLabel(selected, volume)}，并删除其 ${count} 条观看记录？` : `删除 ${volumeLabel(selected, volume)}？`)) return
    data = { ...data, shows: data.shows.map((show) => show.id === selected.id ? { ...show, volumes: show.volumes.filter((item) => item.id !== volume.id) } : show), watchEvents: data.watchEvents.filter((event) => event.episodes.volumeId !== volume.id) }
    cache()
  }
  function quickRecord(show: Show, volume: Volume) {
    const episode = nextEpisode(data, volume)
    if (!episode) return
    const event: WatchEvent = { id: crypto.randomUUID(), showId: show.id, episodes: { volumeId: volume.id, from: episode, to: episode }, watchedAt: { precision: "exact", value: new Date().toISOString() }, recordedAt: new Date().toISOString(), source: "manual" }
    data = { ...data, watchEvents: [...data.watchEvents, event], shows: data.shows.map((item) => item.id === show.id && item.status === "planned" ? { ...item, status: "watching" } : item) }
    cache(); message(`已记录 ${volumeLabel(show, volume)}第 ${episode} 话`)
  }
  function startRecord(show: Show, event?: WatchEvent) {
    selectedId = show.id; editingEventId = event?.id ?? ""
    volumeId = event?.episodes.volumeId ?? show.volumes[0]?.id ?? ""
    episodeFrom = event?.episodes.from ?? 1; episodeTo = event?.episodes.to ?? episodeFrom
    precision = event?.watchedAt.precision === "range" ? "unknown" : event?.watchedAt.precision ?? "exact"
    watchedValue = event?.watchedAt.precision === "exact" ? event.watchedAt.value.slice(0, 16) : event?.watchedAt.precision === "day" || event?.watchedAt.precision === "month" || event?.watchedAt.precision === "year" ? event.watchedAt.value : nowForInput()
    go(`record/${show.id}`)
  }
  function record() {
    if (!selected) return
    const volume = selected.volumes.find((item) => item.id === volumeId)
    if (!volume || episodeFrom < 1 || episodeTo < episodeFrom || episodeTo > volume.episodeCount) return message("话数超出 volume 范围")
    if (precision !== "unknown" && !watchedValue) return message("请选择观看时间")
    let watchedAt: WatchEvent["watchedAt"] = { precision: "unknown" }
    if (precision === "year" && !/^\d{4}$/.test(watchedValue)) return message("请输入四位年份")
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
    if (!confirm("删除这条观看记录？")) return
    data = { ...data, watchEvents: data.watchEvents.filter((event) => event.id !== id) }; cache()
  }
  function displayDate(event: WatchEvent) {
    const watched = event.watchedAt
    if (watched.precision === "unknown") return "时间未知"
    if (watched.precision === "range") return `${watched.from} 至 ${watched.to}（${watched.label}）`
    if (watched.precision === "day") return watched.value
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(watched.value))
    if (watched.precision === "month") return `${watched.value}（精确到月）`
    if (watched.precision === "year") return `${watched.value}（精确到年）`
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
    link.download = `bangumi-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href)
  }
  function undoImport() { if (importBackup) { data = importBackup; importBackup = null; cache(); message("已撤销最近一次导入") } }
  async function importFile(file: File) {
    try {
      const value = JSON.parse(await file.text()); importBackup = structuredClone(data)
      if (Array.isArray(value.items)) {
        const imported = importCurrent(value)
        if (!confirm(`预览：将导入 ${imported.length} 个作品。继续？`)) return
        data = { ...data, shows: [...data.shows, ...imported] }
      } else {
        const imported = importHistory(value, data)
        if (!confirm(`预览：找到 ${imported.length} 条高置信候选记录；观看时间保持未知。继续？`)) return
        data = { ...data, watchEvents: [...data.watchEvents, ...imported] }
      }
      cache(); message("导入保存在本地草稿中，请检查后保存")
    } catch (error) { message((error as Error).message) }
  }
</script>

<dialog class="modal" bind:this={repositoryDialog}>
  <div class="modal-box"><h2 class="text-xl font-bold">找不到可用的数据仓库</h2><p class="py-4">请创建私有仓库 <code>bangumi-trace-data</code>，并授权 GitHub App 访问，然后重试。</p><a class="link link-primary" href={SETUP_DOC} target="_blank" rel="noreferrer">查看仓库配置文档</a><div class="modal-action"><form method="dialog"><button class="btn">关闭</button></form><button class="btn btn-primary" on:click={() => sync(false)}>重试</button></div></div>
</dialog>

{#if auth !== "authenticated"}
  <main class="grid min-h-screen place-items-center p-4">
    {#if auth === "checking"}<button class="btn" disabled>正在检查登录状态…</button>{:else}<a class="btn btn-primary" href={loginUrl}>GitHub 登录</a>{/if}
  </main>
{:else}
  <header class="navbar sticky top-0 z-40 border-b border-base-300 bg-base-100/95 px-4 backdrop-blur"><div class="flex-1"><button class="btn btn-ghost text-xl" on:click={() => go("list")}>Bangumi Trace</button></div><nav class="flex gap-1" aria-label="主导航">{#if dirty}<button class="btn btn-primary btn-sm" disabled={busy} on:click={save}>保存</button>{/if}<button class="btn btn-ghost btn-sm" on:click={() => go("list")}>列表</button><button class="btn btn-ghost btn-sm" on:click={() => go("settings")}>设置</button><ThemeToggle /></nav></header>
  <main class="mx-auto max-w-3xl p-4 pb-24">
    {#if notice}<div class="alert alert-info mb-4" role="status">{notice}</div>{/if}
    {#if view === "list"}
      <section class="space-y-4"><div><h1 class="text-3xl font-bold">我的番剧</h1><p class="text-base-content/60">按最近观看活动排序。</p></div><div class="join w-full"><input class="input join-item w-full" bind:value={query} placeholder="搜索任意语言标题" aria-label="搜索" /><select class="select join-item" bind:value={status} aria-label="状态"><option value="all">全部</option><option value="planned">计划</option><option value="watching">观看中</option><option value="completed">完成</option><option value="dropped">放弃</option></select></div><form class="join w-full" on:submit|preventDefault={addShow}><input class="input join-item w-full" bind:value={newTitle} placeholder="创建本地作品" aria-label="作品标题" /><button class="btn btn-primary join-item">添加</button></form>
        <div class="grid gap-3 sm:grid-cols-2">{#each shows as show}{@const next = nextVolumeEpisode(data, show)}<article class="card border border-base-300 bg-base-100"><div class="card-body p-4"><div class="flex items-start justify-between gap-2"><button class="text-left text-lg font-semibold hover:text-primary" on:click={() => go(`show/${show.id}`)}>{show.title[0]}</button><span class="badge badge-outline">{show.status}</span></div><p class="truncate text-sm text-base-content/60">{show.title.slice(1).join(" · ") || "仅一个标题"}</p><div class="card-actions justify-end">{#if next}<button class="btn btn-primary btn-sm" on:click={() => quickRecord(show, next.volume)}>已观看 {volumeLabel(show, next.volume)}第 {next.episode} 话</button>{:else}<button class="btn btn-sm" disabled>{show.volumes.length ? "已全部看完" : "请先添加 Volume"}</button>{/if}</div></div></article>{/each}</div>{#if !shows.length}<p class="py-16 text-center text-base-content/50">暂无匹配作品</p>{/if}
      </section>
    {:else if view === "show" && selected}
      <section class="space-y-5"><button class="btn btn-ghost btn-sm" on:click={() => go("list")}>← 返回</button><div class="flex items-start justify-between"><div><h1 class="text-3xl font-bold">{selected.title[0]}</h1><div class="flex flex-wrap items-center gap-2 text-sm text-base-content/60">{#each selected.title.slice(1) as title, index}<button class="hover:text-primary" on:click={() => activeSubtitle = index + 1}>{title}</button>{#if activeSubtitle === index + 1}<button class="btn btn-primary btn-xs" on:click={() => { updateShow(setDefaultTitle(selected!, index + 1)); activeSubtitle = -1 }}>设为默认</button>{/if}{/each}</div><p class="text-base-content/60">{selected.externalRef ? `Bangumi #${selected.externalRef.id}` : "本地作品"}</p></div><select class="select select-sm" value={selected.status} on:change={(e) => updateShow({ ...selected!, status: (e.currentTarget as HTMLSelectElement).value as Status })}><option value="planned">计划</option><option value="watching">观看中</option><option value="completed">完成</option><option value="dropped">放弃</option></select></div>
        <details class="card border border-base-300"><summary class="cursor-pointer p-4 font-semibold">笔记</summary><div class="px-4 pb-4"><textarea class="textarea textarea-bordered min-h-32 w-full" maxlength="2048" placeholder="最多 2048 字" value={selected.note ?? ""} on:change={(event) => updateShow({ ...selected!, note: event.currentTarget.value })}></textarea></div></details>
        <div class="card border border-base-300"><div class="card-body"><h2 class="card-title">Volumes</h2><div class="space-y-2">{#each selected.volumes as volume}{@const next = nextEpisode(data, volume)}<div class="flex flex-wrap items-center gap-2 rounded-lg border border-base-300 p-3"><strong class="min-w-24">{volumeLabel(selected, volume)}</strong><input class="input input-sm w-24" type="number" min="1" value={volume.episodeCount} aria-label={`${volumeLabel(selected, volume)}集数`} on:change={(event) => resizeVolume(volume, Number(event.currentTarget.value))} /><span>话</span><button class="btn btn-primary btn-sm ml-auto" disabled={!next} on:click={() => quickRecord(selected!, volume)}>{next ? `已观看第 ${next} 话` : "已看完"}</button><button class="btn btn-ghost btn-sm text-error" on:click={() => removeVolume(volume)}>删除</button></div>{/each}</div><div class="flex flex-wrap gap-2"><select class="select select-sm" bind:value={volumeType}><option>正剧</option><option>OVA</option><option>SP</option><option>自定义</option></select>{#if volumeType === "自定义"}<input class="input input-sm" bind:value={customVolumeType} placeholder="类型名称" />{/if}<input class="input input-sm w-24" type="number" min="1" bind:value={volumeEpisodes} aria-label="集数" /><button class="btn btn-sm" on:click={addVolume}>添加 Volume</button></div></div></div>
        <div class="card border border-base-300"><div class="card-body"><h2 class="card-title">绑定 Bangumi</h2><div class="join"><input class="input join-item w-full" bind:value={metadataQuery} placeholder="搜索标题" /><button class="btn join-item" on:click={findMetadata}>搜索</button></div>{#each candidates as candidate}<button class="flex items-center gap-3 rounded-lg p-2 text-left hover:bg-base-200" on:click={() => bindMetadata(candidate)}>{#if candidate.images?.small}<img class="h-16 w-12 object-cover" src={candidate.images.small} alt="" />{/if}<span><strong>{candidate.name_cn || candidate.name}</strong><br /><small>{candidate.name} · {candidate.date || "日期未知"}</small></span></button>{/each}</div></div>
        <button class="btn w-full" disabled={!selected.volumes.length} on:click={() => startRecord(selected!)}>自定义补录</button><div><h2 class="mb-2 text-xl font-bold">详细观看历史</h2><div class="space-y-2">{#each events as event}{#each expandedEpisodes(event) as number}<div class="flex items-center rounded-lg border border-base-300 p-3"><span class="flex-1"><strong>{episodeLabel(selected, { ...event, episodes: { ...event.episodes, from: number, to: number } })}</strong><br /><small>{displayDate(event)}</small></span>{#if number === event.episodes.from}<button class="btn btn-ghost btn-sm" on:click={() => startRecord(selected!, event)}>修改</button><button class="btn btn-ghost btn-sm text-error" on:click={() => removeEvent(event.id)}>删除</button>{/if}</div>{/each}{/each}{#if !events.length}<p class="text-base-content/60">尚无观看记录</p>{/if}</div></div><button class="btn btn-error btn-outline" on:click={() => removeShow(selected!)}>删除作品</button>
      </section>
    {:else if view === "record" && selected}
      <section class="space-y-5"><button class="btn btn-ghost btn-sm" on:click={() => go(`show/${selected!.id}`)}>← 返回</button><h1 class="text-3xl font-bold">补录 · {selected.title[0]}</h1><label class="form-control"><span class="label-text">Volume</span><select class="select select-bordered" bind:value={volumeId}>{#each selected.volumes as volume}<option value={volume.id}>{volumeLabel(selected, volume)}</option>{/each}</select></label><div class="grid grid-cols-2 gap-2"><label class="form-control"><span class="label-text">从第几话</span><input class="input input-bordered" type="number" min="1" bind:value={episodeFrom} /></label><label class="form-control"><span class="label-text">到第几话</span><input class="input input-bordered" type="number" min="1" bind:value={episodeTo} /></label></div><label class="form-control"><span class="label-text">观看时间精度</span><select class="select select-bordered" bind:value={precision}><option value="exact">精确</option><option value="day">精确到日</option><option value="month">精确到月</option><option value="year">精确到年</option><option value="unknown">未知</option></select></label>{#if precision === "exact"}<input class="input input-bordered w-full" type="datetime-local" bind:value={watchedValue} />{:else if precision === "day"}<input class="input input-bordered w-full" type="date" bind:value={watchedValue} />{:else if precision === "month"}<input class="input input-bordered w-full" type="month" bind:value={watchedValue} />{:else if precision === "year"}<input class="input input-bordered w-full" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="年份，如 2026" bind:value={watchedValue} />{/if}<button class="btn btn-primary w-full" on:click={record}>{editingEventId ? "更新本地草稿" : "加入本地草稿"}</button></section>
    {:else if view === "settings"}
      <section class="space-y-6"><h1 class="text-3xl font-bold">设置与导入</h1><div class="card border border-base-300"><div class="card-body"><h2 class="card-title">GitHub 数据</h2><p>已登录 · {sha ? `SHA ${sha.slice(0, 8)}` : "远端文件尚未创建"}</p><div class="card-actions"><button class="btn btn-warning" disabled={busy} on:click={() => sync(true)}>强制从 GitHub 覆盖本地</button><button class="btn btn-primary" disabled={!dirty || busy} on:click={save}>保存到 GitHub</button><button class="btn btn-ghost" on:click={async () => { await logout(); auth = "unauthenticated" }}>退出</button></div></div></div><div class="card border border-base-300"><div class="card-body"><h2 class="card-title">本地迁移</h2><p>文件只在当前浏览器读取；先导入当前状态，再导入历史。</p><input class="file-input file-input-bordered" type="file" accept="application/json,.json" aria-label="选择迁移 JSON" on:change={(e) => { const file = e.currentTarget.files?.[0]; if (file) importFile(file) }} /><div class="card-actions"><button class="btn btn-sm" on:click={downloadBackup}>下载当前备份</button><button class="btn btn-sm" disabled={!importBackup} on:click={undoImport}>撤销最近导入</button></div></div></div></section>
    {:else}<div class="py-16 text-center"><p>页面或作品不存在</p><button class="btn mt-4" on:click={() => go("list")}>返回列表</button></div>{/if}
  </main>
{/if}
