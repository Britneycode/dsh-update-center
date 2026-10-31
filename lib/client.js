window.__ModuleLoader__.load({
	id: "dsh-update-center",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		// src/client/index.tsx
		/**
		* dsh-update-center 设置页面板（桌面端）。
		*
		* 与桌面端设置界面同一套设计系统：
		*
		*  1. 控件来自宿主基线模块 `@deepseek-ai/dsh-client-ui-primitives`（shell 的
		*     PLATFORM_MODULES 静态表）。桌面端设置页用的就是同一批 Button / Pill /
		*     RiskConfirmation / Toast，因此桌面端改版时面板跟着变；
		*  2. 颜色只走 `--dsw-*` 语义令牌，跟随亮/暗主题；
		*  3. 不可逆操作（卸载、重启、批量更新、安装）走 `RiskConfirmation`
		*     模态 + 勾选确认，不再用 window.confirm；
		*  4. 排版沿用设置页标尺：页标题 16/24、行标题 14/20、行说明 12/18。
		*
		* 面板分两栏视图：已安装插件与插件市场。市场数据来自
		* awesome-dsh-plugin.com 清单（服务端白名单拉取，本地快照兜底）。
		*/
		const inject = ["slots"];
		const API = "/update-center/api";
		const MARKET_PAGE_SIZE = 500;
		const DEFAULT_TIMEOUT_MS = 3e4;
		const css = `
.uc{display:flex;flex-direction:column;width:min(100%,920px);min-width:0;padding:8px 4px 24px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}
.uc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:4px 0 16px}
.uc-title{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}
.uc-desc{color:var(--dsw-alias-label-tertiary);margin:6px 0 0;font-size:12px;line-height:18px}
.uc-toolbar{display:flex;align-items:center;gap:8px;flex:none;flex-wrap:wrap}
.uc-body{padding-top:4px}
.uc-section{padding:16px 0;border-top:.5px solid var(--dsw-alias-border-l2)}
.uc-section:first-child{border-top:none;padding-top:8px}
.uc-section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
.uc-section-title{font-size:14px;line-height:20px;font-weight:500;margin:0}
.uc-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.uc-row:last-child{border-bottom:none}
.uc-row-text{min-width:0}
.uc-row-title{font-size:14px;line-height:20px}
.uc-row-desc{color:var(--dsw-alias-label-secondary);margin-top:4px;font-size:12px;line-height:18px}
.uc-row-action{flex:none;display:flex;align-items:center;gap:8px}
.uc-list{list-style:none;margin:0;padding:0}
.uc-item{display:grid;grid-template-columns:minmax(220px,1fr) auto auto;gap:16px;align-items:center;padding:14px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.uc-item>*{min-width:0}
.uc-item:last-child{border-bottom:none}
.uc-name{font-weight:600;font-size:13px;overflow-wrap:anywhere}
.uc-name a{color:var(--dsw-alias-link);text-decoration:none}
.uc-name a:hover{text-decoration:underline}
.uc-desc{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin-top:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.uc-tags{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px}
.uc-path{color:var(--dsw-alias-label-tertiary);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:420px}
.uc-status{display:flex;gap:6px;align-items:center;justify-content:flex-end;flex-wrap:wrap}
.uc-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.uc-meta{color:var(--dsw-alias-label-tertiary);font-size:12px}
.uc-msg{margin-top:14px;padding:10px 12px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;white-space:pre-wrap;max-height:260px;overflow:auto}
.uc-msg.err{color:var(--dsw-alias-label-error)}
.uc-msg.ok{color:var(--dsw-alias-state-success-primary)}
.uc-market-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.uc-market-meta{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px;margin-top:8px}
.uc-empty{padding:14px 0;color:var(--dsw-alias-label-tertiary);font-size:12px}
@media(max-width:680px){
  .uc-item{grid-template-columns:1fr}
  .uc-status,.uc-actions{justify-content:flex-start}
  .uc-path{max-width:100%}
}
`;
		function ensureStyle() {
			if (typeof document === "undefined") return;
			const id = "dsh-update-center/panel.css";
			if (document.querySelector(`style[data-plugin-css="${id}"]`) !== null) return;
			const tag = document.createElement("style");
			tag.dataset.pluginCss = id;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		/** 带超时的 API 请求：所有请求都有明确上限，弱网下不会永久停在“检查中”。 */
		async function fetchJson(path, init, timeoutMs = DEFAULT_TIMEOUT_MS) {
			const controller = new AbortController();
			const timer = window.setTimeout(() => controller.abort(), timeoutMs);
			try {
				const response = await fetch(API + path, {
					headers: { "content-type": "application/json" },
					...init,
					signal: controller.signal
				});
				const data = await response.json().catch(() => ({
					ok: false,
					error: `HTTP ${response.status}`
				}));
				if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
				return data;
			} catch (error) {
				if (controller.signal.aborted) throw new Error(`请求超时（${Math.round(timeoutMs / 1e3)}s），可稍后重试；POST 动作可能已在后台生效，刷新状态可确认`);
				throw error;
			} finally {
				window.clearTimeout(timer);
			}
		}
		function reason(error) {
			return String(error instanceof Error ? error.message : error);
		}
		function pluginUpdatable(plugin) {
			const git = plugin?.git ?? {};
			if (plugin?.kind === "npm") return Boolean(plugin?.latest) && plugin.latest !== plugin.version;
			return Number(git.behind ?? 0) > 0;
		}
		function jobText(job) {
			const lines = [String(job?.message || "更新任务")];
			if (Array.isArray(job?.steps)) lines.push(...job.steps.map(String));
			if (job?.error) lines.push(String(job.error));
			return lines.filter(Boolean).join("\n");
		}
		function safeHref(url) {
			try {
				const parsed = new URL(url);
				return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
			} catch {
				return null;
			}
		}
		/** 用检查数据补全 /status 缺失的远端信息，避免轻量动作后丢失“可更新”徽章。 */
		function mergeStatusAfterJob(fresh, checkData, updatedTargets) {
			const checkPlugins = Array.isArray(checkData?.plugins) ? checkData.plugins : [];
			const checkByName = new Map(checkPlugins.map((plugin) => [String(plugin.name), plugin]));
			const plugins = (Array.isArray(fresh?.plugins) ? fresh.plugins : []).map((plugin) => {
				const check = checkByName.get(String(plugin.name));
				if (!check) return plugin;
				const merged = { ...plugin };
				if (updatedTargets.has(String(plugin.name))) {
					merged.latest = plugin.version;
					merged.git = {
						...plugin.git ?? {},
						behind: 0
					};
					return merged;
				}
				if (check.latest !== void 0) merged.latest = check.latest;
				if (check.git && typeof check.git.behind === "number") merged.git = {
					...plugin.git ?? {},
					behind: check.git.behind
				};
				return merged;
			});
			return {
				...fresh,
				plugins
			};
		}
		function UpdateCenterPanel() {
			(0, react.useEffect)(() => {
				ensureStyle();
			}, []);
			const [tab, setTab] = (0, react.useState)("installed");
			const [status, setStatus] = (0, react.useState)(null);
			const [checkData, setCheckData] = (0, react.useState)(null);
			const [checked, setChecked] = (0, react.useState)(false);
			const [market, setMarket] = (0, react.useState)(null);
			const [query, setQuery] = (0, react.useState)("");
			const [category, setCategory] = (0, react.useState)("");
			const [sort, setSort] = (0, react.useState)("stars");
			const [visibleLimit, setVisibleLimit] = (0, react.useState)(MARKET_PAGE_SIZE);
			const [busy, setBusy] = (0, react.useState)(false);
			const [message, setMessage] = (0, react.useState)(null);
			const [toast, setToast] = (0, react.useState)(null);
			const [pending, setPending] = (0, react.useState)(null);
			const [acknowledged, setAcknowledged] = (0, react.useState)(false);
			const alive = (0, react.useRef)(true);
			const pollTimer = (0, react.useRef)(0);
			const activeJob = (0, react.useRef)("");
			(0, react.useEffect)(() => {
				alive.current = true;
				return () => {
					alive.current = false;
					window.clearTimeout(pollTimer.current);
				};
			}, []);
			const say = (0, react.useCallback)((text, tone = "info") => {
				setMessage(text === "" ? null : {
					text,
					tone
				});
			}, []);
			const notify = (0, react.useCallback)((text, tone) => {
				setToast({
					key: Date.now(),
					text,
					tone
				});
			}, []);
			const applyStatus = (0, react.useCallback)((data, withCheck) => {
				setStatus(data);
				if (withCheck === false) return;
				if (checked && checkData) setStatus(mergeStatusAfterJob(data, checkData, /* @__PURE__ */ new Set()));
			}, [checked, checkData]);
			const refreshStatus = (0, react.useCallback)(async (fresh = false) => {
				try {
					const data = await fetchJson(fresh ? "/status?fresh=1" : "/status");
					if (!data?.ok) throw new Error(data?.error || "状态读取失败");
					applyStatus(data, true);
					return data;
				} catch (error) {
					say("状态读取失败：" + reason(error), "err");
					return null;
				}
			}, [applyStatus, say]);
			const loadMarket = (0, react.useCallback)(async (force, silent) => {
				if (force) setBusy(true);
				if (!silent) say("正在加载插件市场清单…", "info");
				try {
					const data = await fetchJson(force ? "/market/refresh" : "/market", force ? { method: "POST" } : void 0, force ? 9e4 : void 0);
					if (!data?.ok) throw new Error(data?.error || "清单加载失败");
					setMarket(data);
					setVisibleLimit(MARKET_PAGE_SIZE);
					if (!silent) say("", "info");
					return data;
				} catch (error) {
					if (!silent) say("市场清单加载失败：" + reason(error), "err");
					return null;
				} finally {
					if (force) setBusy(false);
				}
			}, [say]);
			const pollJob = (0, react.useCallback)(async (id, failures = 0) => {
				activeJob.current = id;
				try {
					const job = (await fetchJson("/job?id=" + encodeURIComponent(id)))?.job;
					if (!job) throw new Error("更新任务不存在");
					if (job.status === "queued" || job.status === "running") {
						say(jobText(job), "info");
						if (alive.current) pollTimer.current = window.setTimeout(() => {
							pollJob(id);
						}, 1e3);
						return;
					}
					activeJob.current = "";
					const updatedTargets = /* @__PURE__ */ new Set();
					if (job.status === "completed") {
						if (Array.isArray(job.results)) {
							for (const entry of job.results) if (entry?.ok) updatedTargets.add(String(entry.target));
						} else if ((job.action === "npm" || job.action === "link") && job.target) updatedTargets.add(String(job.target));
					}
					try {
						const fresh = await fetchJson("/status?fresh=1");
						if (!fresh?.ok) throw new Error(fresh?.error || "状态读取失败");
						let merged = fresh;
						if (checked && checkData) {
							merged = mergeStatusAfterJob(fresh, checkData, updatedTargets);
							setCheckData(merged);
						}
						setStatus(merged);
					} catch (error) {
						say(jobText(job) + `\n\n（列表状态刷新失败：${reason(error)}，可稍后点“检查更新”重新获取。）`, "info");
						return;
					} finally {
						setBusy(false);
					}
					loadMarket(false, true);
					if (job.status === "completed") {
						const suffix = job.restartRequired ? "\n\n更新已核验完成，现在可以重启 dsh web。" : "";
						say(jobText(job) + suffix, "ok");
					} else say(jobText(job), "err");
				} catch (error) {
					if (!alive.current) return;
					if (failures >= 20) {
						activeJob.current = "";
						setBusy(false);
						say(`更新进度连续 ${failures} 次读取失败，已停止轮询：${reason(error)}\n任务状态保存在磁盘上，稍后刷新面板即可查看结果。`, "err");
						return;
					}
					say("暂时无法读取更新进度，dsh 重启后会从磁盘恢复任务状态：" + reason(error), "info");
					pollTimer.current = window.setTimeout(() => {
						pollJob(id, failures + 1);
					}, 1500);
				}
			}, [
				checked,
				checkData,
				loadMarket,
				say
			]);
			const attachJob = (0, react.useCallback)((job) => {
				if (!job?.id || activeJob.current === job.id) return;
				if (job.status === "queued" || job.status === "running") {
					setBusy(true);
					pollJob(String(job.id));
				}
			}, [pollJob]);
			const runAction = (0, react.useCallback)(async (path, body, startingNote, timeoutMs = DEFAULT_TIMEOUT_MS) => {
				setBusy(true);
				say(startingNote, "info");
				try {
					const data = await fetchJson(path, {
						method: "POST",
						body: JSON.stringify(body)
					}, timeoutMs);
					if (!data?.ok) throw new Error(data?.result || data?.error || "操作失败");
					const id = String(data?.job?.id || "");
					if (!id) {
						setBusy(false);
						notify(String(data?.result || "操作成功"), "success");
						await refreshStatus(true);
						if (market) loadMarket(false, true);
						return;
					}
					pollJob(id);
				} catch (error) {
					setBusy(false);
					say("请求失败：" + reason(error), "err");
				}
			}, [
				loadMarket,
				market,
				notify,
				pollJob,
				refreshStatus,
				say
			]);
			const booted = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				if (booted.current) return;
				booted.current = true;
				(async () => {
					const data = await refreshStatus(false);
					if (data?.job) attachJob(data.job);
				})();
			}, [attachJob, refreshStatus]);
			const askConfirm = (0, react.useCallback)((next) => {
				setAcknowledged(false);
				setPending(next);
			}, []);
			const checkUpdate = (0, react.useCallback)(async () => {
				setBusy(true);
				say("正在检查 dsh 和插件的远端状态…", "info");
				try {
					const data = await fetchJson("/check", {
						method: "POST",
						body: "{}"
					}, 24e4);
					if (!data?.ok) throw new Error(data?.error || "检查失败");
					setChecked(true);
					setCheckData(data);
					setStatus(data);
					const total = Number(data?.summary?.totalUpdates ?? 0);
					const failed = Number(data?.summary?.failedChecks ?? 0);
					if (failed > 0) say(`检查完成，发现 ${total} 项可更新，另有 ${failed} 项检查失败。`, "err");
					else say(total > 0 ? `检查完成，发现 ${total} 项可更新。` : "检查完成，当前全部为最新。", total > 0 ? "info" : "ok");
				} catch (error) {
					say("检查失败：" + reason(error), "err");
				} finally {
					setBusy(false);
				}
			}, [say]);
			const restart = (0, react.useCallback)(() => {
				const job = status?.job ?? {};
				if (job.status === "queued" || job.status === "running") {
					say("有更新任务正在执行，请等待任务完成后再重启（重启会中断后台任务）。", "err");
					return;
				}
				askConfirm({
					title: "重启 dsh web",
					description: "重启后当前会话会中断。更新完成后新进程才会加载新产物，重启期间面板不可用，恢复后页面会自动刷新。",
					acknowledgeLabel: "我了解当前会话将中断",
					confirmLabel: "重启",
					run: () => {
						(async () => {
							setBusy(true);
							say("正在下发重启指令…", "info");
							try {
								const data = await fetchJson("/restart", {
									method: "POST",
									body: "{}"
								});
								if (!data?.ok) throw new Error(data?.result || data?.error || "重启失败");
								say("重启指令已下发，dsh 即将重启；恢复后面板会自动刷新。", "info");
								waitForRestart();
							} catch (error) {
								setBusy(false);
								say("重启请求失败：" + reason(error), "err");
							}
						})();
					}
				});
			}, [
				askConfirm,
				say,
				status
			]);
			/** 重启下发后等待服务恢复：先失败（旧进程已停）再成功（新进程就绪），然后刷新页面。 */
			const waitForRestart = (0, react.useCallback)(() => {
				const deadline = Date.now() + 18e4;
				let sawDown = false;
				const tick = () => {
					if (!alive.current) return;
					if (Date.now() > deadline) {
						setBusy(false);
						say("等待 dsh 重启超时。请手动刷新页面；若一直打不开，可查看 ~/.dsh/update-center/dsh-web.stderr.log 或用 Start-DSH 启动并查看控制台输出。", "err");
						return;
					}
					fetchJson("/status").then(() => {
						if (sawDown) {
							say("dsh 已重启完成，正在刷新页面…", "ok");
							window.location.reload();
							return;
						}
						pollTimer.current = window.setTimeout(tick, 1e3);
					}).catch(() => {
						sawDown = true;
						pollTimer.current = window.setTimeout(tick, 2e3);
					});
				};
				pollTimer.current = window.setTimeout(tick, 1500);
			}, [say]);
			const render = status;
			const plugins = Array.isArray(render?.plugins) ? render.plugins : [];
			const jobRunning = render?.job?.status === "queued" || render?.job?.status === "running";
			const summaryText = jobRunning ? `后台更新中 · ${String(render?.job?.message || render?.job?.stage || "")}` : !checked ? "本地状态已载入，点击“检查更新”获取远端状态" : (() => {
				const total = Number(render?.summary?.totalUpdates ?? 0);
				const time = render?.ts ? new Date(render.ts).toLocaleTimeString([], {
					hour: "2-digit",
					minute: "2-digit"
				}) : "";
				return total > 0 ? `发现 ${total} 项可更新 · ${time}` : `全部为最新 · ${time}`;
			})();
			const marketView = (0, react.useMemo)(() => {
				if (!market) return null;
				const entries = Array.isArray(market.plugins) ? market.plugins : [];
				const installedSet = new Set((Array.isArray(market.installed) ? market.installed : []).map(String));
				const q = query.trim().toLowerCase();
				const filtered = entries.filter((entry) => {
					if (category && entry.category !== category) return false;
					if (!q) return true;
					return [
						entry.name,
						entry.owner,
						entry.npm,
						entry.description?.zh,
						entry.description?.en
					].filter(Boolean).join(" ").toLowerCase().includes(q);
				});
				if (sort === "stars") filtered.sort((a, b) => Number(b.stars ?? 0) - Number(a.stars ?? 0));
				else if (sort === "added") filtered.sort((a, b) => (Date.parse(String(b.added ?? "")) || 0) - (Date.parse(String(a.added ?? "")) || 0));
				return {
					entries,
					installedSet,
					filtered
				};
			}, [
				market,
				query,
				category,
				sort
			]);
			(0, react.useEffect)(() => {
				if (tab === "market" && !market) loadMarket(false, false);
			}, [
				tab,
				market,
				loadMarket
			]);
			const marketEntryFor = (0, react.useCallback)((name) => {
				return (Array.isArray(market?.plugins) ? market.plugins : []).find((entry) => entry.name === name || entry.npm === name) ?? null;
			}, [market]);
			const uninstall = (0, react.useCallback)((name) => {
				askConfirm({
					title: `卸载 ${name}`,
					description: `将从 profile 卸载 ${name}：执行 pnpm remove 并移出 bundles。已禁用状态会一并清理。任务完成后再重启 dsh web。`,
					acknowledgeLabel: "我了解该插件将从 profile 移除",
					confirmLabel: "卸载",
					run: () => {
						runAction("/uninstall", { name }, "正在创建后台卸载任务…");
					}
				});
			}, [askConfirm, runAction]);
			const badge = (text, tone) => {
				const icon = tone === "ok" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutlineRegular, { size: 12 }) : tone === "warn" || tone === "err" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 12 }) : void 0;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: `uc-meta uc-badge-${tone}`,
					style: {
						display: "inline-flex",
						alignItems: "center",
						gap: 4
					},
					children: [icon, text]
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "uc",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "uc-head",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							className: "uc-title",
							children: "更新中心"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "uc-desc",
							children: summaryText
						})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "uc-toolbar",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "outline",
									icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 16 }),
									disabled: busy,
									onClick: checkUpdate,
									children: "检查更新"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "primary",
									icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDownloadOutlineRegular, { size: 16 }),
									disabled: busy || jobRunning,
									title: jobRunning ? "有更新任务正在执行，请等待完成后再批量更新" : "先检查远端，再一键更新所有可更新的插件",
									onClick: () => askConfirm({
										title: "批量更新插件",
										description: "将先自动检查远端更新，再把所有可更新的插件排成一个后台批量任务串行执行，单个失败不影响其余。检查可能需要十几秒。任务完成后再重启 dsh web。",
										acknowledgeLabel: "我了解更新完成后仍需重启 dsh web",
										confirmLabel: "开始更新",
										run: () => {
											runAction("/update-all", {}, "正在检查并创建批量更新任务，可能需要十几秒…", 3e5);
										}
									}),
									children: "全部更新"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "outline",
									disabled: busy || jobRunning,
									title: jobRunning ? "有更新任务正在执行，请等待完成后再重启" : "更新完成后一键重启 dsh web（当前会话会中断）",
									onClick: restart,
									children: "重启 dsh"
								})
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SegmentedTabs, {
						items: [{
							value: "installed",
							label: "已安装"
						}, {
							value: "market",
							label: "插件市场"
						}],
						value: tab,
						label: "更新中心视图",
						onChange: (value) => setTab(value === "market" ? "market" : "installed")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "uc-body",
						children: [tab === "installed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: "uc-section",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "uc-section-head",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									className: "uc-section-title",
									children: "已安装插件"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "uc-meta",
									children: [plugins.length, " 个"]
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ul", {
								className: "uc-list",
								children: [plugins.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
									className: "uc-empty",
									children: "当前 profile 没有外部插件，去“插件市场”看看？"
								}) : null, plugins.map((plugin) => {
									const kind = plugin.kind === "preset" ? "preset" : plugin.kind === "link" ? "link" : "npm";
									const pgit = plugin.git ?? {};
									const entry = marketEntryFor(String(plugin.name));
									const description = entry?.description?.zh || entry?.description?.en;
									const blocked = (kind === "link" || kind === "preset") && pgit.dirty;
									const updatable = pluginUpdatable(plugin);
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
										className: "uc-item",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													className: "uc-name",
													children: String(plugin.name)
												}),
												description ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													className: "uc-desc",
													children: String(description)
												}) : null,
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "uc-tags",
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "uc-meta",
															children: kind
														}),
														plugin.bundled ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "uc-meta",
															children: "bundle"
														}) : null,
														plugin.upstream && String(plugin.upstream).includes("/") ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
															className: "uc-meta",
															style: { color: "var(--dsw-alias-link)" },
															href: safeHref(`https://github.com/${plugin.upstream}`) ?? "#",
															target: "_blank",
															rel: "noreferrer",
															children: String(plugin.upstream)
														}) : plugin.upstream ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "uc-meta",
															children: String(plugin.upstream)
														}) : null,
														plugin.linkDir ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "uc-path",
															title: String(plugin.linkDir),
															children: String(plugin.linkDir)
														}) : null
													]
												})
											] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "uc-status",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "uc-meta",
														children: plugin.version ? `v${plugin.version}` : "版本未知"
													}),
													plugin.disabled ? badge("已禁用", "muted") : null,
													(kind === "link" || kind === "preset") && pgit.dirty ? badge("有未提交改动", "warn") : (kind === "link" || kind === "preset") && checked && pgit.fetchOk === false ? badge("检查失败", "err") : checked && kind === "npm" && updatable ? badge(`可更新至 ${plugin.latest}`, "update") : checked && (kind === "link" || kind === "preset") && updatable ? badge(`落后 ${pgit.behind}`, "update") : checked && (kind === "npm" && plugin.latest || typeof pgit.behind === "number") ? badge("已是最新", "ok") : !plugin.disabled ? badge("未检查", "muted") : null
												]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "uc-actions",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
													variant: "outline",
													size: "sm",
													disabled: !checked || blocked || !updatable,
													onClick: () => askConfirm({
														title: `更新 ${plugin.name}`,
														description: kind === "npm" ? `后台更新 ${plugin.name} 到最新版，并核对实际安装版本。任务完成后再重启 dsh web。` : `后台更新本地插件 ${plugin.name}；若只更新源码，会自动重新构建运行产物。`,
														acknowledgeLabel: "我了解更新完成后需要重启 dsh web",
														confirmLabel: "更新",
														run: () => {
															kind === "npm" ? runAction("/update-npm", { name: plugin.name }, "正在创建后台更新任务…") : runAction("/update-link", { name: plugin.name }, "正在创建后台更新任务…");
														}
													}),
													children: "更新"
												}), kind === "npm" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
													variant: "outline",
													size: "sm",
													onClick: () => askConfirm({
														title: plugin.disabled ? `启用 ${plugin.name}` : `禁用 ${plugin.name}`,
														description: plugin.disabled ? `恢复启用 ${plugin.name}？重启 dsh web 后生效。` : `禁用 ${plugin.name}？只是写入配置不卸载，重启 dsh web 后生效。`,
														acknowledgeLabel: "我了解需要重启 dsh web 才生效",
														confirmLabel: plugin.disabled ? "启用" : "禁用",
														run: () => {
															runAction(plugin.disabled ? "/enable" : "/disable", { name: plugin.name }, "正在更新配置…");
														}
													}),
													children: plugin.disabled ? "启用" : "禁用"
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
													variant: "outline",
													size: "sm",
													icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutlineRegular, { size: 14 }),
													onClick: () => uninstall(String(plugin.name)),
													children: "卸载"
												})] }) : null]
											})
										]
									}, String(plugin.name));
								})]
							})]
						}) }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: "uc-section",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "uc-market-head",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "search",
										placeholder: "搜索插件名 / 作者 / 描述…",
										value: query,
										onChange: (event) => {
											setQuery(event.target.value);
											setVisibleLimit(MARKET_PAGE_SIZE);
										},
										style: {
											flex: "1 1 240px",
											minWidth: 0,
											minHeight: 32,
											border: ".5px solid var(--dsw-alias-border-l2)",
											borderRadius: "var(--dsw-radius-sm)",
											background: "var(--dsw-alias-bg-layer-2)",
											color: "var(--dsw-alias-label-primary)",
											font: "inherit",
											fontSize: 12,
											padding: "6px 10px"
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
										value: category,
										onChange: (event) => {
											setCategory(event.target.value);
											setVisibleLimit(MARKET_PAGE_SIZE);
										},
										style: {
											minHeight: 32,
											border: ".5px solid var(--dsw-alias-border-l2)",
											borderRadius: "var(--dsw-radius-sm)",
											background: "var(--dsw-alias-bg-layer-2)",
											color: "var(--dsw-alias-label-primary)",
											font: "inherit",
											fontSize: 12,
											padding: "6px 10px"
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "",
											children: "全部分类"
										}), Object.entries(market?.categories ?? {}).map(([key, label]) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: key,
											children: String(label?.zh || label?.en || key)
										}, key))]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
										value: sort,
										onChange: (event) => {
											setSort(event.target.value);
											setVisibleLimit(MARKET_PAGE_SIZE);
										},
										style: {
											minHeight: 32,
											border: ".5px solid var(--dsw-alias-border-l2)",
											borderRadius: "var(--dsw-radius-sm)",
											background: "var(--dsw-alias-bg-layer-2)",
											color: "var(--dsw-alias-label-primary)",
											font: "inherit",
											fontSize: 12,
											padding: "6px 10px"
										},
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "stars",
												children: "星标最多"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "default",
												children: "默认顺序"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "added",
												children: "最近添加"
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "outline",
										icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 14 }),
										disabled: busy,
										onClick: () => void loadMarket(true, false),
										children: "刷新清单"
									})
								]
							}), marketView === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "uc-empty",
								children: "清单尚未加载"
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "uc-market-meta",
								children: (() => {
									const sourceLabel = {
										registry: "本仓库 plugins.json",
										github: "GitHub topic:dsh-plugin",
										disk: "本地缓存",
										snapshot: "内置快照",
										network: "网络"
									}[String(market?.source)] ?? String(market?.source);
									const visibleCount = Math.min(marketView.filtered.length, visibleLimit);
									return `来源：${sourceLabel} · 扫描于 ${String(market?.updated || "未知")} · 共 ${marketView.entries.length} 个，筛选出 ${marketView.filtered.length} 个 · 已显示 ${visibleCount} 个`;
								})()
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ul", {
								className: "uc-list",
								children: [
									marketView.filtered.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
										className: "uc-empty",
										children: "没有匹配的插件"
									}) : null,
									marketView.filtered.slice(0, visibleLimit).map((entry) => {
										const installed = marketView.installedSet.has(String(entry.name)) || entry.npm && marketView.installedSet.has(String(entry.npm));
										const statusPlugin = plugins.find((plugin) => plugin.name === entry.npm || plugin.name === entry.name);
										const updatable = statusPlugin ? pluginUpdatable(statusPlugin) : false;
										const catLabel = entry.category ? market?.categories?.[entry.category] : null;
										const guideHref = safeHref(String(entry.url));
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
											className: "uc-item",
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: "uc-name",
														children: entry.url ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
															href: guideHref ?? "#",
															target: "_blank",
															rel: "noreferrer",
															children: String(entry.name)
														}) : String(entry.name)
													}),
													entry.description?.zh || entry.description?.en ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: "uc-desc",
														children: String(entry.description.zh || entry.description.en)
													}) : null,
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "uc-tags",
														children: [
															catLabel ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																type: "button",
																title: "按此分类筛选",
																onClick: () => {
																	setCategory(String(entry.category));
																	setVisibleLimit(MARKET_PAGE_SIZE);
																},
																style: {
																	border: "none",
																	background: "var(--dsw-alias-bg-multi-select)",
																	color: "var(--dsw-alias-label-secondary)",
																	font: "inherit",
																	fontSize: 11,
																	borderRadius: 4,
																	padding: "1px 7px",
																	cursor: "pointer"
																},
																children: String(catLabel?.zh || catLabel?.en || entry.category)
															}) : null,
															entry.owner ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																className: "uc-meta",
																children: String(entry.owner)
															}) : null,
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																className: "uc-meta",
																children: entry.installMode === "manual" ? "套装" : entry.npm ? "npm" : "github"
															})
														]
													})
												] }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "uc-status",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "uc-meta",
														children: Number(entry.stars ?? 0) > 0 ? `★ ${entry.stars}` : "暂无星标"
													}), entry.installMode === "manual" ? badge("手动安装", "muted") : installed ? updatable ? badge("可更新", "update") : badge("已安装", "ok") : null]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													className: "uc-actions",
													children: entry.installMode === "manual" ? guideHref ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
														variant: "outline",
														size: "sm",
														icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconLinkOutlineRegular, { size: 14 }),
														onClick: () => window.open(guideHref, "_blank", "noreferrer"),
														children: "安装说明"
													}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "uc-meta",
														children: "项目页面链接不可用"
													}) : installed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
														variant: "outline",
														size: "sm",
														icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutlineRegular, { size: 14 }),
														onClick: () => uninstall(String(entry.npm || entry.name)),
														children: "卸载"
													}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
														variant: "primary",
														size: "sm",
														icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCordisPluginOutlineRegular, { size: 14 }),
														onClick: () => askConfirm({
															title: `安装 ${entry.name}`,
															description: `在后台安装 ${entry.name}（优先 npm，来源不一致时回退 GitHub）。安装完成后需要重启 dsh web。`,
															acknowledgeLabel: "我了解安装完成后需要重启 dsh web",
															confirmLabel: "安装",
															run: () => {
																runAction("/install", { name: entry.name }, "正在创建后台安装任务…");
															}
														}),
														children: "安装"
													})
												})
											]
										}, String(entry.name));
									}),
									marketView.filtered.length > visibleLimit ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
										className: "uc-empty",
										style: { textAlign: "center" },
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											variant: "outline",
											size: "sm",
											onClick: () => setVisibleLimit(visibleLimit + MARKET_PAGE_SIZE),
											children: `显示更多（剩余 ${marketView.filtered.length - visibleLimit} 个）`
										})
									}) : null
								]
							})] })]
						}), message === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: `uc-msg ${message.tone === "err" ? "err" : message.tone === "ok" ? "ok" : ""}`,
							role: "alert",
							children: message.text
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.RiskConfirmation, {
						open: pending !== null,
						title: pending?.title ?? "",
						description: pending?.description ?? "",
						acknowledgeLabel: pending?.acknowledgeLabel ?? "",
						cancelLabel: "取消",
						closeLabel: "关闭",
						confirmLabel: pending?.confirmLabel ?? "确认",
						acknowledged,
						disabled: busy,
						onAcknowledgedChange: setAcknowledged,
						onCancel: () => {
							setAcknowledged(false);
							setPending(null);
						},
						onConfirm: () => {
							const run = pending?.run;
							setAcknowledged(false);
							setPending(null);
							if (run) run();
						}
					}),
					toast === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
						text: toast.text,
						...toast.tone === void 0 ? {} : { tone: toast.tone },
						onDone: () => {
							setToast(null);
						}
					}, toast.key)
				]
			});
		}
		function apply(ctx) {
			ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "update-center",
				order: 60,
				label: () => "更新中心"
			}, UpdateCenterPanel)), "dsh-update-center: panel");
		}
		exports.UpdateCenterPanel = UpdateCenterPanel;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map