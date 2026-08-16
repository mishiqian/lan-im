/**
 * 悬浮窗全部样式（CSS-in-TS 字符串）。
 */
export const CSS = `
.lim-window{--lim-bg:#ffffff;--lim-panel:#f6f6f7;--lim-fg:#1c1c1e;--lim-muted:#6b6b70;--lim-border:rgba(0,0,0,.12);--lim-hover:rgba(0,0,0,.06);--lim-active:rgba(59,130,246,.14);--lim-accent:#3b82f6;--lim-bubble-theirs:rgba(0,0,0,.07);--lim-bubble-mine:#3b82f6;--lim-danger:#dc4a4a}
.lim-window.lim-dark{--lim-bg:#1b1b1c;--lim-panel:#232324;--lim-fg:#e8e8ea;--lim-muted:#9a9aa0;--lim-border:rgba(255,255,255,.12);--lim-hover:rgba(255,255,255,.07);--lim-active:rgba(59,130,246,.22);--lim-accent:#4c8dff;--lim-bubble-theirs:rgba(255,255,255,.09);--lim-bubble-mine:#3b82f6;--lim-danger:#f07878}
.lim-window{position:fixed;z-index:99990;width:460px;max-width:calc(100vw - 16px);height:600px;max-height:calc(100vh - 16px);display:flex;flex-direction:column;background:var(--lim-bg);color:var(--lim-fg);border:1px solid var(--lim-border);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.35);overflow:hidden;font-size:14px;line-height:1.5;font-family:inherit}
.lim-window *{box-sizing:border-box;-webkit-text-fill-color:currentColor}
.lim-header{display:flex;align-items:center;gap:6px;padding:10px 12px;background:var(--lim-panel);border-bottom:1px solid var(--lim-border);cursor:move;user-select:none;touch-action:none}
.lim-dot{font-size:16px;line-height:1}
.lim-title{font-weight:700;font-size:14px}
.lim-count{font-size:12px;color:var(--lim-muted);flex:1;text-align:right}
.lim-iconbtn{border:none;background:transparent;color:var(--lim-muted);cursor:pointer;font-size:15px;line-height:1;padding:3px 6px;border-radius:6px}
.lim-iconbtn:hover{background:var(--lim-hover);color:var(--lim-fg)}
.lim-statusbar{display:flex;align-items:center;gap:8px;padding:4px 12px;font-size:12px;color:var(--lim-muted);border-bottom:1px solid var(--lim-border)}
.lim-selfname{cursor:pointer;padding:3px 8px;border-radius:8px;border:none;background:transparent;color:var(--lim-fg);font-family:inherit;font-size:12px}
.lim-selfname:hover{background:var(--lim-hover);color:var(--lim-fg)}
.lim-ip{flex:1;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-link{color:var(--lim-muted)}
.lim-link.off{color:var(--lim-danger)}
.lim-nameinput{flex:1;padding:3px 8px;font-size:12px;border-radius:6px;border:1px solid var(--lim-border);background:var(--lim-bg);color:var(--lim-fg)}
.lim-body{flex:1;display:flex;min-height:0}
.lim-contacts{width:150px;flex:none;overflow-y:auto;border-right:1px solid var(--lim-border);padding:6px;display:flex;flex-direction:column}
.lim-contacts-group{font-size:11px;color:var(--lim-muted);padding:6px 8px 2px;font-weight:600}
.lim-contact{display:flex;align-items:center;gap:7px;padding:7px 9px;border-radius:8px;cursor:pointer;font-size:13px;color:var(--lim-fg)}
.lim-contact:hover{background:var(--lim-hover)}
.lim-contact.on{background:var(--lim-active);color:var(--lim-accent);font-weight:600}
.lim-cdot{width:8px;height:8px;flex:none;border-radius:50%;background:#2ecc71}
.lim-cicon{flex:none;font-size:13px}
.lim-contact-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-contact-badge{flex:none;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--lim-danger);color:#fff;font-size:10px;line-height:16px;text-align:center}
.lim-contact-mute{flex:none;font-size:10px;color:var(--lim-muted)}
.lim-thread{flex:1;display:flex;flex-direction:column;min-width:0}
.lim-searchbar{flex:none;display:flex;gap:6px;padding:6px 8px;border-bottom:1px solid var(--lim-border)}
.lim-messages{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:8px}
.lim-msg{max-width:82%;align-self:flex-start;display:flex;flex-direction:column}
.lim-msg.mine{align-self:flex-end;align-items:flex-end}
.lim-msg-meta{font-size:11px;color:var(--lim-muted);margin-bottom:2px;display:flex;gap:6px;align-items:center}
.lim-msg.mine .lim-msg-meta{flex-direction:row-reverse}
.lim-bubble{padding:7px 11px;border-radius:12px;background:var(--lim-bubble-theirs);white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}
.lim-msg.mine .lim-bubble{background:var(--lim-bubble-mine);color:#fff}
.lim-bubble.recalled{font-style:italic;opacity:.6}
.lim-msg-act{flex:none;font-size:10px;color:var(--lim-muted);cursor:pointer;opacity:.5}
.lim-msg-act:hover{opacity:1}
.lim-file{max-width:82%;align-self:flex-start;display:flex;align-items:center;gap:10px;padding:8px 11px;border-radius:10px;background:var(--lim-hover);border:1px solid var(--lim-border)}
.lim-file.mine{align-self:flex-end}
.lim-file-icon{font-size:22px}
.lim-file-meta{flex:1;min-width:0}
.lim-file-name{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-file-size{font-size:11px;color:var(--lim-muted)}
.lim-file-dl{font-size:12px;color:var(--lim-accent);text-decoration:none;cursor:pointer}
.lim-file-body{display:flex;flex-direction:column;gap:4px;width:100%}
.lim-file-img{max-width:220px;max-height:220px;border-radius:8px;object-fit:contain;background:rgba(0,0,0,.05)}
.lim-file-caption{font-size:11px;color:var(--lim-muted)}
.lim-newchannel{display:flex;gap:6px;padding:4px 6px}
.lim-channel-x{flex:none;font-size:12px;color:var(--lim-muted);cursor:pointer;opacity:0;margin-left:auto}
.lim-contact:hover .lim-channel-x{opacity:.6}
.lim-channel-x:hover{opacity:1;color:var(--lim-danger)}
.lim-resize-e{position:absolute;right:0;top:0;bottom:20px;width:7px;cursor:ew-resize;z-index:30;touch-action:none}
.lim-resize-s{position:absolute;left:0;bottom:0;right:20px;height:7px;cursor:ns-resize;z-index:30;touch-action:none}
.lim-resize-se{position:absolute;right:0;bottom:0;width:20px;height:20px;cursor:nwse-resize;z-index:30;touch-action:none}
.lim-resize-se::after{content:'';position:absolute;right:5px;bottom:5px;width:12px;height:12px;opacity:0;background:repeating-linear-gradient(135deg,var(--lim-muted) 0 1px,transparent 1px 3px);transition:opacity .15s}
.lim-resize-se:hover::after{opacity:.75}
.lim-modal{position:absolute;inset:0;z-index:40;display:grid;place-items:center;background:rgba(0,0,0,.4)}
.lim-modal-box{display:flex;flex-direction:column;gap:12px;width:280px;max-width:calc(100% - 32px);padding:16px;border-radius:12px;background:var(--lim-panel);border:1px solid var(--lim-border);box-shadow:0 10px 34px rgba(0,0,0,.35)}
.lim-modal-actions{display:flex;gap:8px;justify-content:flex-end}
.lim-sys{align-self:center;font-size:12px;color:var(--lim-muted);background:var(--lim-hover);padding:2px 10px;border-radius:999px;max-width:90%;text-align:center}
.lim-inputbar{flex:none;display:flex;gap:6px;padding:8px;border-top:1px solid var(--lim-border)}
.lim-input{flex:1;padding:8px 10px;font-size:13px;border-radius:8px;border:1px solid var(--lim-border);background:var(--lim-panel);color:var(--lim-fg);outline:none;font-family:inherit}
.lim-input:focus{border-color:var(--lim-accent)}
.lim-send{border:none;background:var(--lim-accent);color:#fff;padding:8px 14px;font-size:13px;border-radius:8px;cursor:pointer;font-family:inherit}
.lim-send:hover{filter:brightness(1.08)}
.lim-attach{cursor:pointer;font-size:18px;padding:6px 8px;border-radius:8px;color:var(--lim-muted)}
.lim-attach:hover{background:var(--lim-hover)}
.lim-error{position:absolute;left:12px;right:12px;top:44px;padding:8px 12px;border-radius:8px;background:var(--lim-danger);color:#fff;font-size:12px;z-index:2;box-shadow:0 4px 14px rgba(0,0,0,.25)}
.lim-log{max-height:130px;overflow-y:auto;padding:6px 10px;border-bottom:1px solid var(--lim-border);background:var(--lim-panel);font:11px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace}
.lim-logline{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--lim-muted)}
.lim-empty{flex:1;display:grid;place-items:center;color:var(--lim-muted);font-size:13px;text-align:center;padding:16px}
.lim-launcher{position:fixed;right:20px;bottom:20px;z-index:99980;width:48px;height:48px;border:none;border-radius:50%;background:var(--lim-accent);color:#fff;font-size:20px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.3);display:grid;place-items:center}
.lim-launcher:hover{filter:brightness(1.08)}
.lim-badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--lim-danger);color:#fff;font-size:11px;line-height:18px;text-align:center;font-weight:700}
.lim-setup{flex:1;display:flex;flex-direction:column;gap:12px;padding:20px;overflow-y:auto}
.lim-setup .lim-profile-head{align-items:center}
.lim-cta{align-self:flex-end;padding:9px 18px;font-weight:700}
.lim-setup-title{font-size:16px;font-weight:700}
.lim-setup-hint{font-size:12px;color:var(--lim-muted)}
.lim-field{display:flex;flex-direction:column;gap:4px}
.lim-field label{font-size:12px;color:var(--lim-muted)}
.lim-settings{flex:none;max-height:200px;overflow-y:auto;padding:10px 12px;border-bottom:1px solid var(--lim-border);background:var(--lim-panel);display:flex;flex-direction:column;gap:8px}
.lim-row{display:flex;align-items:center;gap:8px;font-size:12px}
.lim-row .lim-input{flex:1;padding:5px 8px;font-size:12px}

.lim-tabs{flex:none;display:flex;gap:4px;padding:6px 8px 0;border-bottom:1px solid var(--lim-border)}
.lim-tab{border:none;background:transparent;color:var(--lim-muted);padding:5px 10px;font-size:13px;cursor:pointer;border-radius:8px 8px 0 0;font-family:inherit}
.lim-tab.on{background:var(--lim-bg);color:var(--lim-accent);font-weight:700}
.lim-thread-title{flex:none;display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--lim-border);background:var(--lim-panel)}
.lim-thread-name{font-weight:700;font-size:13px}
.lim-thread-desc{flex:1;font-size:11px;color:var(--lim-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-channel-act{flex:none;font-size:11px;color:var(--lim-muted);cursor:pointer;opacity:0;margin-left:auto}
.lim-contact:hover .lim-channel-act{opacity:.65}
.lim-channel-act:hover{opacity:1;color:var(--lim-fg)}
.lim-modal-box.wide{width:360px;max-width:calc(100% - 32px)}
.lim-member-list{display:flex;flex-direction:column;gap:4px;max-height:150px;overflow-y:auto}
.lim-member{display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:8px;background:var(--lim-hover);font-size:12px}
.lim-member-owner{margin-left:auto;font-size:10px;color:var(--lim-muted)}
.lim-send.danger{background:var(--lim-danger)}
.lim-shared-list{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:8px}
.lim-shared-file{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;background:var(--lim-hover);border:1px solid var(--lim-border)}
.lim-shared-icon{font-size:20px}
.lim-shared-img{width:44px;height:44px;object-fit:cover;border-radius:6px;background:rgba(0,0,0,.05)}
.lim-shared-meta{flex:1;min-width:0}
.lim-shared-name{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-shared-sub{font-size:11px;color:var(--lim-muted)}
.lim-shared-act{font-size:12px;color:var(--lim-accent);text-decoration:none;cursor:pointer;border:none;background:transparent;padding:3px 6px;border-radius:6px;font-family:inherit}
.lim-shared-act.danger{color:var(--lim-danger)}
.lim-shared-act:hover{background:var(--lim-hover)}
.lim-shared-hint{flex:1;font-size:12px;color:var(--lim-muted)}

.lim-profile{width:420px;max-width:calc(100% - 32px);display:flex;flex-direction:column;gap:12px}
.lim-profile-head{display:flex;align-items:center;gap:12px}
.lim-avatar{width:52px;height:52px;flex:none;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,var(--lim-accent),#7c6cff);color:#fff;font-size:20px;font-weight:800;box-shadow:0 6px 16px rgba(59,130,246,.28)}
.lim-profile-id{flex:1;min-width:0}
.lim-profile-name{font-size:17px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-profile-account{font-size:12px;color:var(--lim-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-profile-status{display:flex;gap:8px;flex-wrap:wrap}
.lim-pill{font-size:11px;padding:4px 9px;border-radius:999px;background:var(--lim-hover);color:var(--lim-muted)}
.lim-pill.on{background:rgba(46,204,113,.14);color:#2ecc71;font-weight:700}
.lim-profile-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.lim-stat{display:flex;flex-direction:column;gap:2px;padding:9px 10px;border-radius:10px;background:var(--lim-hover);min-width:0}
.lim-stat b{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lim-stat span{font-size:10px;color:var(--lim-muted)}
.lim-mini{border:1px solid var(--lim-border);background:var(--lim-bg);color:var(--lim-muted);font-size:11px;padding:7px 9px;border-radius:8px;cursor:pointer;white-space:nowrap;font-family:inherit}
.lim-mini:hover{color:var(--lim-fg);background:var(--lim-hover)}
.lim-profile-hint{font-size:11px;color:var(--lim-muted)}
`