/**
 * 聊天窗样式表（设计系统 v2）。
 *
 * 令牌分层：
 *   1) 结构色全部映射宿主主题 --dsw-alias-*，跟随 DSH 深浅色；
 *   2) 品牌色 --lim-accent 固定 #0891B2，只出现在「主操作 / 选中 / 未读」三处，
 *      面积不超过 10%（A1/A5）；
 *   3) 语义色只做点缀：在线绿、错误红，都是 50 阶浅底 + 700 阶字（C2）。
 *
 * 间距 4pt 网格（4/8/12/16/24），圆角 8/10/14 三档，阴影只用一档软阴影（C4）。
 */
export const CSS = `
.lim-window{
  --lim-bg:var(--dsw-alias-bg-layer-1,#1f1f21);
  --lim-surface:var(--dsw-alias-bg-layer-2,#262628);
  --lim-sidebar:color-mix(in srgb,var(--dsw-alias-bg-base,#151517) 55%,var(--dsw-alias-bg-layer-1,#1f1f21));
  --lim-fg:var(--dsw-alias-label-primary,#f2f3f5);
  --lim-muted:var(--dsw-alias-label-secondary,#a8adb4);
  --lim-faint:color-mix(in srgb,var(--dsw-alias-label-secondary,#a8adb4) 62%,transparent);
  --lim-border:var(--dsw-alias-border-l1,rgba(255,255,255,.08));
  --lim-hover:color-mix(in srgb,var(--dsw-alias-label-primary,#fff) 7%,transparent);
  --lim-accent:#0891B2;
  --lim-accent-solid:#0E7490;
  --lim-accent-weak:color-mix(in srgb,#0891B2 16%,transparent);
  --lim-on-accent:#ffffff;
  --lim-danger:var(--dsw-alias-state-error-primary,#f25a5a);
  --lim-ok:var(--dsw-alias-state-success-primary,#22c55e);
  position:fixed;z-index:2147483000;width:460px;max-width:calc(100vw - 16px);height:600px;max-height:calc(100vh - 16px);
  display:flex;flex-direction:column;background:var(--lim-bg);color:var(--lim-fg);
  border:1px solid var(--lim-border);border-radius:14px;overflow:hidden;
  box-shadow:0 24px 64px rgba(0,0,0,.38),0 2px 8px rgba(0,0,0,.24);
  font:13px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
}
.lim-window *{box-sizing:border-box}
.lim-window ::selection{background:var(--lim-accent-weak)}

/* ---------- 顶栏 ---------- */
.lim-header{display:flex;align-items:center;gap:8px;height:52px;flex:none;padding:0 8px 0 14px;background:var(--lim-bg);border-bottom:1px solid var(--lim-border);cursor:move;user-select:none;touch-action:none}
.lim-mark{display:block;flex:none}
.lim-title{font-size:14px;font-weight:600;letter-spacing:.01em}
.lim-ver{font-size:11px;color:var(--lim-faint);font-weight:500;letter-spacing:.02em;margin-top:2px}
.lim-count{display:inline-flex;align-items:center;gap:5px;margin-left:6px;padding:3px 8px;border-radius:999px;background:var(--lim-hover);color:var(--lim-muted);font-size:11px;font-weight:500}
.lim-count::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--lim-ok)}
.lim-count.off::before{background:var(--lim-muted)}
.lim-actions{margin-left:auto;display:flex;align-items:center;gap:2px}
.lim-iconbtn{display:grid;place-items:center;width:28px;height:28px;padding:0;border:none;border-radius:8px;background:transparent;color:var(--lim-muted);cursor:pointer;transition:background .12s ease,color .12s ease}
.lim-iconbtn:hover{background:var(--lim-hover);color:var(--lim-fg)}
.lim-iconbtn:focus-visible{outline:2px solid var(--lim-accent);outline-offset:1px}
.lim-iconbtn[aria-pressed="true"]{color:var(--lim-accent);background:var(--lim-accent-weak)}

/* ---------- 主体 ---------- */
.lim-body{flex:1;display:flex;min-height:0}
.lim-contacts{width:208px;flex:none;display:flex;flex-direction:column;min-height:0;background:var(--lim-sidebar);border-right:1px solid var(--lim-border)}
.lim-dms{flex:none;display:flex;flex-direction:column;min-height:0;max-height:40%;border-top:1px solid var(--lim-border);padding-top:2px}
.lim-dms .lim-contacts-group{padding:8px 8px 4px}
.lim-dms-scroll{overflow-y:auto;padding:0 8px 8px}
.lim-contacts-scroll{flex:1;min-height:0;overflow-y:auto;padding:8px}
.lim-contacts-scroll::-webkit-scrollbar,.lim-dms-scroll::-webkit-scrollbar,.lim-messages::-webkit-scrollbar{width:8px}
.lim-contacts-scroll::-webkit-scrollbar-thumb,.lim-dms-scroll::-webkit-scrollbar-thumb,.lim-messages::-webkit-scrollbar-thumb{background:var(--lim-hover);border-radius:4px}
.lim-contacts-group{font-size:11px;font-weight:600;letter-spacing:.08em;color:var(--lim-faint);padding:12px 8px 4px}
.lim-contacts-group:first-child{padding-top:4px}
.lim-contact{display:flex;align-items:center;gap:8px;height:32px;padding:0 8px;border-radius:8px;cursor:pointer;color:var(--lim-fg);font-size:13px}
.lim-contact:hover{background:var(--lim-hover)}
.lim-contact:focus-visible{outline:2px solid var(--lim-accent);outline-offset:-2px}
.lim-contact.on{background:var(--lim-accent-weak);color:var(--lim-fg);font-weight:600}
.lim-contact.on .lim-contact-name{color:var(--lim-fg)}
.lim-cicon{flex:none;display:grid;place-items:center;width:16px;height:16px;color:var(--lim-muted)}
.lim-contact.on .lim-cicon{color:var(--lim-accent)}
.lim-cdot{width:6px;height:6px;border-radius:50%;background:var(--lim-ok);flex:none}
.lim-contact-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-contact-badge{flex:none;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--lim-accent-solid);color:var(--lim-on-accent);font-size:10px;line-height:16px;text-align:center;font-weight:600}
.lim-contact-mute{flex:none;color:var(--lim-faint);display:grid;place-items:center}
.lim-channel-act{flex:none;display:grid;place-items:center;width:22px;height:22px;border:none;border-radius:6px;background:transparent;color:var(--lim-faint);cursor:pointer;opacity:0}
.lim-channel-x{flex:none;display:grid;place-items:center;width:22px;height:22px;border:none;border-radius:6px;background:transparent;color:var(--lim-faint);cursor:pointer;opacity:0}
.lim-contact:hover .lim-channel-act,.lim-contact:focus-within .lim-channel-act,.lim-contact.on .lim-channel-act,
.lim-contact:hover .lim-channel-x,.lim-contact:focus-within .lim-channel-x{opacity:1}
.lim-channel-act:hover{background:var(--lim-hover);color:var(--lim-fg)}
.lim-channel-x:hover{background:var(--lim-hover);color:var(--lim-danger)}
.lim-newchannel{display:flex;align-items:center;gap:8px;height:32px;padding:0 8px;margin-top:2px;border:none;border-radius:8px;background:transparent;color:var(--lim-muted);font:inherit;font-size:13px;cursor:pointer;width:100%}
.lim-newchannel:hover{background:var(--lim-hover);color:var(--lim-fg)}

/* 侧栏底部「我」 */
.lim-me{flex:none;display:flex;align-items:center;gap:8px;height:48px;padding:0 12px;border-top:1px solid var(--lim-border)}
.lim-me-avatar{width:24px;height:24px;flex:none;border-radius:50%;display:grid;place-items:center;background:var(--lim-accent-solid);color:var(--lim-on-accent);font-size:11px;font-weight:700}
.lim-me-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600}
.lim-me-id{display:block;font-size:11px;font-weight:400;color:var(--lim-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-me-dot{width:6px;height:6px;flex:none;border-radius:50%;background:var(--lim-ok)}
.lim-me-dot.off{background:var(--lim-muted)}

/* ---------- 会话区 ---------- */
.lim-thread{flex:1;display:flex;flex-direction:column;min-width:0}
.lim-thread-title{flex:none;display:flex;align-items:center;gap:8px;height:44px;padding:0 8px 0 14px;border-bottom:1px solid var(--lim-border)}
.lim-thread-name{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lim-thread-desc{flex:1;min-width:0;font-size:11px;color:var(--lim-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-seg{display:flex;gap:2px;padding:2px;border-radius:8px;background:var(--lim-hover);margin-left:auto}
.lim-seg button{height:24px;padding:0 10px;border:none;border-radius:6px;background:transparent;color:var(--lim-muted);font:inherit;font-size:11px;cursor:pointer}
.lim-seg button.on{background:var(--lim-bg);color:var(--lim-fg);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.2)}
.lim-seg button:focus-visible{outline:2px solid var(--lim-accent);outline-offset:1px}

.lim-searchbar{flex:none;display:flex;gap:6px;padding:8px 10px;border-bottom:1px solid var(--lim-border)}
.lim-messages{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}
.lim-msg{max-width:78%;align-self:flex-start;display:flex;flex-direction:column;gap:3px}
.lim-msg.mine{align-self:flex-end;align-items:flex-end}
.lim-msg-meta{font-size:11px;color:var(--lim-faint);display:flex;gap:6px;align-items:center}
.lim-msg.mine .lim-msg-meta{flex-direction:row-reverse}
.lim-bubble{padding:8px 12px;border-radius:10px;border-top-left-radius:4px;background:var(--lim-surface);color:var(--lim-fg);white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}
.lim-msg.mine .lim-bubble{background:var(--lim-accent-solid);color:var(--lim-on-accent);border-radius:10px;border-top-right-radius:4px}
.lim-bubble.recalled{font-style:italic;opacity:.6}
.lim-msg-act{flex:none;font-size:11px;color:var(--lim-faint);cursor:pointer;opacity:0;background:none;border:none;padding:0 2px}
.lim-msg:hover .lim-msg-act,.lim-msg-act:focus-visible{opacity:1}
.lim-msg-act:hover{color:var(--lim-fg)}
.lim-sys{align-self:center;font-size:11px;color:var(--lim-faint);padding:2px 8px;max-width:90%;text-align:center}

.lim-file{max-width:78%;align-self:flex-start;display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;background:var(--lim-surface)}
.lim-file.mine{align-self:flex-end}
.lim-file-icon{display:grid;place-items:center;width:28px;height:28px;flex:none;border-radius:8px;background:var(--lim-hover);color:var(--lim-muted)}
.lim-file-body{display:flex;flex-direction:column;gap:6px;width:100%}
.lim-file-img{max-width:220px;max-height:220px;border-radius:8px;object-fit:contain;background:var(--lim-hover)}
.lim-file-caption{font-size:11px;color:var(--lim-muted)}
.lim-file-meta{flex:1;min-width:0}
.lim-file-name{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-file-size{font-size:11px;color:var(--lim-faint)}
.lim-file-dl{display:grid;place-items:center;width:24px;height:24px;flex:none;border-radius:6px;color:var(--lim-muted);text-decoration:none}
.lim-file-dl:hover{background:var(--lim-hover);color:var(--lim-fg)}

/* ---------- 空状态 ---------- */
.lim-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;color:var(--lim-muted);text-align:center}
.lim-empty-art{opacity:.5}
.lim-empty-title{font-size:13px;font-weight:600;color:var(--lim-muted)}
.lim-empty-hint{font-size:11px;color:var(--lim-faint);max-width:240px;line-height:1.7}

/* ---------- 输入区 ---------- */
.lim-inputbar{flex:none;display:flex;align-items:flex-end;gap:8px;padding:10px 12px 12px;border-top:1px solid var(--lim-border)}
.lim-attach{display:grid;place-items:center;width:32px;height:32px;flex:none;border-radius:8px;color:var(--lim-muted);cursor:pointer}
.lim-attach:hover{background:var(--lim-hover);color:var(--lim-fg)}
.lim-attach:focus-within{outline:2px solid var(--lim-accent);outline-offset:1px}
.lim-input{flex:1;min-width:0;padding:8px 10px;font:inherit;font-size:13px;line-height:1.5;color:var(--lim-fg);background:var(--lim-surface);border:1px solid transparent;border-radius:10px;outline:none}
.lim-input::placeholder{color:var(--lim-faint)}
.lim-input:hover{border-color:var(--lim-border)}
.lim-input:focus{border-color:var(--lim-accent);box-shadow:0 0 0 3px var(--lim-accent-weak)}
.lim-send{display:grid;place-items:center;height:32px;min-width:52px;padding:0 12px;border:none;border-radius:8px;background:var(--lim-accent-solid);color:var(--lim-on-accent);font:inherit;font-size:12px;font-weight:600;cursor:pointer}
.lim-send:hover{filter:brightness(1.1)}
.lim-send:focus-visible{outline:2px solid var(--lim-accent);outline-offset:2px}
.lim-send.danger{background:var(--lim-danger)}
.lim-cta{align-self:flex-end;height:36px;min-width:96px;font-size:13px}

.lim-error{position:absolute;left:12px;right:12px;bottom:64px;padding:8px 12px;border-radius:8px;background:color-mix(in srgb,var(--lim-danger) 16%,var(--lim-bg));border:1px solid color-mix(in srgb,var(--lim-danger) 40%,transparent);color:var(--lim-fg);font-size:12px;z-index:2}

/* ---------- 弹层 ---------- */
.lim-modal{position:absolute;inset:0;z-index:40;display:grid;place-items:center;background:rgba(0,0,0,.5)}
.lim-modal-box{display:flex;flex-direction:column;gap:12px;width:300px;max-width:calc(100% - 32px);padding:18px;border-radius:14px;background:var(--lim-bg);border:1px solid var(--lim-border);box-shadow:0 18px 48px rgba(0,0,0,.4)}
.lim-modal-box.wide{width:360px;max-width:calc(100% - 32px)}
.lim-modal-actions{display:flex;gap:8px;justify-content:flex-end}
.lim-modal .lim-send{min-width:64px}
.lim-modal .lim-send.ghost{background:transparent;color:var(--lim-muted);border:1px solid var(--lim-border)}
.lim-modal .lim-send.ghost:hover{color:var(--lim-fg);background:var(--lim-hover)}
.lim-member-list{display:flex;flex-direction:column;gap:4px;max-height:150px;overflow-y:auto}
.lim-member{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:8px;background:var(--lim-surface);font-size:12px}
.lim-member-owner{margin-left:auto;font-size:11px;color:var(--lim-faint)}

/* ---------- 诊断日志 ---------- */
.lim-log{max-height:132px;overflow-y:auto;padding:8px 12px;border-bottom:1px solid var(--lim-border);background:var(--lim-sidebar);font:11px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace}
.lim-logline{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--lim-muted)}

/* ---------- 建号 ---------- */
.lim-setup{flex:1;display:flex;flex-direction:column;gap:14px;padding:24px;overflow-y:auto}
.lim-setup .lim-profile-head{gap:12px}
.lim-avatar{width:44px;height:44px;flex:none;border-radius:50%;display:grid;place-items:center;background:var(--lim-accent-solid);color:var(--lim-on-accent);font-size:15px;font-weight:700}
.lim-setup-title{font-size:15px;font-weight:600}
.lim-setup-hint{font-size:11px;color:var(--lim-muted);line-height:1.7}
.lim-warn{color:var(--lim-danger)}
.lim-field{display:flex;flex-direction:column;gap:6px}
.lim-field label{font-size:11px;font-weight:500;color:var(--lim-muted)}

/* ---------- 个人中心 ---------- */
.lim-profile{width:100%;display:flex;flex-direction:column;gap:14px;padding:18px}
.lim-profile-head{display:flex;align-items:center;gap:12px}
.lim-profile-id{flex:1;min-width:0}
.lim-profile-name{font-size:16px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-profile-account{font-size:11px;color:var(--lim-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-profile-status{display:flex;gap:6px;flex-wrap:wrap}
.lim-pill{font-size:11px;padding:3px 8px;border-radius:999px;background:var(--lim-hover);color:var(--lim-muted)}
.lim-pill.on{background:color-mix(in srgb,var(--lim-ok) 14%,transparent);color:var(--lim-ok);font-weight:600}
.lim-profile-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.lim-stat{display:flex;flex-direction:column;gap:2px;padding:10px;border-radius:10px;background:var(--lim-surface);min-width:0}
.lim-stat b{font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-stat span{font-size:11px;color:var(--lim-faint)}
.lim-row{display:flex;align-items:center;gap:8px}
.lim-mini{border:1px solid var(--lim-border);background:transparent;color:var(--lim-muted);font:inherit;font-size:11px;padding:6px 10px;border-radius:8px;cursor:pointer;white-space:nowrap}
.lim-mini:hover{color:var(--lim-fg);background:var(--lim-hover)}
.lim-profile-hint{font-size:11px;color:var(--lim-faint);line-height:1.7}
.lim-settings{flex:none;display:flex;flex-direction:column;gap:8px;padding:12px;border-bottom:1px solid var(--lim-border);background:var(--lim-sidebar)}

/* ---------- 共享文件 ---------- */
.lim-shared-list{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
.lim-shared-file{display:flex;align-items:center;gap:10px;padding:10px;border-radius:10px;background:var(--lim-surface)}
.lim-shared-icon{display:grid;place-items:center;width:32px;height:32px;flex:none;border-radius:8px;background:var(--lim-hover);color:var(--lim-muted)}
.lim-shared-img{width:40px;height:40px;object-fit:cover;border-radius:8px;background:var(--lim-hover)}
.lim-shared-meta{flex:1;min-width:0}
.lim-shared-name{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-shared-sub{font-size:11px;color:var(--lim-faint)}
.lim-shared-act{display:grid;place-items:center;font-size:11px;color:var(--lim-muted);text-decoration:none;cursor:pointer;border:none;background:transparent;padding:6px 8px;border-radius:6px;font-family:inherit}
.lim-shared-act.danger{color:var(--lim-danger)}
.lim-shared-act:hover{background:var(--lim-hover);color:var(--lim-fg)}
.lim-shared-hint{flex:1;font-size:11px;color:var(--lim-faint)}

/* ---------- 拖拽边 / 悬浮球 ---------- */
.lim-resize-e{position:absolute;right:0;top:0;bottom:20px;width:6px;cursor:ew-resize;z-index:30;touch-action:none}
.lim-resize-s{position:absolute;left:0;bottom:0;right:20px;height:6px;cursor:ns-resize;z-index:30;touch-action:none}
.lim-resize-se{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;z-index:30;touch-action:none}
.lim-launcher{position:fixed;right:20px;bottom:20px;z-index:2147483001;width:48px;height:48px;border:none;border-radius:50%;background:var(--lim-accent);color:#fff;cursor:pointer;box-shadow:0 8px 24px rgba(8,145,178,.4);display:grid;place-items:center}
.lim-launcher:hover{filter:brightness(1.1)}
.lim-launcher:focus-visible{outline:2px solid #fff;outline-offset:2px}
.lim-badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--lim-danger);color:#fff;font-size:11px;line-height:18px;text-align:center;font-weight:700}

@media (prefers-reduced-motion:reduce){.lim-window *,.lim-window *::before,.lim-window *::after{transition:none!important;animation:none!important}}
`
